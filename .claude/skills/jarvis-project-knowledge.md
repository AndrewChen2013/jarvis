---
name: jarvis-project-knowledge
description: Use when working on Jarvis project - contains architecture knowledge, patterns, and gotchas
---

# Jarvis Project Knowledge Base

## When to Use This Skill

- Working on any Jarvis feature or bug fix
- Understanding the codebase architecture
- Debugging issues in chat, terminal, or WebSocket

## Architecture Overview

### Frontend Stack

```
static/
├── app.js                    # Main application entry, view management
├── mux-websocket.js          # WebSocket multiplexer (muxWs)
├── socketio-websocket.js     # Socket.IO client wrapper
├── projects.js               # Project/session management
├── chat/
│   ├── chat-messages.js      # Message rendering, sending
│   ├── chat-websocket.js     # Chat-specific WebSocket logic
│   └── ...
└── ...
```

### Backend Stack

```
app/
├── main.py                   # FastAPI app entry
├── services/
│   ├── socketio_connection_manager.py  # WebSocket handler (KEY FILE)
│   ├── chat_session_manager.py         # Claude CLI interface
│   ├── terminal_manager.py             # PTY terminal management
│   └── ...
└── ...
```

### Communication Flow

```
Browser (Frontend)
    ↓ Socket.IO / WebSocket
app/services/socketio_connection_manager.py
    ↓ Message routing by channel (terminal/chat)
    ├── Terminal → terminal_manager.py → PTY
    └── Chat → chat_session_manager.py → Claude CLI
```

## Key Patterns

### 1. Session ID Mapping

Frontend uses temporary IDs (`new-TIMESTAMP`), backend uses UUIDs.

```python
# Key structure: (sid, channel, original_id) -> uuid
self._session_id_mapping[(sid, 'chat', 'new-1769')] = '28e2fb3e-...'
self._session_id_mapping[(sid, 'terminal', 'new-1769')] = 'cfd2c20c-...'
```

**CRITICAL**: Terminal and Chat must use different channel prefixes to avoid conflicts!

### 2. Message Type Routing

```python
# In _handle_chat_message()
if msg_type == "connect":      # Create/resume session
elif msg_type == "message":    # Send user message
elif msg_type == "load_more_history":  # Pagination
elif msg_type == "close":      # Close session
```

### 3. Callback Pattern for Streaming

```python
# Claude responses are streamed via callbacks
def chat_callback(event_type, data):
    # Put message in queue for async emission
    message_queue.put_nowait((event_type, data))

session.add_callback(chat_callback)
```

### 4. Frontend Session Management

```javascript
// app.sessionManager manages all sessions
window.app.sessionManager.activeId;        // Current session UUID
window.app.sessionManager.getActive();      // Current session object
session.chatConnectionId;                   // Chat connection ID (may differ from UUID)
```

## Important Files

| File | Purpose | Key Functions |
|------|---------|---------------|
| `socketio_connection_manager.py` | WebSocket routing | `_handle_chat_message()`, `_handle_terminal_message()` |
| `chat_session_manager.py` | Claude CLI wrapper | `create_session()`, `send_message()` |
| `mux-websocket.js` | Frontend WebSocket | `chatMessage()`, `chatConnect()` |
| `chat-websocket.js` | Chat connection | `connectMux()`, `ChatMode.connect()` |

## Common Gotchas

### 1. Session ID vs Connection ID

- `sessionId`: Backend UUID stored in database
- `chatConnectionId`: Frontend's original ID sent to backend
- `originalSessionId`: What frontend uses to identify the session

### 2. Terminal vs Chat Sessions

Creating a new session creates BOTH:
1. Terminal session (PTY) - for claude CLI
2. Chat session - for message handling

They share the same `originalSessionId` but have different UUIDs.

### 3. Idempotency Requirements

Backend handlers MUST be idempotent because:
- Network reconnects may resend messages
- Socket.IO polling may duplicate requests
- Mobile browsers have unstable connections

### 4. Log Locations

```bash
# Development
/tmp/jarvis.log  # When started with > /tmp/jarvis.log

# Production
/Users/bill/jarvis/logs/app.log
```

## Frontend Cache Busting

**IMPORTANT**: When modifying frontend JS files, update the version number to bypass browser cache.

In `static/index.html`, each JS file has a `?v=XX` suffix:

```html
<script defer src="/static/socketio-websocket.js?v=7"></script>
<script defer src="/static/mux-websocket.js?v=17"></script>
<script defer src="/static/app.js?v=46"></script>
```

**After modifying a JS file**:
1. Find the `<script>` tag in `static/index.html`
2. Increment the version number (e.g., `?v=7` → `?v=8`)
3. Save and refresh browser

**Common files and their current versions** (check index.html for latest):
| File | Example |
|------|---------|
| socketio-websocket.js | ?v=7 |
| mux-websocket.js | ?v=17 |
| session-manager.js | ?v=19 |
| websocket.js | ?v=72 |
| app.js | ?v=46 |
| chat/*.js | ?v=1 |

## Service Management

```bash
# Find process
/usr/sbin/lsof -i :8000 | grep LISTEN

# Kill existing
kill <PID>

# Start
cd /Users/bill/jarvis
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# Background
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 > /tmp/jarvis.log 2>&1 &
```

## Mobile Debug Panel

**IMPORTANT**: On mobile devices, browser console is not accessible. Jarvis has a built-in debug panel.

### Opening Debug Panel

Click these areas to toggle the debug panel:

| View | Click Target | Element |
|------|--------------|---------|
| Sessions (main page) | Top-left hostname area (bill@Mac-Pro.local) | `.header-title` |
| Terminal view | Center title area | `.toolbar-center` |
| Chat view | "jarvis" title at top | `#chatTitle` |

### Debug Panel Features

| Button | Function |
|--------|----------|
| **Remote** | Enable remote logging (sends logs to server via WebSocket) |
| **API** | Log all fetch() API requests and responses |
| **Chat** | Switch to Chat mode for current session |
| **Copy** | Copy all logs to clipboard |
| **Clear** | Clear the log display |

### Remote Log Status Indicator

The colored dot next to "Debug Log" shows remote log connection status:
- 🟢 Green: Connected
- 🟠 Orange: Disconnected (will reconnect)
- 🔴 Red: Error
- ⚫ Gray: Stopped

### Using debugLog in Code

```javascript
// Log messages visible in debug panel
window.app.debugLog('Your debug message here');

// Or if using mixin
this.debugLog('Message from component');
```

### Key Debug Files

| File | Purpose |
|------|---------|
| `static/debug.js` | AppDebug module - debug panel, remote logging |
| `static/chat/chat-ui.js` | Chat title click handler |

## Debugging Tips

### Check Session State

```bash
# Active chat sessions
grep "active sessions" /tmp/jarvis.log | tail -5

# Session mapping
grep "mapping" /tmp/jarvis.log | tail -10

# Session creation
grep "Creating new chat session" /tmp/jarvis.log | tail -5
```

### Check Message Flow

```bash
# Message received
grep "Chat message received" /tmp/jarvis.log | tail -5

# Session lookup result
grep "Session found" /tmp/jarvis.log | tail -5

# Message processing
grep "Processing chat message" /tmp/jarvis.log | tail -5
```

## Skill Evolution

**UPDATE THIS SKILL** when you discover:
- New architecture patterns
- New gotchas or common issues
- Changes to key files or functions
- New debugging techniques
