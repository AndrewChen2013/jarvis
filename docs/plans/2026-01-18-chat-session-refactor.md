# ChatSession Multi-Instance Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor ChatMode from a global singleton to per-session ChatSession instances, eliminating context-switching bugs in multi-session scenarios.

**Architecture:** Replace the single `ChatMode` object with a `ChatSession` class. Each session in `SessionManager` gets its own `ChatSession` instance that owns its state (messages, streaming, DOM references). A lightweight `ChatManager` coordinates session lifecycle and provides backward-compatible API.

**Tech Stack:** Vanilla JavaScript (ES6 classes), existing MuxWebSocket infrastructure

---

## Current Architecture (Problem)

```
┌─────────────────────────────────────────────────────────────┐
│                    ChatMode (Singleton)                      │
│                                                              │
│  State (shared across ALL sessions):                         │
│  - sessionId, workingDir                                     │
│  - messages[], isStreaming, streamingMessageId               │
│  - container, messagesEl, inputEl, sendBtn                   │
│  - historyOldestIndex, hasMoreHistory, isLoadingHistory      │
│  - autoScrollEnabled, thinkingMessageId, isThinking          │
│                                                              │
│  Problem: When processing messages for non-active session,   │
│  must save/restore 6+ variables - error prone!               │
└─────────────────────────────────────────────────────────────┘
```

## New Architecture (Solution)

```
┌─────────────────────────────────────────────────────────────┐
│                    ChatManager (Coordinator)                 │
│  - sessions: Map<sessionId, ChatSession>                     │
│  - activeSessionId: string                                   │
│  - getSession(id), getActive(), switchTo(id)                │
│  - Backward-compatible: ChatMode.connect() → ChatManager    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    ChatSession (Per-Instance)                │
│                                                              │
│  Own State (isolated):                                       │
│  - sessionId, workingDir                                     │
│  - messages[], isStreaming, streamingMessageId               │
│  - container, messagesEl, inputEl, sendBtn                   │
│  - historyOldestIndex, hasMoreHistory, isLoadingHistory      │
│  - autoScrollEnabled, thinkingMessageId, isThinking          │
│                                                              │
│  Methods:                                                    │
│  - connect(), disconnect()                                   │
│  - handleMessage(data) - direct, no context switch!          │
│  - sendMessage(), addMessage(), render()                     │
└─────────────────────────────────────────────────────────────┘
```

## Benefits

1. **No context switching** - Each session processes its own messages directly
2. **No state pollution** - Session A's streaming state never affects Session B
3. **Simpler code** - Remove `handleMuxMessageForSession`, `handleMessageForSession`, `handleMessageWithoutStatusUpdate`
4. **Easier debugging** - Each session is self-contained

---

## Task 1: Create ChatSession Class Skeleton

**Files:**
- Create: `static/chat-session.js`

**Step 1: Create the basic class structure**

```javascript
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
```

**Step 2: Add script to index.html**

In `static/index.html`, add before chat.js:
```html
<script src="chat-session.js"></script>
```

**Step 3: Verify file loads without errors**

Run: Open browser, check console for errors
Expected: No errors, `window.ChatSession` is defined

**Step 4: Commit**

```bash
git add static/chat-session.js static/index.html
git commit -m "feat: add ChatSession class skeleton"
```

---

## Task 2: Add render() Method to ChatSession

**Files:**
- Modify: `static/chat-session.js`

**Step 1: Copy render template from ChatMode**

Add to ChatSession class:

