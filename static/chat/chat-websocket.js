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

      // CRITICAL FIX: Sync DOM with chatMessages array
      // DOM and array can get out of sync when messages arrive while viewing another session
      this._syncDomWithMessages();

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
        // BUG-018 FIX: Detect reconnect and set history loading state for non-active session
        const existingMsgCountReady = this.messagesEl?.querySelectorAll('.chat-message').length || 0;
        const isReconnectReady = existingMsgCountReady > 0;

        if (data.history_count > 0) {
          targetSession.chatIsLoadingHistory = true;
          targetSession.chatPendingHistoryMessages = [];
          targetSession.chatIsReconnect = isReconnectReady;

          if (isReconnectReady) {
            this.log(`BUG-018 FIX: Reconnect detected for non-active session ${targetSession.id?.substring(0, 8)}, will skip history`);
          } else {
            this.log(`Initial history loading for non-active session ${targetSession.id?.substring(0, 8)}, expecting ${data.history_count} messages`);
          }
        }
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
        // BUG-018 FIX: Check if in history loading phase
        if (targetSession.chatIsLoadingHistory) {
          targetSession.chatPendingHistoryMessages.push({
            type: 'user',
            content: data.content,
            extra: { timestamp: data.timestamp }
          });
          return;
        }
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
        // BUG-018 FIX: Check if in history loading phase
        if (targetSession.chatIsLoadingHistory) {
          const extraData = { timestamp: data.timestamp };
          if (data.extra && data.extra.tool_calls) {
            extraData.tool_calls = data.extra.tool_calls;
          }
          targetSession.chatPendingHistoryMessages.push({
            type: 'assistant',
            content: data.content,
            extra: extraData
          });
          return;
        }
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

      case 'history_end':
        // BUG-018 FIX: Handle history_end for non-active session
        targetSession.chatHistoryOldestIndex = data.total - data.count;
        targetSession.chatHasMoreHistory = targetSession.chatHistoryOldestIndex > 0;

        this.log(`History loaded for non-active session: ${data.count}/${data.total} messages, isReconnect=${targetSession.chatIsReconnect}`);

        // If reconnect, skip rendering
        if (targetSession.chatIsReconnect) {
          this.log(`BUG-018 FIX: Skipping history render on reconnect for non-active session ${targetSession.id?.substring(0, 8)}`);
          targetSession.chatIsLoadingHistory = false;
          targetSession.chatPendingHistoryMessages = [];
          targetSession.chatIsReconnect = false;
          break;
        }

        // Render history messages
        const pendingMsgsNonActive = targetSession.chatPendingHistoryMessages || [];
        if (pendingMsgsNonActive.length > 0) {
          if (this.emptyEl) this.emptyEl.style.display = 'none';
          for (const msg of pendingMsgsNonActive) {
            if (msg.extra?.tool_calls) {
              for (const tc of msg.extra.tool_calls) {
                const toolEl = this.createToolMessageElement(tc.name, tc.input, msg.extra.timestamp);
                this.messagesEl.appendChild(toolEl);
              }
            }
            if (msg.content?.trim()) {
              const msgEl = this.createMessageElement(msg.type, msg.content, msg.extra);
              this.messagesEl.appendChild(msgEl);
            }
          }
          targetSession.chatPendingHistoryMessages = [];
        }

        targetSession.chatIsLoadingHistory = false;
        targetSession.chatIsReconnect = false;
        this.scrollToBottom();
        break;

      case 'history_page_end':
        // BUG-018 FIX: Handle history_page_end for non-active session (simplified)
        targetSession.chatHistoryOldestIndex = data.oldest_index;
        targetSession.chatHasMoreHistory = data.has_more;
        targetSession.chatIsLoadingHistory = false;
        this.log(`History page loaded for non-active session: oldest_index=${data.oldest_index}, hasMore=${data.has_more}`);
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

        // BUG-018 FIX: Check if this is a reconnect (DOM already has messages)
        // If so, skip history loading to avoid duplicate messages
        const existingMsgCount = this.messagesEl?.querySelectorAll('.chat-message').length || 0;
        const isReconnect = existingMsgCount > 0;

        // Mark initial history loading phase
        // Backend will push history messages after ready, before history_end
        if (data.history_count > 0) {
          // REFACTOR: Use session-level state instead of global
          const session = this.getSession();
          if (session) {
            session.chatIsLoadingHistory = true;
            session.chatPendingHistoryMessages = [];
            // BUG-018 FIX: Mark as reconnect so history_end knows to skip rendering
            session.chatIsReconnect = isReconnect;
          }
          // Keep backward compatible global state (will be removed later)
          this.isLoadingHistory = true;
          this.pendingHistoryMessages = [];
          this.historyLoadingForSession = this.sessionId;  // Track which session is loading history
          this.isReconnect = isReconnect;  // BUG-018 FIX: Track reconnect state
          if (isReconnect) {
            this.log(`BUG-018 FIX: Reconnect detected (${existingMsgCount} messages in DOM), will skip history rendering`);
          } else {
            this.log(`Initial history loading started, expecting ${data.history_count} messages for session ${this.sessionId?.substring(0, 8)}`);
          }
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
        // REFACTOR: Check session-level state first, fallback to global
        const sessionForUser = this.getSession();
        const isLoadingHistoryUser = sessionForUser?.chatIsLoadingHistory ?? this.isLoadingHistory;
        if (isLoadingHistoryUser) {
          // Collect for batch insert at top - use session-level array
          const pendingArray = sessionForUser?.chatPendingHistoryMessages ?? this.pendingHistoryMessages;
          pendingArray.push({
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
        // REFACTOR: Check session-level state first, fallback to global
        const sessionForAssistant = this.getSession();
        const isLoadingHistoryAssistant = sessionForAssistant?.chatIsLoadingHistory ?? this.isLoadingHistory;
        if (isLoadingHistoryAssistant) {
          // Collect for batch insert at top
          // Include tool_calls from extra if present
          const extraData = { timestamp: data.timestamp };
          if (data.extra && data.extra.tool_calls) {
            extraData.tool_calls = data.extra.tool_calls;
          }
          // Use session-level array
          const pendingArray = sessionForAssistant?.chatPendingHistoryMessages ?? this.pendingHistoryMessages;
          pendingArray.push({
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
        // REFACTOR: Use session-level state
        const sessionForHistoryEnd = this.getSession();

        // BUG-018 FIX: Check if this is a reconnect - skip rendering if so
        const isReconnectHistoryEnd = sessionForHistoryEnd?.chatIsReconnect ?? this.isReconnect;

        // Update session-level state
        if (sessionForHistoryEnd) {
          sessionForHistoryEnd.chatHistoryOldestIndex = data.total - data.count;
          sessionForHistoryEnd.chatHasMoreHistory = sessionForHistoryEnd.chatHistoryOldestIndex > 0;
        }
        // Keep backward compatible global state
        this.historyOldestIndex = data.total - data.count;
        this.hasMoreHistory = this.historyOldestIndex > 0;

        const pendingMsgs = sessionForHistoryEnd?.chatPendingHistoryMessages ?? this.pendingHistoryMessages;
        this.log(`History loaded: ${data.count}/${data.total} messages, oldest_index=${this.historyOldestIndex}, hasMore=${this.hasMoreHistory}, pendingMessages=${pendingMsgs?.length || 0}, isReconnect=${isReconnectHistoryEnd}`);

        // BUG FIX: Validate that this history is for the current session
        // If user switched sessions while loading, ignore the stale history
        if (this.historyLoadingForSession && this.historyLoadingForSession !== this.sessionId) {
          this.log(`BUG FIX: Ignoring history_end for ${this.historyLoadingForSession?.substring(0, 8)}, current session is ${this.sessionId?.substring(0, 8)}`);
          // Clear both session-level and global state
          if (sessionForHistoryEnd) {
            sessionForHistoryEnd.chatIsLoadingHistory = false;
            sessionForHistoryEnd.chatPendingHistoryMessages = [];
            sessionForHistoryEnd.chatIsReconnect = false;
          }
          this.isLoadingHistory = false;
          this.pendingHistoryMessages = [];
          this.historyLoadingForSession = null;
          this.isReconnect = false;
          break;
        }

        // BUG-018 FIX: Skip rendering on reconnect - messages already in DOM
        if (isReconnectHistoryEnd) {
          this.log(`BUG-018 FIX: Skipping history render on reconnect`);
          // Clear state without rendering
          if (sessionForHistoryEnd) {
            sessionForHistoryEnd.chatIsLoadingHistory = false;
            sessionForHistoryEnd.chatPendingHistoryMessages = [];
            sessionForHistoryEnd.chatIsReconnect = false;
          }
          this.isLoadingHistory = false;
          this.pendingHistoryMessages = [];
          this.historyLoadingForSession = null;
          this.isReconnect = false;
          break;
        }

        // Render collected initial history messages
        // REFACTOR: Use session-level pending array
        if (pendingMsgs && pendingMsgs.length > 0) {
          // Hide empty state
          if (this.emptyEl) {
            this.emptyEl.style.display = 'none';
          }

          for (const msg of pendingMsgs) {
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
          // Clear both session-level and global pending arrays
          if (sessionForHistoryEnd) {
            sessionForHistoryEnd.chatPendingHistoryMessages = [];
          }
          this.pendingHistoryMessages = [];
        }

        // Clear loading state - both session-level and global
        if (sessionForHistoryEnd) {
          sessionForHistoryEnd.chatIsLoadingHistory = false;
          sessionForHistoryEnd.chatIsReconnect = false;  // BUG-018 FIX
        }
        this.isLoadingHistory = false;
        this.historyLoadingForSession = null;  // Clear tracking
        this.isReconnect = false;  // BUG-018 FIX
        // Scroll to bottom after initial history
        this.scrollToBottom();
        break;

      case 'history_page_end':
        // Additional history page loaded - insert all collected messages
        // REFACTOR: Use session-level state
        const sessionForPageEnd = this.getSession();
        const pendingPageMsgs = sessionForPageEnd?.chatPendingHistoryMessages ?? this.pendingHistoryMessages;
        this.log(`History page loaded: ${data.count} messages, oldest_index=${data.oldest_index}, hasMore=${data.has_more}`);

        // BUG-014 FIX: Validate that this history page is for the current session
        // If we switched sessions while loading, ignore the stale history
        if (this.historyLoadingForSession && this.historyLoadingForSession !== this.sessionId) {
          this.log(`BUG-014 FIX: Ignoring history_page_end for ${this.historyLoadingForSession?.substring(0, 8)}, current session is ${this.sessionId?.substring(0, 8)}`);
          // Clean up stale state - both session-level and global
          if (sessionForPageEnd) {
            sessionForPageEnd.chatIsLoadingHistory = false;
            sessionForPageEnd.chatPendingHistoryMessages = [];
          }
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
        if (pendingPageMsgs && pendingPageMsgs.length > 0) {
          // Sync with this.messages data structure (prepend to history)
          // pendingHistoryMessages are ordered [older -> newer]
          // this.messages are ordered [older -> newer]
          // So we unshift them in reverse order or spread
          this.messages.unshift(...pendingPageMsgs);

          // Preserve scroll position
          const scrollHeightBefore = this.messagesEl.scrollHeight;
          const scrollTopBefore = this.messagesEl.scrollTop;

          // Create document fragment for batch insert
          const fragment = document.createDocumentFragment();
          for (const msg of pendingPageMsgs) {
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

          // Clear both session-level and global pending arrays
          if (sessionForPageEnd) {
            sessionForPageEnd.chatPendingHistoryMessages = [];
          }
          this.pendingHistoryMessages = [];
        }

        // Update state - both session-level and global
        if (sessionForPageEnd) {
          sessionForPageEnd.chatIsLoadingHistory = false;
          sessionForPageEnd.chatHistoryOldestIndex = data.oldest_index;
          sessionForPageEnd.chatHasMoreHistory = data.has_more;
        }
        this.isLoadingHistory = false;
        this.historyLoadingForSession = null;  // BUG-014 FIX: Clear tracking
        this.historyOldestIndex = data.oldest_index;
        this.hasMoreHistory = data.has_more;

        // Show "no more history" message if at the beginning
        const hasMore = sessionForPageEnd?.chatHasMoreHistory ?? this.hasMoreHistory;
        if (!hasMore) {
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
  },

  /**
   * CRITICAL FIX: Sync DOM with messages array
   * When switching sessions, DOM might be out of sync with chatMessages array
   * (e.g., messages arrived while viewing another session)
   *
   * Strategy: DOM is truth for existing messages, array may have newer messages at end.
   * We only append missing messages, never remove or reorder.
   */
  _syncDomWithMessages() {
    if (!this.messagesEl || !this.messages) return;

    // Count non-UI DOM children (skip loading indicators, history markers, etc.)
    const domMessages = this.messagesEl.querySelectorAll('.chat-message');
    const domCount = domMessages.length;
    const arrayCount = this.messages.length;

    if (domCount >= arrayCount) {
      // DOM has all messages (or more), no sync needed
      return;
    }

    // Append missing messages from array
    this.log(`_syncDomWithMessages: DOM has ${domCount}, array has ${arrayCount}, appending ${arrayCount - domCount} messages`);

    const fragment = document.createDocumentFragment();
    for (let i = domCount; i < arrayCount; i++) {
      const msg = this.messages[i];
      const msgEl = this.createMessageElement(msg.type, msg.content, msg);
      fragment.appendChild(msgEl);
    }
    this.messagesEl.appendChild(fragment);

    // Hide empty state if we added messages
    if (this.emptyEl && arrayCount > 0) {
      this.emptyEl.style.display = 'none';
    }
  }
});
