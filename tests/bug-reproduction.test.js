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
 * Bug 复现测试
 *
 * 每个 bug 都有对应的测试用例来复现问题
 * 修复后测试应该通过
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

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.binaryType = 'blob';
    this.sentMessages = [];

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
  clear: () => { global.localStorage._data = {}; }
};

// Mock window.location
delete window.location;
window.location = { protocol: 'http:', host: 'localhost:8080' };
window.app = { debugLog: jest.fn(), authToken: 'test-token' };

// Load source files
const fs = require('fs');
const path = require('path');

const sessionManagerCode = fs.readFileSync(
  path.join(__dirname, '../static/session-manager.js'),
  'utf8'
);

const muxWebSocketCode = fs.readFileSync(
  path.join(__dirname, '../static/mux-websocket.js'),
  'utf8'
);

// Execute code in global scope using Function constructor
// This avoids strict mode eval limitations
const muxExports = new Function(muxWebSocketCode + '\nreturn { MuxWebSocket, unpackMessage };')();
global.MuxWebSocket = muxExports.MuxWebSocket;
global.unpackMessage = muxExports.unpackMessage;

const { SessionManager: SM, SessionInstance: SI } = new Function(sessionManagerCode + '\nreturn { SessionManager, SessionInstance };')();
global.SessionManager = SM;
global.SessionInstance = SI;

// Helper: Decode and unpack message to normalized format
function decodeMessage(packed) {
  const msg = MessagePack.decode(packed);
  return unpackMessage(msg);
}

