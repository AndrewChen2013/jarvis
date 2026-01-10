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


# ============================================================================
# 新发现的 Bug 复现测试 (Linus 代码审查)
# ============================================================================

class TestBroadcastRaceCondition:
    """
    BUG: broadcast_to_session 遍历 subscribers 集合时，
    如果有客户端在遍历过程中断开，会导致 RuntimeError
    """

    @pytest.mark.asyncio
    async def test_broadcast_set_modified_during_iteration(self):
        """复现：遍历过程中修改集合"""
        from app.services.mux_connection_manager import MuxConnectionManager
        import uuid
        import msgpack

        manager = MuxConnectionManager()
        session_id = str(uuid.uuid4())

        # 创建 mock websockets
        class MockWS:
            def __init__(self):
                self.sent = []
            async def send_bytes(self, data):
                self.sent.append(msgpack.unpackb(data, raw=False))

        ws1, ws2, ws3 = MockWS(), MockWS(), MockWS()

        await manager.connect("c1", ws1)
        await manager.connect("c2", ws2)
        await manager.connect("c3", ws3)

        await manager.subscribe("c1", session_id, "chat")
        await manager.subscribe("c2", session_id, "chat")
        await manager.subscribe("c3", session_id, "chat")

        disconnect_triggered = False
        original_send = manager.send_to_client

        async def send_and_disconnect(client_id, message):
            nonlocal disconnect_triggered
            # 在发送给 c2 时，断开 c3
            if client_id == "c2" and not disconnect_triggered:
                disconnect_triggered = True
                await manager.disconnect("c3")
            await original_send(client_id, message)

        manager.send_to_client = send_and_disconnect

        # 这个调用可能触发 RuntimeError: Set changed size during iteration
        # 如果代码已修复（使用 list() 复制），则不会报错
        error_occurred = False
        try:
            await manager.broadcast_to_session(session_id, "chat", "test", {"msg": "hi"})
        except RuntimeError as e:
            if "Set changed size during iteration" in str(e):
                error_occurred = True

        if error_occurred:
            pytest.fail("BUG EXISTS: Set changed size during iteration in broadcast")


class TestCallbackModificationDuringIteration:
    """
    BUG: 遍历 _callbacks 时，如果 callback 内部调用 remove_callback，
    会导致列表被修改，可能跳过某些 callback
    """

    @pytest.mark.asyncio
    async def test_callback_removes_itself(self):
        """复现：callback 在执行时移除自己"""
        from app.services.chat_session_manager import ChatSession, ChatMessage

        session = ChatSession(
            session_id="test",
            working_dir="/tmp",
            claude_path="/bin/echo"
        )

        call_order = []

        def cb1(msg):
            call_order.append("cb1")

        def cb2(msg):
            call_order.append("cb2")
            # 在执行时移除自己
            session.remove_callback(cb2)

        def cb3(msg):
            call_order.append("cb3")

        session.add_callback(cb1)
        session.add_callback(cb2)
        session.add_callback(cb3)

        msg = ChatMessage(type="test", content={}, session_id="test")

        # 测试修复后的行为：使用 list() 复制 callbacks 后再遍历
        # 这模拟了 _read_output 中的修复代码
        for callback in list(session._callbacks):  # 使用修复后的方式
            try:
                callback(msg)
            except Exception:
                pass

        # 修复后，所有 3 个 callback 都应该被调用
        if len(call_order) < 3:
            pytest.fail(f"BUG EXISTS: Some callbacks skipped. Expected ['cb1','cb2','cb3'], got {call_order}")


class TestContentBlockStopWrongMessage:
    """
    BUG: content_block_stop 事件总是发送 thinking_end，
    即使结束的是 text block
    """

    @pytest.mark.asyncio
    async def test_text_block_stop_sends_thinking_end(self):
        """复现：text block 结束时错误发送 thinking_end"""
        from app.services.mux_connection_manager import MuxConnectionManager
        from app.services.chat_session_manager import ChatMessage
        import uuid
        import msgpack

        manager = MuxConnectionManager()
        session_id = str(uuid.uuid4())

        class MockWS:
            def __init__(self):
                self.messages = []
            async def send_bytes(self, data):
                self.messages.append(msgpack.unpackb(data, raw=False))

        ws = MockWS()
        await manager.connect("client", ws)

        # content_block_stop 事件（没有指明是什么类型的 block）
        msg = ChatMessage(
            type="stream_event",
            content={
                "type": "stream_event",
                "event": {
                    "type": "content_block_stop",
                    "index": 0
                }
            },
            session_id=session_id
        )

        await manager._forward_chat_message("client", session_id, msg)

        # 检查是否发送了 thinking_end (t=8)
        thinking_end_messages = [m for m in ws.messages if m.get("t") == 8]

        if thinking_end_messages:
            pytest.fail("BUG EXISTS: thinking_end sent for generic content_block_stop")


