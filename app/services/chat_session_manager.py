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
Chat Session Manager - Manage Claude CLI sessions in stream-json mode.

This module provides a clean JSON-based interface to Claude CLI,
avoiding the complexity of PTY terminal parsing.

Architecture:
    Frontend (Chat UI)
        ↓ WebSocket (JSON messages)
    ChatSessionManager
        ↓ stdin/stdout (JSON stream)
    Claude CLI (-p --input-format stream-json --output-format stream-json)
"""

import asyncio
import json
import logging
import os
import shutil
from dataclasses import dataclass, field
from typing import AsyncIterator, Dict, Optional, Any, Callable, List
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class ChatMessage:
    """A structured chat message."""
    type: str  # system, assistant, user, result
    content: Any
    session_id: str
    timestamp: datetime = field(default_factory=datetime.now)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "type": self.type,
            "content": self.content,
            "session_id": self.session_id,
            "timestamp": self.timestamp.isoformat(),
            "metadata": self.metadata
        }


class ChatSession:
    """
    A single Claude CLI session running in stream-json mode.

    Manages the subprocess lifecycle and JSON message passing.
    """

    def __init__(
        self,
        session_id: str,
        working_dir: str,
        claude_path: Optional[str] = None,
        on_message: Optional[Callable[[ChatMessage], None]] = None,
        resume_session_id: Optional[str] = None  # Claude session ID to resume
    ):
        self.session_id = session_id
        # Normalize working_dir: remove trailing slash to ensure consistent path encoding
        self.working_dir = working_dir.rstrip('/') if working_dir else working_dir
        self.claude_path = claude_path or self._find_claude()
        self._callbacks: List[Callable[[ChatMessage], None]] = []
        if on_message:
            self._callbacks.append(on_message)
        self.resume_session_id = resume_session_id  # If set, will --resume this session

        self._process: Optional[asyncio.subprocess.Process] = None
        self._is_running = False
        self._is_busy = False
        self._reader_task: Optional[asyncio.Task] = None
        # BUG-014 FIX: Add maxsize to prevent unbounded queue growth
        self._message_queue: asyncio.Queue[ChatMessage] = asyncio.Queue(maxsize=1000)
        self._claude_session_id: Optional[str] = None  # Claude's internal session ID
        self._message_history: List[ChatMessage] = []  # Store message history for clients

    def _find_claude(self) -> str:
        """Find claude executable path."""
        # Check common locations
        possible_paths = [
            shutil.which("claude"),
            os.path.expanduser("~/.claude/local/claude"),
            "/usr/local/bin/claude",
        ]
        for path in possible_paths:
            if path and os.path.exists(path):
                return path
        raise FileNotFoundError("Claude CLI not found")

    async def start(self) -> bool:
        """Start the Claude CLI process."""
        if self._is_running:
            return True

        try:
            cmd = [
                self.claude_path,
                "-p",  # Print mode (non-interactive)
                "--input-format", "stream-json",
                "--output-format", "stream-json",
                "--verbose",
                "--include-partial-messages",  # Enable token-by-token streaming
                "--dangerously-skip-permissions",  # For automated use
            ]

            # If resuming an existing session, add --resume flag
            if self.resume_session_id:
                cmd.extend(["--resume", self.resume_session_id])
                logger.info(f"Chat session resuming from: {self.resume_session_id[:8]}...")

            self._process = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self.working_dir,
            )

            self._is_running = True
            self._reader_task = asyncio.create_task(self._read_output())

            # Load history from file if resuming
            await self.load_history_if_resume()

            logger.info(f"Chat session {self.session_id} started in {self.working_dir}")
            return True

        except Exception as e:
            logger.error(f"Failed to start chat session: {e}")
            return False

    async def _read_output(self):
        """Background task to read Claude's output."""
        if not self._process or not self._process.stdout:
            return

        try:
            while self._is_running:
                line = await self._process.stdout.readline()
                if not line:
                    break

                try:
                    data = json.loads(line.decode('utf-8').strip())
                    msg = ChatMessage(
                        type=data.get("type", "unknown"),
                        content=data,
                        session_id=self.session_id
                    )

                    # Extract Claude's session ID
                    if data.get("type") == "system" and data.get("subtype") == "init":
                        self._claude_session_id = data.get("session_id")

                    # Store in history (skip stream_event for cleaner history)
                    if data.get("type") != "stream_event":
                        self._message_history.append(msg)

                    # Notify all callbacks
                    for callback in self._callbacks:
                        try:
                            callback(msg)
                        except Exception as e:
                            logger.error(f"Error in chat callback: {e}")

                    # Queue for consumers
                    # BUG-014 FIX: Use put_nowait to avoid blocking, log warning if full
                    try:
                        self._message_queue.put_nowait(msg)
                    except asyncio.QueueFull:
                        logger.warning(f"Message queue full, dropping message: {msg.type}")

                    # Mark not busy when result received
                    if data.get("type") == "result":
                        self._is_busy = False

                except json.JSONDecodeError as e:
                    logger.warning(f"Failed to parse JSON: {line}, error: {e}")

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error reading output: {e}")
        finally:
            self._is_running = False

    async def send_message(self, content: str) -> AsyncIterator[ChatMessage]:
        """
        Send a message and yield responses.

        Args:
            content: User's message content

        Yields:
            ChatMessage objects as they arrive
        """
        if not self._is_running or not self._process or not self._process.stdin:
            raise RuntimeError("Session not running")

        if self._is_busy:
            raise RuntimeError("Session is busy processing another message")

        self._is_busy = True

        # Construct input message
        input_msg = {
            "type": "user",
            "message": {
                "role": "user",
                "content": content
            }
        }

        # Send to Claude
        # BUG-013 FIX: Use try/except to ensure _is_busy is reset on error
        try:
            line = json.dumps(input_msg) + "\n"
            self._process.stdin.write(line.encode('utf-8'))
            await self._process.stdin.drain()
        except Exception as e:
            self._is_busy = False
            logger.error(f"Failed to send message: {e}")
            raise RuntimeError(f"Failed to send message: {e}")

        # Yield messages until result
        while True:
            try:
                msg = await asyncio.wait_for(
                    self._message_queue.get(),
                    timeout=300  # 5 minute timeout
                )
                yield msg

                # Stop on result message
                if msg.type == "result":
                    break

            except asyncio.TimeoutError:
                logger.error("Timeout waiting for response")
                self._is_busy = False
                break

    def add_callback(self, callback: Callable[[ChatMessage], None]):
        """Add a message callback."""
        if callback not in self._callbacks:
            self._callbacks.append(callback)

    def remove_callback(self, callback: Callable[[ChatMessage], None]):
        """Remove a message callback."""
        if callback in self._callbacks:
            self._callbacks.remove(callback)

    async def close(self):
        """Close the session and cleanup."""
        self._is_running = False
        self._callbacks.clear()

        if self._reader_task:
            self._reader_task.cancel()
            try:
                await self._reader_task
            except asyncio.CancelledError:
                pass

        if self._process:
            try:
                self._process.terminate()
                await asyncio.wait_for(self._process.wait(), timeout=5)
            except asyncio.TimeoutError:
                self._process.kill()
            except Exception as e:
                logger.error(f"Error closing process: {e}")

        logger.info(f"Chat session {self.session_id} closed")

    @property
    def is_running(self) -> bool:
        return self._is_running

    @property
    def is_busy(self) -> bool:
        return self._is_busy

    @property
    def claude_session_id(self) -> Optional[str]:
        """Get Claude's internal session ID."""
        return self._claude_session_id

    def get_history(self) -> List[ChatMessage]:
        """Get message history for this session."""
        return self._message_history.copy()

    def get_history_page(self, before_index: int, limit: int = 50) -> tuple[List[ChatMessage], bool]:
        """
        Get a page of history before a given index.

        Args:
            before_index: Get messages before this index (0 = oldest)
            limit: Maximum number of messages to return

        Returns:
            (messages, has_more): List of messages and whether there are more older messages
        """
        if before_index <= 0:
            return [], False

        start_index = max(0, before_index - limit)
        messages = self._message_history[start_index:before_index]
        has_more = start_index > 0
        return messages, has_more

    def get_history_count(self) -> int:
        """Get total number of messages in history."""
        return len(self._message_history)

    def _load_history_from_file(self) -> List[ChatMessage]:
        """
        Load message history from Claude's session file.

        Claude stores sessions in: ~/.claude/projects/{encoded_path}/{session_id}.jsonl
        """
        if not self.resume_session_id:
            return []

        try:
            # Encode the working directory path (Claude replaces / and spaces with -)
            encoded_path = self.working_dir.replace("/", "-").replace(" ", "-").replace("~", "-")
            session_file = Path.home() / ".claude" / "projects" / encoded_path / f"{self.resume_session_id}.jsonl"

            if not session_file.exists():
                logger.debug(f"Session file not found: {session_file}")
                return []

            messages = []
            with open(session_file, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        msg_type = data.get("type", "unknown")

                        # Skip internal/metadata messages
                        if msg_type in ("summary", "stream_event"):
                            continue

                        # Parse timestamp from Claude session file
                        msg_timestamp = datetime.now()
                        if "timestamp" in data:
                            try:
                                # Claude uses ISO format with Z suffix
                                ts_str = data["timestamp"].replace("Z", "+00:00")
                                msg_timestamp = datetime.fromisoformat(ts_str)
                            except (ValueError, TypeError):
                                pass

                        msg = ChatMessage(
                            type=msg_type,
                            content=data,
                            session_id=self.session_id,
                            timestamp=msg_timestamp,
                            metadata={"from_file": True}
                        )
                        messages.append(msg)
                    except json.JSONDecodeError:
                        continue

            logger.info(f"Loaded {len(messages)} messages from session file")
            return messages

        except Exception as e:
            logger.error(f"Error loading history from file: {e}")
            return []

    async def load_history_if_resume(self):
        """Load history from file if this is a resume session."""
        if self.resume_session_id and not self._message_history:
            self._message_history = self._load_history_from_file()


class ChatSessionManager:
    """
    Manage multiple Claude CLI chat sessions.

    Usage:
        manager = ChatSessionManager()
        session_id = await manager.create_session("/path/to/project")

        async for msg in manager.send_message(session_id, "Hello"):
            print(msg.type, msg.content)

        await manager.close_session(session_id)
    """

    def __init__(self):
        self._sessions: Dict[str, ChatSession] = {}
        self._lock = asyncio.Lock()

    async def create_session(
        self,
        working_dir: str,
        session_id: Optional[str] = None,
        on_message: Optional[Callable[[ChatMessage], None]] = None,
        resume_session_id: Optional[str] = None  # Claude session ID to resume
    ) -> str:
        """
        Create a new chat session.

        Args:
            working_dir: Working directory for Claude
            session_id: Optional custom session ID
            on_message: Optional callback for messages
            resume_session_id: Optional Claude session ID to resume history from

        Returns:
            Session ID
        """
        import uuid
        session_id = session_id or str(uuid.uuid4())

        async with self._lock:
            if session_id in self._sessions:
                raise ValueError(f"Session {session_id} already exists")

            # Check if working directory exists
            if not os.path.exists(working_dir):
                raise FileNotFoundError(f"Working directory does not exist: {working_dir}")

            session = ChatSession(
                session_id=session_id,
                working_dir=working_dir,
                on_message=on_message,
                resume_session_id=resume_session_id
            )

            if not await session.start():
                raise RuntimeError("Failed to start session")

            self._sessions[session_id] = session
            logger.info(f"Created chat session {session_id}" + (f" (resuming {resume_session_id[:8]})" if resume_session_id else ""))
            return session_id

    async def send_message(
        self,
        session_id: str,
        content: str
    ) -> AsyncIterator[ChatMessage]:
        """
        Send a message to a session and yield responses.

        Args:
            session_id: Session ID
            content: Message content

        Yields:
            ChatMessage objects
        """
        session = self._sessions.get(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")

        async for msg in session.send_message(content):
            yield msg

    async def close_session(self, session_id: str):
        """Close and remove a session."""
        async with self._lock:
            session = self._sessions.pop(session_id, None)
            if session:
                await session.close()

    async def close_all(self):
        """Close all sessions."""
        async with self._lock:
            for session_id in list(self._sessions.keys()):
                session = self._sessions.pop(session_id)
                await session.close()

    def get_session(self, session_id: str) -> Optional[ChatSession]:
        """Get a session by ID."""
        return self._sessions.get(session_id)

    def list_sessions(self) -> list:
        """List all session IDs."""
        return list(self._sessions.keys())


# Global instance
chat_manager = ChatSessionManager()
