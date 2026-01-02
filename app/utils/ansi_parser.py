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
ANSI Escape Code Parser

Parse ANSI escape sequences from terminal output and convert to plain text.
"""
import re


# ANSI escape sequence patterns
ANSI_ESCAPE_PATTERN = re.compile(r'''
    \x1b                           # ESC character
    (?:
        \[                         # CSI - Control Sequence Introducer
        [\x30-\x3f]*               # Parameter bytes
        [\x20-\x2f]*               # Intermediate bytes
        [\x40-\x7e]                # Final byte
        |
        \]                         # OSC - Operating System Command
        .*?                        # Parameters
        (?:\x07|\x1b\\)            # String terminator (BEL or ST)
        |
        [PX^_]                     # DCS, SOS, PM, APC
        .*?                        # Parameters
        \x1b\\                     # String terminator
        |
        [\x40-\x5f]                # Fe escape sequences
    )
''', re.VERBOSE)

# Control character pattern (except newline/tab)
CONTROL_CHARS_PATTERN = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')


def strip_ansi(text: str) -> str:
    """Remove all ANSI escape sequences from text.

    Args:
        text: Text potentially containing ANSI codes

    Returns:
        Plain text with all ANSI codes removed
    """
    # Remove ANSI escape sequences
    result = ANSI_ESCAPE_PATTERN.sub('', text)
    # Remove remaining control characters (except \n, \t, \r)
    result = CONTROL_CHARS_PATTERN.sub('', result)
    return result


def parse_terminal_output(data: bytes) -> str:
    """Parse terminal output bytes to readable text.

    Args:
        data: Raw terminal output bytes

    Returns:
        Human-readable text
    """
    try:
        # Decode with UTF-8, replace errors
        text = data.decode('utf-8', errors='replace')
        # Strip ANSI codes
        return strip_ansi(text)
    except Exception:
        # Fallback: try latin-1 which accepts any byte
        try:
            text = data.decode('latin-1')
            return strip_ansi(text)
        except Exception:
            return ''


def parse_terminal_input(data: str) -> str:
    """Parse terminal input to readable text.

    Args:
        data: Raw terminal input string

    Returns:
        Human-readable text
    """
    # Common control key mappings
    control_map = {
        '\x03': '^C',      # Ctrl+C
        '\x04': '^D',      # Ctrl+D
        '\x1a': '^Z',      # Ctrl+Z
        '\x1c': '^\\',     # Ctrl+\
        '\x7f': '<BS>',    # Backspace
        '\x08': '<BS>',    # Backspace (alt)
        '\r': '<CR>',      # Enter
        '\n': '<LF>',      # Line feed
        '\t': '<TAB>',     # Tab
    }

    # Replace common control sequences
    result = data
    for ctrl, name in control_map.items():
        result = result.replace(ctrl, name)

    # Handle arrow keys and special keys
    special_keys = {
        '\x1b[A': '<UP>',
        '\x1b[B': '<DOWN>',
        '\x1b[C': '<RIGHT>',
        '\x1b[D': '<LEFT>',
        '\x1b[H': '<HOME>',
        '\x1b[F': '<END>',
        '\x1b[2~': '<INS>',
        '\x1b[3~': '<DEL>',
        '\x1b[5~': '<PGUP>',
        '\x1b[6~': '<PGDN>',
        '\x1bOP': '<F1>',
        '\x1bOQ': '<F2>',
        '\x1bOR': '<F3>',
        '\x1bOS': '<F4>',
    }

    for seq, name in special_keys.items():
        result = result.replace(seq, name)

    # Strip remaining ANSI codes
    result = strip_ansi(result)

    return result