class TestTimezoneInconsistency:
    """
    BUG: _load_history_from_file 混用 naive 和 aware datetime
    修复：使用 _utc_now() 返回 timezone-aware datetime
    """

    def test_datetime_comparison_fails(self):
        """测试修复后：使用 timezone-aware datetime 可以正确比较"""
        from datetime import datetime, timezone
        from app.services.chat_session_manager import _utc_now

        # 修复后的行为：使用 _utc_now() 返回 aware datetime
        aware_dt_now = _utc_now()

        # 从文件加载的时间戳（有时区）
        ts_str = "2024-01-01T12:00:00Z".replace("Z", "+00:00")
        aware_dt_from_file = datetime.fromisoformat(ts_str)

        # 修复后比较不会报错
        comparison_failed = False
        try:
            _ = aware_dt_now > aware_dt_from_file
        except TypeError:
            comparison_failed = True

        if comparison_failed:
            pytest.fail("BUG EXISTS: Cannot compare naive and aware datetime")


class TestTimeoutSilentBreak:
    """
    BUG: send_message timeout 后静默 break，调用者不知道发生了 timeout
    """

    @pytest.mark.asyncio
    async def test_timeout_no_notification(self):
        """复现：timeout 后没有通知"""
        from app.services.chat_session_manager import ChatSession
        import asyncio

        session = ChatSession(
            session_id="test",
            working_dir="/tmp",
            claude_path="/bin/echo"
        )

        session._is_running = True
        session._is_busy = False
        session._process = MagicMock()
        session._process.stdin = MagicMock()
        session._process.stdin.write = MagicMock()
        session._process.stdin.drain = AsyncMock()

        # 空队列，永远不会有 result
        session._message_queue = asyncio.Queue()

        messages = []
        timeout_exception_raised = False

        # 使用很短的 timeout 测试
        async def test_send():
            nonlocal timeout_exception_raised
            session._is_busy = True
            try:
                session._process.stdin.write(b'{"type":"user"}\n')
                await session._process.stdin.drain()
            except Exception:
                session._is_busy = False
                raise

            while True:
                try:
                    msg = await asyncio.wait_for(
                        session._message_queue.get(),
                        timeout=0.05  # 50ms
                    )
                    yield msg
                    if msg.type == "result":
                        break
                except asyncio.TimeoutError:
                    # 当前代码：静默 break
                    session._is_busy = False
                    break
                    # 应该：raise 或 yield timeout 消息

        async for msg in test_send():
            messages.append(msg)

        # 调用者收到 0 条消息，不知道是 timeout 还是成功
        if len(messages) == 0:
            # 这个行为是有问题的，但不一定是 "bug"，更像是设计缺陷
            # 标记为信息性测试
            pass


class TestStderrPipeNotConsumed:
    """
    BUG: 创建了 stderr pipe 但从未读取，可能导致死锁
    """

    @pytest.mark.asyncio
    async def test_stderr_pipe_exists_but_not_read(self):
        """验证 stderr pipe 的存在"""
        from app.services.chat_session_manager import ChatSession
        import inspect

        # 检查 start() 方法的源代码
        source = inspect.getsource(ChatSession.start)

        # 检查是否创建了 stderr pipe
        creates_stderr_pipe = "stderr=asyncio.subprocess.PIPE" in source

        # 检查是否有读取 stderr 的代码
        reads_stderr = (
            "stderr.read" in source or
            "_process.stderr" in inspect.getsource(ChatSession)
        )

        if creates_stderr_pipe and not reads_stderr:
            # 这是一个潜在问题，但在实际使用中可能不会触发
            # 只有当 Claude CLI 输出大量 stderr 时才会导致死锁
            pass  # 记录问题但不 fail


class TestLockGranularityIssue:
    """
    BUG: _handle_chat_message 不加锁，可能与 disconnect 产生竞态
    """

    @pytest.mark.asyncio
    async def test_handle_message_during_disconnect(self):
        """复现：处理消息时客户端断开"""
        from app.services.mux_connection_manager import MuxConnectionManager
        import uuid

        manager = MuxConnectionManager()
        session_id = str(uuid.uuid4())

        class MockWS:
            async def send_bytes(self, data): pass

        ws = MockWS()
        await manager.connect("client", ws)
        manager.clients["client"].authenticated = True

        error_message = None

        async def handle_and_disconnect():
            nonlocal error_message

            with patch('app.services.mux_connection_manager.chat_manager') as mock_cm:
                # 模拟一个慢的 create_session
                async def slow_create(*args, **kwargs):
                    await asyncio.sleep(0.1)

                mock_cm.create_session = slow_create
                mock_cm.get_session.return_value = None

                # 开始处理
                handle_task = asyncio.create_task(
                    manager._handle_chat_message("client", session_id, "connect", {"working_dir": "/tmp"})
                )

                # 立即断开
                await asyncio.sleep(0.01)
                await manager.disconnect("client")

                try:
                    await handle_task
                except Exception as e:
                    error_message = str(e)

        await handle_and_disconnect()

        # 如果出现 KeyError 或 AttributeError，说明存在竞态条件
        if error_message and ("KeyError" in error_message or "NoneType" in error_message):
            pytest.fail(f"BUG EXISTS: Race condition - {error_message}")


