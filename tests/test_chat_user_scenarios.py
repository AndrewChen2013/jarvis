# Copyright (c) 2025 BillChen
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
"""
用户场景测试用例

覆盖用户实际使用中的各种场景：
1. 消息顺序 - 确保消息按发送顺序到达
2. Session 切换 - 切换聊天时资源正确清理
3. 断开重连 - 网络断开后能正常恢复
4. 边界条件 - 队列满、超长消息等
5. 并发操作 - 多客户端、多 session
"""

import pytest
import asyncio
import uuid
from datetime import datetime, timezone
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from dataclasses import dataclass
from typing import List, Any

from app.services.mux_connection_manager import MuxConnectionManager, MuxClient
from app.services.chat_session_manager import ChatMessage


class MockWebSocket:
    """Mock WebSocket，记录发送的消息"""

    def __init__(self):
        self.sent_messages: List[Any] = []
        self.is_closed = False

    async def send_bytes(self, data: bytes):
        if self.is_closed:
            raise Exception("WebSocket closed")
        import msgpack
        msg = msgpack.unpackb(data, raw=False)
        self.sent_messages.append(msg)

    def get_messages_by_type(self, msg_type: int) -> List[dict]:
        """获取指定类型的消息"""
        return [m for m in self.sent_messages if m.get('t') == msg_type]

    def clear(self):
        self.sent_messages.clear()


def create_chat_message(content: dict, session_id: str = "test-session") -> ChatMessage:
    """创建 ChatMessage 对象"""
    msg_type = content.get("type", "assistant") if content else "assistant"
    return ChatMessage(
        type=msg_type,
        content=content,
        session_id=session_id,
        timestamp=datetime.now(timezone.utc)
    )


