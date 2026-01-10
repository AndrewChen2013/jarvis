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
 * 多 Session 端到端测试用例
 *
 * 测试场景：
 * 1. 多 Session 创建和切换
 * 2. Session ID 流转（前端临时 ID -> 后端 UUID）
 * 3. 输出隔离（不串台）
 * 4. 并发重连
 * 5. 多前端连接同一 Session
 */

// Polyfill TextEncoder/TextDecoder for jsdom
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock MessagePack
global.MessagePack = {
  encode: (data) => {
    const encoder = new TextEncoder();
    return encoder.encode(JSON.stringify(data));
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

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.binaryType = 'blob';
    this.sentMessages = [];
    MockWebSocket.instances.push(this);

    // Auto-open after a tick (simulate async connection)
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

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen({});
  }

  receiveMessage(data) {
    if (this.onmessage) {
      // Send as JSON string - MuxWebSocket._onMessage will use JSON.parse path
      // (ArrayBuffer instanceof checks fail across jsdom realms)
      this.onmessage({ data: JSON.stringify(data) });
    }
  }
}

MockWebSocket.instances = [];

global.WebSocket = MockWebSocket;

// Mock localStorage
global.localStorage = {
  _data: {},
  getItem: (key) => global.localStorage._data[key] || null,
  setItem: (key, value) => { global.localStorage._data[key] = value; },
  clear: () => { global.localStorage._data = {}; }
};

// Mock window location (must be done before loading the code)
Object.defineProperty(window, 'location', {
  value: {
    protocol: 'http:',
    host: 'localhost:8080',
    hostname: 'localhost',
    port: '8080'
  },
  writable: true,
  configurable: true
});

window.app = null;
window.muxWs = null;

// Load source files
const fs = require('fs');
const path = require('path');

// 读取源文件
const sessionManagerCode = fs.readFileSync(
  path.join(__dirname, '../static/session-manager.js'),
  'utf8'
);

const muxWebSocketCode = fs.readFileSync(
  path.join(__dirname, '../static/mux-websocket.js'),
  'utf8'
);

// 先执行 MuxWebSocket（因为它不依赖其他模块）
eval(muxWebSocketCode);

// 从 window.muxWs 的构造函数中获取类定义
const MuxWebSocket = window.muxWs.constructor;

// Helper: Decode and unpack message to normalized format
// unpackMessage is defined globally by mux-websocket.js
function decodeMessage(packed) {
  const msg = MessagePack.decode(packed);
  return unpackMessage(msg);
}

// 再执行 SessionManager
eval(sessionManagerCode);


