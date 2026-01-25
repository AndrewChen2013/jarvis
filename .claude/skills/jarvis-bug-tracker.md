---
name: jarvis-bug-tracker
description: Use when investigating or fixing bugs in Jarvis - contains history of past bugs, patterns, and solutions
---

# Jarvis Bug Tracker

## When to Use This Skill

- Investigating a new bug in Jarvis
- Looking for similar past issues
- Understanding common bug patterns
- Verifying a fix was complete

## Bug History

### BUG-001: Chat Message Duplication on Reconnect

**Date**: 2026-01-25
**Status**: FIXED

**Symptoms**:
- After network reconnect, user sees duplicate messages
- History messages sent multiple times
- Multiple Claude processes started

**Root Cause**:
Backend handlers lacked idempotency. On reconnect:
1. `_handle_auth()` sent `auth_success` multiple times
2. `_handle_chat_message(connect)` sent history multiple times

**Fix**:
```python
# In _handle_auth()
if client.authenticated:
    return  # Already authenticated, skip

# In _handle_chat_message() for connect
if session_id in client.chat_callbacks:
    return  # Already connected, skip
```

**Files**: `app/services/socketio_connection_manager.py`

**Doc**: `/docs/investigation-chat-message-duplication.md`

---

### BUG-002: Second Message No Response

**Date**: 2026-01-25
**Status**: FIXED

**Symptoms**:
- First message works
- Second and subsequent messages get no response
- Logs show "Session found: False"

**Root Cause**:
Terminal and Chat used same mapping key `(sid, session_id)`. When creating new session:
1. Chat creates `28e2fb3e`, stores mapping
2. Terminal creates `cfd2c20c`, **overwrites** mapping
3. Message handler gets wrong UUID

**Fix**:
Add channel prefix to mapping keys:
```python
# Before (BUG)
(sid, session_id) -> uuid

# After (FIX)
(sid, 'terminal', session_id) -> terminal_uuid
(sid, 'chat', session_id) -> chat_uuid
```

**Files**: `app/services/socketio_connection_manager.py`
- Lines affected: 301-307, 317-324, 402-416, 455-461, 555-560, 595-600, 610-615

**Doc**: `/docs/bug-chat-second-message-no-response.md`

---

### BUG-003: Session Not Reused When Reopening From List

**Date**: 2026-01-25
**Status**: FIXED

**Symptoms**:
- Open a chat session from session list popup
- Click minimize button (down arrow) to return to session list
- Open **the same** session again from the list
- A NEW session is created instead of reusing the existing one
- `sessions.size` goes from 1 → 1 → 2 (increases!)
- `activeId` changes to a different UUID

**Root Cause**:
Session ID mismatch between what's passed and what's stored:

1. When clicking a session in the popup list, `projects.js` passes:
   - `session.session_id` = Claude CLI session ID (e.g., `b97c59ab-...`)
   - `session.chat_session_id` = Chat Claude session ID

2. `connectTerminal()` stores session in `sessionManager.sessions` Map with key = **terminal session ID** (e.g., `178ab763-...`, returned by server)

3. On second open, `connectTerminal()` does `sessions.get(sessionId)` where `sessionId` is the Claude CLI session ID (`b97c59ab-...`), but the Map key is the terminal session ID (`178ab763-...`) → **not found** → creates new session

**Fix**:

In `connectTerminal()`, search for existing session by `chatClaudeSessionId`:

```javascript
// In static/websocket.js, connectTerminal()
let existingSession = null;
if (chatClaudeSessionId) {
  for (const [key, session] of this.sessionManager.sessions) {
    if (session.chatClaudeSessionId === chatClaudeSessionId) {
      existingSession = session;
      this.currentSession = key;
      break;
    }
  }
}
// If found existing connected session, reuse it
if (existingSession && existingSession.status === 'connected') {
  this.sessionManager.switchTo(this.currentSession);
  return; // Don't create new session
}
```

**Files**:
- `static/websocket.js` (lines 63-144) - Search by chatClaudeSessionId, reuse existing sessions
- `static/session-manager.js` - closeSession() uses close (not disconnect) to properly cleanup

**Key Insight**:
- Session popup passes Claude CLI session ID, but Map key is terminal session ID
- Must search by `chatClaudeSessionId` property to find existing session
- Close button (←) = completely close session, delete from Map
- Minimize button (∨) = keep session in background, reuse when reopening

---

## Common Bug Patterns

### Pattern 1: Session ID Mismatch

**Symptoms**: Message sent but nothing happens, "Session found: False"

**Check**:
```bash
grep "Session found" /tmp/jarvis.log | tail -5
grep "active sessions" /tmp/jarvis.log | tail -5
grep "mapping" /tmp/jarvis.log | tail -10
```

**Common Causes**:
- Frontend sends originalSessionId, backend expects UUID
- Mapping not stored or overwritten
- Session closed but frontend doesn't know

### Pattern 2: Duplicate Processing

**Symptoms**: Same action happens multiple times, duplicate messages

**Check**:
```bash
grep "authenticated" /tmp/jarvis.log | tail -10  # Multiple auth?
grep "Chat connect" /tmp/jarvis.log | tail -10   # Multiple connect?
```

**Common Causes**:
- Network reconnect triggers resend
- Handler lacks idempotency check
- Socket.IO polling mode retries

### Pattern 3: Race Condition

**Symptoms**: Works sometimes, fails randomly, timing-dependent

**Check**:
```bash
# Look for overlapping timestamps
grep "11:32:59" /tmp/jarvis.log  # Same second
```

**Common Causes**:
- Terminal and Chat creating sessions simultaneously
- Async operations without proper synchronization
- Callbacks registered before session ready

## Debugging Methodology

### Step 1: Reproduce

1. Get exact steps to reproduce
2. Set up logging to capture all events
3. Try to reproduce consistently

### Step 2: Analyze Logs

```bash
# Key patterns to search
grep -E "Chat (connect|message)|Session found|mapping" /tmp/jarvis.log | tail -30
```

### Step 3: Trace Flow

1. Frontend action → What message sent?
2. Backend receive → Which handler?
3. Handler logic → What state checked?
4. Response → What sent back?

### Step 4: Identify Root Cause

Ask:
- Is this a state issue? (wrong state)
- Is this a race condition? (timing)
- Is this an idempotency issue? (duplicate processing)
- Is this a mapping issue? (ID mismatch)

### Step 5: Fix and Verify

1. Implement minimal fix
2. Restart service
3. Test the exact reproduction steps
4. Test related scenarios
5. Check logs confirm fix

## Test Checklist for Bug Fixes

- [ ] Original bug no longer occurs
- [ ] First message in new session works
- [ ] Multiple messages in same session work
- [ ] Creating new session works
- [ ] Switching sessions works
- [ ] Page refresh doesn't break existing session
- [ ] No duplicate messages
- [ ] Logs show expected behavior

## Skill Evolution

**UPDATE THIS SKILL** when you:
- Fix a new bug (add to history)
- Discover a new pattern
- Learn a new debugging technique
- Find a new log pattern to check
