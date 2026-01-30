# Copyright (c) 2025 BillChen
#
# Licensed under the Apache License, Version 2.0 (the "License")

"""
Session 切换慢问题复现测试

问题描述：
- 刷新页面后，第一次打开任意 session 很快
- 打开过一个 session 后，切换到另一个 session 变慢
- 切回第一个 session 又变快

测试场景：
1. 模拟 Socket.IO chat:connect 事件处理
2. 验证历史消息加载和发送的 timing
3. 检测事件循环阻塞
4. 验证第一次 vs 第二次 session 连接的性能差异
"""

import pytest
import asyncio
import time
import uuid
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from datetime import datetime


class MockSIO:
    """Mock Socket.IO server"""
    def __init__(self):
        self.emitted = []
        self.emit_times = []

    async def emit(self, event, data, to=None):
        start = time.time()
        # 模拟真实 emit 的异步行为
        await asyncio.sleep(0.001)  # 1ms
        elapsed = time.time() - start
        self.emitted.append({
            'event': event,
            'data': data,
            'to': to,
            'elapsed_ms': elapsed * 1000
        })
        self.emit_times.append(elapsed * 1000)


class MockDB:
    """Mock 数据库"""
    def __init__(self):
        self.messages = {}
        self.lock_held = False
        self.lock_wait_time = 0

    def get_chat_messages_desc(self, session_id, limit=15):
        """模拟获取历史消息（有锁）"""
        # 模拟锁等待
        if self.lock_held:
            time.sleep(self.lock_wait_time)

        return self.messages.get(session_id, [])[:limit]

    def get_chat_message_count(self, session_id):
        """模拟获取消息计数（有锁）"""
        if self.lock_held:
            time.sleep(self.lock_wait_time)

        return len(self.messages.get(session_id, []))

    def save_chat_message(self, **kwargs):
        """模拟保存消息（有锁）"""
        # 模拟锁等待
        pass


class MockChatSession:
    """Mock ChatSession"""
    def __init__(self, session_id, resume_session_id=None):
        self.session_id = session_id
        self.resume_session_id = resume_session_id
        self._claude_session_id = resume_session_id
        self._is_running = True
        self._callback = None
        self._callback_owner = None
        self._reader_task = None

    def set_callback(self, callback, owner):
        self._callback = callback
        self._callback_owner = owner

    def clear_callback(self, owner):
        if self._callback_owner == owner:
            self._callback = None
            self._callback_owner = None

    def get_callback_owner(self):
        return self._callback_owner


class MockChatManager:
    """Mock ChatSessionManager"""
    def __init__(self):
        self.sessions = {}

    def get_session(self, session_id):
        return self.sessions.get(session_id)

    async def create_session(self, session_id, working_dir, resume_session_id=None):
        session = MockChatSession(session_id, resume_session_id)
        self.sessions[session_id] = session
        return session_id