```javascript
  /**
   * Render chat UI into container
   */
  render() {
    const t = (key, fallback) => window.i18n ? window.i18n.t(key, fallback) : fallback;

    this.container.innerHTML = `
      <div class="chat-container">
        <div class="chat-header">
          <div class="chat-header-left">
            <button class="chat-back-btn" id="chatBackBtn-${this.sessionId}" title="${t('common.close', 'Close')}">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
            </button>
            <button class="chat-minimize-btn" id="chatMinimizeBtn-${this.sessionId}" title="${t('terminal.minimize', 'Minimize')}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </button>
            <span class="chat-title" id="chatTitle-${this.sessionId}" style="cursor: pointer;" title="${t('debug.title', 'Debug Log')}">${t('chat.title', 'Chat')}</span>
          </div>
          <div class="chat-header-right">
            <button class="chat-terminal-btn" id="chatTerminalBtn-${this.sessionId}" title="${t('chat.mode.terminal', 'Terminal')}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="4 17 10 11 4 5"></polyline>
                <line x1="12" y1="19" x2="20" y2="19"></line>
              </svg>
            </button>
          </div>
        </div>

        <div class="chat-status" id="chatStatus-${this.sessionId}">
          <span class="chat-status-dot connecting"></span>
          <span id="chatStatusText-${this.sessionId}">${t('chat.status.connecting', 'Connecting...')}</span>
        </div>

        <div class="chat-messages" id="chatMessages-${this.sessionId}">
          <div class="chat-empty" id="chatEmpty-${this.sessionId}">
            <div class="chat-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div class="chat-empty-text">${t('chat.empty', 'Start a conversation')}</div>
          </div>
        </div>

        <div class="chat-slash-commands" id="chatSlashCommands-${this.sessionId}">
          <button class="slash-cmd-btn" data-cmd="/context">/context</button>
          <button class="slash-cmd-btn" data-cmd="/compact">/compact</button>
          <button class="slash-cmd-btn" data-cmd="/cost">/cost</button>
          <button class="slash-cmd-btn slash-cmd-more" id="chatMoreCmds-${this.sessionId}">···</button>
          <div class="chat-more-commands-panel" id="chatMoreCmdsPanel-${this.sessionId}">
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
              id="chatInput-${this.sessionId}"
              placeholder="${t('chat.input.placeholder', 'Type a message...')}"
              rows="1"
            ></textarea>
          </div>
          <button class="chat-send-btn" id="chatSendBtn-${this.sessionId}" disabled>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
            </svg>
          </button>
        </div>
      </div>
    `;

    // Cache DOM references using session-specific IDs
    this.messagesEl = this.container.querySelector(`#chatMessages-${this.sessionId}`);
    this.inputEl = this.container.querySelector(`#chatInput-${this.sessionId}`);
    this.sendBtn = this.container.querySelector(`#chatSendBtn-${this.sessionId}`);
    this.statusEl = this.container.querySelector(`#chatStatus-${this.sessionId}`);
    this.statusTextEl = this.container.querySelector(`#chatStatusText-${this.sessionId}`);
    this.statusDot = this.statusEl?.querySelector('.chat-status-dot');
    this.emptyEl = this.container.querySelector(`#chatEmpty-${this.sessionId}`);
  }