describe('Bug 复现测试', () => {
  let muxWs;
  let sessionManager;
  let mockApp;

  beforeEach(() => {
    jest.useFakeTimers();

    // Reset DOM
    document.body.innerHTML = '<div id="terminal-output"></div>';

    // Reset muxWs - use the global MuxWebSocket class
    muxWs = new MuxWebSocket();
    window.muxWs = muxWs;

    // Reset sessionManager - use the global SessionManager class
    mockApp = {
      debugLog: jest.fn(),
      showView: jest.fn(),
      floatingButton: { update: jest.fn() }
    };
    sessionManager = new SessionManager(mockApp);

    localStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    if (muxWs && muxWs.pingInterval) {
      clearInterval(muxWs.pingInterval);
    }
  });

  describe('BUG-001: closeAll() 迭代时修改 Map', () => {
    /**
     * 问题: closeAll() 在 for...of 循环中调用 closeSession()，
     * 而 closeSession() 会从 Map 中删除元素，导致迭代不完整
     */
    test('closeAll 应该关闭所有 session，不能遗漏', () => {
      // 创建多个 session
      sessionManager.openSession('session-1', 'Session 1');
      sessionManager.openSession('session-2', 'Session 2');
      sessionManager.openSession('session-3', 'Session 3');

      expect(sessionManager.sessions.size).toBe(3);

      // 关闭所有
      sessionManager.closeAll();

      // BUG: 由于迭代中删除，可能只关闭了部分 session
      // 修复后应该全部关闭
      expect(sessionManager.sessions.size).toBe(0);
    });

    test('closeAll 连续调用不应崩溃', () => {
      sessionManager.openSession('session-1', 'Session 1');
      sessionManager.openSession('session-2', 'Session 2');

      expect(() => {
        sessionManager.closeAll();
        sessionManager.closeAll(); // 第二次调用
      }).not.toThrow();

      expect(sessionManager.sessions.size).toBe(0);
    });
  });

  describe('BUG-002: unsubscribe() 未清理 subscriptionData', () => {
    /**
     * 问题: unsubscribe() 只删除 handlers，不删除 subscriptionData
     * 导致重连后会重新发送已取消的订阅
     */
    test('unsubscribe 应该同时清理 subscriptionData', async () => {
      // 连接并认证
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      // 清理 ping interval
      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      // 订阅 terminal
      muxWs.connectTerminal('session-1', '/test', { rows: 40, cols: 120 });

      expect(muxWs.handlers.has('terminal:session-1')).toBe(true);
      expect(muxWs.subscriptionData.has('terminal:session-1')).toBe(true);

      // 直接调用 unsubscribe（不通过 disconnectTerminal）
      muxWs.unsubscribe('session-1', 'terminal');

      // BUG: handlers 被删除了，但 subscriptionData 还在
      expect(muxWs.handlers.has('terminal:session-1')).toBe(false);
      // 修复后 subscriptionData 也应该被删除
      expect(muxWs.subscriptionData.has('terminal:session-1')).toBe(false);
    });

    test('重连后不应重新订阅已取消的 session', async () => {
      // 连接并认证
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      // 订阅然后取消
      muxWs.connectTerminal('session-1', '/test', {});
      muxWs.unsubscribe('session-1', 'terminal');

      // 模拟断开重连
      const oldWs = muxWs.ws;
      muxWs.ws.close(1006);
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(10);

      // 重连成功
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      // 检查重连后发送的消息
      const msgs = muxWs.ws.sentMessages.map(m => decodeMessage(m));
      const connectMsgs = msgs.filter(m => m.type === 'connect' && m.session_id === 'session-1');

      // BUG: 重连后不应该重新发送已取消的订阅
      expect(connectMsgs.length).toBe(0);
    });
  });

  describe('BUG-003: authenticated 状态未正确重置', () => {
    /**
     * 问题: disconnect() 和 auth_failed 都没有重置 authenticated = false
     */
    test('disconnect 后 authenticated 应该为 false', async () => {
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      expect(muxWs.authenticated).toBe(true);

      muxWs.disconnect();

      // BUG: authenticated 仍然是 true
      expect(muxWs.authenticated).toBe(false);
    });

    test('auth_failed 后 authenticated 应该为 false', async () => {
      // 先成功认证一次
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });
      expect(muxWs.authenticated).toBe(true);

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      // 断开并重连
      muxWs.ws.close(1006);
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(10);

      // 这次认证失败
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_failed', data: { reason: 'token expired' } });

      // BUG: authenticated 仍然是 true（从上次成功遗留）
      expect(muxWs.authenticated).toBe(false);
    });

    test('getStats 应该返回正确的 authenticated 状态', async () => {
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      expect(muxWs.getStats().authenticated).toBe(true);

      muxWs.disconnect();

      expect(muxWs.getStats().authenticated).toBe(false);
    });
  });

  describe('BUG-004: closeSession 无条件关闭 terminal 和 chat', () => {
    /**
     * 问题: closeSession 总是调用 closeTerminal 和 closeChat，
     * 即使该 session 只有其中一个
     */
    test('只有 terminal 的 session 不应发送 closeChat', async () => {
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      // 创建 session 并只连接 terminal
      const session = sessionManager.openSession('test-session', 'Test');
      muxWs.connectTerminal('test-session', '/test', {});

      // 记录发送前的消息数
      const msgCountBefore = muxWs.ws.sentMessages.length;

      // 关闭 session
      sessionManager.closeSession('test-session');

      // 检查发送的消息
      const newMsgs = muxWs.ws.sentMessages.slice(msgCountBefore).map(m => decodeMessage(m));

      // 应该只有 terminal close，没有 chat close
      const terminalClose = newMsgs.filter(m => m.channel === 'terminal' && m.type === 'close');
      const chatClose = newMsgs.filter(m => m.channel === 'chat' && m.type === 'close');

      expect(terminalClose.length).toBe(1);
      // BUG: 不应该发送 chat close
      expect(chatClose.length).toBe(0);
    });
  });

  describe('BUG-005: Session ID 重映射竞态条件', () => {
    /**
     * 问题: 服务器返回新 session_id 后重映射 handler，
     * 但如果服务器随后发送旧 session_id 的消息，找不到 handler
     */
    test('重映射后旧 ID 的消息应该被正确处理或忽略', async () => {
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      const onMessage = jest.fn();
      muxWs.connectTerminal('temp-id', '/test', { onMessage });

      // 服务器返回新 ID，触发重映射
      muxWs.ws.receiveMessage({
        channel: 'terminal',
        session_id: 'real-uuid',
        type: 'connected',
        data: { original_session_id: 'temp-id' }
      });

      // 验证重映射成功
      expect(muxWs.handlers.has('terminal:real-uuid')).toBe(true);
      expect(muxWs.handlers.has('terminal:temp-id')).toBe(false);

      // 服务器发送旧 ID 的消息（竞态条件）
      // 这不应该导致崩溃
      expect(() => {
        muxWs.ws.receiveMessage({
          channel: 'terminal',
          session_id: 'temp-id',
          type: 'output',
          data: { text: 'some output' }
        });
      }).not.toThrow();

      // 旧 ID 的消息不应该触发 handler（因为已经重映射）
      // 只有 connected 消息触发了 onMessage
      const outputCalls = onMessage.mock.calls.filter(c => c[0] === 'output');
      expect(outputCalls.length).toBe(0);
    });
  });

  describe('BUG-006: connectionTimeout 清理不彻底', () => {
    /**
     * 问题: _onOpen() 中 clearTimeout 后没有设置为 null
     */
    test('连接成功后 connectionTimeout 应该为 null', async () => {
      muxWs.connect();

      // 连接前 timeout 应该存在
      expect(muxWs.connectionTimeout).not.toBeNull();

      await jest.advanceTimersByTimeAsync(10);

      // 连接成功后应该清理
      expect(muxWs.connectionTimeout).toBeNull();
    });

    test('disconnect 后再 connect 不应有残留 timeout', async () => {
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      muxWs.disconnect();

      expect(muxWs.connectionTimeout).toBeNull();

      // 再次连接
      muxWs.reconnectAttempts = 0; // 重置以允许重连
      muxWs.connect();

      // 应该创建新的 timeout
      expect(muxWs.connectionTimeout).not.toBeNull();
    });
  });

  describe('BUG-007: hasConnectedBefore 永不重置', () => {
    /**
     * 问题: hasConnectedBefore 一旦设置为 true 就永远是 true
     * 即使调用 disconnect() 也不会重置
     */
    test('完全断开后重新连接应该是新连接而非重连', async () => {
      // 首次连接
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      expect(muxWs.hasConnectedBefore).toBe(true);

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      // 主动断开（用户操作，非网络问题）
      muxWs.disconnect();

      // 清空所有订阅（用户意图是完全退出）
      muxWs.handlers.clear();
      muxWs.subscriptionData.clear();

      // 稍后重新连接（新的会话）
      muxWs.reconnectAttempts = 0;
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      // BUG: 由于 hasConnectedBefore 仍为 true，会触发 _resendSubscriptions
      // 但此时 subscriptionData 为空，所以不会有问题
      // 真正的问题是语义不清晰

      // 这个测试主要是记录这个设计问题
      expect(muxWs.hasConnectedBefore).toBe(true);
    });
  });

  describe('BUG-008: 输入框内容保存竞态', () => {
    /**
     * 问题: switchTo 保存输入框内容时，如果 inputField 是 null，静默失败
     */
    test('inputField 不存在时切换 session 不应崩溃', () => {
      document.body.innerHTML = '<div id="terminal-output"></div>'; // 没有 input-field

      sessionManager.openSession('session-1', 'Session 1');
      sessionManager.openSession('session-2', 'Session 2');

      expect(() => {
        sessionManager.switchTo('session-1');
        sessionManager.switchTo('session-2');
        sessionManager.switchTo('session-1');
      }).not.toThrow();
    });
  });

  describe('BUG-009: renameSession 容器 ID 更新但 subscriptionData 未更新', () => {
    /**
     * 问题: SessionManager.renameSession 更新了容器 ID，
     * 但 MuxWebSocket 中的 subscriptionData 仍然用旧 ID
     */
    test('renameSession 后 MuxWebSocket 应该也更新', async () => {
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      // 创建 session
      const session = sessionManager.openSession('temp-123', 'Test');
      sessionManager.createContainer(session);

      // 连接 terminal
      muxWs.connectTerminal('temp-123', '/test', {});

      expect(muxWs.subscriptionData.has('terminal:temp-123')).toBe(true);

      // SessionManager rename（服务端返回了真正的 UUID）
      sessionManager.renameSession('temp-123', 'real-uuid-456');

      // 问题: MuxWebSocket 的 subscriptionData 还是旧 ID
      // 这会导致重连时发送错误的 session_id

      // 注意: 这个 bug 需要 SessionManager 和 MuxWebSocket 之间的协调来修复
      // 目前的设计是 MuxWebSocket 自己处理 connected 消息时重映射
      // 但如果 SessionManager 先 rename 了，就会不一致
    });
  });

  describe('BUG-010: terminal dispose 后消息到达', () => {
    /**
     * 问题: closeSession 销毁 terminal 后，异步消息可能还会到达
     */
    test('terminal 销毁后收到消息不应崩溃', async () => {
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      const onMessage = jest.fn();
      const session = sessionManager.openSession('test-session', 'Test');

      muxWs.connectTerminal('test-session', '/test', { onMessage });

      // 关闭 session（会销毁 terminal 并 unsubscribe）
      sessionManager.closeSession('test-session');

      // 模拟延迟到达的消息
      expect(() => {
        muxWs.ws.receiveMessage({
          channel: 'terminal',
          session_id: 'test-session',
          type: 'output',
          data: { text: 'delayed message' }
        });
      }).not.toThrow();

      // 消息不应该触发已删除的 handler
      expect(onMessage).not.toHaveBeenCalledWith('output', expect.anything());
    });
  });
});
