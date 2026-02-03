/**
 * Copyright (c) 2025 BillChen
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * WebSocket 模块
 * 提供 Chat WebSocket 连接、消息处理、重连等功能
 */
const AppWebSocket = {
  /**
   * 检查是否启用 WebSocket 多路复用
   */
  isUseMux() {
    if (this._useMux === false) return false;
    return true;
  },

  /**
   * 连接 Chat Session
   * @param {string} workDir - 工作目录
   * @param {string} sessionId - Claude session_id（null 表示新建）
   * @param {string} sessionName - 显示名称
   * @param {string} chatClaudeSessionId - Chat 模式专用的 session ID
   */
  connectSession(workDir, sessionId, sessionName, chatClaudeSessionId) {
    const perfStart = performance.now();
    console.time('[PERF] connectSession TOTAL');
    this.closeCreateModal();

    // Auto-minimize file preview if open (instead of closing)
    if (this._currentPreviewPath && this._currentPreviewName) {
      this.minimizeFilePreview();
    }

    const prevSession = this.currentSession;
    const isNewSession = !sessionId;
    this.debugLog(`=== connectSession START at ${perfStart.toFixed(2)}ms ===`);
    this.debugLog(`connectSession: isNew=${isNewSession}, workDir=${workDir}, sessionId=${sessionId?.substring(0, 8)}, chatSid=${chatClaudeSessionId?.substring(0, 8)}`);

    // 保存当前工作目录和会话信息
    this.currentWorkDir = workDir;
    this.currentSession = sessionId || `new-${Date.now()}`;
    this.currentSessionName = sessionName || this.getLastPathComponent(workDir);
    this.currentClaudeSessionId = sessionId;

    // BUG-003 FIX: 先通过 chatClaudeSessionId 查找已存在的 session
    let existingSession = null;
    if (chatClaudeSessionId) {
      for (const [key, session] of this.sessionManager.sessions) {
        if (session.chatClaudeSessionId === chatClaudeSessionId) {
          this.debugLog(`connectSession: found existing session by chatClaudeSessionId: ${key.substring(0, 8)}, status=${session.status}`);
          existingSession = session;
          this.currentSession = key;
          break;
        }
      }
    }

    // 如果没找到，再尝试直接用 sessionId 查找
    if (!existingSession) {
      existingSession = this.sessionManager.sessions.get(this.currentSession);
    }

    if (existingSession && existingSession.status === 'connected') {
      this.debugLog(`connectSession: session already connected, reuse it`);
      console.log(`[PERF] connectSession: +${(performance.now() - perfStart).toFixed(1)}ms - REUSING existing connected session`);
      this.shouldReconnect = existingSession.shouldReconnect;

      if (chatClaudeSessionId) {
        existingSession.chatClaudeSessionId = chatClaudeSessionId;
      }

      console.time('[PERF] switchTo');
      this.sessionManager.switchTo(this.currentSession);
      console.timeEnd('[PERF] switchTo');

      console.time('[PERF] showChat');
      this.showChat(this.currentSession, existingSession.workDir);
      console.timeEnd('[PERF] showChat');

      const titleEl = document.getElementById('terminal-title');
      if (titleEl && this.currentSessionName) {
        titleEl.textContent = this.currentSessionName;
      }

      this.fetchGitBranch(existingSession.workDir);
      this.restoreContextBarState(existingSession);

      const inputField = document.querySelector('.input-field');
      if (inputField && existingSession.inputValue !== undefined) {
        inputField.value = existingSession.inputValue;
        inputField.dispatchEvent(new Event('input'));
      }

      this.updateConnectStatus('connected', '');
      console.timeEnd('[PERF] connectSession TOTAL');
      console.log(`[PERF] connectSession DONE: TOTAL ${(performance.now() - perfStart).toFixed(1)}ms`);
      return;
    }

    // BUG-003 FIX: 如果找到了 closed 的 session，复用它
    let session;
    console.log(`[PERF] connectSession: +${(performance.now() - perfStart).toFixed(1)}ms - creating NEW session`);
    if (existingSession && existingSession.status === 'closed') {
      this.debugLog(`connectSession: reusing closed session ${this.currentSession.substring(0, 8)}`);
      session = existingSession;
      session.status = 'connecting';
      session.name = this.currentSessionName;
      console.time('[PERF] switchTo (reuse closed)');
      this.sessionManager.switchTo(this.currentSession);
      console.timeEnd('[PERF] switchTo (reuse closed)');
    } else {
      console.time('[PERF] openSession (new)');
      session = this.sessionManager.openSession(this.currentSession, this.currentSessionName);
      console.timeEnd('[PERF] openSession (new)');
    }

    // 保存连接参数到 session
    session.workDir = workDir;
    session.claudeSessionId = sessionId;
    session.chatClaudeSessionId = chatClaudeSessionId;

    this.debugLog(`connectSession: session registered, sessions.size=${this.sessionManager.sessions.size}`);
    console.log(`[PERF] connectSession: +${(performance.now() - perfStart).toFixed(1)}ms - session registered`);

    // 显示 Chat 视图
    console.time('[PERF] showChat (new session)');
    this.showChat(this.currentSession, workDir);
    console.timeEnd('[PERF] showChat (new session)');

    const titleEl = document.getElementById('terminal-title');
    if (titleEl && this.currentSessionName) {
      titleEl.textContent = this.currentSessionName;
    }

    this.fetchGitBranch(workDir);
    this.restoreContextBarState(session);

    console.timeEnd('[PERF] connectSession TOTAL');
    console.log(`[PERF] connectSession DONE: TOTAL ${(performance.now() - perfStart).toFixed(1)}ms`);
  },

  /**
   * 收起当前 session（放入后台，保持连接）
   */
  minimizeCurrentSession() {
    this.debugLog(`minimizeCurrentSession: currentSession=${this.currentSession}`);
    if (!this.currentSession) {
      this.debugLog('minimizeCurrentSession: no current session');
      return;
    }
    this.sessionManager.minimizeCurrent();
    this.debugLog(`minimizeCurrentSession: done, sessions.size=${this.sessionManager.sessions.size}`);
  },

  /**
   * 关闭当前 session（断开连接）
   */
  closeCurrentSession() {
    if (!this.currentSession) {
      this.showView('sessions');
      return;
    }

    const sessionId = this.currentSession;
    this.sessionManager.closeSession(sessionId);
    this.disconnect();
    this.showView('sessions');
  },

  /**
   * 获取并显示 git 分支
   */
  async fetchGitBranch(workDir) {
    const branchEl = document.getElementById('git-branch');
    if (!branchEl) return;

    branchEl.textContent = '';
    const session = this.sessionManager?.sessions.get(this.currentSession);

    if (!workDir) {
      if (session) session.gitBranch = null;
      return;
    }

    try {
      const url = `/api/git/branch?path=${encodeURIComponent(workDir)}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.branch) {
          const branchText = `⎇ ${data.branch}`;
          branchEl.textContent = branchText;
          if (session) session.gitBranch = branchText;
        } else {
          if (session) session.gitBranch = null;
        }
      } else {
        if (session) session.gitBranch = null;
      }
    } catch (e) {
      this.debugLog(`fetchGitBranch error: ${e.message}`);
      if (session) session.gitBranch = null;
    }
  },

  /**
   * 打开当前工作目录（跳转到 Files 页面）
   */
  openWorkingDir() {
    const workDir = this.currentWorkDir;
    if (!workDir) {
      this.showToast(this.t('chat.noWorkDir', 'No working directory'));
      return;
    }

    this.debugLog(`openWorkingDir: ${workDir}`);
    this.showView('sessions');

    const pageOrder = this.getPageOrder();
    const filesPageIndex = pageOrder.indexOf(2);
    if (filesPageIndex >= 0) {
      this.goToPage(filesPageIndex);
    }

    this._currentPath = workDir;
    this._pathHistory = [];
    this.loadFilesDirectory(workDir);
  },

  /**
   * 重命名当前 session
   */
  renameCurrentSession() {
    this.debugLog(`renameCurrentSession called, currentClaudeSessionId=${this.currentClaudeSessionId}, currentSession=${this.currentSession}`);

    const sessionId = this.currentClaudeSessionId;
    if (!sessionId) {
      this.debugLog('renameCurrentSession: no sessionId');
      this.showToast(this.t('chat.noSession', 'No active session'));
      return;
    }

    const session = this.sessionManager?.sessions.get(this.currentSession);
    const currentName = session?.name || '';

    if (typeof this.showRenameDialog !== 'function') {
      this.debugLog('renameCurrentSession: ERROR - showRenameDialog is not a function');
      this.showToast('Error: showRenameDialog not available');
      return;
    }

    this.showRenameDialog(sessionId, currentName, (newName) => {
      const titleEl = document.getElementById('terminal-title');
      if (titleEl) {
        titleEl.textContent = newName;
      }

      if (session) {
        session.name = newName;
      }

      if (this.refreshPinnedSessions) {
        this.refreshPinnedSessions();
      }

      this.showToast(this.t('sessions.renamed', 'Session renamed'));
    });
  },

  /**
   * 断开连接
   */
  disconnect() {
    this.debugLog('disconnect called');
    this.shouldReconnect = false;
    this.isConnecting = false;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    this.currentSession = null;
  }
};

// 为兼容性保留 connectTerminal 别名
AppWebSocket.connectTerminal = AppWebSocket.connectSession;

// 导出到全局
window.AppWebSocket = AppWebSocket;
