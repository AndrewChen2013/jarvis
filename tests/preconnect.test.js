/**
 * Copyright (c) 2025 BillChen
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * WebSocket 预连接功能测试
 *
 * 测试场景：
 * 1. 认证成功后自动预连接
 * 2. 登出时断开连接
 * 3. 预连接不阻塞 UI
 * 4. 重复预连接不会创建多个连接
 */

// Polyfill
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock MessagePack
global.MessagePack = {
  encode: (data) => new TextEncoder().encode(JSON.stringify(data)),
  decode: (data) => JSON.parse(new TextDecoder().decode(data))
};

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.binaryType = 'blob';
    this.sentMessages = [];
    MockWebSocket.instances.push(this);

    setTimeout(() => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        this.readyState = MockWebSocket.OPEN;
        if (this.onopen) this.onopen({});
      }
    }, 0);
  }

  send(data) {
    this.sentMessages.push(data);
  }

  close(code = 1000) {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose({ code });
  }

  receiveMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }
}

global.WebSocket = MockWebSocket;

// Mock localStorage
global.localStorage = {
  _data: {},
  getItem: (key) => global.localStorage._data[key] || null,
  setItem: (key, value) => { global.localStorage._data[key] = value; },
  removeItem: (key) => { delete global.localStorage._data[key]; },
  clear: () => { global.localStorage._data = {}; }
};

// Mock window
delete window.location;
window.location = { protocol: 'http:', host: 'localhost:8080' };

// Load MuxWebSocket
const fs = require('fs');
const path = require('path');

const muxWebSocketCode = fs.readFileSync(
  path.join(__dirname, '../static/mux-websocket.js'),
  'utf8'
);
eval(muxWebSocketCode);

// Get MuxWebSocket class from window.muxWs
const MuxWebSocket = window.muxWs.constructor;

// Mock App class with preconnect methods
class MockApp {
  constructor() {
    this.token = 'test-token';
    this.debugLog = jest.fn();
  }

  _preconnectWebSocket() {
    if (window.muxWs && window.muxWs.state === 'disconnected') {
      this.debugLog('[Preconnect] Starting WebSocket preconnect...');
      setTimeout(() => {
        if (window.muxWs.state === 'disconnected') {
          window.muxWs.connect();
        }
      }, 100);
    }
  }

  _disconnectWebSocket() {
    if (window.muxWs) {
      this.debugLog('[Preconnect] Disconnecting WebSocket...');
      window.muxWs.disconnect();
    }
  }
}


