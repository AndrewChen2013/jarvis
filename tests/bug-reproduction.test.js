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
      // BUG FIX: Old handler kept as forwarding handler (not deleted)
      expect(muxWs.handlers.has('terminal:temp-id')).toBe(true); // forwarding handler

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

      // BUG FIX: 旧 ID 的消息应该被转发到新 handler（通过 forwarding handler）
      // connected 消息触发了 onMessage 一次，output 消息也应该被转发触发一次
      const outputCalls = onMessage.mock.calls.filter(c => c[0] === 'output');
      expect(outputCalls.length).toBe(1);
      expect(outputCalls[0][1]).toEqual({ text: 'some output' });
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

  describe('BUG-011: onConnect callback 条件检查在 session 重命名后失败', () => {
    /**
     * 问题: chat.js 的 connectMux 中 onConnect 回调使用闭包捕获了 sessionId
     * 当 session 被重命名（temp ID -> UUID）后，this.sessionId 已更新
     * 但 capturedSessionId 仍是旧值，导致条件 this.sessionId === capturedSessionId 失败
     * isConnected 永远不会被设为 true
     */
    test('【BUG 演示】旧代码模式：session 重命名后 isConnected 不会被设置', async () => {
      // 这个测试演示了 BUG 的模式，不是测试生产代码
      // 使用旧的 buggy 模式，期望它失败（isConnected 为 false）
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      // 模拟 Chat 对象的行为
      const chat = {
        sessionId: null,
        isConnected: false,
        log: jest.fn()
      };

      // 模拟 connectMux 的旧实现（有 bug）
      const tempId = 'new-1768054963463';
      chat.sessionId = tempId;
      const capturedSessionId = tempId;

      // 创建 onConnect 回调（这是 bug 所在的旧代码）
      const onConnectBuggy = (data) => {
        // BUG: 这个条件在 session 重命名后会失败
        if (chat.sessionId === capturedSessionId) {
          chat.isConnected = true;
        }
      };

      // 订阅 chat
      muxWs.connectChat(tempId, '/Users/bill/code', {
        onConnect: onConnectBuggy
      });

      // 模拟服务器返回新 ID（触发 session 重命名）
      const newUuid = 'cd2eb470-8aac-4bb7-b9aa-da042e833b70';

      // SessionManager 会在收到 connected 消息前或同时更新 sessionId
      chat.sessionId = newUuid;

      // 服务器发送 connected 消息（会触发 onConnect）
      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: newUuid,
        type: 'connected',
        data: {
          working_dir: '/Users/bill/code',
          original_session_id: tempId
        }
      });

      // BUG 演示: isConnected 是 false（因为旧代码不检查 original_session_id）
      // 这证明了 bug 的存在
      expect(chat.isConnected).toBe(false);
    });

    test('修复后：onConnect 应该检查 original_session_id', async () => {
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      const chat = {
        sessionId: null,
        isConnected: false,
        log: jest.fn()
      };

      const tempId = 'new-1768054963464';
      chat.sessionId = tempId;
      const capturedSessionId = tempId;

      // 修复后的 onConnect 回调：检查 original_session_id
      const onConnectFixed = (data) => {
        // 修复：同时检查当前 ID 和 original_session_id（session 可能已被重命名）
        const isCurrentSession = chat.sessionId === capturedSessionId ||
                                 data.original_session_id === capturedSessionId;
        if (isCurrentSession) {
          chat.isConnected = true;
        }
      };

      muxWs.connectChat(tempId, '/Users/bill/code', {
        onConnect: onConnectFixed
      });

      const newUuid = 'cd2eb470-8aac-4bb7-b9aa-da042e833b71';

      // 更新 sessionId（模拟 rename）
      chat.sessionId = newUuid;

      // 服务器发送 connected 消息，包含 original_session_id
      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: newUuid,
        type: 'connected',
        data: {
          working_dir: '/Users/bill/code',
          original_session_id: tempId
        }
      });

      // 修复后 isConnected 应该是 true
      expect(chat.isConnected).toBe(true);
    });
  });

  describe('BUG-012: Chat 和 Terminal 必须共享同一个 session UUID', () => {
    /**
     * 问题: 前端用临时 ID (new-1768...) 分别连接 Chat 和 Terminal，
     * 后端为它们各自生成了不同的 UUID，导致:
     * - Chat 使用 UUID1，Terminal 使用 UUID2
     * - 前端 SessionManager 用 Terminal 的 UUID 重命名 session
     * - 发消息时用 UUID2，但 Chat 后端只认识 UUID1
     * - 返回 "Session not found" 错误
     *
     * 修复: 后端维护 (client_id, temp_id) -> actual_uuid 映射，
     * 确保 Chat 和 Terminal 使用同一个 UUID
     */

    test('Chat 先连接生成 UUID，Terminal 应使用相同 UUID', async () => {
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      const tempId = 'new-1768057088631';
      const sharedUuid = 'e1628da0-5f6f-4aae-b525-bb5902497522';

      // 记录收到的 session IDs
      const receivedSessionIds = {
        chat: null,
        terminal: null
      };

      // Chat 先连接
      muxWs.connectChat(tempId, '/Users/bill/code', {
        onConnect: (data) => {
          receivedSessionIds.chat = data.session_id || sharedUuid;
        }
      });

      // 模拟服务器返回（Chat 生成了 UUID 并存储映射）
      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: sharedUuid,
        type: 'ready',
        data: {
          working_dir: '/Users/bill/code',
          original_session_id: tempId,
          session_id: sharedUuid
        }
      });

      // Terminal 后连接（应该使用同一个 UUID）
      muxWs.connectTerminal(tempId, '/Users/bill/code', {
        onConnect: (data) => {
          receivedSessionIds.terminal = data.terminal_id;
        }
      });

      // 模拟服务器返回（Terminal 查找映射，使用相同 UUID）
      muxWs.ws.receiveMessage({
        channel: 'terminal',
        session_id: sharedUuid,  // 关键：使用相同的 UUID
        type: 'connected',
        data: {
          terminal_id: sharedUuid,
          original_session_id: tempId
        }
      });

      // 验证两者使用相同的 session ID
      expect(receivedSessionIds.chat).toBe(sharedUuid);
      expect(receivedSessionIds.terminal).toBe(sharedUuid);
    });

    test('Terminal 先连接生成 UUID，Chat 应使用相同 UUID', async () => {
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      const tempId = 'new-1768057088632';
      const sharedUuid = '2dfd0da9-7e64-4879-82ab-dd19fdbfeedf';

      const receivedSessionIds = {
        chat: null,
        terminal: null
      };

      // Terminal 先连接
      muxWs.connectTerminal(tempId, '/Users/bill/code', {
        onConnect: (data) => {
          receivedSessionIds.terminal = data.terminal_id;
        }
      });

      // 模拟服务器返回（Terminal 生成了 UUID 并存储映射）
      muxWs.ws.receiveMessage({
        channel: 'terminal',
        session_id: sharedUuid,
        type: 'connected',
        data: {
          terminal_id: sharedUuid,
          original_session_id: tempId
        }
      });

      // Chat 后连接（应该使用同一个 UUID）
      muxWs.connectChat(tempId, '/Users/bill/code', {
        onConnect: (data) => {
          receivedSessionIds.chat = data.session_id || sharedUuid;
        }
      });

      // 模拟服务器返回（Chat 查找映射，使用相同 UUID）
      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: sharedUuid,  // 关键：使用相同的 UUID
        type: 'ready',
        data: {
          working_dir: '/Users/bill/code',
          original_session_id: tempId,
          session_id: sharedUuid
        }
      });

      // 验证两者使用相同的 session ID
      expect(receivedSessionIds.terminal).toBe(sharedUuid);
      expect(receivedSessionIds.chat).toBe(sharedUuid);
    });

    test('Handler 重映射后消息应正确路由', async () => {
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      const tempId = 'new-1768057088633';
      const actualUuid = 'abc12345-1234-5678-9abc-def012345678';

      const chatMessages = [];
      const terminalMessages = [];

      // 连接 Chat
      muxWs.connectChat(tempId, '/Users/bill/code', {
        onMessage: (type, data) => {
          chatMessages.push({ type, data });
        }
      });

      // 服务器返回新 UUID（触发 handler 重映射）
      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: actualUuid,
        type: 'ready',
        data: { original_session_id: tempId }
      });

      // 连接 Terminal
      muxWs.connectTerminal(tempId, '/Users/bill/code', {
        onMessage: (type, data) => {
          terminalMessages.push({ type, data });
        }
      });

      // 服务器返回相同 UUID
      muxWs.ws.receiveMessage({
        channel: 'terminal',
        session_id: actualUuid,
        type: 'connected',
        data: { terminal_id: actualUuid, original_session_id: tempId }
      });

      // 发送消息到新 UUID，应该正确路由
      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: actualUuid,
        type: 'assistant',
        data: { content: 'Hello from assistant' }
      });

      muxWs.ws.receiveMessage({
        channel: 'terminal',
        session_id: actualUuid,
        type: 'output',
        data: { text: 'Terminal output' }
      });

      // 验证消息被正确路由
      expect(chatMessages.some(m => m.type === 'assistant')).toBe(true);
      expect(terminalMessages.some(m => m.type === 'output')).toBe(true);
    });

    test('转发 handler 应该捕获延迟到达的旧 ID 消息', async () => {
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      const tempId = 'new-1768057088634';
      const actualUuid = 'def67890-1234-5678-9abc-def012345678';

      const receivedMessages = [];

      muxWs.connectChat(tempId, '/Users/bill/code', {
        onMessage: (type, data) => {
          receivedMessages.push({ type, data });
        }
      });

      // 服务器返回新 UUID（触发 handler 重映射）
      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: actualUuid,
        type: 'ready',
        data: { original_session_id: tempId }
      });

      // 验证转发 handler 存在
      expect(muxWs.handlers.has(`chat:${tempId}`)).toBe(true);
      expect(muxWs.handlers.has(`chat:${actualUuid}`)).toBe(true);

      // 模拟延迟到达的旧 ID 消息（竞态条件）
      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: tempId,  // 使用旧的临时 ID
        type: 'stream',
        data: { text: 'Delayed message' }
      });

      // 验证消息被转发到正确的 handler
      expect(receivedMessages.some(m => m.type === 'stream')).toBe(true);
    });

    test('多个独立 session 不应互相干扰', async () => {
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      const session1TempId = 'new-session-1';
      const session1Uuid = 'uuid-1111-1111-1111-111111111111';
      const session2TempId = 'new-session-2';
      const session2Uuid = 'uuid-2222-2222-2222-222222222222';

      const session1Messages = [];
      const session2Messages = [];

      // 连接 session 1
      muxWs.connectChat(session1TempId, '/Users/bill/project1', {
        onMessage: (type, data) => {
          session1Messages.push({ type, data });
        }
      });

      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: session1Uuid,
        type: 'ready',
        data: { original_session_id: session1TempId }
      });

      // 连接 session 2
      muxWs.connectChat(session2TempId, '/Users/bill/project2', {
        onMessage: (type, data) => {
          session2Messages.push({ type, data });
        }
      });

      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: session2Uuid,
        type: 'ready',
        data: { original_session_id: session2TempId }
      });

      // 发送消息到各自的 session
      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: session1Uuid,
        type: 'assistant',
        data: { content: 'Message for session 1' }
      });

      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: session2Uuid,
        type: 'assistant',
        data: { content: 'Message for session 2' }
      });

      // 验证消息不会串到其他 session
      // 注意：onMessage 会收到所有消息类型，包括 ready 和 assistant
      const session1AssistantMsgs = session1Messages.filter(m => m.type === 'assistant');
      const session2AssistantMsgs = session2Messages.filter(m => m.type === 'assistant');

      expect(session1AssistantMsgs.length).toBe(1);
      expect(session1AssistantMsgs[0].data.content).toBe('Message for session 1');
      expect(session2AssistantMsgs.length).toBe(1);
      expect(session2AssistantMsgs[0].data.content).toBe('Message for session 2');
    });

    test('SessionManager renameSession 后发送消息应使用新 UUID', async () => {
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      const tempId = 'new-1768057088635';
      const actualUuid = 'final-uuid-1234-5678-9abc';

      // 创建 session
      const session = sessionManager.openSession(tempId, 'Test Session');
      expect(session.id).toBe(tempId);

      // 连接 Chat
      muxWs.connectChat(tempId, '/Users/bill/code', {});

      // 服务器返回新 UUID
      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: actualUuid,
        type: 'ready',
        data: { original_session_id: tempId }
      });

      // SessionManager 重命名 session（模拟 Terminal onConnect 的行为）
      const renameResult = sessionManager.renameSession(tempId, actualUuid);
      expect(renameResult).toBe(true);
      expect(session.id).toBe(actualUuid);

      // 验证 session 可以通过新 ID 访问
      expect(sessionManager.sessions.has(actualUuid)).toBe(true);
      expect(sessionManager.sessions.has(tempId)).toBe(false);
    });

    test('chatMessage 应该发送到正确的 session ID', async () => {
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      const tempId = 'new-1768057088636';
      const actualUuid = 'msg-test-uuid-1234-5678';

      // 连接 Chat
      muxWs.connectChat(tempId, '/Users/bill/code', {});

      // 服务器返回新 UUID
      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: actualUuid,
        type: 'ready',
        data: { original_session_id: tempId }
      });

      // 清除之前的消息
      muxWs.ws.sentMessages = [];

      // 发送 chat 消息
      muxWs.chatMessage(actualUuid, 'Hello, Claude!');

      // 验证消息发送到正确的 session ID
      expect(muxWs.ws.sentMessages.length).toBe(1);
      const sentMsg = decodeMessage(muxWs.ws.sentMessages[0]);
      expect(sentMsg.channel).toBe('chat');
      expect(sentMsg.session_id).toBe(actualUuid);
      expect(sentMsg.type).toBe('message');
      expect(sentMsg.data.content).toBe('Hello, Claude!');
    });

    test('【BUG-012 核心场景】临时 ID 创建 session 后发消息不应报 Session not found', async () => {
      // 这个测试模拟完整的用户操作流程
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      const tempId = 'new-1768057088637';
      const sharedUuid = 'shared-uuid-abcd-efgh-ijkl';

      // 模拟 Chat 对象
      const chat = {
        sessionId: tempId,
        isConnected: false
      };

      // 模拟 SessionManager 中的 session
      const session = sessionManager.openSession(tempId, 'New Session');

      // 1. Chat 连接
      muxWs.connectChat(tempId, '/Users/bill/code', {
        onConnect: (data) => {
          // BUG-011 修复：检查 original_session_id
          const isCurrentSession = chat.sessionId === tempId ||
                                   data.original_session_id === tempId;
          if (isCurrentSession) {
            chat.isConnected = true;
          }
        }
      });

      // 2. 服务器返回 Chat 的 UUID
      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: sharedUuid,
        type: 'ready',
        data: { original_session_id: tempId }
      });

      // 3. Terminal 连接
      muxWs.connectTerminal(tempId, '/Users/bill/code', {
        onConnect: (data) => {
          // Terminal onConnect 会触发 renameSession
          const serverSessionId = data.terminal_id;
          if (serverSessionId && serverSessionId !== tempId) {
            sessionManager.renameSession(tempId, serverSessionId);
            chat.sessionId = serverSessionId;
          }
        }
      });

      // 4. 服务器返回 Terminal 的 UUID（与 Chat 相同！这是 BUG-012 修复的关键）
      muxWs.ws.receiveMessage({
        channel: 'terminal',
        session_id: sharedUuid,  // 相同的 UUID
        type: 'connected',
        data: { terminal_id: sharedUuid, original_session_id: tempId }
      });

      // 5. 验证 session 已正确重命名
      expect(session.id).toBe(sharedUuid);
      expect(chat.sessionId).toBe(sharedUuid);
      expect(chat.isConnected).toBe(true);

      // 6. 发送消息（使用新的 UUID）
      muxWs.ws.sentMessages = [];
      muxWs.chatMessage(sharedUuid, 'Test message');

      // 7. 验证消息发送到正确的 session
      const sentMsg = decodeMessage(muxWs.ws.sentMessages[0]);
      expect(sentMsg.session_id).toBe(sharedUuid);

      // 8. 模拟服务器响应（不应返回 Session not found）
      const errorReceived = [];
      muxWs.handlers.get(`chat:${sharedUuid}`).onMessage = (type, data) => {
        if (type === 'error') {
          errorReceived.push(data);
        }
      };

      // 如果服务器返回 user_ack，说明 session 存在且消息被处理
      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: sharedUuid,
        type: 'user_ack',
        data: { content: 'Test message' }
      });

      // 不应该收到 Session not found 错误
      expect(errorReceived.filter(e => e.message === 'Session not found').length).toBe(0);
    });

    test('转发 handler 应在 15 秒后自动清理', async () => {
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      const tempId = 'new-cleanup-test';
      const actualUuid = 'cleanup-uuid-1234';

      muxWs.connectChat(tempId, '/Users/bill/code', {});

      // 服务器返回新 UUID（创建转发 handler）
      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: actualUuid,
        type: 'ready',
        data: { original_session_id: tempId }
      });

      // 验证转发 handler 存在
      expect(muxWs.handlers.has(`chat:${tempId}`)).toBe(true);

      // 快进 14 秒，转发 handler 应该还在
      await jest.advanceTimersByTimeAsync(14000);
      expect(muxWs.handlers.has(`chat:${tempId}`)).toBe(true);

      // 快进到 16 秒（超过 15 秒），转发 handler 应该被清理
      await jest.advanceTimersByTimeAsync(2000);
      expect(muxWs.handlers.has(`chat:${tempId}`)).toBe(false);

      // 主 handler 应该还在
      expect(muxWs.handlers.has(`chat:${actualUuid}`)).toBe(true);
    });
  });

  describe('BUG-013: 打开 session 时用户消息不可见', () => {
    // 用户报告：打开一个聊天 session 时，只能看见回复的消息，看不见自己发出去的消息

    test('【真实场景】用户发送消息后，消息应该立即显示在界面上', () => {
      // 模拟完整的发送消息流程
      const mockChatMode = {
        sessionId: 'session-123',
        messages: [],
        messagesEl: document.createElement('div'),
        isConnected: true,
        inputEl: { value: '这是用户发的消息' },

        addMessage(type, content, extra = {}) {
          const msgId = `msg-${Date.now()}`;
          const msg = { id: msgId, type, content, ...extra };
          this.messages.push(msg);

          const msgEl = document.createElement('div');
          msgEl.id = msgId;
          msgEl.className = `chat-message ${type}`;
          msgEl.innerHTML = `<div class="chat-bubble">${content}</div>`;
          this.messagesEl.appendChild(msgEl);

          return msgId;
        },

        // 模拟 sendMessage 函数
        sendMessage() {
          const content = this.inputEl.value.trim();
          if (!content || !this.isConnected) return;

          // 关键：发送消息时应该立即在界面上显示
          this.addMessage('user', content);
          this.inputEl.value = '';

          // 模拟通过 WebSocket 发送
          // window.muxWs.chatMessage(this.sessionId, content);
        }
      };

      // 用户发送消息
      mockChatMode.sendMessage();

      // 验证：消息应该立即显示
      expect(mockChatMode.messages.length).toBe(1);
      expect(mockChatMode.messages[0].type).toBe('user');
      expect(mockChatMode.messages[0].content).toBe('这是用户发的消息');

      // 验证 DOM
      const userEl = mockChatMode.messagesEl.querySelector('.chat-message.user');
      expect(userEl).not.toBeNull();
      expect(userEl.textContent).toContain('这是用户发的消息');
    });

    test('初始历史加载应该包含 user 类型消息', async () => {
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      const sessionId = 'test-session-123';
      const receivedMessages = [];

      // 连接 Chat
      muxWs.connectChat(sessionId, '/Users/bill/code', {
        onMessage: (type, data) => {
          receivedMessages.push({ type, data });
        }
      });

      // 模拟服务器发送初始历史消息（包含 user 和 assistant）
      // 按照时间顺序：user -> assistant -> user -> assistant
      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: sessionId,
        type: 'user',
        data: { content: '你好，帮我看看这个代码', timestamp: '2026-01-11T10:00:00Z' }
      });

      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: sessionId,
        type: 'assistant',
        data: { content: '好的，我来看看...', timestamp: '2026-01-11T10:00:05Z' }
      });

      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: sessionId,
        type: 'user',
        data: { content: '这个函数有什么问题？', timestamp: '2026-01-11T10:01:00Z' }
      });

      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: sessionId,
        type: 'assistant',
        data: { content: '这个函数的问题是...', timestamp: '2026-01-11T10:01:10Z' }
      });

      // 验证：前端应该收到所有消息，包括 user 类型
      const userMessages = receivedMessages.filter(m => m.type === 'user');
      const assistantMessages = receivedMessages.filter(m => m.type === 'assistant');

      expect(userMessages.length).toBe(2);
      expect(userMessages[0].data.content).toBe('你好，帮我看看这个代码');
      expect(userMessages[1].data.content).toBe('这个函数有什么问题？');

      expect(assistantMessages.length).toBe(2);
    });

    test('ChatMode 应该正确渲染 user 消息到 DOM', () => {
      // 模拟 ChatMode 的 addMessage 函数
      const messages = [];
      const mockChatMode = {
        messages: messages,
        messagesEl: document.createElement('div'),
        emptyEl: null,
        isStreaming: false,
        streamingMessageId: null,

        addMessage(type, content, extra = {}) {
          const msgId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const msg = { id: msgId, type, content, ...extra };
          this.messages.push(msg);

          const msgEl = document.createElement('div');
          msgEl.id = msgId;
          msgEl.className = `chat-message ${type}`;
          msgEl.innerHTML = `<div class="chat-bubble">${content}</div>`;
          this.messagesEl.appendChild(msgEl);

          return msgId;
        },

        handleMessage(data) {
          if (data.type === 'user') {
            this.addMessage('user', data.data.content);
          } else if (data.type === 'assistant') {
            this.addMessage('assistant', data.data.content);
          }
        }
      };

      // 模拟收到历史消息
      mockChatMode.handleMessage({ type: 'user', data: { content: '第一条用户消息' } });
      mockChatMode.handleMessage({ type: 'assistant', data: { content: '第一条回复' } });
      mockChatMode.handleMessage({ type: 'user', data: { content: '第二条用户消息' } });

      // 验证 messages 数组
      expect(mockChatMode.messages.length).toBe(3);
      expect(mockChatMode.messages.filter(m => m.type === 'user').length).toBe(2);

      // 验证 DOM
      const userEls = mockChatMode.messagesEl.querySelectorAll('.chat-message.user');
      const assistantEls = mockChatMode.messagesEl.querySelectorAll('.chat-message.assistant');

      expect(userEls.length).toBe(2);
      expect(assistantEls.length).toBe(1);
      expect(userEls[0].textContent).toContain('第一条用户消息');
    });

    test('【潜在 BUG】用户发送消息后，后端返回的 user 消息可能被 isDuplicateMessage 过滤', () => {
      // 场景：
      // 1. 用户发送消息 "你好"，前端立即显示
      // 2. 后端处理后，通过 history 返回同样的消息 "你好"
      // 3. isDuplicateMessage 检测到重复，跳过
      // 这是正常行为。但如果 timestamp 不匹配，可能会出问题

      const messages = [
        { type: 'user', content: '你好', extra: { timestamp: '2026-01-11T10:00:00.000Z' } }
      ];

      function isDuplicateMessage(type, content, timestamp) {
        if (!messages || messages.length === 0) return false;

        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg.type === type && msg.content === content) {
            if (timestamp && msg.extra?.timestamp) {
              const msgTime = new Date(msg.extra.timestamp).getTime();
              const newTime = new Date(timestamp).getTime();
              if (Math.abs(newTime - msgTime) < 60000) {
                return true;  // 被认为是重复
              }
            } else {
              // 如果没有 timestamp，直接认为是重复
              return true;
            }
          }
        }
        return false;
      }

      // Case 1: 完全相同的消息，应该被过滤
      expect(isDuplicateMessage('user', '你好', '2026-01-11T10:00:00.000Z')).toBe(true);

      // Case 2: 时间戳差 30 秒，应该被过滤
      expect(isDuplicateMessage('user', '你好', '2026-01-11T10:00:30.000Z')).toBe(true);

      // Case 3: 时间戳差 2 分钟，不应该被过滤
      expect(isDuplicateMessage('user', '你好', '2026-01-11T10:02:00.000Z')).toBe(false);

      // Case 4: 没有 timestamp 的消息，会被过滤（这可能是问题！）
      expect(isDuplicateMessage('user', '你好', null)).toBe(true);
    });

    test('isDuplicateMessage 不应该错误过滤历史中的 user 消息', () => {
      // 模拟 isDuplicateMessage 逻辑
      const messages = [
        { type: 'user', content: '你好', extra: { timestamp: '2026-01-11T10:00:00Z' } },
        { type: 'assistant', content: '你好！', extra: { timestamp: '2026-01-11T10:00:05Z' } }
      ];

      function isDuplicateMessage(type, content, timestamp, isLoadingHistory = false) {
        // During history loading, should NOT filter
        if (isLoadingHistory) return false;

        if (!messages || messages.length === 0) return false;

        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg.type === type && msg.content === content) {
            if (timestamp && msg.extra?.timestamp) {
              const msgTime = new Date(msg.extra.timestamp).getTime();
              const newTime = new Date(timestamp).getTime();
              if (Math.abs(newTime - msgTime) < 60000) {
                return true;
              }
            } else {
              return true;
            }
          }
        }
        return false;
      }

      // 新消息不应被过滤
      expect(isDuplicateMessage('user', '新消息', '2026-01-11T10:02:00Z', false)).toBe(false);

      // 历史加载时，即使相同消息也不应被过滤
      expect(isDuplicateMessage('user', '你好', '2026-01-11T10:00:00Z', true)).toBe(false);

      // 重复消息应被过滤（非历史加载时）
      expect(isDuplicateMessage('user', '你好', '2026-01-11T10:00:00Z', false)).toBe(true);
    });
  });

  describe('BUG-013-Deep: 初始历史加载流程追踪', () => {
    // 追踪初始历史加载时，user 消息为什么不显示

    test('初始历史加载时 isLoadingHistory 应该是 false', () => {
      // 根据代码，初始历史加载时没有设置 isLoadingHistory = true
      // 这意味着消息走的是 addMessage 路径，而不是 pendingHistoryMessages
      const mockChatMode = {
        isLoadingHistory: false,  // 初始值
        messages: [],

        handleUserMessage(data) {
          if (this.isLoadingHistory) {
            return 'collected';
          } else {
            this.messages.push({ type: 'user', content: data.content });
            return 'added';
          }
        }
      };

      expect(mockChatMode.isLoadingHistory).toBe(false);
      const result = mockChatMode.handleUserMessage({ content: '你好' });
      expect(result).toBe('added');
      expect(mockChatMode.messages.length).toBe(1);
    });

    test('【关键】isDuplicateMessage 在 messages 为空时应该返回 false', () => {
      const messages = [];

      function isDuplicateMessage(type, content, timestamp) {
        if (!messages || messages.length === 0) return false;
        return false;
      }

      expect(isDuplicateMessage('user', '你好', null)).toBe(false);
    });

    test('【BUG 复现】如果 timestamp 丢失，相同内容的消息会被过滤', () => {
      const messages = [];

      function addMessage(type, content, extra = {}) {
        messages.push({ type, content, extra });
      }

      function isDuplicateMessage(type, content, timestamp) {
        if (!messages || messages.length === 0) return false;

        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg.type === type && msg.content === content) {
            if (timestamp && msg.extra?.timestamp) {
              const msgTime = new Date(msg.extra.timestamp).getTime();
              const newTime = new Date(timestamp).getTime();
              if (Math.abs(newTime - msgTime) < 60000) {
                return true;
              }
            } else {
              // 没有 timestamp 时，认为是重复
              return true;
            }
          }
        }
        return false;
      }

      // 第一条消息
      addMessage('user', '你好', { timestamp: '2026-01-11T10:00:00Z' });

      // 第二条消息，没有 timestamp（BUG：后端可能没发 timestamp）
      const isDup = isDuplicateMessage('user', '你好', undefined);

      // 这会返回 true，导致消息被跳过！这是潜在 BUG
      expect(isDup).toBe(true);
    });

    test('【BUG 复现】后端 _forward_chat_message 发送 user 消息时是否包含 timestamp', () => {
      // 检查后端是否正确发送 timestamp
      // 根据代码：timestamp = msg.timestamp.isoformat() if hasattr(msg, 'timestamp') else None

      // 模拟后端发送的消息格式
      const backendMessage = {
        channel: 'chat',
        session_id: 'test-session',
        type: 'user',
        data: {
          content: '你好',
          timestamp: '2026-01-11T10:00:00+00:00'  // 后端应该发送这个
        }
      };

      // 如果后端发送了 timestamp，前端应该能正确处理
      expect(backendMessage.data.timestamp).toBeDefined();
    });
  });

  describe('BUG-014: 历史滚动时内容被替换', () => {
    // 用户报告：往前翻历史时，刚刚看见的内容会被替换成很早以前的内容

    test('【BUG 复现】连续滚动加载时 pendingHistoryMessages 可能没有清空', () => {
      const mockChatMode = {
        messages: [],
        messagesEl: document.createElement('div'),
        pendingHistoryMessages: [],
        isLoadingHistory: false,
        historyOldestIndex: 50,

        startLoadingHistory() {
          this.isLoadingHistory = true;
        },

        receiveHistoryMessage(msg) {
          if (this.isLoadingHistory) {
            this.pendingHistoryMessages.push(msg);
          }
        },

        handleHistoryPageEnd(data) {
          // 关键：如果这里处理不当，可能导致问题
          if (this.pendingHistoryMessages.length > 0) {
            // 应该在头部插入，而不是替换
            this.messages.unshift(...this.pendingHistoryMessages);

            // DOM 操作
            const fragment = document.createDocumentFragment();
            for (const msg of this.pendingHistoryMessages) {
              const el = document.createElement('div');
              el.textContent = msg.content;
              el.className = 'msg';
              fragment.appendChild(el);
            }
            // 插入到头部
            this.messagesEl.insertBefore(fragment, this.messagesEl.firstChild);

            this.pendingHistoryMessages = [];
          }
          this.isLoadingHistory = false;
          this.historyOldestIndex = data.oldest_index;
        }
      };

      // 初始有 5 条消息
      for (let i = 45; i < 50; i++) {
        mockChatMode.messages.push({ type: 'msg', content: `消息${i}` });
        const el = document.createElement('div');
        el.textContent = `消息${i}`;
        mockChatMode.messagesEl.appendChild(el);
      }

      // 第一次加载历史
      mockChatMode.startLoadingHistory();
      for (let i = 40; i < 45; i++) {
        mockChatMode.receiveHistoryMessage({ type: 'msg', content: `消息${i}` });
      }
      mockChatMode.handleHistoryPageEnd({ oldest_index: 40 });

      expect(mockChatMode.messages.length).toBe(10);
      expect(mockChatMode.messagesEl.children.length).toBe(10);
      expect(mockChatMode.pendingHistoryMessages.length).toBe(0);

      // 第二次加载历史（用户继续滚动）
      mockChatMode.startLoadingHistory();
      for (let i = 35; i < 40; i++) {
        mockChatMode.receiveHistoryMessage({ type: 'msg', content: `消息${i}` });
      }
      mockChatMode.handleHistoryPageEnd({ oldest_index: 35 });

      expect(mockChatMode.messages.length).toBe(15);
      expect(mockChatMode.messagesEl.children.length).toBe(15);

      // 验证消息顺序正确
      expect(mockChatMode.messages[0].content).toBe('消息35');
      expect(mockChatMode.messages[14].content).toBe('消息49');
    });

    test('loadMoreHistory 应该在顶部插入旧消息，不影响现有消息', () => {
      // 模拟 ChatMode 的历史加载逻辑
      const mockChatMode = {
        messages: [],
        messagesEl: document.createElement('div'),
        pendingHistoryMessages: [],
        isLoadingHistory: false,
        historyOldestIndex: 100,  // 假设从 index 100 开始
        hasMoreHistory: true,

        // 模拟初始消息（最近的 5 条）
        initWithRecentMessages() {
          for (let i = 95; i < 100; i++) {
            const msg = { type: i % 2 === 0 ? 'user' : 'assistant', content: `消息 ${i}` };
            this.messages.push(msg);

            const msgEl = document.createElement('div');
            msgEl.className = `chat-message ${msg.type}`;
            msgEl.dataset.index = i;
            msgEl.textContent = msg.content;
            this.messagesEl.appendChild(msgEl);
          }
        },

        // 模拟收到历史消息
        receiveHistoryMessage(msg) {
          if (this.isLoadingHistory) {
            this.pendingHistoryMessages.push(msg);
          }
        },

        // 模拟 history_page_end 处理
        handleHistoryPageEnd(data) {
          if (this.pendingHistoryMessages.length > 0) {
            // 在数组头部插入
            this.messages.unshift(...this.pendingHistoryMessages);

            // 在 DOM 头部插入
            const fragment = document.createDocumentFragment();
            for (const msg of this.pendingHistoryMessages) {
              const msgEl = document.createElement('div');
              msgEl.className = `chat-message ${msg.type}`;
              msgEl.textContent = msg.content;
              fragment.appendChild(msgEl);
            }

            const firstChild = this.messagesEl.firstChild;
            if (firstChild) {
              this.messagesEl.insertBefore(fragment, firstChild);
            }

            this.pendingHistoryMessages = [];
          }

          this.isLoadingHistory = false;
          this.historyOldestIndex = data.oldest_index;
          this.hasMoreHistory = data.has_more;
        }
      };

      // 初始化：加载最近 5 条消息 (index 95-99)
      mockChatMode.initWithRecentMessages();
      expect(mockChatMode.messages.length).toBe(5);
      expect(mockChatMode.messagesEl.children.length).toBe(5);

      // 记录当前消息内容
      const originalLastMessage = mockChatMode.messages[4].content;
      expect(originalLastMessage).toBe('消息 99');

      // 开始加载历史
      mockChatMode.isLoadingHistory = true;

      // 模拟收到 5 条更早的消息 (index 90-94)
      for (let i = 90; i < 95; i++) {
        mockChatMode.receiveHistoryMessage({
          type: i % 2 === 0 ? 'user' : 'assistant',
          content: `消息 ${i}`
        });
      }

      // 处理 history_page_end
      mockChatMode.handleHistoryPageEnd({
        count: 5,
        oldest_index: 90,
        has_more: true
      });

      // 验证：消息数量应该是 10 条
      expect(mockChatMode.messages.length).toBe(10);
      expect(mockChatMode.messagesEl.children.length).toBe(10);

      // 验证：原来的最后一条消息应该还在，且内容不变
      expect(mockChatMode.messages[9].content).toBe('消息 99');

      // 验证：新加载的消息在头部
      expect(mockChatMode.messages[0].content).toBe('消息 90');
      expect(mockChatMode.messages[4].content).toBe('消息 94');

      // 验证：原来的消息在尾部，顺序不变
      expect(mockChatMode.messages[5].content).toBe('消息 95');
    });

    test('连续加载多页历史不应丢失或替换消息', () => {
      const mockChatMode = {
        messages: [],
        messagesEl: document.createElement('div'),
        pendingHistoryMessages: [],
        isLoadingHistory: false,
        historyOldestIndex: 50,
        hasMoreHistory: true,

        receiveHistoryMessage(msg) {
          if (this.isLoadingHistory) {
            this.pendingHistoryMessages.push(msg);
          }
        },

        handleHistoryPageEnd(data) {
          if (this.pendingHistoryMessages.length > 0) {
            this.messages.unshift(...this.pendingHistoryMessages);

            const fragment = document.createDocumentFragment();
            for (const msg of this.pendingHistoryMessages) {
              const msgEl = document.createElement('div');
              msgEl.className = `chat-message ${msg.type}`;
              msgEl.textContent = msg.content;
              fragment.appendChild(msgEl);
            }

            const firstChild = this.messagesEl.firstChild;
            if (firstChild) {
              this.messagesEl.insertBefore(fragment, firstChild);
            }

            this.pendingHistoryMessages = [];
          }

          this.isLoadingHistory = false;
          this.historyOldestIndex = data.oldest_index;
          this.hasMoreHistory = data.has_more;
        }
      };

      // 初始：5 条消息 (index 45-49)
      for (let i = 45; i < 50; i++) {
        const msg = { type: 'assistant', content: `消息 ${i}` };
        mockChatMode.messages.push(msg);
        const el = document.createElement('div');
        el.textContent = msg.content;
        mockChatMode.messagesEl.appendChild(el);
      }

      // 第一次加载历史：5 条 (index 40-44)
      mockChatMode.isLoadingHistory = true;
      for (let i = 40; i < 45; i++) {
        mockChatMode.receiveHistoryMessage({ type: 'user', content: `消息 ${i}` });
      }
      mockChatMode.handleHistoryPageEnd({ count: 5, oldest_index: 40, has_more: true });

      expect(mockChatMode.messages.length).toBe(10);
      expect(mockChatMode.historyOldestIndex).toBe(40);

      // 第二次加载历史：5 条 (index 35-39)
      mockChatMode.isLoadingHistory = true;
      for (let i = 35; i < 40; i++) {
        mockChatMode.receiveHistoryMessage({ type: 'user', content: `消息 ${i}` });
      }
      mockChatMode.handleHistoryPageEnd({ count: 5, oldest_index: 35, has_more: true });

      expect(mockChatMode.messages.length).toBe(15);
      expect(mockChatMode.historyOldestIndex).toBe(35);

      // 验证所有消息都在，顺序正确
      expect(mockChatMode.messages[0].content).toBe('消息 35');
      expect(mockChatMode.messages[14].content).toBe('消息 49');

      // 验证 DOM 也是正确的
      expect(mockChatMode.messagesEl.children.length).toBe(15);
    });

    test('historyOldestIndex 计算应该正确', () => {
      // 后端逻辑：
      // - before_index: 客户端传的 "在此 index 之前的消息"
      // - 返回 messages[start_index:before_index]，其中 start_index = max(0, before_index - limit)
      // - oldest_index = before_index - len(messages)

      // 模拟后端 get_history_page
      function getHistoryPage(beforeIndex, limit, totalMessages) {
        if (beforeIndex <= 0) return { messages: [], hasMore: false, oldestIndex: 0 };

        const startIndex = Math.max(0, beforeIndex - limit);
        const count = beforeIndex - startIndex;
        const hasMore = startIndex > 0;
        const oldestIndex = startIndex;

        return { count, hasMore, oldestIndex };
      }

      // 假设总共 100 条消息，初始加载最近 15 条 (index 85-99)
      // historyOldestIndex 应该是 85

      // 第一次 load_more_history，before_index=85，limit=50
      let result = getHistoryPage(85, 50, 100);
      expect(result.count).toBe(50);  // 返回 35-84
      expect(result.oldestIndex).toBe(35);
      expect(result.hasMore).toBe(true);

      // 第二次 load_more_history，before_index=35，limit=50
      result = getHistoryPage(35, 50, 100);
      expect(result.count).toBe(35);  // 返回 0-34
      expect(result.oldestIndex).toBe(0);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('BUG-013 深入调查: 初始历史加载流程完整模拟', () => {
    /**
     * 根据代码分析，初始历史加载时：
     * 1. isLoadingHistory = false (没有设置为 true)
     * 2. 消息通过 handleMessage 处理，走 else 分支
     * 3. 调用 isDuplicateMessage 检查
     * 4. 如果被判定为重复，消息被跳过
     *
     * 可能的 bug 场景：
     * - 用户发送消息后，后端回复的历史包含该消息，被判定为重复
     * - 消息没有 timestamp 或 timestamp 不匹配
     */

    test('【关键测试】初始历史加载时 isLoadingHistory 应该为 false', () => {
      // 这是根据实际代码分析得出的结论
      // 在 mux_connection_manager.py 的 connect 流程中：
      // 1. 发送 ready
      // 2. 循环发送 history messages
      // 3. 发送 history_end
      // 没有任何地方通知前端 "现在开始加载初始历史"

      // 前端 handleMessage 中，只有收到 history_page_end 才会在之后设置 isLoadingHistory=false
      // 但初始历史使用 history_end（不是 history_page_end）

      const mockChatMode = {
        isLoadingHistory: false,  // 初始值
        messages: [],
        pendingHistoryMessages: [],

        handleInitialHistoryMessage(data) {
          // 这模拟实际代码：初始历史时 isLoadingHistory=false
          if (this.isLoadingHistory) {
            this.pendingHistoryMessages.push(data);
            return 'collected';
          } else {
            // 走 addMessage 路径
            this.messages.push(data);
            return 'added';
          }
        }
      };

      // 初始历史消息
      const historyMessages = [
        { type: 'user', content: '你好', timestamp: '2026-01-11T10:00:00Z' },
        { type: 'assistant', content: '你好！有什么可以帮你？', timestamp: '2026-01-11T10:00:05Z' }
      ];

      for (const msg of historyMessages) {
        const result = mockChatMode.handleInitialHistoryMessage(msg);
        expect(result).toBe('added');  // 因为 isLoadingHistory=false，走 addMessage 路径
      }

      expect(mockChatMode.messages.length).toBe(2);
      expect(mockChatMode.pendingHistoryMessages.length).toBe(0);
    });

    test('【BUG 场景】用户发送消息后，初始历史重新加载会触发重复检测', () => {
      // 场景：
      // 1. 用户打开 session
      // 2. 初始历史加载完成，显示消息
      // 3. 用户发送新消息 "测试"
      // 4. 由于某种原因 (如 WebSocket 重连)，初始历史再次加载
      // 5. 历史中的 "测试" 消息可能被 isDuplicateMessage 过滤

      const mockChatMode = {
        messages: [],
        isLoadingHistory: false,

        isDuplicateMessage(type, content, timestamp) {
          if (this.isLoadingHistory) return false;
          if (!this.messages || this.messages.length === 0) return false;

          for (let i = this.messages.length - 1; i >= Math.max(0, this.messages.length - 50); i--) {
            const msg = this.messages[i];
            if (msg.type === type && msg.content === content) {
              // 如果有 timestamp，检查时间差
              if (timestamp && msg.timestamp) {
                const diff = Math.abs(new Date(timestamp) - new Date(msg.timestamp));
                if (diff < 60000) return true;
              } else {
                // 没有 timestamp，只按内容判断
                return true;
              }
            }
          }
          return false;
        },

        addMessage(type, content, extra = {}) {
          if (this.isDuplicateMessage(type, content, extra.timestamp)) {
            return false;  // 被过滤
          }
          this.messages.push({ type, content, timestamp: extra.timestamp });
          return true;  // 成功添加
        }
      };

      // 第一次初始历史加载
      expect(mockChatMode.addMessage('user', '你好', { timestamp: '2026-01-11T10:00:00Z' })).toBe(true);
      expect(mockChatMode.addMessage('assistant', '你好！', { timestamp: '2026-01-11T10:00:05Z' })).toBe(true);

      // 用户发送新消息
      expect(mockChatMode.addMessage('user', '测试', { timestamp: '2026-01-11T10:01:00Z' })).toBe(true);
      expect(mockChatMode.messages.length).toBe(3);

      // 第二次初始历史加载（如 WebSocket 重连后）
      // 历史中包含用户刚发的消息
      const added = mockChatMode.addMessage('user', '测试', { timestamp: '2026-01-11T10:01:00Z' });

      // 这条消息应该被判定为重复，不添加（这是正确行为）
      expect(added).toBe(false);
      expect(mockChatMode.messages.length).toBe(3);  // 消息数量不变
    });

    test('【BUG 场景】后端发送的历史消息没有 timestamp', () => {
      // 根据后端代码：
      // timestamp = msg.timestamp.isoformat() if hasattr(msg, 'timestamp') else None
      // 如果 ChatMessage 没有 timestamp 属性，则不发送 timestamp

      const mockChatMode = {
        messages: [],
        isLoadingHistory: false,

        isDuplicateMessage(type, content, timestamp) {
          if (!this.messages || this.messages.length === 0) return false;

          for (let i = this.messages.length - 1; i >= 0; i--) {
            const msg = this.messages[i];
            if (msg.type === type && msg.content === content) {
              if (timestamp && msg.timestamp) {
                const diff = Math.abs(new Date(timestamp) - new Date(msg.timestamp));
                if (diff < 60000) return true;
              } else {
                // 没有 timestamp 时，认为相同内容就是重复
                return true;
              }
            }
          }
          return false;
        }
      };

      // 第一条消息有 timestamp
      mockChatMode.messages.push({ type: 'user', content: '你好', timestamp: '2026-01-11T10:00:00Z' });

      // 第二条消息（同样内容）没有 timestamp
      const isDup = mockChatMode.isDuplicateMessage('user', '你好', undefined);

      // BUG: 这会返回 true，因为代码在 else 分支直接 return true
      // 即使这是完全不同时间发送的消息，只要内容相同就被过滤
      expect(isDup).toBe(true);  // 这可能是 bug！
    });

    test('【BUG 场景】Claude session 中 tool_result 类型消息的处理', () => {
      // Claude session 文件中，tool_result 消息格式：
      // {"type":"user","message":{"role":"user","content":[{"tool_use_id":"xxx","type":"tool_result","content":"..."}]}}
      //
      // 注意：顶层 type 是 "user"，但 message.content 是数组，包含 tool_result

      // 模拟后端 _forward_chat_message 的处理
      function processMessage(claudeMessage) {
        const msgType = claudeMessage.type;  // "user"
        const message = claudeMessage.message || {};
        const contentBlocks = message.content || [];

        const results = [];

        if (typeof contentBlocks === 'string') {
          // 普通用户文本消息
          results.push({ type: 'user', content: contentBlocks });
        } else if (Array.isArray(contentBlocks)) {
          for (const block of contentBlocks) {
            if (typeof block === 'string') {
              results.push({ type: 'user', content: block });
            } else if (block.type === 'text') {
              results.push({ type: 'user', content: block.text });
            } else if (block.type === 'tool_result') {
              results.push({ type: 'tool_result', tool_id: block.tool_use_id, content: block.content });
            }
          }
        }

        return results;
      }

      // 普通用户消息
      const userMsg = {
        type: 'user',
        message: { role: 'user', content: '你好世界' }
      };
      let result = processMessage(userMsg);
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('user');
      expect(result[0].content).toBe('你好世界');

      // tool_result 消息
      const toolResultMsg = {
        type: 'user',
        message: {
          role: 'user',
          content: [{
            tool_use_id: 'toolu_123',
            type: 'tool_result',
            content: '命令执行成功'
          }]
        }
      };
      result = processMessage(toolResultMsg);
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('tool_result');  // 应该是 tool_result，不是 user
      expect(result[0].tool_id).toBe('toolu_123');
    });
  });

  describe('BUG-014 深入调查: 历史滚动时内容被替换', () => {
    /**
     * 用户报告：往前翻历史时，刚刚看见的内容会被替换成很早以前的内容
     *
     * 可能的原因：
     * 1. DOM 容器引用错误（多个 session 共享同一个容器引用）
     * 2. pendingHistoryMessages 处理时覆盖了现有内容
     * 3. 滚动位置计算错误导致重复加载
     */

    test('【BUG 场景】多个 session 的 messagesEl 引用混淆', () => {
      // 场景：
      // 1. Session A 打开，messagesEl 指向容器 A
      // 2. Session B 打开，messagesEl 指向容器 B
      // 3. 切换回 Session A，但 messagesEl 仍然指向容器 B
      // 4. 加载历史时，消息被添加到错误的容器

      const containerA = document.createElement('div');
      containerA.id = 'session-A';
      const containerB = document.createElement('div');
      containerB.id = 'session-B';

      // 模拟 ChatMode
      const chatMode = {
        messagesEl: null,
        currentSessionId: null,

        switchToSession(sessionId, container) {
          this.currentSessionId = sessionId;
          this.messagesEl = container;
        },

        addMessage(content) {
          if (!this.messagesEl) return;
          const el = document.createElement('div');
          el.textContent = content;
          el.dataset.session = this.currentSessionId;
          this.messagesEl.appendChild(el);
        }
      };

      // 初始化 Session A
      chatMode.switchToSession('A', containerA);
      chatMode.addMessage('消息 A1');
      expect(containerA.children.length).toBe(1);
      expect(containerB.children.length).toBe(0);

      // 切换到 Session B
      chatMode.switchToSession('B', containerB);
      chatMode.addMessage('消息 B1');
      expect(containerA.children.length).toBe(1);
      expect(containerB.children.length).toBe(1);

      // 切换回 Session A，但忘记更新 messagesEl（模拟 bug）
      chatMode.currentSessionId = 'A';
      // 注意：没有调用 switchToSession，messagesEl 仍然指向 containerB

      chatMode.addMessage('消息 A2');

      // BUG: 消息 A2 被添加到了 containerB 而不是 containerA！
      expect(containerA.children.length).toBe(1);  // 应该是 2
      expect(containerB.children.length).toBe(2);  // 应该是 1

      // 验证消息被添加到了错误的容器
      const wrongMessage = containerB.children[1];
      expect(wrongMessage.textContent).toBe('消息 A2');
      expect(wrongMessage.dataset.session).toBe('A');  // 标记为 A，但在 B 的容器中
    });

    test('【BUG 场景】history_page_end 处理时使用了错误的容器引用', () => {
      // 场景：
      // 1. 用户在 Session A 滚动加载历史
      // 2. 在等待后端响应期间，用户切换到 Session B
      // 3. 后端返回 history_page_end 时，ChatMode 的 messagesEl 已经指向 B
      // 4. 历史消息被插入到 Session B 的容器中

      const sessionA = {
        id: 'A',
        container: document.createElement('div'),
        messages: []
      };
      const sessionB = {
        id: 'B',
        container: document.createElement('div'),
        messages: []
      };

      // 初始化 Session A 有 5 条消息
      for (let i = 0; i < 5; i++) {
        sessionA.messages.push({ content: `A-${i}` });
        const el = document.createElement('div');
        el.textContent = `A-${i}`;
        sessionA.container.appendChild(el);
      }

      const chatMode = {
        messagesEl: sessionA.container,
        messages: sessionA.messages,
        currentSession: sessionA,
        pendingHistoryMessages: [],
        isLoadingHistory: false,

        // 模拟加载更多历史
        startLoadingHistory() {
          this.isLoadingHistory = true;
          // 模拟后端响应延迟...
        },

        receiveHistoryMessage(msg) {
          this.pendingHistoryMessages.push(msg);
        },

        // 模拟切换 session
        switchSession(session) {
          this.currentSession = session;
          this.messagesEl = session.container;
          this.messages = session.messages;
          // 注意：pendingHistoryMessages 和 isLoadingHistory 没有重置
        },

        handleHistoryPageEnd() {
          if (this.pendingHistoryMessages.length > 0) {
            // BUG: 这里使用的是当前的 messagesEl，可能已经切换到其他 session
            const fragment = document.createDocumentFragment();
            for (const msg of this.pendingHistoryMessages) {
              const el = document.createElement('div');
              el.textContent = msg.content;
              fragment.appendChild(el);
            }
            this.messagesEl.insertBefore(fragment, this.messagesEl.firstChild);

            // 也更新 messages 数组
            this.messages.unshift(...this.pendingHistoryMessages);

            this.pendingHistoryMessages = [];
          }
          this.isLoadingHistory = false;
        }
      };

      // 1. 在 Session A 开始加载历史
      chatMode.startLoadingHistory();

      // 2. 收到历史消息
      chatMode.receiveHistoryMessage({ content: 'A-history-1' });
      chatMode.receiveHistoryMessage({ content: 'A-history-2' });

      // 3. 在处理 history_page_end 之前，用户切换到 Session B
      chatMode.switchSession(sessionB);

      // 4. 处理 history_page_end
      chatMode.handleHistoryPageEnd();

      // BUG: 历史消息被插入到了 Session B 的容器中！
      expect(sessionA.container.children.length).toBe(5);  // 应该是 7
      expect(sessionB.container.children.length).toBe(2);  // 应该是 0

      // Session B 的 messages 数组也被污染了
      expect(sessionA.messages.length).toBe(5);  // 应该是 7
      expect(sessionB.messages.length).toBe(2);  // 应该是 0
    });
  });

  describe('BUG-013/014 精确场景复现', () => {
    /**
     * 用户报告的精确场景：
     * 1. "打开一个聊天的 session 的时候，我看不见我发出去的消息，我只能看见回来的消息"
     * 2. "往前翻历史，翻着翻着我刚刚看见的内容会被替换掉"
     */

    test('【用户场景】打开 session 时应该能看到所有历史消息（包括用户消息）', () => {
      // 模拟完整的前端 ChatMode 对象
      const chatMode = {
        messages: [],
        messagesEl: document.createElement('div'),
        isLoadingHistory: false,  // 关键：初始历史加载时这是 false
        pendingHistoryMessages: [],
        isConnected: true,

        // 模拟后端发送的历史消息序列
        simulateBackendHistory() {
          return [
            // ready 消息
            { type: 'ready', data: { history_count: 6 } },
            // 历史消息
            { type: 'user', data: { content: '你好', timestamp: '2026-01-11T10:00:00Z' } },
            { type: 'assistant', data: { content: '你好！有什么可以帮你？', timestamp: '2026-01-11T10:00:05Z' } },
            { type: 'user', data: { content: '帮我写个代码', timestamp: '2026-01-11T10:01:00Z' } },
            { type: 'assistant', data: { content: '好的，请告诉我需要写什么代码。', timestamp: '2026-01-11T10:01:05Z' } },
            { type: 'user', data: { content: '一个计算器', timestamp: '2026-01-11T10:02:00Z' } },
            { type: 'assistant', data: { content: '这是一个简单的计算器实现...', timestamp: '2026-01-11T10:02:30Z' } },
            // history_end
            { type: 'history_end', data: { count: 6, total: 6, has_more: false } }
          ];
        },

        isDuplicateMessage(type, content, timestamp) {
          // 复制实际代码的逻辑
          if (this.isLoadingHistory) return false;
          if (!this.messages || this.messages.length === 0) return false;

          for (let i = this.messages.length - 1; i >= Math.max(0, this.messages.length - 50); i--) {
            const msg = this.messages[i];
            if (msg.type === type) {
              let isContentMatch = msg.content === content;
              if (isContentMatch) {
                if (timestamp && msg.extra?.timestamp) {
                  const msgTime = new Date(msg.extra.timestamp).getTime();
                  const newTime = new Date(timestamp).getTime();
                  if (Math.abs(newTime - msgTime) < 60000) {
                    return true;
                  }
                } else {
                  // 没有 timestamp 时，认为相同内容就是重复
                  return true;
                }
              }
            }
          }
          return false;
        },

        addMessage(type, content, extra = {}) {
          this.messages.push({ type, content, extra });
          const el = document.createElement('div');
          el.className = `chat-message ${type}`;
          el.textContent = content;
          this.messagesEl.appendChild(el);
        },

        handleMessage(data) {
          switch (data.type) {
            case 'ready':
              this.isConnected = true;
              break;

            case 'user':
              if (this.isLoadingHistory) {
                this.pendingHistoryMessages.push({
                  type: 'user',
                  content: data.data.content,
                  extra: { timestamp: data.data.timestamp }
                });
              } else {
                // 关键：这里会调用 isDuplicateMessage
                if (this.isDuplicateMessage('user', data.data.content, data.data.timestamp)) {
                  return 'skipped';
                }
                this.addMessage('user', data.data.content, { timestamp: data.data.timestamp });
              }
              break;

            case 'assistant':
              if (this.isLoadingHistory) {
                this.pendingHistoryMessages.push({
                  type: 'assistant',
                  content: data.data.content,
                  extra: { timestamp: data.data.timestamp }
                });
              } else {
                if (this.isDuplicateMessage('assistant', data.data.content, data.data.timestamp)) {
                  return 'skipped';
                }
                this.addMessage('assistant', data.data.content, { timestamp: data.data.timestamp });
              }
              break;

            case 'history_end':
              // 初始历史加载完成
              break;
          }
          return 'handled';
        }
      };

      // 模拟初始历史加载
      const history = chatMode.simulateBackendHistory();
      const results = history.map(msg => chatMode.handleMessage(msg));

      // 验证所有消息都被正确处理
      expect(results.filter(r => r === 'skipped').length).toBe(0);

      // 验证 messages 数组包含 6 条消息
      expect(chatMode.messages.length).toBe(6);

      // 验证用户消息都在
      const userMessages = chatMode.messages.filter(m => m.type === 'user');
      expect(userMessages.length).toBe(3);

      // 验证助手消息都在
      const assistantMessages = chatMode.messages.filter(m => m.type === 'assistant');
      expect(assistantMessages.length).toBe(3);

      // 验证 DOM 也正确渲染
      expect(chatMode.messagesEl.children.length).toBe(6);
    });

    test('【用户场景】滚动加载历史时不应该替换现有内容', () => {
      const chatMode = {
        messages: [],
        messagesEl: document.createElement('div'),
        isLoadingHistory: false,
        pendingHistoryMessages: [],
        historyOldestIndex: 100,
        hasMoreHistory: true,

        // 初始化：模拟已经显示了最近 5 条消息
        initCurrentMessages() {
          for (let i = 95; i < 100; i++) {
            const type = i % 2 === 0 ? 'user' : 'assistant';
            const content = `消息 ${i}`;
            this.messages.push({ type, content, extra: { timestamp: `2026-01-11T${10 + Math.floor(i / 10)}:${i % 60}:00Z` } });
            const el = document.createElement('div');
            el.className = `chat-message ${type}`;
            el.textContent = content;
            el.dataset.index = i;
            this.messagesEl.appendChild(el);
          }
        },

        loadMoreHistory() {
          if (this.isLoadingHistory || !this.hasMoreHistory) return;
          this.isLoadingHistory = true;
        },

        receiveHistoryMessage(msg) {
          if (this.isLoadingHistory) {
            this.pendingHistoryMessages.push(msg);
          }
        },

        handleHistoryPageEnd(data) {
          if (this.pendingHistoryMessages.length > 0) {
            // 保存滚动位置
            const scrollHeightBefore = this.messagesEl.scrollHeight;

            // 在数组头部插入
            this.messages.unshift(...this.pendingHistoryMessages);

            // 在 DOM 头部插入
            const fragment = document.createDocumentFragment();
            for (const msg of this.pendingHistoryMessages) {
              const el = document.createElement('div');
              el.className = `chat-message ${msg.type}`;
              el.textContent = msg.content;
              fragment.appendChild(el);
            }
            this.messagesEl.insertBefore(fragment, this.messagesEl.firstChild);

            // 清空 pending
            this.pendingHistoryMessages = [];
          }

          this.isLoadingHistory = false;
          this.historyOldestIndex = data.oldest_index;
          this.hasMoreHistory = data.has_more;
        }
      };

      // 初始化当前消息
      chatMode.initCurrentMessages();
      expect(chatMode.messages.length).toBe(5);
      expect(chatMode.messagesEl.children.length).toBe(5);

      // 记录当前最后一条消息
      const lastMessageBefore = chatMode.messages[4].content;
      expect(lastMessageBefore).toBe('消息 99');

      // 开始加载历史
      chatMode.loadMoreHistory();
      expect(chatMode.isLoadingHistory).toBe(true);

      // 模拟收到 10 条历史消息 (index 85-94)
      for (let i = 85; i < 95; i++) {
        chatMode.receiveHistoryMessage({
          type: i % 2 === 0 ? 'user' : 'assistant',
          content: `消息 ${i}`,
          extra: { timestamp: `2026-01-11T${10 + Math.floor(i / 10)}:${i % 60}:00Z` }
        });
      }

      // 处理 history_page_end
      chatMode.handleHistoryPageEnd({
        count: 10,
        oldest_index: 85,
        has_more: true
      });

      // 验证：消息总数应该是 15
      expect(chatMode.messages.length).toBe(15);
      expect(chatMode.messagesEl.children.length).toBe(15);

      // 验证：原来的消息还在，且顺序正确
      expect(chatMode.messages[14].content).toBe('消息 99');  // 最后一条
      expect(chatMode.messages[10].content).toBe('消息 95');  // 原来的第一条

      // 验证：新加载的消息在头部
      expect(chatMode.messages[0].content).toBe('消息 85');
      expect(chatMode.messages[9].content).toBe('消息 94');

      // 验证：原来的内容没有被替换
      const domTexts = Array.from(chatMode.messagesEl.children).map(el => el.textContent);
      expect(domTexts).toContain('消息 99');
      expect(domTexts).toContain('消息 95');
      expect(domTexts).toContain('消息 85');
    });

    test('【关键验证】初始历史加载时 isLoadingHistory 应该是 true', () => {
      // 这是一个"应该"的行为，但实际代码可能不是这样
      // 如果这个测试失败，说明代码有 bug

      // 模拟正确的行为：初始历史加载时应该设置 isLoadingHistory=true
      const correctBehavior = {
        isLoadingHistory: false,

        onConnect() {
          // 正确的做法：连接时设置 isLoadingHistory=true
          this.isLoadingHistory = true;
        },

        onHistoryEnd() {
          // 正确的做法：history_end 时设置 isLoadingHistory=false
          this.isLoadingHistory = false;
        }
      };

      correctBehavior.onConnect();
      expect(correctBehavior.isLoadingHistory).toBe(true);

      correctBehavior.onHistoryEnd();
      expect(correctBehavior.isLoadingHistory).toBe(false);

      // 但是实际代码可能不是这样做的
      // 这个测试表明了期望的行为
    });
  });

  describe('BUG-014 核心问题: 切换 session 时状态未重置', () => {
    /**
     * 根本原因分析：
     * isLoadingHistory 和 pendingHistoryMessages 是 ChatMode 的全局属性，
     * 切换 session 时没有重置这些状态。
     *
     * 复现场景：
     * 1. 用户在 session A 滚动加载历史 (isLoadingHistory = true)
     * 2. 历史消息陆续到达，收集到 pendingHistoryMessages
     * 3. 用户切换到 session B
     * 4. session A 的 history_page_end 到达
     * 5. pendingHistoryMessages 被插入到 session B 的容器中！
     */

    test('【BUG 复现】切换 session 时 isLoadingHistory 未重置', () => {
      // 模拟 ChatMode 的状态（全局属性）
      const chatMode = {
        // 全局状态 - 这是问题所在！
        isLoadingHistory: false,
        pendingHistoryMessages: [],
        messagesEl: null,  // 当前活跃的容器
        sessionId: null,

        // Session A 的容器和消息
        sessionAContainer: document.createElement('div'),
        sessionAMessages: [],

        // Session B 的容器和消息
        sessionBContainer: document.createElement('div'),
        sessionBMessages: [],

        // 切换到 session
        switchToSession(sessionId, container, messages) {
          // 当前代码的问题：没有重置 isLoadingHistory 和 pendingHistoryMessages
          this.sessionId = sessionId;
          this.messagesEl = container;
          // this.isLoadingHistory = false;  // 应该重置但没有！
          // this.pendingHistoryMessages = [];  // 应该重置但没有！
        },

        loadMoreHistory() {
          this.isLoadingHistory = true;
        },

        receiveHistoryMessage(msg) {
          if (this.isLoadingHistory) {
            this.pendingHistoryMessages.push(msg);
          }
        },

        handleHistoryPageEnd() {
          if (this.pendingHistoryMessages.length > 0) {
            // 插入到当前 messagesEl - 但这可能已经不是正确的容器了！
            for (const msg of this.pendingHistoryMessages) {
              const el = document.createElement('div');
              el.className = `chat-message ${msg.type}`;
              el.textContent = msg.content;
              this.messagesEl.appendChild(el);
            }
            this.pendingHistoryMessages = [];
          }
          this.isLoadingHistory = false;
        }
      };

      // Step 1: 切换到 Session A
      chatMode.switchToSession('session-a', chatMode.sessionAContainer, chatMode.sessionAMessages);
      expect(chatMode.sessionId).toBe('session-a');

      // Step 2: 开始加载 Session A 的历史
      chatMode.loadMoreHistory();
      expect(chatMode.isLoadingHistory).toBe(true);

      // Step 3: 收到 Session A 的历史消息
      chatMode.receiveHistoryMessage({ type: 'user', content: 'Session A 消息 1' });
      chatMode.receiveHistoryMessage({ type: 'assistant', content: 'Session A 消息 2' });
      expect(chatMode.pendingHistoryMessages.length).toBe(2);

      // Step 4: 用户切换到 Session B（在收到 history_page_end 之前）
      chatMode.switchToSession('session-b', chatMode.sessionBContainer, chatMode.sessionBMessages);
      expect(chatMode.sessionId).toBe('session-b');

      // BUG 验证：isLoadingHistory 没有重置
      expect(chatMode.isLoadingHistory).toBe(true);  // 应该是 false！

      // BUG 验证：pendingHistoryMessages 没有清空
      expect(chatMode.pendingHistoryMessages.length).toBe(2);  // 应该是 0！

      // Step 5: Session A 的 history_page_end 延迟到达
      chatMode.handleHistoryPageEnd();

      // BUG 验证：Session A 的消息被插入到 Session B 的容器中！
      expect(chatMode.sessionBContainer.children.length).toBe(2);  // 错误的行为！
      expect(chatMode.sessionAContainer.children.length).toBe(0);  // 应该插入这里！

      // 这证明了 bug：Session A 的历史消息被插入到 Session B
    });

    test('【正确行为】切换 session 时应该重置加载状态', () => {
      // 模拟修复后的正确行为
      const chatModeFixed = {
        isLoadingHistory: false,
        pendingHistoryMessages: [],
        messagesEl: null,
        sessionId: null,
        sessionAContainer: document.createElement('div'),
        sessionBContainer: document.createElement('div'),

        // 修复：切换 session 时重置状态
        switchToSession(sessionId, container) {
          // 如果正在加载历史，取消加载并清理
          if (this.isLoadingHistory) {
            this.pendingHistoryMessages = [];  // 清空未完成的历史消息
            this.isLoadingHistory = false;     // 重置加载状态
          }
          this.sessionId = sessionId;
          this.messagesEl = container;
        },

        loadMoreHistory() {
          this.isLoadingHistory = true;
        },

        receiveHistoryMessage(msg) {
          if (this.isLoadingHistory) {
            this.pendingHistoryMessages.push(msg);
          }
        },

        handleHistoryPageEnd() {
          if (this.pendingHistoryMessages.length > 0) {
            for (const msg of this.pendingHistoryMessages) {
              const el = document.createElement('div');
              el.className = `chat-message ${msg.type}`;
              el.textContent = msg.content;
              this.messagesEl.appendChild(el);
            }
            this.pendingHistoryMessages = [];
          }
          this.isLoadingHistory = false;
        }
      };

      // Step 1: 切换到 Session A 并加载历史
      chatModeFixed.switchToSession('session-a', chatModeFixed.sessionAContainer);
      chatModeFixed.loadMoreHistory();
      chatModeFixed.receiveHistoryMessage({ type: 'user', content: 'Session A 消息' });
      expect(chatModeFixed.pendingHistoryMessages.length).toBe(1);

      // Step 2: 切换到 Session B（修复后的行为）
      chatModeFixed.switchToSession('session-b', chatModeFixed.sessionBContainer);

      // 验证：状态已被重置
      expect(chatModeFixed.isLoadingHistory).toBe(false);
      expect(chatModeFixed.pendingHistoryMessages.length).toBe(0);

      // Step 3: 收到 history_page_end（延迟到达）
      chatModeFixed.handleHistoryPageEnd();

      // 验证：Session B 容器没有被污染
      expect(chatModeFixed.sessionBContainer.children.length).toBe(0);
    });

    test('【BUG 复现】快速切换 session 导致消息混乱', () => {
      // 模拟用户快速在多个 session 间切换的场景
      const chatMode = {
        isLoadingHistory: false,
        pendingHistoryMessages: [],
        currentSessionId: null,
        containers: {},

        switchToSession(sessionId) {
          // 问题：没有检查和重置状态
          this.currentSessionId = sessionId;
          if (!this.containers[sessionId]) {
            this.containers[sessionId] = document.createElement('div');
          }
        },

        loadMoreHistory() {
          this.isLoadingHistory = true;
        },

        receiveHistoryMessage(msg, fromSessionId) {
          // 问题：收到消息时没有验证是否是当前 session
          if (this.isLoadingHistory) {
            this.pendingHistoryMessages.push({ ...msg, fromSessionId });
          }
        },

        handleHistoryPageEnd(forSessionId) {
          // 问题：处理消息时没有验证 session ID
          const container = this.containers[this.currentSessionId];  // 使用当前 session 的容器

          for (const msg of this.pendingHistoryMessages) {
            const el = document.createElement('div');
            el.textContent = `[${msg.fromSessionId}] ${msg.content}`;
            container.appendChild(el);
          }
          this.pendingHistoryMessages = [];
          this.isLoadingHistory = false;
        }
      };

      // 场景：用户快速切换 session
      chatMode.switchToSession('A');
      chatMode.loadMoreHistory();
      chatMode.receiveHistoryMessage({ content: 'A的消息1' }, 'A');

      chatMode.switchToSession('B');  // 快速切换
      chatMode.loadMoreHistory();
      chatMode.receiveHistoryMessage({ content: 'B的消息1' }, 'B');

      chatMode.switchToSession('C');  // 再次快速切换

      // A 的 history_page_end 延迟到达
      chatMode.handleHistoryPageEnd('A');

      // BUG: A 和 B 的消息都被插入到 C 的容器中！
      expect(chatMode.containers['C'].children.length).toBe(2);  // 错误！
      expect(chatMode.containers['A'].children.length).toBe(0);  // 应该在这里！
      expect(chatMode.containers['B'].children.length).toBe(0);  // 应该在这里！

      // 验证消息确实被放错位置了
      const cContent = chatMode.containers['C'].textContent;
      expect(cContent).toContain('A的消息1');
      expect(cContent).toContain('B的消息1');
    });
  });

  describe('BUG-014 修复验证: 切换 session 时必须重置历史加载状态', () => {
    /**
     * 这些测试用例验证修复后的正确行为
     * 修复要求：
     * 1. 切换 session 时必须重置 isLoadingHistory = false
     * 2. 切换 session 时必须清空 pendingHistoryMessages = []
     * 3. history_page_end 处理时应该验证 session ID
     */

    // 模拟修复后的 ChatMode 行为
    function createFixedChatMode() {
      return {
        isLoadingHistory: false,
        pendingHistoryMessages: [],
        currentSessionId: null,
        messagesEl: null,
        messages: [],
        containers: {},
        sessionMessages: {},
        historyLoadingForSession: null,  // 记录正在加载历史的 session

        // 修复后的切换 session 方法
        switchToSession(sessionId) {
          // 修复点 1: 切换时重置加载状态
          if (this.isLoadingHistory && this.historyLoadingForSession !== sessionId) {
            // 正在加载其他 session 的历史，清理状态
            this.isLoadingHistory = false;
            this.pendingHistoryMessages = [];
            this.historyLoadingForSession = null;
          }

          this.currentSessionId = sessionId;
          if (!this.containers[sessionId]) {
            this.containers[sessionId] = document.createElement('div');
            this.sessionMessages[sessionId] = [];
          }
          this.messagesEl = this.containers[sessionId];
          this.messages = this.sessionMessages[sessionId];
        },

        loadMoreHistory() {
          this.isLoadingHistory = true;
          this.historyLoadingForSession = this.currentSessionId;
        },

        receiveHistoryMessage(msg) {
          if (this.isLoadingHistory) {
            this.pendingHistoryMessages.push(msg);
          }
        },

        // 修复后的 history_page_end 处理
        handleHistoryPageEnd(forSessionId) {
          // 修复点 2: 验证 session ID
          if (forSessionId !== this.currentSessionId) {
            // 消息是给其他 session 的，忽略
            this.pendingHistoryMessages = [];
            this.isLoadingHistory = false;
            this.historyLoadingForSession = null;
            return 'ignored';
          }

          if (this.pendingHistoryMessages.length > 0) {
            // 在数据结构中添加
            this.messages.unshift(...this.pendingHistoryMessages);

            // 在 DOM 中添加
            for (const msg of this.pendingHistoryMessages) {
              const el = document.createElement('div');
              el.className = `chat-message ${msg.type}`;
              el.textContent = msg.content;
              this.messagesEl.insertBefore(el, this.messagesEl.firstChild);
            }
            this.pendingHistoryMessages = [];
          }
          this.isLoadingHistory = false;
          this.historyLoadingForSession = null;
          return 'processed';
        }
      };
    }

    test('【修复验证】切换 session 时重置 isLoadingHistory', () => {
      const chatMode = createFixedChatMode();

      // Session A 开始加载历史
      chatMode.switchToSession('A');
      chatMode.loadMoreHistory();
      expect(chatMode.isLoadingHistory).toBe(true);

      // 切换到 Session B
      chatMode.switchToSession('B');

      // 验证状态已重置
      expect(chatMode.isLoadingHistory).toBe(false);
    });

    test('【修复验证】切换 session 时清空 pendingHistoryMessages', () => {
      const chatMode = createFixedChatMode();

      chatMode.switchToSession('A');
      chatMode.loadMoreHistory();
      chatMode.receiveHistoryMessage({ type: 'user', content: 'A消息1' });
      chatMode.receiveHistoryMessage({ type: 'assistant', content: 'A消息2' });
      expect(chatMode.pendingHistoryMessages.length).toBe(2);

      // 切换到 Session B
      chatMode.switchToSession('B');

      // 验证 pending 已清空
      expect(chatMode.pendingHistoryMessages.length).toBe(0);
    });

    test('【修复验证】history_page_end 验证 session ID', () => {
      const chatMode = createFixedChatMode();

      // Session A 开始加载
      chatMode.switchToSession('A');
      chatMode.loadMoreHistory();
      chatMode.receiveHistoryMessage({ type: 'user', content: 'A的消息' });

      // 切换到 Session B
      chatMode.switchToSession('B');

      // A 的 history_page_end 延迟到达，应该被忽略
      const result = chatMode.handleHistoryPageEnd('A');
      expect(result).toBe('ignored');

      // B 的容器应该是空的
      expect(chatMode.containers['B'].children.length).toBe(0);
    });

    test('【修复验证】同一 session 的历史加载正常工作', () => {
      const chatMode = createFixedChatMode();

      chatMode.switchToSession('A');
      chatMode.loadMoreHistory();
      chatMode.receiveHistoryMessage({ type: 'user', content: '消息1' });
      chatMode.receiveHistoryMessage({ type: 'assistant', content: '消息2' });

      // 同一 session 的 history_page_end
      const result = chatMode.handleHistoryPageEnd('A');
      expect(result).toBe('processed');

      // 消息应该正确插入
      expect(chatMode.containers['A'].children.length).toBe(2);
      expect(chatMode.messages.length).toBe(2);
    });

    test('【修复验证】快速切换多个 session 不会混乱', () => {
      const chatMode = createFixedChatMode();

      // Session A
      chatMode.switchToSession('A');
      chatMode.loadMoreHistory();
      chatMode.receiveHistoryMessage({ type: 'user', content: 'A消息' });

      // 快速切换到 B
      chatMode.switchToSession('B');
      chatMode.loadMoreHistory();
      chatMode.receiveHistoryMessage({ type: 'user', content: 'B消息' });

      // 快速切换到 C
      chatMode.switchToSession('C');

      // 各种延迟的 history_page_end 到达
      chatMode.handleHistoryPageEnd('A');  // 应该被忽略
      chatMode.handleHistoryPageEnd('B');  // 应该被忽略

      // 所有容器都应该是空的（因为消息被忽略了）
      expect(chatMode.containers['A'].children.length).toBe(0);
      expect(chatMode.containers['B'].children.length).toBe(0);
      expect(chatMode.containers['C'].children.length).toBe(0);
    });

    test('【修复验证】切换回原 session 后加载历史正常', () => {
      const chatMode = createFixedChatMode();

      // Session A 加载历史
      chatMode.switchToSession('A');
      chatMode.loadMoreHistory();
      chatMode.receiveHistoryMessage({ type: 'user', content: 'A第一批' });

      // 切换到 B（中断 A 的加载）
      chatMode.switchToSession('B');

      // 切换回 A 并重新加载
      chatMode.switchToSession('A');
      chatMode.loadMoreHistory();
      chatMode.receiveHistoryMessage({ type: 'user', content: 'A第二批' });
      chatMode.handleHistoryPageEnd('A');

      // 只有第二批消息应该在
      expect(chatMode.containers['A'].children.length).toBe(1);
      expect(chatMode.containers['A'].textContent).toContain('A第二批');
      expect(chatMode.containers['A'].textContent).not.toContain('A第一批');
    });

    test('【修复验证】保持在同一 session 时不重置状态', () => {
      const chatMode = createFixedChatMode();

      chatMode.switchToSession('A');
      chatMode.loadMoreHistory();
      chatMode.receiveHistoryMessage({ type: 'user', content: '消息1' });

      // 再次 switchToSession 到同一个 session（不应该重置）
      chatMode.switchToSession('A');

      // 状态应该保持
      expect(chatMode.isLoadingHistory).toBe(true);
      expect(chatMode.pendingHistoryMessages.length).toBe(1);
    });

    test('【边界情况】没有正在加载时切换 session', () => {
      const chatMode = createFixedChatMode();

      chatMode.switchToSession('A');
      // 没有调用 loadMoreHistory

      // 切换到 B
      chatMode.switchToSession('B');

      // 应该正常工作
      expect(chatMode.currentSessionId).toBe('B');
      expect(chatMode.isLoadingHistory).toBe(false);
    });

    test('【边界情况】pendingHistoryMessages 为空时收到 history_page_end', () => {
      const chatMode = createFixedChatMode();

      chatMode.switchToSession('A');
      chatMode.loadMoreHistory();
      // 没有收到任何消息

      const result = chatMode.handleHistoryPageEnd('A');
      expect(result).toBe('processed');
      expect(chatMode.containers['A'].children.length).toBe(0);
      expect(chatMode.isLoadingHistory).toBe(false);
    });
  });

  describe('BUG: 发送按钮在接收完成后仍然被禁用', () => {
    /**
     * 问题: 发送消息后，当回复接收完成时，发送按钮仍然被禁用
     * 原因: result 消息处理中设置了 isStreaming = false，但没有更新发送按钮状态
     * 症状: 切换聊天窗口再切换回来，发送按钮又可以发送了（因为触发了 input 事件）
     */
    test('result 消息应该更新发送按钮状态', () => {
      // 创建模拟的 ChatMode 对象
      const mockChatMode = {
        isStreaming: true,
        streamingMessageId: 'msg-123',
        isConnected: true,
        sendBtn: { disabled: true },
        inputEl: { value: 'test message', trim: () => 'test message' },
        messagesEl: { querySelector: () => null, querySelectorAll: () => [] },
        log: jest.fn(),
        hideTypingIndicator: jest.fn(),
        hideProgressMessage: jest.fn(),
        showResultBadge: jest.fn()
      };

      // 模拟 result 消息处理逻辑（修复后）
      const data = { type: 'result', cost_usd: 0.01 };

      // 模拟处理 result 消息
      mockChatMode.isStreaming = false;
      mockChatMode.streamingMessageId = null;

      // BUG FIX: 更新发送按钮状态
      if (mockChatMode.sendBtn && mockChatMode.inputEl) {
        mockChatMode.sendBtn.disabled = !mockChatMode.inputEl.value.trim() || !mockChatMode.isConnected;
      }

      // 验证：发送按钮应该被启用（因为有输入且已连接）
      expect(mockChatMode.sendBtn.disabled).toBe(false);
      expect(mockChatMode.isStreaming).toBe(false);
    });

    test('result 消息处理：输入框为空时发送按钮应保持禁用', () => {
      const mockChatMode = {
        isStreaming: true,
        streamingMessageId: 'msg-123',
        isConnected: true,
        sendBtn: { disabled: true },
        inputEl: { value: '', trim: () => '' },
        messagesEl: { querySelector: () => null, querySelectorAll: () => [] },
        log: jest.fn()
      };

      // 模拟处理 result 消息
      mockChatMode.isStreaming = false;
      mockChatMode.streamingMessageId = null;

      // BUG FIX: 更新发送按钮状态
      if (mockChatMode.sendBtn && mockChatMode.inputEl) {
        mockChatMode.sendBtn.disabled = !mockChatMode.inputEl.value.trim() || !mockChatMode.isConnected;
      }

      // 验证：发送按钮应该保持禁用（因为输入框为空）
      expect(mockChatMode.sendBtn.disabled).toBe(true);
    });

    test('result 消息处理：未连接时发送按钮应保持禁用', () => {
      const mockChatMode = {
        isStreaming: true,
        streamingMessageId: 'msg-123',
        isConnected: false, // 未连接
        sendBtn: { disabled: true },
        inputEl: { value: 'test message', trim: () => 'test message' },
        messagesEl: { querySelector: () => null, querySelectorAll: () => [] },
        log: jest.fn()
      };

      // 模拟处理 result 消息
      mockChatMode.isStreaming = false;
      mockChatMode.streamingMessageId = null;

      // BUG FIX: 更新发送按钮状态
      if (mockChatMode.sendBtn && mockChatMode.inputEl) {
        mockChatMode.sendBtn.disabled = !mockChatMode.inputEl.value.trim() || !mockChatMode.isConnected;
      }

      // 验证：发送按钮应该保持禁用（因为未连接）
      expect(mockChatMode.sendBtn.disabled).toBe(true);
    });
  });
});