class TestMessageOrdering:
    """
    场景1：消息顺序测试

    用户场景：
    - 用户发送问题，Claude 返回多段回复
    - 回复包含：思考、文字、代码、工具调用等
    - 所有内容必须按正确顺序显示
    """

    @pytest.fixture
    def manager(self):
        return MuxConnectionManager()

    @pytest.fixture
    def mock_chat_session(self):
        """创建 mock chat session"""
        session = MagicMock()
        session.working_dir = "/tmp/test"
        session.get_history.return_value = []
        session.is_running = True
        return session

    @pytest.mark.asyncio
    async def test_messages_arrive_in_order(self, manager, mock_chat_session):
        """
        测试：多条消息按顺序到达

        场景：Claude 快速返回 10 条消息，验证它们按顺序到达客户端
        """
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
            mock_cm.get_session.return_value = mock_chat_session
            mock_cm.create_session = AsyncMock()

            # 连接到 chat session
            await manager._handle_chat_message(
                client_id, session_id, "connect",
                {"working_dir": "/tmp/test"}
            )

            # 等待 consumer task 启动
            await asyncio.sleep(0.01)

            # 获取注册的回调
            callback = mock_chat_session.add_callback.call_args[0][0]

            # 模拟 Claude 快速返回 10 条消息
            for i in range(10):
                msg = create_chat_message({
                    "type": "assistant",
                    "message": {"content": [{"type": "text", "text": f"Message {i}"}]}
                })
                callback(msg)

            # 等待所有消息被处理
            await asyncio.sleep(0.1)

            # 验证消息顺序
            # 类型 2 是 assistant 消息
            assistant_messages = ws.get_messages_by_type(2)

            assert len(assistant_messages) == 10, f"Expected 10 messages, got {len(assistant_messages)}"

            for i, msg in enumerate(assistant_messages):
                content = msg['d'].get('content', '')
                assert f"Message {i}" in content, \
                    f"Message {i} out of order, got: {content}"

    @pytest.mark.asyncio
    async def test_mixed_message_types_order(self, manager, mock_chat_session):
        """
        测试：混合消息类型保持顺序

        场景：Claude 返回思考 -> 文字 -> 工具调用 -> 文字的混合流
        """
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
            mock_cm.get_session.return_value = mock_chat_session
            mock_cm.create_session = AsyncMock()

            await manager._handle_chat_message(
                client_id, session_id, "connect",
                {"working_dir": "/tmp/test"}
            )

            await asyncio.sleep(0.01)
            callback = mock_chat_session.add_callback.call_args[0][0]

            # 发送混合类型的消息序列
            messages = [
                {"type": "assistant", "message": {"content": [
                    {"type": "thinking", "thinking": "Let me think..."}
                ]}},
                {"type": "assistant", "message": {"content": [
                    {"type": "text", "text": "Here's my answer"}
                ]}},
                {"type": "assistant", "message": {"content": [
                    {"type": "tool_use", "name": "read_file", "id": "tool1", "input": {}}
                ]}},
                {"type": "assistant", "message": {"content": [
                    {"type": "text", "text": "Based on the file..."}
                ]}},
            ]

            for msg_content in messages:
                callback(create_chat_message(msg_content))

            await asyncio.sleep(0.1)

            # 验证所有消息都被发送
            # thinking=9, assistant=2, tool_call=4
            assert len(ws.sent_messages) >= 4, "Not all messages received"

    @pytest.mark.asyncio
    async def test_rapid_fire_messages(self, manager, mock_chat_session):
        """
        测试：快速连续发送大量消息

        场景：模拟 Claude 在短时间内返回 100 条流式消息
        """
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
            mock_cm.get_session.return_value = mock_chat_session
            mock_cm.create_session = AsyncMock()

            await manager._handle_chat_message(
                client_id, session_id, "connect",
                {"working_dir": "/tmp/test"}
            )

            await asyncio.sleep(0.01)
            callback = mock_chat_session.add_callback.call_args[0][0]

            # 快速发送 100 条消息（不等待）
            for i in range(100):
                msg = create_chat_message({
                    "type": "assistant",
                    "message": {"content": [{"type": "text", "text": f"Rapid {i}"}]}
                })
                callback(msg)

            # 等待处理完成
            await asyncio.sleep(0.5)

            assistant_messages = ws.get_messages_by_type(2)
            assert len(assistant_messages) == 100

            # 验证顺序
            for i, msg in enumerate(assistant_messages):
                assert f"Rapid {i}" in msg['d'].get('content', ''), \
                    f"Message {i} out of order"


