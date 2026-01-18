/**
 * Copyright (c) 2025 BillChen
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * ChatSession - Independent chat session instance
 * Each session has its own state, DOM, and message handling
 */
class ChatSession {
  constructor(sessionId, workingDir, container) {
    // Identity
    this.sessionId = sessionId;
    this.workingDir = workingDir;

    // Connection state
    this.isConnected = false;
    this.isStreaming = false;
    this.streamingMessageId = null;

    // Messages
    this.messages = [];
    this._messageCounter = 0;

    // History pagination
    this.historyOldestIndex = -1;
    this.hasMoreHistory = false;
    this.isLoadingHistory = false;
    this.pendingHistoryMessages = [];

    // Thinking state
    this.thinkingMessageId = null;
    this.isThinking = false;

    // Auto-scroll
    this.autoScrollEnabled = true;
    this.scrollThreshold = 100;

    // DOM references (will be set in render())
    this.container = container;
    this.messagesEl = null;
    this.inputEl = null;
    this.sendBtn = null;
    this.statusEl = null;
    this.emptyEl = null;

    // Event handlers (for cleanup)
    this._documentClickHandler = null;
  }

  /**
   * Debug logging
   */
  log(msg) {
    if (window.app?.debugLog) {
      window.app.debugLog(`[Chat:${this.sessionId?.substring(0, 8)}] ${msg}`);
    }
  }

  /**
   * Generate unique message ID
   */
  _generateMessageId() {
    return `msg-${++this._messageCounter}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Export for use
window.ChatSession = ChatSession;
