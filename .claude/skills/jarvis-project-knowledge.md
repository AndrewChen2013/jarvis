---
name: jarvis-project-knowledge
description: Use when working on Jarvis project - contains architecture knowledge, patterns, and gotchas
---

# Jarvis Project Knowledge Base

## When to Use This Skill

- Working on any Jarvis feature or bug fix
- Understanding the codebase architecture
- Debugging issues in chat, terminal, or WebSocket

## Bug 修复规范（CRITICAL）

**修复任何bug时，必须遵循以下流程：**

### 1. 验证问题存在
- **自动化测试**：先通过网页自动化测试复现问题
- 记录问题的具体表现（截图、日志）
- 不要凭猜测修复

### 2. 收集信息和诊断
- 查看相关日志（后端 `/Users/bill/jarvis/logs/app.log`，前端远程日志）
- 使用 MCP browser 检查前端状态
- 定位根本原因（不是表面症状）

### 3. 修复代码
- 修改代码解决根本原因
- 添加必要的日志用于未来调试
- 如果可能，添加防护性检查

### 4. 验收测试
- **再次通过自动化测试验证问题已修复**
- 确认没有引入新问题
- 检查边界情况

### 5. 测试用例保护
- **如果能通过代码测试用例复现**：编写自动化测试保护修复
- **如果不能通过代码测试**：在此文档中记录网页操作测试步骤

### 6. 重要原则
- ❌ **禁止**：看到问题 → 猜测原因 → 直接改代码 → 重启看看
- ✅ **正确**：验证存在 → 收集信息 → 定位原因 → 修复 → 验收测试 → 保护

**示例：BUG-DUPLICATE-MESSAGES - 历史消息重复**
```
问题：周报session中每条历史消息都出现两次

❌ 错误做法：猜测是发送了两次，加个去重逻辑

✅ 正确做法：
  1. 验证问题存在：
     - 打开周报session，查看页面消息列表，发现每条消息重复
     - 查询数据库：db.get_chat_messages_desc('2af88c3f...', limit=20)
     - 确认：数据库中确实有重复记录，且timestamp不同

  2. 收集信息和诊断：
     - 检查Claude transcript文件：每条消息只出现一次 ✓
     - 检查代码逻辑：发现两处保存点
       a) _read_output() - 实时保存，使用新生成的timestamp
       b) _sync_history_to_db() - 文件同步，使用Claude原始timestamp
     - 根本原因：ChatMessage创建时未提取Claude原始timestamp，
       导致实时保存和文件同步使用不同timestamp，UNIQUE约束失效

  3. 修复代码 (app/services/chat_session_manager.py:223-248)：
     在_read_output()创建ChatMessage时，从Claude CLI输出提取原始timestamp

  4. 验收测试：
     - 重启服务，创建新session发送测试消息
     - 查询数据库检查无重复
     - 检查旧数据库中重复记录(timestamp不同的)已被去重

  5. 测试步骤记录：
     验证方法见下方"常见Bug测试步骤"部分
```

### 常见Bug测试步骤

**测试消息去重（BUG-DUPLICATE-MESSAGES）**：
1. 创建新session或使用测试session
2. 发送测试消息："test message - " + timestamp
3. 等待回复完成
4. 查询数据库检查是否重复：
   ```python
   from app.services.database import db
   messages = db.get_chat_messages_desc('session_id', limit=30)
   # 检查同一内容是否有多条timestamp不同的记录
   ```
5. 验证：同一条消息应该只有一条数据库记录

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

### 0. ChatSession 单一 Callback 模式

**设计**: 每个 ChatSession 只有一个 callback，新的自动覆盖旧的

```python
# chat_session_manager.py
class ChatSession:
    _callback: Optional[Callable] = None
    _callback_owner: Optional[str] = None  # Socket.IO sid

    def set_callback(self, callback, owner: str):
        # 自动覆盖旧 callback，记录所有权转移
        if self._callback_owner and self._callback_owner != owner:
            logger.info(f"[Session] Callback owner: {self._callback_owner[:8]} -> {owner[:8]}")
        self._callback = callback
        self._callback_owner = owner

    def clear_callback(self, owner: str):
        # 只有 owner 能清理
        if self._callback_owner == owner:
            self._callback = None
            self._callback_owner = None
```

**日志诊断**:
```bash
# 查看 callback 所有权变化
grep "Callback owner:" /Users/bill/jarvis/logs/app.log | tail -20

# 查看特定 session 的消息流
grep "session=XXXXXXXX" /Users/bill/jarvis/logs/app.log | tail -50
```

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

**正确的重启命令**（必须按此顺序执行）：

```bash
# 1. 查找进程（pkill 可能不管用）
ps aux | grep uvicorn | grep -v grep

# 2. 强制杀死（用 PID，不用 pkill）
kill -9 <PID>

# 3. 等待端口释放
sleep 2

# 4. 启动（必须指定完整路径或在 venv 环境中）
cd /Users/bill/jarvis
/Users/bill/jarvis/venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# 5. 后台运行版本
nohup /Users/bill/jarvis/venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 > /tmp/jarvis.log 2>&1 &
```

