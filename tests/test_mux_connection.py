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

    # 消息格式转换映射（与 mux_connection_manager.py 保持一致）
    CODE_TO_CHANNEL = {0: "terminal", 1: "chat", 2: "system"}
    CODE_TO_MSG_TYPE = {
        "terminal": {0: "connected", 1: "output", 2: "error", 3: "closed"},
        "chat": {
            0: "ready", 1: "stream", 2: "assistant", 3: "user",
            4: "tool_call", 5: "tool_result", 6: "thinking_start",
            7: "thinking_delta", 8: "thinking_end", 9: "thinking",
            10: "system", 11: "result", 12: "error", 13: "user_ack", 14: "history_end"
        },
        "system": {0: "auth_success", 1: "auth_failed", 2: "pong"},
    }

    def __init__(self):
        self.sent_messages = []
        self.sent_bytes = []
        self.closed = False

    def _convert_to_readable_format(self, msg: dict) -> dict:
        """将优化格式 (c/t/d/s) 转换为易读格式 (channel/type/data/session_id)"""
        if "c" in msg:
            # 优化格式，转换为易读格式
            channel = self.CODE_TO_CHANNEL.get(msg.get("c"), "unknown")
            type_code = msg.get("t")
            if isinstance(type_code, int):
                msg_type = self.CODE_TO_MSG_TYPE.get(channel, {}).get(type_code, str(type_code))
            else:
                msg_type = type_code

            result = {
                "channel": channel,
                "type": msg_type,
                "data": msg.get("d", {})
            }
            if "s" in msg:
                result["session_id"] = msg["s"]
            return result
        else:
            # 已经是易读格式
            return msg

    async def send_bytes(self, data):
        self.sent_bytes.append(data)
        # 解码 msgpack 并转换为易读格式
        raw_msg = msgpack.unpackb(data, raw=False)
        self.sent_messages.append(self._convert_to_readable_format(raw_msg))

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