```

**Step 2: Verify render works**

In browser console:
```javascript
const testContainer = document.createElement('div');
document.body.appendChild(testContainer);
const session = new ChatSession('test-123', '/tmp', testContainer);
session.render();
console.log(session.messagesEl); // Should not be null
testContainer.remove();
```

Expected: DOM elements created, messagesEl is not null

**Step 3: Commit**

```bash
git add static/chat-session.js
git commit -m "feat: add ChatSession.render() method"
```

---

## Task 3: Add bindEvents() Method to ChatSession

**Files:**
- Modify: `static/chat-session.js`

**Step 1: Add event binding**

Add to ChatSession class:

```javascript
  /**
   * Bind event listeners
   */
  bindEvents() {
    // Back button
    const backBtn = this.container.querySelector(`#chatBackBtn-${this.sessionId}`);
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this.disconnect();
        window.app?.switchView?.('projects');
      });
    }

    // Minimize button
    const minimizeBtn = this.container.querySelector(`#chatMinimizeBtn-${this.sessionId}`);
    if (minimizeBtn) {
      minimizeBtn.addEventListener('click', () => {
        this.minimize();
      });
    }

    // Terminal button
    const terminalBtn = this.container.querySelector(`#chatTerminalBtn-${this.sessionId}`);
    if (terminalBtn) {
      terminalBtn.addEventListener('click', () => {
        this.switchToTerminal();
      });
    }

    // Title click for debug
    const chatTitle = this.container.querySelector(`#chatTitle-${this.sessionId}`);
    if (chatTitle) {
      chatTitle.addEventListener('click', () => {
        window.app?.showDebugLog?.();
      });
    }

    // Input auto-resize
    this.inputEl.addEventListener('input', () => {
      this.inputEl.style.height = 'auto';
      this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 120) + 'px';
      this.sendBtn.disabled = !this.inputEl.value.trim() || !this.isConnected;
    });

    // Enter to send
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Send button
    this.sendBtn.addEventListener('click', () => {
      this.log(`sendBtn clicked, disabled=${this.sendBtn.disabled}`);
      this.sendMessage();
    });

    // Mobile keyboard handling
    this.inputEl.addEventListener('focus', () => {
      if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
        setTimeout(() => {
          this.scrollToBottom();
        }, 300);
      }
    });

    // Scroll events for history loading and auto-scroll
    this.messagesEl.addEventListener('scroll', () => {
      // Load more history when scrolled to top
      if (this.messagesEl.scrollTop < 100 && this.hasMoreHistory && !this.isLoadingHistory) {
        this.loadMoreHistory();
      }

      // Update auto-scroll state
      const distanceFromBottom = this.messagesEl.scrollHeight - this.messagesEl.scrollTop - this.messagesEl.clientHeight;
      const wasEnabled = this.autoScrollEnabled;
      this.autoScrollEnabled = distanceFromBottom < this.scrollThreshold;

      // Show/hide new messages button
      if (!this.autoScrollEnabled && this.isStreaming) {
        this.showNewMessagesButton();
      } else if (this.autoScrollEnabled) {
        this.hideNewMessagesButton();
      }
    });

    // Slash commands
    this._bindSlashCommands();
  }

  /**
   * Bind slash command buttons
   */
  _bindSlashCommands() {
    const slashCmdsEl = this.container.querySelector(`#chatSlashCommands-${this.sessionId}`);
    const moreCmdsPanel = this.container.querySelector(`#chatMoreCmdsPanel-${this.sessionId}`);
    const moreCmdsBtn = this.container.querySelector(`#chatMoreCmds-${this.sessionId}`);

    if (!slashCmdsEl) return;

    // Regular slash commands
    slashCmdsEl.querySelectorAll('.slash-cmd-btn:not(.slash-cmd-more)').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cmd = btn.dataset.cmd;
        if (cmd) {
          this.executeSlashCommand(cmd);
          if (moreCmdsPanel) moreCmdsPanel.classList.remove('show');
        }
      });
    });

    // More commands toggle
    if (moreCmdsBtn && moreCmdsPanel) {
      moreCmdsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        moreCmdsPanel.classList.toggle('show');
      });

      moreCmdsPanel.querySelectorAll('.slash-cmd-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const cmd = btn.dataset.cmd;
          if (cmd) {
            this.executeSlashCommand(cmd);
            moreCmdsPanel.classList.remove('show');
          }
        });
      });

      // Close panel on outside click
      if (this._documentClickHandler) {
        document.removeEventListener('click', this._documentClickHandler);
      }
      this._documentClickHandler = (e) => {
        if (!moreCmdsPanel.contains(e.target) && e.target !== moreCmdsBtn) {
          moreCmdsPanel.classList.remove('show');
        }
      };
      document.addEventListener('click', this._documentClickHandler);
    }
  }

  /**
   * Execute a slash command
   */
  executeSlashCommand(cmd) {
    if (!this.isConnected) {
      this.log(`Cannot execute ${cmd}: not connected`);
      return;
    }
    this.log(`Executing slash command: ${cmd}`);

    if (window.muxWs) {
      window.muxWs.chatMessage(this.sessionId, cmd);
    }
  }
```

**Step 2: Add stub methods for missing functionality**

```javascript
  // Stub methods - will be implemented in later tasks
  sendMessage() { this.log('sendMessage not yet implemented'); }
  disconnect() { this.log('disconnect not yet implemented'); }
  minimize() { window.app?.minimize?.(); }
  switchToTerminal() { window.app?.switchToTerminalMode?.(this.sessionId, this.workingDir); }
  loadMoreHistory() { this.log('loadMoreHistory not yet implemented'); }
  scrollToBottom() { if (this.messagesEl) this.messagesEl.scrollTop = this.messagesEl.scrollHeight; }
  showNewMessagesButton() { /* implement later */ }
  hideNewMessagesButton() { /* implement later */ }
