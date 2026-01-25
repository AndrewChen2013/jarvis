/**
 * Copyright (c) 2025 BillChen
 *
 * Chat Mode - WebSocket module
 * WebSocket connection, message handling, and session management
 */

Object.assign(ChatMode, {
  /**
   * Connect to chat session
   * Uses SessionManager managed chatWs for connection reuse
   * When app.useMux is enabled, uses multiplexed WebSocket
   */
  connect(sessionId, workingDir) {
    this.log(`connect: sessionId=${sessionId?.substring(0, 8)}, workingDir=${workingDir}`);
    this.log(`[DIAG] connect: current ChatMode.sessionId=${this.sessionId?.substring(0, 8)}, isStreaming=${this.isStreaming}`);

    const sessionManager = window.app?.sessionManager;

    // BUG-015 FIX: Prefer activeId to get session, not relying on passed sessionId
    // Because sessionId might be old cached value (ID before rename)
    let session = sessionManager?.sessions.get(sessionId);
    if (!session && sessionManager?.activeId) {
      // Try to get with activeId
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

    // BUG FIX: If Chat was already connected for this session, use the original connection ID
    // instead of session.id (which may have been renamed by Terminal)
    // chatConnectionId stores the session ID that was used when connectMux was called
    if (session.chatConnectionId) {
      this.log(`connect: using existing chatConnectionId=${session.chatConnectionId?.substring(0, 8)} instead of sessionId=${sessionId?.substring(0, 8)}`);
      sessionId = session.chatConnectionId;
    }

    // When switching to different session, save session state
    if (this.sessionId && this.sessionId !== sessionId) {
      const oldSession = window.app?.sessionManager?.sessions.get(this.sessionId);
      if (oldSession) {
        // Save streaming state
        oldSession.chatIsStreaming = this.isStreaming;
        oldSession.chatStreamingMessageId = this.streamingMessageId;
        // Save or create session's chat container
        if (this.inputEl) {
          oldSession.chatInputValue = this.inputEl.value;
        }
      }

      // BUG-014 FIX: Reset history loading state when switching to different session
      // This prevents history messages from one session being inserted into another
      if (this.isLoadingHistory && this.historyLoadingForSession !== sessionId) {
        this.log(`BUG-014 FIX: Resetting history loading state (was loading for ${this.historyLoadingForSession?.substring(0, 8)})`);
        this.isLoadingHistory = false;
        this.pendingHistoryMessages = [];
        this.historyLoadingForSession = null;
      }
    }

    // Always update current sessionId
    this.sessionId = sessionId;
    this.workingDir = workingDir;

    // Save or create session's chat container
    if (sessionManager) {
      sessionManager.getOrCreateChatContainer(session);
      sessionManager.showChatContainer(session);
    }

    // Check if container already has content (already initialized, just update reference)
    const isNewContainer = !session.chatContainer.innerHTML.trim();

    if (!isNewContainer) {
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

      // Restore streaming state
      this.isStreaming = session.chatIsStreaming || false;
      this.streamingMessageId = session.chatStreamingMessageId || null;
      this.messages = session.chatMessages;

      // BUG FIX: Clean up stale streaming classes to prevent cursor from blinking forever
      // If not currently streaming, remove all streaming classes from this container
      if (!this.isStreaming) {
        this.messagesEl?.querySelectorAll('.chat-message.streaming').forEach(el => {
          el.classList.remove('streaming');
          this.log(`connect: removed stale .streaming class from ${el.id}`);
        });
      }

      this.log(`connect: restored container, messages=${this.messages.length}`);

      // Scroll to bottom when switching to existing container
      // (hidden containers skip scroll, so we need to scroll when becoming visible)
      this.scrollToBottom();
    } else {
      // New container, need to render
      this.container = session.chatContainer;
      this.messages = session.chatMessages;
      this.isStreaming = false;
      this.streamingMessageId = null;
      this.render();
      this.bindEvents();

      // If we already have messages in memory for this session, render them now
      if (this.messages && this.messages.length > 0) {
        this.log(`connect: rendering ${this.messages.length} existing messages`);
        // Hide empty state if there are messages
        if (this.emptyEl) this.emptyEl.style.display = 'none';

        const fragment = document.createDocumentFragment();
        for (const msg of this.messages) {
          // Note: createMessageElement handles formatting and timestamp
          const msgEl = this.createMessageElement(msg.type, msg.content, msg.extra || {});
          fragment.appendChild(msgEl);
        }
        this.messagesEl.appendChild(fragment);
        this.scrollToBottom();
      }

      this.log(`connect: rendered new container`);
    }

    // Update title - prefer session name, fallback to workDir
    const title = session.name || workingDir.split('/').pop() || 'Chat';
    const titleEl = this.container?.querySelector('#chatTitle');
    if (titleEl) {
      titleEl.textContent = title;
    }

    // Restore input content
    if (this.inputEl && session.chatInputValue) {
      this.inputEl.value = session.chatInputValue;
      // Trigger input event to adjust height and update send button state
      this.inputEl.dispatchEvent(new Event('input'));
      this.log(`Restored input for ${sessionId?.substring(0, 8)}: "${session.chatInputValue.substring(0, 20)}..."`);
    }

    // Use MuxWebSocket uniformly
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

    // BUG FIX: Store the session ID used for this connection
    // This is important because session.id may be renamed by Terminal later,
    // but we need to use the original ID for sending messages
    if (!session.chatConnectionId) {
      session.chatConnectionId = sessionId;
      this.log(`connectMux: stored chatConnectionId=${sessionId?.substring(0, 8)}`);
    }

    // Get Chat mode's independent Claude session ID for history recovery
    // Priority: chatClaudeSessionId > session.id
    // - chatClaudeSessionId: Chat mode's previously used Claude session (separate from Terminal)
    // - session.id: Original session ID, for recovering old Chat history (compatibility)
    // Note: Backend will verify if session file exists, if not will create new session
    const claudeSessionId = session.chatClaudeSessionId || session.id;

    // BUG-017 FIX: Capture current session with closure, ensure messages route to correct container
    // Because ChatMode is singleton, but may have multiple sessions connected simultaneously
    const capturedSession = session;
    const capturedSessionId = sessionId;

    // Use muxWs to connect
    window.muxWs.connectChat(sessionId, workingDir, {
      resume: claudeSessionId,
      onConnect: (data) => {
        this.log(`[DIAG] onConnect: workingDir=${data.working_dir}, this.sessionId=${this.sessionId?.substring(0, 8)}, capturedSessionId=${capturedSessionId?.substring(0, 8)}, original_session_id=${data.original_session_id?.substring(0, 8)}`);
        // Only active session updates UI state
        // BUG-011 FIX: Also check original_session_id, because session may have been renamed
        // When session is renamed from temp ID (like new-1768...) to UUID,
        // this.sessionId has been updated but capturedSessionId is still old value
        const isCurrentSession = this.sessionId === capturedSessionId ||
                                 data.original_session_id === capturedSessionId;
        this.log(`[DIAG] onConnect: isCurrentSession=${isCurrentSession}, will set isConnected=${isCurrentSession}`);
        if (isCurrentSession) {
          this.isConnected = true;
          this.updateStatus('connected');
          if (this.sendBtn && this.inputEl) {
            this.sendBtn.disabled = !this.inputEl.value.trim();
            this.log(`[DIAG] onConnect: sendBtn.disabled=${this.sendBtn.disabled}, inputValue="${this.inputEl.value.substring(0, 10)}"`);
          }
        } else {
          this.log(`[DIAG] onConnect: NOT current session, isConnected stays ${this.isConnected}`);
        }

        // Auto-load history (if local messages are empty)
        // Backend automatically pushes latest 50 history messages on connect, so no need to actively load here
        // Otherwise would cause duplication (backend pushes once, frontend pulls once)
        /*
        if (this.messages.length === 0) {
          this.log(`[MuxWS] Initial connection, loading history...`);
          // Initial history load, reset state
          this.historyOldestIndex = -1; // -1 means start from newest
          this.hasMoreHistory = true;
          this.loadMoreHistory();
        }
        */
      },
      onMessage: (type, data) => {
        // BUG-017 FIX: Use captured session to handle messages
        this.handleMuxMessageForSession(type, data, capturedSession, capturedSessionId);
      },
      onDisconnect: () => {
        this.log(`[MuxWS] Chat disconnected for ${capturedSessionId?.substring(0, 8)}`);
        // Only active session updates UI state
        // BUG-011 FIX: Use captured session to judge, because session may have been renamed
        const session = capturedSession;
        const isCurrentSession = this.sessionId === capturedSessionId ||
                                 (session && session.id === this.sessionId);
        if (isCurrentSession) {
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
   * Ensure messages are routed to correct session container
   */
  handleMuxMessageForSession(type, data, targetSession, targetSessionId) {
    // Get target session's container and elements
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

    // Convert message to format handleMessage expects
    const message = { type, ...data };

    // Use target session's container to handle message
    this.handleMessageForSession(message, targetSession, targetSessionId, container, messagesEl);
  },

  /**
   * BUG-017 FIX: Handle message for a specific session with its own container
   * Temporarily switch to target session's context to handle message, then restore
   */
  handleMessageForSession(data, targetSession, targetSessionId, container, messagesEl) {
    // If target is current active session
    if (this.sessionId === targetSessionId) {
      // Fix: If messagesEl reference is inconsistent, update to correct reference
      if (this.messagesEl !== messagesEl) {
        this.log(`handleMessageForSession: updating messagesEl reference for active session`);
        this.messagesEl = messagesEl;
        this.emptyEl = container.querySelector('#chatEmpty') || container.querySelector('.chat-empty');
      }
      this.handleMessage(data);
      return;
    }

    // Non-active session: save current context
    const savedMessagesEl = this.messagesEl;
    const savedEmptyEl = this.emptyEl;
    const savedMessages = this.messages;
    const savedIsStreaming = this.isStreaming;
    const savedStreamingMessageId = this.streamingMessageId;

    // Temporarily switch to target session's context
    this.messagesEl = messagesEl;
    this.emptyEl = container.querySelector('#chatEmpty') || container.querySelector('.chat-empty');
    this.messages = targetSession.chatMessages;
    this.isStreaming = targetSession.chatIsStreaming || false;
    this.streamingMessageId = targetSession.chatStreamingMessageId || null;

    try {
      // Handle message (skip status update, because not current active session)
      this.handleMessageWithoutStatusUpdate(data, targetSession);
    } finally {
      // Save target session's streaming state
      targetSession.chatIsStreaming = this.isStreaming;
      targetSession.chatStreamingMessageId = this.streamingMessageId;

      // Restore original context
      this.messagesEl = savedMessagesEl;
      this.emptyEl = savedEmptyEl;
      this.messages = savedMessages;

      // BUG FIX: If handling current active session, don't restore old isStreaming state
      // Otherwise result message's isStreaming=false will be overwritten, causing unable to send second message
      const isCurrentSession = targetSession.id === this.sessionId;
      if (!isCurrentSession) {
        this.isStreaming = savedIsStreaming;
        this.streamingMessageId = savedStreamingMessageId;
      }
    }
  },

  /**
   * Handle message without updating global status (for non-active sessions)
   */
  handleMessageWithoutStatusUpdate(data, targetSession) {
    switch (data.type) {
      case 'ready':
        // Don't update global status, only record to session
        break;

      case 'system':
        // Update Chat mode's independent Claude session ID to target session
        if (data.data && data.data.session_id) {
          targetSession.chatClaudeSessionId = data.data.session_id;
          this.log(`Updated chatClaudeSessionId for ${targetSession.id?.substring(0, 8)}`);
        }
        break;

      case 'user_ack':
        // User message already shown in sendMessage, here only for confirmation
        // Don't add message again
        break;

      case 'user':
        // User message deduplication
        if (this.isDuplicateMessage('user', data.content, data.timestamp)) {
          this.log('Skipping duplicate user message');
          return;
        }
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
          // Assistant message deduplication
          if (this.isDuplicateMessage('assistant', data.content, data.timestamp)) {
            this.log('Skipping duplicate assistant message');
            return;
          }
          this.addMessage('assistant', data.content, { timestamp: data.timestamp });
        }
        break;

      case 'tool_call':
        this.log(`[DIAG] handleMessageWithoutStatusUpdate tool_call: tool_name=${data.tool_name}`);
        this.hideTypingIndicator();
        this.addToolMessage('call', data.tool_name, data.input, data.timestamp);
        break;

      case 'tool_result':
        this.log(`[DIAG] handleMessageWithoutStatusUpdate tool_result: tool_id=${data.tool_id}`);
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
        this.log(`[DIAG] result(1): isStreaming was ${this.isStreaming}, streamingMessageId=${this.streamingMessageId}`);
        this.hideTypingIndicator();
        this.hideProgressMessage();
        // Ensure remove .streaming class (even if assistant message not properly handled)
        if (this.streamingMessageId) {
          const msgEl = this.messagesEl?.querySelector(`#${this.streamingMessageId}`);
          if (msgEl && msgEl.classList.contains('streaming')) {
            this.log(`[DIAG] result(1): removing .streaming class from ${this.streamingMessageId}`);
            msgEl.classList.remove('streaming');
          }
        }
        // BUG FIX: Clean up ALL stale streaming classes to prevent cursor from blinking forever
        this.messagesEl?.querySelectorAll('.chat-message.streaming').forEach(el => {
          el.classList.remove('streaming');
          this.log(`[DIAG] result(1): cleaned up stale .streaming class from ${el.id}`);
        });
        this.isStreaming = false;
        this.streamingMessageId = null;
        if (data.cost_usd) {
          this.showResultBadge(data);
        }
        break;

      case 'error':
        this.hideTypingIndicator();
        this.hideProgressMessage();
        // BUG FIX: Reset streaming state on error to allow new messages
        this.isStreaming = false;
        this.streamingMessageId = null;
        this.messagesEl?.querySelectorAll('.chat-message.streaming').forEach(el => {
          el.classList.remove('streaming');
        });
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
        // Mark initial history loading phase
        // Backend will push history messages after ready, before history_end
        if (data.history_count > 0) {
          this.isLoadingHistory = true;
          this.pendingHistoryMessages = [];
          this.log(`Initial history loading started, expecting ${data.history_count} messages`);
        }
        break;

      case 'system':
        // Received Claude's real session ID, update to SessionManager
        // Use chatClaudeSessionId to store Chat mode's session ID (separate from Terminal)
        if (data.data && data.data.session_id) {
          const chatClaudeSessionId = data.data.session_id;
          this.log(`Received Chat Claude session ID: ${chatClaudeSessionId.substring(0, 8)}`);
          const session = window.app?.sessionManager?.getActive();
          if (session) {
            session.chatClaudeSessionId = chatClaudeSessionId;
            this.log(`Updated session.chatClaudeSessionId`);
          }
        }
        break;

      case 'user_ack':
        // User message already shown in sendMessage, here only for confirmation
        // Don't add message again
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
          // Realtime user message deduplication
          if (this.isDuplicateMessage('user', data.content, data.timestamp)) {
            this.log('Skipping duplicate user message');
            return;
          }
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
          // Include tool_calls from extra if present
          const extraData = { timestamp: data.timestamp };
          if (data.extra && data.extra.tool_calls) {
            extraData.tool_calls = data.extra.tool_calls;
          }
          this.pendingHistoryMessages.push({
            type: 'assistant',
            content: data.content,
            extra: extraData
          });
        } else if (this.isStreaming) {
          this.finalizeStreaming(data.content);
        } else {
          // Assistant message deduplication
          if (this.isDuplicateMessage('assistant', data.content, data.timestamp)) {
            this.log('Skipping duplicate assistant message');
            return;
          }
          // If message has tool_calls from history, render them first
          if (data.extra && data.extra.tool_calls && Array.isArray(data.extra.tool_calls)) {
            for (const toolCall of data.extra.tool_calls) {
              const toolEl = this.createToolMessageElement(toolCall.name, toolCall.input, data.timestamp);
              this.messagesEl.appendChild(toolEl);
            }
          }
          // Render text content if present
          if (data.content && data.content.trim()) {
            this.addMessage('assistant', data.content, { timestamp: data.timestamp });
          }
        }
        break;

      case 'tool_call':
        this.log(`[DIAG] handleMessage tool_call: tool_name=${data.tool_name}`);
        this.hideTypingIndicator();
        this.addToolMessage('call', data.tool_name, data.input, data.timestamp);
        break;

      case 'tool_result':
        this.log(`[DIAG] handleMessage tool_result: tool_id=${data.tool_id}`);
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
        this.log(`[DIAG] result(2): isStreaming was ${this.isStreaming}, streamingMessageId=${this.streamingMessageId}`);
        this.hideTypingIndicator();
        this.hideProgressMessage();
        // Ensure remove .streaming class (even if assistant message not properly handled)
        if (this.streamingMessageId) {
          const msgEl = this.messagesEl?.querySelector(`#${this.streamingMessageId}`);
          if (msgEl && msgEl.classList.contains('streaming')) {
            this.log(`[DIAG] result(2): removing .streaming class from ${this.streamingMessageId}`);
            msgEl.classList.remove('streaming');
          }
        }
        // BUG FIX: Clean up ALL stale streaming classes to prevent cursor from blinking forever
        this.messagesEl?.querySelectorAll('.chat-message.streaming').forEach(el => {
          el.classList.remove('streaming');
          this.log(`[DIAG] result(2): cleaned up stale .streaming class from ${el.id}`);
        });
        this.isStreaming = false;
        this.streamingMessageId = null;
        // BUG FIX: Update send button state, avoid being disabled after receiving complete
        if (this.sendBtn && this.inputEl) {
          this.sendBtn.disabled = !this.inputEl.value.trim() || !this.isConnected;
          this.log(`[DIAG] result(2): updated sendBtn.disabled=${this.sendBtn.disabled}, inputValue="${this.inputEl.value.substring(0, 10)}", isConnected=${this.isConnected}`);
        }
        if (data.cost_usd) {
          this.showResultBadge(data);
        }
        break;

      case 'error':
        this.hideTypingIndicator();
        this.hideProgressMessage();
        // BUG FIX: Reset streaming state on error to allow new messages
        this.isStreaming = false;
        this.streamingMessageId = null;
        this.messagesEl?.querySelectorAll('.chat-message.streaming').forEach(el => {
          el.classList.remove('streaming');
        });
        this.addMessage('system', `Error: ${data.message}`);
        // Update send button state to allow retrying
        if (this.sendBtn && this.inputEl) {
          this.sendBtn.disabled = !this.inputEl.value.trim() || !this.isConnected;
        }
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
        this.log(`History loaded: ${data.count}/${data.total} messages, oldest_index=${this.historyOldestIndex}, hasMore=${this.hasMoreHistory}, pendingMessages=${this.pendingHistoryMessages?.length || 0}`);

        // Render collected initial history messages
        if (this.pendingHistoryMessages && this.pendingHistoryMessages.length > 0) {
          // Hide empty state
          if (this.emptyEl) {
            this.emptyEl.style.display = 'none';
          }

          for (const msg of this.pendingHistoryMessages) {
            // If message has tool_calls, render them first
            if (msg.extra && msg.extra.tool_calls && Array.isArray(msg.extra.tool_calls)) {
              for (const toolCall of msg.extra.tool_calls) {
                const toolEl = this.createToolMessageElement(toolCall.name, toolCall.input, msg.extra.timestamp);
                this.messagesEl.appendChild(toolEl);
              }
            }
            // Render the text content (if any)
            if (msg.content && msg.content.trim()) {
              const msgEl = this.createMessageElement(msg.type, msg.content, msg.extra);
              this.messagesEl.appendChild(msgEl);
            }
          }
          this.pendingHistoryMessages = [];
        }

        this.isLoadingHistory = false;
        // Scroll to bottom after initial history
        this.scrollToBottom();
        break;

      case 'history_page_end':
        // Additional history page loaded - insert all collected messages
        this.log(`History page loaded: ${data.count} messages, oldest_index=${data.oldest_index}, hasMore=${data.has_more}`);

        // BUG-014 FIX: Validate that this history page is for the current session
        // If we switched sessions while loading, ignore the stale history
        if (this.historyLoadingForSession && this.historyLoadingForSession !== this.sessionId) {
          this.log(`BUG-014 FIX: Ignoring history_page_end for ${this.historyLoadingForSession?.substring(0, 8)}, current session is ${this.sessionId?.substring(0, 8)}`);
          // Clean up stale state
          this.isLoadingHistory = false;
          this.pendingHistoryMessages = [];
          this.historyLoadingForSession = null;
          // Remove loading indicator if present
          const staleLoadingEl = this.messagesEl.querySelector('#historyLoadingIndicator');
          if (staleLoadingEl) staleLoadingEl.remove();
          break;
        }

        // Remove loading indicator
        const loadingEl = this.messagesEl.querySelector('#historyLoadingIndicator');
        if (loadingEl) {
          loadingEl.remove();
        }

        // Insert collected messages at the top (in correct order)
        if (this.pendingHistoryMessages.length > 0) {
          // Sync with this.messages data structure (prepend to history)
          // pendingHistoryMessages are ordered [older -> newer]
          // this.messages are ordered [older -> newer]
          // So we unshift them in reverse order or spread
          this.messages.unshift(...this.pendingHistoryMessages);

          // Preserve scroll position
          const scrollHeightBefore = this.messagesEl.scrollHeight;
          const scrollTopBefore = this.messagesEl.scrollTop;

          // Create document fragment for batch insert
          const fragment = document.createDocumentFragment();
          for (const msg of this.pendingHistoryMessages) {
            // If message has tool_calls, render them first (before the text content)
            if (msg.extra && msg.extra.tool_calls && Array.isArray(msg.extra.tool_calls)) {
              for (const toolCall of msg.extra.tool_calls) {
                // Reuse createToolMessageElement (same as addToolMessage but returns element)
                const toolEl = this.createToolMessageElement(toolCall.name, toolCall.input, msg.extra.timestamp);
                fragment.appendChild(toolEl);
              }
            }
            // Render the text content (if any)
            if (msg.content && msg.content.trim()) {
              const msgEl = this.createMessageElement(msg.type, msg.content, msg.extra);
              fragment.appendChild(msgEl);
            }
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
        this.historyLoadingForSession = null;  // BUG-014 FIX: Clear tracking
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

      case 'progress':
        // Progress message (e.g., during /compact)
        this.showProgressMessage(data.message || 'Processing...');
        break;

      case 'system_info':
        // System info for unknown message types (forwarded from backend)
        this.log(`System info: ${data.original_type}`);
        // Optionally display to user if relevant
        if (data.original_type === 'compact') {
          this.showProgressMessage('Compacting conversation...');
        }
        break;
    }
  }
});