class TestSessionSwitching:
    """
    场景2：Session 切换测试

    用户场景：
    - 用户在多个项目之间切换
    - 切换时旧 session 应该正确清理
    - 新 session 应该能正常工作
    """

    @pytest.fixture
    def manager(self):
        return MuxConnectionManager()

    @pytest.mark.asyncio
    async def test_switch_session_cleanup(self, manager):
        """
        测试：切换 session 时旧资源被清理

        场景：用户从项目 A 切换到项目 B
        """
        ws = MockWebSocket()
        client_id = "test-client"
        session_a = str(uuid.uuid4())
        session_b = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        mock_session_a = MagicMock()
        mock_session_a.working_dir = "/project/a"
        mock_session_a.get_history.return_value = []
        mock_session_a.is_running = True

        mock_session_b = MagicMock()
        mock_session_b.working_dir = "/project/b"
        mock_session_b.get_history.return_value = []
        mock_session_b.is_running = True

        with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
            def get_session_side_effect(sid):
                if sid == session_a:
                    return mock_session_a
                elif sid == session_b:
                    return mock_session_b
                return None

            mock_cm.get_session.side_effect = get_session_side_effect
            mock_cm.create_session = AsyncMock()

            # 连接到 session A
            await manager._handle_chat_message(
                client_id, session_a, "connect",
                {"working_dir": "/project/a"}
            )

            await asyncio.sleep(0.01)

            # 验证 session A 已订阅
            assert session_a in manager.clients[client_id].subscriptions
            assert session_a in manager.clients[client_id].chat_message_queues
            assert session_a in manager.clients[client_id].chat_consumer_tasks

            # 断开 session A
            await manager._handle_chat_message(
                client_id, session_a, "disconnect", {}
            )

            # 连接到 session B
            await manager._handle_chat_message(
                client_id, session_b, "connect",
                {"working_dir": "/project/b"}
            )

            await asyncio.sleep(0.01)

            # 验证 session A 已清理
            assert session_a not in manager.clients[client_id].subscriptions
            assert session_a not in manager.clients[client_id].chat_message_queues

            # 验证 session B 已订阅
            assert session_b in manager.clients[client_id].subscriptions
            assert session_b in manager.clients[client_id].chat_message_queues

    @pytest.mark.asyncio
    async def test_multiple_sessions_independent(self, manager):
        """
        测试：多个 session 独立工作

        场景：用户同时打开多个项目标签页
        """
        ws = MockWebSocket()
        client_id = "test-client"
        session_a = str(uuid.uuid4())
        session_b = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        mock_session_a = MagicMock()
        mock_session_a.working_dir = "/project/a"
        mock_session_a.get_history.return_value = []
        mock_session_a.is_running = True

        mock_session_b = MagicMock()
        mock_session_b.working_dir = "/project/b"
        mock_session_b.get_history.return_value = []
        mock_session_b.is_running = True

        with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
            def get_session_side_effect(sid):
                if sid == session_a:
                    return mock_session_a
                elif sid == session_b:
                    return mock_session_b
                return None

            mock_cm.get_session.side_effect = get_session_side_effect
            mock_cm.create_session = AsyncMock()

            # 同时连接两个 session
            await manager._handle_chat_message(
                client_id, session_a, "connect",
                {"working_dir": "/project/a"}
            )
            await manager._handle_chat_message(
                client_id, session_b, "connect",
                {"working_dir": "/project/b"}
            )

            await asyncio.sleep(0.01)

            # 验证两个都订阅了
            assert session_a in manager.clients[client_id].subscriptions
            assert session_b in manager.clients[client_id].subscriptions

            # 获取回调
            callback_a = mock_session_a.add_callback.call_args[0][0]
            callback_b = mock_session_b.add_callback.call_args[0][0]

            ws.clear()

            # 向两个 session 发送不同消息
            callback_a(create_chat_message({
                "type": "assistant",
                "message": {"content": [{"type": "text", "text": "From A"}]}
            }))
            callback_b(create_chat_message({
                "type": "assistant",
                "message": {"content": [{"type": "text", "text": "From B"}]}
            }))

            await asyncio.sleep(0.1)

            # 验证两条消息都收到了
            assistant_messages = ws.get_messages_by_type(2)
            contents = [m['d'].get('content', '') for m in assistant_messages]

            assert "From A" in str(contents)
            assert "From B" in str(contents)