```

**Step 3: Test event binding**

In browser console:
```javascript
const testContainer = document.createElement('div');
testContainer.style.cssText = 'position:fixed;top:0;left:0;width:400px;height:300px;background:#fff;z-index:9999';
document.body.appendChild(testContainer);
const session = new ChatSession('test-123', '/tmp', testContainer);
session.render();
session.bindEvents();
// Click send button, should log message
testContainer.remove();
```

**Step 4: Commit**

```bash
git add static/chat-session.js
git commit -m "feat: add ChatSession.bindEvents() method"
```

---

## Task 4: Add Message Handling Methods to ChatSession

**Files:**
- Modify: `static/chat-session.js`

**Step 1: Add handleMessage method**

```javascript
  /**
   * Handle incoming message - core routing
   */
  handleMessage(data) {
    this.log(`handleMessage: type=${data.type}`);

    switch (data.type) {
      case 'ready':
        this.isConnected = true;
        this.updateStatus('connected');
        if (data.history_count !== undefined) {
          this.hasMoreHistory = data.history_count > 0;
        }
        break;

      case 'system':
        if (data.data?.session_id) {
          this.claudeSessionId = data.data.session_id;
        }
        break;

      case 'user_ack':
        // User message acknowledged by server
        break;

      case 'user':
        if (!this.isDuplicateMessage('user', data.content, data.timestamp)) {
          this.addMessage('user', data.content, { timestamp: data.timestamp });
        }
        break;

      case 'stream':
        this.appendToStreaming(data.text);
        break;

      case 'assistant':
        this.hideTypingIndicator();
        if (this.isStreaming) {
          this.finalizeStreaming(data.content);
        } else if (!this.isDuplicateMessage('assistant', data.content, data.timestamp)) {
          this.addMessage('assistant', data.content, { timestamp: data.timestamp });
        }
        break;

      case 'tool_call':
        this.hideTypingIndicator();
        this.addToolMessage('call', data.tool_name, data.input, data.timestamp);
        break;

      case 'tool_result':
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
        this.hideTypingIndicator();
        this.hideProgressMessage();
        // Clean up all streaming classes
        this.messagesEl?.querySelectorAll('.chat-message.streaming').forEach(el => {
          el.classList.remove('streaming');
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
        this.addMessage('system', `Error: ${data.message}`);
        break;

      case 'history_end':
        this.handleHistoryEnd(data);
        break;

      case 'history_page_end':
        this.handleHistoryPageEnd(data);
        break;

      default:
        this.log(`Unknown message type: ${data.type}`);
    }
  }
```

**Step 2: Add helper methods stubs**

```javascript
  // Message helpers - stubs to be filled
  isDuplicateMessage(type, content, timestamp) { return false; }
  addMessage(type, content, extra = {}) { this.log(`addMessage: ${type}`); }
  appendToStreaming(text) { this.log('appendToStreaming'); }
  finalizeStreaming(content) { this.isStreaming = false; }
  addToolMessage(action, toolName, data, timestamp) { this.log('addToolMessage'); }
  updateToolResult(toolId, data) { this.log('updateToolResult'); }
  startThinking() { this.isThinking = true; }
  appendToThinking(text) { }
  finalizeThinking() { this.isThinking = false; }
  addThinkingMessage(content) { }
  showTypingIndicator() { }
  hideTypingIndicator() { }
  showProgressMessage(msg) { }
  hideProgressMessage() { }
  showResultBadge(data) { }
  updateStatus(status) { this.log(`updateStatus: ${status}`); }
  handleHistoryEnd(data) { }
  handleHistoryPageEnd(data) { }
```

**Step 3: Commit**

```bash
git add static/chat-session.js
git commit -m "feat: add ChatSession.handleMessage() routing"
```

---

## Task 5: Add connect() Method with Mux Integration

**Files:**
- Modify: `static/chat-session.js`

**Step 1: Add connect method**

```javascript
  /**
   * Connect to chat backend via MuxWebSocket
   */
  connect() {
    this.log(`connect: sessionId=${this.sessionId?.substring(0, 8)}, workingDir=${this.workingDir}`);

    if (!window.muxWs) {
      this.log('ERROR: muxWs not available');
      this.updateStatus('disconnected');
      return;
    }

    // Capture this session instance for closure
    const self = this;

    window.muxWs.connectChat(this.sessionId, this.workingDir, {
      onConnect: (data) => {
        self.log(`onConnect: ${JSON.stringify(data)}`);
        self.isConnected = true;
        self.updateStatus('connected');

        // Handle session ID remapping
        if (data.original_session_id && data.original_session_id !== self.sessionId) {
          self.log(`Session ID remapped: ${data.original_session_id} -> implied new ID`);
        }

        if (data.history_count !== undefined) {
          self.hasMoreHistory = data.history_count > 0;
        }

        if (data.claude_session_id) {
          self.claudeSessionId = data.claude_session_id;
        }
      },

      onMessage: (type, data) => {
        // Direct message handling - no context switching needed!
        self.handleMessage({ type, ...data });
      },

      onDisconnect: () => {
        self.log('onDisconnect');
        self.isConnected = false;
        self.updateStatus('disconnected');
      }
    });

    this.updateStatus('connecting');
  }

  /**
   * Disconnect from chat backend
   */
  disconnect() {
    this.log('disconnect');
    if (window.muxWs && this.sessionId) {
      window.muxWs.disconnectChat(this.sessionId);
    }
    this.isConnected = false;
    this.updateStatus('disconnected');

    // Cleanup event handlers
    if (this._documentClickHandler) {
      document.removeEventListener('click', this._documentClickHandler);
      this._documentClickHandler = null;
    }
  }
```

**Step 2: Commit**

```bash
git add static/chat-session.js
git commit -m "feat: add ChatSession.connect() with Mux integration"
```

---

## Task 6: Create ChatManager Coordinator

**Files:**
- Create: `static/chat-manager.js`

**Step 1: Create ChatManager class**

```javascript
/**
 * ChatManager - Coordinates multiple ChatSession instances
 * Provides backward-compatible API that maps to ChatMode usage
 */
class ChatManager {
  constructor() {
    // Map of sessionId -> ChatSession
    this.sessions = new Map();
    this.activeSessionId = null;
  }

  log(msg) {
    if (window.app?.debugLog) {
      window.app.debugLog(`[ChatManager] ${msg}`);
    }
  }

  /**
   * Get or create a ChatSession for the given session
   */
  getOrCreateSession(sessionId, workingDir, container) {
    let session = this.sessions.get(sessionId);

    if (!session) {
      this.log(`Creating new ChatSession for ${sessionId?.substring(0, 8)}`);
      session = new ChatSession(sessionId, workingDir, container);
      this.sessions.set(sessionId, session);
    }

    return session;
  }

  /**
   * Get existing session
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  /**
   * Get active session
   */
  getActive() {
    return this.activeSessionId ? this.sessions.get(this.activeSessionId) : null;
  }

  /**
   * Switch active session
   */
  switchTo(sessionId) {
    this.log(`Switching to session ${sessionId?.substring(0, 8)}`);
    this.activeSessionId = sessionId;
  }

  /**
   * Remove a session
   */
  removeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.disconnect();
      this.sessions.delete(sessionId);
    }
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
  }

  /**
   * Backward-compatible connect() - mimics old ChatMode.connect()
   */
  connect(sessionId, workingDir) {
    this.log(`connect (compat): sessionId=${sessionId?.substring(0, 8)}`);

    const sessionManager = window.app?.sessionManager;
    let session = sessionManager?.sessions.get(sessionId);

    if (!session) {
      this.log('ERROR: Session not found in SessionManager');
      return;
    }

    // Get or create container
    if (!session.chatContainer) {
      sessionManager.getOrCreateChatContainer(session);
    }
    sessionManager.showChatContainer(session);

    // Get or create ChatSession
    const chatSession = this.getOrCreateSession(sessionId, workingDir, session.chatContainer);

    // Render if needed
    if (!chatSession.messagesEl) {
      chatSession.render();
      chatSession.bindEvents();
    }

    // Connect if not connected
    if (!chatSession.isConnected) {
      chatSession.connect();
    }

    this.switchTo(sessionId);
  }

  /**
   * Backward-compatible init() - no-op for compatibility
   */
  init(container) {
    this.log('init (compat): no-op');
  }
}

