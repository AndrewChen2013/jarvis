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
Chat Parser - Parse Claude CLI terminal output into structured chat messages.

This module converts raw PTY output into structured messages for Chat mode display.
Terminal mode continues to use raw output via xterm.js.
"""

import re
from enum import Enum
from dataclasses import dataclass, field
from typing import List, Optional, Callable
from .ansi_parser import strip_ansi


class MessageType(Enum):
    """Types of messages in chat view."""
    USER = "user"              # User input
    ASSISTANT = "assistant"    # Claude's response
    TOOL_CALL = "tool_call"    # Tool being called
    TOOL_RESULT = "tool_result"  # Tool output
    THINKING = "thinking"      # Claude's thinking process
    SYSTEM = "system"          # System messages (errors, status)


@dataclass
class ChatMessage:
    """A structured chat message."""
    type: MessageType
    content: str
    tool_name: Optional[str] = None  # For tool_call/tool_result
    is_streaming: bool = False       # Still receiving content
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        """Convert to JSON-serializable dict."""
        return {
            "type": self.type.value,
            "content": self.content,
            "tool_name": self.tool_name,
            "is_streaming": self.is_streaming,
            "metadata": self.metadata
        }


class ChatParser:
    """
    Parse terminal output stream into structured chat messages.

    Usage:
        parser = ChatParser(on_message=handle_message)
        parser.feed(terminal_data)  # Call repeatedly with PTY output
    """

    # Claude CLI prompt patterns
    PROMPT_PATTERNS = [
        r'❯\s*$',           # Default prompt
        r'>\s*$',           # Alternative prompt
        r'\$\s*$',          # Shell-like prompt
    ]

    # Tool call patterns (Claude CLI uses box-drawing characters)
    TOOL_START_PATTERN = r'[╭┌]─+\s*(\w+)'  # ╭─ ToolName or ┌── ToolName
    TOOL_END_PATTERN = r'[╰└]─+'             # ╰── or └──

    # Thinking block patterns
    THINKING_START = r'<thinking>'
    THINKING_END = r'</thinking>'

    def __init__(self, on_message: Optional[Callable[[ChatMessage], None]] = None):
        """
        Initialize the parser.

        Args:
            on_message: Callback when a complete message is parsed
        """
        self.on_message = on_message
        self._buffer = ""
        self._current_message: Optional[ChatMessage] = None
        self._state = "idle"  # idle, user_input, assistant, tool_call, thinking
        self._tool_depth = 0
        self._messages: List[ChatMessage] = []

        # Compile patterns
        self._prompt_re = re.compile('|'.join(self.PROMPT_PATTERNS))
        self._tool_start_re = re.compile(self.TOOL_START_PATTERN)
        self._tool_end_re = re.compile(self.TOOL_END_PATTERN)

    def feed(self, data: str) -> List[ChatMessage]:
        """
        Feed terminal data to the parser.

        Args:
            data: Raw terminal output (may contain ANSI codes)

        Returns:
            List of newly completed messages
        """
        # Strip ANSI codes for parsing
        clean_data = strip_ansi(data)
        self._buffer += clean_data

        new_messages = []

        # Process buffer line by line
        while '\n' in self._buffer:
            line, self._buffer = self._buffer.split('\n', 1)
            messages = self._process_line(line)
            new_messages.extend(messages)

        # Check for prompt at end of buffer (no newline)
        if self._prompt_re.search(self._buffer):
            # Prompt detected, finalize current message
            if self._current_message and self._state == "assistant":
                self._finalize_message()
                if self._current_message:
                    new_messages.append(self._current_message)
                self._current_message = None
            self._state = "idle"
            self._buffer = ""

        return new_messages

    def _process_line(self, line: str) -> List[ChatMessage]:
        """Process a single line of output."""
        messages = []
        line = line.strip()

        if not line:
            # Empty line - might be paragraph break in assistant response
            if self._current_message and self._state == "assistant":
                self._current_message.content += "\n\n"
            return messages

        # Check for tool start
        tool_match = self._tool_start_re.search(line)
        if tool_match:
            # Finalize any current message
            if self._current_message:
                self._finalize_message()
                messages.append(self._current_message)

            tool_name = tool_match.group(1)
            self._current_message = ChatMessage(
                type=MessageType.TOOL_CALL,
                content="",
                tool_name=tool_name,
                is_streaming=True
            )
            self._state = "tool_call"
            self._tool_depth += 1
            return messages

        # Check for tool end
        if self._tool_end_re.search(line) and self._state == "tool_call":
            self._tool_depth -= 1
            if self._tool_depth <= 0:
                self._tool_depth = 0
                if self._current_message:
                    self._finalize_message()
                    messages.append(self._current_message)
                    self._current_message = None
                self._state = "assistant"
                # Start new assistant message for post-tool response
                self._current_message = ChatMessage(
                    type=MessageType.ASSISTANT,
                    content="",
                    is_streaming=True
                )
            return messages

        # Check for thinking block
        if self.THINKING_START in line:
            if self._current_message:
                self._finalize_message()
                messages.append(self._current_message)
            self._current_message = ChatMessage(
                type=MessageType.THINKING,
                content="",
                is_streaming=True
            )
            self._state = "thinking"
            return messages

        if self.THINKING_END in line and self._state == "thinking":
            if self._current_message:
                self._finalize_message()
                messages.append(self._current_message)
                self._current_message = None
            self._state = "assistant"
            return messages

        # Check for prompt (user input start)
        if self._prompt_re.search(line):
            # Finalize any current message
            if self._current_message:
                self._finalize_message()
                messages.append(self._current_message)
                self._current_message = None
            self._state = "idle"
            return messages

        # Add content to current message based on state
        if self._state == "idle":
            # This might be user input being echoed
            # Start assistant message (user input comes from WebSocket INPUT)
            self._current_message = ChatMessage(
                type=MessageType.ASSISTANT,
                content=line + "\n",
                is_streaming=True
            )
            self._state = "assistant"
        elif self._current_message:
            self._current_message.content += line + "\n"

        return messages

    def _finalize_message(self):
        """Clean up and finalize current message."""
        if self._current_message:
            self._current_message.is_streaming = False
            self._current_message.content = self._current_message.content.strip()
            if self.on_message and self._current_message.content:
                self.on_message(self._current_message)
            self._messages.append(self._current_message)

    def handle_user_input(self, text: str) -> ChatMessage:
        """
        Handle user input separately (from WebSocket INPUT).

        Args:
            text: User's input text

        Returns:
            User message
        """
        message = ChatMessage(
            type=MessageType.USER,
            content=text.strip(),
            is_streaming=False
        )
        self._messages.append(message)
        if self.on_message:
            self.on_message(message)
        return message

    def get_messages(self) -> List[ChatMessage]:
        """Get all parsed messages."""
        return self._messages.copy()

    def clear(self):
        """Clear all state and messages."""
        self._buffer = ""
        self._current_message = None
        self._state = "idle"
        self._tool_depth = 0
        self._messages.clear()


# Convenience function for simple usage
def parse_terminal_to_chat(terminal_output: str) -> List[ChatMessage]:
    """
    Parse complete terminal output to chat messages.

    Args:
        terminal_output: Complete terminal output string

    Returns:
        List of chat messages
    """
    parser = ChatParser()
    parser.feed(terminal_output)
    return parser.get_messages()