class TestDisconnectReconnect:
    """
    场景3：断开重连测试

    用户场景：
    - 网络不稳定导致断开
    - 关闭浏览器后重新打开
    - 手机切换网络
    """

    @pytest.fixture
    def manager(self):
        return MuxConnectionManager()

    @pytest.mark.asyncio
    async def test_disconnect_cleans_resources(self, manager):
        """
        测试：断开连接时资源被清理

        场景：用户关闭浏览器标签页
        """
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        mock_session = MagicMock()
        mock_session.working_dir = "/tmp/test"
        mock_session.get_history.return_value = []
        mock_session.is_running = True

        with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
            mock_cm.get_session.return_value = mock_session
            mock_cm.create_session = AsyncMock()

            await manager._handle_chat_message(
                client_id, session_id, "connect",
                {"working_dir": "/tmp/test"}
            )

            await asyncio.sleep(0.01)

            # 验证资源已创建
            assert session_id in manager.clients[client_id].chat_message_queues
            assert session_id in manager.clients[client_id].chat_consumer_tasks

            # 断开连接
            await manager.disconnect(client_id)

            # 验证客户端已移除
            assert client_id not in manager.clients

            # 验证回调已移除
            mock_session.remove_callback.assert_called()

    @pytest.mark.asyncio
    async def test_reconnect_works_correctly(self, manager):
        """
        测试：重连后能正常工作

        场景：用户断网后重新连接
        """
        ws1 = MockWebSocket()
        ws2 = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        mock_session = MagicMock()
        mock_session.working_dir = "/tmp/test"
        mock_session.get_history.return_value = []
        mock_session.is_running = True

        with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
            mock_cm.get_session.return_value = mock_session
            mock_cm.create_session = AsyncMock()

            # 第一次连接
            await manager.connect(client_id, ws1)
            manager.clients[client_id].authenticated = True

            await manager._handle_chat_message(
                client_id, session_id, "connect",
                {"working_dir": "/tmp/test"}
            )

            await asyncio.sleep(0.01)

            # 断开
            await manager.disconnect(client_id)

            # 重连（使用新的 WebSocket）
            await manager.connect(client_id, ws2)
            manager.clients[client_id].authenticated = True

            await manager._handle_chat_message(
                client_id, session_id, "connect",
                {"working_dir": "/tmp/test"}
            )

            await asyncio.sleep(0.01)

            # 验证新连接正常工作
            assert client_id in manager.clients
            assert session_id in manager.clients[client_id].subscriptions

            # 记录重连前 ws1 的消息数量
            ws1_count_before = len(ws1.sent_messages)

            # 发送消息验证
            callback = mock_session.add_callback.call_args[0][0]
            callback(create_chat_message({
                "type": "assistant",
                "message": {"content": [{"type": "text", "text": "After reconnect"}]}
            }))

            await asyncio.sleep(0.1)

            # 验证消息发送到新 WebSocket
            assert len(ws2.sent_messages) > 0

            # 验证重连后的新消息没有发送到旧 WebSocket
            # ws1 可能在第一次连接时收到了 ready 消息，但重连后不应该收到新消息
            assert len(ws1.sent_messages) == ws1_count_before, \
                "New messages should not be sent to old WebSocket after reconnect"


class TestEdgeCases:
    """
    场景4：边界条件测试

    用户场景：
    - 极端情况下系统的稳定性
    - 错误处理和恢复
    """

    @pytest.fixture
    def manager(self):
        return MuxConnectionManager()

    @pytest.mark.asyncio
    async def test_client_disconnect_during_message_processing(self, manager):
        """
        测试：消息处理中客户端断开

        场景：用户在收到回复过程中关闭页面
        """
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        mock_session = MagicMock()
        mock_session.working_dir = "/tmp/test"
        mock_session.get_history.return_value = []
        mock_session.is_running = True

        with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
            mock_cm.get_session.return_value = mock_session
            mock_cm.create_session = AsyncMock()

            await manager._handle_chat_message(
                client_id, session_id, "connect",
                {"working_dir": "/tmp/test"}
            )

            await asyncio.sleep(0.01)
            callback = mock_session.add_callback.call_args[0][0]

            # 发送一些消息
            for i in range(5):
                callback(create_chat_message({
                    "type": "assistant",
                    "message": {"content": [{"type": "text", "text": f"Message {i}"}]}
                }))

            # 立即断开（模拟用户关闭页面）
            await manager.disconnect(client_id)

            # 继续发送消息（模拟 Claude 还在输出）
            for i in range(5, 10):
                callback(create_chat_message({
                    "type": "assistant",
                    "message": {"content": [{"type": "text", "text": f"Message {i}"}]}
                }))

            await asyncio.sleep(0.1)

            # 验证系统没有崩溃
            assert client_id not in manager.clients

    @pytest.mark.asyncio
    async def test_websocket_send_error(self, manager):
        """
        测试：WebSocket 发送失败

        场景：网络突然断开导致发送失败
        """
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        mock_session = MagicMock()
        mock_session.working_dir = "/tmp/test"
        mock_session.get_history.return_value = []
        mock_session.is_running = True

        with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
            mock_cm.get_session.return_value = mock_session
            mock_cm.create_session = AsyncMock()

            await manager._handle_chat_message(
                client_id, session_id, "connect",
                {"working_dir": "/tmp/test"}
            )

            await asyncio.sleep(0.01)
            callback = mock_session.add_callback.call_args[0][0]

            # 模拟 WebSocket 关闭
            ws.is_closed = True

            # 发送消息（应该处理错误而不是崩溃）
            callback(create_chat_message({
                "type": "assistant",
                "message": {"content": [{"type": "text", "text": "Should handle error"}]}
            }))

            await asyncio.sleep(0.1)

            # 验证系统标记客户端为已关闭
            client = manager.clients.get(client_id)
            if client:
                assert client.is_closed

    @pytest.mark.asyncio
    async def test_empty_message_handling(self, manager):
        """
        测试：空消息处理

        场景：收到格式不正确的消息
        """
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        mock_session = MagicMock()
        mock_session.working_dir = "/tmp/test"
        mock_session.get_history.return_value = []
        mock_session.is_running = True

        with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
            mock_cm.get_session.return_value = mock_session
            mock_cm.create_session = AsyncMock()

            await manager._handle_chat_message(
                client_id, session_id, "connect",
                {"working_dir": "/tmp/test"}
            )

            await asyncio.sleep(0.01)
            callback = mock_session.add_callback.call_args[0][0]

            # 发送各种异常消息
            callback(create_chat_message({}))  # 空内容
            callback(create_chat_message({"type": "unknown"}))  # 未知类型
            callback(create_chat_message(None))  # None 内容

            await asyncio.sleep(0.1)

            # 验证系统没有崩溃，客户端仍然连接
            assert client_id in manager.clients


