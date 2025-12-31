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

from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, List
import asyncio
import json
import time

from app.services.session_manager import SessionManager
from app.core.config import settings
from app.core.logging import logger


class ConnectionManager:
    """WebSocket 连接管理器

    支持多客户端连接同一个会话，所有客户端共享输出
    """

    def __init__(self, session_manager: SessionManager):
        self.session_manager = session_manager
        # 一个会话可以有多个客户端连接
        self.active_connections: Dict[str, List[WebSocket]] = {}
        # 每个会话的输出回调（只需要注册一次）
        self.output_callbacks: Dict[str, bool] = {}

    async def connect(
        self,
        websocket: WebSocket,
        session_id: str,
        token: str
    ):
        """处理 WebSocket 连接"""
        # 验证 token
        if token != settings.AUTH_TOKEN:
            await websocket.close(code=1008, reason="Invalid token")
            logger.warning(f"Invalid token attempt for session {session_id}")
            return

        # 接受连接
        await websocket.accept()

        # 添加到连接列表
        if session_id not in self.active_connections:
            self.active_connections[session_id] = []
        self.active_connections[session_id].append(websocket)

        client_count = len(self.active_connections[session_id])
        logger.info(f"WebSocket connected: {session_id} (clients: {client_count})")
        logger.info(f"output_callbacks contains session: {session_id in self.output_callbacks}")

        # 立即发送连接中消息，防止 Safari 超时断开
        try:
            logger.info(f"Sending connecting message to {session_id}")
            await self._send_message(websocket, {
                "type": "connecting",
                "session_id": session_id,
                "message": "Starting session..."
            })
            logger.info(f"Connecting message sent to {session_id}")
        except Exception as e:
            logger.warning(f"Failed to send connecting message: {e}")
            return

        try:
            # 获取或启动会话进程
            process = await self.session_manager.get_session(session_id)
            if not process:
                await self._send_error(websocket, "Session not found or failed to start")
                return

            # 如果是第一个连接，注册输出回调
            if session_id not in self.output_callbacks:
                # 先清理旧的回调（可能是之前断开连接时遗留的）
                process.clear_output_callbacks()
                self._register_output_callback(session_id, process)
                self.output_callbacks[session_id] = True
                logger.info(f"Output callback registered for {session_id}")
            else:
                logger.info(f"Output callback already exists for {session_id}")

            # 发送连接成功消息
            logger.info(f"Sending connected message to {session_id}")
            await self._send_message(websocket, {
                "type": "connected",
                "session_id": session_id,
                "pid": process.pid,
                "clients": client_count
            })
            logger.info(f"Connected message sent to {session_id}")

            # 发送历史输出（如果有），分块发送避免消息太大
            history = process.get_output_history()
            logger.info(f"History buffer size: {len(history)} bytes")
            if history:
                text = history.decode('utf-8', errors='replace')
                # 分块发送，每块最大 4KB
                chunk_size = 4096
                for i in range(0, len(text), chunk_size):
                    chunk = text[i:i + chunk_size]
                    await self._send_message(websocket, {
                        "type": "output",
                        "data": chunk
                    })
                    # 给 Safari 一点时间处理
                    await asyncio.sleep(0.01)
                logger.info(f"Sent {len(history)} bytes of history in {(len(text) + chunk_size - 1) // chunk_size} chunks")
            else:
                logger.info("No history to send")

            # 进入消息处理循环
            await self._message_loop(websocket, session_id, process)

        except WebSocketDisconnect:
            logger.info(f"WebSocket disconnected: {session_id}")

        except Exception as e:
            logger.error(f"WebSocket error: {e}", exc_info=True)
            try:
                await self._send_error(websocket, str(e))
            except:
                pass

        finally:
            # 从连接列表移除
            if session_id in self.active_connections:
                if websocket in self.active_connections[session_id]:
                    self.active_connections[session_id].remove(websocket)

                # 如果没有客户端了，清理回调
                if not self.active_connections[session_id]:
                    del self.active_connections[session_id]
                    if session_id in self.output_callbacks:
                        del self.output_callbacks[session_id]
                    # 清理进程的输出回调
                    if process:
                        process.clear_output_callbacks()
                        logger.info(f"Cleared output callbacks for {session_id}")

            remaining = len(self.active_connections.get(session_id, []))
            logger.info(f"WebSocket cleaned up: {session_id} (remaining clients: {remaining})")

    def _register_output_callback(self, session_id: str, process):
        """注册输出回调（带缓冲，广播给所有客户端）"""
        output_buffer = []
        flush_task = [None]  # 延迟刷新任务

        async def flush_buffer():
            """刷新缓冲区，广播给所有客户端"""
            if output_buffer and session_id in self.active_connections:
                text = ''.join(output_buffer)
                output_buffer.clear()

                # 广播给所有客户端
                clients = self.active_connections.get(session_id, [])
                logger.info(f"Flushing {len(text)} chars to {len(clients)} clients")
                for ws in clients[:]:  # 使用副本避免迭代时修改
                    try:
                        await self._send_message(ws, {
                            "type": "output",
                            "data": text
                        })
                    except Exception as e:
                        logger.error(f"Broadcast error: {e}")

        async def delayed_flush():
            """延迟刷新 - 确保数据最终会被发送"""
            try:
                await asyncio.sleep(0.05)  # 50ms 后刷新
                await flush_buffer()
            except asyncio.CancelledError:
                pass
            finally:
                flush_task[0] = None

        async def send_output(data: bytes):
            """发送输出到所有客户端（带缓冲）"""
            if session_id not in self.active_connections:
                return

            text = data.decode('utf-8', errors='replace')
            output_buffer.append(text)

            buffer_size = sum(len(s) for s in output_buffer)

            # 如果缓冲区超过 4KB，立即发送
            if buffer_size > 4096:
                if flush_task[0]:
                    flush_task[0].cancel()
                    flush_task[0] = None
                await flush_buffer()
            else:
                # 否则启动延迟刷新任务（如果没有的话）
                if flush_task[0] is None:
                    flush_task[0] = asyncio.create_task(delayed_flush())

        process.on_output(send_output)

    async def _message_loop(self, websocket: WebSocket, session_id: str, process):
        """消息处理循环"""
        while True:
            try:
                message = await websocket.receive()

                # 检查是否是断开连接消息
                if message.get("type") == "websocket.disconnect":
                    logger.info(f"WebSocket disconnect message received: {session_id}")
                    break

                if "text" in message:
                    try:
                        data = json.loads(message["text"])
                    except Exception as e:
                        logger.error(f"Failed to parse JSON: {e}")
                        continue
                else:
                    continue

                await self._handle_message(websocket, session_id, process, data)

            except WebSocketDisconnect:
                logger.info(f"WebSocket disconnected: {session_id}")
                break

            except Exception as e:
                logger.error(f"Message loop error: {e}")
                break

    async def _handle_message(self, websocket: WebSocket, session_id: str, process, data: dict):
        """处理具体消息"""
        msg_type = data.get("type")

        if msg_type == "input":
            # 用户输入（任意客户端都可以输入）
            input_data = data.get("data", "")
            logger.debug(f"Input received: {repr(input_data[:50])}")
            await process.write(input_data)

        elif msg_type == "resize":
            # 终端大小调整
            rows = data.get("rows", 40)
            cols = data.get("cols", 120)
            await process.resize(rows, cols)
            logger.info(f"Terminal resized: {rows}x{cols}")

        elif msg_type == "ping":
            await self._send_message(websocket, {"type": "pong"})

        elif msg_type == "get_stats":
            stats = process.get_stats()
            await self._send_message(websocket, {
                "type": "stats",
                "data": stats
            })

        elif msg_type == "get_clients":
            # 获取当前连接的客户端数量
            count = len(self.active_connections.get(session_id, []))
            await self._send_message(websocket, {
                "type": "clients",
                "count": count
            })

        else:
            logger.warning(f"Unknown message type: {msg_type}")

    async def _send_message(self, websocket: WebSocket, data: dict):
        """发送消息"""
        try:
            json_str = json.dumps(data)
            msg_type = data.get('type', 'unknown')
            if msg_type == 'output':
                logger.info(f"Sending output message: {len(data.get('data', ''))} chars")
            await websocket.send_text(json_str)
            if msg_type == 'output':
                logger.info(f"Output message sent successfully")
        except RuntimeError as e:
            if "websocket.close" in str(e) or "response already completed" in str(e):
                logger.warning(f"WebSocket already closed, message dropped")
            else:
                raise
        except Exception as e:
            logger.error(f"Send message error: {e}")
            raise

    async def _send_error(self, websocket: WebSocket, message: str):
        """发送错误消息"""
        await self._send_message(websocket, {
            "type": "error",
            "message": message
        })

    async def broadcast(self, session_id: str, data: dict):
        """广播消息给会话的所有客户端"""
        clients = self.active_connections.get(session_id, [])
        for ws in clients[:]:
            try:
                await self._send_message(ws, data)
            except Exception:
                pass

    def get_client_count(self, session_id: str) -> int:
        """获取会话的客户端数量"""
        return len(self.active_connections.get(session_id, []))
