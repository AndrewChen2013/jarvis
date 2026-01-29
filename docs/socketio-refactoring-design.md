# Socket.IO 连接管理重构设计

## 1. 需求定义

### 1.1 产品背景

Jarvis 是一个 Web 端的 Claude Code 客户端。用户通过浏览器与后端的 Claude CLI 进程交互。

**使用场景**：
- 用户在手机/电脑浏览器打开 Jarvis
- 一个页面内可以有多个 Chat Session（通过 tab 切换）
- 用户可能刷新页面、网络断开重连
- 同一时间只在一个设备上使用（不需要多设备同步）

### 1.2 核心需求

| ID | 需求 | 优先级 |
|----|------|--------|
| R1 | 用户发送消息后，必须收到 Claude 的响应 | P0 |
| R2 | 消息不能重复显示 | P0 |
| R3 | 切换 Session 后，当前 Session 能正常收发消息 | P0 |
| R4 | 页面刷新后，能继续之前的对话 | P1 |
| R5 | 网络断开重连后，消息流不中断 | P1 |

### 1.3 设计约束

| 约束 | 说明 |
|------|------|
| 单一消费者 | 每个 Session 同一时间只有一个消息接收者 |
| 无状态前端 | 前端不持久化状态，刷新后从后端恢复 |
| 可观测性 | 通过日志能快速定位问题（AI 调试友好） |

### 1.4 当前问题

| 问题 | 根因 | 影响的需求 |
|------|------|-----------|
| 消息重复 | 多个客户端注册了同一 Session 的 callback | R2 |
| 消息丢失 | 切换 Session 后 callback 未正确注册 | R1, R3 |
| 难以调试 | 状态分散，日志不清晰 | 所有 |

---

## 2. 架构设计

### 2.1 职责分离

```
┌─────────────────────────────────────────────────────────┐
│                    SocketIOServer                        │
│  职责: 连接生命周期、认证、事件路由                         │
│  文件: socketio_server.py                                │
└─────────────────────┬───────────────────────────────────┘
                      │ 路由事件
          ┌───────────┴───────────┐
          │                       │
┌─────────▼─────────┐   ┌────────▼─────────┐
│  ChatSocketHandler │   │TermSocketHandler │
│  职责:             │   │ 职责:             │
│  - Chat 消息处理   │   │ - Terminal 消息   │
│  - 连接状态管理    │   │ - PTY 管理        │
│  文件:             │   │ 文件:             │
│  chat_socket.py    │   │ terminal_socket.py│
└─────────┬─────────┘   └──────────────────┘
          │
┌─────────▼─────────┐
│ ChatSessionRegistry│
│ 职责:              │
│ - Session 单一所有权│
│ - Callback 生命周期 │
│ 文件:              │
│ chat_registry.py   │
└───────────────────┘
```

### 2.2 核心数据结构

