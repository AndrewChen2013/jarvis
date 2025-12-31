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
会话管理器
管理 Claude Code 会话的生命周期
"""
from typing import Dict, Optional, List
import asyncio
from datetime import datetime, timedelta
from uuid import uuid4

from app.services.process_manager import ManagedProcess, ProcessConfig
from app.services.claude_sessions import claude_scanner
from app.models.session import Session, SessionCreate
from app.core.config import settings
from app.core.logging import logger
from app.db.sqlite import SQLiteDB


class SessionManager:
    """会话管理器"""

    def __init__(self, db: SQLiteDB):
        self.db = db
        self.max_active = settings.MAX_ACTIVE_SESSIONS
        self.idle_timeout = settings.SESSION_IDLE_TIMEOUT
        # 活跃进程: session_id -> ManagedProcess
        self.active_processes: Dict[str, ManagedProcess] = {}
        self._cleanup_task: Optional[asyncio.Task] = None
        # 防止并发停止进程
        self._stop_locks: Dict[str, asyncio.Lock] = {}

    async def start(self):
        """启动管理器"""
        logger.info("Session manager starting...")
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())
        logger.info("Session manager started")

    async def stop(self):
        """停止管理器"""
        logger.info("Session manager stopping...")

        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass

        # 停止所有活跃进程
        for session_id in list(self.active_processes.keys()):
            await self._stop_process(session_id)

        logger.info("Session manager stopped")

    # ==================== 会话 CRUD ====================

    async def create_session(
        self,
        working_dir: str,
        claude_session_id: Optional[str] = None,
        name: Optional[str] = None
    ) -> Session:
        """创建会话

        Args:
            working_dir: 工作目录
            claude_session_id: 要恢复的 Claude 会话 ID（可选，为空则新建）
            name: 会话名称（可选）
        """
        session_id = str(uuid4())
        now = datetime.now()
        description = None

        # 如果是恢复会话，尝试获取 Claude 会话的名称和描述
        if claude_session_id:
            claude_info = claude_scanner.get_session_info(working_dir, claude_session_id)
            if claude_info:
                # Claude 的 name 实际上是 summary，作为描述
                description = claude_info.get("name")
                if not name:
                    # 如果没有指定名称，用描述的前30字作为名称
                    if description:
                        name = description[:30] + ("..." if len(description) > 30 else "")

        session = Session(
            id=session_id,
            name=name,
            description=description,
            working_dir=working_dir,
            status="idle",
            created_at=now,
            updated_at=now,
            last_active=now,
            claude_session_id=claude_session_id
        )

        # 保存到数据库
        await self.db.save_session({
            "id": session_id,
            "name": name,
            "description": description,
            "working_dir": working_dir,
            "status": "idle",
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
            "last_active": now.isoformat(),
            "pid": None,
            "claude_session_id": claude_session_id
        })

        logger.info(f"Session created: {session_id} (dir: {working_dir}, claude: {claude_session_id})")

        return session

    async def get_session(self, session_id: str) -> Optional[ManagedProcess]:
        """获取或启动会话进程"""
        # 更新最后活跃时间
        await self.db.update_session(session_id, {
            "last_active": datetime.now().isoformat()
        })

        # 如果进程已在运行，直接返回
        if session_id in self.active_processes:
            return self.active_processes[session_id]

        # 获取会话信息
        session_data = await self.db.get_session(session_id)
        if not session_data:
            return None

        # 启动进程
        return await self._start_process(session_id, session_data)

    async def list_sessions(self) -> List[Session]:
        """列出所有会话"""
        session_list = await self.db.list_sessions()
        sessions = []

        for data in session_list:
            try:
                session = Session(
                    id=data["id"],
                    name=data.get("name"),
                    description=data.get("description"),
                    working_dir=data["working_dir"],
                    status=data["status"],
                    created_at=datetime.fromisoformat(data["created_at"]),
                    updated_at=datetime.fromisoformat(data["updated_at"]),
                    last_active=datetime.fromisoformat(data["last_active"]),
                    pid=data.get("pid"),
                    claude_session_id=data.get("claude_session_id")
                )
                sessions.append(session)
            except Exception as e:
                logger.error(f"Failed to parse session: {e}")

        return sessions

    async def get_session_info(self, session_id: str) -> Optional[Session]:
        """获取会话信息（不启动进程）"""
        data = await self.db.get_session(session_id)
        if not data:
            return None

        try:
            return Session(
                id=data["id"],
                name=data.get("name"),
                description=data.get("description"),
                working_dir=data["working_dir"],
                status=data["status"],
                created_at=datetime.fromisoformat(data["created_at"]),
                updated_at=datetime.fromisoformat(data["updated_at"]),
                last_active=datetime.fromisoformat(data["last_active"]),
                pid=data.get("pid"),
                claude_session_id=data.get("claude_session_id")
            )
        except Exception as e:
            logger.error(f"Failed to parse session: {e}")
            return None

    async def update_session_name(self, session_id: str, name: str):
        """更新会话名称"""
        await self.db.update_session(session_id, {
            "name": name,
            "updated_at": datetime.now().isoformat()
        })

    async def delete_session(self, session_id: str):
        """删除会话"""
        # 停止进程，不更新数据库（因为马上要删除）
        await self._stop_process(session_id, update_db=False)
        await self.db.delete_session(session_id)
        logger.info(f"Session deleted: {session_id}")

    # ==================== Claude 会话查询 ====================

    def list_working_dirs(self) -> List[str]:
        """列出所有有 Claude 会话的工作目录"""
        return claude_scanner.list_working_dirs()

    def list_claude_sessions(self, working_dir: str) -> List[Dict]:
        """列出某个工作目录下的所有 Claude 会话"""
        return claude_scanner.list_sessions(working_dir)

    # ==================== 进程管理 ====================

    async def _start_process(self, session_id: str, session_data: Dict) -> ManagedProcess:
        """启动会话进程"""
        working_dir = session_data["working_dir"]
        claude_session_id = session_data.get("claude_session_id")

        # 检查是否超过限制
        if len(self.active_processes) >= self.max_active:
            await self._stop_oldest_process()

        # 构建 Claude 启动命令
        if claude_session_id:
            # 恢复指定会话
            cmd = f"claude --resume {claude_session_id} --dangerously-skip-permissions"
        else:
            # 新建会话
            cmd = "claude --dangerously-skip-permissions"

        # 创建进程配置
        config = ProcessConfig(
            command=["/bin/bash", "-c", cmd],
            cwd=working_dir,
            env={},
            max_memory_mb=settings.MAX_PROCESS_MEMORY_MB,
            max_cpu_percent=settings.MAX_PROCESS_CPU_PERCENT
        )

        # 启动进程
        process = ManagedProcess(config)
        await process.start()

        # 给 Claude 一点时间初始化，然后发送回车触发界面显示
        await asyncio.sleep(0.3)
        await process.write('\n')

        # 更新状态
        await self.db.update_session(session_id, {
            "status": "active",
            "pid": process.pid,
            "updated_at": datetime.now().isoformat()
        })

        self.active_processes[session_id] = process

        logger.info(f"Process started for session {session_id} (PID: {process.pid})")

        return process

    async def _stop_process(self, session_id: str, update_db: bool = True):
        """停止会话进程

        Args:
            session_id: 会话ID
            update_db: 是否更新数据库状态（删除时不需要更新）
        """
        # 获取或创建锁
        if session_id not in self._stop_locks:
            self._stop_locks[session_id] = asyncio.Lock()

        lock = self._stop_locks[session_id]

        async with lock:
            # 再次检查是否存在（可能已被其他协程停止）
            if session_id not in self.active_processes:
                logger.debug(f"Process already stopped for session {session_id}")
                return

            process = self.active_processes[session_id]
            try:
                await process.stop()
            except Exception as e:
                logger.error(f"Error stopping process for session {session_id}: {e}")

            # 从字典中移除
            self.active_processes.pop(session_id, None)

            # 只在需要时更新数据库（删除操作不需要）
            if update_db:
                try:
                    await self.db.update_session(session_id, {
                        "status": "idle",
                        "pid": None,
                        "updated_at": datetime.now().isoformat()
                    })
                except Exception as e:
                    logger.error(f"Error updating session status: {e}")

            logger.info(f"Process stopped for session {session_id}")

        # 清理锁
        self._stop_locks.pop(session_id, None)

    async def _stop_oldest_process(self):
        """停止最久未使用的进程"""
        if not self.active_processes:
            return

        # 获取所有活跃会话的最后活跃时间
        sessions_info = []
        for session_id in self.active_processes.keys():
            data = await self.db.get_session(session_id)
            if data:
                sessions_info.append((
                    session_id,
                    datetime.fromisoformat(data["last_active"])
                ))

        if not sessions_info:
            return

        # 找到最久未使用的
        oldest_id = min(sessions_info, key=lambda x: x[1])[0]
        await self._stop_process(oldest_id)

    async def disconnect_session(self, session_id: str, terminate: bool = True):
        """断开会话连接

        Args:
            session_id: 会话 ID
            terminate: 是否终止进程（False 则保持后台运行）
        """
        if terminate:
            await self._stop_process(session_id)
        else:
            # 只更新状态，不停止进程
            await self.db.update_session(session_id, {
                "updated_at": datetime.now().isoformat()
            })

    # ==================== 清理 ====================

    async def _cleanup_loop(self):
        """定期清理空闲会话"""
        while True:
            try:
                await asyncio.sleep(300)  # 每 5 分钟检查一次

                session_list = await self.db.list_sessions()
                now = datetime.now()
                idle_threshold = now - timedelta(seconds=self.idle_timeout)

                for data in session_list:
                    session_id = data["id"]
                    last_active = datetime.fromisoformat(data["last_active"])

                    # 如果进程在运行且超过空闲时间，停止
                    if data["status"] == "active" and last_active < idle_threshold:
                        if session_id in self.active_processes:
                            logger.info(f"Stopping idle session: {session_id}")
                            await self._stop_process(session_id)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Cleanup loop error: {e}")
