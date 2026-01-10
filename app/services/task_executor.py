# Copyright (c) 2025 BillChen
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
定时任务执行器

执行流程（使用 claude -p 非交互模式）：
1. 构建任务 prompt（包含飞书通知指令）
2. 使用 claude -p 执行任务
3. 任务内的 Claude 自行调用 lark-mcp 发送飞书通知
4. 解析输出判断成功/失败
5. 记录执行结果
"""
import asyncio
import os
import uuid
from datetime import datetime
from typing import Dict, Any, Tuple

from app.core.logging import logger
from app.services.database import db


class TaskExecutor:
    """定时任务执行器（使用 claude -p 非交互模式）"""

    # 任务超时时间（秒）
    DEFAULT_TIMEOUT = 3600  # 1 小时

    # 不限制对话轮数，让任务自由执行（适合 deep research 等长任务）
    MAX_TURNS = None  # 不传 --max-turns 参数

    def __init__(self):
        # 任务锁，避免同一任务同时执行多次
        self._task_locks: Dict[int, asyncio.Lock] = {}

    async def execute(self, task: Dict[str, Any]) -> bool:
        """执行任务

        Args:
            task: 任务信息 dict，包含 id, working_dir, prompt 等

        Returns:
            True if success, False otherwise
        """
        task_id = task['id']
        task_name = task['name']
        working_dir = task['working_dir']
        prompt = task['prompt']
        notify_feishu = task.get('notify_feishu', True)
        feishu_chat_id = task.get('feishu_chat_id')
        execution_mode = task.get('execution_mode', 'resume')

        # 获取或创建任务锁
        if task_id not in self._task_locks:
            self._task_locks[task_id] = asyncio.Lock()
        lock = self._task_locks[task_id]

        # 检查是否已经在执行
        if lock.locked():
            logger.warning(f"[TaskExecutor] Task {task_id} skipped: already running")
            return False

        # 记录开始执行
        execution_id = db.create_task_execution(task_id)
        start_time = datetime.now()

        try:
            async with lock:
                logger.info(f"[TaskExecutor] Starting task {task_id}: {task_name}")

                # 构建完整的 prompt（包含飞书通知指令）
                full_prompt = self._build_task_prompt(
                    task_name=task_name,
                    prompt=prompt,
                    notify_feishu=notify_feishu,
                    feishu_receive_id=feishu_chat_id
                )

                # 获取任务已有的 session_id（用于 resume 模式）
                existing_session_id = task.get('session_id')

                # 使用 claude -p 执行
                stdout, stderr, return_code, session_id = await self._run_claude(
                    prompt=full_prompt,
                    working_dir=working_dir,
                    timeout=self.DEFAULT_TIMEOUT,
                    existing_session_id=existing_session_id,
                    execution_mode=execution_mode
                )

                # 更新任务的 session_id
                # resume 模式：首次执行时保存，后续 session_id 不变
                # new 模式：不保存 session_id，每次都是新的
                if execution_mode == "resume" and not existing_session_id:
                    db.update_task_session_id(task_id, session_id)

                # 计算耗时
                duration = (datetime.now() - start_time).total_seconds()

                # 判断执行结果
                # 检查是否达到 max turns 限制（Claude 内部默认限制，返回 0 但输出包含错误）
                if 'Reached max turns' in stdout:
                    status = 'failed'
                    error_msg = "任务未完成：达到对话轮数限制"
                    output_summary = f"Error: {error_msg}"
                    logger.error(f"[TaskExecutor] Task {task_id} reached max turns")
                elif return_code == 0:
                    status = 'success'
                    output_summary = stdout[-2000:] if len(stdout) > 2000 else stdout
                    logger.info(f"[TaskExecutor] Task {task_id} completed successfully in {duration:.1f}s")
                else:
                    status = 'failed'
                    error_msg = stderr or f"Exit code: {return_code}"
                    output_summary = f"Error: {error_msg}\n\nOutput:\n{stdout[-1500:]}"
                    logger.error(f"[TaskExecutor] Task {task_id} failed: {error_msg}")

                # 更新执行记录
                db.update_task_execution(
                    execution_id,
                    status=status,
                    finished_at=datetime.now(),
                    output_summary=output_summary,
                    error=stderr if status == 'failed' else None
                )

                # 飞书通知由任务内的 Claude 通过 prompt 指令自己发送，不再单独启动进程

                return status == 'success'

        except asyncio.TimeoutError:
            logger.error(f"[TaskExecutor] Task {task_id} timed out after {self.DEFAULT_TIMEOUT}s")
            db.update_task_execution(
                execution_id,
                status='timeout',
                finished_at=datetime.now(),
                error=f'Execution timed out after {self.DEFAULT_TIMEOUT}s'
            )
            return False

        except Exception as e:
            logger.error(f"[TaskExecutor] Task {task_id} failed with exception: {e}")
            db.update_task_execution(
                execution_id,
                status='failed',
                finished_at=datetime.now(),
                error=str(e)
            )
            return False

    async def _run_claude(
        self,
        prompt: str,
        working_dir: str,
        timeout: int,
        existing_session_id: str = None,
        execution_mode: str = "resume"
    ) -> Tuple[str, str, int, str]:
        """使用 claude -p 执行任务

        Args:
            prompt: 要执行的 prompt
            working_dir: 工作目录
            timeout: 超时时间（秒）
            existing_session_id: 已有的 session_id（用于 resume）
            execution_mode: 执行模式
                - "resume": 首次创建 session，后续 resume 继续（默认）
                - "new": 每次都创建新 session，独立执行

        Returns:
            (stdout, stderr, return_code, session_id)
        """
        # 根据 execution_mode 判断是 resume 还是新建
        if execution_mode == "new":
            # new 模式：每次都创建新 session，独立执行
            session_id = str(uuid.uuid4())
            cmd = [
                'claude',
                '-p',  # 非交互模式
                '--dangerously-skip-permissions',
                '--session-id', session_id,
            ]
            mode = "NEW (independent)"
        elif existing_session_id:
            # resume 模式且有已有 session：复用
            session_id = existing_session_id
            cmd = [
                'claude',
                '-p',  # 非交互模式
                '--dangerously-skip-permissions',
                '--resume', session_id,  # 使用 --resume 继续之前的会话
            ]
            mode = "RESUME"
        else:
            # resume 模式但没有已有 session：首次创建
            session_id = str(uuid.uuid4())
            cmd = [
                'claude',
                '-p',  # 非交互模式
                '--dangerously-skip-permissions',
                '--session-id', session_id,  # 使用 --session-id 创建新会话
            ]
            mode = "NEW (first run)"

        # 如果设置了 MAX_TURNS，添加限制
        if self.MAX_TURNS is not None:
            cmd.extend(['--max-turns', str(self.MAX_TURNS)])

        cmd.append(prompt)

        turns_info = f"--max-turns {self.MAX_TURNS}" if self.MAX_TURNS else "unlimited turns"
        logger.info(f"[TaskExecutor] Running: claude -p [{mode}] {turns_info} session={session_id[:8]} (prompt: {len(prompt)} chars)")

        # 设置环境变量
        env = os.environ.copy()
        env['HOME'] = os.path.expanduser('~')
        env['TERM'] = 'xterm-256color'

        # 创建子进程
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=working_dir,
            env=env
        )

        try:
            # 等待完成（带超时）
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                process.communicate(),
                timeout=timeout
            )
            stdout = stdout_bytes.decode('utf-8', errors='replace')
            stderr = stderr_bytes.decode('utf-8', errors='replace')
            return stdout, stderr, process.returncode, session_id

        except asyncio.TimeoutError:
            # 超时，终止进程
            process.kill()
            await process.wait()
            raise

    def _detect_feishu_id_type(self, receive_id: str) -> tuple[str, str]:
        """检测飞书接收者 ID 类型

        Returns:
            (id_type, instruction): ID 类型和额外指令
            - id_type: email, open_id, chat_id, phone
            - instruction: 如果是 phone，需要先查询 open_id 的指令
        """
        if "@" in receive_id:
            return "email", ""
        elif receive_id.startswith("ou_"):
            return "open_id", ""
        elif receive_id.startswith("oc_"):
            return "chat_id", ""
        elif receive_id.isdigit() and len(receive_id) >= 10:
            # 纯数字且长度 >= 10，判断为手机号
            return "phone", f"""
