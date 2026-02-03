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

    // 处理之前积压的消息队列
    if (session.chatMessageQueue && session.chatMessageQueue.length > 0) {
      this.log(`Flushing ${session.chatMessageQueue.length} queued messages for ${sessionId?.substring(0, 8)}`);
      session.flushChatMessageQueue((type, data) => {
        this.handleMuxMessageForSession(type, data, session, sessionId);
      });
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
    const startTime = performance.now();
    this.log(`[TIMING] connectMux START: session=${sessionId?.substring(0, 8)}, workingDir=${workingDir}`);
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
    this.log(`[TIMING] connectMux calling muxWs.connectChat at +${(performance.now() - startTime).toFixed(1)}ms`);
    window.muxWs.connectChat(sessionId, workingDir, {
      resume: claudeSessionId,
      onConnect: (data) => {
        this.log(`[TIMING] onConnect callback received at +${(performance.now() - startTime).toFixed(1)}ms`);
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
    const message = { type, ...data };
    this.handleMessage(message);
  },

  /**
   * Handle message for a specific session
   * 使用 ChatMessageHandler 处理消息，不再需要临时交换状态
   */
  handleMuxMessageForSession(type, data, targetSession, targetSessionId) {
    // 检查 container 是否准备好
    if (!targetSession.isChatReady()) {
      targetSession.queueChatMessage(type, data);
      this.log(`Message queued for ${targetSessionId?.substring(0, 8)}: type=${type}`);
      return;
    }

    const container = targetSession.chatContainer;
    const messagesEl = container.querySelector('#chatMessages') || container.querySelector('.chat-messages');
    const emptyEl = container.querySelector('#chatEmpty') || container.querySelector('.chat-empty');

    // BUG FIX: Check active session by multiple methods
    // - this.sessionId might be updated (renamed), but targetSessionId is captured old value
    // - Also check targetSession.id which is always current
    // - Also check chatConnectionId which stores the original connection ID
    const isActiveSession = this.sessionId === targetSessionId ||
                           this.sessionId === targetSession.id ||
                           this.sessionId === targetSession.chatConnectionId;

    const ctx = { session: targetSession, messagesEl, emptyEl, isActiveSession };
    ChatMessageHandler.handle(ctx, type, data);

    if (isActiveSession) {
      this._syncGlobalStateFromSession(targetSession);
    }
  },

  /**
   * 同步 session 状态到全局变量（向后兼容）
   */
  _syncGlobalStateFromSession(session) {
    this.messages = session.chatMessages;
    this.isStreaming = session.chatIsStreaming;
    this.streamingMessageId = session.chatStreamingMessageId;
    this.historyOldestIndex = session.chatHistoryOldestIndex;
    this.hasMoreHistory = session.chatHasMoreHistory;
    this.isLoadingHistory = session.chatIsLoadingHistory;
    this.autoScrollEnabled = session.chatAutoScrollEnabled;
    this.isThinking = session.chatIsThinking;
    this.thinkingMessageId = session.chatThinkingMessageId;
  },

  /**
   * Handle incoming message for current active session
   */
  handleMessage(data) {
    const session = this.getSession();
    if (!session) {
      this.log('handleMessage: no active session');
      return;
    }

    const ctx = {
      session,
      messagesEl: this.messagesEl,
      emptyEl: this.emptyEl,
      isActiveSession: true
    };

    ChatMessageHandler.handle(ctx, data.type, data);
    this._syncGlobalStateFromSession(session);
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
