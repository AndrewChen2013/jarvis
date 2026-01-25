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
 * 提供 WebSocket 连接、消息处理、重连等功能
 */
const AppWebSocket = {
  /**
   * 检查是否启用 WebSocket 多路复用
   * 返回 true 使用单一 WebSocket 连接处理所有会话
   * 返回 false 使用传统的每会话一个 WebSocket 连接
   * 可通过 window.app._useMux = false 动态禁用
   */
  isUseMux() {
    // 检查是否被显式禁用
    if (this._useMux === false) return false;
    // 默认启用
    return true;
  },
  /**
   * 连接终端（新版 - 直接使用 Claude session）
   * @param {string} workDir - 工作目录
   * @param {string} sessionId - Claude session_id（null 表示新建）
   * @param {string} sessionName - 显示名称
   * @param {string} chatClaudeSessionId - Chat 模式专用的 session ID
   */
  connectTerminal(workDir, sessionId, sessionName, chatClaudeSessionId) {
    this.closeCreateModal();

    // ========== 关键日志：记录调用时的状态 ==========
    const prevSession = this.currentSession;
    const prevWorkDir = this.currentWorkDir;
    const isNewSession = !sessionId;
    this.debugLog(`=== connectTerminal START ===`);
    this.debugLog(`connectTerminal: isNew=${isNewSession}, workDir=${workDir}, sessionId=${sessionId?.substring(0, 8)}, chatSid=${chatClaudeSessionId?.substring(0, 8)}`);
    this.debugLog(`connectTerminal: prev session=${prevSession?.substring(0, 8)}, prev workDir=${prevWorkDir}`);

    // 保存当前工作目录和会话信息
    this.currentWorkDir = workDir;
    this.currentSession = sessionId || `new-${Date.now()}`;
    this.currentSessionName = sessionName || this.getLastPathComponent(workDir);
    this.currentClaudeSessionId = sessionId;

    this.debugLog(`connectTerminal: AFTER - session=${this.currentSession?.substring(0, 8)}, claudeSessionId=${sessionId?.substring(0, 8)}, workDir=${workDir}`);
    if (prevSession && prevSession !== this.currentSession) {
      this.debugLog(`connectTerminal: SESSION SWITCH detected! ${prevSession?.substring(0, 8)} -> ${this.currentSession?.substring(0, 8)}`);
    }

    // BUG-003 FIX: 先通过 chatClaudeSessionId 查找已存在的 session
    // 当从 session 列表打开时，传入的 sessionId 是 Claude CLI session ID，
    // 但 sessionManager.sessions 的 key 是 terminal session ID，所以直接 get 找不到
    // 需要遍历查找 chatClaudeSessionId 匹配的 session
    let existingSession = null;
    if (chatClaudeSessionId) {
      for (const [key, session] of this.sessionManager.sessions) {
        if (session.chatClaudeSessionId === chatClaudeSessionId && session.status === 'connected') {
          this.debugLog(`connectTerminal: found existing session by chatClaudeSessionId: ${key.substring(0, 8)}`);
          existingSession = session;
          // 更新 currentSession 为找到的 session 的 key
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
      this.debugLog(`connectTerminal: session already connected, reuse it`);

      // 恢复 app 层面的状态
      this.terminal = existingSession.terminal;
      this.shouldReconnect = existingSession.shouldReconnect;

      // 如果传入了新的 chatClaudeSessionId，更新它
      if (chatClaudeSessionId) {
        existingSession.chatClaudeSessionId = chatClaudeSessionId;
      }

      // 切换到该 session
      this.sessionManager.switchTo(this.currentSession);

      // 显示默认视图（Chat 模式为默认）
      this.showChat(this.currentSession, existingSession.workDir);

      // 设置终端标题
      const titleEl = document.getElementById('terminal-title');
      if (titleEl && this.currentSessionName) {
        titleEl.textContent = this.currentSessionName;
      }

      // 获取并显示 git 分支
      this.fetchGitBranch(existingSession.workDir);

      // 恢复 context bar 状态
      this.restoreContextBarState(existingSession);

      // 恢复输入框内容
      const inputField = document.querySelector('.input-field');
      if (inputField && existingSession.inputValue !== undefined) {
        inputField.value = existingSession.inputValue;
        inputField.dispatchEvent(new Event('input'));
        this.debugLog(`connectTerminal: restored input: "${existingSession.inputValue.substring(0, 20)}..."`);
      }

      // 更新连接状态显示
      this.updateConnectStatus('connected', '');
      return;
    }

    // 清除旧的全局 terminal 引用（每个 session 有自己的 terminal）
    this.terminal = null;

    // 注册到 SessionManager（支持多 session 后台运行）
    const session = this.sessionManager.openSession(this.currentSession, this.currentSessionName);

    // 保存连接参数到 session（每个 session 独立）
    session.workDir = workDir;
    session.claudeSessionId = sessionId;
    session.terminalSessionId = sessionId;  // Terminal 专用，不被 Chat 覆盖
    session.chatClaudeSessionId = chatClaudeSessionId; // Chat 专用

    this.debugLog(`connectTerminal: session registered, sessions.size=${this.sessionManager.sessions.size}`);

    // 显示默认视图（Chat 模式为默认）
    this.showChat(this.currentSession, workDir);

    // 设置终端标题为会话名称
    const titleEl = document.getElementById('terminal-title');
    if (titleEl && this.currentSessionName) {
      titleEl.textContent = this.currentSessionName;
    }

    // 获取并显示 git 分支
    this.fetchGitBranch(workDir);

    // 恢复 context bar 状态（新建 session 默认收起）
    this.restoreContextBarState(session);

    // 清空主容器中的旧内容（除了 session 容器）
    const terminalOutput = document.getElementById('terminal-output');
    if (terminalOutput) {
      // 移除非 session-container 的子元素（如连接状态显示）
      Array.from(terminalOutput.children).forEach(child => {
        if (!child.classList.contains('terminal-session-container')) {
          child.remove();
        }
      });
    }

    // initTerminal 会在 fit 完成后调用 connectWebSocket
    this.initTerminal();
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

    // 使用 SessionManager 收起
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

    // 从 SessionManager 关闭
    this.sessionManager.closeSession(sessionId);

    // 清理 app 层面的状态
    this.disconnect();
    this.showView('sessions');
  },

  /**
   * 连接会话
   */
  async connectSession(sessionId, sessionName = '') {
    this.debugLog('connectSession: ' + sessionId + ', lock=' + this.isConnecting + ', ws=' + (this.ws ? this.ws.readyState : 'null'));

    // 保存会话名称
    this.currentSessionName = sessionName || sessionId.substring(0, 8);

    // 检查 SessionManager 中是否已有此 session
    if (this.sessionManager.isSessionOpen(sessionId)) {
      this.debugLog('Session already in background, switch to it');
      const session = this.sessionManager.sessions.get(sessionId);

      // 详细记录 session 状态
      this.debugLog(`connectSession: session state - status=${session.status}, terminal=${session.terminal ? 'exists' : 'NULL'}, container=${session.container ? session.container.id : 'NULL'}`);
      this.debugLog(`connectSession: session params - workDir=${session.workDir}, claudeSessionId=${session.claudeSessionId?.substring(0, 8)}`);

      // 恢复 app 层面的状态（从 session 中恢复完整状态）
      this.currentSession = sessionId;
      this.terminal = session.terminal;
      this.currentWorkDir = session.workDir;
      this.currentClaudeSessionId = session.claudeSessionId;
      this.shouldReconnect = session.shouldReconnect;

      // 切换到该 session
      this.sessionManager.switchTo(sessionId);

      // 检查 session 状态，如果未连接需要重连
      if (session.status !== 'connected') {
        this.debugLog(`connectSession: session not connected (status=${session.status}), trigger reconnect`);
        session.shouldReconnect = true;
        this.attemptReconnectForSession(session);
      }

      // 直接切换视图，不清空终端容器（已有终端）
      // 根据 session.viewMode 决定显示哪个视图（chat 或 terminal）
      const viewMode = session.viewMode || 'chat';

      // 如果是 chat 模式，需要先设置 chatSessionId 和 chatWorkingDir
      // 否则 showView('chat') 中的 ChatMode.connect() 不会被调用
      // 使用 sessionId（SessionManager 的键）而不是 claudeSessionId
      if (viewMode === 'chat') {
        this.chatSessionId = sessionId;
        this.chatWorkingDir = session.workDir;
        this.debugLog(`connectSession: setting chat params - chatSessionId=${this.chatSessionId?.substring(0, 8)}, chatWorkingDir=${this.chatWorkingDir}`);
      }

      this.showView(viewMode);

      // 更新标题
      const titleEl = document.getElementById('terminal-title');
      if (titleEl) {
        titleEl.textContent = this.currentSessionName;
      }

      // 更新连接状态显示
      if (session.status === 'connected') {
        const statusEl = document.getElementById('connection-status');
        if (statusEl) {
          statusEl.textContent = '';  // 已连接时不显示文字
          statusEl.className = 'connection-status connected';
        }
        const dot = document.getElementById('connection-dot');
        if (dot) {
          dot.className = 'connection-dot connected';
        }
      }

      // 恢复 context bar 展开状态
      this.restoreContextBarState(session);

      // 恢复输入框内容（在 showView 之后，确保输入框已创建）
      const inputField = document.querySelector('.input-field');
      if (inputField && session.inputValue !== undefined) {
        inputField.value = session.inputValue;
        inputField.dispatchEvent(new Event('input'));
        this.debugLog(`connectSession: restored input for ${sessionId.substring(0, 8)}: "${session.inputValue.substring(0, 20)}..."`);
      }

      // 立即显示缓存的 context（无闪烁）
      const cachedContext = session.getCachedContext();
      if (cachedContext) {
        this.renderContextBar(cachedContext);
      }

      // 异步刷新最新 context 数据（如果缓存过期）
      if (session.isContextStale()) {
        session.loadContext(this.token).then(data => {
          // 确保仍是当前活跃 session
          if (data && this.sessionManager.activeId === sessionId) {
            this.renderContextBar(data);
          }
        });
      }

      return;
    }

    // 连接锁：防止并发连接
    if (this.isConnecting) {
      this.debugLog('connecting (locked), skip');
      return;
    }

    // 防止重复连接（包括正在连接中的状态）
    if (this.currentSession === sessionId && this.ws) {
      const state = this.ws.readyState;
      if (state === WebSocket.CONNECTING || state === WebSocket.OPEN) {
        this.debugLog('already connecting (ws), skip');
        return;
      }
    }

    // 设置连接锁
    this.isConnecting = true;
    this.debugLog('set connection lock');

    // 创建新的 SessionInstance
    const session = this.sessionManager.openSession(sessionId, this.currentSessionName);

    // 不再关闭旧连接，保持在后台
    // 只重置当前状态
    this.currentSession = sessionId;
    this.outputQueue = [];
    this.terminal = null;
    this.ws = null;

    // 创建 WebSocket
    this.debugLog('create new WebSocket');
    this.connect(sessionId);
    this.debugLog('connectSession done');
  },

  /**
   * 显示终端视图并初始化状态显示
   */
  showTerminalView() {
    this.debugLog('showTerminalView start');
    // 记住当前视图模式为 terminal
    const activeSession = this.sessionManager?.getActive();
    if (activeSession) {
      activeSession.viewMode = 'terminal';
    }
    this.showView('terminal');
    this.debugLog('showView done');

    // 设置终端标题为会话名称
    const titleEl = document.getElementById('terminal-title');
    if (titleEl && this.currentSessionName) {
      titleEl.textContent = this.currentSessionName;
    }

    // 获取或创建当前 session 的容器，在里面显示连接状态
    const session = this.currentSession ? this.sessionManager.sessions.get(this.currentSession) : null;
    if (session) {
      const container = this.sessionManager.getOrCreateContainer(session);
      container.style.display = 'block';
      container.innerHTML = `
        <div id="connect-status" class="connect-status">
          <div class="connect-spinner"></div>
          <div class="connect-text">${this.t('status.connecting')}</div>
          <div class="connect-detail"></div>
        </div>
      `;
      this.debugLog('showTerminalView: show connect status in session container');
    } else {
      // 兼容：没有 session 时使用主容器
      const terminalContainer = document.getElementById('terminal-output');
      if (terminalContainer) {
        terminalContainer.innerHTML = `
          <div id="connect-status" class="connect-status">
            <div class="connect-spinner"></div>
            <div class="connect-text">${this.t('status.connecting')}</div>
            <div class="connect-detail"></div>
          </div>
        `;
      }
      this.debugLog('showTerminalView: show connect status in main container');
    }
    this.debugLog('showTerminalView done');
  },

  /**
   * 手动重试连接（用户点击触发，不经过延迟）
   */
  manualRetryConnect() {
    if (!this.currentSession) return;

    // 捕获当前 sessionId，防止后续操作时变化
    const capturedSessionId = this.currentSession;
    this.debugLog(`manual retry: create WebSocket for ${capturedSessionId?.substring(0, 8)}`);
    this.updateConnectStatus('connecting', this.t('status.manualRetry'));

    // 清理旧连接
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }

    // 构建新的 WebSocket URL
    let wsUrl;
    if (this.currentWorkDir) {
      const params = new URLSearchParams({
        working_dir: this.currentWorkDir
      });
      if (this.currentClaudeSessionId) {
        params.append('session_id', this.currentClaudeSessionId);
      }
      // 添加终端大小参数
      if (this.terminal) {
        const size = this.terminal.getSize();
        params.append('rows', size.rows);
        params.append('cols', Math.max(size.cols - 0, 20));
        this.debugLog(`manual retry: sending size ${size.rows}x${size.cols}`);
      }
      wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/terminal?${params.toString()}`;
    } else {
      // 兼容旧版
      wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/${capturedSessionId}?token=${this.token}`;
    }

    // 直接在点击事件中创建 WebSocket（不使用任何延迟）
    try {
      this.ws = new WebSocket(wsUrl);
      this.debugLog('manual retry: WebSocket created, state=' + this.ws.readyState);
      this.isConnecting = true;
      this.bindWebSocketEvents(capturedSessionId);
    } catch (e) {
      this.debugLog('manual retry: failed ' + e.message);
      this.updateConnectStatus('failed', e.message);
    }
  },

  /**
   * 初始化终端（在 WebSocket 连接成功后调用）
   */
  initTerminal() {
    this.debugLog(`=== initTerminal START ===`);

    // ========== 关键：捕获当前状态，防止 callback 执行时全局变量已变 ==========
    const capturedSessionId = this.currentSession;
    const capturedWorkDir = this.currentWorkDir;
    const capturedClaudeSessionId = this.currentClaudeSessionId;
    this.debugLog(`initTerminal: captured sid=${capturedSessionId?.substring(0, 8)}, claudeSid=${capturedClaudeSessionId?.substring(0, 8)}`);

    // 获取当前 session
    const session = capturedSessionId ? this.sessionManager.sessions.get(capturedSessionId) : null;
    this.debugLog(`initTerminal: session=${session ? session.id.substring(0, 8) : 'null'}`);

    // 检查当前 session 是否已有终端（而不是检查全局 this.terminal）
    if (session && session.terminal) {
      this.debugLog(`initTerminal: session ${capturedSessionId?.substring(0, 8)} already has terminal, reuse it`);
      this.terminal = session.terminal;
      // 确保容器显示
      if (session.container) {
        session.container.style.display = 'block';
      }
      this.flushOutputQueue();
      // 复用 terminal 时，terminal 已经 fit 过了，直接连接
      this.debugLog(`initTerminal: reuse terminal, connect WebSocket with CAPTURED params`);
      this.connectWebSocket(capturedWorkDir, capturedClaudeSessionId);
      return;
    }

    // 获取或创建 session 专属容器
    let container;
    if (session) {
      container = this.sessionManager.getOrCreateContainer(session);
      container.style.display = 'block';
      container.innerHTML = ''; // 清空状态显示
      this.debugLog(`initTerminal: use session container ${container.id}`);
    } else {
      // 兼容：没有 session 时使用主容器
      container = document.getElementById('terminal-output');
      if (container) {
        container.innerHTML = '';
      }
      this.debugLog('initTerminal: use main container');
    }

    if (!container) {
      this.debugLog('initTerminal: ERROR - container not found!');
      return;
    }

    try {
      this.debugLog(`initTerminal: creating TerminalWrapper...`);
      this.terminal = new TerminalWrapper(container, () => {
        // ========== 关键：callback 使用捕获的参数，不使用 this.xxx ==========
        this.debugLog(`=== TerminalWrapper onReady ===`);
        this.debugLog(`onReady: captured sid=${capturedSessionId?.substring(0, 8)}, current sid=${this.currentSession?.substring(0, 8)}`);

        // 检查 session 是否已切换
        if (this.currentSession !== capturedSessionId) {
          this.debugLog(`onReady: WARNING! Session switched!`);
        }

        // 终端就绪后（fit 完成后）
        this.flushOutputQueue();

        // fit 完成后再建立 WebSocket 连接，使用捕获的参数！
        this.debugLog(`onReady: calling connectWebSocket with claudeSid=${capturedClaudeSessionId?.substring(0, 8)}`);
        this.connectWebSocket(capturedWorkDir, capturedClaudeSessionId);
      });
      this.debugLog(`initTerminal: TerminalWrapper created`);

      // 保存 terminal 到 SessionManager
      if (session) {
        session.terminal = this.terminal;
        this.debugLog(`initTerminal: save terminal to session ${capturedSessionId?.substring(0, 8)}`);

        // 加载或分配主题
        this.loadOrAssignTheme(session);
      }
    } catch (error) {
      this.debugLog(`initTerminal: ERROR - ${error.message}`);
      container.innerHTML = '<div style="color:red;padding:20px;">' + this.t('terminal.initError', 'Terminal init failed: ') + error.message + '</div>';
    }
  },

  /**
   * 刷新输出队列（包括全局队列和 session 专属队列）
   */
  flushOutputQueue() {
    // 刷新全局队列（兼容旧逻辑）
    if (this.outputQueue.length > 0 && this.terminal) {
      this.debugLog(`flushOutputQueue: global ${this.outputQueue.length} items`);
      const combined = this.outputQueue.join('');
      this.outputQueue = [];
      try {
        this.terminal.write(combined);
      } catch (error) {
        this.debugLog(`flushOutputQueue: global error - ${error.message}`);
      }
    }

    // 刷新当前 session 的专属队列
    const session = this.currentSession ? this.sessionManager.sessions.get(this.currentSession) : null;
    if (session && session.outputQueue && session.outputQueue.length > 0 && session.terminal) {
      this.debugLog(`flushOutputQueue: session ${session.id.substring(0, 8)} ${session.outputQueue.length} items`);
      const combined = session.outputQueue.join('');
      session.outputQueue = [];
      try {
        session.terminal.write(combined);
      } catch (error) {
        this.debugLog(`flushOutputQueue: session error - ${error.message}`);
      }
    }
  },

  /**
   * 连接 WebSocket（新版）
   * @param {boolean} isReconnect - 是否是重连，重连时不重置计数器
   */
  connectWebSocket(workDir, sessionId, isReconnect = false) {
    this.debugLog(`=== connectWebSocket START ===`);
    const useMux = this.isUseMux();
    this.debugLog(`connectWebSocket: claudeSid=${sessionId?.substring(0, 8)}, isReconnect=${isReconnect}, useMux=${useMux}`);
    this.debugLog(`connectWebSocket: currentSession=${this.currentSession?.substring(0, 8)}`);

    // 如果启用多路复用，使用 muxWs
    if (useMux && window.muxWs) {
      this.connectWebSocketMux(workDir, sessionId, isReconnect);
      return;
    }

    // 检查连接锁，避免重复连接
    if (this.isConnecting) {
      this.debugLog('connectWebSocket: BLOCKED by isConnecting lock!');
      return;
    }

    if (!isReconnect) {
      this.reconnectAttempts = 0;
    }

    // 设置连接锁
    this.isConnecting = true;

    // 构建新的 WebSocket URL（不包含 token，token 通过消息认证）
    const params = new URLSearchParams({
      working_dir: workDir
    });
    if (sessionId) {
      params.append('session_id', sessionId);
    }

    // 获取终端大小并添加到 URL（让后端在连接时检查是否需要 resize）
    this.debugLog(`connectWebSocket: this.terminal=${this.terminal ? 'exists' : 'NULL'}`);
    if (this.terminal) {
      const size = this.terminal.getSize();
      const adjustedCols = Math.max(size.cols - 0, 20);
      params.append('rows', size.rows);
      params.append('cols', adjustedCols);
      this.debugLog(`connectWebSocket: sending size ${size.rows}x${adjustedCols}`);
    } else {
      this.debugLog('connectWebSocket: WARNING - no terminal, cannot send size!');
    }

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/terminal?${params.toString()}`;
    this.debugLog('WebSocket URL: ' + wsUrl);

    // 使用通用连接逻辑
    this._doConnect(wsUrl);
  },

  /**
   * 使用多路复用 WebSocket 连接终端
   * @param {string} workDir - 工作目录
   * @param {string} sessionId - Claude session_id
   * @param {boolean} isReconnect - 是否是重连
   */
  connectWebSocketMux(workDir, sessionId, isReconnect = false) {
    this.debugLog(`=== connectWebSocketMux START ===`);
    this.debugLog(`connectWebSocketMux: workDir=${workDir}, sessionId=${sessionId?.substring(0, 8)}, isReconnect=${isReconnect}`);

    // 注意：mux 模式下不使用 app 级别的 reconnectAttempts
    // 重连逻辑由 MuxWebSocket（连接级别）和 session.reconnectAttempts（session 级别）处理

    // 获取终端大小
    let rows = 40, cols = 120;
    if (this.terminal) {
      const size = this.terminal.getSize();
      rows = size.rows;
      cols = Math.max(size.cols - 0, 20);
      this.debugLog(`connectWebSocketMux: terminal size ${rows}x${cols}`);
    }

    // 使用当前会话 ID 作为多路复用的 session_id
    const muxSessionId = this.currentSession;
    this.debugLog(`connectWebSocketMux: muxSessionId=${muxSessionId?.substring(0, 8)}`);

    // 绑定到 SessionManager 的 session
    const session = this.sessionManager.sessions.get(muxSessionId);

    // 设置 muxWs token
    window.muxWs.token = this.token;

    // 连接到终端
    window.muxWs.connectTerminal(muxSessionId, workDir, {
      rows,
      cols,
      onConnect: (data) => {
        this.debugLog(`[MuxWS] Terminal connected: ${data.terminal_id?.substring(0, 8)}`);
        this.debugLog(`[MuxWS] Original session_id: ${muxSessionId?.substring(0, 8)}`);

        // 更新连接状态
        this.shouldReconnect = true;
        this.updateConnectStatus('connected', '');

        // BUG FIX: Update session status to 'connected'
        // Without this, switchToTerminalMode would think the session is not connected
        // and create a new terminal, overwriting terminalSessionId
        if (session) {
          session.status = 'connected';
          this.debugLog(`[MuxWS] Updated session.status to connected`);
        }

        // 如果服务端返回了不同的 session_id，需要更新 SessionManager
        const serverSessionId = data.terminal_id;
        if (serverSessionId && serverSessionId !== muxSessionId) {
          this.debugLog(`[MuxWS] Session ID changed: ${muxSessionId?.substring(0, 8)} -> ${serverSessionId?.substring(0, 8)}`);

          // 在 SessionManager 中重命名 session
          const renameOk = this.sessionManager.renameSession(muxSessionId, serverSessionId);
          this.debugLog(`[MuxWS] Rename result: ${renameOk}`);

          if (renameOk) {
            // 更新 currentSession（如果是当前活跃会话）
            if (this.currentSession === muxSessionId) {
              this.currentSession = serverSessionId;
              this.debugLog(`[MuxWS] Updated currentSession`);
            }

            // 获取重命名后的 session
            const renamedSession = this.sessionManager.sessions.get(serverSessionId);
            if (renamedSession) {
              renamedSession.claudeSessionId = serverSessionId;
              renamedSession.terminalSessionId = serverSessionId;  // Terminal 专用
              renamedSession.status = 'connected';  // BUG FIX: Also set status after rename
            }
          }
        } else if (session) {
          // Session ID 未变，只更新 claudeSessionId
          session.claudeSessionId = serverSessionId;
          session.terminalSessionId = serverSessionId;  // Terminal 专用
          session.status = 'connected';  // BUG FIX: Ensure status is set
          this.debugLog(`[MuxWS] Updated claudeSessionId: ${serverSessionId?.substring(0, 8)}`);
        }
      },
      onMessage: (type, data) => {
        // 使用 this.currentSession 而不是闭包捕获的 muxSessionId
        // 因为 session ID 可能在连接后被服务端重命名
        this._handleMuxMessage(this.currentSession, type, data);
      },
      onDisconnect: () => {
        // 获取当前实际的 session（可能已被重命名）
        const currentSid = this.currentSession;
        this.debugLog(`[MuxWS] Terminal disconnected: ${currentSid?.substring(0, 8)}`);

        // 更新连接状态
        this.updateConnectStatus('disconnected', '');

        // 更新 session 状态
        const currentSession = this.sessionManager.sessions.get(currentSid);
        if (currentSession) {
          currentSession.status = 'disconnected';
        }

        // 触发重连（如果需要）
        // BUG-012 FIX: Use attemptReconnectForSession instead of undefined _scheduleReconnect
        if (this.shouldReconnect && currentSession?.shouldReconnect !== false) {
          this.debugLog(`[MuxWS] Will attempt reconnect for ${currentSid?.substring(0, 8)}`);
          this.attemptReconnectForSession(currentSession);
        }
      }
    });

    // 保存引用到 session（用于切换时恢复）
    if (session) {
      session.usingMux = true;
    }
  },

  /**
   * 处理来自多路复用连接的消息
   */
  _handleMuxMessage(sessionId, type, data) {
    // 只处理当前活跃 session 的消息
    if (sessionId !== this.currentSession) {
      this.debugLog(`[MuxWS] Ignore message for inactive session ${sessionId?.substring(0, 8)}`);
      return;
    }

    if (type === 'output') {
      // 终端输出
      if (this.terminal && data.text) {
        this.terminal.write(data.text);
      }
    } else if (type === 'connected') {
      // 已处理，但这里可以做额外操作
    } else if (type === 'error') {
      this.debugLog(`[MuxWS] Error: ${data.message}`);
      this.updateConnectStatus('failed', data.message);
    }
  },

  /**
   * 发送终端输入（支持多路复用）
   */
  sendTerminalInput(data) {
    if (this.isUseMux() && window.muxWs && this.currentSession) {
      window.muxWs.terminalInput(this.currentSession, data);
    } else {
      this.sendMessage({ type: 'input', data });
    }
  },

  /**
   * 发送终端 resize（支持多路复用）
   */
  sendTerminalResize(rows, cols) {
    if (this.isUseMux() && window.muxWs && this.currentSession) {
      window.muxWs.terminalResize(this.currentSession, rows, cols);
    } else {
      this.sendMessage({ type: 'resize', rows, cols });
    }
  },

  /**
   * 旧版连接方法（兼容）
   * @deprecated
   * @param {boolean} isReconnect - 是否是重连，重连时不重置计数器
   */
  connect(sessionId, isReconnect = false) {
    this.debugLog('connect() 开始 (legacy)');
    if (!isReconnect) {
      this.reconnectAttempts = 0;
    }

    // 如果有 currentWorkDir，使用新端点
    if (this.currentWorkDir) {
      this.connectWebSocket(this.currentWorkDir, this.currentClaudeSessionId, isReconnect);
      return;
    }

    // 旧路径也需要连接锁保护
    if (this.isConnecting) {
      this.debugLog('connect: already connecting, skip');
      return;
    }
    this.isConnecting = true;

    // 否则使用旧端点（兼容）- 注意：旧端点已废弃，后端会拒绝连接
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/${sessionId}`;
    this.debugLog('WebSocket URL (legacy): ' + wsUrl);
    this._doConnect(wsUrl);
  },

  /**
   * 实际的 WebSocket 连接逻辑
   *
   * 【iOS 26 Safari WebSocket Bug 说明】
   * 在 iOS 26 beta 的 Safari 中，WebSocket 连接本地网络地址时会永久卡在 CONNECTING 状态，
   * onopen/onerror/onclose 回调都不触发。奇怪的是，切换到其他 App 再切回来时连接会突然成功。
   *
   * 解决方案：二次连接法
   * 1. 第一次创建 WebSocket，它会卡住但能"激活"网络栈
   * 2. 等待 1 秒后检查状态，如果仍在 CONNECTING，关闭第一个连接
   * 3. 创建第二个 WebSocket，这次能正常连接
   */
  _doConnect(wsUrl) {
    this.debugLog(`=== _doConnect START ===`);
    // 保存当前连接的 URL 和 sessionId，用于后续检查（防止切换 session 后串台）
    this._currentConnectUrl = wsUrl;
    const capturedSessionId = this.currentSession;  // 捕获当前 sessionId
    this.debugLog(`_doConnect: capturedSid=${capturedSessionId?.substring(0, 8)}`);
    this.debugLog(`_doConnect: url=${wsUrl.substring(0, 80)}...`);

    // 检测是否是 iOS Safari（只在 iOS Safari 上使用 workaround）
    const isIOSSafari = /iPad|iPhone|iPod/.test(navigator.userAgent) &&
                        /Safari/.test(navigator.userAgent) &&
                        !/Chrome|CriOS|FxiOS/.test(navigator.userAgent);
    this.debugLog(`_doConnect: isIOSSafari=${isIOSSafari}`);

    // 创建 WebSocket 连接
    this.debugLog('WebSocket create');
    try {
      this.ws = new WebSocket(wsUrl);
      this.debugLog('create ok, state=' + this.ws.readyState);
    } catch (e) {
      this.debugLog('create failed: ' + e.message);
      this.isConnecting = false;
      return;
    }

    // ====== iOS Safari Workaround: 二次连接法 ======
    // 只在 iOS Safari 上启用，避免其他平台的延迟
    if (isIOSSafari) {
      const firstWs = this.ws;

      // 300ms 后检查：如果仍卡在 CONNECTING，关闭并创建第二个连接
      setTimeout(() => {
        // BUG-F5 FIX: Check if ws was already replaced (e.g., by rapid reconnect or onopen processing)
        if (this.ws !== firstWs) {
          this.debugLog('iOS: ws already replaced, skip workaround');
          return;
        }

        // 确保仍在 CONNECTING 状态（not OPEN - onopen may have fired）
        if (firstWs.readyState === WebSocket.CONNECTING) {
          this.debugLog('iOS: 1st still CONNECTING after 300ms, close and retry');
          // 先移除事件处理器，避免 onclose 触发额外的重连
          firstWs.onopen = null;
          firstWs.onclose = null;
          firstWs.onerror = null;
          firstWs.onmessage = null;
          try { firstWs.close(); } catch (e) {}
          this.debugLog('iOS: 1st ws closed cleanly');
          this.ws = null;

          // 检查 URL 和 sessionId 是否仍然匹配
          if (this._currentConnectUrl !== wsUrl) {
            this.debugLog('URL changed, skip 2nd connect');
            this.isConnecting = false;
            return;
          }
          if (this.currentSession !== capturedSessionId) {
            this.debugLog(`Session changed, skip 2nd connect`);
            this.isConnecting = false;
            return;
          }

          // 第二次连接
          this.debugLog('iOS: 2nd WebSocket create');
          try {
            this.ws = new WebSocket(wsUrl);
            this.debugLog('iOS: 2nd create ok, state=' + this.ws.readyState);
            this.bindWebSocketEvents(capturedSessionId);
          } catch (e) {
            this.debugLog('iOS: 2nd create failed: ' + e.message);
            this.isConnecting = false;
            this.updateConnectStatus('failed', e.message);
          }
        } else if (firstWs.readyState === WebSocket.OPEN) {
          // BUG-F5 FIX: Connection succeeded during the 300ms, no need for workaround
          this.debugLog('iOS: 1st ws already OPEN, workaround not needed');
        }
      }, 300);
    }
    // ====== End iOS Safari Workaround ======

    // 绑定事件到 WebSocket 实例（使用捕获的 sessionId）
    this.bindWebSocketEvents(capturedSessionId);
  },

  /**
   * 绑定 WebSocket 事件
   * @param {string} overrideSessionId - 可选，强制使用指定的 sessionId（防止串台）
   */
  bindWebSocketEvents(overrideSessionId = null) {
    if (!this.ws) return;

    // 优先使用传入的 sessionId，避免 this.currentSession 已经变化导致串台
    const sessionId = overrideSessionId || this.currentSession;
    const boundWs = this.ws;  // 捕获当前 ws 引用，用于 onclose 判断
    this.debugLog(`bindWebSocketEvents: sessionId=${sessionId?.substring(0, 8)}, override=${!!overrideSessionId}`);

    // 设置接收二进制数据
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.debugLog(`=== WS onopen ===`);
      this.debugLog(`onopen: handlerSid=${sessionId?.substring(0, 8)}, currentSid=${this.currentSession?.substring(0, 8)}`);
      this.isConnecting = false;
      this.shouldReconnect = true;
      this.reconnectAttempts = 0;

      // 立即发送认证消息（必须是连接后的第一条消息）
      this.debugLog('onopen: sending auth...');
      this.sendMessage({ type: 'auth', token: this.token });

      // 清理重连计时器，避免重复连接
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }

      // 保存状态到 SessionManager（每个 session 独立）
      const session = this.sessionManager.sessions.get(sessionId);
      if (session) {
        session.status = 'connected';
        session.shouldReconnect = true;
        session.reconnectAttempts = 0;
        if (session.reconnectTimeout) {
          clearTimeout(session.reconnectTimeout);
          session.reconnectTimeout = null;
        }
      }

      // 更新连接状态（终端已在 connectTerminal 中创建，不需要再调用 showTerminalView）
      this.debugLog('Connection success');
      this.updateConnectStatus('connected', '');

      // 更新悬浮按钮
      if (this.floatingButton) {
        this.floatingButton.update();
      }

      // 加载 Context 信息
      if (this.loadContextInfo) {
        this.loadContextInfo();
      }

      // 注意：不再需要前端触发 resize
      // 后端在连接时已根据 URL 参数中的 rows/cols 检查并处理
    };

    this.ws.onmessage = (event) => {
      // 解析消息：支持 MessagePack 二进制和 JSON 文本
      let message;
      try {
        if (event.data instanceof ArrayBuffer) {
          // MessagePack 二进制消息
          message = MessagePack.decode(new Uint8Array(event.data));
        } else {
          // JSON 文本消息（兼容旧版本）
          message = JSON.parse(event.data);
        }
      } catch (e) {
        this.debugLog(`onmessage: parse error - ${e.message}`);
        return;
      }
      // 使用捕获的 sessionId，确保消息写入正确的 session 终端
      this.handleMessage(message, sessionId);
    };

    this.ws.onerror = (error) => {
      this.debugLog('onerror triggered');
      this.isConnecting = false;
      this.updateConnectStatus('error', this.t('status.checkNetwork'));
    };

    this.ws.onclose = (event) => {
      const codeNames = {
        1000: 'Normal Closure',
        1001: 'Going Away',
        1002: 'Protocol Error',
        1003: 'Unsupported Data',
        1005: 'No Status Received',
        1006: 'Abnormal Closure',
        1007: 'Invalid Payload',
        1008: 'Policy Violation',
        1009: 'Message Too Big',
        1010: 'Missing Extension',
        1011: 'Internal Error',
        1012: 'Service Restart',
        1013: 'Try Again Later',
        1015: 'TLS Handshake'
      };
      this.debugLog(`=== WS onclose ===`);
      this.debugLog(`onclose: code=${event.code} (${codeNames[event.code] || 'Unknown'}), handlerSid=${sessionId?.substring(0, 8)}`);

      // 获取断开连接的 session（使用闭包捕获的 sessionId，而不是 this.currentSession）
      const session = this.sessionManager.sessions.get(sessionId);

      // 检查断开的是否是当前活跃的 session
      const isCurrentSession = (boundWs === this.ws && sessionId === this.currentSession);
      this.debugLog(`onclose: isCurrentSession=${isCurrentSession}, boundWs===this.ws: ${boundWs === this.ws}`);

      // 更新 SessionManager 中该 session 的状态
      if (session) {
        session.status = 'disconnected';
      }

      // 1008 = Invalid token，需要重新登录
      if (event.code === 1008) {
        this.debugLog(`Token invalid, redirect to login`);
        this.handleUnauthorized();
        return;
      }

      // 只有当前活跃 session 断开时才更新 UI
      if (isCurrentSession) {
        this.isConnecting = false;
        this.updateConnectStatus('disconnected', `${this.t('status.code')}: ${event.code}`);
        this.updateStatus(this.t('status.disconnected'), false);

        if (this.heartbeatInterval) {
          clearInterval(this.heartbeatInterval);
          this.heartbeatInterval = null;
        }
      }

      // 使用 session 自己的重连状态（不再依赖全局变量）
      // 无论是前台还是后台 session 都可以独立重连
      if (session && session.shouldReconnect && event.code !== 1000) {
        this.debugLog(`Triggering auto reconnect for session ${sessionId.substring(0, 8)}`);
        this.attemptReconnectForSession(session);
      } else if (event.code === 1000) {
        this.debugLog(`Normal closure, no auto reconnect`);
      } else {
        this.debugLog(`No reconnect: session=${!!session}, shouldReconnect=${session?.shouldReconnect}`);
      }
    };

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendMessage({ type: 'ping' });
      }
    }, 10000);
  },

  /**
   * 处理 WebSocket 消息
   * @param {object} message - 已解析的消息对象
   * @param {string} sessionId - 消息所属的 session ID
   */
  handleMessage(message, sessionId) {
    try {
      // 获取消息对应的 session
      const session = sessionId ? this.sessionManager.sessions.get(sessionId) : null;

      switch (message.type) {
        case 'connecting':
          this.debugLog(`MSG connecting: ${message.message}`);
          this.updateStatus(this.t('status.connecting'), false);
          this.updateConnectStatus('connecting', this.t('status.startingSession'));
          break;

        case 'connected':
          this.debugLog(`=== MSG connected ===`);
          this.debugLog(`connected: terminal_id=${message.terminal_id?.substring(0, 8)}, handlerSid=${sessionId?.substring(0, 8)}, currentSid=${this.currentSession?.substring(0, 8)}`);
          this.updateConnectStatus('connected', '');
          this.updateStatus(this.t('status.connected'), true);

          // 同步前后端的 session ID（解决新建 session 时 ID 不一致的问题）
          // 注意：这里用的是 handler 的 sessionId，不是 this.currentSession
          if (message.terminal_id && message.terminal_id !== sessionId) {
            this.debugLog(`connected: RENAME ${sessionId?.substring(0, 8)} -> ${message.terminal_id?.substring(0, 8)}`);
            const renameOk = this.sessionManager.renameSession(sessionId, message.terminal_id);
            this.debugLog(`connected: rename result=${renameOk}`);
            if (renameOk) {
              // 保存旧 ID 到新 session 的 alias，让后续 output 能找到
              const newSession = this.sessionManager.sessions.get(message.terminal_id);
              if (newSession) {
                newSession._oldId = sessionId;
                // 同步更新 claudeSessionId（Chat 模式 --resume 需要）
                newSession.claudeSessionId = message.terminal_id;
                newSession.terminalSessionId = message.terminal_id;  // Terminal 专用
                this.debugLog(`connected: _oldId alias saved, claudeSessionId updated`);
              } else {
                this.debugLog(`connected: ERROR - newSession not found after rename!`);
              }
              // 只有当 handler 的 sessionId 等于当前活跃 session 时才更新 this.currentSession
              if (sessionId === this.currentSession) {
                this.debugLog(`connected: updating currentSession`);
                this.currentSession = message.terminal_id;
              }
            }
          } else {
            this.debugLog(`connected: no rename needed`);
            // 确保 claudeSessionId 已设置（重连时可能已有值）
            const existingSession = this.sessionManager.sessions.get(sessionId);
            if (existingSession && !existingSession.claudeSessionId && message.terminal_id) {
              existingSession.claudeSessionId = message.terminal_id;
              existingSession.terminalSessionId = message.terminal_id;  // Terminal 专用
              this.debugLog(`connected: updated claudeSessionId for existing session`);
            }
          }

          // 2 秒后强制 xterm.js 重绘，修复历史渲染问题
          // 历史数据包含清屏序列，可能导致 xterm.js 渲染异常
          // 通过临时改变字体大小触发完整重绘
          if (this.delayedFitTimer) {
            clearTimeout(this.delayedFitTimer);
          }
          // BUG-F6 FIX: Capture session and terminal to avoid operating on wrong terminal after session switch
          const capturedSessionForFit = sessionId;
          const capturedTerminalForFit = this.terminal;
          this.delayedFitTimer = setTimeout(() => {
            // BUG-F6 FIX: Check if session changed during the 2s delay
            if (this.currentSession !== capturedSessionForFit) {
              this.debugLog(`delayed refresh: session changed (${capturedSessionForFit?.substring(0, 8)} -> ${this.currentSession?.substring(0, 8)}), skip`);
              this.delayedFitTimer = null;
              return;
            }
            this.debugLog('delayed refresh: 2s passed, triggering full redraw');
            // BUG-F6 FIX: Use captured terminal reference
            if (capturedTerminalForFit && capturedTerminalForFit.xterm) {
              // 临时改变字体大小再改回来，强制 xterm.js 完整重绘
              const currentSize = capturedTerminalForFit.fontSize;
              capturedTerminalForFit.xterm.options.fontSize = currentSize + 1;
              capturedTerminalForFit.fit();
              setTimeout(() => {
                // Double-check session is still active
                if (this.currentSession === capturedSessionForFit && capturedTerminalForFit && capturedTerminalForFit.xterm) {
                  capturedTerminalForFit.xterm.options.fontSize = currentSize;
                  capturedTerminalForFit.fit();
                  capturedTerminalForFit.xterm.scrollToBottom();
                  this.debugLog('delayed refresh: scrolled to bottom');
                }
              }, 50);
            }
            this.delayedFitTimer = null;
          }, 2000);
          break;

        case 'output':
          // OUTPUT 日志太多，只在异常情况打印
          if (message.data) {
            // 尝试查找 session（可能已经被 rename）
            let targetSession = session;
            if (!targetSession) {
              // session 可能已被 rename，尝试通过 _oldId 查找
              for (const [id, s] of this.sessionManager.sessions) {
                if (s._oldId === sessionId) {
                  targetSession = s;
                  this.debugLog(`OUTPUT: found via _oldId ${sessionId?.substring(0, 8)} -> ${id?.substring(0, 8)}`);
                  break;
                }
              }
              if (!targetSession) {
                this.debugLog(`OUTPUT: session not found! sid=${sessionId?.substring(0, 8)}, sessions: ${[...this.sessionManager.sessions.keys()].map(k => k.substring(0, 8)).join(',')}`);
              }
            }

            // 严格使用 session 对应的终端，不 fallback 到 this.terminal（防止串台）
            if (targetSession && targetSession.terminal) {
              try {
                targetSession.terminal.write(message.data);
              } catch (writeError) {
                this.debugLog(`OUTPUT: write error: ${writeError.message}`);
              }
            } else if (targetSession && !targetSession.terminal) {
              // session 存在但 terminal 未就绪，放入 session 专属队列
              if (!targetSession.outputQueue) {
                targetSession.outputQueue = [];
              }
              targetSession.outputQueue.push(message.data);
              this.debugLog(`OUTPUT: terminal not ready, queued (${targetSession.outputQueue.length} items)`);
            } else {
              // session 不存在，可能是 rename 后的旧消息，尝试用当前 session
              // 但只在 sessionId 匹配时才写入
              if (sessionId === this.currentSession && this.terminal) {
                this.debugLog(`OUTPUT: fallback to this.terminal`);
                this.terminal.write(message.data);
              } else {
                this.debugLog(`OUTPUT: DROPPED! handlerSid=${sessionId?.substring(0, 8)} != currentSid=${this.currentSession?.substring(0, 8)}`);
              }
            }
          }
          break;

        case 'error':
          this.debugLog(`MSG error: ${message.message}`);
          this.updateConnectStatus('error', message.message);
          this.showError(message.message);
          break;

        case 'pong':
          // 心跳响应，不打日志
          break;

        case 'clients':
          this.debugLog(`MSG clients: ${message.count}`);
          break;

        default:
          this.debugLog(`MSG unknown: ${message.type}`);
      }
    } catch (error) {
      this.debugLog(`handleMessage ERROR: ${error.message}`);
    }
  },

  /**
   * 发送消息 - 使用 MessagePack 二进制协议
   */
  sendMessage(data) {
    // 如果启用多路复用，路由特定消息类型
    if (this.isUseMux() && window.muxWs && this.currentSession) {
      if (data.type === 'input') {
        window.muxWs.terminalInput(this.currentSession, data.data);
        return;
      }
      if (data.type === 'resize') {
        window.muxWs.terminalResize(this.currentSession, data.rows, data.cols);
        return;
      }
      if (data.type === 'ping') {
        // ping 通过 muxWs 的 system channel 发送
        window.muxWs.send('system', null, 'ping', {});
        return;
      }
      // 其他消息类型（如 auth）在 mux 模式下不需要通过 ws 发送
      this.debugLog(`sendMessage: skip message type=${data.type} in mux mode`);
      return;
    }

    // 非多路复用模式：使用传统 WebSocket
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // 使用 MessagePack 二进制编码
      const packed = MessagePack.encode(data);
      this.ws.send(packed);
    }
  },

  /**
   * 发送输入
   */
  sendInput() {
    const inputRow = document.getElementById('input-row');
    const inputEl = inputRow?.querySelector('.input-field');
    if (!inputEl) return;

    const content = inputEl.value;

    // 清空输入框并重置高度（立即清空，避免重复发送）
    inputEl.value = '';
    inputEl.style.height = 'auto';

    // 必须分开发送：先发内容，再单独发回车
    // 加延迟避免时序问题
    if (content) {
      this.sendMessage({ type: 'input', data: content });
      // 延迟 100ms 再发送回车，避免时序问题
      setTimeout(() => {
        this.sendMessage({ type: 'input', data: '\r' });
      }, 100);
    } else {
      this.sendMessage({ type: 'input', data: '\r' });
    }
  },

  /**
   * 设置滚动按钮（⤒ ⤓）的单击/长按行为
   */
  setupScrollButton(btn, key) {
    const LONG_PRESS_DELAY = 200;  // 长按触发延迟
    const SCROLL_INTERVAL = 60;    // 持续滚动间隔
    const SCROLL_LINES = 3;        // 每次滚动行数

    let pressTimer = null;
    let scrollTimer = null;
    let isLongPress = false;

    const startScroll = () => {
      isLongPress = true;
      // 开始持续滚动
      scrollTimer = setInterval(() => {
        if (this.terminal && this.terminal.xterm) {
          const lines = key === 'top' ? -SCROLL_LINES : SCROLL_LINES;
          this.terminal.xterm.scrollLines(lines);
        }
      }, SCROLL_INTERVAL);
    };

    const stopScroll = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      if (scrollTimer) {
        clearInterval(scrollTimer);
        scrollTimer = null;
      }

      // 如果不是长按，执行单击跳转
      if (!isLongPress) {
        if (this.terminal && this.terminal.xterm) {
          if (key === 'top') {
            this.terminal.xterm.scrollToTop();
          } else {
            this.terminal.xterm.scrollToBottom();
          }
        }
      }
      isLongPress = false;
    };

    // 触摸事件
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      isLongPress = false;
      pressTimer = setTimeout(startScroll, LONG_PRESS_DELAY);
    }, { passive: false });

    btn.addEventListener('touchend', stopScroll);
    btn.addEventListener('touchcancel', stopScroll);

    // 鼠标事件（桌面端）
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isLongPress = false;
      pressTimer = setTimeout(startScroll, LONG_PRESS_DELAY);
    });

    btn.addEventListener('mouseup', stopScroll);
    btn.addEventListener('mouseleave', stopScroll);

    // BUG-F7 FIX: Store cleanup function to be called on disconnect
    // This ensures timers are cleaned up even if button is removed from DOM
    if (!this._scrollButtonCleanups) {
      this._scrollButtonCleanups = [];
    }
    this._scrollButtonCleanups.push(stopScroll);
  },

  /**
   * 发送按键
   */
  sendKey(key) {
    const keyMap = {
      // 导航
      'up': '\x1b[A',
      'down': '\x1b[B',
      // 中断/退出
      'escape': '\x1b',
      'ctrl-c': '\x03',
      // 输入/确认
      'tab': '\t',
      'enter': '\r',
      // 编辑
      'backspace': '\x7f',
      // 组合键
      'ctrl-o': '\x0f',      // 切换详细输出模式
      'ctrl-b': '\x02',      // 后台运行
      'esc-esc': '\x1b\x1b', // 回滚（双击 ESC）
      'shift-tab': '\x1b[Z', // 切换权限模式
    };

    // 斜杠命令（需要分两次发送：命令 + 回车）
    const cmdMap = {
      'cmd-resume': '/resume',
      'cmd-clear': '/clear',
      'cmd-help': '/help',
      'cmd-context': '/context',
      'cmd-memory': '/memory',
      'cmd-compact': '/compact',
      'cmd-mcp': '/mcp',
      'cmd-doctor': '/doctor',
    };

    // 处理斜杠命令：先发命令，再发回车，然后滚动到底部
    if (cmdMap[key]) {
      this.sendMessage({ type: 'input', data: cmdMap[key] });
      this.sendMessage({ type: 'input', data: '\r' });
      // 滚动到底部
      if (this.terminal) {
        this.terminal.scrollToBottom();
      }
      return;
    }

    const sequence = keyMap[key];
    if (sequence) {
      this.sendMessage({
        type: 'input',
        data: sequence
      });
      // 滚动到底部
      if (this.terminal) {
        this.terminal.scrollToBottom();
      }
    }
  },

  /**
   * 尝试重连（旧版，兼容）
   * @deprecated 使用 attemptReconnectForSession 代替
   */
  attemptReconnect() {
    // 兼容：获取当前 session 并调用新方法
    const session = this.currentSession ? this.sessionManager.sessions.get(this.currentSession) : null;
    if (session) {
      this.attemptReconnectForSession(session);
    }
  },

  /**
   * 为指定 session 尝试重连（使用 session 独立状态）
   * @param {SessionInstance} session - 要重连的 session
   */
  attemptReconnectForSession(session) {
    const now = new Date().toISOString().substr(11, 12);
    const sessionId = session.id;
    this.debugLog(`attemptReconnectForSession called for ${sessionId.substring(0, 8)}`);

    // 清理该 session 之前的重连定时器
    if (session.reconnectTimeout) {
      this.debugLog(`clearing previous reconnect timer for ${sessionId.substring(0, 8)}`);
      clearTimeout(session.reconnectTimeout);
      session.reconnectTimeout = null;
    }

    if (session.reconnectAttempts >= this.maxReconnectAttempts) {
      this.debugLog(`max reconnect attempts (${this.maxReconnectAttempts}) reached for ${sessionId.substring(0, 8)}, giving up`);
      // 只有当前 session 才更新 UI
      if (sessionId === this.currentSession) {
        this.updateStatus(this.t('reconnect.failed'), false);
      }
      return;
    }

    session.reconnectAttempts++;
    // 首次重连延迟 500ms，后续指数退避
    const delay = session.reconnectAttempts === 1 ? 500 : Math.min(1000 * Math.pow(2, session.reconnectAttempts - 2), 10000);

    this.debugLog(`reconnect ${session.reconnectAttempts}/${this.maxReconnectAttempts} for ${sessionId.substring(0, 8)}, delay=${delay}ms`);

    // 只有当前 session 才更新 UI
    if (sessionId === this.currentSession) {
      this.updateStatus(`${this.t('reconnect.trying')} (${session.reconnectAttempts}/${this.maxReconnectAttempts})...`, false);
    }

    session.reconnectTimeout = setTimeout(() => {
      const execNow = new Date().toISOString().substr(11, 12);
      this.debugLog(`[${execNow}] reconnect timer fired for ${sessionId.substring(0, 8)}`);

      // 检查 session 是否还存在且需要重连
      if (!this.sessionManager.sessions.has(sessionId)) {
        this.debugLog(`[${execNow}] session ${sessionId.substring(0, 8)} no longer exists, skip reconnect`);
        return;
      }

      if (!session.shouldReconnect) {
        this.debugLog(`[${execNow}] session ${sessionId.substring(0, 8)} shouldReconnect=false, skip`);
        return;
      }

      // 使用 session 自己的 workDir 和 claudeSessionId 进行重连
      this.debugLog(`[${execNow}] execute reconnect for ${sessionId.substring(0, 8)} with workDir=${session.workDir}`);
      this.reconnectSession(session);
    }, delay);
  },

  /**
   * 重连指定 session（通过 MuxWebSocket 重新订阅）
   * @param {SessionInstance} session - 要重连的 session
   */
  reconnectSession(session) {
    const sessionId = session.id;
    this.debugLog(`reconnectSession: ${sessionId.substring(0, 8)} via MuxWebSocket`);

    // 如果是当前活跃 session，更新全局状态
    if (sessionId === this.currentSession) {
      this.currentWorkDir = session.workDir;
      this.currentClaudeSessionId = session.claudeSessionId;
    }

    // 检查 MuxWebSocket 是否可用且已连接
    if (!window.muxWs) {
      this.debugLog(`reconnectSession: MuxWebSocket not available`);
      return;
    }

    if (window.muxWs.state !== 'connected') {
      this.debugLog(`reconnectSession: MuxWebSocket not connected (state=${window.muxWs.state}), will auto-reconnect`);
      // MuxWebSocket 会自动重连并重新订阅
      return;
    }

    // 获取终端大小
    const terminal = session.terminal || this.terminal;
    const rows = terminal ? terminal.getSize().rows : 40;
    const cols = terminal ? terminal.getSize().cols : 120;

    // 通过 MuxWebSocket 重新连接终端
    window.muxWs.connectTerminal(sessionId, session.workDir, {
      rows,
      cols,
      onConnect: (data) => {
        this.debugLog(`reconnectSession: terminal connected for ${sessionId.substring(0, 8)}`);
        session.status = 'connected';
        session.reconnectAttempts = 0;
        if (session.reconnectTimeout) {
          clearTimeout(session.reconnectTimeout);
          session.reconnectTimeout = null;
        }
        // 更新 claudeSessionId
        if (data.session_id) {
          session.claudeSessionId = data.session_id;
          session.terminalSessionId = data.session_id;  // Terminal 专用
        }
        // 如果是当前活跃 session，更新 UI
        if (sessionId === this.currentSession) {
          this.updateConnectStatus('connected', '');
        }
      },
      onMessage: (type, data) => {
        // BUG-011 FIX: Use correct method name and parameter order
        this._handleMuxMessage(sessionId, type, data);
      },
      onDisconnect: () => {
        this.debugLog(`reconnectSession: terminal disconnected for ${sessionId.substring(0, 8)}`);
        session.status = 'disconnected';
        // 尝试重连
        if (session.shouldReconnect) {
          this.attemptReconnectForSession(session);
        }
      }
    });
  },

  /**
   * 调整字体大小
   */
  adjustFontSize(delta) {
    if (!this.terminal) return;

    const currentSize = this.terminal.fontSize;
    const newSize = Math.max(10, Math.min(24, currentSize + delta));

    this.terminal.setFontSize(newSize);

    // 保存到当前 session（每个 session 独立的字体大小）
    const session = this.sessionManager.getActive();
    if (session) {
      session.fontSize = newSize;
      this.debugLog(`adjustFontSize: saved ${newSize} to session ${session.id.substring(0, 8)}`);
    }

    // 调整后重新计算大小
    setTimeout(() => this.resizeTerminal(), 100);
  },

  /**
   * 切换终端主题
   */
  toggleTheme() {
    this.debugLog(`toggleTheme: called, this.terminal=${this.terminal ? 'exists' : 'NULL'}`);
    if (!this.terminal) {
      this.debugLog('toggleTheme: terminal is null, return');
      return;
    }

    this.debugLog(`toggleTheme: terminal.getNextTheme=${typeof this.terminal.getNextTheme}`);
    if (typeof this.terminal.getNextTheme !== 'function') {
      this.debugLog('toggleTheme: ERROR - getNextTheme is not a function!');
      return;
    }

    // 获取下一个主题
    const nextTheme = this.terminal.getNextTheme();
    this.debugLog(`toggleTheme: nextTheme=${nextTheme}`);
    this.terminal.setTheme(nextTheme);

    // 保存到当前 session
    const session = this.sessionManager.getActive();
    if (session) {
      session.theme = nextTheme;
      this.debugLog(`toggleTheme: saved ${nextTheme} to session ${session.id.substring(0, 8)}`);

      // 持久化到 localStorage
      this.saveSessionTheme(session.claudeSessionId || session.id, nextTheme);
    }

    // 更新主题按钮显示（可选：显示当前主题颜色）
    this.updateThemeButton(nextTheme);
  },

  /**
   * 打开当前工作目录（跳转到 Files 页面）
   */
  openWorkingDir() {
    const workDir = this.currentWorkDir;
    if (!workDir) {
      this.showToast(this.t('terminal.noWorkDir', 'No working directory'));
      return;
    }

    this.debugLog(`openWorkingDir: ${workDir}`);

    // 隐藏 terminal，返回 sessions 视图
    this.showView('sessions');

    // 获取 Files 页面在当前顺序中的位置（Files 的 pageId = 2）
    const pageOrder = this.getPageOrder();
    const filesPageIndex = pageOrder.indexOf(2);
    if (filesPageIndex >= 0) {
      this.goToPage(filesPageIndex);
    }

    // 加载工作目录
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
      this.showToast(this.t('terminal.noSession', 'No active session'));
      return;
    }

    // 获取当前 session 名称
    const session = this.sessionManager?.sessions.get(this.currentSession);
    const currentName = session?.name || '';
    this.debugLog(`renameCurrentSession: currentName=${currentName}, hasShowRenameDialog=${typeof this.showRenameDialog}`);

    if (typeof this.showRenameDialog !== 'function') {
      this.debugLog('renameCurrentSession: ERROR - showRenameDialog is not a function');
      this.showToast('Error: showRenameDialog not available');
      return;
    }

    this.showRenameDialog(sessionId, currentName, (newName) => {
      // 更新终端标题
      const titleEl = document.getElementById('terminal-title');
      if (titleEl) {
        titleEl.textContent = newName;
      }

      // 更新 session manager 中的名称
      if (session) {
        session.name = newName;
      }

      // 刷新 pinned sessions
      if (this.refreshPinnedSessions) {
        this.refreshPinnedSessions();
      }

      this.showToast(this.t('sessions.renamed', 'Session renamed'));
    });
  },

  /**
   * 获取并显示 git 分支（显示在 toolbar 内 session 名下方）
   */
  async fetchGitBranch(workDir) {
    const branchEl = document.getElementById('git-branch');
    if (!branchEl) return;

    // 先清空（CSS 会自动隐藏空元素）
    branchEl.textContent = '';

    // 获取当前 session
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
   * 保存 session 主题到 localStorage
   */
  saveSessionTheme(sessionId, theme) {
    try {
      const themes = JSON.parse(localStorage.getItem('session-themes') || '{}');
      themes[sessionId] = theme;
      localStorage.setItem('session-themes', JSON.stringify(themes));
    } catch (e) {
      this.debugLog(`saveSessionTheme error: ${e.message}`);
    }
  },

  /**
   * 从 localStorage 加载 session 主题
   */
  loadSessionTheme(sessionId) {
    try {
      const themes = JSON.parse(localStorage.getItem('session-themes') || '{}');
      return themes[sessionId] || null;
    } catch (e) {
      this.debugLog(`loadSessionTheme error: ${e.message}`);
      return null;
    }
  },

  /**
   * 更新主题按钮显示
   */
  updateThemeButton(theme) {
    const btn = document.getElementById('theme-toggle');
    if (btn && typeof TERMINAL_THEMES !== 'undefined') {
      const themeConfig = TERMINAL_THEMES[theme];
      if (themeConfig) {
        btn.style.color = themeConfig.foreground;
        btn.style.backgroundColor = themeConfig.background;
      }
    }
  },

  /**
   * 加载或自动分配主题
   */
  loadOrAssignTheme(session) {
    if (!session || !session.terminal) return;

    const sessionId = session.claudeSessionId || session.id;

    // 1. 尝试从 localStorage 加载已保存的主题
    const savedTheme = this.loadSessionTheme(sessionId);
    if (savedTheme) {
      session.theme = savedTheme;
      session.terminal.setTheme(savedTheme);
      this.updateThemeButton(savedTheme);
      this.debugLog(`loadOrAssignTheme: loaded theme ${savedTheme} for ${sessionId.substring(0, 8)}`);
      return;
    }

    // 2. 自动分配一个未被其他 session 使用的主题
    const usedThemes = new Set();
    for (const [id, s] of this.sessionManager.sessions) {
      if (s.theme && id !== session.id) {
        usedThemes.add(s.theme);
      }
    }

    // 找到第一个未使用的主题
    let assignedTheme = 'default';
    for (const theme of THEME_ORDER) {
      if (!usedThemes.has(theme)) {
        assignedTheme = theme;
        break;
      }
    }

    session.theme = assignedTheme;
    session.terminal.setTheme(assignedTheme);
    this.saveSessionTheme(sessionId, assignedTheme);
    this.updateThemeButton(assignedTheme);
    this.debugLog(`loadOrAssignTheme: assigned theme ${assignedTheme} for ${sessionId.substring(0, 8)}`);
  },

  /**
   * 应用当前字体大小并发送 resize 命令
   * 用于终端打开时自动适配当前设备
   */
  applyFontSizeAndResize() {
    if (!this.terminal) return;

    // 获取当前字体大小（已经从 localStorage 或设备默认值计算）
    const fontSize = this.terminal.fontSize;
    this.debugLog(`applyFontSizeAndResize: fontSize=${fontSize}`);

    // 设置字体大小（触发终端重新适配）
    this.terminal.setFontSize(fontSize);

    // 延迟发送 resize 命令
    setTimeout(() => this.resizeTerminal(), 200);
  },

  /**
   * 调整终端大小
   * @param {boolean} force - 强制发送（跳过前端判断，让后端判断是否需要 resize）
   */
  resizeTerminal(force = false) {
    if (!this.terminal) return;

    this.debugLog(`resizeTerminal called, force=${force}, lastSize=${JSON.stringify(this.lastTerminalSize)}`);

    // 先让终端适配容器
    this.terminal.fit();

    // 等待适配完成后获取大小
    setTimeout(() => {
      const size = this.terminal.getSize();
      // 减少列数，让内容显示更宽松
      const adjustedCols = Math.max(size.cols - 0, 20);
      const newRows = size.rows;

      this.debugLog(`resizeTerminal: new=${newRows}x${adjustedCols}, last=${JSON.stringify(this.lastTerminalSize)}`);

      // 非强制模式：只在大小变化时才发送 resize
      if (!force && this.lastTerminalSize &&
          this.lastTerminalSize.rows === newRows &&
          this.lastTerminalSize.cols === adjustedCols) {
        this.debugLog('resizeTerminal: size unchanged, SKIP (frontend check)');
        return;
      }

      // 记录当前大小
      this.lastTerminalSize = { rows: newRows, cols: adjustedCols };

      this.debugLog(`resizeTerminal: SEND resize ${newRows}x${adjustedCols} (force=${force})`);
      this.sendMessage({
        type: 'resize',
        rows: newRows,
        cols: adjustedCols
      });
    }, 50);
  },

  /**
   * 断开连接
   */
  disconnect() {
    this.debugLog('disconnect called');
    // 禁用自动重连
    this.shouldReconnect = false;
    // 重置连接锁
    this.isConnecting = false;

    // 清理重连定时器
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // 清理倒计时定时器
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    // BUG-F7 FIX: Clean up scroll button timers
    if (this._scrollButtonCleanups) {
      for (const cleanup of this._scrollButtonCleanups) {
        cleanup();
      }
      this._scrollButtonCleanups = [];
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.terminal) {
      this.terminal.dispose();
      this.terminal = null;
    }

    // 清空输出队列
    this.outputQueue = [];

    // 关闭更多按键面板
    this.closeMoreKeysPanel();

    this.currentSession = null;
  }
};

// 导出到全局
window.AppWebSocket = AppWebSocket;
