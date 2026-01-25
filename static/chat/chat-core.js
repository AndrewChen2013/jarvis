/**
 * Copyright (c) 2025 BillChen
 *
 * Chat Mode - Core module
 * Creates the ChatMode object with state and helper functions
 *
 * REFACTORED: Session-level state is now stored in SessionInstance
 * ChatMode only keeps truly global state and provides helper methods
 */

const ChatMode = {
  // === TRULY GLOBAL STATE ===
  // Current active session reference (for determining operation target)
  sessionId: null,
  workingDir: null,

  // Connection status (for current session)
  isConnected: false,

  // DOM elements (updated when switching sessions)
  container: null,
  messagesEl: null,
  inputEl: null,
  sendBtn: null,
  initialized: false,

  // Global config
  scrollThreshold: 100,     // Distance from bottom to consider "at bottom"

  // BUG-F3 FIX: Store document click handler for cleanup
  _documentClickHandler: null,

  // BUG-F4 FIX: Counter for unique message IDs (global counter is OK)
  _messageCounter: 0,

  // === DEPRECATED: These are now in SessionInstance ===
  // Kept for backward compatibility during transition
  messages: [],              // Use getSession().chatMessages instead
  isStreaming: false,        // Use getSession().chatIsStreaming instead
  streamingMessageId: null,  // Use getSession().chatStreamingMessageId instead
  historyOldestIndex: -1,    // Use getSession().chatHistoryOldestIndex instead
  hasMoreHistory: false,     // Use getSession().chatHasMoreHistory instead
  isLoadingHistory: false,   // Use getSession().chatIsLoadingHistory instead
  pendingHistoryMessages: [], // Use getSession().chatPendingHistoryMessages instead
  historyLoadingForSession: null, // No longer needed with session-level state
  autoScrollEnabled: true,   // Use getSession().chatAutoScrollEnabled instead
  thinkingMessageId: null,   // Use getSession().chatThinkingMessageId instead
  isThinking: false,         // Use getSession().chatIsThinking instead

  // === HELPER METHODS ===

  /**
   * Get the current session object
   * @returns {SessionInstance|null}
   */
  getSession() {
    return window.app?.sessionManager?.sessions?.get(this.sessionId);
  },

  /**
   * Get a specific session by ID
   * @param {string} sessionId
   * @returns {SessionInstance|null}
   */
  getSessionById(sessionId) {
    return window.app?.sessionManager?.sessions?.get(sessionId);
  },

  /**
   * Get the messages container element for current session
   * @returns {HTMLElement|null}
   */
  getMessagesEl() {
    const session = this.getSession();
    return session?.chatContainer?.querySelector('.chat-messages') || this.messagesEl;
  },

  /**
   * Get the messages container for a specific session
   * @param {string} sessionId
   * @returns {HTMLElement|null}
   */
  getMessagesElForSession(sessionId) {
    const session = this.getSessionById(sessionId);
    return session?.chatContainer?.querySelector('.chat-messages');
  },

  /**
   * Sync ChatMode state from session (called when switching sessions)
   * This maintains backward compatibility with code that reads ChatMode directly
   */
  syncFromSession() {
    const session = this.getSession();
    if (!session) return;

    this.messages = session.chatMessages;
    this.isStreaming = session.chatIsStreaming;
    this.streamingMessageId = session.chatStreamingMessageId;
    this.historyOldestIndex = session.chatHistoryOldestIndex;
    this.hasMoreHistory = session.chatHasMoreHistory;
    this.isLoadingHistory = session.chatIsLoadingHistory;
    this.pendingHistoryMessages = session.chatPendingHistoryMessages;
    this.autoScrollEnabled = session.chatAutoScrollEnabled;
    this.thinkingMessageId = session.chatThinkingMessageId;
    this.isThinking = session.chatIsThinking;

    // Update DOM references
    if (session.chatContainer) {
      this.messagesEl = session.chatContainer.querySelector('.chat-messages');
      this.inputEl = session.chatContainer.querySelector('.chat-input');
      this.sendBtn = session.chatContainer.querySelector('.chat-send-btn');
    }
  },

  /**
   * Sync ChatMode state to session (called before switching away)
   * Ensures session object has latest state
   */
  syncToSession() {
    const session = this.getSession();
    if (!session) return;

    session.chatMessages = this.messages;
    session.chatIsStreaming = this.isStreaming;
    session.chatStreamingMessageId = this.streamingMessageId;
    session.chatHistoryOldestIndex = this.historyOldestIndex;
    session.chatHasMoreHistory = this.hasMoreHistory;
    session.chatIsLoadingHistory = this.isLoadingHistory;
    session.chatPendingHistoryMessages = this.pendingHistoryMessages;
    session.chatAutoScrollEnabled = this.autoScrollEnabled;
    session.chatThinkingMessageId = this.thinkingMessageId;
    session.chatIsThinking = this.isThinking;
  },

  /**
   * Generate unique message ID
   * Uses counter + timestamp + random to guarantee uniqueness
   */
  _generateMessageId() {
    return 'msg-' + (++this._messageCounter) + '-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  },

  /**
   * Debug log helper - uses app's debugLog
   */
  log(msg) {
    if (window.app?.debugLog) {
      window.app.debugLog('[Chat] ' + msg);
    }
  },

  /**
   * Get messages array for current session
   */
  getSessionMessages() {
    const session = this.getSession();
    return session?.chatMessages || this.messages;
  },

  /**
   * Save message to current session
   */
  saveMessageToSession(msg) {
    // Use this.sessionId to find the correct session, not getActive()
    // getActive() returns the currently visible session, which may have changed
    // if user switched sessions after sending a message
    const session = this.getSessionById(this.sessionId);
    if (session && session.chatMessages) {
      session.chatMessages.push(msg);
      // Keep local reference in sync
      if (this.messages !== session.chatMessages) {
        this.messages = session.chatMessages;
      }
    } else {
      this.messages.push(msg);
    }
  },

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// Export
window.ChatMode = ChatMode;
