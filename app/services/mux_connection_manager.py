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

Message Format:
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
from datetime import datetime
from fastapi import WebSocket, WebSocketDisconnect

from app.core.logging import logger
from app.core.config import settings
from app.services.terminal_manager import terminal_manager, Terminal
from app.services.chat_session_manager import chat_manager, ChatMessage


@dataclass
class MuxClient:
    """Represents a multiplexed client connection."""
    client_id: str
    websocket: WebSocket
    connected_at: datetime = field(default_factory=datetime.now)
    subscriptions: Set[str] = field(default_factory=set)  # session_ids
    authenticated: bool = False
    # Track terminal output callbacks for cleanup
    terminal_callbacks: Dict[str, Callable] = field(default_factory=dict)


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

            logger.debug(f"[Mux] Client {client_id[:8]} unsubscribed from {session_id[:8]}")

    async def send_to_client(self, client_id: str, message: dict):
        """Send a message to a specific client."""
        client = self.clients.get(client_id)
        if not client:
            return

        try:
            packed = msgpack.packb(message, use_bin_type=True)
            await client.websocket.send_bytes(packed)
        except Exception as e:
            logger.error(f"[Mux] Failed to send to {client_id[:8]}: {e}")

    async def broadcast_to_session(self, session_id: str, channel: str, msg_type: str, data: Any):
        """Broadcast a message to all clients subscribed to a session."""
        subscribers = self.session_subscribers.get(session_id, set())

        message = {
            "channel": channel,
            "session_id": session_id,
            "type": msg_type,
            "data": data
        }

        for client_id in subscribers:
            await self.send_to_client(client_id, message)

    async def route_message(self, client_id: str, message: dict):
        """Route an incoming message to the appropriate handler."""
        channel = message.get("channel")
        session_id = message.get("session_id")
        msg_type = message.get("type")
        data = message.get("data", {})

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
            terminal_manager.increment_websocket_count(session_id)

            # Setup output callback for this client
            async def output_callback(output_data: bytes):
                text = output_data.decode('utf-8', errors='replace')
                await self.send_to_client(client_id, {
                    "channel": "terminal",
                    "session_id": session_id,
                    "type": "output",
                    "data": {"text": text}
                })

            terminal.add_output_callback(output_callback)
            client.terminal_callbacks[session_id] = output_callback

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

            session_id = actual_session_id

            # Check if session exists or create new one
            session = chat_manager.get_session(session_id)
            if not session:
                await chat_manager.create_session(
                    working_dir=working_dir,
                    session_id=session_id,
                    resume_session_id=resume
                )
                session = chat_manager.get_session(session_id)

            # Subscribe to this chat session
            await self.subscribe(client_id, session_id, "chat")

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

            # Send message history (limit to last 50 messages to avoid flooding)
            MAX_HISTORY_MESSAGES = 50
            if history:
                total_count = len(history)
                if total_count > MAX_HISTORY_MESSAGES:
                    history = history[-MAX_HISTORY_MESSAGES:]
                    logger.info(f"[Mux] Limiting history from {total_count} to {len(history)} messages")

                logger.info(f"[Mux] Sending {len(history)} history messages to client {client_id[:8]}")
                for msg in history:
                    await self._forward_chat_message(client_id, session_id, msg)

                # Send history_end marker
                await self.send_to_client(client_id, {
                    "channel": "chat",
                    "session_id": session_id,
                    "type": "history_end",
                    "data": {"count": len(history), "total": total_count}
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

            # Process message and stream responses
            async for msg in session.send_message(content):
                await self._forward_chat_message(client_id, session_id, msg)

        elif msg_type == "close":
            await self.unsubscribe(client_id, session_id)
            await chat_manager.close_session(session_id)
            logger.info(f"[Mux] Chat {session_id[:8]} closed by client {client_id[:8]}")

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
            if event_type == "content_block_delta":
                delta = event.get("delta", {})
                if delta.get("type") == "text_delta":
                    await self.send_to_client(client_id, {
                        "channel": "chat",
                        "session_id": session_id,
                        "type": "stream",
                        "data": {"text": delta.get("text", "")}
                    })

        elif msg_type == "assistant":
            message = content.get("message", {})
            content_blocks = message.get("content", [])
            # Get timestamp if available
            timestamp = msg.timestamp.isoformat() if hasattr(msg, 'timestamp') else None
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

        elif msg_type == "user":
            message = content.get("message", {})
            content_blocks = message.get("content", [])
            # Get timestamp if available
            timestamp = msg.timestamp.isoformat() if hasattr(msg, 'timestamp') else None
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
                    await self.send_to_client(client_id, {
                        "channel": "chat",
                        "session_id": session_id,
                        "type": "tool_result",
                        "data": {
                            "tool_id": block.get("tool_use_id"),
                            "content": block.get("content", ""),
                            "stdout": tool_result.get("stdout", ""),
                            "stderr": tool_result.get("stderr", ""),
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
