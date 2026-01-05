# TDD Bug Fix Skill

## Overview

Test-Driven Development (TDD) approach to bug fixing. First reproduce the bug with a failing test, then fix the code, then verify the test passes.

## Trigger Conditions

Use this Skill when user says things like:
- "Fix this bug..."
- "There's a problem with..."
- "This feature doesn't work correctly..."
- "Something is broken..."

## Workflow

### Step 1: Analyze the Bug

1. Understand the user's bug report
2. Identify the affected code and expected behavior
3. Form a hypothesis about the root cause

### Step 2: Write Failing Test

1. Create a test case that reproduces the bug
2. The test should:
   - Set up the scenario that triggers the bug
   - Assert the **expected** (correct) behavior
   - Currently fail because of the bug
3. Run the test to confirm it fails

```bash
# Run specific test
npm test -- --testNamePattern="BUG-XXX"
```

### Step 3: Fix the Code

1. Make minimal changes to fix the bug
2. Add comments explaining the fix (e.g., `// BUG-XXX FIX: ...`)
3. Don't over-engineer - fix only what's broken

### Step 4: Verify Fix

1. Run the failing test again - should now pass
2. Run all related tests to ensure no regressions
3. Run full test suite

```bash
# Run all tests
npm test
```

### Step 5: Update Version & Deploy

1. Update version number in HTML (cache busting)
2. Restart service
3. Verify in browser

## Example: BUG-015 Fix

### Bug Report
> "When switching between two chat sessions, the first container doesn't hide and the second has no content"

### Step 1: Analysis
- `ChatMode.connect()` uses passed `sessionId` to find session
- If `sessionId` is stale (old cached value), `sessions.get()` returns undefined
- Code returns early without hiding old container or rendering new one

### Step 2: Failing Test

```javascript
test('BUG: connect with wrong sessionId leaves old container visible', () => {
  // Setup: create session1 and connect
  ChatMode.connect(session1.id, session1.workDir);
  expect(session1.chatContainer.style.display).toBe('block');

  // Trigger bug: use wrong sessionId
  sessionManager.activeId = session2.id;
  ChatMode.connect('wrong-id', session2.workDir);

  // Assert expected behavior (test fails before fix)
  expect(session1.chatContainer.style.display).toBe('none');
  expect(session2.chatContainer.querySelector('.chat-container')).not.toBeNull();
});
```

### Step 3: Fix

```javascript
// BUG-015 FIX: Fall back to activeId if sessionId not found
let session = sessionManager?.sessions.get(sessionId);
if (!session && sessionManager?.activeId) {
  session = sessionManager.getActive();
  if (session) {
    sessionId = session.id;
    workingDir = session.workDir || workingDir;
  }
}
```

### Step 4: Verify

```bash
npm test -- --testNamePattern="BUG-015"
# PASS: 2 tests pass

npm test
# PASS: 143 tests pass
```

### Step 5: Deploy

```bash
# Update version in index.html
# chat.js?v=15 -> chat.js?v=16

# Restart service
pkill -f uvicorn && uvicorn app.main:app --host 0.0.0.0 --port 38010
```

## Example: BUG-016 Fix

### Bug Report
> "当两个对话框来回切换的时候聊天内容不见了" (chat content disappears when switching between two sessions)

### Step 1: Analysis
- `ChatMode.render()` uses `document.getElementById()` to cache DOM elements
- When multiple chat containers exist, `getElementById` returns the FIRST element with that ID
- Result: session2's `messagesEl` points to session1's container, messages go to wrong place

### Step 2: Failing Test

```javascript
describe('BUG-016: render 使用 document.getElementById 导致多容器冲突', () => {
  test('发送消息应该添加到当前 session 的容器而非第一个容器', () => {
    // Setup session1 and session2
    ChatMode.connect(session1.id, session1.workDir);
    ChatMode.addMessage('user', 'Session 1 message');

    ChatMode.connect(session2.id, session2.workDir);
    ChatMode.addMessage('user', 'Session 2 message');

    // BUG: message goes to session1's container instead of session2
    const session2Messages = session2.chatContainer.querySelectorAll('.chat-message.user');
    expect(session2Messages.length).toBe(1);
    expect(session2Messages[0].textContent).toContain('Session 2');
  });
});
```

### Step 3: Fix

```javascript
// BUG-016 FIX: 使用 this.container.querySelector 而非 document.getElementById
// 因为多个 session 的 chat 容器共存时，getElementById 只返回第一个匹配的元素
this.messagesEl = this.container.querySelector('#chatMessages');
this.inputEl = this.container.querySelector('#chatInput');
this.sendBtn = this.container.querySelector('#chatSendBtn');
```

### Step 4: Verify

```bash
npm test -- --testPathPattern="chat-container"
# PASS: 31 tests pass (including 4 new BUG-016 tests)
```

## Benefits

1. **Reproducible**: Test documents the exact bug scenario
2. **Verified**: Fix is proven correct by passing test
3. **Regression-proof**: Future changes won't reintroduce bug
4. **Documented**: Test serves as bug documentation

## Test Naming Convention

Use `BUG-XXX` prefix for bug reproduction tests:

```javascript
describe('BUG-015: connect falls back to activeId', () => {
  test('BUG: using invalid sessionId with valid activeId', () => {
    // ...
  });
});
```
