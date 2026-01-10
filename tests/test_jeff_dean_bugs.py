# Copyright (c) 2026 BillChen
# Bug reproduction tests - Found by Jeff Dean style code review
"""
发现的 Bug 列表及测试用例

Bug 1: task_executor.py - 竞态条件（任务锁创建）
Bug 2: task_executor.py - _detect_feishu_id_type 没有处理 None
Bug 3: scheduler.py - run_task_now 创建的任务没有被跟踪（可能被 GC）
Bug 4: scheduler.py - _sync_tasks_from_db 和其他方法并发修改 _loaded_task_ids
Bug 5: scheduled_tasks_mcp.py - handle_update_task 修改了原始 args（dict.pop）
Bug 6: database.py - XOR 加密太弱（安全问题）
"""

import asyncio
import pytest
import sys
import os
import gc
import weakref

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class TestBug1TaskLockRaceCondition:
    """
    Bug 1: task_executor.py 任务锁创建竞态条件

    原问题代码:
        if task_id not in self._task_locks:
            self._task_locks[task_id] = asyncio.Lock()
        lock = self._task_locks[task_id]

    问题: 两个协程同时检查 `task_id not in self._task_locks` 可能都返回 True，
    然后各自创建一个新的 Lock 对象，导致同一个任务可能同时执行两次。

    修复: 使用 _locks_lock 保护 _task_locks 字典，通过 _get_task_lock() 方法实现线程安全。
    """

    @pytest.mark.asyncio
    async def test_concurrent_lock_creation_race(self):
        """验证修复: 并发获取任务锁应该返回同一个锁对象"""
        from app.services.task_executor import TaskExecutor

        executor = TaskExecutor()
        task_id = 999

        # 并发调用实际的 _get_task_lock 方法（已经用 _locks_lock 保护）
        locks = await asyncio.gather(*[executor._get_task_lock(task_id) for _ in range(10)])

        # 检查是否所有锁都是同一个对象
        unique_locks = set(id(lock) for lock in locks)

        # 修复后，应该只有一个锁对象
        assert len(unique_locks) == 1, f"Race condition detected! Created {len(unique_locks)} different locks for same task_id"


class TestBug2DetectFeishuIdTypeNone:
    """
    Bug 2: task_executor.py _detect_feishu_id_type 方法

    问题代码:
        def _detect_feishu_id_type(self, receive_id: str) -> tuple[str, str]:
            if "@" in receive_id:  # 如果 receive_id 是 None，这里会抛出 TypeError

    问题: 如果 receive_id 是 None，调用 "@" in None 会抛出 TypeError
    """

    def test_detect_feishu_id_type_with_none(self):
        """验证修复: _detect_feishu_id_type 传入 None 时返回默认值"""
        from app.services.task_executor import TaskExecutor

        executor = TaskExecutor()

        # 修复后应该返回默认值 ("open_id", "")，而不是抛出 TypeError
        id_type, instruction = executor._detect_feishu_id_type(None)
        assert id_type == "open_id"
        assert instruction == ""

    def test_detect_feishu_id_type_with_empty_string(self):
        """边界条件: 空字符串"""
        from app.services.task_executor import TaskExecutor

        executor = TaskExecutor()

        # 空字符串应该返回默认的 open_id
        id_type, instruction = executor._detect_feishu_id_type("")
        assert id_type == "open_id"
        assert instruction == ""


