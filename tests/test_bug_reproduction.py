# Copyright (c) 2025 BillChen
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""
后端 Bug 复现测试

测试修复的 bug:
- BUG-013: send_message 写入失败时 _is_busy 未重置
- BUG-014: _message_queue 无大小限制导致内存泄漏
"""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch, MagicMock


class TestChatSessionBugs:
    """ChatSession bug 复现测试"""

    @pytest.mark.asyncio
    async def test_bug_013_is_busy_reset_on_write_error(self):
        """BUG-013: send_message 写入失败时 _is_busy 应该重置为 False"""
        from app.services.chat_session_manager import ChatSession

        session = ChatSession(
            session_id="test-session",
            working_dir="/tmp",
            claude_path="/usr/bin/true"  # 不会实际使用
        )

        # 模拟进程已启动
        session._is_running = True
        session._is_busy = False

        # 创建 mock process
        mock_process = MagicMock()
        mock_stdin = MagicMock()

        # 模拟 drain() 失败
        mock_stdin.write = MagicMock()
        mock_stdin.drain = AsyncMock(side_effect=ConnectionError("Connection lost"))
        mock_process.stdin = mock_stdin

        session._process = mock_process

        # 调用 send_message，应该抛出异常
        with pytest.raises(RuntimeError) as exc_info:
            async for _ in session.send_message("test"):
                pass

        assert "Failed to send message" in str(exc_info.value)

        # 关键：_is_busy 应该被重置为 False
        assert session._is_busy is False

    @pytest.mark.asyncio
    async def test_bug_013_is_busy_reset_on_stdin_write_error(self):
        """BUG-013: stdin.write() 失败时 _is_busy 也应该重置"""
        from app.services.chat_session_manager import ChatSession

        session = ChatSession(
            session_id="test-session",
            working_dir="/tmp",
            claude_path="/usr/bin/true"
        )

        session._is_running = True
        session._is_busy = False

        mock_process = MagicMock()
        mock_stdin = MagicMock()

        # 模拟 write() 失败
        mock_stdin.write = MagicMock(side_effect=BrokenPipeError("Broken pipe"))
        mock_process.stdin = mock_stdin

        session._process = mock_process

        with pytest.raises(RuntimeError):
            async for _ in session.send_message("test"):
                pass

        # _is_busy 应该被重置
        assert session._is_busy is False

    @pytest.mark.asyncio
    async def test_bug_014_message_queue_has_maxsize(self):
        """BUG-014: _message_queue 应该有大小限制"""
        from app.services.chat_session_manager import ChatSession

        session = ChatSession(
            session_id="test-session",
            working_dir="/tmp",
            claude_path="/usr/bin/true"
        )

        # 验证队列有大小限制
        assert session._message_queue.maxsize == 1000

    @pytest.mark.asyncio
    async def test_bug_014_queue_full_doesnt_block(self):
        """BUG-014: 队列满时不应该阻塞，而是丢弃消息"""
        from app.services.chat_session_manager import ChatSession, ChatMessage

        session = ChatSession(
            session_id="test-session",
            working_dir="/tmp",
            claude_path="/usr/bin/true"
        )

        # 填满队列
        for i in range(1000):
            msg = ChatMessage(
                type="test",
                content={"index": i},
                session_id="test-session"
            )
            session._message_queue.put_nowait(msg)

        # 队列已满
        assert session._message_queue.full()

        # 再添加一个消息应该不阻塞（使用 put_nowait）
        msg = ChatMessage(
            type="overflow",
            content={"overflow": True},
            session_id="test-session"
        )

        # 这不应该阻塞或抛出异常（在 _read_output 中使用 try/except）
        try:
            session._message_queue.put_nowait(msg)
            # 如果没有异常，说明队列行为不正确
            pytest.fail("Queue should raise QueueFull")
        except asyncio.QueueFull:
            # 这是预期的行为
            pass


class TestTerminalManagerBugs:
    """TerminalManager bug 复现测试"""

    def test_terminal_output_callbacks_list(self):
        """验证 output callbacks 是列表类型"""
        from app.services.terminal_manager import Terminal

        terminal = Terminal(
            terminal_id="test-id",
            working_dir="/tmp",
            session_id="test-id",
            pid=1234,
            master_fd=5
        )

        # 验证是列表
        assert isinstance(terminal._output_callbacks, list)

        # 可以添加和移除
        callback = Mock()
        terminal.add_output_callback(callback)
        assert callback in terminal._output_callbacks

        terminal.remove_output_callback(callback)
        assert callback not in terminal._output_callbacks

    def test_terminal_remove_nonexistent_callback(self):
        """移除不存在的 callback 不应该崩溃"""
        from app.services.terminal_manager import Terminal

        terminal = Terminal(
            terminal_id="test-id",
            working_dir="/tmp",
            session_id="test-id",
            pid=1234,
            master_fd=5
        )

        callback = Mock()
        # 移除不存在的 callback 不应该抛出异常
        terminal.remove_output_callback(callback)

    def test_terminal_clear_callbacks(self):
        """clear_output_callbacks 应该清除所有回调"""
        from app.services.terminal_manager import Terminal

        terminal = Terminal(
            terminal_id="test-id",
            working_dir="/tmp",
            session_id="test-id",
            pid=1234,
            master_fd=5
        )

        terminal.add_output_callback(Mock())
        terminal.add_output_callback(Mock())
        terminal.add_output_callback(Mock())

        assert len(terminal._output_callbacks) == 3

        terminal.clear_output_callbacks()

        assert len(terminal._output_callbacks) == 0


class TestMuxConnectionManagerBugs:
    """MuxConnectionManager bug 复现测试"""

    @pytest.mark.asyncio
    async def test_disconnect_cleans_up_subscriptions(self):
        """断开连接时应该清理所有订阅"""
        from app.services.mux_connection_manager import MuxConnectionManager, MuxClient
        from unittest.mock import MagicMock

        manager = MuxConnectionManager()

        # 创建 mock websocket
        mock_ws = MagicMock()
        mock_ws.send_bytes = AsyncMock()

        client_id = "test-client"
        client = await manager.connect(client_id, mock_ws)

        # 订阅一些 session
        await manager.subscribe(client_id, "session-1", "terminal")
        await manager.subscribe(client_id, "session-2", "terminal")

        # 验证订阅存在
        assert "session-1" in client.subscriptions
        assert "session-2" in client.subscriptions
        assert client_id in manager.session_subscribers.get("session-1", set())
        assert client_id in manager.session_subscribers.get("session-2", set())

        # 断开连接
        await manager.disconnect(client_id)

        # 验证清理
        assert client_id not in manager.clients
        # session_subscribers 应该被清理（如果没有其他订阅者）
        assert "session-1" not in manager.session_subscribers or client_id not in manager.session_subscribers.get("session-1", set())

    @pytest.mark.asyncio
    async def test_unsubscribe_cleans_up_properly(self):
        """取消订阅时应该正确清理"""
        from app.services.mux_connection_manager import MuxConnectionManager
        from unittest.mock import MagicMock

        manager = MuxConnectionManager()

        mock_ws = MagicMock()
        mock_ws.send_bytes = AsyncMock()

        client_id = "test-client"
        await manager.connect(client_id, mock_ws)

        # 订阅
        await manager.subscribe(client_id, "session-1", "terminal")
        assert "session-1" in manager.clients[client_id].subscriptions

        # 取消订阅
        await manager.unsubscribe(client_id, "session-1")
        assert "session-1" not in manager.clients[client_id].subscriptions

    @pytest.mark.asyncio
    async def test_send_to_nonexistent_client_no_error(self):
        """发送给不存在的客户端不应该报错"""
        from app.services.mux_connection_manager import MuxConnectionManager

        manager = MuxConnectionManager()

        # 发送给不存在的客户端不应该抛出异常
        await manager.send_to_client("nonexistent-client", {"test": "message"})
