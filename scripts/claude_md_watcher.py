#!/usr/bin/env python3
# Copyright (c) 2026 BillChen
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
CLAUDE.md Watcher - Monitor and maintain instructions in ~/.claude/CLAUDE.md

This script watches the ~/.claude/CLAUDE.md file and ensures that required
instructions (like experience-memory usage) are always present.

Usage:
    python scripts/claude_md_watcher.py          # Run in foreground
    python scripts/claude_md_watcher.py --daemon # Run as daemon
"""

import os
import sys
import time
import logging
import threading
from pathlib import Path
from typing import Optional

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileSystemEvent

# Configuration
CLAUDE_DIR = Path.home() / ".claude"
CLAUDE_MD_PATH = CLAUDE_DIR / "CLAUDE.md"

# The marker and instruction to inject
MARKER = "## Experience Memory"
INSTRUCTION = """当解决棘手 bug、发现项目模式、了解用户偏好或获得领域知识时，主动使用 experience-memory MCP 的 learn 工具记录经验，不要等用户提醒。"""

# Debounce time in seconds (avoid rapid repeated checks)
DEBOUNCE_TIME = 1.0

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("claude_md_watcher")


def check_and_inject() -> bool:
    """
    Check if CLAUDE.md contains the required instruction, inject if missing.
    Returns True if injection was performed, False if already present.
    """
    try:
        # Ensure directory exists
        CLAUDE_DIR.mkdir(parents=True, exist_ok=True)

        if CLAUDE_MD_PATH.exists():
            content = CLAUDE_MD_PATH.read_text(encoding='utf-8')

            # Check if already contains our instruction
            if MARKER in content and "experience-memory" in content:
                logger.debug("Instruction already present, skipping")
                return False

            # Append our section
            if not content.endswith('\n'):
                content += '\n'
            content += f"\n{MARKER}\n\n{INSTRUCTION}\n"
            CLAUDE_MD_PATH.write_text(content, encoding='utf-8')
            logger.info("Appended instruction to existing CLAUDE.md")
        else:
            # Create new file
            content = f"# Global Instructions\n\n{MARKER}\n\n{INSTRUCTION}\n"
            CLAUDE_MD_PATH.write_text(content, encoding='utf-8')
            logger.info("Created new CLAUDE.md with instruction")

        return True
    except Exception as e:
        logger.error(f"Error checking/injecting CLAUDE.md: {e}")
        return False


class ClaudeMdHandler(FileSystemEventHandler):
    """Handler for CLAUDE.md file system events."""

    def __init__(self):
        super().__init__()
        self._last_check_time = 0
        self._lock = threading.Lock()

    def _should_handle(self, event: FileSystemEvent) -> bool:
        """Check if this event should be handled."""
        # Only handle events related to CLAUDE.md
        event_path = Path(event.src_path)
        if event_path.name != "CLAUDE.md":
            return False

        # Debounce rapid events
        with self._lock:
            now = time.time()
            if now - self._last_check_time < DEBOUNCE_TIME:
                return False
            self._last_check_time = now

        return True

    def on_modified(self, event: FileSystemEvent):
        """Handle file modification."""
        if not self._should_handle(event):
            return
        logger.info(f"CLAUDE.md modified, checking instruction...")
        # Small delay to let the write complete
        time.sleep(0.1)
        check_and_inject()

    def on_deleted(self, event: FileSystemEvent):
        """Handle file deletion."""
        if not self._should_handle(event):
            return
        logger.info(f"CLAUDE.md deleted, recreating...")
        time.sleep(0.1)
        check_and_inject()

    def on_created(self, event: FileSystemEvent):
        """Handle file creation."""
        if not self._should_handle(event):
            return
        logger.info(f"CLAUDE.md created, checking instruction...")
        time.sleep(0.1)
        check_and_inject()


class ClaudeMdWatcher:
    """Watcher for ~/.claude/CLAUDE.md file."""

    def __init__(self):
        self.observer: Optional[Observer] = None
        self._running = False

    def start(self):
        """Start watching the CLAUDE.md file."""
        # Ensure directory exists
        CLAUDE_DIR.mkdir(parents=True, exist_ok=True)

        # Initial check
        logger.info("Performing initial check...")
        check_and_inject()

        # Setup observer
        self.observer = Observer()
        handler = ClaudeMdHandler()

        # Watch the .claude directory (not the file directly, for deletion handling)
        self.observer.schedule(handler, str(CLAUDE_DIR), recursive=False)

        self.observer.start()
        self._running = True
        logger.info(f"Started watching {CLAUDE_DIR}")

    def stop(self):
        """Stop watching."""
        if self.observer:
            self.observer.stop()
            self.observer.join()
            self._running = False
            logger.info("Stopped watching")

    def run_forever(self):
        """Run the watcher until interrupted."""
        self.start()
        try:
            while self._running:
                time.sleep(1)
        except KeyboardInterrupt:
            logger.info("Received interrupt signal")
        finally:
            self.stop()

    @property
    def is_running(self) -> bool:
        return self._running


# Global watcher instance for integration
_watcher: Optional[ClaudeMdWatcher] = None


def start_watcher() -> ClaudeMdWatcher:
    """Start the global watcher instance (for integration with Jarvis)."""
    global _watcher
    if _watcher is None or not _watcher.is_running:
        _watcher = ClaudeMdWatcher()
        _watcher.start()
    return _watcher


def stop_watcher():
    """Stop the global watcher instance."""
    global _watcher
    if _watcher:
        _watcher.stop()
        _watcher = None


def main():
    """Main entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="Watch and maintain CLAUDE.md instructions")
    parser.add_argument("--daemon", "-d", action="store_true", help="Run as daemon")
    parser.add_argument("--check-only", "-c", action="store_true", help="Only check and inject once, then exit")
    parser.add_argument("--verbose", "-v", action="store_true", help="Enable verbose logging")
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    if args.check_only:
        # Just check once and exit (always success if no error)
        check_and_inject()
        sys.exit(0)

    if args.daemon:
        # Daemonize (simple fork approach)
        try:
            pid = os.fork()
            if pid > 0:
                print(f"Daemon started with PID {pid}")
                sys.exit(0)
        except OSError as e:
            logger.error(f"Fork failed: {e}")
            sys.exit(1)

        # Decouple from parent
        os.setsid()
        os.umask(0)

    # Run watcher
    watcher = ClaudeMdWatcher()
    watcher.run_forever()


if __name__ == "__main__":
    main()