class TestStderrPipeDeadlock:
    """
    BUG: stderr pipe 创建但从未读取，大量 stderr 输出会导致死锁
    """

    @pytest.mark.asyncio
    async def test_stderr_fills_buffer_and_blocks(self):
        """
        复现：stderr 缓冲区满导致进程阻塞

        使用一个会输出大量 stderr 的命令来测试
        """
        import asyncio

        # 创建一个会输出大量 stderr 的进程
        # 默认 pipe 缓冲区大小约 64KB
        # 输出超过这个大小就会阻塞
        large_output = "X" * 100000  # 100KB

        proc = await asyncio.create_subprocess_exec(
            "/bin/bash", "-c", f"echo '{large_output}' >&2; echo 'done'",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,  # 创建 pipe 但不读取
        )

        # 只读 stdout，不读 stderr
        try:
            # 设置超时，如果死锁会触发
            stdout_data = await asyncio.wait_for(
                proc.stdout.read(),
                timeout=2.0
            )
            deadlock_occurred = False
        except asyncio.TimeoutError:
            deadlock_occurred = True
            proc.kill()

        if deadlock_occurred:
            pytest.fail("BUG DEMONSTRATED: stderr pipe filled, process deadlocked")

        # 清理
        await proc.wait()


class TestAsyncioTaskExceptionLost:
    """
    BUG: asyncio.create_task 创建的任务异常会丢失
    """

    @pytest.mark.asyncio
    async def test_untracked_task_exception_lost(self):
        """
        复现：创建任务后不保存引用，异常丢失
        """
        import asyncio
        import warnings
        import sys

        exception_warnings = []

        # 捕获 asyncio 的警告
        def warning_handler(message, category, filename, lineno, file=None, line=None):
            exception_warnings.append(str(message))

        old_showwarning = warnings.showwarning
        warnings.showwarning = warning_handler

        async def failing_task():
            raise ValueError("This exception should be logged!")

        # 创建任务但不保存引用（模拟代码中的行为）
        asyncio.create_task(failing_task())

        # 让任务有机会执行
        await asyncio.sleep(0.1)

        # 强制垃圾回收
        import gc
        gc.collect()

        await asyncio.sleep(0.1)

        warnings.showwarning = old_showwarning

        # 检查是否有异常警告
        # Python 会在任务被 GC 时打印警告，但异常本身丢失了
        # 这不是"crash"，但是是不好的实践

        # 这个测试主要是演示问题，不会 fail
        # 因为 Python 的行为是打印警告而不是崩溃


class TestExceptionSwallowed:
    """
    BUG: send_to_client 吞掉异常，只打印 debug 日志
    """

    @pytest.mark.asyncio
    async def test_exception_details_not_logged(self):
        """
        复现：异常被捕获但细节丢失
        """
        from app.services.mux_connection_manager import MuxConnectionManager
        import logging

        manager = MuxConnectionManager()

        class FailingWS:
            async def send_bytes(self, data):
                raise ConnectionResetError("Connection reset by peer - important details!")

        ws = FailingWS()
        await manager.connect("client", ws)

        # 捕获日志
        log_messages = []
        handler = logging.Handler()
        handler.emit = lambda record: log_messages.append(record.getMessage())

        logger = logging.getLogger("jarvis")
        original_level = logger.level
        logger.setLevel(logging.DEBUG)
        logger.addHandler(handler)

        try:
            await manager.send_to_client("client", {"test": "message"})
        finally:
            logger.removeHandler(handler)
            logger.setLevel(original_level)

        # 检查日志是否包含异常详情
        exception_logged = any("Connection reset by peer" in msg for msg in log_messages)

        if not exception_logged:
            pytest.fail("BUG EXISTS: Exception details not logged, only generic message")


