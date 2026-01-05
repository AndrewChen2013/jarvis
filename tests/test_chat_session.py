# Copyright (c) 2025 BillChen
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""
ChatSessionManager 测试用例

测试场景：
1. Session 创建和销毁
2. Session ID 生成
3. 消息历史管理
4. 多 Session 隔离
5. Resume 功能
"""

import pytest
import asyncio
import uuid
import json
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from datetime import datetime
from pathlib import Path

# 导入被测试的模块
from app.services.chat_session_manager import (
    ChatMessage,
    ChatSession,
    ChatSessionManager
)


class TestChatMessage:
    """测试 ChatMessage 数据类"""

    def test_create_message(self):
        """创建消息"""
        msg = ChatMessage(
            type="user",
            content={"text": "Hello"},
            session_id="test-session"
        )

        assert msg.type == "user"
        assert msg.content == {"text": "Hello"}
        assert msg.session_id == "test-session"
        assert isinstance(msg.timestamp, datetime)

    def test_to_dict(self):
        """转换为字典"""
        msg = ChatMessage(
            type="assistant",
            content={"message": "Hi there"},
            session_id="test-session",
            metadata={"model": "claude-3"}
        )

        result = msg.to_dict()

        assert result["type"] == "assistant"
        assert result["content"] == {"message": "Hi there"}
        assert result["session_id"] == "test-session"
        assert result["metadata"] == {"model": "claude-3"}
        assert "timestamp" in result


class TestChatSession:
    """测试 ChatSession 类"""

    @pytest.fixture
    def session(self, temp_work_dir):
        """创建测试 session"""
        return ChatSession(
            session_id="test-session",
            working_dir=temp_work_dir,
            claude_path="/usr/bin/true"  # 使用 true 命令作为 mock
        )

    def test_init(self, session):
        """初始化 session"""
        assert session.session_id == "test-session"
        assert session._is_running is False
        assert session._is_busy is False
        assert session._message_history == []

    def test_is_running_property(self, session):
        """is_running 属性"""
        assert session.is_running is False

        session._is_running = True
        assert session.is_running is True

    def test_is_busy_property(self, session):
        """is_busy 属性"""
        assert session.is_busy is False

        session._is_busy = True
        assert session.is_busy is True

    def test_get_history_returns_copy(self, session):
        """get_history 应该返回副本"""
        msg = ChatMessage(
            type="user",
            content={"text": "test"},
            session_id="test-session"
        )
        session._message_history.append(msg)

        history = session.get_history()
        history.clear()  # 修改返回的列表

        # 原始历史不应该被修改
        assert len(session._message_history) == 1

    def test_find_claude_raises_if_not_found(self):
        """找不到 claude 时应该抛出异常"""
        session = ChatSession(
            session_id="test",
            working_dir="/tmp",
            claude_path=None  # 不指定路径
        )

        with patch('shutil.which', return_value=None):
            with patch('os.path.exists', return_value=False):
                with pytest.raises(FileNotFoundError):
                    session._find_claude()


class TestChatSessionManager:
    """测试 ChatSessionManager 类"""

    @pytest.fixture
    def manager(self):
        """创建测试 manager"""
        return ChatSessionManager()

    @pytest.mark.asyncio
    async def test_create_session_generates_uuid(self, manager, temp_work_dir):
        """不传 session_id 时应该生成 UUID"""
        with patch.object(ChatSession, 'start', new_callable=AsyncMock, return_value=True):
            session_id = await manager.create_session(working_dir=temp_work_dir)

            # 应该是有效的 UUID
            uuid.UUID(session_id)

    @pytest.mark.asyncio
    async def test_create_session_with_custom_id(self, manager, temp_work_dir):
        """传入 session_id 时应该使用它"""
        custom_id = "my-custom-session-id"

        with patch.object(ChatSession, 'start', new_callable=AsyncMock, return_value=True):
            session_id = await manager.create_session(
                working_dir=temp_work_dir,
                session_id=custom_id
            )

            assert session_id == custom_id

    @pytest.mark.asyncio
    async def test_create_session_registers_in_dict(self, manager, temp_work_dir):
        """创建的 session 应该注册到 _sessions 字典"""
        with patch.object(ChatSession, 'start', new_callable=AsyncMock, return_value=True):
            session_id = await manager.create_session(working_dir=temp_work_dir)

            assert session_id in manager._sessions
            assert manager._sessions[session_id].session_id == session_id

    @pytest.mark.asyncio
    async def test_create_duplicate_session_raises(self, manager, temp_work_dir):
        """创建重复 session ID 应该抛出异常"""
        with patch.object(ChatSession, 'start', new_callable=AsyncMock, return_value=True):
            session_id = await manager.create_session(
                working_dir=temp_work_dir,
                session_id="duplicate-id"
            )

            with pytest.raises(ValueError, match="already exists"):
                await manager.create_session(
                    working_dir=temp_work_dir,
                    session_id="duplicate-id"
                )

    @pytest.mark.asyncio
    async def test_create_session_fails_if_start_fails(self, manager, temp_work_dir):
        """session 启动失败时应该抛出异常"""
        with patch.object(ChatSession, 'start', new_callable=AsyncMock, return_value=False):
            with pytest.raises(RuntimeError, match="Failed to start"):
                await manager.create_session(working_dir=temp_work_dir)

    @pytest.mark.asyncio
    async def test_close_session(self, manager, temp_work_dir):
        """关闭 session"""
        with patch.object(ChatSession, 'start', new_callable=AsyncMock, return_value=True):
            with patch.object(ChatSession, 'close', new_callable=AsyncMock) as mock_close:
                session_id = await manager.create_session(working_dir=temp_work_dir)
                await manager.close_session(session_id)

                assert session_id not in manager._sessions
                mock_close.assert_called_once()

    @pytest.mark.asyncio
    async def test_close_nonexistent_session_no_error(self, manager):
        """关闭不存在的 session 不应该报错"""
        await manager.close_session("non-existent")

    @pytest.mark.asyncio
    async def test_get_session(self, manager, temp_work_dir):
        """获取 session"""
        with patch.object(ChatSession, 'start', new_callable=AsyncMock, return_value=True):
            session_id = await manager.create_session(working_dir=temp_work_dir)

            session = manager.get_session(session_id)
            assert session is not None
            assert session.session_id == session_id

    def test_get_nonexistent_session_returns_none(self, manager):
        """获取不存在的 session 应该返回 None"""
        session = manager.get_session("non-existent")
        assert session is None

    @pytest.mark.asyncio
    async def test_list_sessions(self, manager, temp_work_dir):
        """列出所有 session"""
        with patch.object(ChatSession, 'start', new_callable=AsyncMock, return_value=True):
            session1 = await manager.create_session(
                working_dir=temp_work_dir,
                session_id="session-1"
            )
            session2 = await manager.create_session(
                working_dir=temp_work_dir,
                session_id="session-2"
            )

            sessions = manager.list_sessions()
            assert "session-1" in sessions
            assert "session-2" in sessions
            assert len(sessions) == 2

    @pytest.mark.asyncio
    async def test_close_all(self, manager, temp_work_dir):
        """关闭所有 session"""
        with patch.object(ChatSession, 'start', new_callable=AsyncMock, return_value=True):
            with patch.object(ChatSession, 'close', new_callable=AsyncMock):
                await manager.create_session(
                    working_dir=temp_work_dir,
                    session_id="session-1"
                )
                await manager.create_session(
                    working_dir=temp_work_dir,
                    session_id="session-2"
                )

                await manager.close_all()

                assert len(manager._sessions) == 0


class TestSessionIsolation:
    """测试 Session 隔离性"""

    @pytest.fixture
    def manager(self):
        return ChatSessionManager()

    @pytest.mark.asyncio
    async def test_sessions_have_independent_history(self, manager, temp_work_dir):
        """不同 session 应该有独立的消息历史"""
        with patch.object(ChatSession, 'start', new_callable=AsyncMock, return_value=True):
            session1_id = await manager.create_session(
                working_dir=temp_work_dir,
                session_id="session-1"
            )
            session2_id = await manager.create_session(
                working_dir=temp_work_dir,
                session_id="session-2"
            )

            session1 = manager.get_session(session1_id)
            session2 = manager.get_session(session2_id)

            # 给 session1 添加消息
            msg1 = ChatMessage(
                type="user",
                content={"text": "message for session 1"},
                session_id=session1_id
            )
            session1._message_history.append(msg1)

            # session2 不应该受影响
            assert len(session1._message_history) == 1
            assert len(session2._message_history) == 0

    @pytest.mark.asyncio
    async def test_sessions_have_independent_busy_state(self, manager, temp_work_dir):
        """不同 session 应该有独立的 busy 状态"""
        with patch.object(ChatSession, 'start', new_callable=AsyncMock, return_value=True):
            session1_id = await manager.create_session(
                working_dir=temp_work_dir,
                session_id="session-1"
            )
            session2_id = await manager.create_session(
                working_dir=temp_work_dir,
                session_id="session-2"
            )

            session1 = manager.get_session(session1_id)
            session2 = manager.get_session(session2_id)

            session1._is_busy = True

            assert session1.is_busy is True
            assert session2.is_busy is False


class TestResumeSession:
    """测试 Session 恢复功能"""

    @pytest.fixture
    def manager(self):
        return ChatSessionManager()

    @pytest.mark.asyncio
    async def test_create_session_with_resume(self, manager, temp_work_dir):
        """创建 session 时可以指定 resume_session_id"""
        resume_id = str(uuid.uuid4())

        with patch.object(ChatSession, 'start', new_callable=AsyncMock, return_value=True):
            with patch.object(ChatSession, 'load_history_if_resume', new_callable=AsyncMock):
                session_id = await manager.create_session(
                    working_dir=temp_work_dir,
                    resume_session_id=resume_id
                )

                session = manager.get_session(session_id)
                assert session.resume_session_id == resume_id

    def test_load_history_from_file(self, temp_work_dir, tmp_path):
        """从文件加载历史"""
        resume_id = str(uuid.uuid4())

        # 创建模拟的 session 文件
        encoded_path = temp_work_dir.replace("/", "-").replace(" ", "-").replace("~", "-")
        session_dir = tmp_path / ".claude" / "projects" / encoded_path
        session_dir.mkdir(parents=True)
        session_file = session_dir / f"{resume_id}.jsonl"

        # 写入一些历史消息
        messages = [
            {"type": "user", "message": {"content": "Hello"}},
            {"type": "assistant", "message": {"content": "Hi there"}},
        ]
        with open(session_file, 'w') as f:
            for msg in messages:
                f.write(json.dumps(msg) + "\n")

        # 创建 session 并加载历史
        with patch.object(Path, 'home', return_value=tmp_path):
            session = ChatSession(
                session_id="test",
                working_dir=temp_work_dir,
                claude_path="/usr/bin/true",
                resume_session_id=resume_id
            )
            history = session._load_history_from_file()

            assert len(history) == 2
            assert history[0].type == "user"
            assert history[1].type == "assistant"

    def test_load_history_file_not_exists(self, temp_work_dir):
        """session 文件不存在时返回空列表"""
        session = ChatSession(
            session_id="test",
            working_dir=temp_work_dir,
            claude_path="/usr/bin/true",
            resume_session_id="non-existent-session"
        )
        history = session._load_history_from_file()

        assert history == []

    def test_load_history_no_resume_id(self, temp_work_dir):
        """没有 resume_session_id 时返回空列表"""
        session = ChatSession(
            session_id="test",
            working_dir=temp_work_dir,
            claude_path="/usr/bin/true",
            resume_session_id=None
        )
        history = session._load_history_from_file()

        assert history == []


class TestClaudeSessionId:
    """测试 Claude Session ID 提取"""

    def test_claude_session_id_property(self, temp_work_dir):
        """claude_session_id 属性"""
        session = ChatSession(
            session_id="test",
            working_dir=temp_work_dir,
            claude_path="/usr/bin/true"
        )

        assert session.claude_session_id is None

        session._claude_session_id = "claude-internal-id"
        assert session.claude_session_id == "claude-internal-id"