```python
# chat_registry.py

@dataclass
class ChatConnection:
    """一个客户端到一个 Session 的连接"""
    sid: str                      # Socket.IO client ID
    session_id: str               # Chat session UUID
    callback: Callable            # 消息回调
    message_queue: asyncio.Queue  # 消息队列
    consumer_task: asyncio.Task   # 消费者任务
    created_at: datetime

    async def cleanup(self):
        """统一清理逻辑"""
        if self.consumer_task:
            self.consumer_task.cancel()
        # callback 由 registry 统一管理


class ChatSessionRegistry:
    """
    核心注册表 - 管理 Session 的唯一所有权

    关键约束: 每个 session_id 同一时间只能有一个 owner (sid)
    """

    def __init__(self):
        # session_id -> ChatConnection (单一所有者)
        self._session_owner: Dict[str, ChatConnection] = {}

        # sid -> Set[session_id] (一个客户端可以订阅多个 session)
        self._client_sessions: Dict[str, Set[str]] = {}

        self._lock = asyncio.Lock()

    async def acquire_session(self, sid: str, session_id: str,
                               session: ChatSession) -> ChatConnection:
        """
        获取 session 的所有权

        如果其他客户端持有该 session，先释放其所有权
        返回新创建的 ChatConnection
        """
        async with self._lock:
            # 1. 如果其他客户端持有，先释放
            if session_id in self._session_owner:
                old_conn = self._session_owner[session_id]
                if old_conn.sid != sid:
                    logger.info(f"[Registry] Session {session_id[:8]} ownership: "
                               f"{old_conn.sid[:8]} -> {sid[:8]}")
                    await self._release_connection(old_conn, session)

            # 2. 创建新连接
            conn = await self._create_connection(sid, session_id, session)

            # 3. 注册所有权
            self._session_owner[session_id] = conn
            if sid not in self._client_sessions:
                self._client_sessions[sid] = set()
            self._client_sessions[sid].add(session_id)

            logger.info(f"[Registry] Acquired: sid={sid[:8]}, session={session_id[:8]}")
            return conn

    async def release_session(self, sid: str, session_id: str,
                               session: ChatSession):
        """释放 session 所有权"""
        async with self._lock:
            if session_id in self._session_owner:
                conn = self._session_owner[session_id]
                if conn.sid == sid:
                    await self._release_connection(conn, session)
                    del self._session_owner[session_id]
                    if sid in self._client_sessions:
                        self._client_sessions[sid].discard(session_id)
                    logger.info(f"[Registry] Released: sid={sid[:8]}, session={session_id[:8]}")

    async def release_client(self, sid: str, chat_manager):
        """客户端断开时，释放其所有 session"""
        async with self._lock:
            if sid not in self._client_sessions:
                return

            for session_id in list(self._client_sessions[sid]):
                if session_id in self._session_owner:
                    conn = self._session_owner[session_id]
                    if conn.sid == sid:
                        session = chat_manager.get_session(session_id)
                        await self._release_connection(conn, session)
                        del self._session_owner[session_id]

            del self._client_sessions[sid]
            logger.info(f"[Registry] Client {sid[:8]} released all sessions")

    def get_owner(self, session_id: str) -> Optional[str]:
        """获取 session 当前的 owner sid"""
        conn = self._session_owner.get(session_id)
        return conn.sid if conn else None

    def get_connection(self, sid: str, session_id: str) -> Optional[ChatConnection]:
        """获取指定连接"""
        conn = self._session_owner.get(session_id)
        if conn and conn.sid == sid:
            return conn
        return None
```

### 2.3 简化后的 Chat Socket Handler

```python
# chat_socket.py

class ChatSocketHandler:
    """处理 Chat 相关的 Socket.IO 事件"""

    def __init__(self, sio, registry: ChatSessionRegistry, chat_manager):
        self.sio = sio
        self.registry = registry
        self.chat_manager = chat_manager
        self._register_handlers()

    def _register_handlers(self):
        @self.sio.on('chat:connect')
        async def handle_connect(sid, data):
            await self._handle_connect(sid, data)

        @self.sio.on('chat:message')
        async def handle_message(sid, data):
            await self._handle_message(sid, data)

        @self.sio.on('chat:disconnect')
        async def handle_disconnect(sid, data):
            await self._handle_disconnect(sid, data)

    async def _handle_connect(self, sid: str, data: dict):
        """处理 chat:connect"""
        session_id = data.get('session_id')
        working_dir = data.get('working_dir', '/')

        # 获取或创建 session
        session = await self._get_or_create_session(session_id, working_dir)

        # 获取 session 所有权 (核心操作)
        conn = await self.registry.acquire_session(sid, session.id, session)

        # 发送 ready 和历史消息
        await self._send_ready_and_history(sid, session)

    async def _handle_message(self, sid: str, data: dict):
        """处理 chat:message"""
        session_id = data.get('session_id')
        content = data.get('content', '')

        # 检查是否有所有权
        conn = self.registry.get_connection(sid, session_id)
        if not conn:
            # 自动获取所有权
            session = self.chat_manager.get_session(session_id)
            if session:
                conn = await self.registry.acquire_session(sid, session_id, session)
            else:
                await self._send_error(sid, session_id, "Session not found")
                return

        # 发送消息
        session = self.chat_manager.get_session(session_id)
        await self._process_message(sid, session, content)
```

