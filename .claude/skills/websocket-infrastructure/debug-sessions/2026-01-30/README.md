# Debug Session: 2026-01-30 Session 切换慢问题

## 问题描述

用户报告：第一个 session 打开很快，但切换到其他 session 时 "connecting 半天才连上"。

## 文件清单

| 文件 | 说明 |
|-----|------|
| `frontend.log` | 完整前端远程日志 |
| `backend.log` | 后端日志最后 2000 行 |
| `timing-frontend.log` | 前端 timing 相关日志提取 |
| `timing-backend.log` | 后端 timing 相关日志提取 |

## 关键发现

### 1. 前后端 callback 状态不同步（已修复）

**问题**：用户切换 session 时，后端清理旧 callback，但前端 handler 仍存在，导致切回时不发送 chat:connect。

**修复**：`socketio-websocket.js` 的 `connectChat()` 中，即使 handler EXISTS 也发送 chat:connect。

**效果**：切换已有 session 从 14-42 秒降到 ~54ms。

### 2. 新 session 首次打开慢（待调查）

**现象**：
- 前端 emit: `01:29:32.333Z`
- 后端 receive: `01:29:35.591Z`
- 传输延迟: **3.3 秒**（应该是 <100ms）

**疑点**：
- Transport 显示是 `websocket`
- 同连接切换 session 只需 54ms
- 后端日志有 `watchfiles.main - 1 change detected`

## 关键时间线

### 案例 1: 新 session (84267d14) - 慢

```
[前端] 01:29:32.333Z - send EMIT: chat:connect, transport=websocket
[后端] 09:29:35.591 (01:29:35.591Z UTC) - Received chat:connect  # 3.3秒传输延迟!
[后端] 09:29:35.592 - Creating new chat session
[后端] 09:29:37.681 - Session started (2.1秒 Claude CLI 启动)
[后端] 09:29:37.690 - ready_sent
[前端] 01:29:37.826Z - RECEIVED chat:ready  # 总延迟 5.5秒
```

### 案例 2: 切回已有 session (d910c8f8) - 快

```
[前端] 01:29:39.290Z - send EMIT: chat:connect, transport=websocket
[后端] 09:29:39.203 - Received chat:connect  # 即时
[后端] 09:29:39.207 - DONE: 5ms total
[前端] 01:29:39.344Z - RECEIVED chat:ready  # 总延迟 54ms
```

## 待调查

1. **3.3 秒传输延迟的原因**
   - watchfiles 热重载？
   - Socket.IO 缓冲？
   - 其他阻塞？

2. **watchfiles 日志来源（已查明）**

**发现**：有两个 uvicorn 进程在运行！

```bash
$ ps aux | grep uvicorn
bill  95081  /Users/bill/jarvis/venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000  # 生产 launchd
bill   6931  python -m app.main  # 开发进程，8:42AM 启动
```

- 生产进程 (95081): 通过 launchd 启动，端口 8000，**无 --reload**
- 开发进程 (6931): 通过 `python -m app.main` 启动，端口 38010，**有 reload=True**

`app/main.py:201-207` 的 `__main__` 块配置了 `reload=True`：
```python
if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=38010,
        reload=True,  # 这会启用 watchfiles
    )
```

**结论**：watchfiles 日志来自开发进程 (端口 38010)，不影响生产进程 (端口 8000)。

但需要确认用户连接的是哪个端口。如果连接 38010，则会受 watchfiles 影响。

## 复现步骤

1. 打开 Jarvis
2. 点击一个已有的 session（第一个）
3. 点击另一个 session（第二个）- 观察是否有延迟
4. 切回第一个 session - 应该秒切

## 相关代码位置

- 前端 handler EXISTS 逻辑: `socketio-websocket.js:341-370`
- 后端 callback 清理: `socketio_connection_manager.py:333-344`
- 后端 timing 日志: `socketio_connection_manager.py:288-436`

---

## 第二轮调查 (01:45)

### Claude 的初步分析（可能有误）

**假设**：同步文件 IO 阻塞事件循环

