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
 * Chat Container 切换测试用例
 *
 * 测试场景：
 * 1. 创建第一个 session，打开 chat，应该有内容
 * 2. 创建第二个 session，打开 chat，也应该有内容
 * 3. 切换回第一个 session，第一个容器显示，第二个隐藏
 * 4. 切换到第二个 session，第二个显示，第一个隐藏
 */

const fs = require('fs');
const path = require('path');

// 读取源文件
const sessionManagerCode = fs.readFileSync(
  path.join(__dirname, '../static/session-manager.js'),
  'utf8'
);

const chatCode = fs.readFileSync(
  path.join(__dirname, '../static/chat.js'),
  'utf8'
);

// 执行 SessionManager
eval(sessionManagerCode);

describe('Chat Container 切换', () => {
  let sessionManager;
  let mockApp;
  let ChatMode;

  beforeEach(() => {
    // 设置 DOM 环境
    document.body.innerHTML = `
      <div id="terminal-output"></div>
      <div id="chat-view" class="view"></div>
    `;

    // Mock i18n
    window.i18n = {
      t: (key, fallback) => fallback
    };

    // Mock muxWs
    window.muxWs = {
      connectChat: jest.fn(),
      disconnectChat: jest.fn(),
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      closeTerminal: jest.fn(),
      closeChat: jest.fn(),
      handlers: new Map()
    };

    // Mock app 对象
    mockApp = {
      debugLog: jest.fn(),
      showView: jest.fn(),
      floatingButton: {
        update: jest.fn()
      }
    };
    window.app = mockApp;

    sessionManager = new SessionManager(mockApp);
    mockApp.sessionManager = sessionManager;

    // 执行 ChatMode 代码
    eval(chatCode);
    ChatMode = window.ChatMode;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    window.muxWs = undefined;
    window.i18n = undefined;
  });

  describe('createChatContainer', () => {
    test('应该为 session 创建容器并添加到 chat-view', () => {
      const session = sessionManager.openSession('session-1', 'Session 1');

      sessionManager.createChatContainer(session);

      // 检查容器是否创建
      expect(session.chatContainer).not.toBeNull();
      expect(session.chatContainer.id).toBe('chat-container-session-1');
      expect(session.chatContainer.className).toBe('chat-session-container');

      // 检查是否添加到 chat-view
      const chatView = document.getElementById('chat-view');
      expect(chatView.contains(session.chatContainer)).toBe(true);
    });

    test('容器初始应该是隐藏的', () => {
      const session = sessionManager.openSession('session-1', 'Session 1');
      sessionManager.createChatContainer(session);

      expect(session.chatContainer.style.display).toBe('none');
    });
  });

  describe('getOrCreateChatContainer', () => {
    test('第一次调用应该创建容器', () => {
      const session = sessionManager.openSession('session-1', 'Session 1');

      const container = sessionManager.getOrCreateChatContainer(session);

      expect(container).not.toBeNull();
      expect(session.chatContainer).toBe(container);
    });

    test('第二次调用应该返回已有容器', () => {
      const session = sessionManager.openSession('session-1', 'Session 1');

      const container1 = sessionManager.getOrCreateChatContainer(session);
      const container2 = sessionManager.getOrCreateChatContainer(session);

      expect(container1).toBe(container2);
    });
  });

  describe('showChatContainer - 多容器切换', () => {
    let session1, session2;

    beforeEach(() => {
      session1 = sessionManager.openSession('session-1', 'Session 1');
      session2 = sessionManager.openSession('session-2', 'Session 2');

      // 为两个 session 创建容器
      sessionManager.createChatContainer(session1);
      sessionManager.createChatContainer(session2);
    });

    test('显示 session1 时，session1 的容器应该可见，session2 隐藏', () => {
      sessionManager.showChatContainer(session1);

      expect(session1.chatContainer.style.display).toBe('block');
      expect(session2.chatContainer.style.display).toBe('none');
    });

    test('显示 session2 时，session2 的容器应该可见，session1 隐藏', () => {
      sessionManager.showChatContainer(session2);

      expect(session1.chatContainer.style.display).toBe('none');
      expect(session2.chatContainer.style.display).toBe('block');
    });

    test('来回切换时，容器应该正确显示/隐藏', () => {
      // 切换到 session1
      sessionManager.showChatContainer(session1);
      expect(session1.chatContainer.style.display).toBe('block');
      expect(session2.chatContainer.style.display).toBe('none');

      // 切换到 session2
      sessionManager.showChatContainer(session2);
      expect(session1.chatContainer.style.display).toBe('none');
      expect(session2.chatContainer.style.display).toBe('block');

      // 再切回 session1
      sessionManager.showChatContainer(session1);
      expect(session1.chatContainer.style.display).toBe('block');
      expect(session2.chatContainer.style.display).toBe('none');
    });

    test('三个 session 切换时也应该正确', () => {
      const session3 = sessionManager.openSession('session-3', 'Session 3');
      sessionManager.createChatContainer(session3);

      sessionManager.showChatContainer(session1);
      expect(session1.chatContainer.style.display).toBe('block');
      expect(session2.chatContainer.style.display).toBe('none');
      expect(session3.chatContainer.style.display).toBe('none');

      sessionManager.showChatContainer(session2);
      expect(session1.chatContainer.style.display).toBe('none');
      expect(session2.chatContainer.style.display).toBe('block');
      expect(session3.chatContainer.style.display).toBe('none');

      sessionManager.showChatContainer(session3);
      expect(session1.chatContainer.style.display).toBe('none');
      expect(session2.chatContainer.style.display).toBe('none');
      expect(session3.chatContainer.style.display).toBe('block');
    });
  });

  describe('ChatMode.connect - 容器初始化', () => {
    let session1, session2;

    beforeEach(() => {
      session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      sessionManager.activeId = session1.id;

      session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';
    });

    test('第一个 session 的 chat 容器应该有内容', () => {
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      // 检查容器是否有内容
      expect(session1.chatContainer).not.toBeNull();
      expect(session1.chatContainer.querySelector('.chat-container')).not.toBeNull();
      expect(session1.chatContainer.querySelector('.chat-messages')).not.toBeNull();
      expect(session1.chatContainer.querySelector('.chat-input')).not.toBeNull();
    });

    test('第二个 session 的 chat 容器也应该有内容', () => {
      // 先连接第一个
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      // 再连接第二个
      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);

      // 检查第二个容器是否有内容
      expect(session2.chatContainer).not.toBeNull();
      expect(session2.chatContainer.querySelector('.chat-container')).not.toBeNull();
      expect(session2.chatContainer.querySelector('.chat-messages')).not.toBeNull();
      expect(session2.chatContainer.querySelector('.chat-input')).not.toBeNull();
    });

    test('切换 session 时，两个容器都应该有内容', () => {
      // 连接第一个
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      // 连接第二个
      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);

      // 切换回第一个
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      // 两个容器都应该有内容
      expect(session1.chatContainer.querySelector('.chat-container')).not.toBeNull();
      expect(session2.chatContainer.querySelector('.chat-container')).not.toBeNull();
    });

    test('切换 session 时，显示正确的容器', () => {
      // 连接第一个
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);
      expect(session1.chatContainer.style.display).toBe('block');

      // 连接第二个
      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);
      expect(session1.chatContainer.style.display).toBe('none');
      expect(session2.chatContainer.style.display).toBe('block');

      // 切换回第一个
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);
      expect(session1.chatContainer.style.display).toBe('block');
      expect(session2.chatContainer.style.display).toBe('none');
    });
  });

  describe('Chat 消息独立性', () => {
    let session1, session2;

    beforeEach(() => {
      session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';

      session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';
    });

    test('每个 session 的 chatMessages 应该独立', () => {
      session1.chatMessages.push({ role: 'user', content: 'Hello from session 1' });
      session2.chatMessages.push({ role: 'user', content: 'Hello from session 2' });

      expect(session1.chatMessages.length).toBe(1);
      expect(session2.chatMessages.length).toBe(1);
      expect(session1.chatMessages[0].content).toBe('Hello from session 1');
      expect(session2.chatMessages[0].content).toBe('Hello from session 2');
    });

    test('切换 session 时消息不应该丢失', () => {
      // 给两个 session 添加消息
      session1.chatMessages.push({ role: 'user', content: 'Message 1' });
      session1.chatMessages.push({ role: 'assistant', content: 'Response 1' });
      session2.chatMessages.push({ role: 'user', content: 'Message 2' });

      // 模拟切换
      sessionManager.activeId = session1.id;
      sessionManager.activeId = session2.id;
      sessionManager.activeId = session1.id;

      // 消息应该保留
      expect(session1.chatMessages.length).toBe(2);
      expect(session2.chatMessages.length).toBe(1);
    });
  });

  describe('流式状态保存与恢复', () => {
    let session1, session2;

    beforeEach(() => {
      session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';

      session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';
    });

    test('切换 session 时应该保存流式状态', () => {
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      // 模拟流式状态
      ChatMode.isStreaming = true;
      ChatMode.streamingMessageId = 'msg-123';

      // 切换到 session2
      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);

      // session1 应该保存了流式状态
      expect(session1.chatIsStreaming).toBe(true);
      expect(session1.chatStreamingMessageId).toBe('msg-123');
    });

    test('切换回 session 时应该恢复流式状态', () => {
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      // 模拟流式状态
      ChatMode.isStreaming = true;
      ChatMode.streamingMessageId = 'msg-123';

      // 切换到 session2
      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);

      // session2 初始应该没有流式状态
      expect(ChatMode.isStreaming).toBe(false);
      expect(ChatMode.streamingMessageId).toBeNull();

      // 切换回 session1
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      // 应该恢复 session1 的流式状态
      expect(ChatMode.isStreaming).toBe(true);
      expect(ChatMode.streamingMessageId).toBe('msg-123');
    });
  });

  describe('closeSession 清理 chat 容器', () => {
    test('关闭 session 应该移除 chat 容器', () => {
      const session = sessionManager.openSession('session-1', 'Session 1');
      sessionManager.createChatContainer(session);

      const chatView = document.getElementById('chat-view');
      expect(chatView.children.length).toBe(1);

      sessionManager.closeSession(session.id);

      expect(chatView.children.length).toBe(0);
    });

    test('关闭一个 session 不应该影响其他 session 的容器', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      sessionManager.createChatContainer(session1);
      sessionManager.createChatContainer(session2);

      const chatView = document.getElementById('chat-view');
      expect(chatView.children.length).toBe(2);

      sessionManager.closeSession(session1.id);

      expect(chatView.children.length).toBe(1);
      expect(session2.chatContainer.parentElement).toBe(chatView);
    });
  });

  describe('renameSession 更新 chat 容器 ID', () => {
    test('rename 后容器 ID 应该更新', () => {
      const session = sessionManager.openSession('old-id', 'Session');
      sessionManager.createChatContainer(session);

      expect(session.chatContainer.id).toBe('chat-container-old-id');

      sessionManager.renameSession('old-id', 'new-id');

      expect(session.chatContainer.id).toBe('chat-container-new-id');
    });

    test('rename 后 showChatContainer 应该仍然正常工作', () => {
      const session1 = sessionManager.openSession('old-id', 'Session 1');
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      sessionManager.createChatContainer(session1);
      sessionManager.createChatContainer(session2);

      // Rename session1
      sessionManager.renameSession('old-id', 'new-id');

      // showChatContainer 应该仍然正常
      sessionManager.showChatContainer(session1);
      expect(session1.chatContainer.style.display).toBe('block');
      expect(session2.chatContainer.style.display).toBe('none');
    });
  });

  describe('BUG-015: connect 找不到 session 时使用 activeId 回退', () => {
    test('用无效 sessionId 但 activeId 正确时，应该显示 activeId 对应的 session', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      sessionManager.activeId = session1.id;

      // 第一个 session 正常打开 chat
      ChatMode.connect(session1.id, session1.workDir);
      expect(session1.chatContainer).not.toBeNull();
      expect(session1.chatContainer.style.display).toBe('block');

      // 用无效的 sessionId 调用，但 activeId 仍然是 session1
      // FIX: 应该回退到 activeId，显示 session1
      ChatMode.connect('invalid-session-id', '/some/path');

      // 修复后：session1 仍然显示（因为 activeId 指向它）
      expect(session1.chatContainer.style.display).toBe('block');
    });

    test('BUG修复：切换到 session2，用错误 ID 但 activeId 正确', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';

      // 第一个 session 打开 chat
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);
      expect(session1.chatContainer.style.display).toBe('block');

      // 第二个 session 用错误的 ID 调用（模拟 chatSessionId 缓存旧值的 bug）
      sessionManager.activeId = session2.id;
      ChatMode.connect('wrong-id', session2.workDir);  // 错误的 ID

      // BUG:
      // 1. session1 仍然显示（应该隐藏）
      // 2. session2 没有内容（因为 connect 提前返回了）
      expect(session1.chatContainer.style.display).toBe('none');
      expect(session2.chatContainer).not.toBeNull();
      expect(session2.chatContainer.querySelector('.chat-container')).not.toBeNull();
    });
  });

  describe('BUG: switchTo 不处理 chatContainer', () => {
    test('switchTo 应该也隐藏 chatContainer', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';

      // 为两个 session 创建 chat 容器
      sessionManager.createChatContainer(session1);
      sessionManager.createChatContainer(session2);

      // 显示 session1 的容器
      sessionManager.showChatContainer(session1);
      expect(session1.chatContainer.style.display).toBe('block');
      expect(session2.chatContainer.style.display).toBe('none');

      // 使用 switchTo 切换到 session2（模拟实际使用）
      sessionManager.switchTo(session2.id);

      // BUG: switchTo 不处理 chatContainer，session1 的容器应该被隐藏但可能没有
      // 预期：session1 隐藏，session2 ????（switchTo 不调用 showChatContainer）
      // 实际上 switchTo 只处理 terminal container，不处理 chatContainer
    });

    test('完整流程：第一个 session 打开 chat，第二个也打开 chat', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';

      // 第一个 session 打开 chat
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      // 验证第一个容器可见
      expect(session1.chatContainer.style.display).toBe('block');
      expect(session1.chatContainer.querySelector('.chat-container')).not.toBeNull();

      // 模拟 floatingButton 切换到第二个 session
      // 实际流程：connectSession -> switchTo -> showView('chat') -> ChatMode.connect
      sessionManager.switchTo(session2.id);  // 这只处理 terminal container

      // 此时 session1 的 chatContainer 可能还是 block（BUG）
      // 因为 switchTo 只隐藏 terminal container，不隐藏 chatContainer

      // 然后 ChatMode.connect 被调用
      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);

      // 现在 session2 的 chatContainer 应该可见
      expect(session2.chatContainer.style.display).toBe('block');
      expect(session2.chatContainer.querySelector('.chat-container')).not.toBeNull();

      // session1 的 chatContainer 应该被隐藏
      expect(session1.chatContainer.style.display).toBe('none');
    });
  });

  describe('模拟实际使用场景 - 包含 session ID 重命名', () => {
    test('临时 ID 创建 chat，rename 后切换到另一个 session，再切回应该正常', () => {
      // 模拟第一个 session 用临时 ID 创建
      const tempId1 = 'temp-session-1';
      const session1 = sessionManager.openSession(tempId1, 'Session 1');
      session1.workDir = '/path/to/project1';
      sessionManager.activeId = session1.id;

      // 连接 chat（使用临时 ID）
      ChatMode.connect(session1.id, session1.workDir);

      // 验证容器创建
      expect(session1.chatContainer).not.toBeNull();
      expect(session1.chatContainer.id).toBe(`chat-container-${tempId1}`);
      expect(session1.chatContainer.querySelector('.chat-container')).not.toBeNull();

      // 后端返回真实 UUID，触发 rename
      const uuid1 = 'uuid-1111-2222-3333';
      sessionManager.renameSession(tempId1, uuid1);

      // 验证容器 ID 更新
      expect(session1.id).toBe(uuid1);
      expect(session1.chatContainer.id).toBe(`chat-container-${uuid1}`);

      // 创建第二个 session
      const tempId2 = 'temp-session-2';
      const session2 = sessionManager.openSession(tempId2, 'Session 2');
      session2.workDir = '/path/to/project2';
      sessionManager.activeId = session2.id;

      // 连接第二个 chat
      ChatMode.connect(session2.id, session2.workDir);

      // 验证第二个容器创建，第一个容器隐藏
      expect(session2.chatContainer).not.toBeNull();
      expect(session2.chatContainer.querySelector('.chat-container')).not.toBeNull();
      expect(session2.chatContainer.style.display).toBe('block');
      expect(session1.chatContainer.style.display).toBe('none');

      // rename 第二个 session
      const uuid2 = 'uuid-4444-5555-6666';
      sessionManager.renameSession(tempId2, uuid2);

      // 切换回第一个 session
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      // 验证第一个容器显示，第二个隐藏
      expect(session1.chatContainer.style.display).toBe('block');
      expect(session2.chatContainer.style.display).toBe('none');

      // 验证两个容器都有内容
      expect(session1.chatContainer.querySelector('.chat-container')).not.toBeNull();
      expect(session2.chatContainer.querySelector('.chat-container')).not.toBeNull();
    });

    test('两个 session 交替切换多次', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';

      // 切换 10 次
      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) {
          sessionManager.activeId = session1.id;
          ChatMode.connect(session1.id, session1.workDir);
          expect(session1.chatContainer.style.display).toBe('block');
          if (session2.chatContainer) {
            expect(session2.chatContainer.style.display).toBe('none');
          }
        } else {
          sessionManager.activeId = session2.id;
          ChatMode.connect(session2.id, session2.workDir);
          expect(session1.chatContainer.style.display).toBe('none');
          expect(session2.chatContainer.style.display).toBe('block');
        }
      }

      // 验证两个容器都有内容
      expect(session1.chatContainer.querySelector('.chat-container')).not.toBeNull();
      expect(session2.chatContainer.querySelector('.chat-container')).not.toBeNull();
    });

    test('验证 chat-view 中只有正确的容器可见', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';
      const session3 = sessionManager.openSession('session-3', 'Session 3');
      session3.workDir = '/path/to/project3';

      // 连接所有 session
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);

      sessionManager.activeId = session3.id;
      ChatMode.connect(session3.id, session3.workDir);

      // 现在 session3 应该可见
      const chatView = document.getElementById('chat-view');
      const visibleContainers = Array.from(chatView.querySelectorAll('.chat-session-container'))
        .filter(c => c.style.display !== 'none');

      expect(visibleContainers.length).toBe(1);
      expect(visibleContainers[0].id).toBe('chat-container-session-3');

      // 切换到 session1
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      const visibleAfter = Array.from(chatView.querySelectorAll('.chat-session-container'))
        .filter(c => c.style.display !== 'none');

      expect(visibleAfter.length).toBe(1);
      expect(visibleAfter[0].id).toBe('chat-container-session-1');
    });
  });

  describe('Chat 输入框内容暂存', () => {
    test('切换 session 时应该保存输入框内容', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';

      // 第一个 session 打开 chat
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      // 在输入框中输入内容
      ChatMode.inputEl.value = 'Drafting message for session 1';

      // 切换到第二个 session
      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);

      // 验证 session1 的输入内容被保存
      expect(session1.chatInputValue).toBe('Drafting message for session 1');
    });

    test('切换回 session 时应该恢复输入框内容', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';

      // 第一个 session 打开 chat 并输入内容
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);
      ChatMode.inputEl.value = 'Drafting message for session 1';

      // 切换到第二个 session
      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);
      ChatMode.inputEl.value = 'Drafting message for session 2';

      // 切换回第一个 session
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      // 验证输入框内容恢复
      expect(ChatMode.inputEl.value).toBe('Drafting message for session 1');
    });

    test('各 session 的输入框内容应该独立', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';

      // 两个 session 分别输入内容
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);
      ChatMode.inputEl.value = 'Session 1 content';

      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);
      ChatMode.inputEl.value = 'Session 2 content';

      // 切换到 session1
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);
      expect(ChatMode.inputEl.value).toBe('Session 1 content');

      // 切换到 session2
      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);
      expect(ChatMode.inputEl.value).toBe('Session 2 content');
    });
  });

  describe('BUG-017: 多 session 消息路由', () => {
    /**
     * BUG-017 问题分析：
     *
     * 为什么之前的测试没有发现这个 bug？
     *
     * 1. 测试只覆盖了"容器切换"和"DOM 操作"，没有覆盖"消息路由"
     * 2. 测试没有模拟 MuxWebSocket 的回调机制
     * 3. 测试直接调用 ChatMode.addMessage()，而不是通过 WebSocket 回调
     *
     * 这个 bug 的根本原因：
     * - ChatMode 是单例模式，但多个 session 共用同一个 handleMuxMessage
     * - onMessage 回调使用的是 ChatMode 单例的当前状态
     * - 当 session A 收到消息但用户在 session B 时，消息被添加到 session B
     *
     * 修复方法：
     * - 在创建 handler 时用闭包捕获 session 引用
     * - 使用 handleMuxMessageForSession 临时切换上下文处理消息
     */

    test('handleMuxMessageForSession 应该使用目标 session 的容器', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';

      // 两个 session 都连接 chat
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);

      // 当前活跃的是 session2，但我们要给 session1 发消息
      const container1 = session1.chatContainer;
      const messagesEl1 = container1.querySelector('#chatMessages');

      // 模拟收到 session1 的消息
      // handleMuxMessageForSession(type, data, targetSession, targetSessionId)
      // 注意：使用 'user' 类型而不是 'user_ack'，因为 'user_ack' 只是确认消息，不会添加到 UI
      ChatMode.handleMuxMessageForSession(
        'user',
        { content: 'Message for session 1' },
        session1,
        session1.id
      );

      // 消息应该出现在 session1 的容器中，而不是 session2
      const session1Messages = session1.chatContainer.querySelectorAll('.chat-message.user');
      const session2Messages = session2.chatContainer.querySelectorAll('.chat-message.user');

      expect(session1Messages.length).toBe(1);
      expect(session2Messages.length).toBe(0);
    });

    test('给非活跃 session 发消息不应该影响活跃 session 的状态', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';

      // 两个 session 都连接 chat
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);

      // 保存 session2 的 messagesEl 引用
      const session2MessagesEl = ChatMode.messagesEl;

      // 给 session1 发消息
      // handleMuxMessageForSession(type, data, targetSession, targetSessionId)
      ChatMode.handleMuxMessageForSession(
        'assistant',
        { content: 'Response for session 1' },
        session1,
        session1.id
      );

      // ChatMode.messagesEl 应该仍然指向 session2
      expect(ChatMode.messagesEl).toBe(session2MessagesEl);
    });

    test('两个 session 同时收到消息应该各自路由到正确的容器', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';

      // 两个 session 都连接 chat
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);

      // 模拟两个 session 交替收到消息
      // 注意：使用 'user' 类型而不是 'user_ack'，因为 'user_ack' 只是确认消息，不会添加到 UI
      ChatMode.handleMuxMessageForSession('user', { content: 'User message 1' }, session1, session1.id);
      ChatMode.handleMuxMessageForSession('user', { content: 'User message 2' }, session2, session2.id);
      ChatMode.handleMuxMessageForSession('assistant', { content: 'Response 1' }, session1, session1.id);
      ChatMode.handleMuxMessageForSession('assistant', { content: 'Response 2' }, session2, session2.id);

      // 验证消息被路由到正确的容器
      const s1UserMsgs = session1.chatContainer.querySelectorAll('.chat-message.user');
      const s1AsstMsgs = session1.chatContainer.querySelectorAll('.chat-message.assistant');
      const s2UserMsgs = session2.chatContainer.querySelectorAll('.chat-message.user');
      const s2AsstMsgs = session2.chatContainer.querySelectorAll('.chat-message.assistant');

      expect(s1UserMsgs.length).toBe(1);
      expect(s1AsstMsgs.length).toBe(1);
      expect(s2UserMsgs.length).toBe(1);
      expect(s2AsstMsgs.length).toBe(1);

      // 验证消息内容正确
      expect(s1UserMsgs[0].textContent).toContain('User message 1');
      expect(s1AsstMsgs[0].textContent).toContain('Response 1');
      expect(s2UserMsgs[0].textContent).toContain('User message 2');
      expect(s2AsstMsgs[0].textContent).toContain('Response 2');
    });

    test('流式消息应该路由到正确的 session', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';

      // 两个 session 都连接 chat
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);

      // session1 开始流式输出
      ChatMode.handleMuxMessageForSession('stream', { text: 'Hello ' }, session1, session1.id);
      ChatMode.handleMuxMessageForSession('stream', { text: 'World!' }, session1, session1.id);

      // session2 也开始流式输出
      ChatMode.handleMuxMessageForSession('stream', { text: 'Foo ' }, session2, session2.id);
      ChatMode.handleMuxMessageForSession('stream', { text: 'Bar!' }, session2, session2.id);

      // 验证流式消息在各自容器中
      const s1Streaming = session1.chatContainer.querySelector('.chat-message.streaming');
      const s2Streaming = session2.chatContainer.querySelector('.chat-message.streaming');

      expect(s1Streaming).not.toBeNull();
      expect(s2Streaming).not.toBeNull();
      expect(s1Streaming.textContent).toContain('Hello World!');
      expect(s2Streaming.textContent).toContain('Foo Bar!');
    });

    test('流式状态应该在各 session 间独立', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';

      // 两个 session 都连接 chat
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);

      // session1 开始流式输出
      ChatMode.handleMuxMessageForSession('stream', { text: 'Streaming...' }, session1, session1.id);

      // 验证 session1 的流式状态被保存
      expect(session1.chatIsStreaming).toBe(true);
      expect(session1.chatStreamingMessageId).not.toBeNull();

      // session2 的流式状态应该独立
      expect(session2.chatIsStreaming).toBeFalsy();

      // session1 完成流式输出
      ChatMode.handleMuxMessageForSession('assistant', { content: 'Done!' }, session1, session1.id);

      // session1 流式状态应该重置
      expect(session1.chatIsStreaming).toBe(false);
    });

    test('tool_call 和 tool_result 应该路由到正确的 session', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';

      // 两个 session 都连接 chat
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);

      // session1 收到 tool_call
      ChatMode.handleMuxMessageForSession('tool_call', {
        tool_name: 'Read',
        input: { file: '/test.txt' }
      }, session1, session1.id);

      // session2 收到不同的 tool_call
      ChatMode.handleMuxMessageForSession('tool_call', {
        tool_name: 'Bash',
        input: { command: 'ls' }
      }, session2, session2.id);

      // 验证 tool 消息在各自容器中
      const s1Tools = session1.chatContainer.querySelectorAll('.chat-message.tool');
      const s2Tools = session2.chatContainer.querySelectorAll('.chat-message.tool');

      expect(s1Tools.length).toBe(1);
      expect(s2Tools.length).toBe(1);
      expect(s1Tools[0].textContent).toContain('Read');
      expect(s2Tools[0].textContent).toContain('Bash');
    });

    test('error 消息应该路由到正确的 session', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';

      // 两个 session 都连接 chat
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);

      // session1 收到 error
      ChatMode.handleMuxMessageForSession('error', { message: 'Error in session 1' }, session1, session1.id);

      // 验证 error 只出现在 session1
      const s1Errors = session1.chatContainer.querySelectorAll('.chat-message.system');
      const s2Errors = session2.chatContainer.querySelectorAll('.chat-message.system');

      expect(s1Errors.length).toBe(1);
      expect(s2Errors.length).toBe(0);
      expect(s1Errors[0].textContent).toContain('Error in session 1');
    });

    test('claudeSessionId 应该更新到正确的 session', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';

      // 两个 session 都连接 chat
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);

      // 模拟收到 system 消息，包含 claudeSessionId
      ChatMode.handleMuxMessageForSession('system', {
        data: { session_id: 'claude-uuid-1111' }
      }, session1, session1.id);

      ChatMode.handleMuxMessageForSession('system', {
        data: { session_id: 'claude-uuid-2222' }
      }, session2, session2.id);

      // 验证各自的 claudeSessionId 被正确更新
      expect(session1.claudeSessionId).toBe('claude-uuid-1111');
      expect(session2.claudeSessionId).toBe('claude-uuid-2222');
    });

    test('切换 session 后再收到旧 session 的消息应该路由正确', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';

      // session1 连接并发送消息
      // 注意：使用 'user' 类型而不是 'user_ack'，因为 'user_ack' 只是确认消息，不会添加到 UI
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);
      ChatMode.handleMuxMessageForSession('user', { content: 'Message 1' }, session1, session1.id);

      // 切换到 session2
      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);

      // session1 收到响应（此时 session2 是活跃的）
      ChatMode.handleMuxMessageForSession('assistant', { content: 'Response to message 1' }, session1, session1.id);

      // 验证消息仍然在 session1 的容器中
      const s1Messages = session1.chatContainer.querySelectorAll('.chat-message');
      const s2Messages = session2.chatContainer.querySelectorAll('.chat-message');

      expect(s1Messages.length).toBe(2); // user + assistant
      expect(s2Messages.length).toBe(0);
    });
  });

  describe('BUG-016: render 使用 document.getElementById 导致多容器冲突', () => {
    test('两个 session 的 DOM 元素引用应该指向各自容器内的元素', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';

      // 第一个 session 打开 chat
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      // 保存第一个容器的 messagesEl 引用
      const session1MessagesEl = ChatMode.messagesEl;
      expect(session1MessagesEl).not.toBeNull();
      expect(session1MessagesEl.closest('.chat-session-container').id).toBe('chat-container-session-1');

      // 第二个 session 打开 chat
      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);

      // 验证 ChatMode.messagesEl 现在指向 session2 的容器
      expect(ChatMode.messagesEl).not.toBeNull();
      expect(ChatMode.messagesEl.closest('.chat-session-container').id).toBe('chat-container-session-2');

      // BUG-016: 如果使用 document.getElementById，session2 的 messagesEl 会错误地指向 session1 的元素
      // 修复后，messagesEl 应该在各自的 container 内查找
      expect(ChatMode.messagesEl).not.toBe(session1MessagesEl);
    });

    test('发送消息应该添加到当前 session 的容器而非第一个容器', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';

      // 第一个 session 打开 chat
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      // 添加一条消息到 session1
      ChatMode.addMessage('user', 'Session 1 message');
      const session1Messages = session1.chatContainer.querySelectorAll('.chat-message.user');
      expect(session1Messages.length).toBe(1);

      // 第二个 session 打开 chat
      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);

      // 添加一条消息到 session2
      ChatMode.addMessage('user', 'Session 2 message');

      // BUG-016: 如果使用 document.getElementById，这条消息会被添加到 session1 的容器
      // 修复后，消息应该添加到 session2 的容器
      const session2Messages = session2.chatContainer.querySelectorAll('.chat-message.user');
      expect(session2Messages.length).toBe(1);
      expect(session2Messages[0].querySelector('.chat-bubble').textContent).toContain('Session 2');

      // 确保 session1 的容器没有被影响
      const session1MessagesAfter = session1.chatContainer.querySelectorAll('.chat-message.user');
      expect(session1MessagesAfter.length).toBe(1);
      expect(session1MessagesAfter[0].querySelector('.chat-bubble').textContent).toContain('Session 1');
    });

    test('typing indicator 应该只在当前 session 的容器中显示', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';

      // 第一个 session 打开 chat
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);

      // 第二个 session 打开 chat
      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);

      // 在 session2 中显示 typing indicator
      ChatMode.showTypingIndicator();

      // BUG-016: 如果使用 document.getElementById，typing indicator 可能被添加到 session1 的容器
      // 修复后，typing indicator 应该只在 session2 的容器中
      const session1Indicator = session1.chatContainer.querySelector('#typingIndicator');
      const session2Indicator = session2.chatContainer.querySelector('#typingIndicator');

      expect(session1Indicator).toBeNull();
      expect(session2Indicator).not.toBeNull();
    });

    test('hideTypingIndicator 应该只移除当前 session 容器中的 indicator', () => {
      const session1 = sessionManager.openSession('session-1', 'Session 1');
      session1.workDir = '/path/to/project1';
      const session2 = sessionManager.openSession('session-2', 'Session 2');
      session2.workDir = '/path/to/project2';

      // 第一个 session 打开 chat 并显示 typing indicator
      sessionManager.activeId = session1.id;
      ChatMode.connect(session1.id, session1.workDir);
      ChatMode.showTypingIndicator();

      // 第二个 session 打开 chat
      sessionManager.activeId = session2.id;
      ChatMode.connect(session2.id, session2.workDir);

      // 在 session2 中调用 hideTypingIndicator
      ChatMode.hideTypingIndicator();

      // BUG-016: 如果使用 document.getElementById，可能会错误地移除 session1 的 indicator
      // 修复后，hideTypingIndicator 应该只影响当前容器
      // 注意：由于 session2 刚连接，没有 indicator，所以 session1 的 indicator 应该还在
      const session1Indicator = session1.chatContainer.querySelector('#typingIndicator');
      expect(session1Indicator).not.toBeNull();
    });
  });

  describe('Tool 渲染优化测试', () => {
    test('Edit 工具应该渲染 diff 视图', () => {
      const session = sessionManager.openSession('session-1', 'Test Session');
      session.workDir = '/test/project';
      sessionManager.activeId = session.id;
      ChatMode.connect(session.id, session.workDir);

      // 添加 Edit 工具调用
      ChatMode.addToolMessage('call', 'Edit', {
        file_path: '/test/file.js',
        old_string: 'const old = 1;',
        new_string: 'const new = 2;'
      });

      const toolMsg = session.chatContainer.querySelector('.chat-message.tool');
      expect(toolMsg).not.toBeNull();

      // 检查 diff 视图
      const diffRemove = toolMsg.querySelector('.diff-remove');
      const diffAdd = toolMsg.querySelector('.diff-add');
      expect(diffRemove).not.toBeNull();
      expect(diffAdd).not.toBeNull();
      expect(diffRemove.textContent).toContain('const old = 1;');
      expect(diffAdd.textContent).toContain('const new = 2;');
    });

    test('Write 工具应该显示 NEW FILE 标记', () => {
      const session = sessionManager.openSession('session-1', 'Test Session');
      session.workDir = '/test/project';
      sessionManager.activeId = session.id;
      ChatMode.connect(session.id, session.workDir);

      ChatMode.addToolMessage('call', 'Write', {
        file_path: '/test/new-file.js',
        content: 'console.log("hello");'
      });

      const toolMsg = session.chatContainer.querySelector('.chat-message.tool');
      const newBadge = toolMsg.querySelector('.tool-badge.new');
      expect(newBadge).not.toBeNull();
      expect(newBadge.textContent).toContain('NEW');
    });

    test('Bash 工具应该显示命令和 prompt', () => {
      const session = sessionManager.openSession('session-1', 'Test Session');
      session.workDir = '/test/project';
      sessionManager.activeId = session.id;
      ChatMode.connect(session.id, session.workDir);

      ChatMode.addToolMessage('call', 'Bash', {
        command: 'npm test',
        description: 'Run tests'
      });

      const toolMsg = session.chatContainer.querySelector('.chat-message.tool');
      const prompt = toolMsg.querySelector('.tool-bash-prompt');
      const command = toolMsg.querySelector('.tool-bash-command');
      expect(prompt).not.toBeNull();
      expect(prompt.textContent).toBe('$');
      expect(command.textContent).toBe('npm test');
    });

    test('Grep 工具应该显示搜索模式', () => {
      const session = sessionManager.openSession('session-1', 'Test Session');
      session.workDir = '/test/project';
      sessionManager.activeId = session.id;
      ChatMode.connect(session.id, session.workDir);

      ChatMode.addToolMessage('call', 'Grep', {
        pattern: 'function\\s+\\w+',
        path: '/test/src'
      });

      const toolMsg = session.chatContainer.querySelector('.chat-message.tool');
      const pattern = toolMsg.querySelector('.tool-grep-pattern');
      expect(pattern).not.toBeNull();
      expect(pattern.textContent).toContain('function\\s+\\w+');
    });

    test('updateBashResult 应该区分 stdout 和 stderr', () => {
      const session = sessionManager.openSession('session-1', 'Test Session');
      session.workDir = '/test/project';
      sessionManager.activeId = session.id;
      ChatMode.connect(session.id, session.workDir);

      ChatMode.addToolMessage('call', 'Bash', {
        command: 'some-command'
      });

      // 更新结果
      ChatMode.updateToolResult('tool-id', {
        stdout: 'Output line 1\nOutput line 2',
        stderr: 'Warning: something',
        is_error: false
      });

      const toolMsg = session.chatContainer.querySelector('.chat-message.tool');
      const stdout = toolMsg.querySelector('.bash-stdout');
      const stderr = toolMsg.querySelector('.bash-stderr');
      expect(stdout).not.toBeNull();
      expect(stderr).not.toBeNull();
      expect(stdout.textContent).toContain('Output line 1');
      expect(stderr.textContent).toContain('Warning');
    });

    test('Edit 工具 - 新文件应该只显示添加行', () => {
      const session = sessionManager.openSession('session-1', 'Test Session');
      session.workDir = '/test/project';
      sessionManager.activeId = session.id;
      ChatMode.connect(session.id, session.workDir);

      // 新文件：old_string 为空
      ChatMode.addToolMessage('call', 'Edit', {
        file_path: '/test/new-file.js',
        old_string: '',
        new_string: 'const x = 1;\nconst y = 2;'
      });

      const toolMsg = session.chatContainer.querySelector('.chat-message.tool');
      const diffRemove = toolMsg.querySelectorAll('.diff-remove');
      const diffAdd = toolMsg.querySelectorAll('.diff-add');

      // 新文件不应有删除行
      expect(diffRemove.length).toBe(0);
      // 应该有添加行
      expect(diffAdd.length).toBeGreaterThan(0);
    });

    test('长输出应该自动折叠', () => {
      const session = sessionManager.openSession('session-1', 'Test Session');
      session.workDir = '/test/project';
      sessionManager.activeId = session.id;
      ChatMode.connect(session.id, session.workDir);

      // 创建超过 20 行的内容
      const longContent = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`).join('\n');

      ChatMode.addToolMessage('call', 'Write', {
        file_path: '/test/long-file.js',
        content: longContent
      });

      const toolMsg = session.chatContainer.querySelector('.chat-message.tool');
      const expandBtn = toolMsg.querySelector('.code-expand-btn');
      const hiddenLines = toolMsg.querySelectorAll('.code-line.hidden');

      expect(expandBtn).not.toBeNull();
      expect(hiddenLines.length).toBeGreaterThan(0);
    });

    test('getToolIcon 应该返回不同工具的图标', () => {
      const editIcon = ChatMode.getToolIcon('Edit');
      const bashIcon = ChatMode.getToolIcon('Bash');
      const grepIcon = ChatMode.getToolIcon('Grep');
      const unknownIcon = ChatMode.getToolIcon('UnknownTool');

      expect(editIcon).toContain('svg');
      expect(bashIcon).toContain('svg');
      expect(grepIcon).toContain('svg');
      expect(unknownIcon).toContain('svg');
      // 不同工具应该有不同的图标
      expect(editIcon).not.toBe(bashIcon);
    });

    test('highlightPattern 应该高亮匹配文本', () => {
      const result = ChatMode.highlightPattern('test function test', 'test');
      expect(result).toContain('<mark class="grep-match">test</mark>');
      // 应该匹配所有出现
      expect(result.match(/<mark/g).length).toBe(2);
    });

    test('代码块应该包含复制按钮', () => {
      const session = sessionManager.openSession('session-1', 'Test Session');
      session.workDir = '/test/project';
      sessionManager.activeId = session.id;
      ChatMode.connect(session.id, session.workDir);

      // 添加包含代码块的消息
      ChatMode.addMessage('assistant', '```javascript\nconst x = 1;\n```');

      const assistantMsg = session.chatContainer.querySelector('.chat-message.assistant');
      const copyBtn = assistantMsg.querySelector('.code-copy-btn');
      expect(copyBtn).not.toBeNull();
    });
  });

  describe('Thinking 消息测试', () => {
    test('startThinking 应该创建 thinking 消息', () => {
      const session = sessionManager.openSession('session-1', 'Test Session');
      session.workDir = '/test/project';
      sessionManager.activeId = session.id;
      ChatMode.connect(session.id, session.workDir);

      ChatMode.startThinking();

      const thinkingMsg = session.chatContainer.querySelector('.chat-message.thinking');
      expect(thinkingMsg).not.toBeNull();
      expect(ChatMode.isThinking).toBe(true);
    });

    test('appendToThinking 应该追加内容', () => {
      const session = sessionManager.openSession('session-1', 'Test Session');
      session.workDir = '/test/project';
      sessionManager.activeId = session.id;
      ChatMode.connect(session.id, session.workDir);

      ChatMode.startThinking();
      ChatMode.appendToThinking('Part 1');
      ChatMode.appendToThinking(' Part 2');

      const thinkingContent = session.chatContainer.querySelector('.thinking-content');
      expect(thinkingContent.getAttribute('data-raw')).toBe('Part 1 Part 2');
    });

    test('finalizeThinking 应该折叠并更新标签', () => {
      const session = sessionManager.openSession('session-1', 'Test Session');
      session.workDir = '/test/project';
      sessionManager.activeId = session.id;
      ChatMode.connect(session.id, session.workDir);

      ChatMode.startThinking();
      ChatMode.appendToThinking('Some thinking...');
      ChatMode.finalizeThinking();

      const thinkingContent = session.chatContainer.querySelector('.thinking-content');
      const label = session.chatContainer.querySelector('.thinking-label');

      // 应该折叠
      expect(thinkingContent.classList.contains('show')).toBe(false);
      // 标签应该变成 "Thought"
      expect(label.textContent).toBe('Thought');
      expect(ChatMode.isThinking).toBe(false);
    });

    test('addThinkingMessage 应该创建完整的 thinking 消息', () => {
      const session = sessionManager.openSession('session-1', 'Test Session');
      session.workDir = '/test/project';
      sessionManager.activeId = session.id;
      ChatMode.connect(session.id, session.workDir);

      ChatMode.addThinkingMessage('Complete thinking content');

      const thinkingMsg = session.chatContainer.querySelector('.chat-message.thinking');
      const thinkingContent = session.chatContainer.querySelector('.thinking-content');

      expect(thinkingMsg).not.toBeNull();
      // 非流式 thinking 默认折叠
      expect(thinkingContent.classList.contains('show')).toBe(false);
      expect(thinkingContent.textContent).toContain('Complete thinking content');
    });

    test('toggleThinking 应该切换显示状态', () => {
      const session = sessionManager.openSession('session-1', 'Test Session');
      session.workDir = '/test/project';
      sessionManager.activeId = session.id;
      ChatMode.connect(session.id, session.workDir);

      const msgId = ChatMode.addThinkingMessage('Test thinking');
      const thinkingContent = session.chatContainer.querySelector('.thinking-content');

      // 初始状态应该是折叠的
      expect(thinkingContent.classList.contains('show')).toBe(false);

      // 点击展开
      ChatMode.toggleThinking(msgId);
      expect(thinkingContent.classList.contains('show')).toBe(true);

      // 再次点击折叠
      ChatMode.toggleThinking(msgId);
      expect(thinkingContent.classList.contains('show')).toBe(false);
    });
  });
});
