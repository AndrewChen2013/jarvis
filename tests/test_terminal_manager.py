# Copyright (c) 2025 BillChen
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""
TerminalManager 测试用例

测试场景：
1. 终端创建和销毁
2. Session ID 生成和复用
3. 多前端连接同一个终端
4. 输出回调机制
5. 断开连接和清理
"""

import pytest
import asyncio
import uuid
import os
from unittest.mock import Mock, AsyncMock, patch, MagicMock

# 导入被测试的模块
from app.services.terminal_manager import TerminalManager, Terminal


class TestTerminalCreation:
    """测试终端创建"""

    @pytest.fixture
    def manager(self):
        """创建 TerminalManager 实例"""
        return TerminalManager()

    @pytest.mark.asyncio
    async def test_create_terminal_generates_uuid(self, manager, temp_work_dir):
        """新建终端时应该生成 UUID"""
        with patch.object(manager, '_read_output', new_callable=AsyncMock):
            with patch('pty.fork', return_value=(1234, 5)):
                with patch('fcntl.fcntl'):
                    with patch('os.write', return_value=1):  # 返回写入的字节数
                        terminal = await manager.create_terminal(
                            working_dir=temp_work_dir,
                            session_id=None  # 不传 session_id
                        )

                        # 应该生成 UUID 格式的 terminal_id
                        assert terminal.terminal_id is not None
                        # 验证是有效的 UUID
                        uuid.UUID(terminal.terminal_id)

    @pytest.mark.asyncio
    async def test_create_terminal_with_session_id(self, manager, temp_work_dir):
        """传入 session_id 时应该使用它"""
        test_session_id = str(uuid.uuid4())

        with patch.object(manager, '_read_output', new_callable=AsyncMock):
            with patch('pty.fork', return_value=(1234, 5)):
                with patch('fcntl.fcntl'):
                    with patch('os.write', return_value=1):  # 返回写入的字节数
                        terminal = await manager.create_terminal(
                            working_dir=temp_work_dir,
                            session_id=test_session_id
                        )

                        assert terminal.terminal_id == test_session_id
                        assert terminal.session_id == test_session_id

    @pytest.mark.asyncio
    async def test_create_terminal_registers_in_terminals_dict(self, manager, temp_work_dir):
        """创建的终端应该注册到 terminals 字典"""
        with patch.object(manager, '_read_output', new_callable=AsyncMock):
            with patch('pty.fork', return_value=(1234, 5)):
                with patch('fcntl.fcntl'):
                    with patch('os.write', return_value=1):  # 返回写入的字节数
                        terminal = await manager.create_terminal(
                            working_dir=temp_work_dir
                        )

                        assert terminal.terminal_id in manager.terminals
                        assert manager.terminals[terminal.terminal_id] is terminal

    @pytest.mark.asyncio
    async def test_create_terminal_fallback_to_home_if_dir_not_exists(self, manager):
        """工作目录不存在时应该回退到用户主目录"""
        non_existent_dir = "/non/existent/path/12345"

        with patch.object(manager, '_read_output', new_callable=AsyncMock):
            with patch('pty.fork', return_value=(1234, 5)):
                with patch('fcntl.fcntl'):
                    with patch('os.write', return_value=1):  # 返回写入的字节数
                        terminal = await manager.create_terminal(
                            working_dir=non_existent_dir
                        )

                        # 应该回退到用户主目录
                        assert terminal.working_dir == os.path.expanduser("~")


class TestTerminalReuse:
    """测试终端复用（多前端连接同一个终端）"""

    @pytest.fixture
    def manager(self):
        return TerminalManager()

    @pytest.mark.asyncio
    async def test_get_terminal_returns_existing(self, manager, temp_work_dir):
        """get_terminal 应该返回已存在的终端"""
        with patch.object(manager, '_read_output', new_callable=AsyncMock):
            with patch('pty.fork', return_value=(1234, 5)):
                with patch('fcntl.fcntl'):
                    with patch('os.write', return_value=1):  # 返回写入的字节数
                        terminal = await manager.create_terminal(
                            working_dir=temp_work_dir
                        )

                        # 获取同一个终端
                        retrieved = await manager.get_terminal(terminal.terminal_id)
                        assert retrieved is terminal

    @pytest.mark.asyncio
    async def test_get_terminal_returns_none_for_nonexistent(self, manager):
        """get_terminal 对不存在的终端应该返回 None"""
        result = await manager.get_terminal("non-existent-id")
        assert result is None

    def test_websocket_count_increment(self, manager):
        """增加 WebSocket 计数"""
        terminal = Terminal(
            terminal_id="test-id",
            working_dir="/tmp",
            session_id="test-id",
            pid=1234,
            master_fd=5
        )
        manager.terminals["test-id"] = terminal

        assert terminal.websocket_count == 0
        manager.increment_websocket_count("test-id")
        assert terminal.websocket_count == 1
        manager.increment_websocket_count("test-id")
        assert terminal.websocket_count == 2

    def test_websocket_count_decrement(self, manager):
        """减少 WebSocket 计数"""
        terminal = Terminal(
            terminal_id="test-id",
            working_dir="/tmp",
            session_id="test-id",
            pid=1234,
            master_fd=5
        )
        terminal.websocket_count = 2
        manager.terminals["test-id"] = terminal

        count = manager.decrement_websocket_count("test-id")
        assert count == 1
        assert terminal.websocket_count == 1

        count = manager.decrement_websocket_count("test-id")
        assert count == 0
        assert terminal.websocket_count == 0
        # 应该标记断开时间
        assert terminal.last_disconnect_at is not None

    def test_websocket_count_not_negative(self, manager):
        """WebSocket 计数不应该变成负数"""
        terminal = Terminal(
            terminal_id="test-id",
            working_dir="/tmp",
            session_id="test-id",
            pid=1234,
            master_fd=5
        )
        terminal.websocket_count = 0
        manager.terminals["test-id"] = terminal

        count = manager.decrement_websocket_count("test-id")
        assert count == 0
        assert terminal.websocket_count == 0


class TestOutputCallbacks:
    """测试输出回调机制"""

    def test_add_output_callback(self):
        """添加输出回调"""
        terminal = Terminal(
            terminal_id="test-id",
            working_dir="/tmp",
            session_id="test-id",
            pid=1234,
            master_fd=5
        )

        callback = Mock()
        terminal.add_output_callback(callback)

        assert callback in terminal._output_callbacks

    def test_remove_output_callback(self):
        """移除输出回调"""
        terminal = Terminal(
            terminal_id="test-id",
            working_dir="/tmp",
            session_id="test-id",
            pid=1234,
            master_fd=5
        )

        callback = Mock()
        terminal.add_output_callback(callback)
        terminal.remove_output_callback(callback)

        assert callback not in terminal._output_callbacks

    def test_multiple_callbacks(self):
        """多个回调应该都被保存"""
        terminal = Terminal(
            terminal_id="test-id",
            working_dir="/tmp",
            session_id="test-id",
            pid=1234,
            master_fd=5
        )

        callback1 = Mock()
        callback2 = Mock()
        callback3 = Mock()

        terminal.add_output_callback(callback1)
        terminal.add_output_callback(callback2)
        terminal.add_output_callback(callback3)

        assert len(terminal._output_callbacks) == 3

    def test_clear_output_callbacks(self):
        """清除所有回调"""
        terminal = Terminal(
            terminal_id="test-id",
            working_dir="/tmp",
            session_id="test-id",
            pid=1234,
            master_fd=5
        )

        terminal.add_output_callback(Mock())
        terminal.add_output_callback(Mock())
        terminal.clear_output_callbacks()

        assert len(terminal._output_callbacks) == 0


class TestOutputHistory:
    """测试输出历史"""

    def test_get_output_history(self):
        """获取输出历史"""
        terminal = Terminal(
            terminal_id="test-id",
            working_dir="/tmp",
            session_id="test-id",
            pid=1234,
            master_fd=5
        )

        terminal._output_history = bytearray(b"Hello World")
        history = terminal.get_output_history()

        assert history == b"Hello World"

    def test_output_history_is_bytes(self):
        """输出历史应该是 bytes 类型"""
        terminal = Terminal(
            terminal_id="test-id",
            working_dir="/tmp",
            session_id="test-id",
            pid=1234,
            master_fd=5
        )

        terminal._output_history = bytearray(b"test")
        history = terminal.get_output_history()

        assert isinstance(history, bytes)


class TestTerminalClose:
    """测试终端关闭"""

    @pytest.fixture
    def manager(self):
        return TerminalManager()

    @pytest.mark.asyncio
    async def test_close_terminal_removes_from_dict(self, manager):
        """关闭终端应该从 terminals 字典中移除"""
        terminal = Terminal(
            terminal_id="test-id",
            working_dir="/tmp",
            session_id="test-id",
            pid=1234,
            master_fd=5
        )
        terminal._read_task = None
        manager.terminals["test-id"] = terminal

        with patch('os.write'):
            with patch('os.close'):
                with patch('os.kill'):
                    with patch('os.waitpid'):
                        await manager.close_terminal("test-id")

        assert "test-id" not in manager.terminals

    @pytest.mark.asyncio
    async def test_close_nonexistent_terminal_no_error(self, manager):
        """关闭不存在的终端不应该报错"""
        # 不应该抛出异常
        await manager.close_terminal("non-existent-id")


class TestTerminalResize:
    """测试终端调整大小"""

    @pytest.fixture
    def manager(self):
        return TerminalManager()

    @pytest.mark.asyncio
    async def test_resize_updates_size(self, manager):
        """resize 应该更新终端大小"""
        terminal = Terminal(
            terminal_id="test-id",
            working_dir="/tmp",
            session_id="test-id",
            pid=1234,
            master_fd=5
        )
        manager.terminals["test-id"] = terminal

        with patch.object(manager, '_get_winsize', return_value=(24, 80)):
            with patch.object(manager, '_set_winsize') as mock_set:
                result = await manager.resize("test-id", 40, 120)

                assert result is True
                mock_set.assert_called_once_with(5, 40, 120)

    @pytest.mark.asyncio
    async def test_resize_same_size_no_op(self, manager):
        """大小相同时不应该执行 resize"""
        terminal = Terminal(
            terminal_id="test-id",
            working_dir="/tmp",
            session_id="test-id",
            pid=1234,
            master_fd=5
        )
        manager.terminals["test-id"] = terminal

        with patch.object(manager, '_get_winsize', return_value=(40, 120)):
            with patch.object(manager, '_set_winsize') as mock_set:
                result = await manager.resize("test-id", 40, 120)

                assert result is False
                mock_set.assert_not_called()


class TestStats:
    """测试统计信息"""

    @pytest.fixture
    def manager(self):
        return TerminalManager()

    def test_get_stats(self, manager):
        """获取统计信息"""
        terminal = Terminal(
            terminal_id="test-id",
            working_dir="/tmp/test",
            session_id="test-id",
            pid=1234,
            master_fd=5
        )
        terminal.websocket_count = 2
        manager.terminals["test-id"] = terminal

        stats = manager.get_stats()

        assert stats["active_terminals"] == 1
        assert len(stats["terminals"]) == 1
        assert stats["terminals"][0]["id"] == "test-id"[:8]
        assert stats["terminals"][0]["websocket_count"] == 2

    def test_get_active_sessions(self, manager):
        """获取活跃 session 信息"""
        terminal1 = Terminal(
            terminal_id="id-1",
            working_dir="/path/a",
            session_id="session-1",
            pid=1234,
            master_fd=5
        )
        terminal2 = Terminal(
            terminal_id="id-2",
            working_dir="/path/b",
            session_id="session-2",
            pid=5678,
            master_fd=6
        )
        manager.terminals["id-1"] = terminal1
        manager.terminals["id-2"] = terminal2

        result = manager.get_active_sessions()

        assert "session-1" in result["sessions"]
        assert "session-2" in result["sessions"]
        assert "/path/a" in result["working_dirs"]
        assert "/path/b" in result["working_dirs"]
