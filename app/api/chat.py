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
Chat Mode WebSocket API

Provides a clean JSON-based interface for Chat mode,
using Claude CLI's stream-json format for structured communication.
"""

import json
import logging
import asyncio
from datetime import datetime
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from typing import Optional

from app.services.chat_session_manager import chat_manager, ChatMessage
from app.api.auth import verify_token

router = APIRouter()
logger = logging.getLogger(__name__)


@router.websocket("/ws/chat/{session_id}")
async def chat_websocket(
    websocket: WebSocket,
    session_id: str,
    token: Optional[str] = Query(None),
    working_dir: Optional[str] = Query(None),
    resume: Optional[str] = Query(None)  # Claude session ID to resume history
):
    """
    Chat mode WebSocket endpoint.

    Protocol:
        Client -> Server:
            {"type": "message", "content": "user message"}
            {"type": "ping"}

        Server -> Client:
            {"type": "system", "data": {...}}
            {"type": "stream", "text": "partial text"}
            {"type": "assistant", "content": "full message", "tool_name": null}
            {"type": "tool_call", "tool_name": "Bash", "content": "..."}
            {"type": "tool_result", "tool_name": "Bash", "content": "..."}
            {"type": "result", "data": {...}}
            {"type": "error", "message": "..."}
            {"type": "pong"}
    """
    # Verify auth
    if not token or not verify_token(token):
        await websocket.close(code=4001, reason="Unauthorized")
        return

    await websocket.accept()
    logger.info(f"Chat WebSocket connected: {session_id}")

    session = None
    streaming_text = ""

    try:
        # Check if session exists or create new one
        session = chat_manager.get_session(session_id)
        if not session:
            if not working_dir:
                await websocket.send_json({
                    "type": "error",
                    "message": "working_dir required for new session"
                })
                await websocket.close()
                return

            # Normalize working_dir
            working_dir = working_dir.rstrip('/')

            await chat_manager.create_session(
                working_dir=working_dir,
                session_id=session_id,
                resume_session_id=resume
            )
            session = chat_manager.get_session(session_id)
            resume_info = f" (resuming {resume[:8]})" if resume else ""
            logger.info(f"Created new chat session: {session_id} in {working_dir}{resume_info}")

        # Send ready status
        await websocket.send_json({
            "type": "ready",
            "session_id": session_id,
            "working_dir": session.working_dir
        })

        # Main message loop
        while True:
            try:
                data = await websocket.receive_json()
                msg_type = data.get("type")

                if msg_type == "ping":
                    await websocket.send_json({"type": "pong"})
                    continue

                if msg_type == "message":
                    content = data.get("content", "").strip()
                    if not content:
                        continue

                    # Send user message acknowledgement
                    await websocket.send_json({
                        "type": "user_ack",
                        "content": content
                    })

                    streaming_text = ""

                    # Process message and stream responses
                    async for msg in session.send_message(content):
                        await handle_chat_message(websocket, msg)

            except WebSocketDisconnect:
                raise
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid JSON"
                })
            except Exception as e:
                logger.error(f"Error processing message: {e}")
                await websocket.send_json({
                    "type": "error",
                    "message": str(e)
                })

    except WebSocketDisconnect:
        logger.info(f"Chat WebSocket disconnected: {session_id}")
    except Exception as e:
        logger.error(f"Chat WebSocket error: {e}")
    finally:
        # Don't close the session - keep it alive for reconnection
        pass


async def handle_chat_message(websocket: WebSocket, msg: ChatMessage):
    """Process and send a chat message to the client."""
    data = msg.content

    if not isinstance(data, dict):
        return

    msg_type = data.get("type")

    if msg_type == "system":
        # System init message
        await websocket.send_json({
            "type": "system",
            "data": {
                "session_id": data.get("session_id"),
                "model": data.get("model"),
                "tools": data.get("tools", [])
            }
        })

    elif msg_type == "stream_event":
        # Streaming token
        event = data.get("event", {})
        event_type = event.get("type")

        if event_type == "content_block_delta":
            delta = event.get("delta", {})
            if delta.get("type") == "text_delta":
                text = delta.get("text", "")
                await websocket.send_json({
                    "type": "stream",
                    "text": text
                })

    elif msg_type == "assistant":
        # Complete assistant message
        message = data.get("message", {})
        content_blocks = message.get("content", [])

        for block in content_blocks:
            block_type = block.get("type")

            if block_type == "text":
                await websocket.send_json({
                    "type": "assistant",
                    "content": block.get("text", "")
                })

            elif block_type == "tool_use":
                await websocket.send_json({
                    "type": "tool_call",
                    "tool_name": block.get("name"),
                    "tool_id": block.get("id"),
                    "input": block.get("input", {}),
                    "timestamp": datetime.now().isoformat()
                })

    elif msg_type == "user":
        # Tool result
        message = data.get("message", {})
        content_blocks = message.get("content", [])

        for block in content_blocks:
            if block.get("type") == "tool_result":
                tool_result = data.get("tool_use_result", {})
                # Handle case where tool_result might be a list or non-dict
                stdout = ""
                stderr = ""
                if isinstance(tool_result, dict):
                    stdout = tool_result.get("stdout", "")
                    stderr = tool_result.get("stderr", "")
                await websocket.send_json({
                    "type": "tool_result",
                    "tool_id": block.get("tool_use_id"),
                    "content": block.get("content", ""),
                    "stdout": stdout,
                    "stderr": stderr,
                    "is_error": block.get("is_error", False),
                    "timestamp": datetime.now().isoformat()
                })

    elif msg_type == "result":
        # Final result
        await websocket.send_json({
            "type": "result",
            "success": data.get("subtype") == "success",
            "duration_ms": data.get("duration_ms"),
            "cost_usd": data.get("total_cost_usd"),
            "usage": data.get("usage", {})
        })

    elif msg_type == "progress":
        # Progress message (e.g., during /compact)
        await websocket.send_json({
            "type": "progress",
            "message": data.get("message", ""),
            "data": data
        })

    else:
        # Unknown message type - log and forward for debugging
        logger.debug(f"Unknown chat message type: {msg_type}, data: {data}")
        # Forward as system message so frontend can display it
        if msg_type:
            await websocket.send_json({
                "type": "system_info",
                "original_type": msg_type,
                "data": data
            })
