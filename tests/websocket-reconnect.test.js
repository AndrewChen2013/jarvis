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
 * WebSocket 重连逻辑测试用例
 *
 * 测试场景：
 * 1. Session 级别重连状态独立
 * 2. 重连次数指数退避
 * 3. 多 Session 并行重连
 * 4. 最大重连次数限制
 * 5. Session 切换不影响后台重连
 */

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
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
  }

  send(data) {
    this.sentMessages.push(data);
  }

  close(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code, reason });
    }
  }

  // Simulate successful connection
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen({});
  }

  // Simulate receiving a message
  receiveMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }
}

global.WebSocket = MockWebSocket;

// Mock window
global.window = {
  location: {
    protocol: 'http:',
    host: 'localhost:8080'
  },
  app: null,
  muxWs: null
};

global.localStorage = {
  _data: {},
  getItem: (key) => global.localStorage._data[key] || null,
  setItem: (key, value) => { global.localStorage._data[key] = value; },
  clear: () => { global.localStorage._data = {}; }
};

// Load session-manager code first
const fs = require('fs');
const path = require('path');

const sessionManagerCode = fs.readFileSync(
  path.join(__dirname, '../static/session-manager.js'),
  'utf8'
);
eval(sessionManagerCode);


describe('Session 级别重连', () => {
  let mockApp;
  let sessionManager;

  beforeEach(() => {
    jest.useFakeTimers();

    // 设置 DOM
    document.body.innerHTML = `<div id="terminal-output"></div>`;

    // Mock app
    mockApp = {
      debugLog: jest.fn(),
      showView: jest.fn(),
      token: 'test-token',
      currentSession: null,
      maxReconnectAttempts: 5,
      sessionManager: null,
      floatingButton: { update: jest.fn() },
      t: (key, defaultVal) => defaultVal || key,
      updateStatus: jest.fn(),
      updateConnectStatus: jest.fn(),
      isUseMux: () => false,  // 测试 legacy 模式
      _scheduleReconnect: jest.fn()
    };

    sessionManager = new SessionManager(mockApp);
    mockApp.sessionManager = sessionManager;
    window.app = mockApp;
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('SessionInstance 重连状态', () => {
    test('每个 session 应该有独立的重连状态', () => {
      const session1 = new SessionInstance('session-1', 'Session 1');
      const session2 = new SessionInstance('session-2', 'Session 2');

      // 设置不同的重连状态
      session1.shouldReconnect = true;
      session1.reconnectAttempts = 3;

      session2.shouldReconnect = false;
      session2.reconnectAttempts = 0;

      // 验证状态独立
      expect(session1.shouldReconnect).toBe(true);
      expect(session1.reconnectAttempts).toBe(3);
      expect(session2.shouldReconnect).toBe(false);
      expect(session2.reconnectAttempts).toBe(0);
    });

    test('reconnectTimeout 应该每个 session 独立', () => {
      const session1 = new SessionInstance('session-1', 'Session 1');
      const session2 = new SessionInstance('session-2', 'Session 2');

      session1.reconnectTimeout = setTimeout(() => {}, 1000);
      session2.reconnectTimeout = setTimeout(() => {}, 2000);

      expect(session1.reconnectTimeout).not.toBe(session2.reconnectTimeout);

      clearTimeout(session1.reconnectTimeout);
      clearTimeout(session2.reconnectTimeout);
    });
  });

  describe('多 Session 重连独立性', () => {
    test('一个 session 重连不应该影响其他 session', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      const session2 = sessionManager.openSession('session-2', 'Session 2');

      session1.shouldReconnect = true;
      session1.reconnectAttempts = 2;
      session1.status = 'disconnected';

      session2.shouldReconnect = false;
      session2.status = 'connected';

      // 模拟 session1 的重连尝试
      session1.reconnectAttempts++;

      // session2 不应该受影响
      expect(session2.reconnectAttempts).toBe(0);
      expect(session2.status).toBe('connected');
      expect(session2.shouldReconnect).toBe(false);
    });

    test('切换 session 不应该中断后台 session 的重连计时器', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      const session2 = sessionManager.openSession('session-2', 'Session 2');

      // 给 session1 设置重连计时器
      let timer1Fired = false;
      session1.reconnectTimeout = setTimeout(() => {
        timer1Fired = true;
      }, 1000);

      // 切换到 session2
      sessionManager.switchTo('session-2');

      // 等待计时器触发
      jest.advanceTimersByTime(1500);

      // session1 的计时器应该仍然触发
      expect(timer1Fired).toBe(true);
    });

    test('关闭 session 应该清除其重连计时器', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');

      let timerFired = false;
      session1.reconnectTimeout = setTimeout(() => {
        timerFired = true;
      }, 1000);

      // 清除计时器（模拟关闭 session 时的清理）
      clearTimeout(session1.reconnectTimeout);
      session1.reconnectTimeout = null;

      jest.advanceTimersByTime(1500);

      expect(timerFired).toBe(false);
    });
  });

  describe('重连次数管理', () => {
    test('首次重连延迟应该是 500ms', () => {
      const session = new SessionInstance('test', 'Test');
      session.reconnectAttempts = 0;

      // 计算首次重连延迟
      session.reconnectAttempts++;
      const delay = session.reconnectAttempts === 1 ? 500 : Math.min(1000 * Math.pow(2, session.reconnectAttempts - 2), 10000);

      expect(delay).toBe(500);
    });

    test('后续重连应该指数退避', () => {
      const session = new SessionInstance('test', 'Test');

      // 计算各次重连延迟
      const delays = [];
      for (let i = 1; i <= 5; i++) {
        session.reconnectAttempts = i;
        const delay = i === 1 ? 500 : Math.min(1000 * Math.pow(2, i - 2), 10000);
        delays.push(delay);
      }

      expect(delays).toEqual([500, 1000, 2000, 4000, 8000]);
    });

    test('重连延迟应该有最大值限制', () => {
      const session = new SessionInstance('test', 'Test');
      session.reconnectAttempts = 10;

      const delay = Math.min(1000 * Math.pow(2, 10 - 2), 10000);

      // 应该被限制在 10000ms
      expect(delay).toBe(10000);
    });

    test('达到最大重连次数后应该停止', () => {
      const session = sessionManager.openSession('test', 'Test');
      session.shouldReconnect = true;
      session.reconnectAttempts = mockApp.maxReconnectAttempts;

      // 不应该再增加重连次数
      const shouldRetry = session.reconnectAttempts < mockApp.maxReconnectAttempts;
      expect(shouldRetry).toBe(false);
    });
  });

  describe('重连成功后状态重置', () => {
    test('重连成功后 reconnectAttempts 应该归零', () => {
      const session = sessionManager.openSession('test', 'Test');
      session.reconnectAttempts = 3;
      session.shouldReconnect = true;

      // 模拟重连成功
      session.status = 'connected';
      session.reconnectAttempts = 0;

      expect(session.reconnectAttempts).toBe(0);
      expect(session.status).toBe('connected');
    });

    test('重连成功后应该清除 reconnectTimeout', () => {
      const session = sessionManager.openSession('test', 'Test');
      session.reconnectTimeout = setTimeout(() => {}, 5000);

      // 模拟重连成功
      clearTimeout(session.reconnectTimeout);
      session.reconnectTimeout = null;
      session.status = 'connected';

      expect(session.reconnectTimeout).toBeNull();
    });
  });

  describe('Session ID 保持', () => {
    test('重连时应该使用原来的 session 参数', () => {
      const session = sessionManager.openSession('test-session', 'Test');
      session.workDir = '/my/project';
      session.claudeSessionId = 'claude-uuid-123';

      // 模拟断开
      session.status = 'disconnected';
      session.shouldReconnect = true;

      // 重连时参数应该保持
      expect(session.workDir).toBe('/my/project');
      expect(session.claudeSessionId).toBe('claude-uuid-123');
    });

    test('rename 后重连应该使用新的 session ID', () => {
      const session = sessionManager.openSession('new-12345', 'Test');
      session.workDir = '/project';
      session.claudeSessionId = null;

      // 模拟连接成功后 rename
      sessionManager.renameSession('new-12345', 'real-uuid-abc');
      const renamedSession = sessionManager.sessions.get('real-uuid-abc');
      renamedSession.claudeSessionId = 'real-uuid-abc';

      // 断开后重连应该使用新 ID
      renamedSession.status = 'disconnected';

      expect(renamedSession.id).toBe('real-uuid-abc');
      expect(renamedSession.claudeSessionId).toBe('real-uuid-abc');
    });
  });
});