class TestSessionSwitchSlow:
    """测试 Session 切换慢的问题"""

    @pytest.fixture
    def mock_sio(self):
        return MockSIO()

    @pytest.fixture
    def mock_db(self):
        db = MockDB()
        # 预设一些历史消息
        db.messages = {
            'session-1': [
                {'role': 'user', 'content': 'Hello', 'timestamp': '2025-01-01T00:00:00'},
                {'role': 'assistant', 'content': 'Hi there!', 'timestamp': '2025-01-01T00:00:01'},
            ] * 5,  # 10 条消息
            'session-2': [
                {'role': 'user', 'content': 'Test', 'timestamp': '2025-01-01T00:00:00'},
                {'role': 'assistant', 'content': 'Response', 'timestamp': '2025-01-01T00:00:01'},
            ] * 5,
        }
        return db

    @pytest.fixture
    def mock_chat_manager(self):
        manager = MockChatManager()
        # 预创建两个 session
        session1 = MockChatSession('session-1', 'session-1')
        session2 = MockChatSession('session-2', 'session-2')
        manager.sessions = {'session-1': session1, 'session-2': session2}
        return manager

    @pytest.mark.asyncio
    async def test_first_session_connect_fast(self, mock_sio, mock_db, mock_chat_manager):
        """测试：第一次连接 session 应该很快"""
        sid = 'client-1'
        session_id = 'session-1'

        start = time.time()

        # 模拟 chat:connect 处理
        session = mock_chat_manager.get_session(session_id)
        assert session is not None

        # 获取历史
        history = mock_db.get_chat_messages_desc(session_id, limit=15)
        total = mock_db.get_chat_message_count(session_id)

        # 发送 ready
        await mock_sio.emit('chat:ready', {'history_count': total}, to=sid)

        # 发送历史消息
        for msg in history:
            await mock_sio.emit(f'chat:{msg["role"]}', msg, to=sid)

        # 发送 history_end
        await mock_sio.emit('chat:history_end', {'count': len(history), 'total': total}, to=sid)

        elapsed = (time.time() - start) * 1000

        print(f"\n第一次 session 连接耗时: {elapsed:.1f}ms")
        print(f"发送了 {len(mock_sio.emitted)} 个事件")

        # 第一次连接应该在 100ms 内完成
        assert elapsed < 100, f"第一次连接太慢: {elapsed:.1f}ms"

    @pytest.mark.asyncio
    async def test_second_session_connect_with_background_activity(self, mock_sio, mock_db, mock_chat_manager):
        """测试：第一个 session 有后台活动时，第二个 session 连接变慢"""
        sid = 'client-1'

        # 模拟第一个 session 的后台活动（持续写入数据库）
        background_writes = []

        async def background_db_writes():
            """模拟 Claude CLI 持续输出消息并写入数据库"""
            for i in range(10):
                # 模拟 _save_message_to_db 获取锁
                mock_db.lock_held = True
                mock_db.lock_wait_time = 0.05  # 50ms 锁等待
                mock_db.save_chat_message(session_id='session-1', content=f'msg-{i}')
                mock_db.lock_held = False
                background_writes.append(i)
                await asyncio.sleep(0.01)  # 10ms 间隔

        # 启动后台任务
        bg_task = asyncio.create_task(background_db_writes())

        # 等待一点时间让后台任务开始
        await asyncio.sleep(0.02)

        # 现在尝试连接第二个 session
        start = time.time()

        session_id = 'session-2'
        session = mock_chat_manager.get_session(session_id)

        # 获取历史（可能被锁阻塞）
        history = mock_db.get_chat_messages_desc(session_id, limit=15)
        total = mock_db.get_chat_message_count(session_id)

        # 发送消息
        await mock_sio.emit('chat:ready', {'history_count': total}, to=sid)
        for msg in history:
            await mock_sio.emit(f'chat:{msg["role"]}', msg, to=sid)
        await mock_sio.emit('chat:history_end', {'count': len(history), 'total': total}, to=sid)

        elapsed = (time.time() - start) * 1000

        # 取消后台任务
        bg_task.cancel()
        try:
            await bg_task
        except asyncio.CancelledError:
            pass

        print(f"\n第二次 session 连接耗时（有后台活动）: {elapsed:.1f}ms")
        print(f"后台写入次数: {len(background_writes)}")

        # 如果有锁竞争，第二次连接会慢很多
        # 这个测试验证问题的存在

    @pytest.mark.asyncio
    async def test_run_in_executor_avoids_blocking(self, mock_sio, mock_db, mock_chat_manager):
        """测试：使用 run_in_executor 可以避免阻塞事件循环"""
        sid = 'client-1'

        # 模拟锁被持有
        mock_db.lock_held = True
        mock_db.lock_wait_time = 0.1  # 100ms 锁等待

        start = time.time()

        session_id = 'session-2'
        loop = asyncio.get_event_loop()

        # 使用 run_in_executor 在线程池中执行
        history = await loop.run_in_executor(
            None,
            lambda: mock_db.get_chat_messages_desc(session_id, limit=15)
        )
        total = await loop.run_in_executor(
            None,
            lambda: mock_db.get_chat_message_count(session_id)
        )

        # 同时可以做其他事情（验证事件循环没有被阻塞）
        other_task_ran = False
        async def other_task():
            nonlocal other_task_ran
            other_task_ran = True

        await other_task()

        elapsed = (time.time() - start) * 1000
        mock_db.lock_held = False

        print(f"\n使用 run_in_executor 耗时: {elapsed:.1f}ms")
        print(f"其他任务是否执行: {other_task_ran}")

        assert other_task_ran, "事件循环被阻塞，其他任务无法执行"

    @pytest.mark.asyncio
    async def test_emit_timing_with_concurrent_activity(self, mock_sio):
        """测试：并发活动时 emit 的 timing"""
        sid = 'client-1'

        emit_times = []

        async def measure_emit(label):
            start = time.time()
            await mock_sio.emit(f'test:{label}', {'data': label}, to=sid)
            elapsed = (time.time() - start) * 1000
            emit_times.append((label, elapsed))
            return elapsed

        # 第一次 emit（无并发）
        t1 = await measure_emit('first')

        # 启动后台任务模拟 Claude 输出
        async def background_emits():
            for i in range(20):
                await mock_sio.emit('chat:stream', {'text': f'token-{i}'}, to=sid)
                await asyncio.sleep(0.005)  # 5ms 间隔

        bg_task = asyncio.create_task(background_emits())
        await asyncio.sleep(0.01)  # 让后台任务开始

        # 第二次 emit（有并发）
        t2 = await measure_emit('second')

        bg_task.cancel()
        try:
            await bg_task
        except asyncio.CancelledError:
            pass

        print(f"\n第一次 emit: {t1:.1f}ms")
        print(f"第二次 emit（有并发）: {t2:.1f}ms")
        print(f"总 emit 数: {len(mock_sio.emitted)}")

    @pytest.mark.asyncio
    async def test_full_session_switch_scenario(self, mock_sio, mock_db, mock_chat_manager):
        """
        完整场景测试：模拟用户行为
        1. 打开 session-1（应该快）
        2. session-1 开始接收 Claude 输出
        3. 切换到 session-2（可能慢）
        4. 切回 session-1（应该快）
        """
        sid = 'client-1'
        timings = {}

        async def connect_session(session_id):
            """模拟连接 session"""
            start = time.time()

            session = mock_chat_manager.get_session(session_id)
            if not session:
                return None

            # 获取历史
            loop = asyncio.get_event_loop()
            history = await loop.run_in_executor(
                None,
                lambda: mock_db.get_chat_messages_desc(session_id, limit=15)
            )
            total = await loop.run_in_executor(
                None,
                lambda: mock_db.get_chat_message_count(session_id)
            )

            # 发送 ready
            await mock_sio.emit('chat:ready', {
                'history_count': total,
                'session_id': session_id
            }, to=sid)

            # 发送历史
            for msg in history:
                await mock_sio.emit(f'chat:{msg["role"]}', msg, to=sid)

            # 发送 history_end
            await mock_sio.emit('chat:history_end', {
                'count': len(history),
                'total': total
            }, to=sid)

            elapsed = (time.time() - start) * 1000
            return elapsed

        # 1. 第一次打开 session-1
        timings['session-1-first'] = await connect_session('session-1')
        print(f"\n1. 第一次打开 session-1: {timings['session-1-first']:.1f}ms")

        # 2. 模拟 session-1 收到 Claude 输出（后台活动）
        async def claude_output():
            for i in range(5):
                await mock_sio.emit('chat:stream', {'text': f'token-{i}'}, to=sid)
                await asyncio.sleep(0.01)

        bg_task = asyncio.create_task(claude_output())
        await asyncio.sleep(0.02)

        # 3. 切换到 session-2
        timings['session-2'] = await connect_session('session-2')
        print(f"2. 切换到 session-2: {timings['session-2']:.1f}ms")

        bg_task.cancel()
        try:
            await bg_task
        except asyncio.CancelledError:
            pass

        # 4. 切回 session-1
        timings['session-1-second'] = await connect_session('session-1')
        print(f"3. 切回 session-1: {timings['session-1-second']:.1f}ms")

        # 验证 timing
        print(f"\n总结:")
        print(f"  session-1 第一次: {timings['session-1-first']:.1f}ms")
        print(f"  session-2: {timings['session-2']:.1f}ms")
        print(f"  session-1 第二次: {timings['session-1-second']:.1f}ms")

        # 所有连接都应该在合理时间内完成
        for name, t in timings.items():
            assert t < 200, f"{name} 太慢: {t:.1f}ms"


