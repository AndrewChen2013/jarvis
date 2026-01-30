# WebSocket 连接管理重构设计

## 设计原则

1. **Single Source of Truth**: 连接状态只在一个地方管理
2. **分层清晰**: 传输层只管传输，应用层只管业务
3. **状态机驱动**: 所有状态转换通过明确的状态机
4. **快速恢复**: 移动端场景优先，断开后立即重连

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        应用层 (App/ChatMode)                      │
│  - 不关心连接细节，只关心"能不能发消息"                              │
│  - 监听 ConnectionManager 的状态变化事件                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 事件: connected/disconnected/reconnecting
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   ConnectionManager (新增)                        │
│  - 唯一的连接状态管理者                                            │
│  - 实现状态机                                                     │
│  - 处理重连策略                                                   │
│  - 处理页面可见性                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 使用
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   SocketIOManager (现有，简化)                     │
│  - 只负责 Socket.IO 连接/断开                                      │
│  - 不做重连决策，只执行                                            │
│  - 上报连接事件给 ConnectionManager                               │
└─────────────────────────────────────────────────────────────────┘
```

## ConnectionManager 状态机

```javascript
const States = {
  IDLE: 'idle',           // 未连接，不需要连接
  CONNECTING: 'connecting', // 正在连接
  CONNECTED: 'connected',   // 已连接
  RECONNECTING: 'reconnecting', // 断开后正在重连
  SUSPENDED: 'suspended',   // 页面后台，暂停重连
  FAILED: 'failed'         // 重连失败，需要用户干预
};

const Transitions = {
  // from IDLE
  [States.IDLE]: {
    'connect': States.CONNECTING
  },

  // from CONNECTING
  [States.CONNECTING]: {
    'connected': States.CONNECTED,
    'error': States.RECONNECTING,
    'disconnect': States.IDLE
  },

  // from CONNECTED
  [States.CONNECTED]: {
    'disconnected': States.RECONNECTING,
    'disconnect': States.IDLE,
    'suspend': States.SUSPENDED
  },

  // from RECONNECTING
  [States.RECONNECTING]: {
    'connected': States.CONNECTED,
    'max_retries': States.FAILED,
    'disconnect': States.IDLE,
    'suspend': States.SUSPENDED
  },

  // from SUSPENDED (页面后台)
  [States.SUSPENDED]: {
    'resume': States.RECONNECTING,  // 页面恢复，立即重连
    'disconnect': States.IDLE
  },

  // from FAILED
  [States.FAILED]: {
    'retry': States.CONNECTING,  // 用户手动重试
    'disconnect': States.IDLE
  }
};
```

## 重连策略

### 移动端优化

```javascript
const ReconnectStrategy = {
  // 基础参数
  baseDelay: 100,        // 首次重试: 100ms (几乎立即)
  maxDelay: 2000,        // 最大延迟: 2秒
  maxAttempts: 20,       // 最多尝试 20 次

  // 指数退避但有上限
  getDelay(attempt) {
    // 0: 100ms, 1: 200ms, 2: 400ms, 3: 800ms, 4+: 2000ms
    return Math.min(this.baseDelay * Math.pow(2, attempt), this.maxDelay);
  },

  // 页面可见性变化时的策略
  onPageVisible() {
    // 立即重连，不等待
    return { immediate: true, resetAttempts: true };
  },

  // 网络恢复时的策略
  onNetworkOnline() {
    // 立即重连
    return { immediate: true, resetAttempts: true };
  }
};
```

### 页面可见性处理

```javascript
class ConnectionManager {
  constructor() {
    // 监听页面可见性
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.dispatch('suspend');
      } else {
        this.dispatch('resume');
      }
    });

    // 监听网络状态
    window.addEventListener('online', () => {
      this.dispatch('network_online');
    });
  }

  dispatch(event) {
    const currentState = this.state;
    const nextState = Transitions[currentState]?.[event];

    if (nextState) {
      this.state = nextState;
      this.onStateChange(currentState, nextState, event);
    }
  }

  onStateChange(from, to, event) {
    this.log(`State: ${from} -> ${to} (${event})`);

    // 状态转换时的动作
    if (to === States.RECONNECTING) {
      this.startReconnect();
    } else if (to === States.SUSPENDED) {
      this.pauseReconnect();
    } else if (to === States.CONNECTED) {
      this.onConnected();
    }

    // 通知应用层
    this.emit('stateChange', { from, to, event });
  }
}
```

## Session 恢复

### 问题
当前 session 复用逻辑散落在多处，重连后经常状态不一致。

### 解决方案

```javascript
class ConnectionManager {
  // 连接成功后自动恢复所有活跃 session
  async onConnected() {
    // 1. 获取所有需要恢复的 session
    const sessions = this.sessionManager.getActiveSessions();

    // 2. 按顺序恢复（避免并发导致的状态问题）
    for (const session of sessions) {
      await this.restoreSession(session);
    }

    // 3. 通知 UI 更新
    this.emit('sessionsRestored');
  }

  async restoreSession(session) {
    // 发送 chat:connect，带上 session ID
    // 后端会检查 session 是否存在，返回历史
    return this.socketIO.connectChat(session.id, session.workDir, {
      resume: session.claudeSessionId
    });
  }
}
```

## 迁移路径

### Phase 1: 创建 ConnectionManager
- 新建 `static/connection-manager.js`
- 实现状态机和重连策略
- 不修改现有代码

### Phase 2: 集成
- 修改 `socketio-websocket.js`，上报事件给 ConnectionManager
- 移除 Socket.IO 的内置重连（`reconnection: false`）
- 移除 `app.js` 中的 `visibilitychange` 处理

### Phase 3: 清理
- 删除 `app.shouldReconnect`
- 删除 `session.shouldReconnect`
- 删除 `app.attemptReconnect`
- 删除所有分散的重连逻辑

### Phase 4: 测试
- 移动端后台/前台切换
- 网络断开/恢复
- 多 session 同时恢复
- 长时间后台后恢复

## 预期效果

| 场景 | 当前 | 重构后 |
|-----|-----|-------|
| 手机切换 App 后返回 | 基本连不上，需要手动刷新 | 100ms 内自动恢复 |
| 网络波动 | 1-5秒重连，可能失败 | 100ms-2s 自动重连 |
| 多 session | 状态经常不一致 | 统一恢复，状态一致 |
| 调试 | 日志分散，难以追踪 | 状态机日志，清晰可追踪 |