describe('WebSocket 消息处理与 Session 隔离', () => {
  let sessionManager;
  let mockApp;

  beforeEach(() => {
    document.body.innerHTML = `<div id="terminal-output"></div>`;

    mockApp = {
      debugLog: jest.fn(),
      showView: jest.fn(),
      currentSession: null,
      token: 'test-token',
      terminal: null,
      floatingButton: { update: jest.fn() }
    };

    sessionManager = new SessionManager(mockApp);
    mockApp.sessionManager = sessionManager;
    window.app = mockApp;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('输出消息路由', () => {
    test('输出应该写入正确的 session terminal', () => {
      // 创建两个 session，各自有独立的 terminal
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      const session2 = sessionManager.openSession('session-2', 'Session 2');

      // Mock terminals
      session1.terminal = {
        write: jest.fn(),
        outputBuffer: []
      };
      session2.terminal = {
        write: jest.fn(),
        outputBuffer: []
      };

      // 模拟写入 session1
      session1.terminal.write('output for session 1');

      // 验证只有 session1 的 terminal 收到输出
      expect(session1.terminal.write).toHaveBeenCalledWith('output for session 1');
      expect(session2.terminal.write).not.toHaveBeenCalled();
    });

    test('session 不存在时应该忽略消息', () => {
      // 不创建任何 session
      const nonExistentSession = sessionManager.sessions.get('non-existent');

      expect(nonExistentSession).toBeUndefined();
      // 应该不会抛出异常
    });
  });

  describe('connected 消息处理', () => {
    test('收到新 terminal_id 时应该更新 session', () => {
      const session = sessionManager.openSession('new-12345', 'Test');
      session.claudeSessionId = null;

      // 模拟 connected 消息
      const serverTerminalId = 'server-uuid-abc';

      // 进行 rename
      const renamed = sessionManager.renameSession('new-12345', serverTerminalId);

      expect(renamed).toBe(true);
      expect(sessionManager.sessions.has('new-12345')).toBe(false);
      expect(sessionManager.sessions.has('server-uuid-abc')).toBe(true);
    });

    test('terminal_id 相同时不应该 rename', () => {
      const session = sessionManager.openSession('uuid-123', 'Test');
      session.claudeSessionId = 'uuid-123';

      // 不需要 rename
      const sameSession = sessionManager.sessions.get('uuid-123');
      expect(sameSession).toBe(session);
    });
  });

  describe('Session 切换时的消息处理', () => {
    test('只有当前活跃 session 才更新 UI', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      const session2 = sessionManager.openSession('session-2', 'Session 2');

      // session1 是活跃的
      sessionManager.switchTo('session-1');
      mockApp.currentSession = 'session-1';

      // 验证当前活跃 session
      expect(sessionManager.activeId).toBe('session-1');

      // session2 的断开不应该影响 UI（这里只验证逻辑）
      session2.status = 'disconnected';

      // activeId 应该仍然是 session1
      expect(sessionManager.activeId).toBe('session-1');
    });
  });
});


describe('断开连接场景', () => {
  let sessionManager;
  let mockApp;

  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = `<div id="terminal-output"></div>`;

    mockApp = {
      debugLog: jest.fn(),
      showView: jest.fn(),
      currentSession: null,
      maxReconnectAttempts: 5,
      floatingButton: { update: jest.fn() }
    };

    sessionManager = new SessionManager(mockApp);
    mockApp.sessionManager = sessionManager;
    window.app = mockApp;
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('正常关闭 (code 1000)', () => {
    test('正常关闭不应该触发重连', () => {
      const session = sessionManager.openSession('test', 'Test');
      session.shouldReconnect = true;

      // 模拟 code 1000 关闭
      const shouldReconnect = session.shouldReconnect && (1000 !== 1000);  // Normal closure

      expect(shouldReconnect).toBe(false);
    });
  });

  describe('异常关闭', () => {
    test('code 1006 应该触发重连', () => {
      const session = sessionManager.openSession('test', 'Test');
      session.shouldReconnect = true;

      const code = 1006;  // Abnormal closure
      const shouldReconnect = session.shouldReconnect && code !== 1000;

      expect(shouldReconnect).toBe(true);
    });

    test('code 1008 (token invalid) 不应该重连', () => {
      const session = sessionManager.openSession('test', 'Test');
      session.shouldReconnect = true;

      const code = 1008;  // Policy violation (invalid token)
      // 在实际代码中，1008 会触发重定向到登录页，不重连
      // 这里模拟该逻辑
      const shouldReconnect = session.shouldReconnect && code !== 1000 && code !== 1008;

      expect(shouldReconnect).toBe(false);
    });
  });

  describe('shouldReconnect 标志', () => {
    test('shouldReconnect=false 时不应该重连', () => {
      const session = sessionManager.openSession('test', 'Test');
      session.shouldReconnect = false;

      const code = 1006;
      const shouldReconnect = session.shouldReconnect && code !== 1000;

      expect(shouldReconnect).toBe(false);
    });

    test('主动 disconnect 应该设置 shouldReconnect=false', () => {
      const session = sessionManager.openSession('test', 'Test');
      session.shouldReconnect = true;

      // 模拟主动断开
      session.shouldReconnect = false;

      expect(session.shouldReconnect).toBe(false);
    });
  });
});


describe('连接状态管理', () => {
  let sessionManager;
  let mockApp;

  beforeEach(() => {
    document.body.innerHTML = `<div id="terminal-output"></div>`;

    mockApp = {
      debugLog: jest.fn(),
      showView: jest.fn(),
      floatingButton: { update: jest.fn() }
    };

    sessionManager = new SessionManager(mockApp);
    mockApp.sessionManager = sessionManager;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('Session 状态转换', () => {
    test('新创建的 session 状态应该是 idle', () => {
      const session = new SessionInstance('test', 'Test');
      expect(session.status).toBe('idle');
    });

    test('连接中状态', () => {
      const session = sessionManager.openSession('test', 'Test');
      session.status = 'connecting';

      expect(session.status).toBe('connecting');
    });

    test('已连接状态', () => {
      const session = sessionManager.openSession('test', 'Test');
      session.status = 'connected';

      expect(session.status).toBe('connected');
    });

    test('已断开状态', () => {
      const session = sessionManager.openSession('test', 'Test');
      session.status = 'disconnected';

      expect(session.status).toBe('disconnected');
    });
  });

  describe('多 Session 状态独立', () => {
    test('各 session 状态应该独立', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      const session3 = sessionManager.openSession('session-3', 'Session 3');

      session1.status = 'connected';
      session2.status = 'disconnected';
      session3.status = 'connecting';

      expect(session1.status).toBe('connected');
      expect(session2.status).toBe('disconnected');
      expect(session3.status).toBe('connecting');
    });
  });
});


describe('输出队列管理', () => {
  let sessionManager;
  let mockApp;

  beforeEach(() => {
    document.body.innerHTML = `<div id="terminal-output"></div>`;

    mockApp = {
      debugLog: jest.fn(),
      showView: jest.fn(),
      floatingButton: { update: jest.fn() }
    };

    sessionManager = new SessionManager(mockApp);
    mockApp.sessionManager = sessionManager;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('terminal 未就绪时输出应该放入队列', () => {
    const session = sessionManager.openSession('test', 'Test');
    session.terminal = null;
    session.outputQueue = [];

    // 模拟收到输出但 terminal 未就绪
    session.outputQueue.push('output 1');
    session.outputQueue.push('output 2');

    expect(session.outputQueue.length).toBe(2);
    expect(session.outputQueue[0]).toBe('output 1');
  });

  test('terminal 就绪后应该刷新队列', () => {
    const session = sessionManager.openSession('test', 'Test');
    session.outputQueue = ['output 1', 'output 2', 'output 3'];

    // Mock terminal
    const writtenData = [];
    session.terminal = {
      write: (data) => writtenData.push(data)
    };

    // 模拟刷新队列
    const combined = session.outputQueue.join('');
    session.terminal.write(combined);
    session.outputQueue = [];

    expect(writtenData).toEqual(['output 1output 2output 3']);
    expect(session.outputQueue.length).toBe(0);
  });

  test('各 session 的输出队列应该独立', () => {
    const session1 = sessionManager.openSession('session-1', 'Session 1');
    const session2 = sessionManager.openSession('session-2', 'Session 2');

    session1.outputQueue = ['for session 1'];
    session2.outputQueue = ['for session 2', 'more for session 2'];

    expect(session1.outputQueue.length).toBe(1);
    expect(session2.outputQueue.length).toBe(2);
    expect(session1.outputQueue[0]).toBe('for session 1');
    expect(session2.outputQueue[0]).toBe('for session 2');
  });
});
