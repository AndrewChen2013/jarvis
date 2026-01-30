# Copyright (c) 2025 BillChen
#
# Licensed under the Apache License, Version 2.0 (the "License")

"""
Session 切换端到端测试

使用真实的 SocketIO 和数据库模拟生产环境的 session 切换场景
"""

import pytest
import asyncio
import time
import socketio
from unittest.mock import patch, MagicMock
import sys
import os

# 添加项目根目录到 path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class TestSessionSwitchE2E:
    """端到端测试：Session 切换"""

    @pytest.fixture
    def mock_chat_session(self):
        """Mock ChatSession，不启动真实的 Claude CLI"""
        class MockChatSession:
            def __init__(self, session_id, resume_session_id=None):
                self.session_id = session_id
                self.resume_session_id = resume_session_id
                self._claude_session_id = resume_session_id
                self._is_running = True
                self._callback = None
                self._callback_owner = None
                self._message_history = []

            async def start(self):
                return True

            def set_callback(self, callback, owner):
                self._callback = callback
                self._callback_owner = owner

            def clear_callback(self, owner):
                if self._callback_owner == owner:
                    self._callback = None
                    self._callback_owner = None

            def get_callback_owner(self):
                return self._callback_owner

            async def load_history_if_resume(self):
                pass

        return MockChatSession

    @pytest.mark.asyncio
    async def test_socketio_emit_timing(self):
        """测试真实 Socket.IO emit 的 timing"""
        from app.services.socketio_connection_manager import sio

        # 创建一个测试客户端
        test_sid = 'test-client-001'

        # Mock emit 并记录 timing
        emit_times = []
        original_emit = sio.emit

        async def timed_emit(*args, **kwargs):
            start = time.time()
            result = await original_emit(*args, **kwargs)
            elapsed = (time.time() - start) * 1000
            emit_times.append(elapsed)
            return result

        with patch.object(sio, 'emit', timed_emit):
            # 模拟发送多个消息
            for i in range(10):
                try:
                    await sio.emit('test:message', {'index': i}, to=test_sid)
                except Exception:
                    pass  # 客户端不存在，但我们只关心 timing

        print(f"\nEmit times: {emit_times}")

    @pytest.mark.asyncio
    async def test_db_operations_timing(self):
        """测试数据库操作的 timing"""
        from app.services.database import db

        # 使用真实数据库测试
        session_id = 'd910c8f8-4358-4158-aadd-f459edcc8d41'

        timings = {}

        # 测试 get_chat_messages_desc
        start = time.time()
        messages = db.get_chat_messages_desc(session_id, limit=15)
        timings['get_messages'] = (time.time() - start) * 1000

        # 测试 get_chat_message_count
        start = time.time()
        count = db.get_chat_message_count(session_id)
        timings['get_count'] = (time.time() - start) * 1000

        print(f"\n数据库操作 timing:")
        print(f"  get_chat_messages_desc: {timings['get_messages']:.1f}ms, 返回 {len(messages)} 条")
        print(f"  get_chat_message_count: {timings['get_count']:.1f}ms, 总计 {count} 条")

        # 验证性能
        assert timings['get_messages'] < 100, f"get_messages 太慢: {timings['get_messages']:.1f}ms"
        assert timings['get_count'] < 50, f"get_count 太慢: {timings['get_count']:.1f}ms"

    @pytest.mark.asyncio
    async def test_db_lock_contention(self):
        """测试数据库锁竞争"""
        from app.services.database import db

        session_id = 'd910c8f8-4358-4158-aadd-f459edcc8d41'
        results = []

        async def read_messages(task_id):
            """模拟读取消息"""
            start = time.time()
            loop = asyncio.get_event_loop()
            # 在线程池中执行
            messages = await loop.run_in_executor(
                None,
                lambda: db.get_chat_messages_desc(session_id, limit=15)
            )
            elapsed = (time.time() - start) * 1000
            results.append((task_id, elapsed, len(messages)))
            return elapsed

        async def write_message(task_id):
            """模拟写入消息"""
            start = time.time()
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: db.save_chat_message(
                    session_id=session_id,
                    role='test',
                    content=f'Test message {task_id}',
                    timestamp=__import__('datetime').datetime.now()
                )
            )
            elapsed = (time.time() - start) * 1000
            results.append((f'write-{task_id}', elapsed, 1))
            return elapsed

        # 并发执行读写操作
        start = time.time()
        tasks = [
            read_messages(0),
            write_message(1),
            read_messages(2),
            write_message(3),
            read_messages(4),
        ]
        await asyncio.gather(*tasks)
        total_time = (time.time() - start) * 1000

        print(f"\n并发读写测试 (run_in_executor):")
        for task_id, elapsed, _ in sorted(results, key=lambda x: str(x[0])):
            print(f"  Task {task_id}: {elapsed:.1f}ms")
        print(f"  总耗时: {total_time:.1f}ms")

        # 如果使用 run_in_executor，总时间应该接近最慢的单个操作
        # 而不是所有操作的累加
        max_single = max(r[1] for r in results)
        assert total_time < max_single * 2, f"可能存在串行执行: total={total_time:.1f}ms, max_single={max_single:.1f}ms"

    @pytest.mark.asyncio
    async def test_sync_vs_async_db_operations(self):
        """对比同步 vs 异步数据库操作的影响"""
        from app.services.database import db

        session_id = 'd910c8f8-4358-4158-aadd-f459edcc8d41'

        # 测试 1: 同步执行（会阻塞事件循环）
        async def sync_test():
            other_task_time = None

            async def other_work():
                nonlocal other_task_time
                start = time.time()
                await asyncio.sleep(0.01)  # 10ms
                other_task_time = (time.time() - start) * 1000

            # 启动其他任务
            other_task = asyncio.create_task(other_work())

            # 同步调用数据库（会阻塞）
            start = time.time()
            db.get_chat_messages_desc(session_id, limit=15)
            db_time = (time.time() - start) * 1000

            await other_task
            return db_time, other_task_time

        # 测试 2: 异步执行（不阻塞事件循环）
        async def async_test():
            other_task_time = None

            async def other_work():
                nonlocal other_task_time
                start = time.time()
                await asyncio.sleep(0.01)  # 10ms
                other_task_time = (time.time() - start) * 1000

            # 启动其他任务
            other_task = asyncio.create_task(other_work())

            # 异步调用数据库（不阻塞）
            loop = asyncio.get_event_loop()
            start = time.time()
            await loop.run_in_executor(
                None,
                lambda: db.get_chat_messages_desc(session_id, limit=15)
            )
            db_time = (time.time() - start) * 1000

            await other_task
            return db_time, other_task_time

        sync_db_time, sync_other_time = await sync_test()
        async_db_time, async_other_time = await async_test()

        print(f"\n同步 vs 异步对比:")
        print(f"  同步: DB={sync_db_time:.1f}ms, other_task={sync_other_time:.1f}ms")
        print(f"  异步: DB={async_db_time:.1f}ms, other_task={async_other_time:.1f}ms")

        # 异步情况下，other_task 应该接近 10ms（不被阻塞）
        # 同步情况下，other_task 可能被延迟


