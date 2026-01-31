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

