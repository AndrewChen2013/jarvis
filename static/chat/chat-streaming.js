/**
 * Copyright (c) 2025 BillChen
 *
 * Chat Mode - Streaming module
 * Streaming messages, thinking blocks, typing indicator, and progress
 */

Object.assign(ChatMode, {
  /**
   * Show typing indicator
   */
  showTypingIndicator() {
    // BUG-016 FIX: Search within current container
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
    // BUG-016 FIX: Search within current container
    const indicator = this.messagesEl?.querySelector('#typingIndicator');
    if (indicator) {
      indicator.remove();
    }
  },

  /**
   * Append text to streaming message
   */
  appendToStreaming(text) {
    this.log(`[DIAG] appendToStreaming: isStreaming=${this.isStreaming}, streamingMessageId=${this.streamingMessageId}, sessionId=${this.sessionId?.substring(0, 8)}, text.length=${text?.length || 0}`);
    this.hideTypingIndicator();

    if (!this.isStreaming) {
      this.isStreaming = true;
      // Create streaming message element directly (don't use addMessage which rejects empty content)
      this.streamingMessageId = this._generateMessageId();
      const msgEl = document.createElement('div');
      msgEl.className = 'chat-message assistant streaming';
      msgEl.id = this.streamingMessageId;

      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      bubble.setAttribute('data-raw', '');
      msgEl.appendChild(bubble);

      if (this.messagesEl) {
        this.messagesEl.appendChild(msgEl);
        this.log(`[DIAG] appendToStreaming: created streaming message ${this.streamingMessageId}`);
      } else {
        this.log(`[DIAG] appendToStreaming: ERROR - messagesEl is null/undefined!`);
      }
    }

    // BUG-016 FIX: Search within current container
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
    this.log(`[DIAG] finalizeStreaming: streamingMessageId=${this.streamingMessageId}, isStreaming was ${this.isStreaming}`);

    // BUG-017 FIX: If streamingMessageId is null but we have content, create a new message
    if (!this.streamingMessageId && finalContent && finalContent.trim()) {
      this.log(`[DIAG] finalizeStreaming: no streamingMessageId, creating new message for content`);
      this.addMessage('assistant', finalContent, { timestamp: new Date().toISOString() });
      this.isStreaming = false;
      return;
    }

    // BUG-016 FIX: Search within current container
    const msgEl = this.messagesEl?.querySelector(`#${this.streamingMessageId}`);
    if (msgEl) {
      msgEl.classList.remove('streaming');
      this.log(`[DIAG] finalizeStreaming: removed .streaming class from ${this.streamingMessageId}`);
      const bubble = msgEl.querySelector('.chat-bubble');
      if (bubble) {
        bubble.innerHTML = this.formatContent(finalContent);
      }
      // Save the finalized message to session
      if (finalContent && finalContent.trim()) {
        const msg = { id: this.streamingMessageId, type: 'assistant', content: finalContent };
        this.saveMessageToSession(msg);
      }
    } else {
      this.log(`[DIAG] finalizeStreaming: WARNING - msgEl not found for ${this.streamingMessageId}`);
      // Fallback: create a new message if we have content
      if (finalContent && finalContent.trim()) {
        this.addMessage('assistant', finalContent, { timestamp: new Date().toISOString() });
      }
    }

    // BUG FIX: Also clean up any other stale streaming classes in the container
    this.messagesEl?.querySelectorAll('.chat-message.streaming').forEach(el => {
      el.classList.remove('streaming');
      this.log(`[DIAG] finalizeStreaming: cleaned up stale .streaming class from ${el.id}`);
    });

    this.isStreaming = false;
    this.streamingMessageId = null;
  },

  /**
   * Start thinking block (streaming)
   */
  startThinking() {
    if (this.emptyEl) {
      this.emptyEl.style.display = 'none';
    }

    // REFACTOR: Set both session-level and global state
    const session = this.getSession();
    const thinkingId = 'thinking-' + Date.now();
    if (session) {
      session.chatIsThinking = true;
      session.chatThinkingMessageId = thinkingId;
    }
    this.isThinking = true;
    this.thinkingMessageId = thinkingId;

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
    // REFACTOR: Check session-level state first
    const session = this.getSession();
    const isThinking = session?.chatIsThinking ?? this.isThinking;
    const thinkingId = session?.chatThinkingMessageId ?? this.thinkingMessageId;
    if (!isThinking || !thinkingId) return;

    const contentEl = this.messagesEl?.querySelector(`#${thinkingId}-content`);
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
    // REFACTOR: Check session-level state first
    const session = this.getSession();
    const thinkingId = session?.chatThinkingMessageId ?? this.thinkingMessageId;
    if (!thinkingId) return;

    const msgEl = this.messagesEl?.querySelector(`#${thinkingId}`);
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

    // REFACTOR: Clear both session-level and global state
    if (session) {
      session.chatIsThinking = false;
      session.chatThinkingMessageId = null;
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
    const msgEl = document.getElementById(msgId);
    if (!msgEl) return;
    const content = document.getElementById(`${msgId}-content`);
    const toggle = msgEl.querySelector('.thinking-toggle');
    if (content) {
      content.classList.toggle('show');
      toggle?.classList.toggle('expanded');
    }
  },

  /**
   * Show progress message (e.g., during /compact)
   */
  showProgressMessage(message) {
    // Check if progress indicator already exists
    let progressEl = this.messagesEl?.querySelector('#progressIndicator');

    if (!progressEl) {
      progressEl = document.createElement('div');
      progressEl.id = 'progressIndicator';
      progressEl.className = 'chat-message system progress';
      this.messagesEl.appendChild(progressEl);
    }

    progressEl.innerHTML = `
      <div class="chat-bubble progress-bubble">
        <span class="progress-spinner"></span>
        <span class="progress-text">${this.escapeHtml(message)}</span>
      </div>
    `;

    this.scrollToBottom();

    // Auto-hide after result message (will be cleaned up by result handler)
  },

  /**
   * Hide progress message
   */
  hideProgressMessage() {
    const progressEl = this.messagesEl?.querySelector('#progressIndicator');
    if (progressEl) {
      progressEl.remove();
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
  }
});