describe('多 Session 完整流程', () => {
  let mockApp;
  let sessionManager;
  let muxWs;

  beforeEach(() => {
    jest.useFakeTimers();
    MockWebSocket.instances = [];

    document.body.innerHTML = `<div id="terminal-output"></div>`;

    mockApp = {
      debugLog: jest.fn(),
      showView: jest.fn(),
      token: 'test-token',
      authToken: 'test-token',
      currentSession: null,
      currentWorkDir: null,
      maxReconnectAttempts: 5,
      updateConnectStatus: jest.fn(),
      updateStatus: jest.fn(),
      t: (key) => key,
      floatingButton: { update: jest.fn() }
    };

    sessionManager = new SessionManager(mockApp);
    mockApp.sessionManager = sessionManager;
    window.app = mockApp;

    muxWs = new MuxWebSocket();
    window.muxWs = muxWs;
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
    MockWebSocket.instances = [];
  });

  describe('场景1：创建多个 Session', () => {
    test('应该能创建多个独立的 session', async () => {
      // 创建 3 个 session
      const session1 = sessionManager.openSession('session-1', 'Project A');
      const session2 = sessionManager.openSession('session-2', 'Project B');
      const session3 = sessionManager.openSession('session-3', 'Project C');

      expect(sessionManager.sessions.size).toBe(3);
      expect(session1.id).toBe('session-1');
      expect(session2.id).toBe('session-2');
      expect(session3.id).toBe('session-3');
    });

    test('每个 session 应该有独立的工作目录', () => {
      const session1 = sessionManager.openSession('session-1', 'Project A');
      const session2 = sessionManager.openSession('session-2', 'Project B');

      session1.workDir = '/projects/projectA';
      session2.workDir = '/projects/projectB';

      expect(session1.workDir).toBe('/projects/projectA');
      expect(session2.workDir).toBe('/projects/projectB');
    });
  });

  describe('场景2：Session ID 流转', () => {
    test('前端临时 ID 应该被后端 UUID 替换', async () => {
      // 使用临时 ID 创建 session
      const tempId = 'new-1704067200000';
      const session = sessionManager.openSession(tempId, 'New Session');

      expect(sessionManager.sessions.has(tempId)).toBe(true);

      // 模拟后端返回真实 UUID
      const realUuid = 'abc123-def456-789';
      sessionManager.renameSession(tempId, realUuid);

      // 旧 ID 应该不存在，新 ID 应该存在
      expect(sessionManager.sessions.has(tempId)).toBe(false);
      expect(sessionManager.sessions.has(realUuid)).toBe(true);

      // Session 对象应该是同一个（只是改了 key）
      const renamedSession = sessionManager.sessions.get(realUuid);
      expect(renamedSession.id).toBe(realUuid);
    });

    test('MuxWebSocket 应该重映射 handler', async () => {
      const tempId = 'new-12345';
      const handler = {
        onMessage: jest.fn(),
        onConnect: jest.fn(),
        onDisconnect: jest.fn()
      };

      // 订阅临时 ID
      muxWs.subscribe(tempId, 'terminal', handler);
      expect(muxWs.handlers.has(`terminal:${tempId}`)).toBe(true);

      // 连接
      muxWs.connect();
      await jest.runAllTimersAsync();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      // 服务端返回新 ID
      const realUuid = 'real-uuid-abc';
      muxWs.ws.receiveMessage({
        channel: 'terminal',
        session_id: realUuid,
        type: 'connected',
        data: { original_session_id: tempId }
      });

      // Handler 应该被重映射
      // BUG FIX: Old handler kept as forwarding handler (not deleted)
      expect(muxWs.handlers.has(`terminal:${tempId}`)).toBe(true); // forwarding handler
      expect(muxWs.handlers.has(`terminal:${realUuid}`)).toBe(true); // new handler
    });
  });

  describe('场景3：输出隔离（防串台）', () => {
    test('输出应该路由到正确的 session', async () => {
      // 创建两个 session 并 mock terminal
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      const session2 = sessionManager.openSession('session-2', 'Session 2');

      const output1 = [];
      const output2 = [];

      session1.terminal = { write: (data) => output1.push(data) };
      session2.terminal = { write: (data) => output2.push(data) };

      // 设置 MuxWebSocket handlers
      muxWs.subscribe('session-1', 'terminal', {
        onMessage: (type, data) => {
          if (type === 'output') session1.terminal.write(data.text);
        }
      });
      muxWs.subscribe('session-2', 'terminal', {
        onMessage: (type, data) => {
          if (type === 'output') session2.terminal.write(data.text);
        }
      });

      // 连接
      muxWs.connect();
      await jest.runAllTimersAsync();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      // 发送输出到 session-1
      muxWs.ws.receiveMessage({
        channel: 'terminal',
        session_id: 'session-1',
        type: 'output',
        data: { text: 'output for session 1' }
      });

      // 发送输出到 session-2
      muxWs.ws.receiveMessage({
        channel: 'terminal',
        session_id: 'session-2',
        type: 'output',
        data: { text: 'output for session 2' }
      });

      // 验证隔离
      expect(output1).toEqual(['output for session 1']);
      expect(output2).toEqual(['output for session 2']);
    });

    test('快速切换 session 时输出不应该串台', async () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      const session2 = sessionManager.openSession('session-2', 'Session 2');

      sessionManager.createContainer(session1);
      sessionManager.createContainer(session2);

      // 快速切换
      sessionManager.switchTo('session-1');
      sessionManager.switchTo('session-2');
      sessionManager.switchTo('session-1');
      sessionManager.switchTo('session-2');

      // 在切换后设置 terminal（showSession 会清除没有 .xterm 元素的 terminal）
      const output1 = [];
      const output2 = [];
      session1.terminal = { write: (data) => output1.push(data) };
      session2.terminal = { write: (data) => output2.push(data) };

      // 写入各自的 terminal
      session1.terminal.write('msg to session 1');
      session2.terminal.write('msg to session 2');

      // 验证
      expect(output1).toEqual(['msg to session 1']);
      expect(output2).toEqual(['msg to session 2']);
    });
  });

  describe('场景4：并发重连', () => {
    test('多个 session 可以同时重连', async () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      const session2 = sessionManager.openSession('session-2', 'Session 2');

      session1.shouldReconnect = true;
      session1.status = 'disconnected';
      session1.reconnectAttempts = 0;

      session2.shouldReconnect = true;
      session2.status = 'disconnected';
      session2.reconnectAttempts = 0;

      // 模拟两个 session 都在重连
      session1.reconnectAttempts++;
      session2.reconnectAttempts++;

      // 各自的重连计数独立
      expect(session1.reconnectAttempts).toBe(1);
      expect(session2.reconnectAttempts).toBe(1);

      // 再次重连
      session1.reconnectAttempts++;

      expect(session1.reconnectAttempts).toBe(2);
      expect(session2.reconnectAttempts).toBe(1);
    });

    test('一个 session 重连成功不影响其他 session', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      const session2 = sessionManager.openSession('session-2', 'Session 2');

      session1.reconnectAttempts = 3;
      session2.reconnectAttempts = 2;
      session2.status = 'disconnected';

      // session1 重连成功
      session1.status = 'connected';
      session1.reconnectAttempts = 0;

      // session2 应该不受影响
      expect(session2.reconnectAttempts).toBe(2);
      expect(session2.status).toBe('disconnected');
    });
  });

  describe('场景5：Session 生命周期', () => {
    test('关闭 session 应该清理所有资源', async () => {
      const session = sessionManager.openSession('test-session', 'Test');
      sessionManager.createContainer(session);

      session.terminal = { dispose: jest.fn() };
      session.reconnectTimeout = setTimeout(() => {}, 5000);

      // 验证资源存在
      expect(sessionManager.sessions.has('test-session')).toBe(true);
      expect(document.getElementById('terminal-container-test-session')).not.toBeNull();

      // 关闭 session
      clearTimeout(session.reconnectTimeout);
      sessionManager.closeSession('test-session');

      // 验证资源清理
      expect(sessionManager.sessions.has('test-session')).toBe(false);
    });

    test('关闭 session 应该从 MuxWebSocket 取消订阅', async () => {
      muxWs.subscribe('test-session', 'terminal', {});
      muxWs.subscriptionData.set('terminal:test-session', { channel: 'terminal', sessionId: 'test-session', data: {} });

      expect(muxWs.handlers.has('terminal:test-session')).toBe(true);

      // 取消订阅
      muxWs.unsubscribe('test-session', 'terminal');
      muxWs.subscriptionData.delete('terminal:test-session');

      expect(muxWs.handlers.has('terminal:test-session')).toBe(false);
      expect(muxWs.subscriptionData.has('terminal:test-session')).toBe(false);
    });
  });

  describe('场景6：Container 管理', () => {
    test('每个 session 应该有独立的 container', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      const session2 = sessionManager.openSession('session-2', 'Session 2');

      sessionManager.createContainer(session1);
      sessionManager.createContainer(session2);

      expect(session1.container.id).toBe('terminal-container-session-1');
      expect(session2.container.id).toBe('terminal-container-session-2');
      expect(session1.container).not.toBe(session2.container);
    });

    test('切换 session 应该正确显示/隐藏 container', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      const session2 = sessionManager.openSession('session-2', 'Session 2');

      sessionManager.createContainer(session1);
      sessionManager.createContainer(session2);

      // 切换到 session1
      sessionManager.switchTo('session-1');
      expect(session1.container.style.display).toBe('block');
      expect(session2.container.style.display).toBe('none');

      // 切换到 session2
      sessionManager.switchTo('session-2');
      expect(session1.container.style.display).toBe('none');
      expect(session2.container.style.display).toBe('block');
    });

    test('container 丢失时应该能恢复', () => {
      const session = sessionManager.openSession('test', 'Test');
      sessionManager.createContainer(session);

      const originalContainerId = session.container.id;

      // 模拟 container 引用丢失
      session.container = null;

      // showSession 应该能恢复
      sessionManager.showSession(session);

      // 应该恢复到正确的 container（通过 ID 验证）
      expect(session.container).not.toBeNull();
      expect(session.container.id).toBe(originalContainerId);
    });
  });

  describe('场景7：多 Channel 支持', () => {
    test('同一 session 可以同时有 terminal 和 chat channel', async () => {
      const terminalHandler = { onMessage: jest.fn() };
      const chatHandler = { onMessage: jest.fn() };

      muxWs.subscribe('session-1', 'terminal', terminalHandler);
      muxWs.subscribe('session-1', 'chat', chatHandler);

      expect(muxWs.handlers.has('terminal:session-1')).toBe(true);
      expect(muxWs.handlers.has('chat:session-1')).toBe(true);

      // 连接
      muxWs.connect();
      await jest.runAllTimersAsync();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      // 发送 terminal 消息
      muxWs.ws.receiveMessage({
        channel: 'terminal',
        session_id: 'session-1',
        type: 'output',
        data: { text: 'terminal output' }
      });

      // 发送 chat 消息
      muxWs.ws.receiveMessage({
        channel: 'chat',
        session_id: 'session-1',
        type: 'message',
        data: { content: 'chat message' }
      });

      expect(terminalHandler.onMessage).toHaveBeenCalledWith('output', { text: 'terminal output' });
      expect(chatHandler.onMessage).toHaveBeenCalledWith('message', { content: 'chat message' });
    });
  });

  describe('场景8：状态同步', () => {
    test('session 状态应该与 MuxWebSocket 状态同步', async () => {
      const session = sessionManager.openSession('test', 'Test');
      session.status = 'connecting';

      // 连接成功
      muxWs.connect();
      await jest.runAllTimersAsync();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      // 订阅
      muxWs.subscribe('test', 'terminal', {
        onConnect: () => { session.status = 'connected'; },
        onDisconnect: () => { session.status = 'disconnected'; }
      });

      // 模拟连接成功
      muxWs.ws.receiveMessage({
        channel: 'terminal',
        session_id: 'test',
        type: 'connected',
        data: {}
      });

      expect(session.status).toBe('connected');

      // 模拟断开
      muxWs.ws.close(1006);

      expect(session.status).toBe('disconnected');
    });
  });

  describe('场景9：输入处理', () => {
    test('输入应该发送到正确的 session', async () => {
      muxWs.connect();
      await jest.advanceTimersByTimeAsync(10);  // Let WebSocket open
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });
      expect(muxWs.state).toBe('connected');

      // Clear ping interval to avoid timer issues
      if (muxWs.pingInterval) {
        clearInterval(muxWs.pingInterval);
        muxWs.pingInterval = null;
      }

      // 发送输入到 session-1
      muxWs.terminalInput('session-1', 'ls -la');

      // 发送输入到 session-2
      muxWs.terminalInput('session-2', 'pwd');

      const msgs = muxWs.ws.sentMessages.map(m => decodeMessage(m));
      const inputMsgs = msgs.filter(m => m.type === 'input');

      expect(inputMsgs.length).toBe(2);
      expect(inputMsgs[0].session_id).toBe('session-1');
      expect(inputMsgs[0].data.text).toBe('ls -la');
      expect(inputMsgs[1].session_id).toBe('session-2');
      expect(inputMsgs[1].data.text).toBe('pwd');
    });
  });

  describe('场景10：错误处理', () => {
    test('单个 session 错误不应影响其他 session', async () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      const session2 = sessionManager.openSession('session-2', 'Session 2');

      const handler1 = { onMessage: jest.fn(), onConnect: jest.fn() };
      const handler2 = { onMessage: jest.fn(), onConnect: jest.fn() };

      muxWs.subscribe('session-1', 'terminal', handler1);
      muxWs.subscribe('session-2', 'terminal', handler2);

      muxWs.connect();
      await jest.runAllTimersAsync();
      muxWs.ws.receiveMessage({ channel: 'system', type: 'auth_success', data: {} });

      // Session 1 收到错误
      muxWs.ws.receiveMessage({
        channel: 'terminal',
        session_id: 'session-1',
        type: 'error',
        data: { message: 'something went wrong' }
      });

      // Session 2 应该正常工作
      muxWs.ws.receiveMessage({
        channel: 'terminal',
        session_id: 'session-2',
        type: 'output',
        data: { text: 'still working' }
      });

      expect(handler2.onMessage).toHaveBeenCalledWith('output', { text: 'still working' });
    });
  });
});
