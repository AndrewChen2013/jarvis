# Copyright (c) 2025 BillChen
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""
MuxConnectionManager 测试用例

测试场景：
1. 客户端连接和断开
2. 认证流程
3. Session 订阅和取消订阅
4. 消息路由
5. 多客户端连接同一 session
6. 广播消息
7. Terminal 消息处理
8. Chat 消息处理
"""

import pytest
import asyncio
import uuid
import msgpack
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from datetime import datetime

# 导入被测试的模块
from app.services.mux_connection_manager import MuxConnectionManager, MuxClient
from app.core.config import settings


class MockWebSocket:
    """Mock WebSocket 对象"""

    def __init__(self):
        self.sent_messages = []
        self.sent_bytes = []
        self.closed = False

    async def send_bytes(self, data):
        self.sent_bytes.append(data)
        # 解码 msgpack 以便验证
        self.sent_messages.append(msgpack.unpackb(data, raw=False))

    async def send_text(self, data):
        self.sent_messages.append(data)

    async def close(self):
        self.closed = True

    async def accept(self):
        pass


class TestClientConnection:
    """测试客户端连接管理"""

    @pytest.fixture
    def manager(self):
        return MuxConnectionManager()

    @pytest.mark.asyncio
    async def test_connect_registers_client(self, manager):
        """连接应该注册客户端"""
        ws = MockWebSocket()
        client_id = "test-client-1"

        client = await manager.connect(client_id, ws)

        assert client_id in manager.clients
        assert manager.clients[client_id] is client
        assert client.websocket is ws
        assert client.authenticated is False

    @pytest.mark.asyncio
    async def test_disconnect_removes_client(self, manager):
        """断开应该移除客户端"""
        ws = MockWebSocket()
        client_id = "test-client-1"

        await manager.connect(client_id, ws)
        await manager.disconnect(client_id)

        assert client_id not in manager.clients

    @pytest.mark.asyncio
    async def test_disconnect_nonexistent_client_no_error(self, manager):
        """断开不存在的客户端不应该报错"""
        await manager.disconnect("non-existent-client")


class TestAuthentication:
    """测试认证流程"""

    @pytest.fixture
    def manager(self):
        return MuxConnectionManager()

    @pytest.mark.asyncio
    async def test_auth_success(self, manager):
        """正确的 token 应该认证成功"""
        ws = MockWebSocket()
        client_id = "test-client"
        await manager.connect(client_id, ws)

        message = {
            "channel": "system",
            "type": "auth",
            "data": {"token": settings.AUTH_TOKEN}
        }

        await manager._handle_system_message(client_id, "auth", message["data"])

        client = manager.clients[client_id]
        assert client.authenticated is True

        # 应该发送 auth_success 消息
        assert len(ws.sent_messages) == 1
        assert ws.sent_messages[0]["type"] == "auth_success"

    @pytest.mark.asyncio
    async def test_auth_failure(self, manager):
        """错误的 token 应该认证失败"""
        ws = MockWebSocket()
        client_id = "test-client"
        await manager.connect(client_id, ws)

        message = {
            "channel": "system",
            "type": "auth",
            "data": {"token": "wrong-token"}
        }

        await manager._handle_system_message(client_id, "auth", message["data"])

        client = manager.clients[client_id]
        assert client.authenticated is False

        # 应该发送 auth_failed 消息
        assert len(ws.sent_messages) == 1
        assert ws.sent_messages[0]["type"] == "auth_failed"

    @pytest.mark.asyncio
    async def test_ping_pong(self, manager):
        """ping 应该返回 pong"""
        ws = MockWebSocket()
        client_id = "test-client"
        await manager.connect(client_id, ws)

        await manager._handle_system_message(client_id, "ping", {})

        assert len(ws.sent_messages) == 1
        assert ws.sent_messages[0]["type"] == "pong"


class TestSubscription:
    """测试订阅管理"""

    @pytest.fixture
    def manager(self):
        return MuxConnectionManager()

    @pytest.mark.asyncio
    async def test_subscribe_adds_to_subscriptions(self, manager):
        """订阅应该添加到订阅列表"""
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = "test-session"

        await manager.connect(client_id, ws)
        await manager.subscribe(client_id, session_id, "terminal")

        client = manager.clients[client_id]
        assert session_id in client.subscriptions
        assert client_id in manager.session_subscribers[session_id]

    @pytest.mark.asyncio
    async def test_unsubscribe_removes_from_subscriptions(self, manager):
        """取消订阅应该从订阅列表移除"""
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = "test-session"

        await manager.connect(client_id, ws)
        await manager.subscribe(client_id, session_id, "terminal")
        await manager.unsubscribe(client_id, session_id)

        client = manager.clients[client_id]
        assert session_id not in client.subscriptions
        assert session_id not in manager.session_subscribers

    @pytest.mark.asyncio
    async def test_multiple_clients_subscribe_same_session(self, manager):
        """多个客户端可以订阅同一个 session"""
        ws1 = MockWebSocket()
        ws2 = MockWebSocket()
        session_id = "shared-session"

        await manager.connect("client-1", ws1)
        await manager.connect("client-2", ws2)

        await manager.subscribe("client-1", session_id, "terminal")
        await manager.subscribe("client-2", session_id, "terminal")

        assert len(manager.session_subscribers[session_id]) == 2
        assert "client-1" in manager.session_subscribers[session_id]
        assert "client-2" in manager.session_subscribers[session_id]

    @pytest.mark.asyncio
    async def test_disconnect_cleans_up_subscriptions(self, manager):
        """断开连接应该清理订阅"""
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = "test-session"

        await manager.connect(client_id, ws)
        await manager.subscribe(client_id, session_id, "terminal")
        await manager.disconnect(client_id)

        # session_subscribers 应该被清理
        assert session_id not in manager.session_subscribers


class TestBroadcast:
    """测试消息广播"""

    @pytest.fixture
    def manager(self):
        return MuxConnectionManager()

    @pytest.mark.asyncio
    async def test_broadcast_to_all_subscribers(self, manager):
        """广播应该发送给所有订阅者"""
        ws1 = MockWebSocket()
        ws2 = MockWebSocket()
        ws3 = MockWebSocket()
        session_id = "test-session"

        await manager.connect("client-1", ws1)
        await manager.connect("client-2", ws2)
        await manager.connect("client-3", ws3)

        await manager.subscribe("client-1", session_id, "terminal")
        await manager.subscribe("client-2", session_id, "terminal")
        # client-3 没有订阅

        await manager.broadcast_to_session(
            session_id,
            "terminal",
            "output",
            {"text": "Hello"}
        )

        # client-1 和 client-2 应该收到消息
        assert len(ws1.sent_messages) == 1
        assert len(ws2.sent_messages) == 1
        # client-3 不应该收到
        assert len(ws3.sent_messages) == 0

    @pytest.mark.asyncio
    async def test_broadcast_message_format(self, manager):
        """广播消息格式应该正确"""
        ws = MockWebSocket()
        session_id = "test-session"

        await manager.connect("client-1", ws)
        await manager.subscribe("client-1", session_id, "terminal")

        await manager.broadcast_to_session(
            session_id,
            "terminal",
            "output",
            {"text": "Hello World"}
        )

        msg = ws.sent_messages[0]
        assert msg["channel"] == "terminal"
        assert msg["session_id"] == session_id
        assert msg["type"] == "output"
        assert msg["data"]["text"] == "Hello World"


class TestMessageRouting:
    """测试消息路由"""

    @pytest.fixture
    def manager(self):
        return MuxConnectionManager()

    @pytest.mark.asyncio
    async def test_route_to_terminal_handler(self, manager):
        """terminal channel 消息应该路由到 terminal handler"""
        ws = MockWebSocket()
        client_id = "test-client"

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        with patch.object(manager, '_handle_terminal_message', new_callable=AsyncMock) as mock:
            await manager.route_message(client_id, {
                "channel": "terminal",
                "session_id": "test-session",
                "type": "input",
                "data": {"text": "hello"}
            })

            mock.assert_called_once()

    @pytest.mark.asyncio
    async def test_route_to_chat_handler(self, manager):
        """chat channel 消息应该路由到 chat handler"""
        ws = MockWebSocket()
        client_id = "test-client"

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        with patch.object(manager, '_handle_chat_message', new_callable=AsyncMock) as mock:
            await manager.route_message(client_id, {
                "channel": "chat",
                "session_id": "test-session",
                "type": "message",
                "data": {"content": "hello"}
            })

            mock.assert_called_once()

    @pytest.mark.asyncio
    async def test_route_to_system_handler(self, manager):
        """system channel 消息应该路由到 system handler"""
        ws = MockWebSocket()
        client_id = "test-client"

        await manager.connect(client_id, ws)

        with patch.object(manager, '_handle_system_message', new_callable=AsyncMock) as mock:
            await manager.route_message(client_id, {
                "channel": "system",
                "type": "ping",
                "data": {}
            })

            mock.assert_called_once()


class TestTerminalMessages:
    """测试 Terminal 消息处理"""

    @pytest.fixture
    def manager(self):
        return MuxConnectionManager()

    @pytest.mark.asyncio
    async def test_terminal_connect_creates_or_reuses_terminal(self, manager):
        """terminal connect 应该创建或复用终端"""
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        with patch('app.services.mux_connection_manager.terminal_manager') as mock_tm:
            mock_terminal = MagicMock()
            mock_terminal.terminal_id = session_id
            mock_terminal.pid = 1234
            mock_terminal.get_output_history.return_value = b""
            mock_tm.get_terminal = AsyncMock(return_value=None)
            mock_tm.create_terminal = AsyncMock(return_value=mock_terminal)
            mock_tm.increment_websocket_count = MagicMock()

            await manager._handle_terminal_message(
                client_id,
                session_id,
                "connect",
                {"working_dir": "/tmp", "rows": 40, "cols": 120}
            )

            # 应该尝试创建终端
            mock_tm.create_terminal.assert_called_once()

            # 应该发送 connected 消息
            connected_msg = next(
                (m for m in ws.sent_messages if m.get("type") == "connected"),
                None
            )
            assert connected_msg is not None
            assert connected_msg["data"]["terminal_id"] == session_id

    @pytest.mark.asyncio
    async def test_terminal_connect_with_temp_id_generates_uuid(self, manager):
        """临时 ID (new-xxx) 应该让后端生成新 UUID"""
        ws = MockWebSocket()
        client_id = "test-client"
        temp_session_id = "new-1234567890"
        real_uuid = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        with patch('app.services.mux_connection_manager.terminal_manager') as mock_tm:
            mock_terminal = MagicMock()
            mock_terminal.terminal_id = real_uuid
            mock_terminal.pid = 1234
            mock_terminal.get_output_history.return_value = b""
            mock_tm.get_terminal = AsyncMock(return_value=None)
            mock_tm.create_terminal = AsyncMock(return_value=mock_terminal)
            mock_tm.increment_websocket_count = MagicMock()

            await manager._handle_terminal_message(
                client_id,
                temp_session_id,  # 临时 ID
                "connect",
                {"working_dir": "/tmp"}
            )

            # connected 消息应该包含 original_session_id
            connected_msg = next(
                (m for m in ws.sent_messages if m.get("type") == "connected"),
                None
            )
            assert connected_msg is not None
            assert connected_msg["data"]["original_session_id"] == temp_session_id
            assert connected_msg["data"]["terminal_id"] == real_uuid

    @pytest.mark.asyncio
    async def test_terminal_input_writes_to_terminal(self, manager):
        """terminal input 应该写入终端"""
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        with patch('app.services.mux_connection_manager.terminal_manager') as mock_tm:
            mock_terminal = MagicMock()
            mock_tm.get_terminal = AsyncMock(return_value=mock_terminal)
            mock_tm.write = AsyncMock()

            await manager._handle_terminal_message(
                client_id,
                session_id,
                "input",
                {"text": "ls -la\n"}
            )

            mock_tm.write.assert_called_once_with(session_id, "ls -la\n")

    @pytest.mark.asyncio
    async def test_terminal_resize(self, manager):
        """terminal resize 应该调整终端大小"""
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        with patch('app.services.mux_connection_manager.terminal_manager') as mock_tm:
            mock_terminal = MagicMock()
            mock_tm.get_terminal = AsyncMock(return_value=mock_terminal)
            mock_tm.resize = AsyncMock()

            await manager._handle_terminal_message(
                client_id,
                session_id,
                "resize",
                {"rows": 50, "cols": 150}
            )

            mock_tm.resize.assert_called_once_with(session_id, 50, 150)


class TestMultiClientScenarios:
    """测试多客户端场景"""

    @pytest.fixture
    def manager(self):
        return MuxConnectionManager()

    @pytest.mark.asyncio
    async def test_two_clients_same_terminal_both_receive_output(self, manager):
        """两个客户端连接同一终端，都应该收到输出"""
        ws1 = MockWebSocket()
        ws2 = MockWebSocket()
        session_id = "shared-session"

        await manager.connect("client-1", ws1)
        await manager.connect("client-2", ws2)

        await manager.subscribe("client-1", session_id, "terminal")
        await manager.subscribe("client-2", session_id, "terminal")

        # 模拟终端输出
        await manager.broadcast_to_session(
            session_id,
            "terminal",
            "output",
            {"text": "Command output here"}
        )

        # 两个客户端都应该收到
        assert len(ws1.sent_messages) == 1
        assert len(ws2.sent_messages) == 1
        assert ws1.sent_messages[0]["data"]["text"] == "Command output here"
        assert ws2.sent_messages[0]["data"]["text"] == "Command output here"

    @pytest.mark.asyncio
    async def test_one_client_disconnects_other_still_receives(self, manager):
        """一个客户端断开，另一个仍应该收到消息"""
        ws1 = MockWebSocket()
        ws2 = MockWebSocket()
        session_id = "shared-session"

        await manager.connect("client-1", ws1)
        await manager.connect("client-2", ws2)

        await manager.subscribe("client-1", session_id, "terminal")
        await manager.subscribe("client-2", session_id, "terminal")

        # client-1 断开
        await manager.disconnect("client-1")

        # 广播消息
        await manager.broadcast_to_session(
            session_id,
            "terminal",
            "output",
            {"text": "After disconnect"}
        )

        # 只有 client-2 应该收到
        # ws1 在断开前没有新消息
        assert len(ws2.sent_messages) == 1


class TestStats:
    """测试统计信息"""

    @pytest.fixture
    def manager(self):
        return MuxConnectionManager()

    @pytest.mark.asyncio
    async def test_get_stats(self, manager):
        """获取统计信息"""
        ws1 = MockWebSocket()
        ws2 = MockWebSocket()

        await manager.connect("client-1", ws1)
        await manager.connect("client-2", ws2)
        manager.clients["client-1"].authenticated = True

        await manager.subscribe("client-1", "session-1", "terminal")
        await manager.subscribe("client-2", "session-1", "terminal")

        stats = manager.get_stats()

        assert stats["connected_clients"] == 2
        assert stats["active_sessions"] == 1
        assert len(stats["clients"]) == 2
