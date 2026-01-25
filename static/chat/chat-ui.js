/**
 * Copyright (c) 2025 BillChen
 *
 * Chat Mode - UI module
 * UI rendering, event binding, and status updates
 */

Object.assign(ChatMode, {
  /**
   * Initialize Chat mode
   * Note: Main initialization logic is in connect(), this method is for backward compatibility
   */
  init(container) {
    // If passed #chat-view, ignore it, wait for connect() to use session's container
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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
            <span class="chat-title" id="chatTitle" style="cursor: pointer;" title="${t('debug.title', 'Debug Log')}">${t('chat.title', 'Chat')}</span>
          </div>
          <div class="chat-header-right">
            <button class="chat-minimize-btn" id="chatMinimizeBtn" title="${t('terminal.minimize', 'Minimize')}">
              <svg width="28" height="4" viewBox="0 0 28 4" fill="none">
                <rect x="0" y="0" width="28" height="4" rx="2" fill="currentColor"/>
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

    // Cache DOM elements - BUG-016 FIX: Use this.container.querySelector instead of document.getElementById
    // Because multiple session chat containers coexist, getElementById only returns the first match
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
    // BUG-016 FIX: Use this.container.querySelector instead of document.getElementById
    // Back button
    const backBtn = this.container.querySelector('#chatBackBtn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this.disconnect();
        // Use closeCurrentSession to completely exit session (cleanup SessionManager, floating button, etc.)
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

    // Terminal mode button - removed

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
      this.log(`[DIAG] sendBtn clicked, disabled=${this.sendBtn.disabled}`);
      this.sendMessage();
    });

    // Focus handling: scroll input into view when keyboard appears (mobile)
    this.inputEl.addEventListener('focus', () => {
      // Delay execution, wait for keyboard to appear
      setTimeout(() => {
        // Scroll messages area to bottom
        this.scrollToBottom();
        // Ensure input is visible
        this.inputEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 300);
    });

    // Scroll detection for infinite history loading and auto-scroll management
    this.messagesEl.addEventListener('scroll', () => {
      // When scrolled to top, load more history
      if (this.messagesEl.scrollTop < 100 && this.hasMoreHistory && !this.isLoadingHistory) {
        this.loadMoreHistory();
      }

      // Auto-scroll management: check if user is near bottom
      const distanceFromBottom = this.messagesEl.scrollHeight - this.messagesEl.scrollTop - this.messagesEl.clientHeight;
      const wasEnabled = this.autoScrollEnabled;
      this.autoScrollEnabled = distanceFromBottom < this.scrollThreshold;

      // Show/hide "new messages" button based on scroll position
      if (!this.autoScrollEnabled && this.isStreaming) {
        this.showNewMessagesButton();
      } else if (this.autoScrollEnabled) {
        this.hideNewMessagesButton();
      }

      // Log state change for debugging
      if (wasEnabled !== this.autoScrollEnabled) {
        this.log(`Auto-scroll ${this.autoScrollEnabled ? 'enabled' : 'disabled'} (distance: ${Math.round(distanceFromBottom)}px)`);
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

      // BUG-F3 FIX: Close panel when clicking outside
      // Clean up previous handler before adding new one
      if (this._documentClickHandler) {
        document.removeEventListener('click', this._documentClickHandler);
      }
      this._documentClickHandler = (e) => {
        if (!moreCmdsPanel.contains(e.target) && !moreCmdsBtn?.contains(e.target)) {
          moreCmdsPanel.classList.remove('show');
        }
      };
      document.addEventListener('click', this._documentClickHandler);
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
   * Update status
   */
  updateStatus(status) {
    const t = (key, fallback) => window.i18n ? window.i18n.t(key, fallback) : fallback;

    if (this.statusDot) {
      this.statusDot.className = 'chat-status-dot ' + status;
    }

    if (this.statusTextEl) {
      const texts = {
        connected: t('chat.status.connected', 'Connected'),
        disconnected: t('chat.status.disconnected', 'Disconnected'),
        connecting: t('chat.status.connecting', 'Connecting...')
      };
      this.statusTextEl.textContent = texts[status] || status;
    }
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

  // switchToTerminal() - removed

  /**
   * Disconnect (unsubscribe but keep MuxWebSocket connection)
   * WebSocket connection is managed by MuxWebSocket
   */
  disconnect() {
    if (window.muxWs && this.sessionId) {
      window.muxWs.disconnectChat(this.sessionId);
    }
    this.isConnected = false;
    this.isStreaming = false;

    // BUG-F3 FIX: Clean up document click handler
    if (this._documentClickHandler) {
      document.removeEventListener('click', this._documentClickHandler);
      this._documentClickHandler = null;
    }
  }
});