class TestBug3AsyncTaskNotTracked:
    """
    Bug 3: scheduler.py run_task_now 方法第 266 行

    问题代码:
        asyncio.create_task(executor.execute(task))
        return True

    问题: 创建的 task 没有被保存引用，如果任务执行时间长，
    可能会被垃圾回收器回收，导致任务被意外取消。

    参考: https://docs.python.org/3/library/asyncio-task.html#creating-tasks
    "Important: Save a reference to the result of this function,
     to avoid a task disappearing mid-execution."
    """

    @pytest.mark.asyncio
    async def test_untracked_task_may_be_garbage_collected(self):
        """演示: 未保存引用的任务可能被 GC"""
        completed = [False]

        async def long_running_task():
            await asyncio.sleep(0.1)
            completed[0] = True

        # 创建任务但不保存引用
        asyncio.create_task(long_running_task())

        # 强制垃圾回收
        gc.collect()

        # 等待任务应该完成的时间
        await asyncio.sleep(0.2)

        # 在某些情况下，任务可能没有完成
        # 这个测试展示了问题的本质
        # 注意：在现代 Python 版本中，event loop 会保持对任务的引用，
        # 但这仍然是不推荐的做法
        print(f"Task completed: {completed[0]}")

    @pytest.mark.asyncio
    async def test_weakref_task_behavior(self):
        """演示: 使用 weakref 观察任务生命周期"""
        async def dummy_task():
            await asyncio.sleep(1)

        task = asyncio.create_task(dummy_task())
        weak_task = weakref.ref(task)

        # 删除强引用
        del task
        gc.collect()

        # 检查任务是否还存在
        # 在 event loop 中，任务应该还存在（被 loop 持有）
        # 但这依赖于实现细节，不应该依赖
        still_alive = weak_task() is not None
        print(f"Task still alive after del: {still_alive}")

        # 取消所有待处理的任务以清理
        for task in asyncio.all_tasks():
            if task is not asyncio.current_task():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass


class TestBug4SyncTasksRaceCondition:
    """
    Bug 4: scheduler.py _sync_tasks_from_db 和其他方法

    问题代码:
        self._loaded_task_ids.add(task_id)     # 在 add_task 中
        self._loaded_task_ids.discard(task_id)  # 在 remove_task 中
        to_add = db_task_ids - self._loaded_task_ids  # 在 _sync_tasks_from_db 中

    问题: 多个异步方法同时修改 _loaded_task_ids，虽然 set 的单个操作是原子的，
    但组合操作（如 set 差集运算 + 迭代 + 修改）不是原子的。
    """

    @pytest.mark.asyncio
    async def test_concurrent_set_modification(self):
        """演示: 并发修改 set 的问题"""
        task_ids = set()
        errors = []

        async def add_tasks():
            for i in range(100):
                task_ids.add(i)
                await asyncio.sleep(0)  # 让出控制权

        async def remove_tasks():
            for i in range(100):
                task_ids.discard(i)
                await asyncio.sleep(0)

        async def iterate_tasks():
            try:
                for _ in range(10):
                    # 在迭代时修改 set 可能导致问题
                    list(task_ids)  # 复制以避免迭代时修改
                    await asyncio.sleep(0)
            except RuntimeError as e:
                errors.append(str(e))

        # 并发执行
        await asyncio.gather(
            add_tasks(),
            remove_tasks(),
            iterate_tasks()
        )

        # 检查是否有错误
        if errors:
            print(f"Errors during concurrent set operations: {errors}")


class TestBug5DictPopModifiesOriginal:
    """
    Bug 5: scheduled_tasks_mcp.py handle_update_task 方法第 426 行

    问题代码:
        task_id = args.pop("task_id")

    问题: dict.pop() 会修改原始字典，如果调用者期望 args 不变，这是个问题。
    虽然在当前代码中可能没有直接影响，但这是一个不好的实践。
    """

    def test_args_pop_modifies_original(self):
        """复现: args.pop 修改原始字典"""
        original_args = {
            "task_id": 123,
            "name": "test",
            "prompt": "test prompt"
        }

        # 模拟 handle_update_task 的行为
        args = original_args  # 注意：这是同一个对象
        task_id = args.pop("task_id")

        # 原始字典被修改了
        assert "task_id" not in original_args
        assert task_id == 123


