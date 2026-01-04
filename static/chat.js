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
  ws: null,
  messages: [],
  isConnected: false,
  isStreaming: false,
  streamingMessageId: null,
  usingMux: false,  // Whether using multiplexed connection

  // DOM elements
  container: null,
  messagesEl: null,
  inputEl: null,
  sendBtn: null,

  /**
   * Debug log helper - uses app's debugLog
   */
  log(msg) {
    if (window.app?.debugLog) {
      window.app.debugLog('[Chat] ' + msg);
    }
  },

  /**
   * Initialize Chat mode
   */
  init(container) {
    this.container = container;
    this.render();
    this.bindEvents();
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
            <button class="chat-back-btn" id="chatBackBtn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
            </button>
            <span class="chat-title" id="chatTitle">${t('chat.title', 'Chat')}</span>
          </div>
          <div class="chat-header-right">
            <div class="chat-mode-toggle">
              <button class="chat-mode-btn active" data-mode="chat">${t('chat.mode.chat', 'Chat')}</button>
              <button class="chat-mode-btn" data-mode="terminal">${t('chat.mode.terminal', 'Terminal')}</button>
            </div>
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

    // Cache DOM elements
    this.messagesEl = document.getElementById('chatMessages');
    this.inputEl = document.getElementById('chatInput');
    this.sendBtn = document.getElementById('chatSendBtn');
    this.statusEl = document.getElementById('chatStatus');
    this.statusTextEl = document.getElementById('chatStatusText');
    this.statusDot = this.statusEl.querySelector('.chat-status-dot');
    this.emptyEl = document.getElementById('chatEmpty');
  },

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Back button
    document.getElementById('chatBackBtn').addEventListener('click', () => {
      this.disconnect();
      if (window.app && window.app.showView) {
        window.app.showView('sessions');
      }
    });

    // Mode toggle
    this.container.querySelectorAll('.chat-mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mode = e.target.dataset.mode;
        if (mode === 'terminal') {
          this.switchToTerminal();
        }
      });
    });

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
  },

  /**
   * Connect to chat session
   * 使用 SessionManager 管理的 chatWs，实现连接复用
   * 当 app.useMux 启用时，使用多路复用 WebSocket
   */
  connect(sessionId, workingDir) {
    this.sessionId = sessionId;
    this.workingDir = workingDir;

    // Update title
    const title = workingDir.split('/').pop() || 'Chat';
    document.getElementById('chatTitle').textContent = title;

    // 获取当前 session 实例
    const session = window.app?.sessionManager?.getActive();
    if (!session) {
      this.log('ERROR: No active session found');
      this.updateStatus('disconnected');
      return;
    }

    // 检查是否启用多路复用
    const useMux = window.app?.isUseMux?.() !== false && window.muxWs;
    this.log(`Connect: useMux=${useMux}`);

    if (useMux) {
      this.connectMux(sessionId, workingDir, session);
      return;
    }

    // 检查 session 是否已有 chatWs 且连接正常
    if (session.chatWs && session.chatWs.readyState === WebSocket.OPEN) {
      this.log('Reusing existing connection from session');
      this.ws = session.chatWs;
      this.isConnected = true;
      this.updateStatus('connected');
      // 启用发送按钮
      if (this.sendBtn && this.inputEl) {
        this.sendBtn.disabled = !this.inputEl.value.trim();
      }
      return;
    }

    // 需要新建连接
    // 获取 Terminal 的 Claude session ID 用于恢复历史
    const claudeSessionId = session.claudeSessionId;
    this.log(`Session info: id=${session.id?.substring(0, 8)}, claudeSessionId=${claudeSessionId?.substring(0, 8) || 'null'}`);
    this.log(`Creating new WebSocket connection (resume: ${claudeSessionId || 'none'})`);

    // Build WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = window.app?.token || localStorage.getItem('auth_token');
    let wsUrl = `${protocol}//${window.location.host}/ws/chat/${sessionId}?token=${token}`;
    if (workingDir) {
      wsUrl += `&working_dir=${encodeURIComponent(workingDir)}`;
    }
    // 如果有 Terminal 的 Claude session ID，添加 resume 参数以恢复历史
    if (claudeSessionId) {
      wsUrl += `&resume=${encodeURIComponent(claudeSessionId)}`;
    }

    this.updateStatus('connecting');
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      this.log('WebSocket connected');
      // 保存到 session 实例
      session.chatWs = ws;
      this.ws = ws;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (e) {
        this.log('ERROR: Failed to parse message: ' + e.message);
      }
    };

    ws.onclose = (event) => {
      this.log('WebSocket closed: ' + event.code);
      this.isConnected = false;
      this.updateStatus('disconnected');
      // 清除 session 中的引用
      if (session.chatWs === ws) {
        session.chatWs = null;
      }
    };

    ws.onerror = (error) => {
      this.log('WebSocket error: ' + error);
      this.updateStatus('disconnected');
    };

    // 先设置 this.ws 以便后续操作
    this.ws = ws;
  },

  /**
   * Connect using multiplexed WebSocket
   */
  connectMux(sessionId, workingDir, session) {
    this.log(`connectMux: session=${sessionId?.substring(0, 8)}, workingDir=${workingDir}`);
    this.usingMux = true;
    this.updateStatus('connecting');

    // 获取 Terminal 的 Claude session ID 用于恢复历史
    const claudeSessionId = session.claudeSessionId;

    // 使用 muxWs 连接
    window.muxWs.connectChat(sessionId, workingDir, {
      resume: claudeSessionId,
      onConnect: (data) => {
        this.log(`[MuxWS] Chat connected, workingDir=${data.working_dir}`);
        this.isConnected = true;
        this.updateStatus('connected');
        if (this.sendBtn && this.inputEl) {
          this.sendBtn.disabled = !this.inputEl.value.trim();
        }
      },
      onMessage: (type, data) => {
        this.handleMuxMessage(type, data);
      },
      onDisconnect: () => {
        this.log(`[MuxWS] Chat disconnected`);
        this.isConnected = false;
        this.updateStatus('disconnected');
      }
    });
  },

  /**
   * Handle message from multiplexed connection
   */
  handleMuxMessage(type, data) {
    // Convert mux message format to the format handleMessage expects
    const message = { type, ...data };
    this.handleMessage(message);
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
        this.addMessage('user', data.content);
        this.showTypingIndicator();
        break;

      case 'stream':
        this.appendToStreaming(data.text);
        break;

      case 'assistant':
        this.hideTypingIndicator();
        if (this.isStreaming) {
          this.finalizeStreaming(data.content);
        } else {
          this.addMessage('assistant', data.content);
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

    if (this.usingMux && window.muxWs) {
      // 使用多路复用发送
      window.muxWs.chatMessage(this.sessionId, content);
    } else if (this.ws) {
      // 使用传统 WebSocket 发送
      this.ws.send(JSON.stringify({
        type: 'message',
        content: content
      }));
    }

    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';
    this.sendBtn.disabled = true;
  },

  /**
   * Add message to chat
   */
  addMessage(type, content, extra = {}) {
    // Hide empty state
    if (this.emptyEl) {
      this.emptyEl.style.display = 'none';
    }

    const msgId = 'msg-' + Date.now();
    const msgEl = document.createElement('div');
    msgEl.className = `chat-message ${type}`;
    msgEl.id = msgId;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = this.formatContent(content);

    msgEl.appendChild(bubble);
    this.messagesEl.appendChild(msgEl);

    this.messages.push({ id: msgId, type, content, ...extra });
    this.scrollToBottom();

    return msgId;
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

    const t = (key, fallback) => window.i18n ? window.i18n.t(key, fallback) : fallback;
    const actionText = action === 'call' ? t('chat.tool.calling', 'Calling') : t('chat.tool.result', 'Result');

    msgEl.innerHTML = `
      <div class="chat-bubble">
        <div class="tool-header" onclick="ChatMode.toggleToolContent('${msgId}')">
          <span class="tool-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
            </svg>
          </span>
          <span class="tool-name">${toolName}</span>
          <span class="tool-toggle">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </span>
        </div>
        <div class="tool-content" id="${msgId}-content">
          <pre>${this.escapeHtml(JSON.stringify(data, null, 2))}</pre>
        </div>
      </div>
    `;

    this.messagesEl.appendChild(msgEl);
    this.scrollToBottom();

    return msgId;
  },

  /**
   * Toggle tool content visibility
   */
  toggleToolContent(msgId) {
    const content = document.getElementById(msgId + '-content');
    const toggle = document.querySelector(`#${msgId} .tool-toggle`);
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
    if (toolMsgs.length > 0) {
      const lastTool = toolMsgs[toolMsgs.length - 1];
      const content = lastTool.querySelector('.tool-content pre');
      if (content) {
        const result = data.stdout || data.content || '';
        const error = data.stderr || '';
        content.textContent = result + (error ? '\n[stderr]\n' + error : '');
      }
    }
  },

  /**
   * Show typing indicator
   */
  showTypingIndicator() {
    if (document.getElementById('typingIndicator')) return;

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
    const indicator = document.getElementById('typingIndicator');
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
      const msgEl = document.getElementById(this.streamingMessageId);
      if (msgEl) {
        msgEl.classList.add('streaming');
      }
    }

    const msgEl = document.getElementById(this.streamingMessageId);
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
    const msgEl = document.getElementById(this.streamingMessageId);
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

    // Code blocks (```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
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
   * Switch to terminal mode
   */
  switchToTerminal() {
    // Update toggle UI
    this.container.querySelectorAll('.chat-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === 'terminal');
    });

    // Emit event for app to switch view
    if (window.app && window.app.switchToTerminalMode) {
      window.app.switchToTerminalMode(this.sessionId, this.workingDir);
    }
  },

  /**
   * Disconnect (仅清除本地引用，不关闭连接)
   * WebSocket 连接由 SessionManager 管理，切换模式时保持连接
   */
  disconnect() {
    // 如果使用多路复用，取消订阅但保持连接
    if (this.usingMux && window.muxWs && this.sessionId) {
      window.muxWs.disconnectChat(this.sessionId);
      this.usingMux = false;
    }

    // 不关闭连接，只清除本地引用
    // 连接会在 session 关闭时由 SessionManager.closeSession() 关闭
    this.ws = null;
    this.isConnected = false;
    this.isStreaming = false;
  }
};

// Export
window.ChatMode = ChatMode;
