/**
 * Copyright (c) 2025 BillChen
 *
 * ConnectionManager - WebSocket 连接状态机
 *
 * 提供统一的连接管理，支持：
 * - 状态机驱动的连接管理
 * - 快速重连（100ms 起，最大 2s）
 * - 页面可见性感知（后台暂停，前台恢复）
 * - 网络状态感知（离线/在线）
 *
 * 状态转换图：
 *
 *         connect()
 *    ┌──────────────────┐
 *    │                  ▼
 * ┌───────┐         ┌───────────┐         ┌───────────┐
 * │ IDLE  │────────►│ CONNECTING│────────►│ CONNECTED │
 * └───────┘         └───────────┘         └───────────┘
 *     ▲                   │                     │
 *     │                   │ error               │ disconnect
 *     │                   ▼                     ▼
 *     │             ┌───────────┐         ┌───────────┐
 *     └─────────────│RECONNECTING│◄────────│DISCONNECTED│
 *                   └───────────┘         └───────────┘
 *                         │                     ▲
 *                         │ max_retries         │ suspend/resume
 *                         ▼                     │
 *                   ┌───────────┐         ┌───────────┐
 *                   │  FAILED   │         │ SUSPENDED │
 *                   └───────────┘         └───────────┘
 */

class ConnectionManager {
  // 状态常量
  static States = {
    IDLE: 'idle',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting',
    SUSPENDED: 'suspended',
    FAILED: 'failed'
  };

  // 状态转换表
  static Transitions = {
    'idle': {
      'connect': 'connecting'
    },
    'connecting': {
      'connected': 'connected',
      'error': 'reconnecting',
      'disconnect': 'idle'
    },
    'connected': {
      'disconnected': 'reconnecting',
      'disconnect': 'idle',
      'suspend': 'suspended'
    },
    'reconnecting': {
      'connected': 'connected',
      'max_retries': 'failed',
      'disconnect': 'idle',
      'suspend': 'suspended'
    },
    'suspended': {
      'resume': 'reconnecting',
      'disconnect': 'idle'
    },
    'failed': {
      'retry': 'connecting',
      'disconnect': 'idle'
    }
  };

