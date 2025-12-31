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
 * Session Manager 测试用例
 * 测试多 session 切换时不会串台
 */

// 加载被测试的模块
const fs = require('fs');
const path = require('path');

// 读取源文件并执行
const sessionManagerCode = fs.readFileSync(
  path.join(__dirname, '../static/session-manager.js'),
  'utf8'
);

// 在测试环境中执行代码
eval(sessionManagerCode);

describe('SessionManager', () => {
  let sessionManager;
  let mockApp;

  beforeEach(() => {
    // 设置 DOM 环境
    document.body.innerHTML = `
      <div id="terminal-output"></div>
    `;

    // Mock app 对象
    mockApp = {
      debugLog: jest.fn(),
      showView: jest.fn(),
      floatingButton: {
        update: jest.fn()
      }
    };

    sessionManager = new SessionManager(mockApp);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('SessionInstance', () => {
    test('应该有独立的连接参数字段', () => {
      const session = new SessionInstance('session-1', 'Test Session');

      expect(session.workDir).toBeNull();
      expect(session.claudeSessionId).toBeNull();
      expect(session.shouldReconnect).toBe(false);
      expect(session.reconnectAttempts).toBe(0);
      expect(session.reconnectTimeout).toBeNull();
    });

    test('每个 session 应该有独立的状态', () => {
      const session1 = new SessionInstance('session-1', 'Session 1');
      const session2 = new SessionInstance('session-2', 'Session 2');

      session1.workDir = '/path/to/project1';
      session1.claudeSessionId = 'claude-id-1';
      session1.shouldReconnect = true;

      session2.workDir = '/path/to/project2';
      session2.claudeSessionId = 'claude-id-2';
      session2.shouldReconnect = false;

      // 验证两个 session 的状态互不影响
      expect(session1.workDir).toBe('/path/to/project1');
      expect(session2.workDir).toBe('/path/to/project2');
      expect(session1.claudeSessionId).toBe('claude-id-1');
      expect(session2.claudeSessionId).toBe('claude-id-2');
      expect(session1.shouldReconnect).toBe(true);
      expect(session2.shouldReconnect).toBe(false);
    });
  });

  describe('Session 切换 - 防止串台', () => {
    let session1, session2;

    beforeEach(() => {
      // 创建两个 session 并各自创建 container
      session1 = sessionManager.openSession('session-1', 'Session 1');
      sessionManager.createContainer(session1);
      session1.container.innerHTML = '<div class="terminal">Terminal 1 Content</div>';

      session2 = sessionManager.openSession('session-2', 'Session 2');
      sessionManager.createContainer(session2);
      session2.container.innerHTML = '<div class="terminal">Terminal 2 Content</div>';
    });

    test('切换到 session1 时，只有 session1 的 container 显示', () => {
      sessionManager.switchTo('session-1');

      expect(session1.container.style.display).toBe('block');
      expect(session2.container.style.display).toBe('none');
    });

    test('切换到 session2 时，只有 session2 的 container 显示', () => {
      sessionManager.switchTo('session-2');

      expect(session1.container.style.display).toBe('none');
      expect(session2.container.style.display).toBe('block');
    });

    test('快速来回切换不应该串台', () => {
      // 模拟快速切换
      sessionManager.switchTo('session-1');
      sessionManager.switchTo('session-2');
      sessionManager.switchTo('session-1');
      sessionManager.switchTo('session-2');
      sessionManager.switchTo('session-1');

      // 最终应该显示 session1
      expect(session1.container.style.display).toBe('block');
      expect(session2.container.style.display).toBe('none');
      expect(sessionManager.activeId).toBe('session-1');
    });

    test('container 引用过期时应该能正确恢复', () => {
      // 模拟 container 引用过期（设为 null）
      session1.container = null;

      // 但 DOM 中的 container 仍然存在
      const containerInDOM = document.getElementById('terminal-container-session-1');
      expect(containerInDOM).not.toBeNull();

      // 切换到 session1
      sessionManager.switchTo('session-1');

      // showSession 应该通过 ID 找到正确的 container 并恢复引用
      expect(session1.container).toBe(containerInDOM);
      expect(session1.container.style.display).toBe('block');
    });

    test('container 引用指向错误元素时应该修正', () => {
      // 模拟 container 引用指向了错误的元素
      const wrongContainer = document.createElement('div');
      wrongContainer.id = 'wrong-container';
      session1.container = wrongContainer;

      // 切换到 session1
      sessionManager.switchTo('session-1');

      // 应该修正为正确的 container
      expect(session1.container.id).toBe('terminal-container-session-1');
      expect(session1.container.style.display).toBe('block');
    });
  });

  describe('showSession - 核心显示逻辑', () => {
    test('应该通过 expectedContainerId 查找容器', () => {
      const session = sessionManager.openSession('test-session', 'Test');
      sessionManager.createContainer(session);

      // 清除 session.container 引用
      const originalContainer = session.container;
      session.container = null;

      // 调用 showSession
      sessionManager.showSession(session);

      // 应该通过 ID 恢复正确的 container
      expect(session.container).toBe(originalContainer);
    });

    test('DOM 中有多个 container 时只显示目标容器', () => {
      // 创建 3 个 session
      const sessions = [];
      for (let i = 1; i <= 3; i++) {
        const s = sessionManager.openSession(`session-${i}`, `Session ${i}`);
        sessionManager.createContainer(s);
        sessions.push(s);
      }

      // 显示第 2 个 session
      sessionManager.showSession(sessions[1]);

      // 检查所有 container 的显示状态
      const allContainers = document.querySelectorAll('.terminal-session-container');
      expect(allContainers.length).toBe(3);

      allContainers.forEach(container => {
        if (container.id === 'terminal-container-session-2') {
          expect(container.style.display).toBe('block');
        } else {
          expect(container.style.display).toBe('none');
        }
      });
    });
  });

  describe('重连场景', () => {
    test('每个 session 应该保存自己的连接参数', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/project/a';
      session1.claudeSessionId = 'claude-a';

      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/project/b';
      session2.claudeSessionId = 'claude-b';

      // 切换到 session2
      sessionManager.switchTo('session-2');

      // session1 的参数不应该被覆盖
      expect(session1.workDir).toBe('/project/a');
      expect(session1.claudeSessionId).toBe('claude-a');

      // session2 的参数应该保持
      expect(session2.workDir).toBe('/project/b');
      expect(session2.claudeSessionId).toBe('claude-b');
    });

    test('重连状态应该独立', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.shouldReconnect = true;
      session1.reconnectAttempts = 3;

      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.shouldReconnect = false;
      session2.reconnectAttempts = 0;

      // 修改 session1 不影响 session2
      session1.reconnectAttempts = 5;

      expect(session1.reconnectAttempts).toBe(5);
      expect(session2.reconnectAttempts).toBe(0);
    });
  });

  describe('边界情况', () => {
    test('切换到不存在的 session 不应该崩溃', () => {
      expect(() => {
        sessionManager.switchTo('non-existent-session');
      }).not.toThrow();
    });

    test('container 不在 DOM 中时 showSession 不应该崩溃', () => {
      const session = sessionManager.openSession('test', 'Test');
      session.container = document.createElement('div');
      session.container.id = 'detached-container';
      // container 没有添加到 DOM

      expect(() => {
        sessionManager.showSession(session);
      }).not.toThrow();
    });

    test('terminal-output 不存在时不应该崩溃', () => {
      document.body.innerHTML = ''; // 清空 DOM

      const session = new SessionInstance('test', 'Test');

      expect(() => {
        sessionManager.showSession(session);
      }).not.toThrow();
    });
  });
});
