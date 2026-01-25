---
name: testing-methodology
description: Use when testing Jarvis features or bug fixes - systematic testing approach
---

# Testing Methodology for Jarvis

## When to Use This Skill

- After implementing a feature or bug fix
- Before claiming work is complete
- When verifying system behavior

## Core Principles

### 1. Never Trust "It Should Work"

Always verify with actual tests. "The code looks correct" is not verification.

### 2. Test the Exact Reproduction Steps

For bug fixes, test the exact steps that caused the original bug, not similar steps.

### 3. Test Related Scenarios

A fix for scenario A might break scenario B. Test both.

### 4. Check Logs, Not Just UI

UI might show success while backend has errors. Always check both.

## Testing Process

### Phase 1: Preparation

```bash
# 1. Restart service with fresh logs
kill <old_pid>
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 > /tmp/jarvis.log 2>&1 &

# 2. Clear browser cache/hard refresh
# Cmd+Shift+R on Mac

# 3. Have log monitoring ready
tail -f /tmp/jarvis.log | grep -E "ERROR|WARN|Chat|Session"
```

### Phase 2: Basic Functionality

| Test | Expected | Verify |
|------|----------|--------|
| Create new session | Session created, chat ready | UI shows "Connected", logs show "Creating new chat session" |
| Send first message | Message sent, response received | User bubble appears, assistant response appears |
| Send second message | Message sent, response received | Same as above |
| Send third message | Message sent, response received | Confirms multi-round works |

### Phase 3: Session Management

| Test | Expected | Verify |
|------|----------|--------|
| Create second session | New session, empty chat | "Start a conversation" shown |
| Send message in second session | Response received | Different session ID in logs |
| Switch to first session | First session's history shown | Messages from first session visible |
| Send message in first session | Response received | Correct session ID in logs |

### Phase 4: Edge Cases

| Test | Expected | Verify |
|------|----------|--------|
| Refresh page | Session resumes | History loaded, can continue chatting |
| Rapid messages | All processed in order | No duplicates, correct order |
| Long message | Handled correctly | Full message received |
| Empty message | Not sent | Button disabled or no-op |

### Phase 5: Error Handling

| Test | Expected | Verify |
|------|----------|--------|
| Network disconnect | Reconnects automatically | Status shows reconnecting, then connected |
| Server restart | Client reconnects | Session resumes after server up |

## Verification Methods

### Method 1: Visual Verification

Take screenshots at each step:
```javascript
// Browser MCP
action: screenshot
payload: step-1-after-send
```

### Method 2: Log Verification

Check logs match expected flow:
```bash
# After sending message
grep "Chat message received" /tmp/jarvis.log | tail -1
grep "Session found: True" /tmp/jarvis.log | tail -1
grep "Processing chat message" /tmp/jarvis.log | tail -1
```

### Method 3: State Verification

Check internal state via JavaScript:
```javascript
JSON.stringify({
    sessionId: window.app?.sessionManager?.activeId,
    isConnected: window.ChatMode?.isConnected,
    messageCount: document.querySelectorAll('.chat-message').length
});
```

## Test Documentation

For each test session, record:

```markdown
## Test Session: YYYY-MM-DD HH:MM

### Environment
- Server: localhost:8000
- Browser: Chrome/Safari/etc
- Log file: /tmp/jarvis.log

### Tests Performed
1. [PASS/FAIL] Create new session
2. [PASS/FAIL] Send first message
3. [PASS/FAIL] Send second message
...

### Issues Found
- None / Description of issues

### Conclusion
- All tests passed / Issues require investigation
```

## Common Test Failures

### "Session found: False"

**Check**:
1. Is session ID mapping stored?
2. Is correct channel prefix used?
3. Was session closed unexpectedly?

### "No response received"

**Check**:
1. Did message reach backend? (check logs)
2. Did backend process it? (check "Processing" log)
3. Did response send? (check "callback invoked" logs)
4. Did frontend receive? (check network tab)

### "Duplicate messages"

**Check**:
1. Is idempotency check working?
2. Was there a reconnect?
3. Check timestamps for duplicate processing

## Skill Evolution

**UPDATE THIS SKILL** when you:
- Find a new test scenario
- Discover a new verification method
- Learn from a missed test case
- Improve the testing process