class TestCallbackCleanup:
    """测试 callback 清理 - 防止重复注册导致消息串台"""

    @pytest.fixture
    def manager(self):
        return MuxConnectionManager()

    @pytest.mark.asyncio
    async def test_chat_reconnect_removes_old_callback(self, manager):
        """Chat 重连应该移除旧的 callback，只保留新的"""
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
            # 创建一个真实的 mock session 来追踪 callbacks
            mock_session = MagicMock()
            callbacks_list = []

            def add_callback(cb):
                callbacks_list.append(cb)

            def remove_callback(cb):
                if cb in callbacks_list:
                    callbacks_list.remove(cb)

            mock_session.add_callback = add_callback
            mock_session.remove_callback = remove_callback
            mock_session.get_history.return_value = []
            mock_session.working_dir = "/tmp"

            mock_cm.get_session.return_value = mock_session
            mock_cm.create_session = AsyncMock()

            # 第一次连接
            await manager._handle_chat_message(
                client_id,
                session_id,
                "connect",
                {"working_dir": "/tmp"}
            )

            # 应该有 1 个 callback
            assert len(callbacks_list) == 1
            first_callback = callbacks_list[0]

            # 模拟重连（同一个客户端再次发送 connect）
            await manager._handle_chat_message(
                client_id,
                session_id,
                "connect",
                {"working_dir": "/tmp"}
            )

            # 仍然应该只有 1 个 callback（旧的被移除，新的被添加）
            assert len(callbacks_list) == 1
            # 且不是同一个 callback
            assert callbacks_list[0] is not first_callback

    @pytest.mark.asyncio
    async def test_terminal_reconnect_removes_old_callback(self, manager):
        """Terminal 重连应该移除旧的 callback，只保留新的"""
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        with patch('app.services.mux_connection_manager.terminal_manager') as mock_tm:
            # 创建一个真实的 mock terminal 来追踪 callbacks
            mock_terminal = MagicMock()
            callbacks_list = []

            def add_output_callback(cb):
                callbacks_list.append(cb)

            def remove_output_callback(cb):
                if cb in callbacks_list:
                    callbacks_list.remove(cb)

            mock_terminal.add_output_callback = add_output_callback
            mock_terminal.remove_output_callback = remove_output_callback
            mock_terminal.terminal_id = session_id
            mock_terminal.pid = 1234
            mock_terminal.get_output_history.return_value = b""

            mock_tm.get_terminal = AsyncMock(return_value=mock_terminal)
            mock_tm.create_terminal = AsyncMock(return_value=mock_terminal)
            mock_tm.increment_websocket_count = MagicMock()
            mock_tm.decrement_websocket_count = MagicMock()

            # 第一次连接
            await manager._handle_terminal_message(
                client_id,
                session_id,
                "connect",
                {"working_dir": "/tmp"}
            )

            # 应该有 1 个 callback
            assert len(callbacks_list) == 1
            first_callback = callbacks_list[0]

            # 模拟重连
            await manager._handle_terminal_message(
                client_id,
                session_id,
                "connect",
                {"working_dir": "/tmp"}
            )

            # 仍然应该只有 1 个 callback
            assert len(callbacks_list) == 1
            # 且不是同一个 callback
            assert callbacks_list[0] is not first_callback

    @pytest.mark.asyncio
    async def test_closure_captures_correct_values(self, manager):
        """闭包应该捕获正确的 client_id 和 session_id 值"""
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        captured_values = []

        with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
            mock_session = MagicMock()

            def add_callback(cb):
                # 检查闭包的默认参数值
                import inspect
                sig = inspect.signature(cb)
                params = sig.parameters
                if 'cid' in params and 'sid' in params:
                    captured_values.append({
                        'cid': params['cid'].default,
                        'sid': params['sid'].default
                    })

            mock_session.add_callback = add_callback
            mock_session.remove_callback = MagicMock()
            mock_session.get_history.return_value = []
            mock_session.working_dir = "/tmp"

            mock_cm.get_session.return_value = mock_session
            mock_cm.create_session = AsyncMock()

            await manager._handle_chat_message(
                client_id,
                session_id,
                "connect",
                {"working_dir": "/tmp"}
            )

            # 验证闭包捕获了正确的值
            assert len(captured_values) == 1
            assert captured_values[0]['cid'] == client_id
            assert captured_values[0]['sid'] == session_id

    @pytest.mark.asyncio
    async def test_multiple_clients_same_session_each_has_own_callback(self, manager):
        """多个客户端连接同一个session，每个客户端应该有独立的callback"""
        ws1 = MockWebSocket()
        ws2 = MockWebSocket()
        client_id_1 = "client-1"
        client_id_2 = "client-2"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id_1, ws1)
        await manager.connect(client_id_2, ws2)
        manager.clients[client_id_1].authenticated = True
        manager.clients[client_id_2].authenticated = True

        with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
            mock_session = MagicMock()
            callbacks_list = []

            def add_callback(cb):
                callbacks_list.append(cb)

            def remove_callback(cb):
                if cb in callbacks_list:
                    callbacks_list.remove(cb)

            mock_session.add_callback = add_callback
            mock_session.remove_callback = remove_callback
            mock_session.get_history.return_value = []
            mock_session.working_dir = "/tmp"

            mock_cm.get_session.return_value = mock_session
            mock_cm.create_session = AsyncMock()

            # 两个客户端都连接同一个session
            await manager._handle_chat_message(
                client_id_1, session_id, "connect", {"working_dir": "/tmp"}
            )
            await manager._handle_chat_message(
                client_id_2, session_id, "connect", {"working_dir": "/tmp"}
            )

            # 应该有2个独立的callback
            assert len(callbacks_list) == 2
            # 两个callback应该是不同的函数对象
            assert callbacks_list[0] is not callbacks_list[1]

    @pytest.mark.asyncio
    async def test_disconnect_removes_callback_from_session(self, manager):
        """断开连接应该从session中移除callback"""
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
            mock_session = MagicMock()
            callbacks_list = []

            def add_callback(cb):
                callbacks_list.append(cb)

            def remove_callback(cb):
                if cb in callbacks_list:
                    callbacks_list.remove(cb)

            mock_session.add_callback = add_callback
            mock_session.remove_callback = remove_callback
            mock_session.get_history.return_value = []
            mock_session.working_dir = "/tmp"

            mock_cm.get_session.return_value = mock_session
            mock_cm.create_session = AsyncMock()

            # 连接
            await manager._handle_chat_message(
                client_id, session_id, "connect", {"working_dir": "/tmp"}
            )
            assert len(callbacks_list) == 1

            # 断开连接
            await manager.disconnect(client_id)

            # callback应该被移除
            assert len(callbacks_list) == 0

    @pytest.mark.asyncio
    async def test_multiple_reconnects_only_one_callback(self, manager):
        """多次重连后应该只有一个callback"""
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
            mock_session = MagicMock()
            callbacks_list = []

            def add_callback(cb):
                callbacks_list.append(cb)

            def remove_callback(cb):
                if cb in callbacks_list:
                    callbacks_list.remove(cb)

            mock_session.add_callback = add_callback
            mock_session.remove_callback = remove_callback
            mock_session.get_history.return_value = []
            mock_session.working_dir = "/tmp"

            mock_cm.get_session.return_value = mock_session
            mock_cm.create_session = AsyncMock()

            # 模拟5次重连
            for i in range(5):
                await manager._handle_chat_message(
                    client_id, session_id, "connect", {"working_dir": "/tmp"}
                )

            # 无论重连多少次，都只应该有1个callback
            assert len(callbacks_list) == 1

    @pytest.mark.asyncio
    async def test_different_sessions_have_separate_callbacks(self, manager):
        """同一客户端连接不同session，每个session应该有独立的callback"""
        ws = MockWebSocket()
        client_id = "test-client"
        session_id_1 = str(uuid.uuid4())
        session_id_2 = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
            # 为每个session创建独立的mock和callback列表
            sessions = {}

            def get_or_create_session(sid):
                if sid not in sessions:
                    mock_session = MagicMock()
                    mock_session.callbacks_list = []
                    mock_session.add_callback = lambda cb, s=mock_session: s.callbacks_list.append(cb)
                    mock_session.remove_callback = lambda cb, s=mock_session: s.callbacks_list.remove(cb) if cb in s.callbacks_list else None
                    mock_session.get_history.return_value = []
                    mock_session.working_dir = "/tmp"
                    sessions[sid] = mock_session
                return sessions[sid]

            mock_cm.get_session.side_effect = get_or_create_session
            mock_cm.create_session = AsyncMock()

            # 连接两个不同的session
            await manager._handle_chat_message(
                client_id, session_id_1, "connect", {"working_dir": "/tmp"}
            )
            await manager._handle_chat_message(
                client_id, session_id_2, "connect", {"working_dir": "/tmp"}
            )

            # 每个session应该有1个callback
            assert len(sessions[session_id_1].callbacks_list) == 1
            assert len(sessions[session_id_2].callbacks_list) == 1

            # 客户端应该有2个chat_callbacks
            client = manager.clients[client_id]
            assert len(client.chat_callbacks) == 2
            assert session_id_1 in client.chat_callbacks
            assert session_id_2 in client.chat_callbacks


