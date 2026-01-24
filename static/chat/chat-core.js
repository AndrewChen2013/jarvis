/**
 * Copyright (c) 2025 BillChen
 *
 * Chat Mode - Core module
 * Creates the ChatMode object with state and helper functions
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
  historyLoadingForSession: null, // BUG-014 FIX: Track which session is loading history

  // Auto-scroll state
  autoScrollEnabled: true,  // Whether to auto-scroll on new content
  scrollThreshold: 100,     // Distance from bottom to consider "at bottom"

  // DOM elements
  container: null,
  messagesEl: null,
  inputEl: null,
  sendBtn: null,
  initialized: false,

  // BUG-F3 FIX: Store document click handler for cleanup
  _documentClickHandler: null,

  // BUG-F4 FIX: Counter for unique message IDs
  _messageCounter: 0,

  // Thinking state
  thinkingMessageId: null,
  isThinking: false,

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
    const session = window.app?.sessionManager?.getActive();
    return session?.chatMessages || this.messages;
  },

  /**
   * Save message to current session
   */
  saveMessageToSession(msg) {
    // this.messages is a reference to session.chatMessages, so just push
    // If they're not the same reference (e.g., initialization failed), try to sync
    const session = window.app?.sessionManager?.getActive();
    if (session && session.chatMessages !== this.messages) {
      session.chatMessages.push(msg);
    }
    this.messages.push(msg);
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
