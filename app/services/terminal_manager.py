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
import pyte
from typing import Dict, Optional, Callable, List, Any
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
    last_disconnect_at: Optional[datetime] = None  # 最后断开时间（用于延迟清理）
    _output_callbacks: List[Callable] = field(default_factory=list)
    _output_history: bytearray = field(default_factory=bytearray)
    _read_task: Optional[asyncio.Task] = None
    # pyte 终端模拟器（用于渲染屏幕状态）
    _screen: Any = None           # pyte.HistoryScreen
    _stream: Any = None           # pyte.Stream

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

    def get_screen_content(self) -> str:
        """获取当前屏幕内容（包括滚动历史）"""
        if not self._screen:
            return ""
        try:
            result_lines = []

            # 获取滚动历史（上方滚出的行）
            if hasattr(self._screen.history, 'top'):
                for line in self._screen.history.top:
                    # history 行是 StaticDefaultDict，需要转换
                    if isinstance(line, str):
                        result_lines.append(line.rstrip())
                    else:
                        # 从 StaticDefaultDict 提取字符
                        text = ''.join(line[i].data for i in range(self._screen.columns))
                        result_lines.append(text.rstrip())

            # 获取当前显示的行（已经是字符串）
            for line in self._screen.display:
                result_lines.append(line.rstrip())

            # 去除整体尾部空行
            result = "\n".join(result_lines).rstrip()
            return result
        except Exception as e:
            logger.error(f"Get screen content error: {e}")
            return ""

    def reset_screen(self):
        """重置屏幕（用于下一批输出）"""
        if self._screen:
            try:
                self._screen.reset()
            except Exception as e:
                logger.error(f"Reset screen error: {e}")


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
        session_id: Optional[str] = None,
        rows: int = 40,
        cols: int = 120
    ) -> Terminal:
        """创建新终端

        Args:
            working_dir: 工作目录
            session_id: Claude session_id（None 表示新建会话）
            rows: 终端行数（默认 40）
            cols: 终端列数（默认 120）

        Returns:
            Terminal 实例
        """
        # 验证工作目录是否存在，不存在则回退到用户主目录
        if not os.path.isdir(working_dir):
            logger.warning(f"[Terminal] Working dir not found: {working_dir}, falling back to home")
            working_dir = os.path.expanduser("~")

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

            # 设置初始窗口大小（使用传入的 rows/cols）
            self._set_winsize(master_fd, rows, cols)
            logger.debug(f"[Terminal] Initial size: {rows}x{cols}")

            # 使用 session_id 或生成临时 ID 作为 terminal_id
            terminal_id = session_id or f"new-{pid}"

            terminal = Terminal(
                terminal_id=terminal_id,
                working_dir=working_dir,
                session_id=session_id,
                pid=pid,
                master_fd=master_fd
            )

            # 初始化 pyte 终端模拟器（保留 10000 行历史）
            terminal._screen = pyte.HistoryScreen(cols, rows, history=10000)
            terminal._stream = pyte.Stream(terminal._screen)
            logger.debug(f"[Terminal] pyte screen initialized: {cols}x{rows}")

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
        """关闭终端（优雅退出）"""
        terminal = self.terminals.pop(terminal_id, None)
        if not terminal:
            return

        logger.info(f"[Terminal:{terminal_id[:8]}] Closing gracefully...")

        # 1. 发送 /exit 命令让 Claude CLI 优雅退出（持久化历史）
        try:
            os.write(terminal.master_fd, b'/exit\r')
            logger.info(f"[Terminal:{terminal_id[:8]}] Sent /exit command")
        except OSError as e:
            logger.warning(f"[Terminal:{terminal_id[:8]}] Failed to send /exit: {e}")

        # 2. 等待 "See ya!" 响应或进程退出（最多 10 秒）
        exited = False
        see_ya_detected = False
        output_buffer = b''

        for i in range(20):  # 20 * 0.5s = 10s
            # 检查进程是否已退出
            try:
                os.kill(terminal.pid, 0)
            except ProcessLookupError:
                logger.info(f"[Terminal:{terminal_id[:8]}] Process exited gracefully after {(i+1)*0.5:.1f}s")
                exited = True
                break

            # 尝试读取输出，检测 "See ya!"
            if not see_ya_detected:
                try:
                    import select
                    readable, _, _ = select.select([terminal.master_fd], [], [], 0.1)
                    if readable:
                        data = os.read(terminal.master_fd, 4096)
                        output_buffer += data
                        # 检测退出确认（可能包含 ANSI 转义序列）
                        if b'See ya' in output_buffer or b'see ya' in output_buffer:
                            see_ya_detected = True
                            logger.info(f"[Terminal:{terminal_id[:8]}] Detected 'See ya!' - Claude is exiting")
                except OSError:
                    pass

            await asyncio.sleep(0.4 if not see_ya_detected else 0.5)

        # 3. 取消读取任务
        if terminal._read_task:
            terminal._read_task.cancel()
            try:
                await terminal._read_task
            except asyncio.CancelledError:
                pass

        # 4. 关闭 PTY
        try:
            os.close(terminal.master_fd)
        except OSError:
            pass

        # 5. 如果进程还没退出，强制终止
        if not exited:
            try:
                os.kill(terminal.pid, 0)
                logger.warning(f"[Terminal:{terminal_id[:8]}] Process didn't exit after 10s, sending SIGTERM")
                os.kill(terminal.pid, signal.SIGTERM)
                await asyncio.sleep(2.0)
                try:
                    os.kill(terminal.pid, 0)
                    logger.warning(f"[Terminal:{terminal_id[:8]}] Force killing with SIGKILL")
                    os.kill(terminal.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            except ProcessLookupError:
                pass

        # 6. 回收僵尸进程
        try:
            os.waitpid(terminal.pid, os.WNOHANG)
        except ChildProcessError:
            pass

        logger.info(f"[Terminal:{terminal_id[:8]}] Closed (see_ya={see_ya_detected})")

    def _write_all(self, fd: int, data: bytes, terminal_id: str) -> bool:
        """分块写入所有数据到 PTY（处理 buffer 限制）

        PTY 写入 buffer 通常只有 ~1KB，大数据需要分块写入。
        """
        total = len(data)
        written_total = 0
        chunk_count = 0

        while written_total < total:
            try:
                # 每次最多写入 512 字节，给 PTY buffer 留余量
                chunk = data[written_total:written_total + 512]
                written = os.write(fd, chunk)
                written_total += written
                chunk_count += 1

                if written == 0:
                    # 写入失败
                    logger.error(f"[Terminal:{terminal_id[:8]}] Write returned 0, stopping")
                    break
            except BlockingIOError:
                # buffer 满了，等一下再试
                import time
                time.sleep(0.01)
            except OSError as e:
                logger.error(f"[Terminal:{terminal_id[:8]}] Write error at {written_total}/{total}: {e}")
                return False

        if total > 100:  # 只记录较长的写入
            logger.info(f"[Terminal:{terminal_id[:8]}] Write complete: {total} bytes in {chunk_count} chunks")

        return written_total == total

    async def write(self, terminal_id: str, data: str) -> bool:
        """向终端写入数据"""
        terminal = self.terminals.get(terminal_id)
        if not terminal:
            return False

        try:
            # 识别以 \n 结尾且有内容的消息，转换为执行命令
            if data.endswith('\n') and len(data) > 1:
                content = data.rstrip('\n')
                encoded = content.encode('utf-8')
                success = self._write_all(terminal.master_fd, encoded, terminal_id)
                if success:
                    os.write(terminal.master_fd, b'\r')
                return success
            else:
                encoded = data.encode('utf-8')
                return self._write_all(terminal.master_fd, encoded, terminal_id)
        except OSError as e:
            logger.error(f"[Terminal:{terminal_id[:8]}] Write error: {e}")
            return False

    def get_winsize(self, terminal_id: str) -> tuple:
        """获取终端当前窗口大小

        Returns:
            (rows, cols) 或 (0, 0) 如果获取失败
        """
        terminal = self.terminals.get(terminal_id)
        if not terminal:
            return (0, 0)

        return self._get_winsize(terminal.master_fd)

    def _get_winsize(self, fd: int) -> tuple:
        """从 PTY 获取窗口大小"""
        try:
            # TIOCGWINSZ 返回 4 个 unsigned short: rows, cols, xpixel, ypixel
            result = fcntl.ioctl(fd, termios.TIOCGWINSZ, b'\x00' * 8)
            rows, cols, _, _ = struct.unpack('HHHH', result)
            return (rows, cols)
        except OSError:
            return (0, 0)

    async def resize(self, terminal_id: str, rows: int, cols: int) -> bool:
        """调整终端大小（仅在大小变化时）

        Returns:
            True 如果执行了 resize，False 如果大小相同或失败
        """
        terminal = self.terminals.get(terminal_id)
        if not terminal:
            return False

        # 获取当前大小
        current_rows, current_cols = self._get_winsize(terminal.master_fd)

        # 只在大小变化时才 resize
        if current_rows == rows and current_cols == cols:
            logger.debug(f"[Terminal:{terminal_id[:8]}] Size unchanged ({rows}x{cols}), skip resize")
            return False

        self._set_winsize(terminal.master_fd, rows, cols)

        # 同步更新 pyte 屏幕大小
        if terminal._screen:
            try:
                terminal._screen.resize(rows, cols)
                logger.debug(f"[Terminal:{terminal_id[:8]}] pyte screen resized to {rows}x{cols}")
            except Exception as e:
                logger.debug(f"pyte resize error: {e}")

        logger.info(f"[Terminal:{terminal_id[:8]}] Resized from {current_rows}x{current_cols} to {rows}x{cols}")
        return True

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

                    # Feed 给 pyte 终端模拟器
                    if terminal._stream:
                        try:
                            text = data.decode('utf-8', errors='replace')
                            terminal._stream.feed(text)
                        except Exception as e:
                            logger.debug(f"pyte feed error: {e}")

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
            # 重连时清除断开时间，取消延迟清理
            if terminal.last_disconnect_at:
                terminal.last_disconnect_at = None
                logger.info(f"[Terminal:{terminal_id[:8]}] Reconnected, cancelled delayed cleanup")
            logger.debug(f"[Terminal:{terminal_id[:8]}] WebSocket count: {terminal.websocket_count}")

    def decrement_websocket_count(self, terminal_id: str) -> int:
        """减少 WebSocket 连接计数，返回剩余数量"""
        terminal = self.terminals.get(terminal_id)
        if terminal:
            terminal.websocket_count = max(0, terminal.websocket_count - 1)
            # 当变成 0 连接时，记录断开时间（用于延迟清理）
            if terminal.websocket_count == 0:
                terminal.last_disconnect_at = datetime.now()
                logger.info(f"[Terminal:{terminal_id[:8]}] All WebSockets disconnected, marked for delayed cleanup")
            else:
                logger.debug(f"[Terminal:{terminal_id[:8]}] WebSocket count: {terminal.websocket_count}")
            return terminal.websocket_count
        return 0

    async def _cleanup_loop(self):
        """定期清理孤儿终端（每分钟检查，空闲24小时后清理）"""
        CLEANUP_DELAY = 86400  # 24小时延迟
        CHECK_INTERVAL = 60  # 每分钟检查一次

        while True:
            try:
                await asyncio.sleep(CHECK_INTERVAL)

                orphans = []
                now = datetime.now()

                for terminal_id, terminal in self.terminals.items():
                    # 检查进程是否还活着
                    try:
                        os.kill(terminal.pid, 0)
                    except ProcessLookupError:
                        logger.info(f"[Terminal:{terminal_id[:8]}] Process dead, marking for cleanup")
                        orphans.append(terminal_id)
                        continue

                    # 检查是否无连接且超过延迟时间
                    if terminal.websocket_count == 0 and terminal.last_disconnect_at:
                        idle_seconds = (now - terminal.last_disconnect_at).total_seconds()
                        if idle_seconds >= CLEANUP_DELAY:
                            logger.info(f"[Terminal:{terminal_id[:8]}] Idle for {idle_seconds:.0f}s, marking for cleanup")
                            orphans.append(terminal_id)

                for terminal_id in orphans:
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