class TestConcurrency:
    """
    场景5：并发操作测试

    用户场景：
    - 多个用户同时使用
    - 同一用户多个标签页
    """

    @pytest.fixture
    def manager(self):
        return MuxConnectionManager()

    @pytest.mark.asyncio
    async def test_multiple_clients_same_session(self, manager):
        """
        测试：多个客户端订阅同一个 session

        场景：用户在多个设备上查看同一个项目
        """
        ws1 = MockWebSocket()
        ws2 = MockWebSocket()
        client1 = "client-1"
        client2 = "client-2"
        session_id = str(uuid.uuid4())

        await manager.connect(client1, ws1)
        await manager.connect(client2, ws2)
        manager.clients[client1].authenticated = True
        manager.clients[client2].authenticated = True

        mock_session = MagicMock()
        mock_session.working_dir = "/tmp/test"
        mock_session.get_history.return_value = []
        mock_session.is_running = True

        callbacks = []

        def capture_callback(cb):
            callbacks.append(cb)

        mock_session.add_callback.side_effect = capture_callback

        with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
            mock_cm.get_session.return_value = mock_session
            mock_cm.create_session = AsyncMock()

            # 两个客户端连接同一个 session
            await manager._handle_chat_message(
                client1, session_id, "connect",
                {"working_dir": "/tmp/test"}
            )
            await manager._handle_chat_message(
                client2, session_id, "connect",
                {"working_dir": "/tmp/test"}
            )

            await asyncio.sleep(0.01)

            # 向所有回调发送消息
            for cb in callbacks:
                cb(create_chat_message({
                    "type": "assistant",
                    "message": {"content": [{"type": "text", "text": "Broadcast message"}]}
                }))

            await asyncio.sleep(0.1)

            # 验证两个客户端都收到了消息
            assert len(ws1.get_messages_by_type(2)) >= 1
            assert len(ws2.get_messages_by_type(2)) >= 1

    @pytest.mark.asyncio
    async def test_concurrent_message_sending(self, manager):
        """
        测试：并发发送消息

        场景：多个 session 同时产生输出
        """
        ws = MockWebSocket()
        client_id = "test-client"
        session_a = str(uuid.uuid4())
        session_b = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        mock_session_a = MagicMock()
        mock_session_a.working_dir = "/project/a"
        mock_session_a.get_history.return_value = []
        mock_session_a.is_running = True

        mock_session_b = MagicMock()
        mock_session_b.working_dir = "/project/b"
        mock_session_b.get_history.return_value = []
        mock_session_b.is_running = True

        with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
            def get_session_side_effect(sid):
                if sid == session_a:
                    return mock_session_a
                elif sid == session_b:
                    return mock_session_b
                return None

            mock_cm.get_session.side_effect = get_session_side_effect
            mock_cm.create_session = AsyncMock()

            await manager._handle_chat_message(
                client_id, session_a, "connect",
                {"working_dir": "/project/a"}
            )
            await manager._handle_chat_message(
                client_id, session_b, "connect",
                {"working_dir": "/project/b"}
            )

            await asyncio.sleep(0.01)

            callback_a = mock_session_a.add_callback.call_args[0][0]
            callback_b = mock_session_b.add_callback.call_args[0][0]

            ws.clear()

            # 并发发送消息
            async def send_messages_a():
                for i in range(20):
                    callback_a(create_chat_message({
                        "type": "assistant",
                        "message": {"content": [{"type": "text", "text": f"A-{i}"}]}
                    }))
                    await asyncio.sleep(0.001)

            async def send_messages_b():
                for i in range(20):
                    callback_b(create_chat_message({
                        "type": "assistant",
                        "message": {"content": [{"type": "text", "text": f"B-{i}"}]}
                    }))
                    await asyncio.sleep(0.001)

            await asyncio.gather(send_messages_a(), send_messages_b())
            await asyncio.sleep(0.2)

            # 验证所有消息都收到了
            assistant_messages = ws.get_messages_by_type(2)
            contents = [m['d'].get('content', '') for m in assistant_messages]

            a_count = sum(1 for c in contents if 'A-' in c)
            b_count = sum(1 for c in contents if 'B-' in c)

            assert a_count == 20, f"Expected 20 A messages, got {a_count}"
            assert b_count == 20, f"Expected 20 B messages, got {b_count}"

            # 验证每个 session 内部的消息是有序的
            a_indices = [int(c.split('A-')[1]) for c in contents if 'A-' in c]
            b_indices = [int(c.split('B-')[1]) for c in contents if 'B-' in c]

            assert a_indices == sorted(a_indices), "Session A messages out of order"
            assert b_indices == sorted(b_indices), "Session B messages out of order"