// Create singleton and backward-compatible alias
window.ChatManager = new ChatManager();
window.ChatMode = window.ChatManager;  // Backward compatibility
```

**Step 2: Add script to index.html**

In `static/index.html`, after chat-session.js:
```html
<script src="chat-manager.js"></script>
```

**Step 3: Commit**

```bash
git add static/chat-manager.js static/index.html
git commit -m "feat: add ChatManager coordinator with backward-compatible API"
```

---

## Task 7: Migrate Message Display Methods

**Files:**
- Modify: `static/chat-session.js`

**Step 1: Copy and adapt addMessage from ChatMode**

Copy the following methods from `chat.js` to `chat-session.js`, adapting `this.` references:
- `addMessage()`
- `createMessageElement()`
- `formatContent()`
- `formatTimestamp()`
- `escapeHtml()`
- `highlightCode()`
- `scrollToBottom()`

Key changes:
- Use session-specific element IDs
- Remove context-switching code
- Direct DOM manipulation

**Step 2: Test message display**

```javascript
// In browser console
const container = document.createElement('div');
container.style.cssText = 'position:fixed;top:0;left:0;width:400px;height:500px;z-index:9999';
document.body.appendChild(container);
const session = new ChatSession('test-123', '/tmp', container);
session.render();
session.bindEvents();
session.addMessage('user', 'Hello world');
session.addMessage('assistant', 'Hi there!');
```

**Step 3: Commit**

```bash
git add static/chat-session.js
git commit -m "feat: add ChatSession message display methods"
```

---

## Task 8: Migrate Streaming Methods

**Files:**
- Modify: `static/chat-session.js`

**Step 1: Copy streaming methods from ChatMode**

Copy and adapt:
- `appendToStreaming()`
- `finalizeStreaming()`
- `showTypingIndicator()`
- `hideTypingIndicator()`

**Step 2: Test streaming**

```javascript
// Simulate streaming
session.appendToStreaming('Hello ');
session.appendToStreaming('world');
session.finalizeStreaming('Hello world');
```

**Step 3: Commit**

```bash
git add static/chat-session.js
git commit -m "feat: add ChatSession streaming methods"
```

---

## Task 9: Migrate Tool Display Methods

**Files:**
- Modify: `static/chat-session.js`

**Step 1: Copy tool methods from ChatMode**

Copy and adapt:
- `addToolMessage()`
- `updateToolResult()`
- `getToolIcon()`
- `renderEditTool()`
- `renderWriteTool()`
- `renderReadTool()`
- `renderBashTool()`
- `renderGrepTool()`
- `renderCodeWithLineNumbers()`
- `toggleToolContent()`
- `expandCodeBlock()`

**Step 2: Commit**

```bash
git add static/chat-session.js
git commit -m "feat: add ChatSession tool display methods"
```

---

## Task 10: Migrate Thinking Methods

**Files:**
- Modify: `static/chat-session.js`

**Step 1: Copy thinking methods from ChatMode**

Copy and adapt:
- `startThinking()`
- `appendToThinking()`
- `finalizeThinking()`
- `addThinkingMessage()`
- `toggleThinking()`

**Step 2: Commit**

```bash
git add static/chat-session.js
git commit -m "feat: add ChatSession thinking methods"
```

---

## Task 11: Migrate sendMessage Method

**Files:**
- Modify: `static/chat-session.js`

**Step 1: Copy sendMessage from ChatMode**

```javascript
  /**
   * Send user message
   */
  sendMessage() {
    if (!this.isConnected) {
      this.log('Cannot send: not connected');
      return;
    }

    if (this.isStreaming) {
      this.log('Cannot send: streaming in progress');
      return;
    }

    const content = this.inputEl?.value?.trim();
    if (!content) return;

    this.log(`sendMessage: ${content.substring(0, 50)}...`);

    // Immediately add user message to UI
    this.addMessage('user', content);

    // Clear input
    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';
    this.sendBtn.disabled = true;

    // Show typing indicator
    this.showTypingIndicator();

    // Send to backend
    if (window.muxWs) {
      window.muxWs.chatMessage(this.sessionId, content);
    }

    this.scrollToBottom(true);
  }
