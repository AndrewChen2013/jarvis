import pty
import os
import select
import asyncio
import signal
import subprocess
from dataclasses import dataclass
from typing import Optional, Callable, List
import psutil
from app.core.logging import logger


@dataclass
class ProcessConfig:
    """进程配置"""
    command: List[str]
    cwd: str
    env: dict
    max_memory_mb: int = 2048
    max_cpu_percent: float = 80.0


class ManagedProcess:
    """管理的 Claude Code 进程"""

    # 历史输出缓冲区最大大小（字节）
    MAX_HISTORY_SIZE = 64 * 1024  # 64KB

    def __init__(self, config: ProcessConfig):
        self.config = config
        self.master_fd: Optional[int] = None
        self.slave_fd: Optional[int] = None
        self.pid: Optional[int] = None
        self.process: Optional[asyncio.subprocess.Process] = None
        self.psutil_process: Optional[psutil.Process] = None
        self._output_callbacks: List[Callable] = []
        self._running = False
        self._read_task: Optional[asyncio.Task] = None
        self._monitor_task: Optional[asyncio.Task] = None
        # 历史输出缓冲区
        self._output_history: bytearray = bytearray()

    async def start(self):
        """启动进程"""
        try:
            # 创建伪终端
            self.master_fd, self.slave_fd = pty.openpty()

            # 设置终端大小
            import termios, struct, fcntl
            winsize = struct.pack('HHHH', 40, 120, 0, 0)  # rows, cols
            fcntl.ioctl(self.slave_fd, termios.TIOCSWINSZ, winsize)

            # 设置 master_fd 为非阻塞
            import fcntl as fcntl_module
            flags = fcntl_module.fcntl(self.master_fd, fcntl_module.F_GETFL)
            fcntl_module.fcntl(self.master_fd, fcntl_module.F_SETFL, flags | os.O_NONBLOCK)

            # 准备环境变量
            env = os.environ.copy()
            env.update(self.config.env)
            env['TERM'] = 'xterm-256color'
            env['PYTHONUNBUFFERED'] = '1'
            env['FORCE_COLOR'] = '1'

            # 使用 subprocess 启动进程
            self.process = await asyncio.create_subprocess_exec(
                *self.config.command,
                stdin=self.slave_fd,
                stdout=self.slave_fd,
                stderr=self.slave_fd,
                cwd=self.config.cwd,
                env=env,
                start_new_session=True,
            )

            self.pid = self.process.pid
            self.psutil_process = psutil.Process(self.pid)
            self._running = True

            # 关闭 slave_fd（子进程已经继承了）
            os.close(self.slave_fd)
            self.slave_fd = None

            # 启动读取任务
            self._read_task = asyncio.create_task(self._read_output())
            self._monitor_task = asyncio.create_task(self._monitor_resources())

            logger.info(f"Process started: PID={self.pid}, command={' '.join(self.config.command)}")

        except Exception as e:
            logger.error(f"Failed to start process: {e}")
            await self.stop()
            raise

    async def _read_output(self):
        """读取进程输出"""
        loop = asyncio.get_event_loop()

        while self._running:
            try:
                # 使用 select 检查是否有数据可读
                ready, _, _ = await loop.run_in_executor(
                    None,
                    lambda: select.select([self.master_fd], [], [], 0.1)
                )

                if ready:
                    # 读取数据
                    data = await loop.run_in_executor(
                        None,
                        lambda: os.read(self.master_fd, 4096)
                    )

                    if data:
                        logger.info(f"PTY read: {len(data)} bytes, callbacks: {len(self._output_callbacks)}")
                        # 保存到历史缓冲区
                        self._output_history.extend(data)
                        # 限制历史大小
                        if len(self._output_history) > self.MAX_HISTORY_SIZE:
                            self._output_history = self._output_history[-self.MAX_HISTORY_SIZE:]

                        # 调用所有回调函数
                        for callback in self._output_callbacks:
                            try:
                                if asyncio.iscoroutinefunction(callback):
                                    await callback(data)
                                else:
                                    callback(data)
                            except Exception as e:
                                logger.error(f"Output callback error: {e}")
                    else:
                        # EOF
                        break

            except OSError as e:
                if e.errno == 5:  # I/O error - 进程可能已经退出
                    logger.info("Process terminated (I/O error)")
                    break
                logger.error(f"Read error: {e}")
                break
            except Exception as e:
                logger.error(f"Unexpected read error: {e}")
                break

            await asyncio.sleep(0.01)

        self._running = False
        logger.info("Read task stopped")

    async def _monitor_resources(self):
        """监控资源使用"""
        while self._running:
            try:
                if self.psutil_process and self.psutil_process.is_running():
                    # 检查内存
                    memory_mb = self.psutil_process.memory_info().rss / 1024 / 1024
                    if memory_mb > self.config.max_memory_mb:
                        logger.warning(
                            f"Process {self.pid} exceeds memory limit: "
                            f"{memory_mb:.1f}MB > {self.config.max_memory_mb}MB"
                        )

                    # 检查 CPU
                    cpu_percent = self.psutil_process.cpu_percent(interval=1)
                    if cpu_percent > self.config.max_cpu_percent:
                        logger.warning(
                            f"Process {self.pid} exceeds CPU limit: "
                            f"{cpu_percent:.1f}% > {self.config.max_cpu_percent}%"
                        )

                await asyncio.sleep(5)  # 每 5 秒检查一次

            except psutil.NoSuchProcess:
                logger.info("Process no longer exists")
                break
            except Exception as e:
                logger.error(f"Monitor error: {e}")
                break

        logger.info("Monitor task stopped")

    def on_output(self, callback: Callable):
        """注册输出回调"""
        self._output_callbacks.append(callback)

    def clear_output_callbacks(self):
        """清理所有输出回调"""
        self._output_callbacks.clear()
        logger.info("Output callbacks cleared")

    def get_output_history(self) -> bytes:
        """获取历史输出"""
        return bytes(self._output_history)

    async def write(self, data: str):
        """写入数据到进程"""
        if not self._running or self.master_fd is None:
            raise RuntimeError("Process not running")

        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: os.write(self.master_fd, data.encode('utf-8'))
            )
        except OSError as e:
            logger.error(f"Write error: {e}")
            raise

    async def resize(self, rows: int, cols: int):
        """调整终端大小"""
        if self.master_fd is None:
            return

        try:
            import termios, struct, fcntl
            winsize = struct.pack('HHHH', rows, cols, 0, 0)
            fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)
            logger.info(f"Terminal resized: {rows}x{cols}")
        except Exception as e:
            logger.error(f"Resize error: {e}")

    def get_stats(self) -> dict:
        """获取进程统计信息"""
        if not self.psutil_process or not self.psutil_process.is_running():
            return {
                "running": False,
                "cpu_percent": 0,
                "memory_mb": 0
            }

        try:
            return {
                "running": True,
                "pid": self.pid,
                "cpu_percent": self.psutil_process.cpu_percent(),
                "memory_mb": self.psutil_process.memory_info().rss / 1024 / 1024
            }
        except Exception:
            return {
                "running": False,
                "cpu_percent": 0,
                "memory_mb": 0
            }

    async def stop(self):
        """停止进程"""
        self._running = False

        # 取消任务
        if self._read_task:
            self._read_task.cancel()
            try:
                await self._read_task
            except asyncio.CancelledError:
                pass

        if self._monitor_task:
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass

        # 终止进程
        if self.process and self.process.returncode is None:
            try:
                self.process.terminate()
                await asyncio.wait_for(self.process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                logger.warning(f"Process {self.pid} did not terminate, killing...")
                self.process.kill()
                await self.process.wait()
            except Exception as e:
                logger.error(f"Error stopping process: {e}")

        # 关闭文件描述符
        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            self.master_fd = None

        if self.slave_fd is not None:
            try:
                os.close(self.slave_fd)
            except OSError:
                pass
            self.slave_fd = None

        logger.info(f"Process stopped: PID={self.pid}")

    def is_running(self) -> bool:
        """检查进程是否在运行"""
        return self._running and self.process and self.process.returncode is None