**常见错误**:
- `pkill -f "uvicorn"` 经常不管用，必须用 `kill -9 <PID>`
- 不要用 `python main.py`，主入口是 `python -m uvicorn app.main:app`
- 重启后必须验证只有一个进程：`ps aux | grep uvicorn | grep -v grep`

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
| `app/api/debug.py` | Backend remote log receiver |

### Remote Logging System

前端日志可以通过 Remote Logging 发送到后端，方便调试移动端或无法打开 console 的场景。

**启用方法**：
1. 打开 debug panel（点击页面顶部标题）
2. 点击 "Remote" 按钮启用

**后端接收**：
- WebSocket: `/ws/debug?client_id=xxx`
- HTTP 备份: `POST /api/debug/logs`

**日志存储位置**：
```bash
/Users/bill/jarvis/logs/frontend/

# 文件命名格式: {日期}_{clientId}.log
# 例如: 20260125_Mozilla50iPhoneCPUiP-mktu6eie-825k.log
```

**查看前端日志**：
```bash
# 列出所有前端日志文件
ls -la /Users/bill/jarvis/logs/frontend/

# 查看最新日志（按修改时间排序，取最新）
ls -t /Users/bill/jarvis/logs/frontend/*.log | head -1 | xargs tail -100

# 或者直接看最近修改的文件
tail -100 "$(ls -t /Users/bill/jarvis/logs/frontend/*.log | head -1)"
```

**日志格式**：
```
[2026-01-25T14:31:23.128Z] [DEBUG] [Chat] Auto-scroll enabled (distance: 92px)
[2026-01-25T14:31:26.219Z] [DEBUG] [Chat] [DIAG] handleMessage tool_call: tool_name=Read
```

**修改前端代码后**：
1. 更新 `static/index.html` 中对应 JS 文件的版本号（`?v=X` -> `?v=X+1`）
2. 刷新浏览器

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

## MCP Browser 工具使用经验

### Jarvis 页面登录和导航

**登录**:
- 密码在 `.env` 文件: `AUTH_TOKEN=Wandou@28!`
- 输入框选择器: `input`
- 登录按钮: `button`

**页面视图切换**:
- Jarvis 使用左右滑动来切换视图（不是 URL hash）
- 滑动容器：`#swipe-container`
- 视图顺序（左到右，共5个页面）:
  - Index 0: Projects (项目卡片) - `#page-projects`
  - Index 1: All Sessions (所有session卡片) - `#page-all-sessions`
  - Index 2: Files (文件浏览) - `#page-files`
  - Index 3: Monitor (监控) - `#page-monitor`
  - Index 4: Scheduled Tasks (定时任务) - `#page-scheduled-tasks`

**导航方法**:

```javascript
// 方法1: 直接设置 scrollLeft（推荐，最稳定）
const container = document.getElementById('swipe-container');
container.scrollLeft = 400 * pageIndex;  // 每页宽度400px

// 例子：导航到 All Sessions 页面（index 1）
document.getElementById('swipe-container').scrollLeft = 400;

// 例子：导航到 Projects 页面（index 0）
document.getElementById('swipe-container').scrollLeft = 0;

// 方法2: 调用 app 方法（适用于部分已知视图）
window.app?.showView?.('projects');
window.app?.showView?.('files');
```

**Usage 面板**:
- 点击 `.btn-usage`（≡ 按钮）打开/关闭
- 再次点击关闭

### 元素选择器

Jarvis 前端的 CSS 类名和选择器：

| 元素 | 选择器 |
|------|--------|
| 项目卡片 | `.session-item.project-item` |
| 第一个项目 | `.session-item.project-item:first-of-type` |
| Session 列表项（模态框内） | `.claude-session-item` |
| 第一个 Session | `.claude-session-item:first-child` |
| All-Sessions 页面的 session 卡片 | `.session-grid-item` |
| Session 卡片名称 | `.session-grid-name` |
| All-Sessions 网格容器 | `.all-sessions-grid` |
| 聊天状态 | `.connection-status` |
| 发送按钮 | `#sendMessageBtn` |
| 输入框 | `#chatInput` |

**注意**:
- `.project-card` 不存在，用 `.session-item.project-item`
- All-Sessions 页面的卡片类名是 `.session-grid-item`（不是 `.session-card`）

### 查找元素的方法

```javascript
// 先用 evaluate 查看页面结构
const cards = document.querySelectorAll('[class*="project"], [class*="card"]');
Array.from(cards).map(c => ({tag: c.tagName, class: c.className}));

// 查找特定文本的元素
const all = document.querySelectorAll('*');
Array.from(all).filter(e => e.textContent?.includes('Tesla') && e.children.length < 3);
```

### 常见问题和解决方法

1. **点击后没反应**:
   - 元素可能被遮挡，先截图确认状态
   - 检查是否需要点击的是子元素（如 `.claude-session-info` 而不是整个 `.claude-session-item`）

