---
name: websocket-infrastructure
description: Use when debugging WebSocket connection issues, session management, or reconnection problems in Jarvis
---

# WebSocket 长连接基础设施

## 架构概览

Jarvis 使用 Socket.IO 实现 WebSocket 长连接，支持多会话复用和断联恢复。

```
┌─────────────────┐     Socket.IO      ┌──────────────────────┐
│   前端 (Browser) │◄──────────────────►│   后端 (Python)       │
│                 │  WebSocket/Polling  │                      │
│  SocketIOManager│                    │  SocketIOConnectionMgr│
│  SessionManager │                    │  ChatSessionManager   │
│  ChatMode       │                    │                      │
└─────────────────┘                    └──────────────────────┘
```

## 关键文件

| 文件 | 职责 |
|-----|------|
| `static/socketio-websocket.js` | SocketIOManager - 前端连接管理 |
| `static/session-manager.js` | SessionManager - 多会话管理 |
| `static/chat/chat-websocket.js` | ChatMode - Chat 消息处理 |
| `static/app.js` | App - 页面可见性重连 |
| `app/services/socketio_manager.py` | 后端 Socket.IO 服务器配置 |
| `app/services/socketio_connection_manager.py` | 后端连接和会话管理 |

## 连接配置

### 后端 (`socketio_manager.py:30-32`)
```python
ping_timeout=60,      # 60 秒没收到客户端响应则断开
ping_interval=25,     # 每 25 秒发送一次 ping
```

### 前端 (`socketio-websocket.js:68-76`)
```javascript
this.socket = io({
    transports: ['websocket', 'polling'],  // WebSocket 优先
    reconnection: true,
    reconnectionAttempts: 10,    // 最多 10 次
    reconnectionDelay: 1000,     // 初始延迟 1 秒
    reconnectionDelayMax: 5000,  // 最大延迟 5 秒
    timeout: 10000,
});
```

## Session 复用机制

### ID 映射三层设计

1. **内存映射** (`_session_id_mapping`)：快速恢复
2. **数据库持久化**：长期恢复
3. **前端 Handler 映射**：Socket.IO 级别路由

### 会话订阅模型

- 一个 Socket.IO 连接可订阅多个 Chat 会话
- 多个客户端可订阅同一会话
- 通过 `subscriptionData` 跟踪订阅信息

## 断联恢复机制

### 页面可见性重连 (`app.js:101-130`)
```javascript
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        if (!this.ws || this.ws.readyState >= WebSocket.CLOSING) {
            this.attemptReconnect();
        }
    }
});
```

### 重连后恢复 (`socketio-websocket.js:133-151`)
```javascript
_onAuthSuccess() {
    const isReconnection = this.hasConnectedBefore;
    const processedKeys = this._processPendingOperations();
    if (isReconnection) {
        this._resendSubscriptions(processedKeys);
    }
    this._processPendingConnects();
}
```

### 幂等性保护 (`socketio_connection_manager.py:292-296`)
```python
# 防止重连时重复发送历史消息
if session_id in client.chat_callbacks:
    return  # 已连接，跳过
```

## 历史消息恢复

### 流程
1. 发送 `ready` 事件
2. 从数据库加载最近 15 条消息
3. 逐条发送历史
4. 发送 `history_end` 标记

### 重连时跳过渲染 (`chat-websocket.js:566-598`)
- 检测 DOM 中是否已有消息
- 如果是重连 (`isReconnect=true`)，跳过历史渲染

## 已知问题

### 🔴 移动端重连失败（当前最大问题）

**场景**：
1. 手机浏览器打开 Jarvis
2. 切换到其他 App，网页进入后台
3. 系统暂停后台网页网络连接，WebSocket 断开
4. 切回 Jarvis，需要重连

**症状**：
- 重连基本不成功
- 需要退出会话、重新打开 session 才能恢复
- 用户体验差

**可能原因**：
1. `reconnectionDelay: 1000, reconnectionDelayMax: 5000` 延迟太长
2. `visibilitychange` 事件触发时机问题
3. 重连时 session 状态不一致
4. `_resendSubscriptions` 逻辑有缺陷
5. 后端 `chat_callbacks` 检查可能误判

**调试入口**：
- 前端远程日志：Debug Panel → Remote
- 查看日志：`tail -f /Users/bill/jarvis/logs/frontend/*.log`
- 后端日志：`tail -f /tmp/jarvis.log`
- 关键日志关键词：`[SocketIO]`, `[MuxWS]`, `visibilitychange`, `reconnect`

## 调试命令

```bash
# 查看前端远程日志
tail -100 "$(ls -t /Users/bill/jarvis/logs/frontend/*.log | head -1)"

# 查看后端日志
tail -100 /Users/bill/jarvis/logs/app.log

# 实时监控
tail -f /Users/bill/jarvis/logs/app.log | grep -E "(SocketIO|reconnect|disconnect)"
```

