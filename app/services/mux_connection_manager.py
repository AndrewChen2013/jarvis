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
WebSocket Multiplexing Connection Manager

Provides a single WebSocket connection that can handle multiple Terminal and Chat
sessions, reducing connection overhead and improving mobile compatibility.

Optimized Message Format (v2):
    {
        "c": 0|1|2,      # channel: 0=terminal, 1=chat, 2=system
        "s": "uuid",     # session_id (omitted for system channel)
        "t": 0-15,       # type code (see MSG_TYPES below)
        "d": {...}       # data payload
    }

Legacy Format (v1, still supported for parsing):
    {
        "channel": "terminal" | "chat",
        "session_id": "uuid",
        "type": "...",
        "data": {...}
    }
"""

import asyncio
import json
import msgpack
import hmac
import uuid
from typing import Dict, Set, Optional, Callable, Any
from dataclasses import dataclass, field
from datetime import datetime, timezone
from fastapi import WebSocket, WebSocketDisconnect

from app.core.logging import logger
from app.core.config import settings
from app.services.terminal_manager import terminal_manager, Terminal
from app.services.chat_session_manager import chat_manager, ChatMessage


# ============================================================================
# Optimized Message Protocol Constants (v2)
# ============================================================================

# Channel codes (c field)
CH_TERMINAL = 0
CH_CHAT = 1
CH_SYSTEM = 2

# Channel name to code mapping
CHANNEL_CODES = {
    "terminal": CH_TERMINAL,
    "chat": CH_CHAT,
    "system": CH_SYSTEM,
}

# Message type codes (t field) - grouped by channel
# Terminal types (0-9)
MT_TERM_CONNECTED = 0
MT_TERM_OUTPUT = 1
MT_TERM_ERROR = 2
MT_TERM_CLOSED = 3

# Chat types (0-19)
MT_CHAT_READY = 0
MT_CHAT_STREAM = 1
MT_CHAT_ASSISTANT = 2
MT_CHAT_USER = 3
MT_CHAT_TOOL_CALL = 4
MT_CHAT_TOOL_RESULT = 5
MT_CHAT_THINKING_START = 6
MT_CHAT_THINKING_DELTA = 7
MT_CHAT_THINKING_END = 8
MT_CHAT_THINKING = 9
MT_CHAT_SYSTEM = 10
MT_CHAT_RESULT = 11
MT_CHAT_ERROR = 12
MT_CHAT_USER_ACK = 13
MT_CHAT_HISTORY_END = 14

# System types (0-9)
MT_SYS_AUTH_SUCCESS = 0
MT_SYS_AUTH_FAILED = 1
MT_SYS_PONG = 2

# Message type name to code mapping (per channel)
MSG_TYPE_CODES = {
    "terminal": {
        "connected": MT_TERM_CONNECTED,
        "output": MT_TERM_OUTPUT,
        "error": MT_TERM_ERROR,
        "closed": MT_TERM_CLOSED,
    },
    "chat": {
        "ready": MT_CHAT_READY,
        "stream": MT_CHAT_STREAM,
        "assistant": MT_CHAT_ASSISTANT,
        "user": MT_CHAT_USER,
        "tool_call": MT_CHAT_TOOL_CALL,
        "tool_result": MT_CHAT_TOOL_RESULT,
        "thinking_start": MT_CHAT_THINKING_START,
        "thinking_delta": MT_CHAT_THINKING_DELTA,
        "thinking_end": MT_CHAT_THINKING_END,
        "thinking": MT_CHAT_THINKING,
        "system": MT_CHAT_SYSTEM,
        "result": MT_CHAT_RESULT,
        "error": MT_CHAT_ERROR,
        "user_ack": MT_CHAT_USER_ACK,
        "history_end": MT_CHAT_HISTORY_END,
    },
    "system": {
        "auth_success": MT_SYS_AUTH_SUCCESS,
        "auth_failed": MT_SYS_AUTH_FAILED,
        "pong": MT_SYS_PONG,
    },
}


# Reverse mappings (code to name) for parsing incoming messages
CODE_TO_CHANNEL = {v: k for k, v in CHANNEL_CODES.items()}

# Reverse type mappings (code to name) for parsing
CODE_TO_MSG_TYPE = {
    "terminal": {v: k for k, v in MSG_TYPE_CODES["terminal"].items()},
    "chat": {v: k for k, v in MSG_TYPE_CODES["chat"].items()},
    "system": {v: k for k, v in MSG_TYPE_CODES["system"].items()},
}


def _unpack_message(message: dict) -> tuple:
    """Unpack a message, supporting both old and new formats.

    Returns: (channel, session_id, msg_type, data)
    """
    # Check if it's new format (has 'c' key) or old format (has 'channel' key)
    if "c" in message:
        # New optimized format
        ch_code = message.get("c", CH_SYSTEM)
        channel = CODE_TO_CHANNEL.get(ch_code, "system")
        session_id = message.get("s")
        t_code = message.get("t", "")
        # Convert type code to name if it's numeric
        if isinstance(t_code, int):
            type_map = CODE_TO_MSG_TYPE.get(channel, {})
            msg_type = type_map.get(t_code, str(t_code))
        else:
            msg_type = t_code
        data = message.get("d", {})
    else:
        # Old format
        channel = message.get("channel", "")
        session_id = message.get("session_id")
        msg_type = message.get("type", "")
        data = message.get("data", {})

    return channel, session_id, msg_type, data


def _pack_message(channel: str, session_id: Optional[str], msg_type: str, data: Any) -> dict:
    """Pack a message using optimized format (v2)."""
    ch_code = CHANNEL_CODES.get(channel, CH_SYSTEM)
    type_codes = MSG_TYPE_CODES.get(channel, {})
    t_code = type_codes.get(msg_type, msg_type)  # Fallback to string if not mapped

    msg = {
        "c": ch_code,
        "t": t_code,
        "d": data,
    }

    # Only include session_id for non-system channels
    if session_id and channel != "system":
        msg["s"] = session_id

    return msg


def _utc_now() -> datetime:
    """Return current UTC time as timezone-aware datetime."""
    return datetime.now(timezone.utc)


@dataclass
class MuxClient:
    """Represents a multiplexed client connection."""
    client_id: str
    websocket: WebSocket
    # BUG FIX: Use UTC-aware datetime for consistent comparison
    connected_at: datetime = field(default_factory=_utc_now)
    subscriptions: Set[str] = field(default_factory=set)  # session_ids
    authenticated: bool = False
    is_closed: bool = False  # Track if connection is closing/closed to avoid sending to dead connections
    # Track terminal output callbacks for cleanup
    terminal_callbacks: Dict[str, Callable] = field(default_factory=dict)
    # Track chat output callbacks for cleanup
    chat_callbacks: Dict[str, Callable] = field(default_factory=dict)


class MuxConnectionManager:
    """
    Manages multiplexed WebSocket connections.

    A single client connection can subscribe to multiple Terminal/Chat sessions.
    Messages are routed based on channel and session_id.
    """

    def __init__(self):
        # client_id -> MuxClient
        self.clients: Dict[str, MuxClient] = {}
        # session_id -> set of client_ids (for broadcasting)
        self.session_subscribers: Dict[str, Set[str]] = {}
        self._lock = asyncio.Lock()
        # Track current content block type per (client_id, session_id) for proper content_block_stop handling
        # BUG FIX: This prevents sending wrong message type on content_block_stop
        self._current_block_type: Dict[tuple, str] = {}

    async def connect(self, client_id: str, websocket: WebSocket) -> MuxClient:
        """Register a new client connection."""
        async with self._lock:
            client = MuxClient(
                client_id=client_id,
                websocket=websocket
            )
            self.clients[client_id] = client
            logger.info(f"[Mux] Client {client_id[:8]} connected")
            return client

    async def disconnect(self, client_id: str):
        """Cleanup when a client disconnects."""
        async with self._lock:
            client = self.clients.pop(client_id, None)
            if not client:
                return

            # Mark as closed immediately to prevent any pending sends
            client.is_closed = True

            # Remove from all session subscriptions
            for session_id in client.subscriptions:
                if session_id in self.session_subscribers:
                    self.session_subscribers[session_id].discard(client_id)
                    if not self.session_subscribers[session_id]:
                        del self.session_subscribers[session_id]

                # Cleanup terminal callbacks
                if session_id in client.terminal_callbacks:
                    terminal = await terminal_manager.get_terminal(session_id)
                    if terminal:
                        terminal.remove_output_callback(client.terminal_callbacks[session_id])
                        terminal_manager.decrement_websocket_count(session_id)

                # Cleanup chat callbacks
                if session_id in client.chat_callbacks:
                    session = chat_manager.get_session(session_id)
                    if session:
                        session.remove_callback(client.chat_callbacks[session_id])

            logger.info(f"[Mux] Client {client_id[:8]} disconnected, cleaned up {len(client.subscriptions)} subscriptions")

    async def subscribe(self, client_id: str, session_id: str, channel: str):
        """Subscribe a client to a session."""
        async with self._lock:
            client = self.clients.get(client_id)
            if not client:
                return False

            client.subscriptions.add(session_id)

            if session_id not in self.session_subscribers:
                self.session_subscribers[session_id] = set()
            self.session_subscribers[session_id].add(client_id)

            logger.debug(f"[Mux] Client {client_id[:8]} subscribed to {channel}:{session_id[:8]}")
            return True

    async def unsubscribe(self, client_id: str, session_id: str):
        """Unsubscribe a client from a session."""
        async with self._lock:
            client = self.clients.get(client_id)
            if not client:
                return

            client.subscriptions.discard(session_id)

            if session_id in self.session_subscribers:
                self.session_subscribers[session_id].discard(client_id)
                if not self.session_subscribers[session_id]:
                    del self.session_subscribers[session_id]

            # Cleanup terminal callback if exists
            if session_id in client.terminal_callbacks:
                terminal = await terminal_manager.get_terminal(session_id)
                if terminal:
                    terminal.remove_output_callback(client.terminal_callbacks[session_id])
                    terminal_manager.decrement_websocket_count(session_id)
                del client.terminal_callbacks[session_id]

            # Cleanup chat callback if exists
            if session_id in client.chat_callbacks:
                session = chat_manager.get_session(session_id)
                if session:
                    session.remove_callback(client.chat_callbacks[session_id])
                del client.chat_callbacks[session_id]

            logger.debug(f"[Mux] Client {client_id[:8]} unsubscribed from {session_id[:8]}")

    async def send_to_client(self, client_id: str, message: dict):
        """Send a message to a specific client using optimized format (v2).

        Accepts either old format (channel/session_id/type/data) or new format (c/s/t/d).
        Automatically converts to optimized format before sending.
        """
        client = self.clients.get(client_id)
        if not client or client.is_closed:
            return

        try:
            # Convert old format to new format if needed
            if "channel" in message:
                # Old format - convert to optimized format
                optimized = _pack_message(
                    channel=message.get("channel", "system"),
                    session_id=message.get("session_id"),
                    msg_type=message.get("type", ""),
                    data=message.get("data", {})
                )
            else:
                # Already in new format
                optimized = message

            packed = msgpack.packb(optimized, use_bin_type=True)
            await client.websocket.send_bytes(packed)
        except Exception as e:
            # Mark as closed on send error to prevent further attempts
            client.is_closed = True
            # BUG FIX: Include exception details in log for debugging
            logger.debug(f"[Mux] Client {client_id[:8]} connection closed: {e}")

    async def broadcast_to_session(self, session_id: str, channel: str, msg_type: str, data: Any):
        """Broadcast a message to all clients subscribed to a session."""
        subscribers = self.session_subscribers.get(session_id, set())

        message = {
            "channel": channel,
            "session_id": session_id,
            "type": msg_type,
            "data": data
        }

        # BUG FIX: Copy set before iteration to avoid "Set changed size during iteration"
        # This can happen when clients disconnect during broadcast
        for client_id in list(subscribers):
            await self.send_to_client(client_id, message)

    async def route_message(self, client_id: str, message: dict):
        """Route an incoming message to the appropriate handler.

        Supports both old format (channel/session_id/type/data) and
        optimized format (c/s/t/d).
        """
        # Unpack message (handles both formats)
        channel, session_id, msg_type, data = _unpack_message(message)

        if not channel or not msg_type:
            logger.warning(f"[Mux] Invalid message from {client_id[:8]}: missing channel or type")
            return

        if channel == "terminal":
            await self._handle_terminal_message(client_id, session_id, msg_type, data)
        elif channel == "chat":
            await self._handle_chat_message(client_id, session_id, msg_type, data)
        elif channel == "system":
            await self._handle_system_message(client_id, msg_type, data)
        else:
            logger.warning(f"[Mux] Unknown channel: {channel}")

    async def _handle_system_message(self, client_id: str, msg_type: str, data: dict):
        """Handle system-level messages (auth, ping, etc.)."""
        client = self.clients.get(client_id)
        if not client:
            return

        if msg_type == "auth":
            token = data.get("token", "")
            if hmac.compare_digest(token, settings.AUTH_TOKEN):
                client.authenticated = True
                await self.send_to_client(client_id, {
                    "channel": "system",
                    "type": "auth_success",
                    "data": {}
                })
                logger.info(f"[Mux] Client {client_id[:8]} authenticated")
            else:
                await self.send_to_client(client_id, {
                    "channel": "system",
                    "type": "auth_failed",
                    "data": {"reason": "Invalid token"}
                })
                logger.warning(f"[Mux] Client {client_id[:8]} auth failed")

        elif msg_type == "ping":
            await self.send_to_client(client_id, {
                "channel": "system",
                "type": "pong",
                "data": {}
            })

    async def _handle_terminal_message(self, client_id: str, session_id: str, msg_type: str, data: dict):
        """Handle terminal channel messages."""
        client = self.clients.get(client_id)
        if not client or not client.authenticated:
            return

        if msg_type == "connect":
            # Connect to or create a terminal session
            working_dir = data.get("working_dir", "")
            rows = data.get("rows", 40)
            cols = data.get("cols", 120)

            if not working_dir:
                await self.send_to_client(client_id, {
                    "channel": "terminal",
                    "session_id": session_id,
                    "type": "error",
                    "data": {"message": "working_dir required"}
                })
                return

            # Keep original session_id for the connected message
            original_session_id = session_id

            # Check if session_id is a valid UUID
            # Frontend sends temporary IDs like "new-1234", we need to generate real UUIDs
            actual_session_id = None
            if session_id:
                try:
                    uuid.UUID(session_id)
                    actual_session_id = session_id
                except (ValueError, TypeError):
                    # Not a valid UUID, will create a new session
                    logger.debug(f"[Mux] Non-UUID session_id '{session_id}', will generate new UUID")
                    actual_session_id = None

            # Check if terminal exists (only for valid UUIDs)
            terminal = None
            if actual_session_id:
                terminal = await terminal_manager.get_terminal(actual_session_id)

            if not terminal:
                # Create new terminal (pass None to let terminal_manager generate UUID)
                terminal = await terminal_manager.create_terminal(
                    working_dir=working_dir,
                    session_id=actual_session_id,
                    rows=rows,
                    cols=cols
                )
            # Update session_id to the actual terminal ID (may be newly generated)
            session_id = terminal.terminal_id

            # Subscribe to this terminal
            await self.subscribe(client_id, session_id, "terminal")

            # BUG FIX: Clean up old callback before registering new one
            # This prevents duplicate output when client reconnects
            if session_id in client.terminal_callbacks:
                old_callback = client.terminal_callbacks[session_id]
                terminal.remove_output_callback(old_callback)
                terminal_manager.decrement_websocket_count(session_id)
                logger.debug(f"[Mux] Removed old terminal callback for client {client_id[:8]} session {session_id[:8]}")

            # Setup output callback for this client
            # Use default parameter binding to capture current values
            async def output_callback(output_data: bytes, cid=client_id, sid=session_id):
                text = output_data.decode('utf-8', errors='replace')
                await self.send_to_client(cid, {
                    "channel": "terminal",
                    "session_id": sid,
                    "type": "output",
                    "data": {"text": text}
                })

            terminal.add_output_callback(output_callback)
            client.terminal_callbacks[session_id] = output_callback
            # BUG FIX: Move increment AFTER callback registration succeeds
            # to prevent count mismatch if registration fails
            terminal_manager.increment_websocket_count(session_id)

            # Send connected message with original_session_id so frontend can update its handler
            await self.send_to_client(client_id, {
                "channel": "terminal",
                "session_id": session_id,
                "type": "connected",
                "data": {
                    "terminal_id": session_id,
                    "original_session_id": original_session_id,
                    "pid": terminal.pid
                }
            })

            # Send history
            history = terminal.get_output_history()
            if history:
                text = history.decode('utf-8', errors='replace')
                await self.send_to_client(client_id, {
                    "channel": "terminal",
                    "session_id": session_id,
                    "type": "output",
                    "data": {"text": text}
                })

            logger.info(f"[Mux] Client {client_id[:8]} connected to terminal {session_id[:8]}")

        elif msg_type == "disconnect":
            # Disconnect from terminal (but don't close it)
            await self.unsubscribe(client_id, session_id)
            logger.info(f"[Mux] Client {client_id[:8]} disconnected from terminal {session_id[:8]}")

        elif msg_type == "input":
            # Write to terminal
            terminal = await terminal_manager.get_terminal(session_id)
            if terminal:
                input_data = data.get("text", "")
                await terminal_manager.write(session_id, input_data)

        elif msg_type == "resize":
            # Resize terminal
            terminal = await terminal_manager.get_terminal(session_id)
            if terminal:
                rows = data.get("rows", 40)
                cols = data.get("cols", 120)
                await terminal_manager.resize(session_id, rows, cols)

        elif msg_type == "close":
            # Close terminal
            await self.unsubscribe(client_id, session_id)
            await terminal_manager.close_terminal(session_id)
            logger.info(f"[Mux] Terminal {session_id[:8]} closed by client {client_id[:8]}")

    async def _handle_chat_message(self, client_id: str, session_id: str, msg_type: str, data: dict):
        """Handle chat channel messages."""
        client = self.clients.get(client_id)
        if not client or not client.authenticated:
            return

        if msg_type == "connect":
            # Connect to or create a chat session
            working_dir = data.get("working_dir", "")
            resume = data.get("resume")

            if not working_dir:
                await self.send_to_client(client_id, {
                    "channel": "chat",
                    "session_id": session_id,
                    "type": "error",
                    "data": {"message": "working_dir required"}
                })
                return

            # Keep original session_id for the ready message
            original_session_id = session_id

            # Check if session_id is a valid UUID
            actual_session_id = None
            if session_id:
                try:
                    uuid.UUID(session_id)
                    actual_session_id = session_id
                except (ValueError, TypeError):
                    # Not a valid UUID, generate new one
                    logger.debug(f"[Mux] Non-UUID session_id '{session_id}', generating new UUID")
                    actual_session_id = str(uuid.uuid4())
            else:
                actual_session_id = str(uuid.uuid4())

            session_id = actual_session_id or session_id

            # Check if session exists or create new one
            session = chat_manager.get_session(session_id)
            if not session:
                try:
                    await chat_manager.create_session(
                        working_dir=working_dir,
                        session_id=session_id,
                        resume_session_id=resume
                    )
                    session = chat_manager.get_session(session_id)
                except FileNotFoundError as e:
                    # Working directory doesn't exist - permanent error, don't retry
                    await self.send_to_client(client_id, {
                        "channel": "chat",
                        "session_id": original_session_id or session_id,
                        "type": "error",
                        "data": {
                            "message": str(e),
                            "permanent": True  # Tell frontend not to retry
                        }
                    })
                    return
                except Exception as e:
                    # Other errors - may be temporary
                    await self.send_to_client(client_id, {
                        "channel": "chat",
                        "session_id": original_session_id or session_id,
                        "type": "error",
                        "data": {"message": f"Failed to start session: {e}"}
                    })
                    return

            # BUG FIX: Check if session is valid after creation
            # This handles race conditions where client disconnects during session creation
            if not session:
                logger.warning(f"[Mux] Session {session_id[:8]} not found after creation, client may have disconnected")
                return

            # Also re-check if client is still connected (race condition protection)
            client = self.clients.get(client_id)
            if not client:
                logger.warning(f"[Mux] Client {client_id[:8]} disconnected during session setup")
                return

            # Subscribe to this chat session
            await self.subscribe(client_id, session_id, "chat")

            # BUG FIX: Clean up old callback before registering new one
            # This prevents duplicate message delivery when client reconnects
            if session_id in client.chat_callbacks:
                old_callback = client.chat_callbacks[session_id]
                session.remove_callback(old_callback)
                logger.debug(f"[Mux] Removed old callback for client {client_id[:8]} session {session_id[:8]}")

            # Setup callback for this specific client to ensure broadcasting
            # Use default parameter binding to capture current values and avoid closure issues
            def chat_callback(msg: ChatMessage, cid=client_id, sid=session_id):
                # Create a task to forward the message asynchronously
                asyncio.create_task(self._forward_chat_message(cid, sid, msg))

            session.add_callback(chat_callback)
            client.chat_callbacks[session_id] = chat_callback

            # Send ready with history count and original_session_id for handler remapping
            history = session.get_history()
            logger.info(f"[Mux] Sending ready: session_id={session_id[:8]}, original={original_session_id[:8] if original_session_id else 'None'}")
            await self.send_to_client(client_id, {
                "channel": "chat",
                "session_id": session_id,
                "type": "ready",
                "data": {
                    "working_dir": session.working_dir,
                    "original_session_id": original_session_id,
                    "history_count": len(history)
                }
            })

            # Send message history (limit to initial small batch for speed)
            MAX_INITIAL_HISTORY = 15
            if history:
                total_count = len(history)
                if total_count > MAX_INITIAL_HISTORY:
                    # Only send the most recent N messages initially
                    history = history[-MAX_INITIAL_HISTORY:]
                    logger.info(f"[Mux] Limiting initial history from {total_count} to {len(history)} messages")

                logger.info(f"[Mux] Sending {len(history)} initial history messages to client {client_id[:8]}")
                for msg in history:
                    await self._forward_chat_message(client_id, session_id, msg)

                # Send history_end marker with total count so frontend knows there is more
                await self.send_to_client(client_id, {
                    "channel": "chat",
                    "session_id": session_id,
                    "type": "history_end",
                    "data": {
                        "count": len(history),
                        "total": total_count,
                        "has_more": total_count > MAX_INITIAL_HISTORY,
                        "oldest_index": total_count - MAX_INITIAL_HISTORY if total_count > MAX_INITIAL_HISTORY else 0
                    }
                })

            logger.info(f"[Mux] Client {client_id[:8]} connected to chat {session_id[:8]}")

        elif msg_type == "disconnect":
            await self.unsubscribe(client_id, session_id)
            logger.info(f"[Mux] Client {client_id[:8]} disconnected from chat {session_id[:8]}")

        elif msg_type == "message":
            # Send message to chat session
            session = chat_manager.get_session(session_id)
            if not session:
                await self.send_to_client(client_id, {
                    "channel": "chat",
                    "session_id": session_id,
                    "type": "error",
                    "data": {"message": "Session not found"}
                })
                return

            content = data.get("content", "").strip()
            if not content:
                return

            # Send user ack
            await self.send_to_client(client_id, {
                "channel": "chat",
                "session_id": session_id,
                "type": "user_ack",
                "data": {"content": content}
            })

            # Process message - responses will be handled by the chat_callback/broadcast mechanism
            # We wrap this in a task so it doesn't block the Mux router
            asyncio.create_task(self._process_chat_message(session, content))

        elif msg_type == "load_more_history":
            # Load more history (pagination)
            session = chat_manager.get_session(session_id)
            if not session:
                return

            before_index = data.get("before_index", 0)
            limit = min(data.get("limit", 50), 100)  # Cap at 100

            messages, has_more = session.get_history_page(before_index, limit)

            if messages:
                for msg in messages:
                    await self._forward_chat_message(client_id, session_id, msg)

            # Send history_page_end marker
            await self.send_to_client(client_id, {
                "channel": "chat",
                "session_id": session_id,
                "type": "history_page_end",
                "data": {
                    "count": len(messages),
                    "has_more": has_more,
                    "oldest_index": before_index - len(messages) if messages else before_index
                }
            })

        elif msg_type == "close":
            await self.unsubscribe(client_id, session_id)
            await chat_manager.close_session(session_id)
            logger.info(f"[Mux] Chat {session_id[:8]} closed by client {client_id[:8]}")

    async def _process_chat_message(self, session, content: str):
        """Helper to process chat message without blocking the router."""
        try:
            # BUG FIX: Check if session is still valid before processing
            # This prevents race condition where session is closed between get and use
            if not session or not session.is_running:
                logger.warning("Session no longer running, skipping message processing")
                return
            async for _ in session.send_message(content):
                # We just consume the generator to keep the session alive and busy
                # The actual messages are forwarded via the chat_callback
                pass
        except Exception as e:
            # BUG FIX: Use logger.exception() to include full stack trace for debugging
            logger.exception(f"Error processing chat message: {e}")

    async def _forward_chat_message(self, client_id: str, session_id: str, msg: ChatMessage):
        """Forward a chat message to the client in the appropriate format."""
        content = msg.content
        if not isinstance(content, dict):
            return

        msg_type = content.get("type")

        if msg_type == "system":
            await self.send_to_client(client_id, {
                "channel": "chat",
                "session_id": session_id,
                "type": "system",
                "data": {
                    "session_id": content.get("session_id"),
                    "model": content.get("model"),
                    "tools": content.get("tools", [])
                }
            })

        elif msg_type == "stream_event":
            event = content.get("event", {})
            event_type = event.get("type")
            block_key = (client_id, session_id)

            # Handle content block start (track block type for proper stop handling)
            if event_type == "content_block_start":
                block = event.get("content_block", {})
                block_type = block.get("type")
                # BUG FIX: Track current block type to send correct message on stop
                self._current_block_type[block_key] = block_type
                if block_type == "thinking":
                    await self.send_to_client(client_id, {
                        "channel": "chat",
                        "session_id": session_id,
                        "type": "thinking_start",
                        "data": {}
                    })

            # Handle content block delta (streaming text or thinking)
            elif event_type == "content_block_delta":
                delta = event.get("delta", {})
                delta_type = delta.get("type")

                if delta_type == "text_delta":
                    await self.send_to_client(client_id, {
                        "channel": "chat",
                        "session_id": session_id,
                        "type": "stream",
                        "data": {"text": delta.get("text", "")}
                    })
                elif delta_type == "thinking_delta":
                    await self.send_to_client(client_id, {
                        "channel": "chat",
                        "session_id": session_id,
                        "type": "thinking_delta",
                        "data": {"text": delta.get("thinking", "")}
                    })

            # Handle content block stop
            elif event_type == "content_block_stop":
                # BUG FIX: Only send thinking_end if the stopped block was a thinking block
                current_type = self._current_block_type.pop(block_key, None)
                if current_type == "thinking":
                    await self.send_to_client(client_id, {
                        "channel": "chat",
                        "session_id": session_id,
                        "type": "thinking_end",
                        "data": {}
                    })

        elif msg_type == "assistant":
            message = content.get("message", {})
            content_blocks = message.get("content", [])
            # Get timestamp if available
            timestamp = msg.timestamp.isoformat() if hasattr(msg, 'timestamp') else None

            # Handle string content directly (not a list)
            if isinstance(content_blocks, str):
                await self.send_to_client(client_id, {
                    "channel": "chat",
                    "session_id": session_id,
                    "type": "assistant",
                    "data": {"content": content_blocks, "timestamp": timestamp}
                })
            else:
                for block in content_blocks:
                    if not isinstance(block, dict):
                        # Handle string content directly
                        if isinstance(block, str):
                            await self.send_to_client(client_id, {
                                "channel": "chat",
                                "session_id": session_id,
                                "type": "assistant",
                                "data": {"content": block, "timestamp": timestamp}
                            })
                        continue
                    block_type = block.get("type")
                    if block_type == "text":
                        await self.send_to_client(client_id, {
                            "channel": "chat",
                            "session_id": session_id,
                            "type": "assistant",
                            "data": {"content": block.get("text", ""), "timestamp": timestamp}
                        })
                    elif block_type == "tool_use":
                        await self.send_to_client(client_id, {
                            "channel": "chat",
                            "session_id": session_id,
                            "type": "tool_call",
                            "data": {
                                "tool_name": block.get("name"),
                                "tool_id": block.get("id"),
                                "input": block.get("input", {}),
                                "timestamp": timestamp
                            }
                        })
                    elif block_type == "thinking":
                        # Complete thinking block
                        await self.send_to_client(client_id, {
                            "channel": "chat",
                            "session_id": session_id,
                            "type": "thinking",
                            "data": {
                                "content": block.get("thinking", ""),
                                "timestamp": timestamp
                            }
                        })

        elif msg_type == "user":
            message = content.get("message", {})
            content_blocks = message.get("content", [])
            # Get timestamp if available
            timestamp = msg.timestamp.isoformat() if hasattr(msg, 'timestamp') else None

            # Handle string content directly (not a list)
            if isinstance(content_blocks, str):
                await self.send_to_client(client_id, {
                    "channel": "chat",
                    "session_id": session_id,
                    "type": "user",
                    "data": {
                        "content": content_blocks,
                        "timestamp": timestamp
                    }
                })
            else:
                for block in content_blocks:
                    if not isinstance(block, dict):
                        # Handle string content (user's text message)
                        if isinstance(block, str):
                            await self.send_to_client(client_id, {
                                "channel": "chat",
                                "session_id": session_id,
                                "type": "user",
                                "data": {
                                    "content": block,
                                    "timestamp": timestamp
                                }
                            })
                        continue
                    block_type = block.get("type")
                    if block_type == "text":
                        # User's text message
                        await self.send_to_client(client_id, {
                            "channel": "chat",
                            "session_id": session_id,
                            "type": "user",
                            "data": {
                                "content": block.get("text", ""),
                                "timestamp": timestamp
                            }
                        })
                    elif block_type == "tool_result":
                        tool_result = content.get("tool_use_result", {})
                        # Handle case where tool_result might be a list or non-dict
                        stdout = ""
                        stderr = ""
                        if isinstance(tool_result, dict):
                            stdout = tool_result.get("stdout", "")
                            stderr = tool_result.get("stderr", "")
                        await self.send_to_client(client_id, {
                            "channel": "chat",
                            "session_id": session_id,
                            "type": "tool_result",
                            "data": {
                                "tool_id": block.get("tool_use_id"),
                                "content": block.get("content", ""),
                                "stdout": stdout,
                                "stderr": stderr,
                                "is_error": block.get("is_error", False)
                            }
                        })

        elif msg_type == "result":
            await self.send_to_client(client_id, {
                "channel": "chat",
                "session_id": session_id,
                "type": "result",
                "data": {
                    "success": content.get("subtype") == "success",
                    "duration_ms": content.get("duration_ms"),
                    "cost_usd": content.get("total_cost_usd"),
                    "usage": content.get("usage", {})
                }
            })

    def get_stats(self) -> dict:
        """Get connection statistics."""
        return {
            "connected_clients": len(self.clients),
            "active_sessions": len(self.session_subscribers),
            "clients": [
                {
                    "id": client_id[:8],
                    "subscriptions": len(client.subscriptions),
                    "authenticated": client.authenticated,
                    "connected_at": client.connected_at.isoformat()
                }
                for client_id, client in self.clients.items()
            ]
        }


# Global instance
mux_manager = MuxConnectionManager()
