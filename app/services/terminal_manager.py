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
终端管理器

简化版的 Claude CLI 进程管理：
1. 启动终端进程（通过 PTY）
2. 代理 WebSocket ↔ PTY
3. WebSocket 断开时自动清理
4. 兜底：每小时清理孤儿进程
"""
import os
import pty
import asyncio
import fcntl
import struct
import termios
import signal
from typing import Dict, Optional, Callable, List
from dataclasses import dataclass, field
from datetime import datetime
from app.core.logging import logger
from app.core.config import settings


@dataclass
class Terminal:
    """终端实例"""
    terminal_id: str              # 唯一标识（使用 Claude session_id）
    working_dir: str              # 工作目录
    session_id: Optional[str]     # Claude session_id（None 表示新建）
    pid: int                      # 进程 PID
    master_fd: int                # PTY master fd
    created_at: datetime = field(default_factory=datetime.now)
    websocket_count: int = 0      # 连接的 WebSocket 数量
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


class TerminalManager:
    """终端管理器"""

    # 输出历史最大大小（256KB）
    MAX_OUTPUT_HISTORY = 256 * 1024

    def __init__(self):
        # 活跃终端: terminal_id -> Terminal
        self.terminals: Dict[str, Terminal] = {}
        self._cleanup_task: Optional[asyncio.Task] = None

    async def start(self):
        """启动管理器"""
        logger.info("Terminal manager starting...")
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())
        logger.info("Terminal manager started")

    async def stop(self):
        """停止管理器"""
        logger.info("Terminal manager stopping...")

        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass

        # 停止所有终端
        for terminal_id in list(self.terminals.keys()):
            await self.close_terminal(terminal_id)

        logger.info("Terminal manager stopped")

    async def create_terminal(
        self,
        working_dir: str,
        session_id: Optional[str] = None
    ) -> Terminal:
        """创建新终端

        Args:
            working_dir: 工作目录
            session_id: Claude session_id（None 表示新建会话）

        Returns:
            Terminal 实例
        """
        # 构建启动命令
        # 注意：resume 需要在正确的 working_dir 下执行（由调用者保证）
        # root 用户不能使用 --dangerously-skip-permissions 参数
        is_root = os.getuid() == 0
        skip_perm_flag = "" if is_root else " --dangerously-skip-permissions"

        if session_id:
            cmd = f"claude --resume {session_id}{skip_perm_flag}"
            logger.info(f"[Terminal] RESUME mode: {session_id[:8]}... (cwd: {working_dir}, root: {is_root})")
        else:
            cmd = f"claude{skip_perm_flag}"
            logger.info(f"[Terminal] NEW mode (cwd: {working_dir}, root: {is_root})")

        # 创建 PTY
        pid, master_fd = pty.fork()

        if pid == 0:
            # 子进程
            os.chdir(working_dir)
            os.execvp("/bin/bash", ["/bin/bash", "-c", cmd])
        else:
            # 父进程
            # 设置非阻塞
            flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
            fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

            # 设置初始窗口大小
            self._set_winsize(master_fd, 40, 120)

            # 使用 session_id 或生成临时 ID 作为 terminal_id
            terminal_id = session_id or f"new-{pid}"

            terminal = Terminal(
                terminal_id=terminal_id,
                working_dir=working_dir,
                session_id=session_id,
                pid=pid,
                master_fd=master_fd
            )

            self.terminals[terminal_id] = terminal

            # 启动读取任务
            terminal._read_task = asyncio.create_task(
                self._read_output(terminal)
            )

            logger.info(f"[Terminal:{terminal_id[:8]}] Created (PID: {pid})")

            # 给 Claude 一点时间初始化
            await asyncio.sleep(0.3)
            await self.write(terminal_id, '\n')

            return terminal

    async def get_terminal(self, terminal_id: str) -> Optional[Terminal]:
        """获取终端（如果存在）"""
        return self.terminals.get(terminal_id)

    async def close_terminal(self, terminal_id: str):
        """关闭终端"""
        terminal = self.terminals.pop(terminal_id, None)
        if not terminal:
            return

        logger.info(f"[Terminal:{terminal_id[:8]}] Closing...")

        # 取消读取任务
        if terminal._read_task:
            terminal._read_task.cancel()
            try:
                await terminal._read_task
            except asyncio.CancelledError:
                pass

        # 关闭 PTY
        try:
            os.close(terminal.master_fd)
        except OSError:
            pass

        # 终止进程
        try:
            os.kill(terminal.pid, signal.SIGTERM)
            # 等待一小段时间
            await asyncio.sleep(0.1)
            # 如果还活着，强制杀死
            try:
                os.kill(terminal.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        except ProcessLookupError:
            pass

        # 回收僵尸进程
        try:
            os.waitpid(terminal.pid, os.WNOHANG)
        except ChildProcessError:
            pass

        logger.info(f"[Terminal:{terminal_id[:8]}] Closed")

    async def write(self, terminal_id: str, data: str) -> bool:
        """向终端写入数据"""
        terminal = self.terminals.get(terminal_id)
        if not terminal:
            return False

        try:
            # 识别以 \n 结尾且有内容的消息，转换为执行命令
            if data.endswith('\n') and len(data) > 1:
                content = data.rstrip('\n')
                os.write(terminal.master_fd, content.encode('utf-8'))
                os.write(terminal.master_fd, b'\r')
            else:
                os.write(terminal.master_fd, data.encode('utf-8'))
            return True
        except OSError as e:
            logger.error(f"[Terminal:{terminal_id[:8]}] Write error: {e}")
            return False

    async def resize(self, terminal_id: str, rows: int, cols: int):
        """调整终端大小"""
        terminal = self.terminals.get(terminal_id)
        if not terminal:
            return

        self._set_winsize(terminal.master_fd, rows, cols)
        logger.debug(f"[Terminal:{terminal_id[:8]}] Resized to {rows}x{cols}")

    def _set_winsize(self, fd: int, rows: int, cols: int):
        """设置终端窗口大小"""
        try:
            winsize = struct.pack('HHHH', rows, cols, 0, 0)
            fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
        except OSError:
            pass

    async def _read_output(self, terminal: Terminal):
        """读取终端输出"""
        loop = asyncio.get_event_loop()

        def on_readable():
            try:
                data = os.read(terminal.master_fd, 4096)
                if data:
                    # 保存到历史
                    terminal._output_history.extend(data)
                    # 限制历史大小
                    if len(terminal._output_history) > self.MAX_OUTPUT_HISTORY:
                        terminal._output_history = terminal._output_history[-self.MAX_OUTPUT_HISTORY:]

                    # 调用回调
                    for callback in terminal._output_callbacks:
                        asyncio.create_task(callback(data))
            except BlockingIOError:
                pass
            except OSError:
                # PTY 已关闭
                loop.remove_reader(terminal.master_fd)

        loop.add_reader(terminal.master_fd, on_readable)

        try:
            # 等待直到被取消
            while True:
                await asyncio.sleep(3600)
        except asyncio.CancelledError:
            pass
        finally:
            try:
                loop.remove_reader(terminal.master_fd)
            except:
                pass

    def increment_websocket_count(self, terminal_id: str):
        """增加 WebSocket 连接计数"""
        terminal = self.terminals.get(terminal_id)
        if terminal:
            terminal.websocket_count += 1
            logger.debug(f"[Terminal:{terminal_id[:8]}] WebSocket count: {terminal.websocket_count}")

    def decrement_websocket_count(self, terminal_id: str) -> int:
        """减少 WebSocket 连接计数，返回剩余数量"""
        terminal = self.terminals.get(terminal_id)
        if terminal:
            terminal.websocket_count = max(0, terminal.websocket_count - 1)
            logger.debug(f"[Terminal:{terminal_id[:8]}] WebSocket count: {terminal.websocket_count}")
            return terminal.websocket_count
        return 0

    async def _cleanup_loop(self):
        """定期清理孤儿终端（每小时）"""
        while True:
            try:
                await asyncio.sleep(3600)  # 每小时检查一次

                orphans = []
                for terminal_id, terminal in self.terminals.items():
                    # 检查进程是否还活着
                    try:
                        os.kill(terminal.pid, 0)
                    except ProcessLookupError:
                        orphans.append(terminal_id)
                        continue

                    # 检查是否有 WebSocket 连接
                    if terminal.websocket_count == 0:
                        # 计算空闲时间（简化：没有 WebSocket 连接就认为是孤儿）
                        orphans.append(terminal_id)

                for terminal_id in orphans:
                    logger.info(f"[Terminal:{terminal_id[:8]}] Cleaning up orphan")
                    await self.close_terminal(terminal_id)

                if orphans:
                    logger.info(f"Cleaned up {len(orphans)} orphan terminals")

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Cleanup loop error: {e}")

    def get_stats(self) -> Dict:
        """获取统计信息"""
        return {
            "active_terminals": len(self.terminals),
            "terminals": [
                {
                    "id": t.terminal_id[:8],
                    "pid": t.pid,
                    "working_dir": t.working_dir,
                    "websocket_count": t.websocket_count,
                    "created_at": t.created_at.isoformat()
                }
                for t in self.terminals.values()
            ]
        }

    def get_active_sessions(self) -> Dict:
        """获取活跃的 session 信息（用于前端显示状态）

        Returns:
            {
                "sessions": ["session_id1", "session_id2", ...],
                "working_dirs": ["/path/1", "/path/2", ...]
            }
        """
        sessions = []
        working_dirs = set()

        for terminal in self.terminals.values():
            if terminal.session_id:
                sessions.append(terminal.session_id)
            working_dirs.add(terminal.working_dir)

        return {
            "sessions": sessions,
            "working_dirs": list(working_dirs)
        }


# 全局实例
terminal_manager = TerminalManager()