**注意：接收者是手机号，需要先查询 open_id**

请先使用 lark-mcp 的 contact_v3_user_batchGetId 工具查询用户 open_id：
- mobiles: ["+86{receive_id}"]（如果是国内手机号需要加 +86 前缀）
- user_id_type: open_id

获取到 open_id 后，再用 open_id 发送消息。"""
        else:
            # 默认当作 open_id
            return "open_id", ""

    def _build_task_prompt(
        self,
        task_name: str,
        prompt: str,
        notify_feishu: bool = False,
        feishu_receive_id: str = None
    ) -> str:
        """构建任务 prompt"""
        base_prompt = f"""你是一个定时任务执行 agent。请执行以下任务：

## 任务名称
{task_name}

## 任务内容
{prompt}

## 执行要求
1. 认真完成任务目标
2. 如果任务涉及发送消息，确保消息发送成功
3. 完成后简要总结执行结果"""

        # 如果需要飞书通知且指定了接收者，添加通知指令
        if notify_feishu and feishu_receive_id:
            id_type, extra_instruction = self._detect_feishu_id_type(feishu_receive_id)

            if id_type == "phone":
                # 手机号需要先查询 open_id
                base_prompt += f"""

## 任务完成后
任务完成后，请发送执行结果通知到飞书。
{extra_instruction}

发送消息时使用 lark-mcp 的 im_v1_message_create 工具：
- receive_id_type: open_id（使用查询到的 open_id）
- msg_type: interactive
- content: 构建一个卡片消息，包含：
  - 标题：⏰ 定时任务执行完成（绿色）
  - 任务名称：{task_name}
  - 执行结果摘要

请确保飞书消息发送成功后再结束任务。"""
            else:
                base_prompt += f"""

## 任务完成后
任务完成后，请使用 lark-mcp 的 im_v1_message_create 工具发送执行结果通知到飞书。

发送参数：
- receive_id_type: {id_type}
- receive_id: {feishu_receive_id}
- msg_type: interactive
- content: 构建一个卡片消息，包含：
  - 标题：⏰ 定时任务执行完成（绿色）
  - 任务名称：{task_name}
  - 执行结果摘要

请确保飞书消息发送成功后再结束任务。"""

        base_prompt += "\n\n请开始执行。"
        return base_prompt


# 全局实例
task_executor = TaskExecutor()