在 `chat_session_manager.py` 中发现：
```python
async def load_history_if_resume(self):
    if self.resume_session_id:
        self._sync_history_to_db()  # 同步操作
        if not self._message_history:
            self._message_history = self._load_history_from_file()  # 同步操作，读取 2684 条消息
```

这些同步操作在 async 函数中直接调用，会阻塞事件循环。

**但是用户指出这个分析有问题！**

### 用户的反驳

> "刷新页面后 session 列表任意 session 都没打开过，这时候随便打开哪个都很快。但是一旦打开过一个后，再去打开另一个就慢了。"

**这说明**：
1. 第一个 session（无论是哪个）总是快的
2. 慢的是"打开过一个之后再打开另一个"
3. 不是特定 session 的问题

**这推翻了"同步文件 IO 阻塞"的假设**，因为：
- 如果是文件 IO 阻塞，那每个新 session 首次打开都应该慢
- 但实际上刷新后第一个打开的 session 是快的

### 需要重新调查

真正的问题可能是：
1. **第一个 session 的处理阻塞了后续请求**
2. **某种资源竞争或锁**
3. **第一个 session 创建后，某些状态导致后续创建变慢**

### 待验证

1. 刷新页面后，打开第一个 session 的耗时
2. 不关闭第一个 session，打开第二个 session 的耗时
3. 对比两者的后端日志，找出差异

---

## 第三轮调查 (01:55) - 第一性原理分析

### 关键发现：第一个 session 处理中有 6.8 秒空白！

后端日志显示 d4ec8f77（第一个打开的 session）：

```
09:41:48,903 - Chat connect T4 history_loaded: 4ms
...（6.8 秒空白）...
09:41:55,765 - Chat connect T5 ready_sent: 904ms
```

**T4 和 T5 之间有 6.8 秒没有任何日志！**

这解释了为什么第二个 session 慢：
1. 第一个 session 在 T4 后被某个操作阻塞了 6.8 秒
2. 第二个 session 的 chat:connect 在 52.375 发出
3. 但因为事件循环被阻塞，直到 54.860 才被处理

### 需要调查

T4 `history_loaded` 和 T5 `ready_sent` 之间的代码做了什么？

相关代码位置：`socketio_connection_manager.py` T4-T5 之间的逻辑

---

## 第四轮调查 - 深入分析传输延迟

### 精确时间线分析

对比前端和后端日志（考虑时区和时钟偏差）：

**时钟校准**：
- 前端发送 d910c8f8: `01:29:30.002Z`
- 后端收到 d910c8f8: `09:29:29.922` = UTC `01:29:29.922Z`
- 后端比前端早 0.08 秒 → 前端时钟比后端快 ~0.08 秒

**校正后的 84267d14 时间线**：
```
[前端] 01:29:32.333Z - send EMIT (校正后: 32.253 后端时间)
[后端] 09:29:29.928 - 第一个 session d910c8f8 DONE
[后端] 09:29:30.357 - watchfiles change detected
[后端] 09:29:35.591 - Received chat:connect for 84267d14
传输延迟: 35.591 - 32.253 = 3.34 秒
```

### 关键发现

**5.66 秒的后端空白期** (29.928 → 35.591)：
- 第一个 session 在 29.928 秒完成（6ms 处理时间）
- 第二个 session 的消息在 35.591 秒才被处理
- 中间只有 watchfiles 日志（30.357），无其他后端活动

**排除的原因**：
1. ❌ 第一个 session 处理时间长（实际只用了 6ms）
2. ❌ 锁竞争（第一个 session 已完成释放锁）
3. ❌ 同步文件 IO（第一个是 found=True，没有文件 IO）
4. ❌ 网络问题（同连接上其他消息正常）

**待调查的可能原因**：
1. Socket.IO 内部消息队列/缓冲
2. asyncio 事件循环调度问题
3. uvicorn worker 问题
4. 某个后台任务阻塞了事件循环但没有日志

### 下一步

1. 在后端添加更细粒度的日志：
   - Socket.IO 消息接收时刻
   - asyncio 任务调度状态
   - 事件循环空闲检测

2. 检查是否有未记录的后台任务：
   - ChatSession 的 `_reader_task` 和 `_stderr_task`
   - 其他 `asyncio.create_task()` 调用

