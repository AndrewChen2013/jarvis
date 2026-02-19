/**
 * Copyright (c) 2025 BillChen
 *
 * Chat Mode - Messages module
 * Message adding, history loading, deduplication, and scrolling
 */

Object.assign(ChatMode, {
  /**
   * Create message DOM element (without inserting)
   */
  createMessageElement(type, content, extra = {}) {
    const msgId = this._generateMessageId();  // BUG-F4 FIX: Use counter-based unique ID
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
    this.log(`[DIAG] addMessage: type=${type}, content="${content?.substring(0, 30)}", messagesEl=${this.messagesEl?.id || 'null'}, childCount=${this.messagesEl?.childElementCount}, visible=${this.messagesEl?.offsetParent !== null}`);

    // Hide empty state
    if (this.emptyEl) {
      this.emptyEl.style.display = 'none';
    }

    // If message has tool_calls (from history), render them first
    if (extra.tool_calls && Array.isArray(extra.tool_calls)) {
      for (const toolCall of extra.tool_calls) {
        const toolEl = this.createToolMessageElement(toolCall.name, toolCall.input, extra.timestamp);
        if (extra.prepend) {
          const insertBefore = this.messagesEl.firstChild;
          if (insertBefore) {
            this.messagesEl.insertBefore(toolEl, insertBefore);
          } else {
            this.messagesEl.appendChild(toolEl);
          }
        } else {
          this.messagesEl.appendChild(toolEl);
        }
      }
    }

    // Skip empty content messages (tool-only messages)
    if (!content || !content.trim()) {
      return null;
    }

    const msgId = this._generateMessageId();  // BUG-F4 FIX: Use counter-based unique ID
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
      this.log(`[DIAG] addMessage: appended ${msgId}, newChildCount=${this.messagesEl?.childElementCount}`);
      // Save message to current session
      const msg = { id: msgId, type, content, ...extra };
      this.saveMessageToSession(msg);
      this.scrollToBottom();
    }

    return msgId;
  },

  /**
   * Load more chat history (older messages)
   */
  loadMoreHistory() {
    // REFACTOR: Use session-level state
    const session = this.getSession();
    const isLoading = session?.chatIsLoadingHistory ?? this.isLoadingHistory;
    const hasMore = session?.chatHasMoreHistory ?? this.hasMoreHistory;
    const oldestIndex = session?.chatHistoryOldestIndex ?? this.historyOldestIndex;

    // Check if already loading - also check if loading indicator already exists
    const existingIndicator = this.messagesEl?.querySelector('#historyLoadingIndicator');
    if (!this.isConnected || isLoading || !hasMore || existingIndicator) {
      return;
    }

    // Set loading state - both session-level and global
    if (session) {
      session.chatIsLoadingHistory = true;
    }
    this.isLoadingHistory = true;
    this.historyLoadingForSession = this.sessionId;  // BUG-014 FIX: Track which session is loading
    this.log(`Loading more history for session ${this.sessionId?.substring(0, 8)}, before index: ${oldestIndex}`);

    // Show loading indicator at top (only one)
    const loadingEl = document.createElement('div');
    loadingEl.className = 'chat-history-loading';
    loadingEl.id = 'historyLoadingIndicator';
    loadingEl.innerHTML = '<span class="loading-spinner"></span> Loading...';
    this.messagesEl.insertBefore(loadingEl, this.messagesEl.firstChild);

    // Request more history via MuxWebSocket
    // REFACTOR: Use session-level oldestIndex
    if (window.muxWs) {
      window.muxWs.send('chat', this.sessionId, 'load_more_history', {
        before_index: oldestIndex,
        limit: 50
      });
    }
  },

  /**
   * Check if a message is a duplicate of recent messages
   */
  isDuplicateMessage(type, content, timestamp) {
    // During history loading, we are receiving verified history from server,
    // so we don't need to perform duplicate checks which might skip valid history.
    // REFACTOR: Check session-level state first
    const session = this.getSession();
    const isLoading = session?.chatIsLoadingHistory ?? this.isLoadingHistory;
    if (isLoading) return false;

    // Use session-level messages array
    const messages = session?.chatMessages ?? this.messages;
    if (!messages || messages.length === 0) return false;

    // Check the last 50 messages
    const checkCount = Math.min(messages.length, 50);
    const startIndex = messages.length - checkCount;

    for (let i = messages.length - 1; i >= startIndex; i--) {
      const msg = messages[i];
      if (msg.type === type) {
        // Content match
        let isContentMatch = false;
        if (typeof msg.content === 'string' && typeof content === 'string') {
          isContentMatch = msg.content === content;
        } else {
          // Deep compare objects if needed, but for now strict equality or stringify
          isContentMatch = JSON.stringify(msg.content) === JSON.stringify(content);
        }

        if (isContentMatch) {
          // If we have timestamps, check if they are close (e.g., within 60 seconds)
          // Backend history messages might have slightly different timestamps than frontend generated ones
          if (timestamp && msg.extra?.timestamp) {
            const msgTime = new Date(msg.extra.timestamp).getTime();
            const newTime = new Date(timestamp).getTime();
            // Allow 60s variance
            if (Math.abs(newTime - msgTime) < 60000) {
              return true;
            }
          } else if (type === 'user') {
            // User messages without timestamp should NOT be deduped
            // Users can legitimately send the same message repeatedly ("yes", "ok")
            continue;
          } else {
            // If no timestamp to compare, assume duplicate if it's the very last message of this type
            // to be safe against echoes
            return true;
          }
        }
      }
    }
    return false;
  },

  /**
   * Check if a user message is a duplicate of the last message
   * @deprecated Use isDuplicateMessage instead
   */
  isDuplicateUserMessage(content) {
    return this.isDuplicateMessage('user', content, null);
  },

  /**
   * Send message
   */
  sendMessage() {
    const content = this.inputEl.value.trim();
    this.log(`[DIAG] sendMessage: content="${content?.substring(0, 20)}", isConnected=${this.isConnected}, sessionId=${this.sessionId?.substring(0, 8)}, muxWs.state=${window.muxWs?.state}`);
    // 只检查内容和连接状态，不检查 isStreaming
    // Claude CLI 支持并发消息，前端不需要阻止
    if (!content || !this.isConnected) {
      this.log(`[DIAG] sendMessage: BLOCKED - content=${!!content}, isConnected=${this.isConnected}`);
      return;
    }

    // Force enable auto-scroll when sending message
    // REFACTOR: Update both session-level and global state
    const sessionForSend = this.getSession();
    if (sessionForSend) {
      sessionForSend.chatAutoScrollEnabled = true;
    }
    this.autoScrollEnabled = true;
    this.hideNewMessagesButton();

    // Ensure messagesEl points to correct container
    // Fix: Re-fetch current session's container before sending to avoid reference mismatch
    // Use getSession() (based on this.sessionId) instead of getActive() to avoid
    // pointing to the wrong session during fast session switching
    const session = this.getSession();
    if (session?.chatContainer) {
      const correctMessagesEl = session.chatContainer.querySelector('#chatMessages') ||
                                session.chatContainer.querySelector('.chat-messages');
      if (correctMessagesEl && correctMessagesEl !== this.messagesEl) {
        this.log(`sendMessage: fixing messagesEl reference`);
        this.messagesEl = correctMessagesEl;
      }
    }

    // Show user message immediately for better UX
    // Don't wait for backend user_ack to avoid message not showing
    this.addMessage('user', content, { timestamp: new Date().toISOString() });
    this.showTypingIndicator();

    // Use this.sessionId which is the Chat's own session ID
    // Note: session?.id might be Terminal's UUID after renameSession, so don't use it
    if (window.muxWs) {
      window.muxWs.chatMessage(this.sessionId, content);
    }

    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';
    this.sendBtn.disabled = true;
  },

  /**
   * Scroll to bottom
   * BUG FIX: Capture messagesEl reference to avoid scrolling wrong container
   * when context switches between sessions during async requestAnimationFrame
   * @param {boolean} force - Force scroll even if autoScrollEnabled is false
   */
  scrollToBottom(force = false) {
    // REFACTOR: Use session-level state
    const session = this.getSession();
    const autoScrollEnabled = session?.chatAutoScrollEnabled ?? this.autoScrollEnabled;
    const isStreaming = session?.chatIsStreaming ?? this.isStreaming;

    // Skip if auto-scroll is disabled (user is reading history) unless forced
    if (!force && !autoScrollEnabled) {
      // Show new messages button if streaming
      if (isStreaming) {
        this.showNewMessagesButton();
      }
      return;
    }

    // Capture current messagesEl reference before async callback
    const targetEl = this.messagesEl;

    // Skip scrolling for hidden/non-visible containers (performance optimization)
    // Hidden containers will scroll when they become visible
    if (targetEl && targetEl.offsetParent === null) {
      return;
    }

    requestAnimationFrame(() => {
      if (targetEl) {
        targetEl.scrollTo({
          top: targetEl.scrollHeight,
          behavior: 'smooth'
        });
        // Re-enable auto-scroll after forced scroll
        // REFACTOR: Update both session-level and global state
        if (force) {
          if (session) {
            session.chatAutoScrollEnabled = true;
          }
          this.autoScrollEnabled = true;
          this.hideNewMessagesButton();
        }
      }
    });
  },

  /**
   * Show "new messages" button when user scrolls up during streaming
   */
  showNewMessagesButton() {
    if (!this.messagesEl) return;

    let btn = this.messagesEl.parentElement?.querySelector('.chat-new-messages-btn');
    if (!btn) {
      const t = (key, fallback) => window.i18n ? window.i18n.t(key, fallback) : fallback;
      btn = document.createElement('button');
      btn.className = 'chat-new-messages-btn';
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12l7 7 7-7"/>
        </svg>
        <span>${t('chat.newMessages', 'New messages')}</span>
      `;
      btn.addEventListener('click', () => {
        this.scrollToBottom(true);
      });
      // Insert before input area
      const inputArea = this.messagesEl.parentElement?.querySelector('.chat-input-area');
      if (inputArea) {
        inputArea.parentElement.insertBefore(btn, inputArea);
      }
    }
    btn.classList.add('show');
  },

  /**
   * Hide "new messages" button
   */
  hideNewMessagesButton() {
    const btn = this.messagesEl?.parentElement?.querySelector('.chat-new-messages-btn');
    if (btn) {
      btn.classList.remove('show');
    }
  }
});
