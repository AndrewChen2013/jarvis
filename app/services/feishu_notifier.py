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
飞书消息推送服务

通过飞书 API 发送定时任务执行结果通知。

使用方式：
- 需要配置 lark-mcp
- 通过 Claude CLI 调用 MCP 工具发送消息
"""
import json
import asyncio
import subprocess
from typing import Optional

from app.core.logging import logger


class FeishuNotifier:
    """飞书消息推送服务"""

    # 默认接收者（可以是 open_id 或 chat_id）
    # 需要在配置中设置，或者在任务中指定
    DEFAULT_RECEIVE_ID = None
    DEFAULT_RECEIVE_ID_TYPE = "open_id"

    def __init__(self):
        self._enabled = True

    def build_success_card(
        self,
        task_name: str,
        time_str: str,
        duration: str,
        result: str
    ) -> str:
        """构建成功执行的卡片消息 content"""
        # 截断结果，避免消息太长
        if len(result) > 1000:
            result = result[:1000] + "\n... (内容已截断)"

        card = {
            "header": {
                "title": {"tag": "plain_text", "content": "⏰ 定时任务执行完成"},
                "template": "green"
            },
            "elements": [
                {"tag": "div", "text": {"tag": "lark_md", "content": f"**任务**: {task_name}"}},
                {"tag": "div", "text": {"tag": "lark_md", "content": f"**时间**: {time_str}"}},
                {"tag": "div", "text": {"tag": "lark_md", "content": f"**耗时**: {duration}"}},
                {"tag": "hr"},
                {"tag": "div", "text": {"tag": "lark_md", "content": f"**执行结果**:\n{result}"}}
            ]
        }
        return json.dumps(card, ensure_ascii=False)

    def build_error_card(
        self,
        task_name: str,
        time_str: str,
        error: str
    ) -> str:
        """构建失败执行的卡片消息 content"""
        card = {
            "header": {
                "title": {"tag": "plain_text", "content": "❌ 定时任务执行失败"},
                "template": "red"
            },
            "elements": [
                {"tag": "div", "text": {"tag": "lark_md", "content": f"**任务**: {task_name}"}},
                {"tag": "div", "text": {"tag": "lark_md", "content": f"**时间**: {time_str}"}},
                {"tag": "div", "text": {"tag": "lark_md", "content": f"**错误**: {error}"}}
            ]
        }
        return json.dumps(card, ensure_ascii=False)

    def build_skipped_message(self, task_name: str, reason: str) -> str:
        """构建跳过执行的文本消息 content"""
        return json.dumps({
            "text": f"⏭ 定时任务 [{task_name}] 已跳过：{reason}"
        }, ensure_ascii=False)

    async def send_message(
        self,
        msg_type: str,
        content: str,
        receive_id: Optional[str] = None,
        receive_id_type: Optional[str] = None
    ) -> bool:
        """发送消息到飞书

        由于 lark-mcp 是通过 Claude CLI 调用的，这里我们使用一个简化的方式：
        将消息保存到文件，供后续 Claude 读取并发送。

        在实际场景中，可以通过以下方式发送：
        1. 直接调用飞书 HTTP API（需要 access_token）
        2. 启动一个 Claude CLI 实例调用 lark-mcp

        Args:
            msg_type: 消息类型 ("text" 或 "interactive")
            content: 消息内容（JSON 字符串）
            receive_id: 接收者 ID
            receive_id_type: 接收者类型 ("open_id", "chat_id" 等)

        Returns:
            True if success, False otherwise
        """
        if not self._enabled:
            logger.info("[FeishuNotifier] Disabled, skipping notification")
            return True

        receive_id = receive_id or self.DEFAULT_RECEIVE_ID

        if not receive_id:
            logger.warning("[FeishuNotifier] No receive_id configured, skipping notification")
            return False

        # Auto-detect receive_id_type based on format
        if receive_id_type is None:
            if '@' in receive_id:
                receive_id_type = "email"
            elif receive_id.startswith('ou_'):
                receive_id_type = "open_id"
            elif receive_id.startswith('oc_'):
                receive_id_type = "chat_id"
            else:
                receive_id_type = self.DEFAULT_RECEIVE_ID_TYPE

        try:
            # 使用 claude CLI 调用 lark-mcp 发送消息
            # 这需要 lark-mcp 已经配置好
            result = await self._send_via_claude_cli(
                msg_type=msg_type,
                content=content,
                receive_id=receive_id,
                receive_id_type=receive_id_type
            )
            return result

        except Exception as e:
            logger.error(f"[FeishuNotifier] Failed to send message: {e}")
            return False

    async def _send_via_claude_cli(
        self,
        msg_type: str,
        content: str,
        receive_id: str,
        receive_id_type: str
    ) -> bool:
        """通过 Claude CLI 调用 lark-mcp 发送消息

        这是一个简化的实现。实际上，直接调用飞书 API 会更可靠。
        """
        # 构建 prompt
        prompt = f"""请使用 lark-mcp 的 im.v1.message.create 工具发送以下消息：

