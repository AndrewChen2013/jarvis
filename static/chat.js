/**
 * Copyright (c) 2025 BillChen
 *
 * Chat Mode - Clean conversation interface for Claude CLI
 * Uses stream-json format for structured communication
 */

const ChatMode = {
  // State
  sessionId: null,
  workingDir: null,
  messages: [],
  isConnected: false,
  isStreaming: false,
  streamingMessageId: null,

  // History pagination state
  historyOldestIndex: -1,  // Index of oldest loaded message (-1 = not loaded yet)
  hasMoreHistory: false,   // Whether there are more older messages
  isLoadingHistory: false, // Loading indicator
  pendingHistoryMessages: [], // Collect messages during history loading

  // DOM elements
  container: null,
  messagesEl: null,
  inputEl: null,
  sendBtn: null,
  initialized: false,

  /**
   * Debug log helper - uses app's debugLog
   */
  log(msg) {
    if (window.app?.debugLog) {
      window.app.debugLog('[Chat] ' + msg);
    }
  },

  /**
   * 获取当前 session 的消息数组
   */
  getSessionMessages() {
    const session = window.app?.sessionManager?.getActive();
    return session?.chatMessages || this.messages;
  },

  /**
   * 保存消息到当前 session
   */
  saveMessageToSession(msg) {
    const session = window.app?.sessionManager?.getActive();
    if (session) {
      session.chatMessages.push(msg);
    }
    this.messages.push(msg);
  },

  /**
   * Initialize Chat mode
   * 注意：现在主要的初始化逻辑在 connect() 中，这个方法保留用于向后兼容
   */
  init(container) {
    // 如果传入的是 #chat-view，忽略它，等待 connect() 使用 session 的容器
    if (container && container.id === 'chat-view') {
      this.log('init: received #chat-view, will use session container in connect()');
      return;
    }

    // Check if DOM still exists (may have been destroyed by view switch)
    const existingBackBtn = container?.querySelector('#chatBackBtn');
    if (this.initialized && this.container === container && existingBackBtn) {
      this.log('Already initialized, skipping');
      return;
    }

    if (container) {
      this.container = container;
      this.render();
      this.bindEvents();
      this.initialized = true;
    }
  },

  /**
   * Render chat UI
   */
  render() {
    const t = (key, fallback) => window.i18n ? window.i18n.t(key, fallback) : fallback;

    this.container.innerHTML = `
      <div class="chat-container">
        <div class="chat-header">
          <div class="chat-header-left">
            <button class="chat-back-btn" id="chatBackBtn" title="${t('common.close', 'Close')}">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
            </button>
            <button class="chat-minimize-btn" id="chatMinimizeBtn" title="${t('terminal.minimize', 'Minimize')}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </button>
            <span class="chat-title" id="chatTitle" style="cursor: pointer;" title="${t('debug.title', 'Debug Log')}">${t('chat.title', 'Chat')}</span>
          </div>
          <div class="chat-header-right">
            <button class="chat-terminal-btn" id="chatTerminalBtn" title="${t('chat.mode.terminal', 'Terminal')}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="4 17 10 11 4 5"></polyline>
                <line x1="12" y1="19" x2="20" y2="19"></line>
              </svg>
            </button>
          </div>
        </div>

        <div class="chat-status" id="chatStatus">
          <span class="chat-status-dot connecting"></span>
          <span id="chatStatusText">${t('chat.status.connecting', 'Connecting...')}</span>
        </div>

        <div class="chat-messages" id="chatMessages">
          <div class="chat-empty" id="chatEmpty">
            <div class="chat-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div class="chat-empty-text">${t('chat.empty', 'Start a conversation')}</div>
          </div>
        </div>

        <div class="chat-slash-commands" id="chatSlashCommands">
          <button class="slash-cmd-btn" data-cmd="/context">/context</button>
          <button class="slash-cmd-btn" data-cmd="/compact">/compact</button>
          <button class="slash-cmd-btn" data-cmd="/cost">/cost</button>
          <button class="slash-cmd-btn slash-cmd-more" id="chatMoreCmds">···</button>
          <div class="chat-more-commands-panel" id="chatMoreCmdsPanel">
            <div class="more-cmds-grid">
              <button class="slash-cmd-btn" data-cmd="/review">/review</button>
              <button class="slash-cmd-btn" data-cmd="/pr-comments">/pr-comments</button>
              <button class="slash-cmd-btn" data-cmd="/security-review">/security-review</button>
              <button class="slash-cmd-btn" data-cmd="/release-notes">/release-notes</button>
              <button class="slash-cmd-btn" data-cmd="/init">/init</button>
              <button class="slash-cmd-btn" data-cmd="/todos">/todos</button>
            </div>
          </div>
        </div>
        <div class="chat-input-area">
          <div class="chat-input-wrapper">
            <textarea
              class="chat-input"
              id="chatInput"
              placeholder="${t('chat.input.placeholder', 'Type a message...')}"
              rows="1"
            ></textarea>
          </div>
          <button class="chat-send-btn" id="chatSendBtn" disabled>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
            </svg>
          </button>
        </div>
      </div>
    `;

    // Cache DOM elements - BUG-016 FIX: 使用 this.container.querySelector 而非 document.getElementById
    // 因为多个 session 的 chat 容器共存时，getElementById 只返回第一个匹配的元素
    this.messagesEl = this.container.querySelector('#chatMessages');
    this.inputEl = this.container.querySelector('#chatInput');
    this.sendBtn = this.container.querySelector('#chatSendBtn');
    this.statusEl = this.container.querySelector('#chatStatus');
    this.statusTextEl = this.container.querySelector('#chatStatusText');
    this.statusDot = this.statusEl?.querySelector('.chat-status-dot');
    this.emptyEl = this.container.querySelector('#chatEmpty');
  },

  /**
   * Bind event listeners
   */
  bindEvents() {
    // BUG-016 FIX: 使用 this.container.querySelector 而非 document.getElementById
    // Back button
    const backBtn = this.container.querySelector('#chatBackBtn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this.disconnect();
        // 使用 closeCurrentSession 完全退出会话（清理 SessionManager、悬浮按钮等）
        if (window.app && window.app.closeCurrentSession) {
          window.app.closeCurrentSession();
        } else if (window.app && window.app.showView) {
          window.app.showView('sessions');
        }
      });
    }

    // Minimize button
    const minimizeBtn = this.container.querySelector('#chatMinimizeBtn');
    if (minimizeBtn) {
      minimizeBtn.addEventListener('click', () => {
        this.minimize();
      });
    }

    // Terminal mode button
    const terminalBtn = this.container.querySelector('#chatTerminalBtn');
    if (terminalBtn) {
      terminalBtn.addEventListener('click', () => {
        this.switchToTerminal();
      });
    }

    // Chat title - click to open debug panel
    const chatTitle = this.container.querySelector('#chatTitle');
    if (chatTitle) {
      chatTitle.addEventListener('click', () => {
        if (window.app && window.app.toggleDebugPanel) {
          window.app.toggleDebugPanel();
        }
      });
    }

    // Input auto-resize
    this.inputEl.addEventListener('input', () => {
      this.inputEl.style.height = 'auto';
      this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 120) + 'px';
      this.sendBtn.disabled = !this.inputEl.value.trim() || !this.isConnected;
    });

    // Send on Enter (Shift+Enter for newline)
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Send button
    this.sendBtn.addEventListener('click', () => {
      this.sendMessage();
    });

    // Scroll detection for infinite history loading
    this.messagesEl.addEventListener('scroll', () => {
      // When scrolled to top, load more history
      if (this.messagesEl.scrollTop < 100 && this.hasMoreHistory && !this.isLoadingHistory) {
        this.loadMoreHistory();
      }
    });

    // Slash command buttons
    const slashCmdsEl = this.container.querySelector('#chatSlashCommands');
    const moreCmdsPanel = this.container.querySelector('#chatMoreCmdsPanel');
    const moreCmdsBtn = this.container.querySelector('#chatMoreCmds');

    if (slashCmdsEl) {
      // Handle all slash command button clicks
      slashCmdsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.slash-cmd-btn');
        if (!btn) return;

        // Toggle more commands panel
        if (btn.id === 'chatMoreCmds') {
          moreCmdsPanel?.classList.toggle('show');
          return;
        }

        // Execute slash command
        const cmd = btn.dataset.cmd;
        if (cmd) {
          this.executeSlashCommand(cmd);
        }
      });
    }

    // Handle more commands panel clicks
    if (moreCmdsPanel) {
      moreCmdsPanel.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent bubbling to slashCmdsEl
        const btn = e.target.closest('.slash-cmd-btn');
        if (!btn) return;

        const cmd = btn.dataset.cmd;
        if (cmd) {
          this.executeSlashCommand(cmd);
          moreCmdsPanel.classList.remove('show');
        }
      });

      // Close panel when clicking outside
      document.addEventListener('click', (e) => {
        if (!moreCmdsPanel.contains(e.target) && !moreCmdsBtn?.contains(e.target)) {
          moreCmdsPanel.classList.remove('show');
        }
      });
    }
  },

  /**
   * Execute a slash command
   */
  executeSlashCommand(cmd) {
    if (!this.isConnected) {
      this.log(`Cannot execute ${cmd}: not connected`);
      return;
    }

    this.log(`Executing slash command: ${cmd}`);

    // Send command via MuxWebSocket
    if (window.muxWs) {
      window.muxWs.chatMessage(this.sessionId, cmd);
    }
  },

  /**
   * Load more chat history (older messages)
   */
  loadMoreHistory() {
    if (!this.isConnected || this.isLoadingHistory || !this.hasMoreHistory) {
      return;
    }

    this.isLoadingHistory = true;
    this.log(`Loading more history, before index: ${this.historyOldestIndex}`);

    // Show loading indicator at top
    const loadingEl = document.createElement('div');
    loadingEl.className = 'chat-history-loading';
    loadingEl.id = 'historyLoadingIndicator';
    loadingEl.innerHTML = '<span class="loading-spinner"></span> Loading...';
    this.messagesEl.insertBefore(loadingEl, this.messagesEl.firstChild);

    // Request more history via MuxWebSocket
    if (window.muxWs) {
      window.muxWs.send('chat', this.sessionId, 'load_more_history', {
        before_index: this.historyOldestIndex,
        limit: 50
      });
    }
  },

  /**
   * Connect to chat session
   * 使用 SessionManager 管理的 chatWs，实现连接复用
   * 当 app.useMux 启用时，使用多路复用 WebSocket
   */
  connect(sessionId, workingDir) {
    this.log(`connect: sessionId=${sessionId?.substring(0, 8)}, workingDir=${workingDir}`);

    const sessionManager = window.app?.sessionManager;

    // BUG-015 FIX: 优先使用 activeId 获取 session，而不是依赖传入的 sessionId
    // 因为 sessionId 可能是旧的缓存值（rename 之前的 ID）
    let session = sessionManager?.sessions.get(sessionId);
    if (!session && sessionManager?.activeId) {
      // 尝试用 activeId 获取
      session = sessionManager.getActive();
      if (session) {
        this.log(`connect: sessionId not found, using activeId=${sessionManager.activeId?.substring(0, 8)}`);
        sessionId = session.id;
        workingDir = session.workDir || workingDir;
      }
    }

    if (!session) {
      this.log('ERROR: Session not found');
      this.updateStatus('disconnected');
      return;
    }

    // 切换到不同的 session 时，保存当前 session 的状态
    if (this.sessionId && this.sessionId !== sessionId) {
      const oldSession = window.app?.sessionManager?.sessions.get(this.sessionId);
      if (oldSession) {
        // 保存流式状态
        oldSession.chatIsStreaming = this.isStreaming;
        oldSession.chatStreamingMessageId = this.streamingMessageId;
        // 保存输入框内容
        if (this.inputEl) {
          oldSession.chatInputValue = this.inputEl.value || '';
          this.log(`Saved input for ${this.sessionId?.substring(0, 8)}: "${oldSession.chatInputValue.substring(0, 20)}..."`);
        }
        this.log(`Saved streaming state for ${this.sessionId?.substring(0, 8)}`);
      }
    }

    this.sessionId = sessionId;
    this.workingDir = workingDir;

    // 获取或创建 session 的 chat 容器
    if (sessionManager) {
      sessionManager.getOrCreateChatContainer(session);
      sessionManager.showChatContainer(session);
    }

    // 检查容器是否已经有内容（已初始化过）
    const hasContent = session.chatContainer && session.chatContainer.querySelector('.chat-container');
    this.log(`connect: hasContent=${hasContent}, chatMessages.length=${session.chatMessages.length}`);

    if (hasContent) {
      // 容器已有内容，只需更新引用
      this.container = session.chatContainer;
      this.messagesEl = session.chatContainer.querySelector('#chatMessages') ||
                        session.chatContainer.querySelector('.chat-messages');
      this.inputEl = session.chatContainer.querySelector('#chatInput') ||
                     session.chatContainer.querySelector('.chat-input');
      this.sendBtn = session.chatContainer.querySelector('#chatSendBtn') ||
                     session.chatContainer.querySelector('.chat-send-btn');
      this.statusEl = session.chatContainer.querySelector('#chatStatus') ||
                      session.chatContainer.querySelector('.chat-status');
      this.statusTextEl = session.chatContainer.querySelector('#chatStatusText');
      this.statusDot = this.statusEl?.querySelector('.chat-status-dot');
      this.emptyEl = session.chatContainer.querySelector('#chatEmpty') ||
                     session.chatContainer.querySelector('.chat-empty');

      // 恢复流式状态
      this.isStreaming = session.chatIsStreaming || false;
      this.streamingMessageId = session.chatStreamingMessageId || null;
      this.messages = session.chatMessages;

      this.log(`connect: restored container, messages=${this.messages.length}`);
    } else {
      // 新容器，需要渲染
      this.container = session.chatContainer;
      this.messages = session.chatMessages;
      this.isStreaming = false;
      this.streamingMessageId = null;
      this.render();
      this.bindEvents();
      this.log(`connect: rendered new container`);
    }

    // Update title - prefer session name, fallback to workDir
    const title = session.name || workingDir.split('/').pop() || 'Chat';
    const titleEl = this.container?.querySelector('#chatTitle');
    if (titleEl) {
      titleEl.textContent = title;
    }

    // 恢复输入框内容
    if (this.inputEl && session.chatInputValue) {
      this.inputEl.value = session.chatInputValue;
      // 触发 input 事件以调整高度和更新发送按钮状态
      this.inputEl.dispatchEvent(new Event('input'));
      this.log(`Restored input for ${sessionId?.substring(0, 8)}: "${session.chatInputValue.substring(0, 20)}..."`);
    }

    // 统一使用 MuxWebSocket
    if (!window.muxWs) {
      this.log('ERROR: MuxWebSocket not available');
      this.updateStatus('disconnected');
      return;
    }

    this.connectMux(sessionId, workingDir, session);
  },

  /**
   * Connect using multiplexed WebSocket
   */
  connectMux(sessionId, workingDir, session) {
    this.log(`connectMux: session=${sessionId?.substring(0, 8)}, workingDir=${workingDir}`);
    this.updateStatus('connecting');

    // 获取 Terminal 的 Claude session ID 用于恢复历史
    const claudeSessionId = session.claudeSessionId;

    // BUG-017 FIX: 用闭包捕获当前 session，确保消息路由到正确的容器
    // 因为 ChatMode 是单例，但可能有多个 session 同时连接
    const capturedSession = session;
    const capturedSessionId = sessionId;

    // 使用 muxWs 连接
    window.muxWs.connectChat(sessionId, workingDir, {
      resume: claudeSessionId,
      onConnect: (data) => {
        this.log(`[MuxWS] Chat connected, workingDir=${data.working_dir}`);
        // 只有当前活跃的 session 才更新 UI 状态
        if (this.sessionId === capturedSessionId) {
          this.isConnected = true;
          this.updateStatus('connected');
          if (this.sendBtn && this.inputEl) {
            this.sendBtn.disabled = !this.inputEl.value.trim();
          }
        }
      },
      onMessage: (type, data) => {
        // BUG-017 FIX: 使用捕获的 session 处理消息
        this.handleMuxMessageForSession(type, data, capturedSession, capturedSessionId);
      },
      onDisconnect: () => {
        this.log(`[MuxWS] Chat disconnected for ${capturedSessionId?.substring(0, 8)}`);
        // 只有当前活跃的 session 才更新 UI 状态
        if (this.sessionId === capturedSessionId) {
          this.isConnected = false;
          this.updateStatus('disconnected');
        }
      }
    });
  },

  /**
   * Handle message from multiplexed connection
   * @deprecated Use handleMuxMessageForSession instead
   */
  handleMuxMessage(type, data) {
    // Convert mux message format to the format handleMessage expects
    const message = { type, ...data };
    this.handleMessage(message);
  },

  /**
   * BUG-017 FIX: Handle message for a specific session
   * 确保消息被路由到正确的 session 容器
   */
  handleMuxMessageForSession(type, data, targetSession, targetSessionId) {
    // 获取目标 session 的容器和元素
    const container = targetSession?.chatContainer;
    const sessionIdStr = typeof targetSessionId === 'string' ? targetSessionId : targetSession?.id;
    if (!container) {
      this.log(`handleMuxMessageForSession: no container for ${sessionIdStr?.substring(0, 8)}`);
      return;
    }

    const messagesEl = container.querySelector('#chatMessages') || container.querySelector('.chat-messages');
    if (!messagesEl) {
      this.log(`handleMuxMessageForSession: no messagesEl for ${sessionIdStr?.substring(0, 8)}`);
      return;
    }

    // 将消息转换为 handleMessage 期望的格式
    const message = { type, ...data };

    // 使用目标 session 的容器处理消息
    this.handleMessageForSession(message, targetSession, targetSessionId, container, messagesEl);
  },

  /**
   * BUG-017 FIX: Handle message for a specific session with its own container
   * 临时切换到目标 session 的上下文处理消息，然后恢复
   */
  handleMessageForSession(data, targetSession, targetSessionId, container, messagesEl) {
    // 如果目标是当前活跃的 session
    if (this.sessionId === targetSessionId) {
      // 修复：如果 messagesEl 引用不一致，更新为正确的引用
      if (this.messagesEl !== messagesEl) {
        this.log(`handleMessageForSession: updating messagesEl reference for active session`);
        this.messagesEl = messagesEl;
        this.emptyEl = container.querySelector('#chatEmpty') || container.querySelector('.chat-empty');
      }
      this.handleMessage(data);
      return;
    }

    // 非活跃 session：保存当前上下文
    const savedMessagesEl = this.messagesEl;
    const savedEmptyEl = this.emptyEl;
    const savedMessages = this.messages;
    const savedIsStreaming = this.isStreaming;
    const savedStreamingMessageId = this.streamingMessageId;

    // 临时切换到目标 session 的上下文
    this.messagesEl = messagesEl;
    this.emptyEl = container.querySelector('#chatEmpty') || container.querySelector('.chat-empty');
    this.messages = targetSession.chatMessages;
    this.isStreaming = targetSession.chatIsStreaming || false;
    this.streamingMessageId = targetSession.chatStreamingMessageId || null;

    try {
      // 处理消息（跳过状态更新，因为不是当前活跃的 session）
      this.handleMessageWithoutStatusUpdate(data, targetSession);
    } finally {
      // 保存目标 session 的流式状态
      targetSession.chatIsStreaming = this.isStreaming;
      targetSession.chatStreamingMessageId = this.streamingMessageId;

      // 恢复原上下文
      this.messagesEl = savedMessagesEl;
      this.emptyEl = savedEmptyEl;
      this.messages = savedMessages;
      this.isStreaming = savedIsStreaming;
      this.streamingMessageId = savedStreamingMessageId;
    }
  },

  /**
   * Handle message without updating global status (for non-active sessions)
   */
  handleMessageWithoutStatusUpdate(data, targetSession) {
    switch (data.type) {
      case 'ready':
        // 不更新全局状态，只记录到 session
        break;

      case 'system':
        // 更新 Claude session ID 到目标 session
        if (data.data && data.data.session_id) {
          targetSession.claudeSessionId = data.data.session_id;
          this.log(`Updated claudeSessionId for ${targetSession.id?.substring(0, 8)}`);
        }
        break;

      case 'user_ack':
        // 用户消息已在 sendMessage 中立即显示，此处仅用于确认
        // 不再重复添加消息
        break;

      case 'user':
        this.addMessage('user', data.content, { timestamp: data.timestamp });
        break;

      case 'stream':
        this.appendToStreaming(data.text);
        break;

      case 'assistant':
        this.hideTypingIndicator();
        if (this.isStreaming) {
          this.finalizeStreaming(data.content);
        } else {
          this.addMessage('assistant', data.content, { timestamp: data.timestamp });
        }
        break;

      case 'tool_call':
        this.hideTypingIndicator();
        this.addToolMessage('call', data.tool_name, data.input);
        break;

      case 'tool_result':
        this.updateToolResult(data.tool_id, data);
        this.showTypingIndicator();
        break;

      case 'thinking_start':
        this.hideTypingIndicator();
        this.startThinking();
        break;

      case 'thinking_delta':
        this.appendToThinking(data.text);
        break;

      case 'thinking_end':
        this.finalizeThinking();
        this.showTypingIndicator();
        break;

      case 'thinking':
        this.hideTypingIndicator();
        this.addThinkingMessage(data.content);
        this.showTypingIndicator();
        break;

      case 'result':
        this.hideTypingIndicator();
        this.isStreaming = false;
        if (data.cost_usd) {
          this.showResultBadge(data);
        }
        break;

      case 'error':
        this.hideTypingIndicator();
        this.addMessage('system', `Error: ${data.message}`);
        // If permanent error, unsubscribe to prevent retry on reconnect
        if (data.permanent && this.sessionId) {
          this.log('Permanent error, unsubscribing from session');
          if (window.muxWs) {
            window.muxWs.unsubscribe('chat', this.sessionId);
          }
        }
        break;

      case 'pong':
        break;
    }
  },

  /**
   * Handle incoming message
   */
  handleMessage(data) {
    const t = (key, fallback) => window.i18n ? window.i18n.t(key, fallback) : fallback;

    switch (data.type) {
      case 'ready':
        this.isConnected = true;
        this.updateStatus('connected');
        this.sendBtn.disabled = !this.inputEl.value.trim();
        break;

      case 'system':
        // 收到 Claude 的真正 session ID，更新到 SessionManager
        // 这样切换到 Terminal 模式时可以恢复历史
        if (data.data && data.data.session_id) {
          const claudeSessionId = data.data.session_id;
          this.log(`Received Claude session ID: ${claudeSessionId.substring(0, 8)}`);
          const session = window.app?.sessionManager?.getActive();
          if (session) {
            session.claudeSessionId = claudeSessionId;
            this.log(`Updated session.claudeSessionId`);
          }
        }
        break;

      case 'user_ack':
        // 用户消息已在 sendMessage 中立即显示，此处仅用于确认
        // 不再重复添加消息
        break;

      case 'user':
        // User message from history
        if (this.isLoadingHistory) {
          // Collect for batch insert at top
          this.pendingHistoryMessages.push({
            type: 'user',
            content: data.content,
            extra: { timestamp: data.timestamp }
          });
        } else {
          this.addMessage('user', data.content, { timestamp: data.timestamp });
        }
        break;

      case 'stream':
        this.appendToStreaming(data.text);
        break;

      case 'assistant':
        this.hideTypingIndicator();
        if (this.isLoadingHistory) {
          // Collect for batch insert at top
          this.pendingHistoryMessages.push({
            type: 'assistant',
            content: data.content,
            extra: { timestamp: data.timestamp }
          });
        } else if (this.isStreaming) {
          this.finalizeStreaming(data.content);
        } else {
          this.addMessage('assistant', data.content, { timestamp: data.timestamp });
        }
        break;

      case 'tool_call':
        this.hideTypingIndicator();
        this.addToolMessage('call', data.tool_name, data.input);
        break;

      case 'tool_result':
        this.updateToolResult(data.tool_id, data);
        this.showTypingIndicator();
        break;

      case 'thinking_start':
        this.hideTypingIndicator();
        this.startThinking();
        break;

      case 'thinking_delta':
        this.appendToThinking(data.text);
        break;

      case 'thinking_end':
        this.finalizeThinking();
        this.showTypingIndicator();
        break;

      case 'thinking':
        this.hideTypingIndicator();
        this.addThinkingMessage(data.content);
        this.showTypingIndicator();
        break;

      case 'result':
        this.hideTypingIndicator();
        this.isStreaming = false;
        if (data.cost_usd) {
          this.showResultBadge(data);
        }
        break;

      case 'error':
        this.hideTypingIndicator();
        this.addMessage('system', `Error: ${data.message}`);
        // If permanent error, unsubscribe to prevent retry on reconnect
        if (data.permanent && this.sessionId) {
          this.log('Permanent error, unsubscribing from session');
          if (window.muxWs) {
            window.muxWs.unsubscribe('chat', this.sessionId);
          }
        }
        break;

      case 'history_end':
        // Initial history load complete
        this.historyOldestIndex = data.total - data.count;
        this.hasMoreHistory = this.historyOldestIndex > 0;
        this.log(`History loaded: ${data.count}/${data.total} messages, oldest_index=${this.historyOldestIndex}, hasMore=${this.hasMoreHistory}`);
        // Scroll to bottom after initial history
        this.scrollToBottom();
        break;

      case 'history_page_end':
        // Additional history page loaded - insert all collected messages
        this.log(`History page loaded: ${data.count} messages, oldest_index=${data.oldest_index}, hasMore=${data.has_more}`);

        // Remove loading indicator
        const loadingEl = this.messagesEl.querySelector('#historyLoadingIndicator');
        if (loadingEl) {
          loadingEl.remove();
        }

        // Insert collected messages at the top (in correct order)
        if (this.pendingHistoryMessages.length > 0) {
          // Preserve scroll position
          const scrollHeightBefore = this.messagesEl.scrollHeight;
          const scrollTopBefore = this.messagesEl.scrollTop;

          // Create document fragment for batch insert
          const fragment = document.createDocumentFragment();
          for (const msg of this.pendingHistoryMessages) {
            const msgEl = this.createMessageElement(msg.type, msg.content, msg.extra);
            fragment.appendChild(msgEl);
          }

          // Insert at the top
          const firstChild = this.messagesEl.firstChild;
          if (firstChild) {
            this.messagesEl.insertBefore(fragment, firstChild);
          } else {
            this.messagesEl.appendChild(fragment);
          }

          // Adjust scroll position to keep view stable
          requestAnimationFrame(() => {
            const scrollHeightAfter = this.messagesEl.scrollHeight;
            this.messagesEl.scrollTop = scrollTopBefore + (scrollHeightAfter - scrollHeightBefore);
          });

          this.pendingHistoryMessages = [];
        }

        // Update state
        this.isLoadingHistory = false;
        this.historyOldestIndex = data.oldest_index;
        this.hasMoreHistory = data.has_more;

        // Show "no more history" message if at the beginning
        if (!this.hasMoreHistory) {
          const noMoreEl = document.createElement('div');
          noMoreEl.className = 'chat-history-end';
          noMoreEl.textContent = window.i18n?.t('chat.historyEnd', 'Beginning of conversation') || 'Beginning of conversation';
          this.messagesEl.insertBefore(noMoreEl, this.messagesEl.firstChild);
        }
        break;

      case 'pong':
        // Heartbeat response
        break;
    }
  },

  /**
   * Send message
   */
  sendMessage() {
    const content = this.inputEl.value.trim();
    if (!content || !this.isConnected || this.isStreaming) return;

    // 确保 messagesEl 指向正确的容器
    // 修复：在发送消息前重新获取当前 session 的容器，避免引用不一致
    const session = window.app?.sessionManager?.getActive();
    if (session?.chatContainer) {
      const correctMessagesEl = session.chatContainer.querySelector('#chatMessages') ||
                                session.chatContainer.querySelector('.chat-messages');
      if (correctMessagesEl && correctMessagesEl !== this.messagesEl) {
        this.log(`sendMessage: fixing messagesEl reference`);
        this.messagesEl = correctMessagesEl;
      }
    }

    // 立即显示用户消息，提供更好的用户体验
    // 不等待后端 user_ack，避免消息不显示的问题
    this.addMessage('user', content, { timestamp: new Date().toISOString() });
    this.showTypingIndicator();

    if (window.muxWs) {
      window.muxWs.chatMessage(this.sessionId, content);
    }

    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';
    this.sendBtn.disabled = true;
  },

  /**
   * Create message DOM element (without inserting)
   */
  createMessageElement(type, content, extra = {}) {
    const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
    const msgEl = document.createElement('div');
    msgEl.className = `chat-message ${type}`;
    msgEl.id = msgId;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = this.formatContent(content);

    if (extra.timestamp) {
      const timeEl = document.createElement('div');
      timeEl.className = 'chat-message-time';
      timeEl.textContent = this.formatTimestamp(extra.timestamp);
      bubble.appendChild(timeEl);
    }

    msgEl.appendChild(bubble);
    return msgEl;
  },

  /**
   * Add message to chat
   */
  addMessage(type, content, extra = {}) {
    // Hide empty state
    if (this.emptyEl) {
      this.emptyEl.style.display = 'none';
    }

    const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
    const msgEl = document.createElement('div');
    msgEl.className = `chat-message ${type}`;
    msgEl.id = msgId;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = this.formatContent(content);

    // Add timestamp if available
    if (extra.timestamp) {
      const timeEl = document.createElement('div');
      timeEl.className = 'chat-message-time';
      timeEl.textContent = this.formatTimestamp(extra.timestamp);
      bubble.appendChild(timeEl);
    }

    msgEl.appendChild(bubble);

    // Prepend or append based on extra.prepend flag
    if (extra.prepend) {
      // Preserve scroll position when prepending
      const scrollHeightBefore = this.messagesEl.scrollHeight;
      const scrollTopBefore = this.messagesEl.scrollTop;

      // Insert at the beginning (after loading indicator if present)
      const loadingIndicator = this.messagesEl.querySelector('#historyLoadingIndicator');
      const historyEndMarker = this.messagesEl.querySelector('.chat-history-end');
      const insertBefore = loadingIndicator || historyEndMarker || this.messagesEl.firstChild;
      if (insertBefore) {
        this.messagesEl.insertBefore(msgEl, insertBefore.nextSibling || insertBefore);
      } else {
        this.messagesEl.appendChild(msgEl);
      }

      // Adjust scroll position to keep view stable
      requestAnimationFrame(() => {
        const scrollHeightAfter = this.messagesEl.scrollHeight;
        this.messagesEl.scrollTop = scrollTopBefore + (scrollHeightAfter - scrollHeightBefore);
      });
    } else {
      this.messagesEl.appendChild(msgEl);
      // 保存消息到当前 session
      const msg = { id: msgId, type, content, ...extra };
      this.saveMessageToSession(msg);
      this.scrollToBottom();
    }

    return msgId;
  },

  /**
   * Format timestamp for display
   */
  formatTimestamp(timestamp) {
    if (!timestamp) return '';
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();

      if (isToday) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
               ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    } catch (e) {
      return '';
    }
  },

  /**
   * Add tool call message
   */
  addToolMessage(action, toolName, data) {
    if (this.emptyEl) {
      this.emptyEl.style.display = 'none';
    }

    const msgId = 'tool-' + Date.now();
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message tool';
    msgEl.id = msgId;

    // Tools that should be expanded by default
    const expandedByDefault = ['Grep', 'Edit', 'Read', 'Write', 'Glob', 'Bash', 'LSP'];
    const shouldExpand = expandedByDefault.includes(toolName);
    const contentClass = shouldExpand ? 'tool-content show' : 'tool-content';
    const toggleClass = shouldExpand ? 'tool-toggle expanded' : 'tool-toggle';

    // Render tool-specific content
    let toolContent = '';
    switch (toolName) {
      case 'Edit':
        toolContent = this.renderEditTool(data);
        break;
      case 'Write':
        toolContent = this.renderWriteTool(data);
        break;
      case 'Read':
        toolContent = this.renderReadTool(data);
        break;
      case 'Bash':
        toolContent = this.renderBashTool(data);
        break;
      case 'Grep':
        toolContent = this.renderGrepTool(data);
        break;
      default:
        toolContent = `<pre>${this.escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
    }

    // Get tool icon
    const toolIcon = this.getToolIcon(toolName);

    msgEl.innerHTML = `
      <div class="chat-bubble">
        <div class="tool-header" onclick="ChatMode.toggleToolContent('${msgId}')">
          <span class="tool-icon">${toolIcon}</span>
          <span class="tool-name">${toolName}</span>
          <span class="${toggleClass}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </span>
        </div>
        <div class="${contentClass}" id="${msgId}-content">
          ${toolContent}
        </div>
      </div>
    `;

    this.messagesEl.appendChild(msgEl);
    this.scrollToBottom();

    return msgId;
  },

  /**
   * Get tool-specific icon
   */
  getToolIcon(toolName) {
    const icons = {
      Edit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>`,
      Write: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="12" y1="18" x2="12" y2="12"/>
        <line x1="9" y1="15" x2="15" y2="15"/>
      </svg>`,
      Read: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>`,
      Bash: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="4 17 10 11 4 5"/>
        <line x1="12" y1="19" x2="20" y2="19"/>
      </svg>`,
      Grep: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>`,
      Glob: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>`,
      default: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
      </svg>`
    };
    return icons[toolName] || icons.default;
  },

  /**
   * Render Edit tool with diff display
   */
  renderEditTool(data) {
    const filePath = data.file_path || '';
    const oldString = data.old_string || '';
    const newString = data.new_string || '';
    const isNewFile = !oldString && newString;
    const replaceAll = data.replace_all;

    // Get filename for display
    const fileName = filePath.split('/').pop();
    const fileExt = fileName.split('.').pop();

    let html = `<div class="tool-file-header">`;
    html += `<span class="tool-file-icon">📄</span>`;
    html += `<span class="tool-file-path" title="${this.escapeHtml(filePath)}">${this.escapeHtml(fileName)}</span>`;
    if (isNewFile) {
      html += `<span class="tool-badge new">NEW</span>`;
    } else if (replaceAll) {
      html += `<span class="tool-badge replace-all">REPLACE ALL</span>`;
    }
    html += `</div>`;

    if (isNewFile) {
      // New file - show all as additions
      html += `<div class="tool-diff">`;
      html += this.renderDiffLines(newString, 'add');
      html += `</div>`;
    } else {
      // Edit - show diff
      html += `<div class="tool-diff">`;
      if (oldString) {
        html += this.renderDiffLines(oldString, 'remove');
      }
      if (newString) {
        html += this.renderDiffLines(newString, 'add');
      }
      html += `</div>`;
    }

    return html;
  },

  /**
   * Render diff lines with proper styling
   */
  renderDiffLines(content, type) {
    const lines = content.split('\n');
    const prefix = type === 'add' ? '+' : '-';
    const className = type === 'add' ? 'diff-add' : 'diff-remove';

    return lines.map(line => {
      return `<div class="diff-line ${className}"><span class="diff-prefix">${prefix}</span><span class="diff-content">${this.escapeHtml(line) || ' '}</span></div>`;
    }).join('');
  },

  /**
   * Render Write tool (new file)
   */
  renderWriteTool(data) {
    const filePath = data.file_path || '';
    const content = data.content || '';
    const fileName = filePath.split('/').pop();

    let html = `<div class="tool-file-header">`;
    html += `<span class="tool-file-icon">📄</span>`;
    html += `<span class="tool-file-path" title="${this.escapeHtml(filePath)}">${this.escapeHtml(fileName)}</span>`;
    html += `<span class="tool-badge new">NEW FILE</span>`;
    html += `</div>`;

    // Show content with line numbers
    html += `<div class="tool-code-block">`;
    html += this.renderCodeWithLineNumbers(content, fileName);
    html += `</div>`;

    return html;
  },

  /**
   * Render Read tool with syntax highlighting and line numbers
   */
  renderReadTool(data) {
    const filePath = data.file_path || '';
    const fileName = filePath.split('/').pop();
    const offset = data.offset || 0;
    const limit = data.limit;

    let html = `<div class="tool-file-header">`;
    html += `<span class="tool-file-icon">📖</span>`;
    html += `<span class="tool-file-path" title="${this.escapeHtml(filePath)}">${this.escapeHtml(fileName)}</span>`;
    if (offset || limit) {
      html += `<span class="tool-badge info">`;
      if (offset) html += `offset: ${offset}`;
      if (offset && limit) html += ', ';
      if (limit) html += `limit: ${limit}`;
      html += `</span>`;
    }
    html += `</div>`;

    // Will be populated by tool result
    html += `<div class="tool-code-block"><pre class="tool-pending">Reading file...</pre></div>`;

    return html;
  },

  /**
   * Render Bash tool with command highlighting
   */
  renderBashTool(data) {
    const command = data.command || '';
    const description = data.description || '';
    const timeout = data.timeout;

    let html = `<div class="tool-bash-header">`;
    html += `<span class="tool-bash-prompt">$</span>`;
    html += `<span class="tool-bash-command">${this.escapeHtml(command)}</span>`;
    if (timeout) {
      html += `<span class="tool-badge info">timeout: ${timeout}ms</span>`;
    }
    html += `</div>`;

    if (description) {
      html += `<div class="tool-bash-desc">${this.escapeHtml(description)}</div>`;
    }

    // Output will be populated by tool result
    html += `<div class="tool-bash-output"><pre class="tool-pending">Executing...</pre></div>`;

    return html;
  },

  /**
   * Render Grep tool with pattern highlighting
   */
  renderGrepTool(data) {
    const pattern = data.pattern || '';
    const path = data.path || '.';
    const glob = data.glob || '';
    const outputMode = data.output_mode || 'files_with_matches';

    let html = `<div class="tool-grep-header">`;
    html += `<span class="tool-grep-pattern">"${this.escapeHtml(pattern)}"</span>`;
    html += `<span class="tool-grep-path">in ${this.escapeHtml(path)}</span>`;
    if (glob) {
      html += `<span class="tool-badge info">${this.escapeHtml(glob)}</span>`;
    }
    html += `</div>`;

    // Store pattern for highlighting in results
    html += `<div class="tool-grep-results" data-pattern="${this.escapeHtml(pattern)}">`;
    html += `<pre class="tool-pending">Searching...</pre>`;
    html += `</div>`;

    return html;
  },

  /**
   * Render code with line numbers
   */
  renderCodeWithLineNumbers(content, fileName) {
    const lines = content.split('\n');
    const maxLineNum = lines.length;
    const padWidth = String(maxLineNum).length;

    // Check if content is too long, auto-collapse
    const MAX_VISIBLE_LINES = 20;
    const shouldCollapse = lines.length > MAX_VISIBLE_LINES;

    let html = `<div class="code-with-lines${shouldCollapse ? ' collapsed' : ''}">`;

    lines.forEach((line, idx) => {
      const lineNum = String(idx + 1).padStart(padWidth, ' ');
      const isHidden = shouldCollapse && idx >= MAX_VISIBLE_LINES;
      html += `<div class="code-line${isHidden ? ' hidden' : ''}">`;
      html += `<span class="line-number">${lineNum}</span>`;
      html += `<span class="line-content">${this.escapeHtml(line) || ' '}</span>`;
      html += `</div>`;
    });

    if (shouldCollapse) {
      html += `<div class="code-expand-btn" onclick="ChatMode.expandCodeBlock(this)">`;
      html += `Show ${lines.length - MAX_VISIBLE_LINES} more lines...`;
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  },

  /**
   * Expand collapsed code block
   */
  expandCodeBlock(btn) {
    const container = btn.closest('.code-with-lines');
    if (container) {
      container.classList.remove('collapsed');
      container.querySelectorAll('.code-line.hidden').forEach(el => el.classList.remove('hidden'));
      btn.remove();
    }
  },

  /**
   * Toggle tool content visibility
   */
  toggleToolContent(msgId) {
    // BUG-016 FIX: 在当前容器内查找
    const content = this.messagesEl?.querySelector(`#${msgId}-content`);
    const toggle = this.messagesEl?.querySelector(`#${msgId} .tool-toggle`);
    if (content) {
      content.classList.toggle('show');
      toggle?.classList.toggle('expanded');
    }
  },

  /**
   * Update tool result
   */
  updateToolResult(toolId, data) {
    // Find the tool message and update it
    const toolMsgs = this.messagesEl.querySelectorAll('.chat-message.tool');
    if (toolMsgs.length === 0) return;

    const lastTool = toolMsgs[toolMsgs.length - 1];
    const toolName = lastTool.querySelector('.tool-name')?.textContent || '';
    const isError = data.is_error || false;
    const stdout = data.stdout || data.content || '';
    const stderr = data.stderr || '';

    // Handle different tool types
    switch (toolName) {
      case 'Bash':
        this.updateBashResult(lastTool, stdout, stderr, isError);
        break;
      case 'Read':
        this.updateReadResult(lastTool, stdout, stderr, isError);
        break;
      case 'Grep':
        this.updateGrepResult(lastTool, stdout, stderr, isError);
        break;
      default:
        // Default handling
        const content = lastTool.querySelector('.tool-content pre');
        if (content) {
          if (isError) {
            content.className = 'tool-error';
          }
          content.textContent = stdout + (stderr ? '\n[stderr]\n' + stderr : '');
        }
    }
  },

  /**
   * Update Bash tool result with stdout/stderr separation
   */
  updateBashResult(toolEl, stdout, stderr, isError) {
    const outputEl = toolEl.querySelector('.tool-bash-output');
    if (!outputEl) return;

    let html = '';

    if (stdout) {
      html += `<div class="bash-stdout"><pre>${this.escapeHtml(stdout)}</pre></div>`;
    }

    if (stderr) {
      html += `<div class="bash-stderr">`;
      html += `<div class="bash-stderr-label">stderr:</div>`;
      html += `<pre>${this.escapeHtml(stderr)}</pre>`;
      html += `</div>`;
    }

    if (isError) {
      html += `<div class="bash-error-badge">✗ Error</div>`;
    } else if (!stdout && !stderr) {
      html += `<div class="bash-success-badge">✓ Success (no output)</div>`;
    }

    outputEl.innerHTML = html;
  },

  /**
   * Update Read tool result with code display
   */
  updateReadResult(toolEl, content, stderr, isError) {
    const codeBlock = toolEl.querySelector('.tool-code-block');
    if (!codeBlock) return;

    if (isError || stderr) {
      codeBlock.innerHTML = `<pre class="tool-error">${this.escapeHtml(stderr || content)}</pre>`;
      return;
    }

    // Get filename for syntax hints
    const fileName = toolEl.querySelector('.tool-file-path')?.textContent || '';
    codeBlock.innerHTML = this.renderCodeWithLineNumbers(content, fileName);
  },

  /**
   * Update Grep tool result with pattern highlighting
   */
  updateGrepResult(toolEl, content, stderr, isError) {
    const resultsEl = toolEl.querySelector('.tool-grep-results');
    if (!resultsEl) return;

    if (isError || stderr) {
      resultsEl.innerHTML = `<pre class="tool-error">${this.escapeHtml(stderr || content)}</pre>`;
      return;
    }

    const pattern = resultsEl.getAttribute('data-pattern') || '';
    const lines = content.split('\n').filter(line => line.trim());

    if (lines.length === 0) {
      resultsEl.innerHTML = `<div class="grep-no-results">No matches found</div>`;
      return;
    }

    // Highlight matches in results
    let html = `<div class="grep-results-list">`;
    lines.forEach(line => {
      const highlightedLine = this.highlightPattern(line, pattern);
      html += `<div class="grep-result-line">${highlightedLine}</div>`;
    });
    html += `</div>`;

    if (lines.length > 20) {
      html = `<div class="grep-count">${lines.length} matches</div>` + html;
    }

    resultsEl.innerHTML = html;
  },

  /**
   * Highlight pattern matches in text
   */
  highlightPattern(text, pattern) {
    if (!pattern) return this.escapeHtml(text);

    try {
      const escaped = this.escapeHtml(text);
      const regex = new RegExp(`(${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      return escaped.replace(regex, '<mark class="grep-match">$1</mark>');
    } catch (e) {
      return this.escapeHtml(text);
    }
  },

  /**
   * Show typing indicator
   */
  showTypingIndicator() {
    // BUG-016 FIX: 在当前容器内查找
    if (this.messagesEl?.querySelector('#typingIndicator')) return;

    const indicator = document.createElement('div');
    indicator.id = 'typingIndicator';
    indicator.className = 'chat-message assistant';
    indicator.innerHTML = `
      <div class="chat-bubble typing-indicator">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>
    `;
    this.messagesEl.appendChild(indicator);
    this.scrollToBottom();
  },

  /**
   * Hide typing indicator
   */
  hideTypingIndicator() {
    // BUG-016 FIX: 在当前容器内查找
    const indicator = this.messagesEl?.querySelector('#typingIndicator');
    if (indicator) {
      indicator.remove();
    }
  },

  /**
   * Append text to streaming message
   */
  appendToStreaming(text) {
    this.hideTypingIndicator();

    if (!this.isStreaming) {
      this.isStreaming = true;
      this.streamingMessageId = this.addMessage('assistant', '');
      // BUG-016 FIX: 在当前容器内查找
      const msgEl = this.messagesEl?.querySelector(`#${this.streamingMessageId}`);
      if (msgEl) {
        msgEl.classList.add('streaming');
      }
    }

    // BUG-016 FIX: 在当前容器内查找
    const msgEl = this.messagesEl?.querySelector(`#${this.streamingMessageId}`);
    if (msgEl) {
      const bubble = msgEl.querySelector('.chat-bubble');
      if (bubble) {
        // Append text
        const currentText = bubble.getAttribute('data-raw') || '';
        const newText = currentText + text;
        bubble.setAttribute('data-raw', newText);
        bubble.innerHTML = this.formatContent(newText);
      }
    }
    this.scrollToBottom();
  },

  /**
   * Finalize streaming message
   */
  finalizeStreaming(finalContent) {
    // BUG-016 FIX: 在当前容器内查找
    const msgEl = this.messagesEl?.querySelector(`#${this.streamingMessageId}`);
    if (msgEl) {
      msgEl.classList.remove('streaming');
      const bubble = msgEl.querySelector('.chat-bubble');
      if (bubble) {
        bubble.innerHTML = this.formatContent(finalContent);
      }
    }
    this.isStreaming = false;
    this.streamingMessageId = null;
  },

  // Thinking state
  thinkingMessageId: null,
  isThinking: false,

  /**
   * Start thinking block (streaming)
   */
  startThinking() {
    if (this.emptyEl) {
      this.emptyEl.style.display = 'none';
    }

    this.isThinking = true;
    this.thinkingMessageId = 'thinking-' + Date.now();

    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message thinking';
    msgEl.id = this.thinkingMessageId;

    const t = (key, fallback) => window.i18n ? window.i18n.t(key, fallback) : fallback;

    msgEl.innerHTML = `
      <div class="chat-bubble thinking-bubble">
        <div class="thinking-header" onclick="ChatMode.toggleThinking('${this.thinkingMessageId}')">
          <span class="thinking-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 16v-4"/>
              <path d="M12 8h.01"/>
            </svg>
          </span>
          <span class="thinking-label">${t('chat.thinking', 'Thinking...')}</span>
          <span class="thinking-toggle">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </span>
        </div>
        <div class="thinking-content show" id="${this.thinkingMessageId}-content"></div>
      </div>
    `;

    this.messagesEl.appendChild(msgEl);
    this.scrollToBottom();
  },

  /**
   * Append text to streaming thinking
   */
  appendToThinking(text) {
    if (!this.isThinking || !this.thinkingMessageId) return;

    const contentEl = this.messagesEl?.querySelector(`#${this.thinkingMessageId}-content`);
    if (contentEl) {
      const currentText = contentEl.getAttribute('data-raw') || '';
      const newText = currentText + text;
      contentEl.setAttribute('data-raw', newText);
      contentEl.innerHTML = this.formatContent(newText);
    }
    this.scrollToBottom();
  },

  /**
   * Finalize thinking block
   */
  finalizeThinking() {
    if (!this.thinkingMessageId) return;

    const msgEl = this.messagesEl?.querySelector(`#${this.thinkingMessageId}`);
    if (msgEl) {
      // Update label to show "Thought"
      const t = (key, fallback) => window.i18n ? window.i18n.t(key, fallback) : fallback;
      const label = msgEl.querySelector('.thinking-label');
      if (label) {
        label.textContent = t('chat.thought', 'Thought');
      }

      // Collapse by default after thinking is done
      const content = msgEl.querySelector('.thinking-content');
      const toggle = msgEl.querySelector('.thinking-toggle');
      if (content) {
        content.classList.remove('show');
      }
      if (toggle) {
        toggle.classList.remove('expanded');
      }
    }

    this.isThinking = false;
    this.thinkingMessageId = null;
  },

  /**
   * Add complete thinking message (non-streaming)
   */
  addThinkingMessage(content) {
    if (this.emptyEl) {
      this.emptyEl.style.display = 'none';
    }

    const msgId = 'thinking-' + Date.now();
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message thinking';
    msgEl.id = msgId;

    const t = (key, fallback) => window.i18n ? window.i18n.t(key, fallback) : fallback;

    // Non-streaming thinking is collapsed by default
    msgEl.innerHTML = `
      <div class="chat-bubble thinking-bubble">
        <div class="thinking-header" onclick="ChatMode.toggleThinking('${msgId}')">
          <span class="thinking-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 16v-4"/>
              <path d="M12 8h.01"/>
            </svg>
          </span>
          <span class="thinking-label">${t('chat.thought', 'Thought')}</span>
          <span class="thinking-toggle">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </span>
        </div>
        <div class="thinking-content" id="${msgId}-content">${this.formatContent(content)}</div>
      </div>
    `;

    this.messagesEl.appendChild(msgEl);
    this.scrollToBottom();

    return msgId;
  },

  /**
   * Toggle thinking content visibility
   */
  toggleThinking(msgId) {
    const content = this.messagesEl?.querySelector(`#${msgId}-content`);
    const toggle = this.messagesEl?.querySelector(`#${msgId} .thinking-toggle`);
    if (content) {
      content.classList.toggle('show');
      toggle?.classList.toggle('expanded');
    }
  },

  /**
   * Show result badge
   */
  showResultBadge(data) {
    const cost = data.cost_usd ? `$${data.cost_usd.toFixed(4)}` : '';
    const duration = data.duration_ms ? `${(data.duration_ms / 1000).toFixed(1)}s` : '';

    if (cost || duration) {
      const badge = document.createElement('div');
      badge.className = 'chat-result-badge success';
      badge.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 6L9 17l-5-5"/>
        </svg>
        ${[duration, cost].filter(Boolean).join(' / ')}
      `;
      this.messagesEl.appendChild(badge);
      this.scrollToBottom();
    }
  },

  /**
   * Format message content (Markdown-like)
   */
  formatContent(content) {
    if (!content) return '';

    let html = this.escapeHtml(content);

    // Code blocks (```) - with copy button
    let codeBlockId = 0;
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const id = `code-${Date.now()}-${codeBlockId++}`;
      const langLabel = lang ? `<span class="code-lang">${lang}</span>` : '';
      return `<div class="code-block-wrapper">
        <div class="code-block-header">
          ${langLabel}
          <button class="code-copy-btn" onclick="ChatMode.copyCode('${id}')" title="Copy code">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
        </div>
        <pre id="${id}"><code class="language-${lang}">${code.trim()}</code></pre>
      </div>`;
    });

    // Inline code (`)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold (**)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic (*)
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
  },

  /**
   * Copy code to clipboard
   */
  copyCode(codeId) {
    const codeEl = document.getElementById(codeId);
    if (!codeEl) return;

    const code = codeEl.textContent;
    navigator.clipboard.writeText(code).then(() => {
      // Show feedback
      const btn = codeEl.parentElement?.querySelector('.code-copy-btn');
      if (btn) {
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 6L9 17l-5-5"/>
        </svg>`;
        btn.classList.add('copied');
        setTimeout(() => {
          btn.innerHTML = originalHtml;
          btn.classList.remove('copied');
        }, 2000);
      }
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  },

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * Scroll to bottom
   */
  scrollToBottom() {
    requestAnimationFrame(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });
  },

  /**
   * Update status
   */
  updateStatus(status) {
    const t = (key, fallback) => window.i18n ? window.i18n.t(key, fallback) : fallback;

    this.statusDot.className = 'chat-status-dot ' + status;

    const texts = {
      connected: t('chat.status.connected', 'Connected'),
      disconnected: t('chat.status.disconnected', 'Disconnected'),
      connecting: t('chat.status.connecting', 'Connecting...')
    };

    this.statusTextEl.textContent = texts[status] || status;
  },

  /**
   * Minimize chat (hide to floating button)
   */
  minimize() {
    this.log('minimize');
    // Record that we're in chat mode when minimizing
    const session = window.app?.sessionManager?.getActive();
    if (session) {
      session.viewMode = 'chat';
    }
    // Use app's minimize which handles floating button
    if (window.app && window.app.minimizeCurrentSession) {
      window.app.minimizeCurrentSession();
    }
  },

  /**
   * Switch to terminal mode
   */
  switchToTerminal() {
    // Emit event for app to switch view
    if (window.app && window.app.switchToTerminalMode) {
      window.app.switchToTerminalMode(this.sessionId, this.workingDir);
    }
  },

  /**
   * Disconnect (取消订阅但保持 MuxWebSocket 连接)
   * WebSocket 连接由 MuxWebSocket 统一管理
   */
  disconnect() {
    if (window.muxWs && this.sessionId) {
      window.muxWs.disconnectChat(this.sessionId);
    }
    this.isConnected = false;
    this.isStreaming = false;
  }
};

// Export
window.ChatMode = ChatMode;