  /**
   * @param {Object} socketIO - SocketIOManager 实例
   * @param {Object} options - 配置选项
   */
  constructor(socketIO, options = {}) {
    this.socketIO = socketIO;
    this.state = ConnectionManager.States.IDLE;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.listeners = new Map();

    // 配置
    this.baseDelay = options.baseDelay || 100;    // 首次重连延迟 100ms
    this.maxDelay = options.maxDelay || 2000;      // 最大延迟 2s
    this.maxRetries = options.maxRetries || 20;    // 最大重试次数

    // 绑定 Socket.IO 状态变化
    if (socketIO) {
      socketIO.onStateChange = (newState, oldState) => {
        this._onSocketStateChange(newState, oldState);
      };

      // 如果 SocketIO 已经连接，同步状态
      if (socketIO.state === 'connected') {
        this._log('SocketIO already connected, syncing state');
        this.state = ConnectionManager.States.CONNECTING;  // 先设为 connecting
        this._transition('connected');  // 再转换到 connected
      }
    }

    // 绑定页面可见性变化
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        this._onVisibilityChange();
      });
    }

    // 绑定网络状态变化
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this._onNetworkOnline();
      });
      window.addEventListener('offline', () => {
        this._onNetworkOffline();
      });
    }

    this._log('ConnectionManager initialized');
  }

  // ========== 公共 API ==========

  /**
   * 开始连接
   */
  connect() {
    return this._transition('connect');
  }

  /**
   * 主动断开连接
   */
  disconnect() {
    this._clearReconnectTimer();
    this.socketIO?.disconnect();
    return this._transition('disconnect');
  }

  /**
   * 手动重试（从 failed 状态）
   */
  retry() {
    if (this.state === ConnectionManager.States.FAILED) {
      this.reconnectAttempts = 0;
      return this._transition('retry');
    }
    return false;
  }

  /**
   * 注册事件监听器
   * @param {string} event - 事件名 ('stateChange')
   * @param {Function} callback - 回调函数
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  /**
   * 移除事件监听器
   */
  off(event, callback) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * 获取当前状态
   */
  getState() {
    return this.state;
  }

  /**
   * 获取重连信息
   */
  getReconnectInfo() {
    return {
      attempts: this.reconnectAttempts,
      maxRetries: this.maxRetries,
      nextDelay: this._getReconnectDelay()
    };
  }

  // ========== 内部方法 ==========

  /**
   * 执行状态转换
   */
  _transition(event) {
    const transitions = ConnectionManager.Transitions[this.state];
    const nextState = transitions?.[event];

    if (nextState) {
      const prevState = this.state;
      this.state = nextState;
      this._log(`State: ${prevState} -> ${nextState} (${event})`);
      this._onStateChange(prevState, nextState, event);
      return true;
    }

    this._log(`Invalid transition: ${this.state} + ${event}`);
    return false;
  }

  /**
   * 状态变化处理
   */
  _onStateChange(from, to, event) {
    // 触发事件
    this._emit('stateChange', { from, to, event });

    // 执行状态进入动作
    switch (to) {
      case ConnectionManager.States.CONNECTING:
        this.socketIO?.connect();
        break;

      case ConnectionManager.States.CONNECTED:
        this.reconnectAttempts = 0;
        this._clearReconnectTimer();
        this._emit('connected');
        break;

      case ConnectionManager.States.RECONNECTING:
        // 如果 SocketIO 已经连接，直接转为 connected
        if (this.socketIO?.state === 'connected') {
          this._log('SocketIO already connected, transitioning to connected');
          this._transition('connected');
          return;
        }
        this._scheduleReconnect();
        this._emit('reconnecting', { attempt: this.reconnectAttempts + 1 });
        break;

      case ConnectionManager.States.SUSPENDED:
        this._clearReconnectTimer();
        this._emit('suspended');
        break;

      case ConnectionManager.States.FAILED:
        this._emit('failed', { attempts: this.reconnectAttempts });
        break;

      case ConnectionManager.States.IDLE:
        this._clearReconnectTimer();
        this._emit('disconnected');
        break;
    }
  }

  /**
   * Socket.IO 状态变化回调
   */
  _onSocketStateChange(newState, oldState) {
    this._log(`SocketIO state: ${oldState} -> ${newState}`);

    if (newState === 'connected') {
      // 如果 SocketIO 连接成功，但 ConnectionManager 还在 idle 状态
      // 说明 SocketIO 是在 ConnectionManager 创建后才连接的
      // 需要先转到 connecting 再转到 connected
      if (this.state === ConnectionManager.States.IDLE) {
        this._log('SocketIO connected while CM in idle, fast-tracking to connected');
        this.state = ConnectionManager.States.CONNECTING;  // 跳过 connect 事件，直接设置
      }
      this._transition('connected');
    } else if (newState === 'disconnected') {
      if (this.state === ConnectionManager.States.CONNECTED) {
        this._transition('disconnected');
      } else if (this.state === ConnectionManager.States.CONNECTING) {
        this._transition('error');
      }
    }
  }

  /**
   * 页面可见性变化回调
   */
  _onVisibilityChange() {
    if (document.hidden) {
      this._log('Page hidden');
      if (this.state === ConnectionManager.States.CONNECTED ||
          this.state === ConnectionManager.States.RECONNECTING) {
        this._transition('suspend');
      }
    } else {
      this._log('Page visible');
      if (this.state === ConnectionManager.States.SUSPENDED) {
        this._transition('resume');
      }
    }
  }

  /**
   * 网络恢复回调
   */
  _onNetworkOnline() {
    this._log('Network online');
    if (this.state === ConnectionManager.States.RECONNECTING ||
        this.state === ConnectionManager.States.SUSPENDED) {
      // 网络恢复，立即重连，重置计数
      this.reconnectAttempts = 0;
      this._clearReconnectTimer();
      this._doReconnect();
    }
  }

  /**
   * 网络断开回调
   */
  _onNetworkOffline() {
    this._log('Network offline');
    // 可选：可以暂停重连，等待网络恢复
  }

  /**
   * 调度重连
   */
  _scheduleReconnect() {
    this._clearReconnectTimer();

    const delay = this._getReconnectDelay();
    this._log(`Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);

    this.reconnectTimer = setTimeout(() => {
      this._doReconnect();
    }, delay);
  }

  /**
   * 执行重连
   */
  _doReconnect() {
    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.maxRetries) {
      this._log('Max retries reached');
      this._transition('max_retries');
      return;
    }

    this._log(`Reconnecting (attempt ${this.reconnectAttempts}/${this.maxRetries})`);
    this.socketIO?.connect();
  }

  /**
   * 计算重连延迟
   * 指数退避：100, 200, 400, 800, 1600, 2000, 2000...
   */
  _getReconnectDelay() {
    return Math.min(
      this.baseDelay * Math.pow(2, this.reconnectAttempts),
      this.maxDelay
    );
  }

  /**
   * 清除重连定时器
   */
  _clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * 触发事件
   */
  _emit(event, data = {}) {
    const callbacks = this.listeners.get(event) || [];
    callbacks.forEach(cb => {
      try {
        cb(data);
      } catch (e) {
        console.error(`ConnectionManager event handler error:`, e);
      }
    });
  }

  /**
   * 日志
   */
  _log(msg) {
    if (typeof window !== 'undefined' && window.app?.debugLog) {
      window.app.debugLog('[ConnMgr] ' + msg);
    } else if (typeof console !== 'undefined') {
      console.log('[ConnMgr] ' + msg);
    }
  }
}

// 导出
if (typeof window !== 'undefined') {
  window.ConnectionManager = ConnectionManager;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ConnectionManager;
}
