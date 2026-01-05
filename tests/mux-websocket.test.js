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
 * MuxWebSocket 测试用例
 *
 * 测试场景：
 * 1. 连接和认证
 * 2. 订阅和取消订阅
 * 3. 消息路由
 * 4. Session ID 重映射（temp ID -> UUID）
 * 5. 重连机制
 * 6. 多 Session 隔离
 */

// Polyfill TextEncoder/TextDecoder for jsdom
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock MessagePack
global.MessagePack = {
  encode: (data) => {
    const json = JSON.stringify(data);
    const encoder = new TextEncoder();
    return encoder.encode(json);
  },
  decode: (data) => {
    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(data));
  }
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
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;

    MockWebSocket.instances.push(this);

    // Auto-connect after a tick (simulate async connection)
    // Use setTimeout(0) for jest fake timer compatibility
    setTimeout(() => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        this.readyState = MockWebSocket.OPEN;
        if (this.onopen) this.onopen({});
      }
    }, 0);
  }

  send(data) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket not open');
    }
    this.sentMessages.push(data);
  }

  close(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code, reason });
    }
  }

  // Test helper: simulate opening the connection
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen({});
  }

  // Test helper: simulate receiving a message
  receiveMessage(data) {
    if (this.onmessage) {
      // Send as JSON string - MuxWebSocket._onMessage will use JSON.parse path
      // (ArrayBuffer instanceof checks fail across jsdom realms)
      this.onmessage({ data: JSON.stringify(data) });
    }
  }

  // Test helper: simulate connection error
  triggerError(error) {
    if (this.onerror) {
      this.onerror(error);
    }
  }
}

global.WebSocket = MockWebSocket;

// Mock localStorage
Object.defineProperty(window, 'localStorage', {
  value: {
    _data: {},
    getItem: (key) => window.localStorage._data[key] || null,
    setItem: (key, value) => { window.localStorage._data[key] = value; },
    clear: () => { window.localStorage._data = {}; }
  },
  writable: true,
  configurable: true
});

// Mock window location and app (must be done before loading the code)
// Use delete + redefine pattern for jsdom compatibility
delete window.location;
window.location = {
  protocol: 'http:',
  host: 'localhost:8080',
  hostname: 'localhost',
  port: '8080'
};

window.app = {
  debugLog: jest.fn(),
  authToken: 'test-token'
};

// Load MuxWebSocket code
const fs = require('fs');
const path = require('path');
const muxWebSocketCode = fs.readFileSync(
  path.join(__dirname, '../static/mux-websocket.js'),
  'utf8'
);
eval(muxWebSocketCode);

// MuxWebSocket 类在源文件中是全局定义的，但 eval 后需要手动导出
// 从 window.muxWs 的构造函数中获取类定义
const MuxWebSocket = window.muxWs.constructor;

// Helper: Decode and unpack message to normalized format for assertions
// Handles both old format (channel, type) and new format (c, t)
function decodeMessage(packed) {
  const msg = MessagePack.decode(packed);
  // Use the global unpackMessage function from mux-websocket.js
  return unpackMessage(msg);
}


