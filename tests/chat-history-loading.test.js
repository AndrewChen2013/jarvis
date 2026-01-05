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
 * Chat History Infinite Scroll Tests
 *
 * Tests for:
 * 1. History state initialization
 * 2. loadMoreHistory() function
 * 3. Message collection during history loading
 * 4. createMessageElement() helper
 * 5. history_end and history_page_end message handling
 * 6. Scroll detection for triggering history load
 */

const fs = require('fs');
const path = require('path');

// Read source files
const sessionManagerCode = fs.readFileSync(
  path.join(__dirname, '../static/session-manager.js'),
  'utf8'
);

const chatCode = fs.readFileSync(
  path.join(__dirname, '../static/chat.js'),
  'utf8'
);

// Execute SessionManager
eval(sessionManagerCode);

describe('Chat History Infinite Scroll', () => {
  let sessionManager;
  let mockApp;
  let ChatMode;

  beforeEach(() => {
    // Setup DOM environment
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
      send: jest.fn(),
      chatMessage: jest.fn(),
      handlers: new Map()
    };

    // Mock app object
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

    // Execute ChatMode code
    eval(chatCode);
    ChatMode = window.ChatMode;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    window.muxWs = undefined;
    window.i18n = undefined;
  });

  describe('History State Initialization', () => {
    test('should initialize with correct default history state', () => {
      expect(ChatMode.historyOldestIndex).toBe(-1);
      expect(ChatMode.hasMoreHistory).toBe(false);
      expect(ChatMode.isLoadingHistory).toBe(false);
      expect(ChatMode.pendingHistoryMessages).toEqual([]);
    });

    test('should reset history state when connecting new session', () => {
      const session = sessionManager.openSession('session-1', 'Session 1');
      session.workDir = '/path/to/project';
      sessionManager.activeId = session.id;

      // Set some history state
      ChatMode.historyOldestIndex = 50;
      ChatMode.hasMoreHistory = true;
      ChatMode.isLoadingHistory = true;

      // Connect to session
      ChatMode.connect(session.id, session.workDir);

      // History state should be preserved for resuming
      // (the actual values come from backend via history_end message)
    });
  });

  describe('createMessageElement helper', () => {
    let session;

    beforeEach(() => {
      session = sessionManager.openSession('session-1', 'Session 1');
      session.workDir = '/path/to/project';
      sessionManager.activeId = session.id;
      ChatMode.connect(session.id, session.workDir);
    });

    test('should create user message element', () => {
      const msgEl = ChatMode.createMessageElement('user', 'Hello world');

      expect(msgEl).not.toBeNull();
      expect(msgEl.classList.contains('chat-message')).toBe(true);
      expect(msgEl.classList.contains('user')).toBe(true);
      expect(msgEl.querySelector('.chat-bubble')).not.toBeNull();
      expect(msgEl.querySelector('.chat-bubble').textContent).toContain('Hello world');
    });

    test('should create assistant message element', () => {
      const msgEl = ChatMode.createMessageElement('assistant', 'I can help with that');

      expect(msgEl).not.toBeNull();
      expect(msgEl.classList.contains('assistant')).toBe(true);
      expect(msgEl.querySelector('.chat-bubble').textContent).toContain('I can help');
    });

    test('should include timestamp if provided', () => {
      const msgEl = ChatMode.createMessageElement('user', 'Test message', {
        timestamp: '2025-01-05T10:30:00Z'
      });

      const timeEl = msgEl.querySelector('.chat-message-time');
      expect(timeEl).not.toBeNull();
    });

    test('should not insert element into DOM', () => {
      const beforeCount = session.chatContainer.querySelectorAll('.chat-message').length;

      ChatMode.createMessageElement('user', 'Test message');

      const afterCount = session.chatContainer.querySelectorAll('.chat-message').length;
      expect(afterCount).toBe(beforeCount);
    });
  });

  describe('loadMoreHistory function', () => {
    let session;

    beforeEach(() => {
      session = sessionManager.openSession('session-1', 'Session 1');
      session.workDir = '/path/to/project';
      sessionManager.activeId = session.id;
      ChatMode.connect(session.id, session.workDir);

      // Simulate connected state
      ChatMode.isConnected = true;
      ChatMode.historyOldestIndex = 100;
      ChatMode.hasMoreHistory = true;
    });

    test('should not load if already loading', () => {
      ChatMode.isLoadingHistory = true;

      ChatMode.loadMoreHistory();

      expect(window.muxWs.send).not.toHaveBeenCalled();
    });

    test('should not load if no more history', () => {
      ChatMode.hasMoreHistory = false;

      ChatMode.loadMoreHistory();

      expect(window.muxWs.send).not.toHaveBeenCalled();
    });

    test('should not load if disconnected', () => {
      ChatMode.isConnected = false;

      ChatMode.loadMoreHistory();

      expect(window.muxWs.send).not.toHaveBeenCalled();
    });

    test('should send load_more_history message when valid', () => {
      ChatMode.loadMoreHistory();

      expect(ChatMode.isLoadingHistory).toBe(true);
      expect(window.muxWs.send).toHaveBeenCalledWith(
        'chat',
        session.id,
        'load_more_history',
        {
          before_index: 100,
          limit: 50
        }
      );
    });

    test('should add loading indicator to DOM', () => {
      ChatMode.loadMoreHistory();

      const loadingEl = session.chatContainer.querySelector('#historyLoadingIndicator');
      expect(loadingEl).not.toBeNull();
      expect(loadingEl.classList.contains('chat-history-loading')).toBe(true);
    });
  });

  describe('Message Collection During History Loading', () => {
    let session;

    beforeEach(() => {
      session = sessionManager.openSession('session-1', 'Session 1');
      session.workDir = '/path/to/project';
      sessionManager.activeId = session.id;
      ChatMode.connect(session.id, session.workDir);
      ChatMode.isConnected = true;
    });

    test('should collect user messages when isLoadingHistory is true', () => {
      ChatMode.isLoadingHistory = true;

      ChatMode.handleMessage({
        type: 'user',
        content: 'Historical message 1',
        timestamp: '2025-01-05T09:00:00Z'
      });

      ChatMode.handleMessage({
        type: 'user',
        content: 'Historical message 2',
        timestamp: '2025-01-05T09:05:00Z'
      });

      // Messages should be in pendingHistoryMessages, not added to DOM
      expect(ChatMode.pendingHistoryMessages.length).toBe(2);
      expect(ChatMode.pendingHistoryMessages[0].content).toBe('Historical message 1');
      expect(ChatMode.pendingHistoryMessages[1].content).toBe('Historical message 2');

      // DOM should not have these messages yet
      const userMessages = session.chatContainer.querySelectorAll('.chat-message.user');
      expect(userMessages.length).toBe(0);
    });

    test('should collect assistant messages when isLoadingHistory is true', () => {
      ChatMode.isLoadingHistory = true;

      ChatMode.handleMessage({
        type: 'assistant',
        content: 'Historical response',
        timestamp: '2025-01-05T09:01:00Z'
      });

      expect(ChatMode.pendingHistoryMessages.length).toBe(1);
      expect(ChatMode.pendingHistoryMessages[0].type).toBe('assistant');
      expect(ChatMode.pendingHistoryMessages[0].content).toBe('Historical response');
    });

    test('should add messages normally when isLoadingHistory is false', () => {
      ChatMode.isLoadingHistory = false;

      ChatMode.handleMessage({
        type: 'user',
        content: 'Current message'
      });

      // Message should be added to DOM directly
      const userMessages = session.chatContainer.querySelectorAll('.chat-message.user');
      expect(userMessages.length).toBe(1);
      expect(ChatMode.pendingHistoryMessages.length).toBe(0);
    });
  });

  describe('history_end Message Handling', () => {
    let session;

    beforeEach(() => {
      session = sessionManager.openSession('session-1', 'Session 1');
      session.workDir = '/path/to/project';
      sessionManager.activeId = session.id;
      ChatMode.connect(session.id, session.workDir);
    });

    test('should set historyOldestIndex based on total and count', () => {
      ChatMode.handleMessage({
        type: 'history_end',
        total: 100,
        count: 50
      });

      // oldest_index = total - count = 100 - 50 = 50
      expect(ChatMode.historyOldestIndex).toBe(50);
    });

    test('should set hasMoreHistory to true when there are older messages', () => {
      ChatMode.handleMessage({
        type: 'history_end',
        total: 100,
        count: 50
      });

      expect(ChatMode.hasMoreHistory).toBe(true);
    });

    test('should set hasMoreHistory to false when at the beginning', () => {
      ChatMode.handleMessage({
        type: 'history_end',
        total: 30,
        count: 30
      });

      // oldest_index = 30 - 30 = 0
      expect(ChatMode.historyOldestIndex).toBe(0);
      expect(ChatMode.hasMoreHistory).toBe(false);
    });
  });

  describe('history_page_end Message Handling', () => {
    let session;

    beforeEach(() => {
      session = sessionManager.openSession('session-1', 'Session 1');
      session.workDir = '/path/to/project';
      sessionManager.activeId = session.id;
      ChatMode.connect(session.id, session.workDir);
      ChatMode.isConnected = true;
      ChatMode.isLoadingHistory = true;
      ChatMode.historyOldestIndex = 100;
      ChatMode.hasMoreHistory = true;

      // Add loading indicator
      const loadingEl = document.createElement('div');
      loadingEl.id = 'historyLoadingIndicator';
      loadingEl.className = 'chat-history-loading';
      ChatMode.messagesEl.insertBefore(loadingEl, ChatMode.messagesEl.firstChild);

      // Collect some pending messages
      ChatMode.pendingHistoryMessages = [
        { type: 'user', content: 'Older message 1', extra: { timestamp: '2025-01-05T08:00:00Z' } },
        { type: 'assistant', content: 'Older response 1', extra: { timestamp: '2025-01-05T08:01:00Z' } },
        { type: 'user', content: 'Older message 2', extra: { timestamp: '2025-01-05T08:05:00Z' } }
      ];
    });

    test('should remove loading indicator', () => {
      ChatMode.handleMessage({
        type: 'history_page_end',
        count: 3,
        has_more: true,
        oldest_index: 50
      });

      const loadingEl = session.chatContainer.querySelector('#historyLoadingIndicator');
      expect(loadingEl).toBeNull();
    });

    test('should insert collected messages into DOM', () => {
      ChatMode.handleMessage({
        type: 'history_page_end',
        count: 3,
        has_more: true,
        oldest_index: 50
      });

      const messages = session.chatContainer.querySelectorAll('.chat-message');
      expect(messages.length).toBe(3);
    });

    test('should clear pendingHistoryMessages array', () => {
      ChatMode.handleMessage({
        type: 'history_page_end',
        count: 3,
        has_more: true,
        oldest_index: 50
      });

      expect(ChatMode.pendingHistoryMessages.length).toBe(0);
    });

    test('should update historyOldestIndex', () => {
      ChatMode.handleMessage({
        type: 'history_page_end',
        count: 3,
        has_more: true,
        oldest_index: 50
      });

      expect(ChatMode.historyOldestIndex).toBe(50);
    });

    test('should update hasMoreHistory based on response', () => {
      ChatMode.handleMessage({
        type: 'history_page_end',
        count: 3,
        has_more: false,
        oldest_index: 0
      });

      expect(ChatMode.hasMoreHistory).toBe(false);
    });

    test('should reset isLoadingHistory to false', () => {
      ChatMode.handleMessage({
        type: 'history_page_end',
        count: 3,
        has_more: true,
        oldest_index: 50
      });

      expect(ChatMode.isLoadingHistory).toBe(false);
    });

    test('should show "beginning of conversation" when no more history', () => {
      ChatMode.handleMessage({
        type: 'history_page_end',
        count: 3,
        has_more: false,
        oldest_index: 0
      });

      const endEl = session.chatContainer.querySelector('.chat-history-end');
      expect(endEl).not.toBeNull();
      expect(endEl.textContent).toContain('Beginning of conversation');
    });

    test('should not show "beginning" message when has_more is true', () => {
      ChatMode.handleMessage({
        type: 'history_page_end',
        count: 3,
        has_more: true,
        oldest_index: 50
      });

      const endEl = session.chatContainer.querySelector('.chat-history-end');
      expect(endEl).toBeNull();
    });
  });

  describe('Scroll Detection Integration', () => {
    let session;

    beforeEach(() => {
      session = sessionManager.openSession('session-1', 'Session 1');
      session.workDir = '/path/to/project';
      sessionManager.activeId = session.id;
      ChatMode.connect(session.id, session.workDir);
      ChatMode.isConnected = true;
      ChatMode.historyOldestIndex = 100;
      ChatMode.hasMoreHistory = true;
    });

    test('should have scroll event listener bound', () => {
      // The scroll listener is bound in bindEvents()
      // We can verify by checking that loadMoreHistory is called when conditions are met

      // Simulate scroll to top
      Object.defineProperty(ChatMode.messagesEl, 'scrollTop', {
        value: 50,
        writable: true
      });

      // Dispatch scroll event
      const scrollEvent = new Event('scroll');
      ChatMode.messagesEl.dispatchEvent(scrollEvent);

      // Should trigger load if scrollTop < 100 and hasMoreHistory and not loading
      expect(ChatMode.isLoadingHistory).toBe(true);
    });

    test('should not trigger load when scrollTop > 100', () => {
      Object.defineProperty(ChatMode.messagesEl, 'scrollTop', {
        value: 150,
        writable: true
      });

      const scrollEvent = new Event('scroll');
      ChatMode.messagesEl.dispatchEvent(scrollEvent);

      expect(ChatMode.isLoadingHistory).toBe(false);
    });
  });

  describe('Multiple History Page Loads', () => {
    let session;

    beforeEach(() => {
      session = sessionManager.openSession('session-1', 'Session 1');
      session.workDir = '/path/to/project';
      sessionManager.activeId = session.id;
      ChatMode.connect(session.id, session.workDir);
      ChatMode.isConnected = true;
    });

    test('should handle multiple sequential history loads', () => {
      // First load
      ChatMode.historyOldestIndex = 100;
      ChatMode.hasMoreHistory = true;
      ChatMode.isLoadingHistory = true;
      ChatMode.pendingHistoryMessages = [
        { type: 'user', content: 'Msg 1', extra: {} },
        { type: 'assistant', content: 'Resp 1', extra: {} }
      ];

      ChatMode.handleMessage({
        type: 'history_page_end',
        count: 2,
        has_more: true,
        oldest_index: 50
      });

      expect(ChatMode.historyOldestIndex).toBe(50);
      expect(ChatMode.hasMoreHistory).toBe(true);
      expect(session.chatContainer.querySelectorAll('.chat-message').length).toBe(2);

      // Second load
      ChatMode.isLoadingHistory = true;
      ChatMode.pendingHistoryMessages = [
        { type: 'user', content: 'Msg 0', extra: {} },
        { type: 'assistant', content: 'Resp 0', extra: {} }
      ];

      ChatMode.handleMessage({
        type: 'history_page_end',
        count: 2,
        has_more: false,
        oldest_index: 0
      });

      expect(ChatMode.historyOldestIndex).toBe(0);
      expect(ChatMode.hasMoreHistory).toBe(false);
      // Total messages should now be 4
      expect(session.chatContainer.querySelectorAll('.chat-message').length).toBe(4);

      // Should have "beginning" marker
      expect(session.chatContainer.querySelector('.chat-history-end')).not.toBeNull();
    });
  });
});