class TestBug6WeakXorEncryption:
    """
    Bug 6: database.py _encrypt_password 和 _decrypt_password

    问题代码:
        encrypted = bytes(b ^ key[i % len(key)] for i, b in enumerate(password_bytes))

    问题: XOR 加密是非常弱的加密方式：
    1. 如果攻击者知道明文，可以轻易计算出密钥
    2. 如果密钥重复（密码长于密钥），模式可能被发现
    3. 不提供认证，可能被篡改
    """

    def test_xor_encryption_weakness_known_plaintext(self):
        """演示: XOR 加密的已知明文攻击"""
        import base64
        import hashlib

        # 模拟加密过程
        auth_token = "test_token"
        key = hashlib.sha256(auth_token.encode()).digest()

        password = "my_secret_password"
        password_bytes = password.encode('utf-8')

        # XOR 加密
        encrypted = bytes(b ^ key[i % len(key)] for i, b in enumerate(password_bytes))

        # 如果攻击者知道密码（已知明文），可以恢复密钥
        recovered_key = bytes(e ^ p for e, p in zip(encrypted, password_bytes))

        # 使用恢复的密钥可以解密其他密码（如果使用相同的密钥）
        assert recovered_key[:len(password_bytes)] == key[:len(password_bytes)]

    def test_xor_encryption_pattern_detection(self):
        """演示: XOR 加密的模式检测"""
        import hashlib

        auth_token = "test_token"
        key = hashlib.sha256(auth_token.encode()).digest()

        # 相同的密码会产生相同的密文
        password1 = "same_password"
        password2 = "same_password"

        encrypted1 = bytes(b ^ key[i % len(key)] for i, b in enumerate(password1.encode()))
        encrypted2 = bytes(b ^ key[i % len(key)] for i, b in enumerate(password2.encode()))

        # 相同输入 -> 相同输出，可以被发现
        assert encrypted1 == encrypted2


class TestBug7BuildTaskPromptEdgeCases:
    """
    其他边界条件测试
    """

    def test_build_task_prompt_with_special_characters(self):
        """测试: prompt 包含特殊字符"""
        from app.services.task_executor import TaskExecutor

        executor = TaskExecutor()

        # 包含可能导致问题的特殊字符
        special_prompt = 'Test prompt with "quotes" and $variables and `backticks`'

        result = executor._build_task_prompt(
            task_name="Test Task",
            prompt=special_prompt,
            notify_feishu=False,
            feishu_receive_id=None
        )

        # 检查特殊字符是否被正确包含
        assert special_prompt in result

    def test_build_task_prompt_with_unicode(self):
        """测试: prompt 包含 Unicode 字符"""
        from app.services.task_executor import TaskExecutor

        executor = TaskExecutor()

        unicode_prompt = "测试中文 🚀 émojis and ñ special chars"

        result = executor._build_task_prompt(
            task_name="测试任务",
            prompt=unicode_prompt,
            notify_feishu=True,
            feishu_receive_id="test@example.com"
        )

        assert unicode_prompt in result
        assert "测试任务" in result


class TestBug8ProcessCleanup:
    """
    Bug 8: task_executor.py _run_claude 超时处理

    问题代码:
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise

    潜在问题: 如果 process.kill() 失败（例如进程已经退出），
    或者 process.wait() 超时，可能导致资源泄漏。
    """

    @pytest.mark.asyncio
    async def test_process_kill_already_dead(self):
        """测试: 尝试 kill 已经退出的进程"""
        # 创建一个会立即退出的进程
        process = await asyncio.create_subprocess_exec(
            "echo", "hello",
            stdout=asyncio.subprocess.PIPE
        )

        # 等待进程自然退出
        await process.wait()

        # 尝试 kill 已经退出的进程
        # 这不应该抛出异常，但行为可能因系统而异
        try:
            process.kill()
        except ProcessLookupError:
            # 预期的行为：进程已经不存在
            pass
        except OSError:
            # 某些系统可能抛出 OSError
            pass


# 运行测试
if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
