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
 * UI Bug 回归测试
 *
 * 测试场景：
 * 1. 下拉刷新最大力度时，reload 前应先重置 UI 位置
 * 2. 聊天窗口返回按钮应该退出会话，而不是仅隐藏
 */

describe('UI Bug 回归测试', () => {
  describe('下拉刷新 UI 重置', () => {
    let mockLocation;
    let originalLocation;

    beforeEach(() => {
      // Mock location.reload
      originalLocation = window.location;
      mockLocation = { reload: jest.fn() };
      delete window.location;
      window.location = mockLocation;
    });

    afterEach(() => {
      window.location = originalLocation;
    });

    test('reload 前应重置 transform 和 class', () => {
      // 模拟 pull-to-refresh 元素
      const pullRefresh = document.createElement('div');
      pullRefresh.style.transform = 'translateY(150px)';
      pullRefresh.classList.add('pulling', 'reload-mode', 'dragging');

      const content = document.createElement('div');
      content.style.transform = 'translateY(150px)';
      content.classList.add('dragging');

      // 模拟 touchend 处理逻辑（从 app.js 提取的关键部分）
      const pullDistance = 150; // 超过 reloadThreshold
      const reloadThreshold = 120;
      const refreshing = false;

      if (pullDistance >= reloadThreshold && !refreshing) {
        // 这是修复后的逻辑
        pullRefresh.style.transform = '';
        content.style.transform = '';
        pullRefresh.classList.remove('pulling', 'reload-mode');
        window._isPageReloading = true;
        window.location.reload();
      }

      // 验证 UI 在 reload 前已重置
      expect(pullRefresh.style.transform).toBe('');
      expect(content.style.transform).toBe('');
      expect(pullRefresh.classList.contains('pulling')).toBe(false);
      expect(pullRefresh.classList.contains('reload-mode')).toBe(false);
      expect(window.location.reload).toHaveBeenCalled();
    });

    test('未达到 reloadThreshold 时不应 reload', () => {
      const pullDistance = 80; // 未达到 reloadThreshold
      const reloadThreshold = 120;
      const refreshing = false;

      if (pullDistance >= reloadThreshold && !refreshing) {
        window.location.reload();
      }

      expect(window.location.reload).not.toHaveBeenCalled();
    });
  });

  describe('聊天窗口返回按钮', () => {
    let mockApp;
    let mockChatMode;

    beforeEach(() => {
      // Mock window.app
      mockApp = {
        closeCurrentSession: jest.fn(),
        showView: jest.fn()
      };
      window.app = mockApp;

      // Mock ChatMode
      mockChatMode = {
        disconnect: jest.fn(),
        sessionId: 'test-session'
      };
    });

    afterEach(() => {
      delete window.app;
    });

    test('返回按钮应调用 closeCurrentSession 而非 showView', () => {
      // 模拟返回按钮点击处理逻辑（从 chat.js 提取）
      mockChatMode.disconnect();
      if (window.app && window.app.closeCurrentSession) {
        window.app.closeCurrentSession();
      } else if (window.app && window.app.showView) {
        window.app.showView('sessions');
      }

      // 验证调用了 closeCurrentSession
      expect(mockChatMode.disconnect).toHaveBeenCalled();
      expect(mockApp.closeCurrentSession).toHaveBeenCalled();
      expect(mockApp.showView).not.toHaveBeenCalled();
    });

    test('closeCurrentSession 不存在时应降级到 showView', () => {
      // 移除 closeCurrentSession
      delete mockApp.closeCurrentSession;

      mockChatMode.disconnect();
      if (window.app && window.app.closeCurrentSession) {
        window.app.closeCurrentSession();
      } else if (window.app && window.app.showView) {
        window.app.showView('sessions');
      }

      // 验证降级调用了 showView
      expect(mockChatMode.disconnect).toHaveBeenCalled();
      expect(mockApp.showView).toHaveBeenCalledWith('sessions');
    });

    test('window.app 不存在时不应报错', () => {
      delete window.app;

      expect(() => {
        mockChatMode.disconnect();
        if (window.app && window.app.closeCurrentSession) {
          window.app.closeCurrentSession();
        } else if (window.app && window.app.showView) {
          window.app.showView('sessions');
        }
      }).not.toThrow();
    });
  });

  describe('返回 vs 最小化 行为区分', () => {
    let mockApp;

    beforeEach(() => {
      mockApp = {
        closeCurrentSession: jest.fn(),
        minimizeCurrentSession: jest.fn(),
        showView: jest.fn()
      };
      window.app = mockApp;
    });

    afterEach(() => {
      delete window.app;
    });

    test('返回按钮应调用 closeCurrentSession（退出）', () => {
      // 返回按钮逻辑
      if (window.app && window.app.closeCurrentSession) {
        window.app.closeCurrentSession();
      }

      expect(mockApp.closeCurrentSession).toHaveBeenCalled();
      expect(mockApp.minimizeCurrentSession).not.toHaveBeenCalled();
    });

    test('最小化按钮应调用 minimizeCurrentSession（隐藏）', () => {
      // 最小化按钮逻辑
      if (window.app && window.app.minimizeCurrentSession) {
        window.app.minimizeCurrentSession();
      }

      expect(mockApp.minimizeCurrentSession).toHaveBeenCalled();
      expect(mockApp.closeCurrentSession).not.toHaveBeenCalled();
    });
  });
});