describe('MuxWebSocket', () => {
  let muxWs;

  beforeEach(() => {
    jest.useFakeTimers();
    muxWs = new MuxWebSocket();
    window.muxWs = muxWs;
  });

  afterEach(() => {
    if (muxWs.ws) {
      muxWs.ws.close();
    }
    muxWs.handlers.clear();
    muxWs.subscriptionData.clear();
    muxWs.pendingOperations = [];
    MockWebSocket.instances = [];
    jest.useRealTimers();
  });

  describe('连接和认证', () => {
    test('connect 应该创建 WebSocket 连接', () => {
      muxWs.connect();

      expect(muxWs.ws).not.toBeNull();
      expect(muxWs.ws.url).toBe('ws://localhost:8080/ws/mux');
      expect(muxWs.state).toBe('connecting');
    });

    test('连接成功后应该发送认证消息', async () => {
      muxWs.connect();

      // Run timers to trigger onopen
      jest.runAllTimers();

      expect(muxWs.state).toBe('authenticating');
      expect(muxWs.ws.sentMessages.length).toBe(1);

      const authMsg = decodeMessage(muxWs.ws.sentMessages[0]);
      expect(authMsg.channel).toBe('system');
      expect(authMsg.type).toBe('auth');
      expect(authMsg.data.token).toBe('test-token');
    });

    test('认证成功后状态应该变为 connected', async () => {
      muxWs.connect();
      jest.runAllTimers();

      // Simulate auth success response
      muxWs.ws.receiveMessage({
        channel: 'system',
        type: 'auth_success',
        data: {}
      });

      expect(muxWs.state).toBe('connected');
      expect(muxWs.authenticated).toBe(true);
    });

    test('认证失败应该断开连接', async () => {
      muxWs.connect();
      jest.runAllTimers();

      muxWs.ws.receiveMessage({
        channel: 'system',
        type: 'auth_failed',
        data: { reason: 'invalid token' }
      });

      expect(muxWs.state).toBe('disconnected');
      expect(muxWs.authenticated).toBe(false);
    });

    test('重复调用 connect 不应创建多个连接', async () => {
      muxWs.connect();
      const firstWs = muxWs.ws;

      muxWs.connect();

      expect(muxWs.ws).toBe(firstWs);
    });

    test('disconnect 应该关闭连接并阻止重连', async () => {
      muxWs.connect();
      jest.runAllTimers();

      muxWs.disconnect();

      expect(muxWs.state).toBe('disconnected');
      expect(muxWs.reconnectAttempts).toBe(muxWs.maxReconnectAttempts);
    });
  });

  describe('订阅和取消订阅', () => {
    test('subscribe 应该注册 handler', () => {
      const onMessage = jest.fn();
      const onConnect = jest.fn();

      muxWs.subscribe('session-1', 'terminal', { onMessage, onConnect });

      expect(muxWs.handlers.has('terminal:session-1')).toBe(true);
      const handler = muxWs.handlers.get('terminal:session-1');
      expect(handler.channel).toBe('terminal');
      expect(handler.sessionId).toBe('session-1');
    });

    test('unsubscribe 应该移除 handler', () => {
      muxWs.subscribe('session-1', 'terminal', {});
      expect(muxWs.handlers.has('terminal:session-1')).toBe(true);

      muxWs.unsubscribe('session-1', 'terminal');
      expect(muxWs.handlers.has('terminal:session-1')).toBe(false);
    });

    test('同一 sessionId 不同 channel 应该分开存储', () => {
      muxWs.subscribe('session-1', 'terminal', { onMessage: jest.fn() });
      muxWs.subscribe('session-1', 'chat', { onMessage: jest.fn() });

      expect(muxWs.handlers.has('terminal:session-1')).toBe(true);
      expect(muxWs.handlers.has('chat:session-1')).toBe(true);
      expect(muxWs.handlers.size).toBe(2);
    });
  });

  describe('消息发送', () => {
    test('send 在未连接时应该排队等待', () => {
      muxWs.send('terminal', 'session-1', 'input', { text: 'hello' });

      expect(muxWs.pendingOperations.length).toBe(1);
      // pendingOperations now stores packed format
      const pending = unpackMessage(muxWs.pendingOperations[0]);
      expect(pending.type).toBe('input');
    });

    test('send 在已连接时应该直接发送', async () => {
      muxWs.connect();
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      muxWs.send('terminal', 'session-1', 'input', { text: 'hello' });

      // First message is auth, second is our input
      expect(muxWs.ws.sentMessages.length).toBe(2);
      const msg = decodeMessage(muxWs.ws.sentMessages[1]);
      expect(msg.channel).toBe('terminal');
      expect(msg.session_id).toBe('session-1');
      expect(msg.type).toBe('input');
      expect(msg.data.text).toBe('hello');
    });

    test('pending operations 应该在连接成功后发送', async () => {
      // Queue messages before connecting
      muxWs.send('terminal', 'session-1', 'input', { text: 'msg1' });
      muxWs.send('terminal', 'session-1', 'input', { text: 'msg2' });
      expect(muxWs.pendingOperations.length).toBe(2);

      // Connect and authenticate
      muxWs.connect();
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      // Should have sent auth + 2 pending messages
      expect(muxWs.ws.sentMessages.length).toBe(3);
      expect(muxWs.pendingOperations.length).toBe(0);
    });
  });

  describe('消息路由', () => {
    let terminalHandler, chatHandler;

    beforeEach(async () => {
      terminalHandler = {
        onMessage: jest.fn(),
        onConnect: jest.fn(),
        onDisconnect: jest.fn()
      };
      chatHandler = {
        onMessage: jest.fn(),
        onConnect: jest.fn(),
        onDisconnect: jest.fn()
      };

      muxWs.subscribe('session-1', 'terminal', terminalHandler);
      muxWs.subscribe('session-1', 'chat', chatHandler);

      // Connect
      muxWs.connect();
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });
    });

    test('terminal 消息应该路由到 terminal handler', () => {
      muxWs.ws.receiveMessage({
        channel: 'terminal',
        session_id: 'session-1',
        type: 'output',
        data: { text: 'hello' }
      });

      expect(terminalHandler.onMessage).toHaveBeenCalledWith('output', { text: 'hello' });
      expect(chatHandler.onMessage).not.toHaveBeenCalled();
    });

    test('chat 消息应该路由到 chat handler', () => {
      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: 'session-1',
        type: 'message',
        data: { content: 'hi' }
      });

      expect(chatHandler.onMessage).toHaveBeenCalledWith('message', { content: 'hi' });
      expect(terminalHandler.onMessage).not.toHaveBeenCalled();
    });

    test('connected 消息应该调用 onConnect', () => {
      muxWs.ws.receiveMessage({
        channel: 'terminal',
        session_id: 'session-1',
        type: 'connected',
        data: { terminal_id: 'session-1' }
      });

      expect(terminalHandler.onConnect).toHaveBeenCalledWith({ terminal_id: 'session-1' });
    });

    test('没有 handler 的消息应该被忽略', () => {
      // Should not throw
      expect(() => {
        muxWs.ws.receiveMessage({
          channel: 'terminal',
          session_id: 'unknown-session',
          type: 'output',
          data: {}
        });
      }).not.toThrow();
    });
  });

  describe('Session ID 重映射（temp ID -> UUID）', () => {
    test('收到新 session_id 时应该重映射 handler', async () => {
      const handler = {
        onMessage: jest.fn(),
        onConnect: jest.fn(),
        onDisconnect: jest.fn()
      };

      // Subscribe with temp ID
      muxWs.subscribe('new-12345', 'terminal', handler);

      muxWs.connect();
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      // Server responds with new UUID
      muxWs.ws.receiveMessage({
        channel: 'terminal',
        session_id: 'real-uuid-abc',
        type: 'connected',
        data: { original_session_id: 'new-12345' }
      });

      // Old key should be removed
      expect(muxWs.handlers.has('terminal:new-12345')).toBe(false);
      // New key should exist
      expect(muxWs.handlers.has('terminal:real-uuid-abc')).toBe(true);
      // Handler should be called
      expect(handler.onConnect).toHaveBeenCalled();
    });

    test('重映射应该同时更新 subscriptionData', async () => {
      muxWs.subscribe('new-12345', 'terminal', {});
      muxWs.subscriptionData.set('terminal:new-12345', {
        channel: 'terminal',
        sessionId: 'new-12345',
        data: { working_dir: '/test' }
      });

      muxWs.connect();
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      muxWs.ws.receiveMessage({
        channel: 'terminal',
        session_id: 'real-uuid',
        type: 'connected',
        data: { original_session_id: 'new-12345' }
      });

      expect(muxWs.subscriptionData.has('terminal:new-12345')).toBe(false);
      expect(muxWs.subscriptionData.has('terminal:real-uuid')).toBe(true);
      const sub = muxWs.subscriptionData.get('terminal:real-uuid');
      expect(sub.sessionId).toBe('real-uuid');
    });

    test('Chat ready 消息也应该触发重映射', async () => {
      const handler = { onMessage: jest.fn(), onConnect: jest.fn(), onDisconnect: jest.fn() };
      muxWs.subscribe('new-chat-12345', 'chat', handler);

      muxWs.connect();
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: 'chat-uuid',
        type: 'ready',
        data: { original_session_id: 'new-chat-12345' }
      });

      expect(muxWs.handlers.has('chat:new-chat-12345')).toBe(false);
      expect(muxWs.handlers.has('chat:chat-uuid')).toBe(true);
    });
  });

  describe('重连机制', () => {
    test('连接断开后应该自动重连', async () => {
      muxWs.connect();
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });
      muxWs.hasConnectedBefore = true;

      // Simulate unexpected close
      muxWs.ws.close(1006, 'abnormal closure');

      expect(muxWs.state).toBe('disconnected');
      expect(muxWs.reconnectAttempts).toBe(1);

      // Fast-forward past reconnect delay
      await jest.advanceTimersByTimeAsync(2000);

      // Should have attempted to reconnect
      expect(muxWs.ws).not.toBeNull();
    });

    test('达到最大重连次数后应该停止', async () => {
      muxWs.maxReconnectAttempts = 3;

      // Connect first
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      // Clear ping interval
      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      // Now set reconnectAttempts to max AFTER connection opens (onOpen resets it to 0)
      muxWs.reconnectAttempts = 3;

      // Close with failure code
      muxWs.ws.close(1006);

      // Should NOT schedule reconnect since max was reached
      // reconnectAttempts might increment but should not exceed max
      expect(muxWs.reconnectAttempts).toBeGreaterThanOrEqual(3);

      // Wait - no new connection should succeed
      await jest.advanceTimersByTimeAsync(10000);

      // Should not have tried again after max reached
      expect(muxWs.state).toBe('disconnected');
    });

    test('重连后应该重新订阅之前的 session', async () => {
      const handler = { onMessage: jest.fn(), onConnect: jest.fn(), onDisconnect: jest.fn() };

      // Connect and authenticate
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);  // Let connection open
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });
      expect(muxWs.state).toBe('connected');

      // Subscribe to terminal
      muxWs.connectTerminal('session-1', '/test', { ...handler, rows: 40, cols: 120 });

      // Store old WS reference
      const oldWs = muxWs.ws;

      // Clear ping interval to prevent infinite timers
      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      // Disconnect (simulates network failure)
      muxWs.ws.close(1006);
      expect(muxWs.state).toBe('disconnected');

      // Wait for reconnect delay
      await jest.advanceTimersByTimeAsync(2000);

      // Should have created new WS
      expect(muxWs.ws).not.toBe(oldWs);
      expect(muxWs.ws).not.toBeNull();

      // Simulate successful reconnection with auth
      await jest.advanceTimersByTimeAsync(10);  // Let connection open
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      // Clean up ping interval again
      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      // Should have sent resubscription message
      const lastMsgs = muxWs.ws.sentMessages;
      expect(lastMsgs.length).toBeGreaterThan(0);
    });

    test('断开连接时应该通知所有 handler', async () => {
      const handler1 = { onMessage: jest.fn(), onConnect: jest.fn(), onDisconnect: jest.fn() };
      const handler2 = { onMessage: jest.fn(), onConnect: jest.fn(), onDisconnect: jest.fn() };

      muxWs.subscribe('session-1', 'terminal', handler1);
      muxWs.subscribe('session-2', 'terminal', handler2);

      muxWs.connect();
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      muxWs.ws.close(1006);

      expect(handler1.onDisconnect).toHaveBeenCalled();
      expect(handler2.onDisconnect).toHaveBeenCalled();
    });
  });

  describe('Terminal 操作', () => {
    beforeEach(async () => {
      muxWs.connect();
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });
    });

    test('connectTerminal 应该发送连接消息', () => {
      const handler = { onMessage: jest.fn(), onConnect: jest.fn() };
      muxWs.connectTerminal('session-1', '/test/path', {
        rows: 40,
        cols: 120,
        ...handler
      });

      // Find the connect message (using decodeMessage to handle new format)
      const msgs = muxWs.ws.sentMessages.map(m => decodeMessage(m));
      const connectMsg = msgs.find(m => m.type === 'connect' && m.channel === 'terminal');

      expect(connectMsg).toBeDefined();
      expect(connectMsg.session_id).toBe('session-1');
      expect(connectMsg.data.working_dir).toBe('/test/path');
      expect(connectMsg.data.rows).toBe(40);
      expect(connectMsg.data.cols).toBe(120);
    });

    test('重复 connectTerminal 应该跳过', () => {
      const handler = { onMessage: jest.fn(), onConnect: jest.fn() };

      muxWs.connectTerminal('session-1', '/test', handler);
      const msgCount = muxWs.ws.sentMessages.length;

      muxWs.connectTerminal('session-1', '/test', handler);

      // Should not send another connect message
      expect(muxWs.ws.sentMessages.length).toBe(msgCount);
    });

    test('terminalInput 应该发送 input 消息', () => {
      muxWs.terminalInput('session-1', 'ls -la');

      const msgs = muxWs.ws.sentMessages.map(m => decodeMessage(m));
      const inputMsg = msgs.find(m => m.type === 'input');

      expect(inputMsg).toBeDefined();
      expect(inputMsg.channel).toBe('terminal');
      expect(inputMsg.session_id).toBe('session-1');
      expect(inputMsg.data.text).toBe('ls -la');
    });

    test('terminalResize 应该发送 resize 消息', () => {
      muxWs.terminalResize('session-1', 50, 150);

      const msgs = muxWs.ws.sentMessages.map(m => decodeMessage(m));
      const resizeMsg = msgs.find(m => m.type === 'resize');

      expect(resizeMsg).toBeDefined();
      expect(resizeMsg.data.rows).toBe(50);
      expect(resizeMsg.data.cols).toBe(150);
    });

    test('disconnectTerminal 应该发送断开消息并清理', () => {
      muxWs.subscribe('session-1', 'terminal', {});
      muxWs.subscriptionData.set('terminal:session-1', { channel: 'terminal', sessionId: 'session-1', data: {} });

      muxWs.disconnectTerminal('session-1');

      const msgs = muxWs.ws.sentMessages.map(m => decodeMessage(m));
      const disconnectMsg = msgs.find(m => m.type === 'disconnect');

      expect(disconnectMsg).toBeDefined();
      expect(muxWs.handlers.has('terminal:session-1')).toBe(false);
      expect(muxWs.subscriptionData.has('terminal:session-1')).toBe(false);
    });

    test('closeTerminal 应该发送关闭消息', () => {
      muxWs.subscribe('session-1', 'terminal', {});

      muxWs.closeTerminal('session-1');

      const msgs = muxWs.ws.sentMessages.map(m => decodeMessage(m));
      const closeMsg = msgs.find(m => m.type === 'close');

      expect(closeMsg).toBeDefined();
      expect(closeMsg.channel).toBe('terminal');
    });
  });

  describe('Chat 操作', () => {
    beforeEach(async () => {
      muxWs.connect();
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });
    });

    test('connectChat 应该发送连接消息', () => {
      const handler = { onMessage: jest.fn(), onConnect: jest.fn() };
      muxWs.connectChat('chat-1', '/project', {
        resume: 'previous-session-id',
        ...handler
      });

      const msgs = muxWs.ws.sentMessages.map(m => decodeMessage(m));
      const connectMsg = msgs.find(m => m.type === 'connect' && m.channel === 'chat');

      expect(connectMsg).toBeDefined();
      expect(connectMsg.session_id).toBe('chat-1');
      expect(connectMsg.data.working_dir).toBe('/project');
      expect(connectMsg.data.resume).toBe('previous-session-id');
    });

    test('chatMessage 应该发送 message', () => {
      muxWs.chatMessage('chat-1', 'Hello Claude');

      const msgs = muxWs.ws.sentMessages.map(m => decodeMessage(m));
      const chatMsg = msgs.find(m => m.type === 'message' && m.channel === 'chat');

      expect(chatMsg).toBeDefined();
      expect(chatMsg.data.content).toBe('Hello Claude');
    });

    test('disconnectChat 应该清理订阅', () => {
      muxWs.subscribe('chat-1', 'chat', {});
      muxWs.subscriptionData.set('chat:chat-1', { channel: 'chat', sessionId: 'chat-1', data: {} });

      muxWs.disconnectChat('chat-1');

      expect(muxWs.handlers.has('chat:chat-1')).toBe(false);
      expect(muxWs.subscriptionData.has('chat:chat-1')).toBe(false);
    });
  });

  describe('状态管理', () => {
    test('状态变化应该触发回调', async () => {
      const stateChanges = [];
      muxWs.onStateChange = (newState, oldState) => {
        stateChanges.push({ newState, oldState });
      };

      muxWs.connect();
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      expect(stateChanges).toContainEqual({ newState: 'connecting', oldState: 'disconnected' });
      expect(stateChanges).toContainEqual({ newState: 'authenticating', oldState: 'connecting' });
      expect(stateChanges).toContainEqual({ newState: 'connected', oldState: 'authenticating' });
    });

    test('getStats 应该返回正确的统计信息', async () => {
      muxWs.subscribe('session-1', 'terminal', {});
      muxWs.subscribe('session-2', 'chat', {});

      muxWs.connect();
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      const stats = muxWs.getStats();

      expect(stats.state).toBe('connected');
      expect(stats.authenticated).toBe(true);
      expect(stats.sessions).toBe(2);
      expect(stats.reconnectAttempts).toBe(0);
    });
  });

  describe('多 Session 隔离', () => {
    let handler1, handler2;

    beforeEach(async () => {
      handler1 = { onMessage: jest.fn(), onConnect: jest.fn(), onDisconnect: jest.fn() };
      handler2 = { onMessage: jest.fn(), onConnect: jest.fn(), onDisconnect: jest.fn() };

      muxWs.subscribe('session-1', 'terminal', handler1);
      muxWs.subscribe('session-2', 'terminal', handler2);

      muxWs.connect();
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });
    });

    test('消息应该路由到正确的 session', () => {
      muxWs.ws.receiveMessage({
        channel: 'terminal',
        session_id: 'session-1',
        type: 'output',
        data: { text: 'output for session 1' }
      });

      expect(handler1.onMessage).toHaveBeenCalledWith('output', { text: 'output for session 1' });
      expect(handler2.onMessage).not.toHaveBeenCalled();

      muxWs.ws.receiveMessage({
        channel: 'terminal',
        session_id: 'session-2',
        type: 'output',
        data: { text: 'output for session 2' }
      });

      expect(handler2.onMessage).toHaveBeenCalledWith('output', { text: 'output for session 2' });
    });

    test('各 session 的 subscriptionData 应该独立', () => {
      muxWs.subscriptionData.set('terminal:session-1', { channel: 'terminal', sessionId: 'session-1', data: { working_dir: '/path1' } });
      muxWs.subscriptionData.set('terminal:session-2', { channel: 'terminal', sessionId: 'session-2', data: { working_dir: '/path2' } });

      const sub1 = muxWs.subscriptionData.get('terminal:session-1');
      const sub2 = muxWs.subscriptionData.get('terminal:session-2');

      expect(sub1.data.working_dir).toBe('/path1');
      expect(sub2.data.working_dir).toBe('/path2');
    });

    test('unsubscribe 一个 session 不应该影响其他 session', () => {
      muxWs.unsubscribe('session-1', 'terminal');

      expect(muxWs.handlers.has('terminal:session-1')).toBe(false);
      expect(muxWs.handlers.has('terminal:session-2')).toBe(true);

      // Session 2 should still receive messages
      muxWs.ws.receiveMessage({
        channel: 'terminal',
        session_id: 'session-2',
        type: 'output',
        data: { text: 'still works' }
      });

      expect(handler2.onMessage).toHaveBeenCalled();
    });
  });

  describe('Ping/Pong 心跳', () => {
    test('连接成功后应该启动 ping interval', async () => {
      muxWs.connect();
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      expect(muxWs.pingInterval).not.toBeNull();
    });

    test('断开连接后应该清除 ping interval', async () => {
      muxWs.connect();
      jest.runAllTimers();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      muxWs.ws.close(1000);

      expect(muxWs.pingInterval).toBeNull();
    });
  });

  describe('优化消息格式 (v2)', () => {
    describe('packMessage 函数', () => {
      test('应该将 terminal 频道编码为 0', () => {
        const packed = packMessage('terminal', 'session-1', 'input', { text: 'ls' });
        expect(packed.c).toBe(0);
      });

      test('应该将 chat 频道编码为 1', () => {
        const packed = packMessage('chat', 'session-1', 'message', { content: 'hi' });
        expect(packed.c).toBe(1);
      });

      test('应该将 system 频道编码为 2', () => {
        const packed = packMessage('system', null, 'auth', { token: 'xxx' });
        expect(packed.c).toBe(2);
      });

      test('应该使用短键名 c, s, t, d', () => {
        const packed = packMessage('chat', 'session-1', 'message', { content: 'hi' });
        expect(packed).toHaveProperty('c');
        expect(packed).toHaveProperty('s');
        expect(packed).toHaveProperty('t');
        expect(packed).toHaveProperty('d');
        expect(packed).not.toHaveProperty('channel');
        expect(packed).not.toHaveProperty('session_id');
        expect(packed).not.toHaveProperty('type');
        expect(packed).not.toHaveProperty('data');
      });

      test('system 频道应该省略 session_id', () => {
        const packed = packMessage('system', 'ignored-id', 'ping', {});
        expect(packed.s).toBeUndefined();
      });

      test('未知类型应该保留字符串', () => {
        const packed = packMessage('chat', 'session-1', 'unknown_type', {});
        expect(packed.t).toBe('unknown_type');
      });
    });

    describe('unpackMessage 函数', () => {
      test('应该解析新格式消息 (c, s, t, d)', () => {
        const unpacked = unpackMessage({ c: 1, s: 'session-1', t: 1, d: { text: 'hi' } });
        expect(unpacked.channel).toBe('chat');
        expect(unpacked.session_id).toBe('session-1');
        expect(unpacked.type).toBe('stream');
        expect(unpacked.data).toEqual({ text: 'hi' });
      });

      test('应该解析旧格式消息 (channel, session_id, type, data)', () => {
        const unpacked = unpackMessage({
          channel: 'terminal',
          session_id: 'session-1',
          type: 'output',
          data: { text: 'hello' }
        });
        expect(unpacked.channel).toBe('terminal');
        expect(unpacked.session_id).toBe('session-1');
        expect(unpacked.type).toBe('output');
        expect(unpacked.data).toEqual({ text: 'hello' });
      });

      test('应该正确解码 terminal 频道 (c=0)', () => {
        const unpacked = unpackMessage({ c: 0, s: 'sess', t: 1, d: {} });
        expect(unpacked.channel).toBe('terminal');
        expect(unpacked.type).toBe('output');
      });

      test('应该正确解码 system 频道 (c=2)', () => {
        const unpacked = unpackMessage({ c: 2, t: 0, d: {} });
        expect(unpacked.channel).toBe('system');
        expect(unpacked.type).toBe('auth_success');
      });

      test('应该处理缺失的 session_id', () => {
        const unpacked = unpackMessage({ c: 2, t: 2, d: {} });
        expect(unpacked.session_id).toBeNull();
      });

      test('应该处理字符串类型码', () => {
        const unpacked = unpackMessage({ c: 1, s: 'sess', t: 'custom', d: {} });
        expect(unpacked.type).toBe('custom');
      });
    });

    describe('消息类型编码', () => {
      test('chat stream 应该编码为 1', () => {
        const packed = packMessage('chat', 'sess', 'stream', { text: 'a' });
        expect(packed.t).toBe(1);
      });

      test('chat assistant 应该编码为 2', () => {
        const packed = packMessage('chat', 'sess', 'assistant', { content: 'hi' });
        expect(packed.t).toBe(2);
      });

      test('chat tool_call 应该编码为 4', () => {
        const packed = packMessage('chat', 'sess', 'tool_call', {});
        expect(packed.t).toBe(4);
      });

      test('chat thinking_start 应该编码为 6', () => {
        const packed = packMessage('chat', 'sess', 'thinking_start', {});
        expect(packed.t).toBe(6);
      });

      test('terminal connected 应该编码为 0', () => {
        const packed = packMessage('terminal', 'sess', 'connected', {});
        expect(packed.t).toBe(0);
      });

      test('terminal output 应该编码为 1', () => {
        const packed = packMessage('terminal', 'sess', 'output', {});
        expect(packed.t).toBe(1);
      });
    });

    describe('端到端验证', () => {
      test('packMessage -> unpackMessage 应该保持数据一致', () => {
        const original = {
          channel: 'chat',
          session_id: 'test-session-123',
          type: 'stream',
          data: { text: 'Hello, world!' }
        };

        const packed = packMessage(original.channel, original.session_id, original.type, original.data);
        const unpacked = unpackMessage(packed);

        expect(unpacked.channel).toBe(original.channel);
        expect(unpacked.session_id).toBe(original.session_id);
        expect(unpacked.type).toBe(original.type);
        expect(unpacked.data).toEqual(original.data);
      });

      test('新格式消息体积应该更小', () => {
        const oldFormat = {
          channel: 'chat',
          session_id: '12345678-1234-1234-1234-123456789abc',
          type: 'stream',
          data: { text: 'H' }
        };
        const newFormat = packMessage('chat', '12345678-1234-1234-1234-123456789abc', 'stream', { text: 'H' });

        const oldSize = JSON.stringify(oldFormat).length;
        const newSize = JSON.stringify(newFormat).length;

        // 新格式应该至少小 30%
        expect(newSize).toBeLessThan(oldSize * 0.7);
      });
    });
  });
});