---

## 2026-01-30 Session 切换慢问题排查记录

### 问题描述

用户报告：第一个 session 打开很快，但切换到其他 session 时 "connecting 半天才连上"。

### 排查过程

#### 1. 添加 Timing 日志

在以下位置添加了 `[TIMING]` 日志：

**前端 `chat-websocket.js`**:
```javascript
connectMux(sessionId, workingDir, session) {
  const startTime = performance.now();
  this.log(`[TIMING] connectMux START: session=${sessionId?.substring(0, 8)}`);
  // ...
  this.log(`[TIMING] onConnect callback received at +${(performance.now() - startTime).toFixed(1)}ms`);
}
```

**前端 `socketio-websocket.js`**:
```javascript
connectChat(sessionId, workingDir, options = {}) {
  const startTime = performance.now();
  this.log(`[TIMING] connectChat START: sessionId=${sessionId?.substring(0, 8)}, state=${this.state}`);
  // handler EXISTS 或 NEW handler
  // send() 调用时机
}

_handleMessage(channel, type, data) {
  if (type === 'connected' || type === 'ready') {
    this.log(`[TIMING] _handleMessage: RECEIVED ${channel}:${type}`);
  }
}
```

#### 2. 发现的关键问题

**问题 A: 前后端 callback 状态不同步**

当用户切换 session 时：
1. 后端会清理旧 session 的 callback（`socketio_connection_manager.py:333-344`）
2. 但前端的 `handler` 仍然存在
3. 当用户切换回原 session 时，前端发现 `handler EXISTS`，**不发送 `chat:connect`**
4. 后端没有 callback，无法响应
5. 直到用户发送消息时，后端触发 auto-connect，导致 **14-42 秒延迟**

**日志证据**:
```
# 后端日志
[SocketIO] Client QEy5Hbsz has no callback for session d910c8f8, auto-connecting...
```

**修复**: 在 `socketio-websocket.js` 的 `connectChat()` 中，即使 `handler EXISTS`，也总是发送 `chat:connect` 到后端。

#### 3. 时间线分析

**切换已有 session (handler EXISTS，修复后)**:
- 前端 emit: `01:29:39.290Z`
- 后端 receive: `01:29:39.203Z` (几乎同时)
- 前端 receive ready: `01:29:39.344Z`
- **总延迟: ~54ms** ✅ 正常

**第一次打开新 session (NEW handler)**:
- 前端 emit: `01:29:32.333Z`
- 后端 receive: `01:29:35.591Z`
- **传输延迟: 3.3 秒** ❓待调查
- 后端 session 创建: 2.1 秒（Claude CLI 启动）
- **总延迟: ~5.5 秒**

#### 4. 待调查问题

**传输延迟 3.3 秒**:
- Transport 显示是 `websocket`（不是 polling）
- 同一连接，切换 session 只需 54ms
- 怀疑与 watchfiles 热重载有关
- 日志显示 `watchfiles.main - 1 change detected` 在延迟期间

### 关键日志关键词

```bash
# 查找 timing 日志
grep -E "TIMING|transport" "$(ls -t /Users/bill/jarvis/logs/frontend/*.log | head -1)"

# 查找后端处理时间
grep -E "Chat connect T[0-9]|Chat connect DONE" /Users/bill/jarvis/logs/app.log | tail -20

# 查找 watchfiles 热重载
grep "watchfiles\|change detected" /Users/bill/jarvis/logs/app.log | tail -20
```

### 后端处理时间分解

后端 `socketio_connection_manager.py` 已有 timing 日志：
```
T1 get_session: 从内存获取 session
T2 session_ready: session 创建/恢复完成（含 Claude CLI 启动）
T3 callback_set: 设置消息回调
T4 history_loaded: 从数据库加载历史消息
T5 ready_sent: 发送 chat:ready 到前端
T6 history_sent: 发送历史消息完成
```

**正常值**:
- 已有 session: 5-10ms 总耗时
- 新 session: 2000-3000ms（主要是 Claude CLI 启动）

### 前端配置变更记录

**ConnectionManager** (新增):
- 状态机驱动的连接管理
- 快速重连（100ms 起，最大 2s）
- 页面可见性感知（后台暂停，前台恢复）
- 网络状态感知

**SocketIOManager 配置**:
```javascript
reconnection: false,  // ConnectionManager handles reconnection
```

### 文件版本号

修改前端 JS 文件后，必须更新 `static/index.html` 中的版本号：
- `socketio-websocket.js?v=13`
- `chat-websocket.js?v=13`
- `connection-manager.js?v=4`