---

## 3. 可观测性设计

### 3.1 设计原则

**核心目标**: 让 AI 能通过日志快速理解"发生了什么"

1. **状态可追踪**: 每次状态变化都有日志
2. **流向可追踪**: 消息从哪来、到哪去
3. **关联可追踪**: 通过 ID 串联完整链路

### 3.2 日志规范

```python
# 日志格式统一
# [模块] [动作] key1=value1, key2=value2

# 状态变化日志
logger.info(f"[Registry] Acquired: sid={sid[:8]}, session={session_id[:8]}")
logger.info(f"[Registry] Released: sid={sid[:8]}, session={session_id[:8]}")
logger.info(f"[Registry] Ownership transfer: session={session_id[:8]}, {old_sid[:8]} -> {new_sid[:8]}")

# 消息流向日志
logger.info(f"[Chat] Message received: sid={sid[:8]}, session={session_id[:8]}, len={len(content)}")
logger.info(f"[Chat] Message dispatched: session={session_id[:8]}, owner={owner_sid[:8]}")
logger.info(f"[Chat] Response sent: sid={sid[:8]}, session={session_id[:8]}, type={msg_type}")

# 错误日志
logger.error(f"[Chat] No owner for session: session={session_id[:8]}, sender={sid[:8]}")
logger.error(f"[Chat] Consumer crashed: sid={sid[:8]}, session={session_id[:8]}, error={e}")
```

### 3.3 诊断命令

```bash
# 1. 查看 session 所有权变化
grep "\[Registry\]" /Users/bill/jarvis/logs/app.log | tail -50

# 2. 追踪特定 session 的消息流
grep "session=XXXXXXXX" /Users/bill/jarvis/logs/app.log | tail -100

# 3. 查看特定客户端的所有活动
grep "sid=XXXXXXXX" /Users/bill/jarvis/logs/app.log | tail -100

# 4. 查看所有权转移
grep "Ownership transfer" /Users/bill/jarvis/logs/app.log | tail -20

# 5. 查看错误
grep "\[Chat\].*error\|ERROR" /Users/bill/jarvis/logs/app.log | tail -20
```

### 3.4 前端日志增强

```javascript
// 前端日志也要标准化
// [模块] [动作] key=value

// 连接状态
this.log(`[WS] Connect: session=${sessionId?.substring(0, 8)}, state=${this.state}`);
this.log(`[WS] Disconnect: reason=${reason}`);

// 消息收发
this.log(`[Chat] Send: session=${sessionId?.substring(0, 8)}, len=${content.length}`);
this.log(`[Chat] Received: session=${sessionId?.substring(0, 8)}, type=${type}`);

// 状态变化
this.log(`[Session] Switch: ${oldSession?.substring(0, 8)} -> ${newSession?.substring(0, 8)}`);
```

### 3.5 状态快照 API (可选)

```python
# 添加诊断 API 端点
@app.get("/debug/chat-state")
async def get_chat_state():
    """返回当前 Chat 状态快照"""
    return {
        "sessions": {
            session_id: {
                "owner_sid": registry.get_owner(session_id),
                "is_busy": session.is_busy,
                "callback_count": len(session._callbacks),
            }
            for session_id, session in chat_manager._sessions.items()
        },
        "clients": {
            sid: list(sessions)
            for sid, sessions in registry._client_sessions.items()
        }
    }
```

---

## 4. 业务正确性保证

### 4.1 核心不变量 (Invariants)

```python
# 这些条件在任何时刻都必须为真

# 1. 单一所有权
assert len([c for c in registry._session_owner.values()
            if c.session_id == session_id]) <= 1

# 2. 双向映射一致性
for session_id, conn in registry._session_owner.items():
    assert session_id in registry._client_sessions.get(conn.sid, set())

# 3. Callback 与所有权一致
for session_id, conn in registry._session_owner.items():
    session = chat_manager.get_session(session_id)
    if session:
        assert conn.callback in session._callbacks
```