describe('WebSocket 预连接功能', () => {
  let muxWs;
  let app;

  beforeEach(() => {
    jest.useFakeTimers();
    MockWebSocket.instances = [];

    muxWs = new MuxWebSocket();
    window.muxWs = muxWs;

    app = new MockApp();
    window.app = app;
  });

  afterEach(() => {
    if (muxWs.ws) {
      muxWs.ws.close();
    }
    if (muxWs.pingInterval) {
      clearInterval(muxWs.pingInterval);
      muxWs.pingInterval = null;
    }
    muxWs.handlers.clear();
    muxWs.subscriptionData.clear();
    muxWs.pendingOperations = [];
    MockWebSocket.instances = [];
    jest.useRealTimers();
  });

  describe('_preconnectWebSocket 方法', () => {
    test('应该在 disconnected 状态时调用 connect', async () => {
      expect(muxWs.state).toBe('disconnected');

      app._preconnectWebSocket();

      // 预连接使用 setTimeout(100ms)
      jest.advanceTimersByTime(100);

      expect(muxWs.ws).not.toBeNull();
      expect(muxWs.state).toBe('connecting');
    });

    test('预连接应该是异步的（不阻塞）', () => {
      const startTime = Date.now();

      app._preconnectWebSocket();

      // 调用后立即返回，不等待连接
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(50);

      // 此时连接还未开始
      expect(muxWs.ws).toBeNull();

      // 100ms 后才开始连接
      jest.advanceTimersByTime(100);
      expect(muxWs.ws).not.toBeNull();
    });

    test('已连接状态下不应重复连接', async () => {
      // 先建立连接
      muxWs.connect();
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      expect(muxWs.state).toBe('connected');
      const existingWs = muxWs.ws;

      // 尝试预连接
      app._preconnectWebSocket();
      jest.advanceTimersByTime(100);

      // 应该使用同一个连接
      expect(muxWs.ws).toBe(existingWs);
    });

    test('connecting 状态下不应创建新连接', () => {
      // 开始连接但未完成
      muxWs.connect();
      expect(muxWs.state).toBe('connecting');
      const existingWs = muxWs.ws;

      // 尝试预连接
      app._preconnectWebSocket();
      jest.advanceTimersByTime(100);

      // 应该使用同一个连接
      expect(muxWs.ws).toBe(existingWs);
    });

    test('应该记录调试日志', () => {
      app._preconnectWebSocket();

      expect(app.debugLog).toHaveBeenCalledWith(
        '[Preconnect] Starting WebSocket preconnect...'
      );
    });
  });

  describe('_disconnectWebSocket 方法', () => {
    test('应该断开已连接的 WebSocket', async () => {
      // 先建立连接
      muxWs.connect();
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      expect(muxWs.state).toBe('connected');

      // 断开连接
      app._disconnectWebSocket();

      expect(muxWs.state).toBe('disconnected');
    });

    test('断开后不应自动重连', async () => {
      // 先建立连接
      muxWs.connect();
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      // 断开连接
      app._disconnectWebSocket();

      // 等待可能的重连
      jest.advanceTimersByTime(5000);

      // 应该保持断开状态
      expect(muxWs.state).toBe('disconnected');
      expect(muxWs.reconnectAttempts).toBe(muxWs.maxReconnectAttempts);
    });

    test('muxWs 不存在时不应报错', () => {
      window.muxWs = null;

      expect(() => {
        app._disconnectWebSocket();
      }).not.toThrow();
    });

    test('应该记录调试日志', async () => {
      muxWs.connect();
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      app._disconnectWebSocket();

      expect(app.debugLog).toHaveBeenCalledWith(
        '[Preconnect] Disconnecting WebSocket...'
      );
    });
  });

  describe('预连接后的 session 操作', () => {
    test('预连接成功后 connectChat 应该立即发送', async () => {
      // 预连接
      app._preconnectWebSocket();
      jest.advanceTimersByTime(100);
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      expect(muxWs.state).toBe('connected');
      const msgCountBefore = muxWs.ws.sentMessages.length;

      // 连接 chat session
      muxWs.connectChat('chat-1', '/test', { onMessage: jest.fn() });

      // 应该立即发送，不需要等待
      expect(muxWs.ws.sentMessages.length).toBe(msgCountBefore + 1);
    });

    test('预连接成功后 connectTerminal 应该立即发送', async () => {
      // 预连接
      app._preconnectWebSocket();
      jest.advanceTimersByTime(100);
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      expect(muxWs.state).toBe('connected');
      const msgCountBefore = muxWs.ws.sentMessages.length;

      // 连接 terminal session
      muxWs.connectTerminal('term-1', '/test', { onMessage: jest.fn() });

      // 应该立即发送，不需要等待
      expect(muxWs.ws.sentMessages.length).toBe(msgCountBefore + 1);
    });
  });

  describe('保活机制', () => {
    test('预连接成功后应该启动心跳', async () => {
      app._preconnectWebSocket();
      jest.advanceTimersByTime(100);
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      expect(muxWs.pingInterval).not.toBeNull();
    });

    test('心跳应该每 30 秒发送一次 ping', async () => {
      app._preconnectWebSocket();
      jest.advanceTimersByTime(100);
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      const msgCountAfterAuth = muxWs.ws.sentMessages.length;

      // 等待 30 秒
      jest.advanceTimersByTime(30000);

      // 应该多发送了一条 ping 消息
      expect(muxWs.ws.sentMessages.length).toBe(msgCountAfterAuth + 1);

      // 验证是 ping 消息
      const lastMsg = muxWs.ws.sentMessages[muxWs.ws.sentMessages.length - 1];
      const decoded = unpackMessage(MessagePack.decode(lastMsg));
      expect(decoded.channel).toBe('system');
      expect(decoded.type).toBe('ping');
    });

    test('断开连接后应该停止心跳', async () => {
      app._preconnectWebSocket();
      jest.advanceTimersByTime(100);
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      expect(muxWs.pingInterval).not.toBeNull();

      app._disconnectWebSocket();

      expect(muxWs.pingInterval).toBeNull();
    });
  });
});