3. 在本地复现问题进行实时调试

---

## 第五轮调查 - 定位真正的阻塞点

### 两个慢点

**从日志分析 84267d14 (第二个打开的新 session)**：

```
[前端] 01:29:32.333Z - send EMIT
[后端] 09:29:29.928 - d910c8f8 DONE (6ms)
[后端] 09:29:30.357 - watchfiles change detected
... 5.2秒空白 ...
[后端] 09:29:35.591 - Received chat:connect for 84267d14  ← 传输延迟 3.26秒
[后端] 09:29:35.602 - Chat session resuming...
[后端] 09:29:37.669 - Batch saved 141 messages  ← _sync_history_to_db 花了 2.07秒
[后端] 09:29:37.682 - T2 session_ready: 2090ms
```

**慢点 1**: 前端发送到后端收到 - 3.26秒传输延迟
- 后端日志有 watchfiles，说明可能是开发进程（有 reload=True）
- 开发进程的 watchfiles 热重载可能阻塞事件循环

**慢点 2**: `_sync_history_to_db()` 同步操作 - 2.07秒
- 读取 JSONL 文件并同步 141 条消息到数据库
- 这是同步函数，在 async 上下文中直接调用，阻塞事件循环

### 对比分析

| Session | found | 传输延迟 | 创建时间 | 总延迟 |
|---------|-------|----------|----------|--------|
| d910c8f8 | True | ~0ms | 6ms | 6ms |
| 84267d14 | False | 3.26s | 2.09s | 5.35s |

### 潜在的同步阻塞点

1. `_sync_history_to_db()` - 读文件 + 批量写数据库
2. `_load_history_from_file()` - 读取大文件
3. `_save_message_to_db()` - 在 `_read_output` 中被调用

### 需要确认

1. 用户连接的是哪个端口？
   - 生产 (8000): 无 watchfiles
   - 开发 (38010): 有 watchfiles，可能阻塞

2. 如果是生产端口，为什么日志中有 watchfiles？

---

## 第六轮调查 - 根因确认与修复 (02:15)

### 根因确认

**问题**：`threading.Lock()` 在 async 环境中阻塞事件循环

**阻塞链**：
1. 第一个 session 的 `_read_output` 后台任务持续运行
2. 每收到 Claude 消息 → `_save_message_to_db()` 获取数据库 `threading.Lock`
3. 第二个 session 的 `handle_chat_connect` 需要数据库操作
4. 数据库操作等待锁 → 阻塞整个事件循环
5. `sio.emit()` 等操作也被阻塞

**证据**：
- 第一个 session (found=True) 只需 5ms（无数据库操作）
- 第二个 session (found=False) 需要 1544ms（有数据库操作）
- 切回第一个 session 又变快（4ms）

### 修复方案

将所有同步数据库操作改为 `run_in_executor` 在线程池中执行：

1. **`chat_session_manager.py`**:
   - `_read_output` 中的 `_save_message_to_db` → `loop.run_in_executor(None, self._save_message_to_db, msg)`
   - `send_message` 中的 `db.save_chat_message` → `loop.run_in_executor(None, lambda: db.save_chat_message(...))`

2. **`socketio_connection_manager.py`**:
   - `db.set_chat_session_id` → `await loop.run_in_executor(None, lambda: ...)`
   - `db.get_chat_messages_desc` → `await loop.run_in_executor(None, lambda: ...)`
   - `db.get_chat_message_count` → `await loop.run_in_executor(None, lambda: ...)`

### 修复原理

`run_in_executor` 将同步函数放到线程池执行：
- 线程池中的线程获取 `threading.Lock` 时，只阻塞该线程
- 不阻塞 asyncio 事件循环
- 其他 async 任务（如 `sio.emit`）可以正常执行

### 修改的文件

- `app/services/chat_session_manager.py:259-260` - _save_message_to_db 异步化
- `app/services/chat_session_manager.py:344-351` - send_message 中的数据库调用异步化
- `app/services/socketio_connection_manager.py:330-331` - set_chat_session_id 异步化
- `app/services/socketio_connection_manager.py:405-408` - 历史消息加载异步化