2. **选择器找不到**:
   - 用 `evaluate` 先查看实际的类名
   - 不要猜测选择器，先探索再操作

3. **模态框元素**:
   - 模态框内的元素用 `.modal .xxx` 或直接用 `.claude-session-item`
   - Session 点击进入 chat：`.claude-session-item .claude-session-info`

4. **页面还在加载**:
   - 点击前先 `sleep 2-3` 秒
   - Socket.IO 连接需要等待（看到 "Connected" 才算成功）

5. **evaluate 脚本错误**:
   - **MUST** 包装在 IIFE 中：`(function() { ... })();`
   - 直接 `return` 会报 "Illegal return statement"

6. **服务器重启后 token 失效**:
   - 刷新页面会显示 "Invalid token"
   - 需要重新导航到首页登录

7. **异步操作时序**:
   - 用 `setTimeout` 在 evaluate 中延迟执行
   - 或者分多次 evaluate 调用，中间用 sleep

### MCP Browser 工作流最佳实践

**不要做**（效率低，容易出错）:
```javascript
// ❌ 猜测选择器
puppeteer_click('.project-card');  // 不存在

// ❌ 忘记 IIFE 包装
evaluate('return window.app;');  // Illegal return

// ❌ 连续操作不等待
click('.project'); click('.session');  // 第二个点击会失败
```

**应该做**（探索 → 验证 → 操作）:
```javascript
// ✅ 1. 先探索页面结构
evaluate(`(function() {
  const items = document.querySelectorAll('[class*="project"]');
  return Array.from(items).map(i => i.className);
})()`);

// ✅ 2. 验证选择器
evaluate(`(function() {
  const target = document.querySelector('.session-item.project-item');
  return target ? 'found' : 'not found';
})()`);

// ✅ 3. 操作并等待
click('.session-item.project-item');
sleep(2);
screenshot();  // 确认状态
```

**典型场景模板**:

```javascript
// 导航到 projects 页面
evaluate(`(function() {
  const container = document.getElementById('swipe-container');
  if (container) container.scrollLeft = 0;
  return 'Scrolled to projects';
})()`);
sleep(1);

// 点击项目并打开 session
click('.session-item.project-item:first-child');
sleep(2);  // 等待模态框
click('.claude-session-item:first-child .claude-session-info');
sleep(4);  // 等待 chat 连接
screenshot();  // 验证结果

// 从 All Sessions 页面直接打开 session（更快捷）
evaluate(`(function() {
  document.getElementById('swipe-container').scrollLeft = 400;
  return 'Navigated to All Sessions';
})()`);
sleep(1);

// 点击指定名称的 session
evaluate(`(function() {
  const grid = document.querySelector('.all-sessions-grid');
  const cards = grid.children;
  for (const card of cards) {
    const nameEl = card.querySelector('.session-grid-name');
    if (nameEl && nameEl.textContent.trim() === '周报') {
      card.click();
      return 'Clicked session: 周报';
    }
  }
  return 'Session not found';
})()`);
sleep(4);  // 等待 chat 连接
screenshot();  // 验证结果
```

## 第二个 Session 连接慢问题 - 复现与调试

### 问题描述
- 打开第一个 session 很快连接
- 打开第二个 session 很慢（状态停留在 "Connecting..." 很久）
- 交换顺序后，另一个变慢（问题是位置相关，不是特定 session）

### 复现步骤
1. 打开 http://localhost:8000
2. 点击第一个项目 (jarvis)
3. 点击第一个 session，等待 Connected
4. 点击返回按钮 (.chat-back-btn)
5. 点击第二个项目 (remote)
6. 点击第一个 session
7. 观察连接时间 - 第二个应该也很快

### 测试方法
```bash
# 清空日志
echo "" > /Users/bill/jarvis/logs/app.log

# 测试后检查连接时间
cat /Users/bill/jarvis/logs/app.log | grep "Chat connect"
```

后端时间戳日志格式：
- `Chat connect START`: 开始处理
- `Chat connect T1 get_session`: 获取 session
- `Chat connect T2 session_ready`: session 准备好
- `Chat connect T3 callback_set`: callback 设置完成
- `Chat connect T4 history_loaded`: 历史消息加载完成
- `Chat connect DONE`: 完成（前端收到 ready）

### 检查前端 Socket.IO 传输类型
```javascript
// 在浏览器 console 或 MCP evaluate 执行
if (window.muxWs && window.muxWs.socket) {
  const transport = window.muxWs.socket.io?.engine?.transport?.name;
  console.log('Transport:', transport);  // 应该是 'websocket' 不是 'polling'
}
```

### 关键代码位置
- 前端 Socket.IO 配置: `static/socketio-websocket.js` 第 68-76 行
- 后端处理: `app/services/socketio_connection_manager.py` 的 `_handle_chat_message`

## Skill Evolution

**UPDATE THIS SKILL** when you discover:
- New architecture patterns
- New gotchas or common issues
- Changes to key files or functions
- New debugging techniques