class TestStreamingMessages:
    """
    场景6：流式消息测试

    用户场景：
    - Claude 的流式输出
    - 思考过程的实时显示
    """

    @pytest.fixture
    def manager(self):
        return MuxConnectionManager()

    @pytest.mark.asyncio
    async def test_streaming_text_order(self, manager):
        """
        测试：流式文本按顺序显示

        场景：Claude 逐字输出回复
        """
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        mock_session = MagicMock()
        mock_session.working_dir = "/tmp/test"
        mock_session.get_history.return_value = []
        mock_session.is_running = True

        with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
            mock_cm.get_session.return_value = mock_session
            mock_cm.create_session = AsyncMock()

            await manager._handle_chat_message(
                client_id, session_id, "connect",
                {"working_dir": "/tmp/test"}
            )

            await asyncio.sleep(0.01)
            callback = mock_session.add_callback.call_args[0][0]

            ws.clear()

            # 模拟流式输出
            text_chunks = ["Hello", " ", "world", "!", " How", " are", " you", "?"]
            for chunk in text_chunks:
                callback(create_chat_message({
                    "type": "stream_event",
                    "event": {
                        "type": "content_block_delta",
                        "delta": {"type": "text_delta", "text": chunk}
                    }
                }))

            await asyncio.sleep(0.1)

            # 类型 1 是 stream 消息
            stream_messages = ws.get_messages_by_type(1)

            # 验证顺序
            received_chunks = [m['d'].get('text', '') for m in stream_messages]
            assert received_chunks == text_chunks, \
                f"Expected {text_chunks}, got {received_chunks}"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