receive_id_type: {receive_id_type}
receive_id: {receive_id}
msg_type: {msg_type}
content: {content}

只需要调用一次发送消息的工具，不需要其他操作。"""

        try:
            # 使用 subprocess 调用 claude CLI
            # 注意：这会启动一个新的 Claude 进程，可能比较慢
            # 更好的方式是直接调用飞书 HTTP API
            process = await asyncio.create_subprocess_exec(
                'claude',
                prompt,
                '-p',
                '--dangerously-skip-permissions',
                '--max-turns', '3',
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )

            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=60  # 60 秒超时
            )

            stdout_str = stdout.decode() if stdout else ""
            stderr_str = stderr.decode() if stderr else ""

            if process.returncode == 0:
                logger.info(f"[FeishuNotifier] Message sent via Claude CLI, output: {stdout_str[:200]}")
                return True
            else:
                logger.error(f"[FeishuNotifier] Claude CLI error (code={process.returncode}): {stderr_str}")
                logger.error(f"[FeishuNotifier] stdout: {stdout_str[:500]}")
                return False

        except asyncio.TimeoutError:
            logger.error("[FeishuNotifier] Claude CLI timeout")
            return False
        except FileNotFoundError:
            logger.error("[FeishuNotifier] Claude CLI not found")
            return False
        except Exception as e:
            logger.error(f"[FeishuNotifier] Error calling Claude CLI: {e}")
            return False

    async def send_task_success(
        self,
        task_name: str,
        time_str: str,
        duration: str,
        result: str,
        receive_id: Optional[str] = None
    ) -> bool:
        """发送任务成功通知"""
        content = self.build_success_card(task_name, time_str, duration, result)
        return await self.send_message(
            msg_type="interactive",
            content=content,
            receive_id=receive_id
        )

    async def send_task_error(
        self,
        task_name: str,
        time_str: str,
        error: str,
        receive_id: Optional[str] = None
    ) -> bool:
        """发送任务失败通知"""
        content = self.build_error_card(task_name, time_str, error)
        return await self.send_message(
            msg_type="interactive",
            content=content,
            receive_id=receive_id
        )

    async def send_task_skipped(
        self,
        task_name: str,
        reason: str,
        receive_id: Optional[str] = None
    ) -> bool:
        """发送任务跳过通知"""
        content = self.build_skipped_message(task_name, reason)
        return await self.send_message(
            msg_type="text",
            content=content,
            receive_id=receive_id
        )

    def set_default_receive_id(self, receive_id: str, receive_id_type: str = "open_id"):
        """设置默认接收者"""
        self.DEFAULT_RECEIVE_ID = receive_id
        self.DEFAULT_RECEIVE_ID_TYPE = receive_id_type
        logger.info(f"[FeishuNotifier] Default receive_id set to: {receive_id} ({receive_id_type})")

    def enable(self):
        """启用通知"""
        self._enabled = True
        logger.info("[FeishuNotifier] Enabled")

    def disable(self):
        """禁用通知"""
        self._enabled = False
        logger.info("[FeishuNotifier] Disabled")


# 全局实例
feishu_notifier = FeishuNotifier()
