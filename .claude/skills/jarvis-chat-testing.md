---
name: jarvis-chat-testing
description: Use when testing Jarvis chat functionality via browser MCP or debugging chat-related bugs
---

# Jarvis Chat Testing Guide

## When to Use This Skill

- Testing Chat mode functionality
- Debugging chat message delivery issues
- Verifying session creation and switching
- Browser-based automated testing of Jarvis

## Browser MCP Usage Notes

### Correct Element IDs

```javascript
// Chat input field
document.querySelector('#chatInput')  // NOT #chat-input

// Send button
document.querySelector('#chatSendBtn')  // NOT #send-btn

// Chat messages container
document.querySelector('#chatMessages')

// Chat status indicator
document.querySelector('#chatStatus')
```

### Sending Messages via Browser

1. **First, ensure session is selected** - click on project and session
2. **Type in chat input using browser MCP type action:**
   ```
   action: type
   selector: #chatInput
   payload: Your message here
   ```
3. **Click send button:**
   ```
   action: click
   selector: #chatSendBtn
   ```
4. **Or use JavaScript API directly (more reliable):**
   ```javascript
   // Get session ID from ChatMode
   const sessionId = window.ChatMode?.sessionId;
   window.muxWs.chatMessage(sessionId, 'Your message');
   ```

### Creating New Sessions

```javascript
// Create a new session for a project
window.app.connectTerminal('/Users/bill/jarvis');

// This will:
// 1. Create Terminal session with UUID
// 2. Navigate to chat view
// 3. Chat connect creates Chat session with different UUID
// 4. Both store their mappings with channel prefix
```

### Checking Session State

```javascript
// Get current session info
JSON.stringify({
    sessionId: window.app?.sessionManager?.activeId?.substring(0, 12),
    chatConnectionId: window.app?.sessionManager?.getActive()?.chatConnectionId?.substring(0, 12),
    isConnected: window.ChatMode?.isConnected,
    chatSessionId: window.ChatMode?.sessionId?.substring(0, 12)
});
```

### Waiting for Response

- After sending, look for typing indicator: `.chat-typing-indicator`
- Response appears in `.chat-message.assistant`
- Check for errors in browser console

## Jarvis Chat Architecture

### Session ID Flow

```
Frontend (originalSessionId: "new-1769")
    ↓ muxWs.chatMessage(sessionId, content)
Backend SocketIO
    ↓ _session_id_mapping[(sid, 'chat', originalSessionId)] -> UUID
ChatSessionManager._sessions[UUID]
    ↓ ChatSession.send_message()
Claude CLI (stream-json mode)
```

### Key Mapping Mechanism

**CRITICAL**: Terminal and Chat use SEPARATE mapping keys to avoid conflicts:

```python
# Terminal mapping key
(sid, 'terminal', original_session_id) -> terminal_uuid

# Chat mapping key
(sid, 'chat', original_session_id) -> chat_uuid
```

Without channel prefix, Terminal's mapping can overwrite Chat's mapping (or vice versa), causing messages to route to wrong session.

### Session Creation Flow

1. **UI clicks "New Session"** → `createSession()` in projects.js
2. **Terminal connects first** → creates Terminal session with UUID (e.g., `cfd2c20c`)
3. **Chat connects second** → creates Chat session with different UUID (e.g., `28e2fb3e`)
4. **Both store mappings** → `(sid, 'terminal', 'new-1769') -> cfd2c20c` and `(sid, 'chat', 'new-1769') -> 28e2fb3e`

### Key Files

| File | Purpose |
|------|---------|
| `app/services/socketio_connection_manager.py` | WebSocket handling, session mapping |
| `app/services/chat_session_manager.py` | ChatSession class, Claude CLI interface |
| `static/chat/chat-websocket.js` | Frontend Chat WebSocket logic |
| `static/chat/chat-messages.js` | Message rendering and sending |
| `static/mux-websocket.js` | Multiplexed WebSocket (muxWs) |

### Log Locations

```bash
# Main application log
/Users/bill/jarvis/logs/app.log

# Key log patterns to search
grep -E "Chat (connect|message)|Session found|mapping" logs/app.log

# Check if session was created
grep "Creating new chat session" logs/app.log

# Check mapping storage
grep "Stored chat UUID mapping" logs/app.log
```

## Common Issues and Solutions

### Issue 1: Message sent but no response

**Symptoms:**
- User message appears in UI
- No assistant response
- Typing indicator may not appear

**Debug Steps:**
1. Check logs for "Session found: False"
2. Verify mapping: `Chat message using mapped session: X -> Y`
3. Ensure mapped ID exists in `chat_manager._sessions`

**Common Causes:**
- Terminal and Chat mapping conflict (fixed by channel prefix)
- Chat session not created (check if Chat connect message was sent)
- Session closed unexpectedly

### Issue 2: Wrong session receives message

**Symptoms:**
- Message appears in different session
- Response goes to wrong place

**Debug Steps:**
1. Check `_session_id_mapping` for correct mapping
2. Verify `chatConnectionId` on frontend session object
3. Check for sid changes (reconnection)

### Issue 3: Session ID mismatch after reconnect

**Symptoms:**
- Works first time, fails after page refresh

**Debug Steps:**
1. Check if mapping persisted to database (`db.get_chat_session_id`)
2. Verify `chatConnectionId` preservation on frontend
3. Look for "Restored chat mapping from DB" in logs

## Testing Checklist

- [ ] Create new session, send first message, verify response
- [ ] Send second message in same session, verify response
- [ ] Send third message (multi-round), verify response
- [ ] Create another new session, test messages
- [ ] Switch between sessions, verify both work
- [ ] Refresh page, verify session resumes correctly
- [ ] Check logs for any errors or warnings

## Service Management

```bash
# Find running process
/usr/sbin/lsof -i :8000 | grep LISTEN

# Kill process
kill <PID>

# Start service
cd /Users/bill/jarvis
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# Or run in background
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 > /tmp/jarvis.log 2>&1 &
```

## Bug Fix History

### 2026-01-25: Terminal/Chat Mapping Conflict

**Problem**: After first message, subsequent messages received no response.

**Root Cause**: Terminal and Chat both used the same mapping key `(sid, session_id)`. When creating a new session:
1. Chat connect creates session `28e2fb3e`, stores `(sid, 'new-1769') -> 28e2fb3e`
2. Terminal connect creates session `cfd2c20c`, **overwrites** `(sid, 'new-1769') -> cfd2c20c`
3. Message handler looks up mapping, gets `cfd2c20c` (Terminal UUID)
4. `cfd2c20c` not in `chat_manager._sessions` → Session found: False

**Fix**: Added channel prefix to mapping keys:
- Terminal: `(sid, 'terminal', session_id)`
- Chat: `(sid, 'chat', session_id)`

**Files Changed**: `app/services/socketio_connection_manager.py`
- Lines 301-307: Terminal connect mapping
- Lines 317-324: Terminal message handlers
- Lines 402-416: Chat connect mapping
- Lines 455-461: Chat connect new session mapping
- Lines 555-560: Chat message handler mapping lookup
- Lines 595-600: Chat load_more_history mapping
- Lines 610-615: Chat close mapping

## Skill Evolution

**UPDATE THIS SKILL** when you discover:
- New element IDs or selectors
- New debugging techniques
- New architecture patterns
- New common issues and solutions
- Changes to session/mapping logic
- New bugs and their fixes

Add findings immediately to keep this skill current.