class TestMessageDelivery:
    """测试消息投递正确性 - 确保消息发送到正确的客户端"""

    @pytest.fixture
    def manager(self):
        return MuxConnectionManager()

    @pytest.mark.asyncio
    async def test_message_delivered_to_correct_client(self, manager):
        """消息应该只发送给订阅了该session的客户端"""
        ws1 = MockWebSocket()
        ws2 = MockWebSocket()
        ws3 = MockWebSocket()

        session_a = str(uuid.uuid4())
        session_b = str(uuid.uuid4())

        await manager.connect("client-1", ws1)
        await manager.connect("client-2", ws2)
        await manager.connect("client-3", ws3)

        # client-1 订阅 session_a
        # client-2 订阅 session_b
        # client-3 订阅两个session
        await manager.subscribe("client-1", session_a, "chat")
        await manager.subscribe("client-2", session_b, "chat")
        await manager.subscribe("client-3", session_a, "chat")
        await manager.subscribe("client-3", session_b, "chat")

        # 向 session_a 广播
        await manager.broadcast_to_session(session_a, "chat", "message", {"text": "Hello A"})

        # client-1 和 client-3 应该收到
        assert len(ws1.sent_messages) == 1
        assert len(ws3.sent_messages) == 1
        # client-2 不应该收到
        assert len(ws2.sent_messages) == 0

        # 向 session_b 广播
        await manager.broadcast_to_session(session_b, "chat", "message", {"text": "Hello B"})

        # client-2 和 client-3 应该收到
        assert len(ws2.sent_messages) == 1
        assert len(ws3.sent_messages) == 2  # 之前1条 + 现在1条

    @pytest.mark.asyncio
    async def test_closed_client_not_receive_messages(self, manager):
        """已关闭的客户端不应该收到消息"""
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        await manager.subscribe(client_id, session_id, "chat")

        # 标记客户端为已关闭
        manager.clients[client_id].is_closed = True

        # 尝试发送消息
        await manager.broadcast_to_session(session_id, "chat", "message", {"text": "test"})

        # 不应该收到消息（因为已关闭）
        assert len(ws.sent_messages) == 0


