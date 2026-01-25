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
Socket.IO Connection Manager

基于 Socket.IO 的连接管理器，复用 MuxConnectionManager 的核心逻辑，
通过事件驱动模式替代 WebSocket 消息路由。

主要解决 VPN/代理环境下 WebSocket 连接被阻断的问题，
通过 Socket.IO 的自动降级机制（WebSocket -> HTTP Long Polling）保持连接。
"""

import asyncio
import hmac
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Set, Callable, Any

import socketio

from app.core.logging import logger
from app.core.config import settings
from app.services.terminal_manager import terminal_manager
from app.services.chat_session_manager import chat_manager, ChatMessage
from app.services.database import db
from app.services.socketio_manager import sio


def _utc_now() -> datetime:
    """Return current UTC time as timezone-aware datetime."""
    return datetime.now(timezone.utc)


@dataclass
class SocketIOClient:
    """Represents a Socket.IO client connection."""
    sid: str  # Socket.IO session ID
    connected_at: datetime = field(default_factory=_utc_now)
    subscriptions: Set[str] = field(default_factory=set)  # session_ids
    authenticated: bool = False
    is_closed: bool = False
    # Track terminal output callbacks for cleanup
    terminal_callbacks: Dict[str, Callable] = field(default_factory=dict)
    # Track chat output callbacks for cleanup
    chat_callbacks: Dict[str, Callable] = field(default_factory=dict)
    # Message queues for ordered delivery per session
    chat_message_queues: Dict[str, asyncio.Queue] = field(default_factory=dict)
    # Consumer tasks for processing message queues
    chat_consumer_tasks: Dict[str, asyncio.Task] = field(default_factory=dict)


class SocketIOConnectionManager:
    """
    Socket.IO 连接管理器。

    通过事件驱动模式管理多个 Terminal 和 Chat 会话。
    """

    def __init__(self):
        self.clients: Dict[str, SocketIOClient] = {}
        self.session_subscribers: Dict[str, Set[str]] = {}
        self._lock = asyncio.Lock()
        self._current_block_type: Dict[tuple, str] = {}
        # Track pending tool_use info per (sid, session_id) for streaming mode
        self._pending_tool_use: Dict[tuple, dict] = {}
        self._session_id_mapping: Dict[tuple, str] = {}
        self._setup_handlers()

    def _setup_handlers(self):
        """注册 Socket.IO 事件处理器。"""

        @sio.event
        async def connect(sid, environ, auth=None):
            """处理新连接。"""
            async with self._lock:
                client = SocketIOClient(sid=sid)
                self.clients[sid] = client
            logger.info(f"[SocketIO] Client {sid[:8]} connected")

        @sio.event
        async def disconnect(sid):
            """处理断开连接。"""
            await self._disconnect(sid)

        @sio.on('auth')
        async def handle_auth(sid, data):
            """处理认证。"""
            await self._handle_auth(sid, data)

        # Terminal 事件
        @sio.on('terminal:connect')
        async def handle_terminal_connect(sid, data):
            await self._handle_terminal_message(sid, data.get('session_id'), 'connect', data)

        @sio.on('terminal:disconnect')
        async def handle_terminal_disconnect(sid, data):
            await self._handle_terminal_message(sid, data.get('session_id'), 'disconnect', data)

        @sio.on('terminal:input')
        async def handle_terminal_input(sid, data):
            await self._handle_terminal_message(sid, data.get('session_id'), 'input', data)

        @sio.on('terminal:resize')
        async def handle_terminal_resize(sid, data):
            await self._handle_terminal_message(sid, data.get('session_id'), 'resize', data)

        @sio.on('terminal:close')
        async def handle_terminal_close(sid, data):
            await self._handle_terminal_message(sid, data.get('session_id'), 'close', data)

        # Chat 事件
        @sio.on('chat:connect')
        async def handle_chat_connect(sid, data):
            await self._handle_chat_message(sid, data.get('session_id'), 'connect', data)

        @sio.on('chat:disconnect')
        async def handle_chat_disconnect(sid, data):
            await self._handle_chat_message(sid, data.get('session_id'), 'disconnect', data)

        @sio.on('chat:message')
        async def handle_chat_message(sid, data):
            await self._handle_chat_message(sid, data.get('session_id'), 'message', data)

        @sio.on('chat:load_more_history')
        async def handle_chat_load_history(sid, data):
            await self._handle_chat_message(sid, data.get('session_id'), 'load_more_history', data)

        @sio.on('chat:close')
        async def handle_chat_close(sid, data):
            await self._handle_chat_message(sid, data.get('session_id'), 'close', data)

        # System 事件
        @sio.on('system:ping')
        async def handle_ping(sid, data=None):
            await sio.emit('system:pong', {}, to=sid)

    async def _disconnect(self, sid: str):
        """清理断开连接的客户端。"""
        async with self._lock:
            client = self.clients.pop(sid, None)
            if not client:
                return

            client.is_closed = True

            for session_id in client.subscriptions:
                if session_id in self.session_subscribers:
                    self.session_subscribers[session_id].discard(sid)
                    if not self.session_subscribers[session_id]:
                        del self.session_subscribers[session_id]

                # 清理 terminal 回调
                if session_id in client.terminal_callbacks:
                    terminal = await terminal_manager.get_terminal(session_id)
                    if terminal:
                        terminal.remove_output_callback(client.terminal_callbacks[session_id])
                        terminal_manager.decrement_websocket_count(session_id)

                # 清理 chat 回调
                if session_id in client.chat_callbacks:
                    session = chat_manager.get_session(session_id)
                    if session:
                        session.remove_callback(client.chat_callbacks[session_id])

                # 清理 chat 消费者任务
                if session_id in client.chat_consumer_tasks:
                    client.chat_consumer_tasks[session_id].cancel()

            # 清理 session ID 映射
            keys_to_remove = [k for k in self._session_id_mapping if k[0] == sid]
            for key in keys_to_remove:
                del self._session_id_mapping[key]

            logger.info(f"[SocketIO] Client {sid[:8]} disconnected, cleaned up {len(client.subscriptions)} subscriptions")

    async def _handle_auth(self, sid: str, data: dict):
        """处理认证请求。"""
        client = self.clients.get(sid)
        if not client:
            return

        # 幂等性检查：如果已认证，直接返回（不重复发送 auth_success）
        if client.authenticated:
            logger.debug(f"[SocketIO] Client {sid[:8]} already authenticated, skipping")
            return

        token = data.get('token', '')
        if hmac.compare_digest(token, settings.AUTH_TOKEN):
            client.authenticated = True
            await sio.emit('auth_success', {}, to=sid)
            logger.info(f"[SocketIO] Client {sid[:8]} authenticated")
        else:
            await sio.emit('auth_failed', {'reason': 'Invalid token'}, to=sid)
            logger.warning(f"[SocketIO] Client {sid[:8]} auth failed")

    async def send_to_client(self, sid: str, channel: str, msg_type: str, data: dict, session_id: str = None):
        """发送消息给客户端。"""
        client = self.clients.get(sid)
        if not client or client.is_closed:
            return

        try:
            event_name = f"{channel}:{msg_type}"
            payload = dict(data)
            if session_id:
                payload['session_id'] = session_id
            await sio.emit(event_name, payload, to=sid)
        except Exception as e:
            client.is_closed = True
            logger.debug(f"[SocketIO] Client {sid[:8]} send error: {e}")

    async def broadcast_to_session(self, session_id: str, channel: str, msg_type: str, data: dict):
        """广播消息到会话的所有订阅者。"""
        subscribers = self.session_subscribers.get(session_id, set())
        for sid in list(subscribers):
            await self.send_to_client(sid, channel, msg_type, data, session_id)

    async def subscribe(self, sid: str, session_id: str):
        """订阅会话。"""
        async with self._lock:
            client = self.clients.get(sid)
            if not client:
                return False

            client.subscriptions.add(session_id)
            if session_id not in self.session_subscribers:
                self.session_subscribers[session_id] = set()
            self.session_subscribers[session_id].add(sid)
            return True

    async def unsubscribe(self, sid: str, session_id: str):
        """取消订阅会话。"""
        async with self._lock:
            client = self.clients.get(sid)
            if not client:
                return

            client.subscriptions.discard(session_id)
            if session_id in self.session_subscribers:
                self.session_subscribers[session_id].discard(sid)
                if not self.session_subscribers[session_id]:
                    del self.session_subscribers[session_id]

            # 清理终端回调
            if session_id in client.terminal_callbacks:
                terminal = await terminal_manager.get_terminal(session_id)
                if terminal:
                    terminal.remove_output_callback(client.terminal_callbacks[session_id])
                    terminal_manager.decrement_websocket_count(session_id)
                del client.terminal_callbacks[session_id]

            # 清理 chat 回调和消费者
            if session_id in client.chat_callbacks:
                session = chat_manager.get_session(session_id)
                if session:
                    session.remove_callback(client.chat_callbacks[session_id])
                del client.chat_callbacks[session_id]

            if session_id in client.chat_consumer_tasks:
                client.chat_consumer_tasks[session_id].cancel()
                del client.chat_consumer_tasks[session_id]
            if session_id in client.chat_message_queues:
                del client.chat_message_queues[session_id]

    async def _handle_terminal_message(self, sid: str, session_id: str, msg_type: str, data: dict):
        """处理终端消息。"""
        client = self.clients.get(sid)
        if not client or not client.authenticated:
            return

        if msg_type == "connect":
            working_dir = data.get("working_dir", "")
            rows = data.get("rows", 40)
            cols = data.get("cols", 120)

            if not working_dir:
                await self.send_to_client(sid, "terminal", "error", {
                    "message": "working_dir is required"
                }, session_id)
                return

            original_session_id = session_id

            # 检查是否有 session ID 映射
            if session_id and not self._is_valid_uuid(session_id):
                mapping_key = (sid, session_id)
                mapped_id = self._session_id_mapping.get(mapping_key)
                if mapped_id:
                    session_id = mapped_id
                    logger.debug(f"[SocketIO] Using mapped session ID: {original_session_id[:8]} -> {session_id[:8]}")

            # 创建或获取终端
            terminal = await terminal_manager.get_terminal(session_id) if self._is_valid_uuid(session_id) else None

            if not terminal:
                import uuid as uuid_module
                session_id = str(uuid_module.uuid4())
                terminal = await terminal_manager.create_terminal(
                    session_id=session_id,
                    working_dir=working_dir,
                    rows=rows,
                    cols=cols
                )

                if original_session_id and original_session_id != session_id:
                    mapping_key = (sid, original_session_id)
                    self._session_id_mapping[mapping_key] = session_id
                    logger.debug(f"[SocketIO] Stored UUID mapping: '{original_session_id[:8]}' -> {session_id[:8]}")

            # 清理旧回调
            if session_id in client.terminal_callbacks:
                terminal.remove_output_callback(client.terminal_callbacks[session_id])
            else:
                terminal_manager.increment_websocket_count(session_id)

            # 注册输出回调
            async def output_callback(output_data: bytes, sid=sid, sess_id=session_id):
                c = self.clients.get(sid)
                if c and not c.is_closed:
                    await self.send_to_client(sid, "terminal", "output", {
                        "data": output_data.decode('utf-8', errors='replace')
                    }, sess_id)

            terminal.add_output_callback(output_callback)
            client.terminal_callbacks[session_id] = output_callback

            await self.subscribe(sid, session_id)

            await self.send_to_client(sid, "terminal", "connected", {
                "terminal_id": session_id,
                "original_session_id": original_session_id,
                "pid": terminal.pid
            }, session_id)

            # 发送输出历史
            history = terminal.get_output_history()
            if history:
                await self.send_to_client(sid, "terminal", "output", {
                    "data": history.decode('utf-8', errors='replace')
                }, session_id)

        elif msg_type == "disconnect":
            await self.unsubscribe(sid, session_id)

        elif msg_type == "input":
            text = data.get("text", "")
            if text and session_id:
                real_session_id = self._session_id_mapping.get((sid, session_id), session_id)
                terminal = await terminal_manager.get_terminal(real_session_id)
                if terminal:
                    terminal.write(text)

        elif msg_type == "resize":
            rows = data.get("rows", 40)
            cols = data.get("cols", 120)
            if session_id:
                real_session_id = self._session_id_mapping.get((sid, session_id), session_id)
                terminal = await terminal_manager.get_terminal(real_session_id)
                if terminal:
                    terminal.resize(rows, cols)

        elif msg_type == "close":
            if session_id:
                real_session_id = self._session_id_mapping.get((sid, session_id), session_id)
                await self.unsubscribe(sid, real_session_id)
                await terminal_manager.close_terminal(real_session_id)

    async def _handle_chat_message(self, sid: str, session_id: str, msg_type: str, data: dict):
        """处理 Chat 消息。"""
        client = self.clients.get(sid)
        if not client or not client.authenticated:
            return

        if msg_type == "connect":
            working_dir = data.get("working_dir", "")
            resume = data.get("resume")

            if not working_dir:
                await self.send_to_client(sid, "chat", "error", {
                    "message": "working_dir is required"
                }, session_id)
                return

            original_session_id = session_id

            # 检查是否有 session ID 映射
            if session_id and not self._is_valid_uuid(session_id):
                # 1. 尝试从内存映射获取
                mapping_key = (sid, session_id)
                mapped_id = self._session_id_mapping.get(mapping_key)
                
                # 2. 尝试从数据库获取持久化映射
                if not mapped_id:
                    mapped_id = db.get_chat_session_id(session_id)
                    if mapped_id:
                        # 恢复内存映射
                        self._session_id_mapping[mapping_key] = mapped_id
                        logger.info(f"[SocketIO] Restored chat mapping from DB: {session_id[:8]} -> {mapped_id[:8]}")

                if mapped_id:
                    session_id = mapped_id
                    logger.debug(f"[SocketIO] Chat using mapped session ID: {original_session_id[:8]} -> {session_id[:8]}")
                    
                    # 如果 resume 参数为空，但我们找到了映射 ID，
                    # 应该尝试 resume 这个 ID（因为它是之前的 Chat 会话）
                    if not resume:
                        resume = mapped_id
                        logger.info(f"[SocketIO] Auto-resume mapped session: {resume[:8]}")

            # 创建或恢复会话
            logger.info(f"[SocketIO] Chat connect: session_id={session_id[:8] if session_id else 'None'}, workDir={working_dir[:30]}...")

            # 幂等性检查：如果该 session 已有回调注册，说明已连接，跳过重复处理
            # 这防止了网络重连时多次发送历史消息
            if session_id and session_id in client.chat_callbacks:
                logger.info(f"[SocketIO] Chat connect duplicate: session={session_id[:8]}, already connected, skipping")
                return

            session = chat_manager.get_session(session_id) if self._is_valid_uuid(session_id) else None

            if not session:
                import uuid as uuid_module
                # 如果 session_id 已经是 UUID（即找到了映射），直接使用它
                # 否则生成新的 UUID
                if not self._is_valid_uuid(session_id):
                    session_id = str(uuid_module.uuid4())
                
                logger.info(f"[SocketIO] Creating new chat session: {session_id[:8]}")
                # create_session returns session_id, need to get the session object
                created_session_id = await chat_manager.create_session(
                    session_id=session_id,
                    working_dir=working_dir,
                    resume_session_id=resume
                )
                logger.info(f"[SocketIO] Session created: {created_session_id[:8] if created_session_id else 'None'}")
                session = chat_manager.get_session(created_session_id)
                logger.info(f"[SocketIO] Got session object: {session is not None}")

                if original_session_id and original_session_id != session_id:
                    mapping_key = (sid, original_session_id)
                    self._session_id_mapping[mapping_key] = session_id
                    logger.info(f"[SocketIO] Stored chat UUID mapping: '{original_session_id[:8]}' -> {session_id[:8]}")

                # Save persistent mapping in DB (allow any non-empty ID)
                if original_session_id and session_id:
                     try:
                         db.set_chat_session_id(original_session_id, session_id)
                     except Exception as e:
                         logger.error(f"[SocketIO] Failed to save session mapping: {e}")

            # 设置消息队列和消费者
            message_queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
            client.chat_message_queues[session_id] = message_queue

            async def chat_message_consumer():
                """消费消息队列，确保有序发送。"""
                logger.info(f"[SocketIO] Chat consumer started: sid={sid[:8]}, session={session_id[:8]}")
                try:
                    while True:
                        msg = await message_queue.get()
                        logger.debug(f"[SocketIO] Chat consumer got message: sid={sid[:8]}, session={session_id[:8]}, msg_type={msg.type}")
                        c = self.clients.get(sid)
                        if not c or c.is_closed:
                            logger.warning(f"[SocketIO] Chat consumer stopping: client gone or closed")
                            break
                        await self._send_chat_message(sid, session_id, msg)
                        message_queue.task_done()
                except asyncio.CancelledError:
                    logger.info(f"[SocketIO] Chat consumer cancelled: sid={sid[:8]}, session={session_id[:8]}")
                    pass

            consumer_task = asyncio.create_task(chat_message_consumer())
            client.chat_consumer_tasks[session_id] = consumer_task

            # 清理旧回调
            if session_id in client.chat_callbacks:
                session.remove_callback(client.chat_callbacks[session_id])

            # 注册回调
            def chat_callback(msg: ChatMessage, q=message_queue, sid_for_log=sid, sess_id_for_log=session_id):
                try:
                    logger.info(f"[SocketIO] Chat callback invoked: sid={sid_for_log[:8]}, session={sess_id_for_log[:8]}, msg_type={msg.type}, queue_size={q.qsize()}")
                    q.put_nowait(msg)
                except asyncio.QueueFull:
                    logger.warning(f"[SocketIO] Chat message queue full for {session_id[:8]}")

            session.add_callback(chat_callback)
            client.chat_callbacks[session_id] = chat_callback

            await self.subscribe(sid, session_id)

            # 获取历史消息
            # 优先使用 resume_session_id（恢复会话时），否则使用 _claude_session_id
            claude_sid = getattr(session, 'resume_session_id', None) or getattr(session, '_claude_session_id', None)
            history = []
            total_count = 0
            if claude_sid:
                # 获取最近的消息（按时间降序），然后反转为升序发送
                history_desc = db.get_chat_messages_desc(claude_sid, limit=15)
                history = list(reversed(history_desc))  # 反转为时间升序
                total_count = db.get_chat_message_count(claude_sid)
                logger.info(f"[SocketIO] Loaded {len(history)}/{total_count} history messages for {claude_sid[:8]}")

            # 发送 ready 事件（必须在 history 之前，以便前端完成 handler 映射）
            await self.send_to_client(sid, "chat", "ready", {
                "working_dir": working_dir,
                "original_session_id": original_session_id,
                "history_count": total_count,
                "claude_session_id": claude_sid
            }, session_id)

            # 发送历史消息（数据库格式转换为前端期望的格式）
            for msg in history:
                # 数据库字段: role, content; 前端期望: type, content
                msg_type = msg.get("role", "assistant")
                await self.send_to_client(sid, "chat", msg_type, {
                    "type": msg_type,
                    "content": msg.get("content", ""),
                    "timestamp": msg.get("timestamp"),
                }, session_id)

            await self.send_to_client(sid, "chat", "history_end", {
                "count": len(history),
                "total": total_count
            }, session_id)

        elif msg_type == "disconnect":
            await self.unsubscribe(sid, session_id)

        elif msg_type == "message":
            content = data.get("content", "")
            logger.info(f"[SocketIO] Chat message received: sid={sid[:8]}, session={session_id[:8] if session_id else 'None'}, content={content[:30] if content else 'None'}...")
            if content and session_id:
                # 直接查找 session（跟 MuxWebSocket 版本一致）
                session = chat_manager.get_session(session_id)

                # 如果找不到，尝试用 session_id 作为 resume_session_id 查找
                if not session:
                    for sess_id, sess in chat_manager._sessions.items():
                        if getattr(sess, 'resume_session_id', None) == session_id:
                            session = sess
                            session_id = sess_id
                            logger.info(f"[SocketIO] Found session via resume_session_id: {session_id[:8]}")
                            break

                logger.info(f"[SocketIO] Session found: {session is not None}, active sessions: {list(chat_manager._sessions.keys())[:5]}")
                if session:
                    # 发送用户确认
                    await self.send_to_client(sid, "chat", "user_ack", {
                        "content": content
                    }, session_id)

                    # 异步处理消息
                    asyncio.create_task(self._process_chat_message(sid, session_id, content))

        elif msg_type == "load_more_history":
            offset = data.get("offset", 0)
            limit = data.get("limit", 15)
            if session_id:
                real_session_id = self._session_id_mapping.get((sid, session_id), session_id)
                session = chat_manager.get_session(real_session_id)
                if session:
                    claude_sid = getattr(session, 'resume_session_id', None) or getattr(session, '_claude_session_id', None)
                    if claude_sid:
                        history_desc = db.get_chat_messages_desc(claude_sid, limit=limit, offset=offset)
                        history = list(reversed(history_desc))  # 反转为时间升序
                        for msg in history:
                            msg_type = msg.get("role", "assistant")
                            await self.send_to_client(sid, "chat", msg_type, {
                                "type": msg_type,
                                "content": msg.get("content", ""),
                                "timestamp": msg.get("timestamp"),
                            }, real_session_id)
                        await self.send_to_client(sid, "chat", "history_page_end", {
                            "offset": offset,
                            "count": len(history)
                        }, real_session_id)

        elif msg_type == "close":
            if session_id:
                real_session_id = self._session_id_mapping.get((sid, session_id), session_id)
                await self.unsubscribe(sid, real_session_id)
                await chat_manager.close_session(real_session_id)

    async def _process_chat_message(self, sid: str, session_id: str, content: str):
        """异步处理 Chat 消息。"""
        try:
            logger.info(f"[SocketIO] Processing chat message for {session_id[:8]}: {content[:50]}...")
            session = chat_manager.get_session(session_id)
            if session:
                logger.info(f"[SocketIO] Session found, is_running={session.is_running}, is_busy={session.is_busy}, sending message...")
                # send_message returns an async generator, iterate through it
                chunk_count = 0
                async for chunk in session.send_message(content):
                    chunk_count += 1
                    logger.debug(f"[SocketIO] Message chunk #{chunk_count}: type={chunk.type}")
                logger.info(f"[SocketIO] Message processing completed, received {chunk_count} chunks")
            else:
                logger.warning(f"[SocketIO] No session found for {session_id[:8]}")
                await self.send_to_client(sid, "chat", "error", {
                    "message": "Session not found"
                }, session_id)
        except Exception as e:
            logger.error(f"[SocketIO] Chat message error: {e}", exc_info=True)
            await self.send_to_client(sid, "chat", "error", {
                "message": str(e)
            }, session_id)

    async def _send_chat_message(self, sid: str, session_id: str, msg: ChatMessage):
        """发送 Chat 消息到客户端，解析 Claude 的原始 JSON 响应。"""
        content = msg.content
        if not isinstance(content, dict):
            return

        msg_type = content.get("type")

        if msg_type == "system":
            await self.send_to_client(sid, "chat", "system", {
                "session_id": content.get("session_id"),
                "model": content.get("model"),
                "tools": content.get("tools", [])
            }, session_id)

        elif msg_type == "stream_event":
            event = content.get("event", {})
            event_type = event.get("type")
            # Use (sid, session_id, index) as block key to track multiple content blocks
            block_index = event.get("index", 0)
            block_key = (sid, session_id, block_index)

            # Handle content block start
            if event_type == "content_block_start":
                block = event.get("content_block", {})
                block_type = block.get("type")
                self._current_block_type[block_key] = block_type
                logger.info(f"[SocketIO] content_block_start: index={block_index}, type={block_type}, block={block}")
                if block_type == "thinking":
                    await self.send_to_client(sid, "chat", "thinking_start", {}, session_id)
                elif block_type == "tool_use":
                    # Store tool_use info, will send tool_call on content_block_stop
                    self._pending_tool_use[block_key] = {
                        "tool_name": block.get("name"),
                        "tool_id": block.get("id"),
                        "input_json": ""
                    }
                    logger.info(f"[SocketIO] tool_use started: name={block.get('name')}, id={block.get('id')}")

            # Handle content block delta (streaming)
            elif event_type == "content_block_delta":
                delta = event.get("delta", {})
                delta_type = delta.get("type")

                if delta_type == "text_delta":
                    await self.send_to_client(sid, "chat", "stream", {
                        "text": delta.get("text", "")
                    }, session_id)
                elif delta_type == "thinking_delta":
                    await self.send_to_client(sid, "chat", "thinking_delta", {
                        "text": delta.get("thinking", "")
                    }, session_id)
                elif delta_type == "input_json_delta":
                    # Accumulate tool input JSON
                    if block_key in self._pending_tool_use:
                        self._pending_tool_use[block_key]["input_json"] += delta.get("partial_json", "")

            # Handle content block stop
            elif event_type == "content_block_stop":
                block_type = self._current_block_type.pop(block_key, "text")
                logger.info(f"[SocketIO] content_block_stop: index={block_index}, tracked_type={block_type}")
                if block_type == "thinking":
                    await self.send_to_client(sid, "chat", "thinking_end", {}, session_id)
                elif block_type == "tool_use":
                    # Send tool_call with accumulated input
                    pending = self._pending_tool_use.pop(block_key, None)
                    if pending:
                        try:
                            tool_input = json.loads(pending["input_json"]) if pending["input_json"] else {}
                        except json.JSONDecodeError:
                            tool_input = {"raw": pending["input_json"]}
                        logger.info(f"[SocketIO] Sending tool_call: name={pending['tool_name']}, id={pending['tool_id']}")
                        await self.send_to_client(sid, "chat", "tool_call", {
                            "tool_name": pending["tool_name"],
                            "tool_id": pending["tool_id"],
                            "input": tool_input
                        }, session_id)
                else:
                    await self.send_to_client(sid, "chat", "stream_end", {}, session_id)

        elif msg_type == "assistant":
            message = content.get("message", {})
            text_content = ""
            for block in message.get("content", []):
                block_type = block.get("type")
                if block_type == "text":
                    text_content += block.get("text", "")
                elif block_type == "tool_use":
                    # Send tool_call for non-streaming mode
                    await self.send_to_client(sid, "chat", "tool_call", {
                        "tool_name": block.get("name"),
                        "tool_id": block.get("id"),
                        "input": block.get("input", {})
                    }, session_id)
                elif block_type == "tool_result":
                    # Send tool_result
                    await self.send_to_client(sid, "chat", "tool_result", {
                        "tool_id": block.get("tool_use_id"),
                        "content": block.get("content", ""),
                        "is_error": block.get("is_error", False)
                    }, session_id)
            if text_content:
                await self.send_to_client(sid, "chat", "assistant", {
                    "content": text_content
                }, session_id)

        elif msg_type == "result":
            result = content.get("result", {})
            await self.send_to_client(sid, "chat", "result", {
                "cost": result.get("cost"),
                "duration_ms": result.get("duration_ms"),
                "duration_api_ms": result.get("duration_api_ms"),
                "is_error": result.get("is_error", False),
                "num_turns": result.get("num_turns"),
                "session_id": result.get("session_id"),
            }, session_id)

        elif msg_type == "user":
            message = content.get("message", {})
            text_content = ""
            content_blocks = message.get("content", [])
            # Handle string content
            if isinstance(content_blocks, str):
                text_content = content_blocks
            else:
                for block in content_blocks:
                    if isinstance(block, str):
                        text_content += block
                    elif isinstance(block, dict):
                        block_type = block.get("type")
                        if block_type == "text":
                            text_content += block.get("text", "")
                        elif block_type == "tool_result":
                            # Send tool_result from user message
                            tool_result = content.get("tool_use_result", {})
                            stdout = tool_result.get("stdout", "") if isinstance(tool_result, dict) else ""
                            stderr = tool_result.get("stderr", "") if isinstance(tool_result, dict) else ""
                            await self.send_to_client(sid, "chat", "tool_result", {
                                "tool_id": block.get("tool_use_id"),
                                "content": block.get("content", ""),
                                "stdout": stdout,
                                "stderr": stderr,
                                "is_error": block.get("is_error", False)
                            }, session_id)
            if text_content:
                await self.send_to_client(sid, "chat", "user", {
                    "content": text_content
                }, session_id)

    def _is_valid_uuid(self, value: str) -> bool:
        """检查字符串是否是有效的 UUID。"""
        if not value:
            return False
        try:
            import uuid as uuid_module
            uuid_module.UUID(value)
            return True
        except ValueError:
            return False


# 全局实例
socketio_manager = SocketIOConnectionManager()