class TestRealScenario:
    """真实场景测试"""

    @pytest.mark.asyncio
    async def test_simulate_user_session_switch(self):
        """
        模拟真实用户操作：
        1. 用户打开 session A
        2. Claude 开始输出
        3. 用户切换到 session B
        4. 测量切换耗时
        """
        from app.services.database import db
        from app.services.socketio_connection_manager import SocketIOConnectionManager

        # 使用真实 session IDs
        session_a = 'd910c8f8-4358-4158-aadd-f459edcc8d41'
        session_b = '84267d14-5e80-473a-b962-87a5c0b08412'

        manager = SocketIOConnectionManager()

        # Mock sio.emit
        emit_times = []

        async def mock_emit(event, data, to=None):
            start = time.time()
            await asyncio.sleep(0.001)  # 模拟网络延迟
            elapsed = (time.time() - start) * 1000
            emit_times.append((event, elapsed))

        # 模拟 Claude 输出（后台任务）
        claude_running = True

        async def simulate_claude_output():
            while claude_running:
                # 模拟 _save_message_to_db
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(
                    None,
                    lambda: db.get_chat_message_count(session_a)  # 模拟数据库操作
                )
                await asyncio.sleep(0.05)  # 50ms 间隔

        # 启动 Claude 输出
        claude_task = asyncio.create_task(simulate_claude_output())
        await asyncio.sleep(0.1)  # 让 Claude 开始

        # 测量切换到 session B 的时间
        start = time.time()

        loop = asyncio.get_event_loop()
        history = await loop.run_in_executor(
            None,
            lambda: db.get_chat_messages_desc(session_b, limit=15)
        )
        total = await loop.run_in_executor(
            None,
            lambda: db.get_chat_message_count(session_b)
        )

        # 模拟发送历史
        for msg in history:
            await mock_emit(f'chat:{msg.get("role")}', msg)
        await mock_emit('chat:history_end', {'count': len(history), 'total': total})

        switch_time = (time.time() - start) * 1000

        # 停止 Claude
        claude_running = False
        claude_task.cancel()
        try:
            await claude_task
        except asyncio.CancelledError:
            pass

        print(f"\n真实场景模拟:")
        print(f"  历史消息数: {len(history)}")
        print(f"  总消息数: {total}")
        print(f"  切换耗时: {switch_time:.1f}ms")
        print(f"  emit 次数: {len(emit_times)}")

        # 切换应该在 500ms 内完成
        assert switch_time < 500, f"切换太慢: {switch_time:.1f}ms"


if __name__ == '__main__':
    pytest.main([__file__, '-v', '-s'])
