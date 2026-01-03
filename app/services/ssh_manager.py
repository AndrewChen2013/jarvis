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
SSH 连接管理器

管理到远程机器的 SSH 连接：
1. 建立 SSH 连接并创建 PTY
2. 代理 WebSocket ↔ SSH Channel
3. 连接断开时自动清理
"""
import asyncio
from typing import Dict, Optional, Callable, List, Tuple
from dataclasses import dataclass, field
from datetime import datetime

try:
    import asyncssh
    ASYNCSSH_AVAILABLE = True
except ImportError:
    ASYNCSSH_AVAILABLE = False
    asyncssh = None

from app.core.logging import logger


@dataclass
class SSHSession:
    """SSH 会话实例"""
    session_id: str               # 唯一标识
    machine_id: int               # 远程机器 ID
    machine_name: str             # 远程机器名称
    host: str                     # 远程地址
    port: int                     # SSH 端口
    username: str                 # 用户名
    conn: any = None              # asyncssh.SSHClientConnection
    process: any = None           # asyncssh.SSHClientProcess
    created_at: datetime = field(default_factory=datetime.now)
    websocket_count: int = 0      # 连接的 WebSocket 数量
    last_disconnect_at: Optional[datetime] = None
    _output_callbacks: List[Callable] = field(default_factory=list)
    _output_history: bytearray = field(default_factory=bytearray)
    _read_task: Optional[asyncio.Task] = None

    def add_output_callback(self, callback: Callable):
        """添加输出回调"""
        self._output_callbacks.append(callback)

    def remove_output_callback(self, callback: Callable):
        """移除输出回调"""
        if callback in self._output_callbacks:
            self._output_callbacks.remove(callback)

    def clear_output_callbacks(self):
        """清除所有输出回调"""
        self._output_callbacks.clear()

    def get_output_history(self) -> bytes:
        """获取输出历史"""
        return bytes(self._output_history)


class SSHManager:
    """SSH 连接管理器"""

    # 输出历史最大大小（256KB）
    MAX_OUTPUT_HISTORY = 256 * 1024

    def __init__(self):
        # 活跃会话: session_id -> SSHSession
        self.sessions: Dict[str, SSHSession] = {}
        self._cleanup_task: Optional[asyncio.Task] = None

    async def start(self):
        """启动管理器"""
        if not ASYNCSSH_AVAILABLE:
            logger.warning("asyncssh not installed, SSH features disabled")
            return
        logger.info("SSH manager starting...")
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())
        logger.info("SSH manager started")

    async def stop(self):
        """停止管理器"""
        logger.info("SSH manager stopping...")

        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass

        # 关闭所有会话
        for session_id in list(self.sessions.keys()):
            await self.close_session(session_id)

        logger.info("SSH manager stopped")

    async def test_connection(
        self,
        host: str,
        port: int,
        username: str,
        password: str
    ) -> Tuple[bool, str]:
        """测试 SSH 连接"""
        if not ASYNCSSH_AVAILABLE:
            return False, "asyncssh not installed"

        try:
            conn = await asyncio.wait_for(
                asyncssh.connect(
                    host=host,
                    port=port,
                    username=username,
                    password=password,
                    known_hosts=None  # 跳过主机密钥验证（简化版）
                ),
                timeout=10
            )
            conn.close()
            return True, "Connection successful"
        except asyncio.TimeoutError:
            return False, "Connection timeout"
        except asyncssh.PermissionDenied:
            return False, "Permission denied (wrong password?)"
        except asyncssh.HostKeyNotVerifiable:
            return False, "Host key not verifiable"
        except Exception as e:
            return False, f"Connection failed: {str(e)}"

    async def create_session(
        self,
        machine_id: int,
        machine_name: str,
        host: str,
        port: int,
        username: str,
        password: str,
        rows: int = 40,
        cols: int = 120
    ) -> Optional[SSHSession]:
        """创建 SSH 会话"""
        if not ASYNCSSH_AVAILABLE:
            logger.error("asyncssh not installed")
            return None

        # 生成会话 ID
        session_id = f"ssh-{machine_id}-{datetime.now().strftime('%Y%m%d%H%M%S')}"

        try:
            logger.info(f"Creating SSH session to {username}@{host}:{port}")

            # 建立 SSH 连接
            conn = await asyncio.wait_for(
                asyncssh.connect(
                    host=host,
                    port=port,
                    username=username,
                    password=password,
                    known_hosts=None
                ),
                timeout=30
            )

            # 创建 PTY 进程
            process = await conn.create_process(
                term_type='xterm-256color',
                term_size=(cols, rows)
            )

            session = SSHSession(
                session_id=session_id,
                machine_id=machine_id,
                machine_name=machine_name,
                host=host,
                port=port,
                username=username,
                conn=conn,
                process=process
            )

            self.sessions[session_id] = session

            # 启动输出读取任务
            session._read_task = asyncio.create_task(
                self._read_output(session)
            )

            logger.info(f"SSH session created: {session_id}")
            return session

        except asyncio.TimeoutError:
            logger.error(f"SSH connection timeout to {host}:{port}")
            return None
        except Exception as e:
            logger.error(f"Create SSH session error: {e}")
            return None

    async def _read_output(self, session: SSHSession):
        """读取 SSH 输出"""
        try:
            while True:
                if not session.process or session.process.stdout.at_eof():
                    break

                data = await session.process.stdout.read(8192)
                if not data:
                    break

                # 转换为 bytes
                if isinstance(data, str):
                    data = data.encode('utf-8', errors='replace')

                # 保存到历史
                session._output_history.extend(data)
                if len(session._output_history) > self.MAX_OUTPUT_HISTORY:
                    session._output_history = session._output_history[-self.MAX_OUTPUT_HISTORY:]

                # 调用输出回调
                for callback in session._output_callbacks:
                    try:
                        await callback(data)
                    except Exception as e:
                        logger.error(f"Output callback error: {e}")

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Read SSH output error: {e}")
        finally:
            # 连接断开，通知所有回调
            for callback in session._output_callbacks:
                try:
                    await callback(b"\r\n[SSH Connection Closed]\r\n")
                except Exception:
                    pass

    async def write_input(self, session_id: str, data: bytes) -> bool:
        """写入输入到 SSH"""
        session = self.sessions.get(session_id)
        if not session or not session.process:
            return False

        try:
            if isinstance(data, bytes):
                data = data.decode('utf-8', errors='replace')
            session.process.stdin.write(data)
            return True
        except Exception as e:
            logger.error(f"Write SSH input error: {e}")
            return False

    async def resize(self, session_id: str, rows: int, cols: int) -> bool:
        """调整终端大小"""
        session = self.sessions.get(session_id)
        if not session or not session.process:
            return False

        try:
            session.process.change_terminal_size(cols, rows)
            logger.debug(f"SSH terminal resized: {session_id} -> {rows}x{cols}")
            return True
        except Exception as e:
            logger.error(f"Resize SSH terminal error: {e}")
            return False

    async def close_session(self, session_id: str):
        """关闭 SSH 会话"""
        session = self.sessions.pop(session_id, None)
        if not session:
            return

        logger.info(f"Closing SSH session: {session_id}")

        # 取消读取任务
        if session._read_task:
            session._read_task.cancel()
            try:
                await session._read_task
            except asyncio.CancelledError:
                pass

        # 关闭进程
        if session.process:
            try:
                session.process.close()
            except Exception:
                pass

        # 关闭连接
        if session.conn:
            try:
                session.conn.close()
            except Exception:
                pass

        logger.info(f"SSH session closed: {session_id}")

    def get_session(self, session_id: str) -> Optional[SSHSession]:
        """获取会话"""
        return self.sessions.get(session_id)

    def get_active_sessions(self) -> List[Dict]:
        """获取所有活跃会话"""
        return [
            {
                "session_id": s.session_id,
                "machine_id": s.machine_id,
                "machine_name": s.machine_name,
                "host": s.host,
                "port": s.port,
                "username": s.username,
                "created_at": s.created_at.isoformat(),
                "websocket_count": s.websocket_count
            }
            for s in self.sessions.values()
        ]

    async def _cleanup_loop(self):
        """定期清理断开的会话"""
        while True:
            try:
                await asyncio.sleep(60)  # 每分钟检查

                now = datetime.now()
                to_close = []

                for session_id, session in self.sessions.items():
                    # 如果没有 WebSocket 连接且断开超过 5 分钟，清理
                    if session.websocket_count == 0 and session.last_disconnect_at:
                        idle_seconds = (now - session.last_disconnect_at).total_seconds()
                        if idle_seconds > 300:  # 5 分钟
                            to_close.append(session_id)

                for session_id in to_close:
                    logger.info(f"Cleaning up idle SSH session: {session_id}")
                    await self.close_session(session_id)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"SSH cleanup error: {e}")


# 全局实例
ssh_manager = SSHManager()
