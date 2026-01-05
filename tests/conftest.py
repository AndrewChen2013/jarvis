# Copyright (c) 2025 BillChen
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""
Pytest 配置和共享 fixtures
"""

import pytest
import asyncio
import sys
import os

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture(scope="session")
def event_loop():
    """创建事件循环"""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def temp_work_dir(tmp_path):
    """创建临时工作目录"""
    work_dir = tmp_path / "test_project"
    work_dir.mkdir()
    return str(work_dir)


@pytest.fixture
def mock_websocket():
    """Mock WebSocket 对象"""
    class MockWebSocket:
        def __init__(self):
            self.sent_messages = []
            self.closed = False

        async def send_bytes(self, data):
            self.sent_messages.append(data)

        async def send_text(self, data):
            self.sent_messages.append(data)

        async def close(self):
            self.closed = True

        async def accept(self):
            pass

    return MockWebSocket()