```

**Step 2: Commit**

```bash
git add static/chat-session.js
git commit -m "feat: add ChatSession.sendMessage()"
```

---

## Task 12: Migrate History Loading Methods

**Files:**
- Modify: `static/chat-session.js`

**Step 1: Copy history methods from ChatMode**

Copy and adapt:
- `loadMoreHistory()`
- `handleHistoryEnd()`
- `handleHistoryPageEnd()`

**Step 2: Commit**

```bash
git add static/chat-session.js
git commit -m "feat: add ChatSession history loading methods"
```

---

## Task 13: Migrate UI Helper Methods

**Files:**
- Modify: `static/chat-session.js`

**Step 1: Copy remaining UI methods from ChatMode**

Copy and adapt:
- `updateStatus()`
- `showProgressMessage()`
- `hideProgressMessage()`
- `showResultBadge()`
- `showNewMessagesButton()`
- `hideNewMessagesButton()`
- `copyCode()`
- `showFullscreenTool()`

**Step 2: Commit**

```bash
git add static/chat-session.js
git commit -m "feat: add ChatSession UI helper methods"
```

---

## Task 14: Update SessionManager Integration

**Files:**
- Modify: `static/session-manager.js`

**Step 1: Update getOrCreateChatContainer**

Ensure it works with new ChatSession model:
- Container should be created but not rendered by SessionManager
- ChatSession handles its own rendering

**Step 2: Store ChatSession reference in session**

```javascript
// In SessionManager, when creating chat container:
session.chatSession = null;  // Will be set by ChatManager
```

**Step 3: Commit**

```bash
git add static/session-manager.js
git commit -m "refactor: update SessionManager for ChatSession integration"
```

---

## Task 15: Remove Old Context-Switching Code

**Files:**
- Modify: `static/chat.js` (or delete entirely)

**Step 1: Remove deprecated methods**

Remove from old ChatMode:
- `handleMuxMessageForSession()`
- `handleMessageForSession()`
- `handleMessageWithoutStatusUpdate()`

**Step 2: Decide: Keep chat.js as thin wrapper or delete**

Option A: Delete `chat.js` entirely, ChatManager provides full API
Option B: Keep `chat.js` as import wrapper for backward compat

Recommend: Option A - clean break

**Step 3: Update index.html script order**

```html
<script src="chat-session.js"></script>
<script src="chat-manager.js"></script>
<!-- Remove: <script src="chat.js"></script> -->
```

**Step 4: Commit**

```bash
git add static/index.html
git rm static/chat.js  # Or keep minimal wrapper
git commit -m "refactor: remove old ChatMode singleton, use ChatSession"
```

---

## Task 16: Integration Testing

**Files:**
- None (manual testing)

**Step 1: Test single session**

1. Open app, create new chat session
2. Send message, verify response displays
3. Verify streaming works
4. Verify tool calls display
5. Verify history loading

**Step 2: Test multiple sessions**

1. Create Session A, send message
2. Create Session B, send message
3. Switch to Session A, verify messages intact
4. Send message in Session A while Session B is processing
5. Verify both sessions receive correct responses

**Step 3: Test edge cases**

1. Rapid session switching during streaming
2. Disconnect/reconnect
3. Page refresh with active sessions

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration testing fixes"
```

---

## Task 17: Cleanup and Documentation

**Files:**
- Create: `static/chat-session.js` (add JSDoc)
- Update: `docs/design/chat-architecture.md`

**Step 1: Add comprehensive JSDoc**

Document all public methods in ChatSession and ChatManager.

**Step 2: Create architecture documentation**

```markdown
# Chat Architecture

## Overview

The chat system uses a multi-instance architecture where each session
has its own ChatSession instance.

## Components

- **ChatSession**: Per-session chat state and UI
- **ChatManager**: Coordinates sessions, provides backward-compatible API
- **MuxWebSocket**: Transport layer (shared)

## Message Flow

1. Backend sends message via MuxWebSocket
2. MuxWebSocket routes to correct ChatSession via sessionId
3. ChatSession.handleMessage() processes directly (no context switch)
4. UI updates in session's own container
```

**Step 3: Final commit**

```bash
git add -A
git commit -m "docs: add ChatSession architecture documentation"
```

---

## Summary

Total tasks: 17
Estimated complexity: Medium-High
Key benefits:
1. Each session is independent - no state pollution
2. Simpler code - no context switching
3. Easier debugging - session-scoped logging
4. More maintainable - clear ownership of state