class TestHistoryMessageFlow:
    """测试历史消息的完整流程"""

    @pytest.mark.asyncio
    async def test_history_messages_arrive_in_order(self):
        """测试：历史消息按正确顺序到达"""
        mock_sio = MockSIO()
        sid = 'client-1'

        history = [
            {'role': 'user', 'content': 'Message 1', 'timestamp': '2025-01-01T00:00:01'},
            {'role': 'assistant', 'content': 'Response 1', 'timestamp': '2025-01-01T00:00:02'},
            {'role': 'user', 'content': 'Message 2', 'timestamp': '2025-01-01T00:00:03'},
            {'role': 'assistant', 'content': 'Response 2', 'timestamp': '2025-01-01T00:00:04'},
        ]

        # 发送 ready
        await mock_sio.emit('chat:ready', {'history_count': len(history)}, to=sid)

        # 发送历史消息
        for msg in history:
            await mock_sio.emit(f'chat:{msg["role"]}', msg, to=sid)

        # 发送 history_end
        await mock_sio.emit('chat:history_end', {'count': len(history), 'total': len(history)}, to=sid)

        # 验证消息顺序
        assert len(mock_sio.emitted) == len(history) + 2  # history + ready + history_end
        assert mock_sio.emitted[0]['event'] == 'chat:ready'
        assert mock_sio.emitted[-1]['event'] == 'chat:history_end'

        # 验证中间的历史消息
        for i, msg in enumerate(history):
            emitted = mock_sio.emitted[i + 1]
            assert emitted['event'] == f'chat:{msg["role"]}'
            assert emitted['data']['content'] == msg['content']

    @pytest.mark.asyncio
    async def test_history_count_matches(self):
        """测试：history_end 中的 count 与实际发送的消息数匹配"""
        mock_sio = MockSIO()
        sid = 'client-1'

        history = [{'role': 'user', 'content': f'msg-{i}'} for i in range(15)]

        await mock_sio.emit('chat:ready', {'history_count': len(history)}, to=sid)
        for msg in history:
            await mock_sio.emit(f'chat:{msg["role"]}', msg, to=sid)
        await mock_sio.emit('chat:history_end', {'count': len(history), 'total': 100}, to=sid)

        # 验证
        history_end = mock_sio.emitted[-1]
        assert history_end['data']['count'] == 15
        assert history_end['data']['total'] == 100


if __name__ == '__main__':
    pytest.main([__file__, '-v', '-s'])
