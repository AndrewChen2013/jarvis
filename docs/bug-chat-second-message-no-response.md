# BUG: Chat Second Message No Response

## Problem Description

After sending the first message in a chat session, subsequent messages receive no response from the backend.

## Root Cause Analysis

### The Bug Location

File: `app/services/socketio_connection_manager.py`
Function: `_handle_chat_message()`
Lines: 543-567 (message handling branch)

### The Problem

When handling `msg_type == "message"`:

```python
elif msg_type == "message":
    content = data.get("content", "")
    if content and session_id:
        # BUG: Directly uses session_id without mapping lookup!
        session = chat_manager.get_session(session_id)
```

The code directly uses `session_id` from the frontend to look up the session in `chat_manager._sessions`. However:

1. **Frontend sends `originalSessionId`**: The frontend's `chatMessage()` function (in `socketio-websocket.js:388`) sends `handler.originalSessionId` as the session_id
2. **Backend stores UUID key**: When handling `connect`, the backend creates a new UUID and stores the session with that UUID as the key in `chat_manager._sessions`
3. **Mapping exists but not used**: The backend has a mapping `(sid, original_session_id) -> uuid` in `self._session_id_mapping`, but the `message` handler doesn't use it

### Why First Message Works (Sometimes)

The first message may work in certain timing conditions, but subsequent messages consistently fail because:
- The `connect` handler properly maps `original_session_id` to `uuid`
- The `message` handler doesn't use this mapping

### Evidence from Logs

Previous logs showed:
```
[SocketIO] Session found: False, active sessions: [...]
```

This confirms the session lookup fails because the wrong key is used.

## The Fix

Add mapping lookup in the `message` handler before looking up the session:

```python
elif msg_type == "message":
    content = data.get("content", "")
    if content and session_id:
        # FIX: Look up the mapped session ID first
        real_session_id = self._session_id_mapping.get((sid, session_id), session_id)
        session = chat_manager.get_session(real_session_id)

        # If not found, try looking up via resume_session_id
        if not session:
            for sess_id, sess in chat_manager._sessions.items():
                if getattr(sess, 'resume_session_id', None) == session_id:
                    session = sess
                    real_session_id = sess_id
                    break

        # Use real_session_id for subsequent operations
        ...
```

## Test Plan

1. Create a new chat session
2. Send first message - verify response received
3. Send second message - verify response received
4. Send third message - verify response received
5. Create another session
6. Send multiple messages in second session
7. Switch back to first session
8. Verify messages still work in first session

## Related Files

- `app/services/socketio_connection_manager.py` - Backend Socket.IO handler
- `static/socketio-websocket.js` - Frontend Socket.IO client
- `static/chat/chat-messages.js` - Frontend chat message handling
