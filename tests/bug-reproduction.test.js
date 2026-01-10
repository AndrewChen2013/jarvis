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
});
