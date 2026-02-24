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
from typing import Dict, Set, Callable

from app.core.logging import logger
from app.core.config import settings
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
    # Track chat output callbacks for cleanup
    chat_callbacks: Dict[str, Callable] = field(default_factory=dict)
    # Message queues for ordered delivery per session
    chat_message_queues: Dict[str, asyncio.Queue] = field(default_factory=dict)
    # Consumer tasks for processing message queues
    chat_consumer_tasks: Dict[str, asyncio.Task] = field(default_factory=dict)


class SocketIOConnectionManager:
    """
    Socket.IO 连接管理器。

    通过事件驱动模式管理 Chat 会话。
    """

    def __init__(self):
        self.clients: Dict[str, SocketIOClient] = {}
        self.session_subscribers: Dict[str, Set[str]] = {}
        self._lock = asyncio.Lock()
        self._current_block_type: Dict[tuple, str] = {}
        # Track pending tool_use info per (sid, session_id) for streaming mode
        self._pending_tool_use: Dict[tuple, dict] = {}
        # BUG FIX: Use (sid, channel, session_id) as key to avoid conflicts
        # between Terminal and Chat mappings for the same session
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

        # Chat 事件
        @sio.on('chat:connect')
        async def handle_chat_connect(sid, data):
            import time as _t
            _recv_ts = _t.time()
            logger.info(f"[SocketIO] Received chat:connect from {sid[:8]}, data={data}, recv_ts={_recv_ts:.3f}")
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

                # 清理 chat 回调
                if session_id in client.chat_callbacks:
                    session = chat_manager.get_session(session_id)
                    if session:
                        session.clear_callback(sid)

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

    async def send_to_client(self, sid: str, channel: str, msg_type: str, data: dict, session_id: str = None, _debug_tag: str = None):
        """发送消息给客户端。"""
        client = self.clients.get(sid)
        if not client or client.is_closed:
            return

        try:
            import time as _time
            event_name = f"{channel}:{msg_type}"
            payload = dict(data)
            if session_id:
                payload['session_id'] = session_id
            _t0 = _time.time()
            await sio.emit(event_name, payload, to=sid)
            _elapsed = (_time.time() - _t0) * 1000
            if _elapsed > 50 or _debug_tag:  # Log slow emits or tagged ones
                logger.info(f"[SocketIO] emit took {_elapsed:.0f}ms: {event_name} tag={_debug_tag}")
        except Exception as e:
            client.is_closed = True
            logger.warning(f"[SocketIO] Client {sid[:8]} send error: {e}")

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

            # 清理 chat 回调和消费者
            if session_id in client.chat_callbacks:
                session = chat_manager.get_session(session_id)
                if session:
                    session.clear_callback(sid)
                del client.chat_callbacks[session_id]

            if session_id in client.chat_consumer_tasks:
                client.chat_consumer_tasks[session_id].cancel()
                del client.chat_consumer_tasks[session_id]
            if session_id in client.chat_message_queues:
                del client.chat_message_queues[session_id]

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
                mapping_key = (sid, 'chat', session_id)
                mapped_id = self._session_id_mapping.get(mapping_key)

                # 2. 尝试从数据库获取持久化映射
                # BUG FIX: 使用 run_in_executor 避免 threading.Lock 阻塞事件循环
                # 当 _sync_history_to_db 在后台持有数据库锁时，同步调用会阻塞整个事件循环
                if not mapped_id:
                    loop = asyncio.get_event_loop()
                    mapped_id = await loop.run_in_executor(None, db.get_chat_session_id, session_id)
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
            import time as _time
            _t0 = _time.time()
            logger.info(f"[SocketIO] Chat connect START: session_id={session_id[:8] if session_id else 'None'}, workDir={working_dir[:30]}...")

            # 幂等性检查：如果该 session 已有回调注册，说明已连接
            # 但仍需发送历史消息，因为前端可能已丢失状态（页面刷新、返回等）
            # FIX: 不再跳过，而是继续处理以重新发送历史
            is_reconnect = session_id and session_id in client.chat_callbacks
            if is_reconnect:
                logger.info(f"[SocketIO] Chat connect reconnect: session={session_id[:8]}, will re-send history")

            session = chat_manager.get_session(session_id) if self._is_valid_uuid(session_id) else None
            logger.info(f"[SocketIO] Chat connect T1 get_session: {(_time.time()-_t0)*1000:.0f}ms, found={session is not None}")

            if not session:
                import uuid as uuid_module
                # 如果 session_id 已经是 UUID（即找到了映射），直接使用它
                # 否则生成新的 UUID
                if not self._is_valid_uuid(session_id):
                    session_id = str(uuid_module.uuid4())

                logger.info(f"[SocketIO] Creating new chat session: {session_id[:8]}, T1.1: {(_time.time()-_t0)*1000:.0f}ms")
                # create_session returns session_id, need to get the session object
                created_session_id = await chat_manager.create_session(
                    session_id=session_id,
                    working_dir=working_dir,
                    resume_session_id=resume
                )
                logger.info(f"[SocketIO] Session created: {created_session_id[:8] if created_session_id else 'None'}, T1.2: {(_time.time()-_t0)*1000:.0f}ms")
                session = chat_manager.get_session(created_session_id)
                logger.info(f"[SocketIO] Got session object: {session is not None}, T1.3: {(_time.time()-_t0)*1000:.0f}ms")

                if original_session_id and original_session_id != session_id:
                    mapping_key = (sid, 'chat', original_session_id)
                    self._session_id_mapping[mapping_key] = session_id
                    logger.info(f"[SocketIO] Stored chat UUID mapping: '{original_session_id[:8]}' -> {session_id[:8]}")

                # Save persistent mapping in DB (allow any non-empty ID)
                # Use run_in_executor to avoid blocking event loop
                if original_session_id and session_id:
                     try:
                         _t_db = _time.time()
                         loop = asyncio.get_event_loop()
                         await loop.run_in_executor(None, lambda: db.set_chat_session_id(original_session_id, session_id))
                         logger.info(f"[SocketIO] DB set_chat_session_id: {(_time.time()-_t_db)*1000:.0f}ms")
                     except Exception as e:
                         logger.error(f"[SocketIO] Failed to save session mapping: {e}")

            logger.info(f"[SocketIO] Chat connect T2 session_ready: {(_time.time()-_t0)*1000:.0f}ms")
            # 清理当前客户端的其他 session（用户切换 session 时）
            for old_session_id in list(client.chat_callbacks.keys()):
                if old_session_id != session_id:
                    old_session = chat_manager.get_session(old_session_id)
                    if old_session:
                        old_session.clear_callback(sid)
                    del client.chat_callbacks[old_session_id]
                    if old_session_id in client.chat_consumer_tasks:
                        client.chat_consumer_tasks[old_session_id].cancel()
                        del client.chat_consumer_tasks[old_session_id]
                    if old_session_id in client.chat_message_queues:
                        del client.chat_message_queues[old_session_id]
                    logger.info(f"[SocketIO] Switched session: sid={sid[:8]}, {old_session_id[:8]} -> {session_id[:8]}")

            # 清理同一个 session 的旧 consumer（重连时）
            if session_id in client.chat_consumer_tasks:
                logger.info(f"[SocketIO] Cancelling old consumer for reconnect: sid={sid[:8]}, session={session_id[:8]}")
                client.chat_consumer_tasks[session_id].cancel()
                del client.chat_consumer_tasks[session_id]
            if session_id in client.chat_message_queues:
                del client.chat_message_queues[session_id]

            # 设置消息队列和消费者
            message_queue: asyncio.Queue = asyncio.Queue()
            client.chat_message_queues[session_id] = message_queue

            async def chat_message_consumer():
                """消费消息队列，确保有序发送。"""
                logger.info(f"[SocketIO] Consumer started: sid={sid[:8]}, session={session_id[:8]}")
                try:
                    while True:
                        msg = await message_queue.get()
                        c = self.clients.get(sid)
                        if not c or c.is_closed:
                            logger.warning(f"[SocketIO] Consumer stopping: client gone")
                            break
                        await self._send_chat_message(sid, session_id, msg)
                        message_queue.task_done()
                except asyncio.CancelledError:
                    logger.info(f"[SocketIO] Consumer cancelled: sid={sid[:8]}, session={session_id[:8]}")
                except Exception as e:
                    logger.error(f"[SocketIO] Consumer error: sid={sid[:8]}, session={session_id[:8]}, error={e}")

            consumer_task = asyncio.create_task(chat_message_consumer())
            client.chat_consumer_tasks[session_id] = consumer_task

            # 创建 callback 并注册到 session
            # set_callback 会自动处理旧 callback（覆盖）
            def chat_callback(msg: ChatMessage, q=message_queue, sid_for_log=sid, sess_id_for_log=session_id):
                try:
                    if msg.type not in ('stream_event', 'stream'):
                        logger.info(f"[SocketIO] Callback: sid={sid_for_log[:8]}, session={sess_id_for_log[:8]}, type={msg.type}")
                    q.put_nowait(msg)
                except Exception as e:
                    logger.warning(f"[SocketIO] Callback error: {e}")

            if session:
                session.set_callback(chat_callback, owner=sid)
            client.chat_callbacks[session_id] = chat_callback

            await self.subscribe(sid, session_id)
            logger.info(f"[SocketIO] Chat connect T3 callback_set: {(_time.time()-_t0)*1000:.0f}ms")

            # 获取历史消息
            # 优先使用 resume_session_id（恢复会话时），否则使用 _claude_session_id
            claude_sid = getattr(session, 'resume_session_id', None) or getattr(session, '_claude_session_id', None)
            history = []
            total_count = 0
            if claude_sid:
                # 获取最近的消息（按时间降序），然后反转为升序发送
                # 使用 run_in_executor 避免数据库 threading.Lock 阻塞事件循环
                loop = asyncio.get_event_loop()
                _t_db1 = _time.time()
                history_desc = await loop.run_in_executor(None, lambda: db.get_chat_messages_desc(claude_sid, limit=30))
                logger.info(f"[SocketIO] DB get_chat_messages_desc: {(_time.time()-_t_db1)*1000:.0f}ms, rows={len(history_desc)}")
                history = list(reversed(history_desc))  # 反转为时间升序
                _t_db2 = _time.time()
                total_count = await loop.run_in_executor(None, lambda: db.get_chat_message_count(claude_sid))
                logger.info(f"[SocketIO] DB get_chat_message_count: {(_time.time()-_t_db2)*1000:.0f}ms, count={total_count}")
                logger.info(f"[SocketIO] Loaded {len(history)}/{total_count} history messages for {claude_sid[:8]}")

            logger.info(f"[SocketIO] Chat connect T4 history_loaded: {(_time.time()-_t0)*1000:.0f}ms")
            # 发送 ready 事件（必须在 history 之前，以便前端完成 handler 映射）
            _t_emit1 = _time.time()
            await self.send_to_client(sid, "chat", "ready", {
                "working_dir": working_dir,
                "original_session_id": original_session_id,
                "history_count": total_count,
                "claude_session_id": claude_sid,
                "server_ts": _t_emit1 * 1000  # milliseconds since epoch for frontend comparison
            }, session_id, _debug_tag="connect_ready")
            logger.info(f"[SocketIO] Chat connect T5 ready_sent: {(_time.time()-_t0)*1000:.0f}ms, emit took {(_time.time()-_t_emit1)*1000:.0f}ms")

            # 发送历史消息（逐条发送，前端已有处理逻辑）
            for msg in history:
                msg_role = msg.get("role", "assistant")

                if msg_role == "tool_result":
                    # Send tool_result in the format frontend expects
                    extra = msg.get("extra", {}) or {}
                    msg_data = {
                        "tool_id": extra.get("tool_use_id", ""),
                        "content": msg.get("content", ""),
                        "stdout": msg.get("content", ""),
                        "stderr": extra.get("stderr", ""),
                        "is_error": extra.get("is_error", False),
                        "timestamp": msg.get("timestamp"),
                    }
                    await self.send_to_client(sid, "chat", "tool_result", msg_data, session_id)
                else:
                    msg_data = {
                        "type": msg_role,
                        "content": msg.get("content", ""),
                        "timestamp": msg.get("timestamp"),
                    }
                    if msg.get("extra"):
                        msg_data["extra"] = msg.get("extra")
                    await self.send_to_client(sid, "chat", msg_role, msg_data, session_id)

            logger.info(f"[SocketIO] Chat connect T6 history_sent: {(_time.time()-_t0)*1000:.0f}ms")
            _t_emit3 = _time.time()
            await self.send_to_client(sid, "chat", "history_end", {
                "count": len(history),
                "total": total_count
            }, session_id)
            logger.info(f"[SocketIO] history_end emit took {(_time.time()-_t_emit3)*1000:.0f}ms")
            logger.info(f"[SocketIO] Chat connect DONE: {(_time.time()-_t0)*1000:.0f}ms total")

        elif msg_type == "disconnect":
            await self.unsubscribe(sid, session_id)

        elif msg_type == "message":
            content = data.get("content", "")
            logger.info(f"[SocketIO] Chat message received: sid={sid[:8]}, session={session_id[:8] if session_id else 'None'}, content={content[:30] if content else 'None'}...")
            if content and session_id:
                # BUG FIX: 先查找映射的 session ID（使用 chat channel 前缀）
                # 前端发送的是 originalSessionId，需要转换为后端存储的 UUID
                real_session_id = self._session_id_mapping.get((sid, 'chat', session_id), session_id)
                if real_session_id != session_id:
                    logger.info(f"[SocketIO] Chat message using mapped session: {session_id[:8]} -> {real_session_id[:8]}")

                session = chat_manager.get_session(real_session_id)

                # 如果找不到，尝试用 session_id 作为 resume_session_id 查找
                if not session:
                    for sess_id, sess in chat_manager._sessions.items():
                        if getattr(sess, 'resume_session_id', None) == session_id:
                            session = sess
                            real_session_id = sess_id
                            logger.info(f"[SocketIO] Found session via resume_session_id: {real_session_id[:8]}")
                            break

                logger.info(f"[SocketIO] Session found: {session is not None}, active sessions: {list(chat_manager._sessions.keys())[:5]}")
                if session:
                    # 检查当前客户端是否已注册 callback，如果没有则需要先 connect
                    if real_session_id not in client.chat_callbacks:
                        logger.warning(f"[SocketIO] Client {sid[:8]} has no callback for session {real_session_id[:8]}, auto-connecting...")
                        # 自动触发 connect 流程
                        await self._handle_chat_message(sid, session_id, 'connect', {
                            'session_id': session_id,
                            'working_dir': getattr(session, 'working_dir', '/'),
                        })

                    # 发送用户确认
                    await self.send_to_client(sid, "chat", "user_ack", {
                        "content": content
                    }, session_id)

                    # 异步处理消息（使用 real_session_id）
                    asyncio.create_task(self._process_chat_message(sid, real_session_id, content))
                else:
                    # BUG FIX: 如果 session 不存在，发送错误消息
                    logger.warning(f"[SocketIO] Session not found for message: {session_id[:8]}")
                    await self.send_to_client(sid, "chat", "error", {
                        "message": f"Session not found: {session_id[:8]}"
                    }, session_id)

        elif msg_type == "load_more_history":
            # Frontend sends before_index (the oldest message index it has)
            # We need to load messages older than that
            before_index = data.get("before_index", 0)
            limit = data.get("limit", 50)
            if session_id:
                # 使用 chat channel 前缀查找映射
                real_session_id = self._session_id_mapping.get((sid, 'chat', session_id), session_id)
                session = chat_manager.get_session(real_session_id)
                if session:
                    claude_sid = getattr(session, 'resume_session_id', None) or getattr(session, '_claude_session_id', None)
                    if claude_sid:
                        # Get total count to calculate offset
                        # BUG FIX: 使用 run_in_executor 避免阻塞事件循环
                        loop = asyncio.get_event_loop()
                        total_count = await loop.run_in_executor(None, db.get_chat_message_count, claude_sid)
                        # before_index is the oldest message index frontend has
                        # offset = total - before_index (skip already loaded messages)
                        offset = max(0, total_count - before_index)
                        history_desc = await loop.run_in_executor(
                            None, lambda: db.get_chat_messages_desc(claude_sid, limit=limit, offset=offset)
                        )
                        history = list(reversed(history_desc))  # 反转为时间升序
                        for msg in history:
                            msg_role = msg.get("role", "assistant")

                            if msg_role == "tool_result":
                                extra = msg.get("extra", {}) or {}
                                msg_data = {
                                    "tool_id": extra.get("tool_use_id", ""),
                                    "content": msg.get("content", ""),
                                    "stdout": msg.get("content", ""),
                                    "stderr": extra.get("stderr", ""),
                                    "is_error": extra.get("is_error", False),
                                    "timestamp": msg.get("timestamp"),
                                }
                                await self.send_to_client(sid, "chat", "tool_result", msg_data, real_session_id)
                            else:
                                msg_data = {
                                    "type": msg_role,
                                    "content": msg.get("content", ""),
                                    "timestamp": msg.get("timestamp"),
                                }
                                if msg.get("extra"):
                                    msg_data["extra"] = msg.get("extra")
                                await self.send_to_client(sid, "chat", msg_role, msg_data, real_session_id)

                        # Calculate new oldest_index and has_more
                        new_oldest_index = max(0, before_index - len(history))
                        has_more = new_oldest_index > 0
                        await self.send_to_client(sid, "chat", "history_page_end", {
                            "oldest_index": new_oldest_index,
                            "has_more": has_more,
                            "count": len(history)
                        }, real_session_id)

        elif msg_type == "close":
            if session_id:
                # 使用 chat channel 前缀查找映射
                real_session_id = self._session_id_mapping.get((sid, 'chat', session_id), session_id)
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
            error_msg = str(e)
            logger.error(f"[SocketIO] Chat message error: {error_msg}", exc_info=True)
            # BUG FIX: 确保错误消息被发送到前端
            logger.info(f"[SocketIO] Sending error to client {sid[:8]}: {error_msg[:50]}")
            await self.send_to_client(sid, "chat", "error", {
                "message": error_msg
            }, session_id)

    async def _send_chat_message(self, sid: str, session_id: str, msg: ChatMessage):
        """发送 Chat 消息到客户端，解析 Claude 的原始 JSON 响应。"""
        content = msg.content
        if not isinstance(content, dict):
            logger.warning(f"[SocketIO] _send_chat_message: content is not dict, type={type(content).__name__}, value={str(content)[:100]}")
            return

        msg_type = content.get("type")
        logger.debug(f"[SocketIO] _send_chat_message: msg_type={msg_type}, content_keys={list(content.keys())}")

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
            logger.debug(f"[SocketIO] result type: {type(result).__name__}, value={str(result)[:200]}")
            if not isinstance(result, dict):
                logger.warning(f"[SocketIO] result is not dict, skipping")
                return
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

    async def _is_client_connected(self, sid: str) -> bool:
        """Check if a Socket.IO client is still connected."""
        try:
            # Check if sid is in the connected clients of the sio server
            # Note: sio.manager.rooms maps room names to sets of sids
            # Each sid is automatically joined to a room with its own name
            return sid in sio.manager.rooms.get(sid, set()) or sid in self.clients
        except Exception:
            return False

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