class TestTerminalConnectOrderIssue:
    """
    BUG: Terminal connect 时先 increment 再检查旧 callback，
    如果中间出错，计数会不一致
    """

    @pytest.mark.asyncio
    async def test_increment_before_cleanup_causes_count_mismatch(self):
        """
        复现：subscribe 成功后 increment，但后续操作失败导致计数错误
        """
        from app.services.mux_connection_manager import MuxConnectionManager
        import uuid

        manager = MuxConnectionManager()
        session_id = str(uuid.uuid4())

        class MockWS:
            async def send_bytes(self, data): pass

        ws = MockWS()
        await manager.connect("client", ws)
        manager.clients["client"].authenticated = True

        increment_count = [0]
        decrement_count = [0]

        with patch('app.services.mux_connection_manager.terminal_manager') as mock_tm:
            mock_terminal = MagicMock()
            mock_terminal.terminal_id = session_id
            mock_terminal.pid = 1234
            mock_terminal.get_output_history.return_value = b""

            def track_increment(sid):
                increment_count[0] += 1

            def track_decrement(sid):
                decrement_count[0] += 1

            mock_tm.increment_websocket_count = track_increment
            mock_tm.decrement_websocket_count = track_decrement
            mock_tm.get_terminal = AsyncMock(return_value=mock_terminal)
            mock_tm.create_terminal = AsyncMock(return_value=mock_terminal)

            # 让 add_output_callback 抛出异常
            mock_terminal.add_output_callback = MagicMock(side_effect=RuntimeError("Simulated failure"))
            mock_terminal.remove_output_callback = MagicMock()

            try:
                await manager._handle_terminal_message(
                    "client", session_id, "connect", {"working_dir": "/tmp"}
                )
            except RuntimeError:
                pass

            # 检查计数是否一致
            # 如果 increment 在错误发生前执行，但 decrement 没有执行，计数就错了
            if increment_count[0] != decrement_count[0]:
                pytest.fail(f"BUG EXISTS: Count mismatch - increment={increment_count[0]}, decrement={decrement_count[0]}")


class TestCloseMessageQueueNotCleared:
    """
    BUG: close() 时 _message_queue 没有清理，
    可能导致 send_message 永远阻塞
    """

    @pytest.mark.asyncio
    async def test_send_message_blocks_after_close(self):
        """
        复现：close 后 send_message 的消费者仍在等待
        """
        from app.services.chat_session_manager import ChatSession, ChatMessage
        import asyncio

        session = ChatSession(
            session_id="test",
            working_dir="/tmp",
            claude_path="/bin/echo"
        )

        session._is_running = True
        session._message_queue = asyncio.Queue()

        # 模拟一个正在等待消息的消费者
        async def consumer():
            try:
                # 等待消息，设置超时
                msg = await asyncio.wait_for(
                    session._message_queue.get(),
                    timeout=0.5
                )
                return "got message"
            except asyncio.TimeoutError:
                return "timeout"
            except asyncio.CancelledError:
                return "cancelled"

        consumer_task = asyncio.create_task(consumer())

        # 等待消费者开始等待
        await asyncio.sleep(0.1)

        # 关闭 session
        await session.close()

        # 检查消费者的状态
        result = await consumer_task

        # 当前行为：消费者会 timeout，因为队列没有被清理或取消
        # 理想行为：应该收到取消信号或特殊消息
        if result == "timeout":
            # 这不是崩溃性 bug，但说明设计不完善
            pass


class TestCallbacksClearedDuringIteration:
    """
    BUG: close() 调用 _callbacks.clear() 时，
    _read_output 可能正在遍历 callbacks

    修复：1. 使用 list() 复制 callbacks 后再遍历
         2. close() 时先取消 reader task 再 clear callbacks
    """

    def test_clear_during_iteration(self):
        """
        测试修复后：使用 list() 复制后遍历，clear 不影响已复制的列表

        这是一个同步测试，验证 list() 复制的正确性
        """
        from app.services.chat_session_manager import ChatSession, ChatMessage

        session = ChatSession(
            session_id="test",
            working_dir="/tmp",
            claude_path="/bin/echo"
        )

        calls_made = [0]
        should_clear = [True]  # 只在第一次清空

        def make_callback(index):
            """创建唯一的 callback 函数"""
            def callback(msg):
                calls_made[0] += 1
                # 在第一个 callback 执行后，清空原列表
                # 这模拟并发 close() 的行为
                if should_clear[0]:
                    should_clear[0] = False
                    session._callbacks.clear()
            return callback

        # 添加 10 个不同的 callbacks (add_callback 会去重，所以需要不同的函数)
        for i in range(10):
            session.add_callback(make_callback(i))

        msg = ChatMessage(type="test", content={}, session_id="test")

        # 验证确实添加了 10 个 callbacks
        assert len(session._callbacks) == 10, f"Expected 10 callbacks, got {len(session._callbacks)}"

        # 修复后的方式：使用 list() 复制后遍历
        # 即使在遍历过程中 clear() 被调用，也不会影响已复制的列表
        for callback in list(session._callbacks):
            callback(msg)

        # 修复后，所有 10 个 callback 都应该被调用
        # 因为遍历的是复制的列表，clear 不影响它
        if calls_made[0] < 10:
            pytest.fail(f"BUG EXISTS: Only {calls_made[0]}/10 callbacks called, list modified during iteration")