### 4.2 测试场景

```python
# test_chat_ownership.py

async def test_single_client_single_session():
    """单客户端单 session - 基本场景"""
    # 1. 客户端 A 连接 session 1
    # 2. 发送消息
    # 3. 验证收到响应
    pass

async def test_single_client_switch_session():
    """单客户端切换 session"""
    # 1. 客户端 A 连接 session 1
    # 2. 客户端 A 切换到 session 2
    # 3. 验证 session 1 的 callback 已清理
    # 4. 验证 session 2 能收到消息
    pass

async def test_multiple_clients_same_session():
    """多客户端争抢同一 session"""
    # 1. 客户端 A 连接 session 1
    # 2. 客户端 B 连接 session 1
    # 3. 验证 A 的 callback 已移除
    # 4. 验证只有 B 收到消息
    pass

async def test_client_reconnect():
    """客户端重连"""
    # 1. 客户端 A (sid1) 连接 session 1
    # 2. 模拟断开 (但 polling 延迟断开)
    # 3. 客户端 A (sid2) 重新连接 session 1
    # 4. 验证只有 sid2 收到消息
    pass

async def test_message_during_switch():
    """session 切换期间的消息不丢失"""
    # 1. 客户端连接 session 1
    # 2. 发送消息
    # 3. 在响应到达前切换到 session 2
    # 4. 验证响应正确路由
    pass
```

### 4.3 错误处理策略

| 场景 | 处理策略 |
|------|----------|
| 消息发送时无 owner | 自动 acquire，然后发送 |
| Consumer 崩溃 | 清理 callback，记录错误，不影响其他 session |
| Session 不存在 | 返回错误给前端，前端显示提示 |
| 客户端断开 | 释放所有 session，清理所有资源 |

---

## 5. 实施方案

不拆文件。问题在于状态管理，不是文件结构。

### 核心改动

**1. `ChatSession` - 单一 callback 模式**

```python
# chat_session_manager.py

class ChatSession:
    # 改成单一 callback，带 owner 标识
    _callback: Optional[Callable] = None
    _callback_owner: Optional[str] = None  # sid

    def set_callback(self, callback: Callable, owner: str):
        """设置 callback，新的覆盖旧的"""
        if self._callback_owner and self._callback_owner != owner:
            logger.info(f"[Session] Callback owner: {self._callback_owner[:8]} -> {owner[:8]}")
        self._callback = callback
        self._callback_owner = owner

    def clear_callback(self, owner: str):
        """清理 callback，只有 owner 能清理"""
        if self._callback_owner == owner:
            self._callback = None
            self._callback_owner = None
```

**2. `socketio_connection_manager.py` - 简化状态**

```python
# 去掉 client.chat_callbacks，由 ChatSession 管理
# 保留 consumer_task 和 message_queue（这些是 per-client 的）

@dataclass
class ClientInfo:
    sid: str
    authenticated: bool = False
    is_closed: bool = False
    subscriptions: Set[str] = field(default_factory=set)
    # 每个 session 的消息队列和消费者
    chat_queues: Dict[str, asyncio.Queue] = field(default_factory=dict)
    chat_consumers: Dict[str, asyncio.Task] = field(default_factory=dict)
```

**3. 连接流程简化**

```python
async def _handle_chat_connect(self, sid: str, session_id: str, ...):
    session = get_or_create_session(session_id)

    # 直接设置 callback，ChatSession 内部处理旧 callback
    session.set_callback(callback_fn, owner=sid)

    # 启动消费者
    start_consumer(sid, session_id)
```

### 文件清单

| 文件 | 操作 | 改动 |
|------|------|------|
| `chat_session_manager.py` | 修改 | callback 改成单一模式 |
| `socketio_connection_manager.py` | 修改 | 简化状态管理，加强日志 |