class TestConcurrentReconnect:
    """测试并发重连场景"""

    @pytest.fixture
    def manager(self):
        return MuxConnectionManager()

    @pytest.mark.asyncio
    async def test_rapid_reconnect_no_duplicate_callbacks(self, manager):
        """快速重连不应该导致重复callback"""
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
            mock_session = MagicMock()
            callbacks_list = []

            def add_callback(cb):
                callbacks_list.append(cb)

            def remove_callback(cb):
                if cb in callbacks_list:
                    callbacks_list.remove(cb)

            mock_session.add_callback = add_callback
            mock_session.remove_callback = remove_callback
            mock_session.get_history.return_value = []
            mock_session.working_dir = "/tmp"

            mock_cm.get_session.return_value = mock_session
            mock_cm.create_session = AsyncMock()

            # 并发发送多个connect请求
            tasks = [
                manager._handle_chat_message(
                    client_id, session_id, "connect", {"working_dir": "/tmp"}
                )
                for _ in range(10)
            ]
            await asyncio.gather(*tasks)

            # 最终应该只有1个callback
            assert len(callbacks_list) == 1

    @pytest.mark.asyncio
    async def test_client_callbacks_dict_consistency(self, manager):
        """client.chat_callbacks 字典应该保持一致"""
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
            mock_session = MagicMock()
            callbacks_list = []

            def add_callback(cb):
                callbacks_list.append(cb)

            def remove_callback(cb):
                if cb in callbacks_list:
                    callbacks_list.remove(cb)

            mock_session.add_callback = add_callback
            mock_session.remove_callback = remove_callback
            mock_session.get_history.return_value = []
            mock_session.working_dir = "/tmp"

            mock_cm.get_session.return_value = mock_session
            mock_cm.create_session = AsyncMock()

            # 多次重连
            for _ in range(5):
                await manager._handle_chat_message(
                    client_id, session_id, "connect", {"working_dir": "/tmp"}
                )

            client = manager.clients[client_id]

            # chat_callbacks 中的 callback 应该与 session 中的 callback 一致
            assert session_id in client.chat_callbacks
            assert client.chat_callbacks[session_id] in callbacks_list
            assert len(callbacks_list) == 1


class TestTerminalCallbackCleanup:
    """Terminal callback 清理的额外测试"""

    @pytest.fixture
    def manager(self):
        return MuxConnectionManager()

    @pytest.mark.asyncio
    async def test_terminal_disconnect_cleans_callback(self, manager):
        """Terminal disconnect 应该清理 callback"""
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        with patch('app.services.mux_connection_manager.terminal_manager') as mock_tm:
            mock_terminal = MagicMock()
            callbacks_list = []

            def add_output_callback(cb):
                callbacks_list.append(cb)

            def remove_output_callback(cb):
                if cb in callbacks_list:
                    callbacks_list.remove(cb)

            mock_terminal.add_output_callback = add_output_callback
            mock_terminal.remove_output_callback = remove_output_callback
            mock_terminal.terminal_id = session_id
            mock_terminal.pid = 1234
            mock_terminal.get_output_history.return_value = b""

            mock_tm.get_terminal = AsyncMock(return_value=mock_terminal)
            mock_tm.create_terminal = AsyncMock(return_value=mock_terminal)
            mock_tm.increment_websocket_count = MagicMock()
            mock_tm.decrement_websocket_count = MagicMock()

            # 连接
            await manager._handle_terminal_message(
                client_id, session_id, "connect", {"working_dir": "/tmp"}
            )
            assert len(callbacks_list) == 1

            # 通过 unsubscribe 断开
            await manager.unsubscribe(client_id, session_id)

            # callback 应该被移除
            assert len(callbacks_list) == 0
            # decrement_websocket_count 应该被调用
            mock_tm.decrement_websocket_count.assert_called()

    @pytest.mark.asyncio
    async def test_terminal_websocket_count_management(self, manager):
        """Terminal websocket count 应该正确管理"""
        ws = MockWebSocket()
        client_id = "test-client"
        session_id = str(uuid.uuid4())

        await manager.connect(client_id, ws)
        manager.clients[client_id].authenticated = True

        with patch('app.services.mux_connection_manager.terminal_manager') as mock_tm:
            mock_terminal = MagicMock()
            mock_terminal.add_output_callback = MagicMock()
            mock_terminal.remove_output_callback = MagicMock()
            mock_terminal.terminal_id = session_id
            mock_terminal.pid = 1234
            mock_terminal.get_output_history.return_value = b""

            mock_tm.get_terminal = AsyncMock(return_value=mock_terminal)
            mock_tm.create_terminal = AsyncMock(return_value=mock_terminal)
            mock_tm.increment_websocket_count = MagicMock()
            mock_tm.decrement_websocket_count = MagicMock()

            # 第一次连接
            await manager._handle_terminal_message(
                client_id, session_id, "connect", {"working_dir": "/tmp"}
            )

            # increment 应该被调用1次
            assert mock_tm.increment_websocket_count.call_count == 1

            # 重连（模拟网络断开后重连）
            await manager._handle_terminal_message(
                client_id, session_id, "connect", {"working_dir": "/tmp"}
            )

            # 重连时：先 decrement（清理旧的），再 increment（新的）
            # 所以 increment 应该是 2 次，decrement 应该是 1 次
            assert mock_tm.increment_websocket_count.call_count == 2
            assert mock_tm.decrement_websocket_count.call_count == 1
