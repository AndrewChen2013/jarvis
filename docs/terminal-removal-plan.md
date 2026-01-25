# Terminal 功能移除计划

## Linus 风格评价

### 这个多 Session 问题

操你妈的，这个 BUG-003 问题说白了就是一个典型的 **ID 类型混乱** 问题。你们有三种 ID：

1. **Claude CLI Session ID** - 用户从列表点击传入的
2. **Terminal Session ID** - 服务端创建返回的
3. **Chat Claude Session ID** - Chat 用的

然后你们用 Terminal Session ID 作为 Map 的 key，却用 Claude CLI Session ID 去查找，当然他妈的找不到。这种问题在设计阶段就应该想清楚：**一个 session 应该只有一个 canonical ID**。

现在的修复是在 `connectTerminal()` 里遍历查找 `chatClaudeSessionId`，这是 O(n) 的操作。虽然 session 数量不会很多，但这种设计本身就是 smell。正确的做法是维护一个 `chatClaudeSessionId -> terminalSessionId` 的索引映射。

### 代码架构问题

1. **websocket.js 1937 行** - 这他妈是一个文件该有的大小吗？Terminal 和 Chat 的逻辑全混在一起。

2. **全局变量满天飞** - `window.app`、`window.muxWs`、`window.terminal`，这不是 2010 年的代码风格吗？

3. **注释比代码多** - 一堆 `// BUG-003 FIX`、`// BUG-004 FIX`，说明你们在 patch on patch，而不是重新设计。

### 但是也有优点

1. 多路复用设计是对的 - 单一 WebSocket 连接处理多个 session
2. Idempotency 检查 - 防止重复消息处理
3. 详细的日志 - 便于调试

---

## Terminal 功能移除详细清单

### 一、可以完全删除的文件

#### 前端文件 (4个)

| 文件 | 行数 | 说明 |
|------|------|------|
| `static/terminal.js` | 476 | xterm.js 终端渲染包装器 |
| `static/ssh-terminal.js` | ~200 | SSH 终端 |
| `static/ssh-session-manager.js` | ~300 | SSH 会话管理 |
| `static/ssh-floating-button.js` | ~150 | SSH 悬浮按钮 |

#### 后端文件 (2个)

| 文件 | 行数 | 说明 |
|------|------|------|
| `app/api/terminal.py` | 349 | Terminal WebSocket API |
| `app/services/terminal_manager.py` | ~200 | PTY 进程管理 |

---

### 二、需要修改的文件

#### 2.1 static/index.html

**删除以下 script 引入：**

```html
<!-- 删除 xterm.js 相关 -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css">
<script defer src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/xterm-addon-webgl@0.16.0/lib/xterm-addon-webgl.js"></script>
<script defer src="/static/terminal.js?v=12"></script>

<!-- 删除 SSH 相关 -->
<script defer src="/static/ssh-floating-button.js?v=14"></script>
<script defer src="/static/ssh-session-manager.js?v=10"></script>
<script defer src="/static/ssh-terminal.js?v=5"></script>
```

**删除以下 HTML 块：**

```html
<!-- 删除 terminal-view (约120行，从 line 602 到 723) -->
<div id="terminal-view" class="view">
  <!-- 工具栏 -->
  <header class="toolbar">...</header>
  <!-- 悬浮字体控制 -->
  <div class="font-controls-float">...</div>
  <!-- Context 信息条 -->
  <div id="context-bar">...</div>
  <!-- 帮助面板 -->
  <div id="help-panel">...</div>
  <!-- 终端输出区域 -->
  <div id="terminal-output" class="terminal-container"></div>
  <!-- 底部输入栏 -->
  <div class="bottom-input-bar">...</div>
</div>

<!-- 删除 ssh-terminal-view (约25行，从 line 726 到 750) -->
<div id="ssh-terminal-view" class="view">
  ...
</div>
```

#### 2.2 static/websocket.js

**删除以下方法/代码块：**

| 方法/代码 | 行号范围 | 说明 |
|----------|---------|------|
| `initTerminal()` | ~180-250 | 初始化 xterm.js |
| `sendTerminalInput(data)` | ~400-420 | 发送终端输入 |
| `sendTerminalResize(rows, cols)` | ~420-440 | 发送 resize |
| `handleMessage()` 中 Terminal 部分 | ~500-600 | 处理 terminal 消息 |
| `connectWebSocket()` | ~700-850 | 旧版 WebSocket 连接 |
| Terminal 相关变量 | 文件开头 | `this.terminal`, `this.fitAddon` 等 |

**保留的部分：**
- `connectTerminal()` - 简化为只处理 Chat
- `connectWebSocketMux()` - 保留，只处理 Chat 消息
- Session 管理相关代码

#### 2.3 static/session-manager.js

**删除以下属性/方法：**

| 属性/方法 | 说明 |
|----------|------|
| `session.terminal` | SessionInstance 中的 terminal 属性 |
| `session.container` | Terminal DOM 容器 |
| `session.fontSize` | Terminal 字体大小 |
| `session.theme` | Terminal 主题 |
| `session.outputQueue` | Terminal 输出队列 |
| `createContainer()` | 创建 Terminal 容器的方法 |
| `showSession()` 中 Terminal 部分 | 显示 Terminal 容器 |
| `hideSession()` 中 Terminal 部分 | 隐藏 Terminal 容器 |

**修改 SessionInstance 类：**
```javascript
// 移除前
class SessionInstance {
  constructor(id, name) {
    this.terminal = null;
    this.container = null;
    this.chatContainer = null;
    this.fontSize = null;
    this.theme = null;
    this.outputQueue = [];
    // ...
  }
}

// 移除后
class SessionInstance {
  constructor(id, name) {
    this.chatContainer = null;
    this.chatMessages = [];
    // ...
  }
}
```

#### 2.4 static/mux-websocket.js

**删除以下方法：**

| 方法 | 行号范围 | 说明 |
|------|---------|------|
| `connectTerminal()` | ~390-435 | Terminal 连接 |
| `disconnectTerminal()` | ~435-455 | Terminal 断开 |
| `closeTerminal()` | ~455-475 | Terminal 关闭 |
| `terminalInput()` | ~475-495 | Terminal 输入 |
| `terminalResize()` | ~495-515 | Terminal resize |
| `_handleTerminalMessage()` | ~600-700 | Terminal 消息处理 |

**删除以下常量：**
```javascript
// 消息类型常量
const MT_TERM_CONNECTED = 0;
const MT_TERM_OUTPUT = 1;
const MT_TERM_ERROR = 2;
const MT_TERM_CLOSED = 3;
```

#### 2.5 static/app.js

**删除以下方法/代码：**

| 方法 | 说明 |
|------|------|
| `switchToTerminal()` | 切换到 Terminal 视图 |
| `showTerminalView()` | 显示 Terminal 视图 |
| `hideTerminalView()` | 隐藏 Terminal 视图 |
| Terminal 快捷键绑定 | 特殊按键处理 |
| Terminal 输入处理 | input 事件监听 |

#### 2.6 static/floating-button.js

**可以完全删除或大幅简化：**

悬浮按钮主要用于 Terminal session 切换。如果只有 Chat，可以简化为只显示后台 session 数量。

#### 2.7 static/history.js

**可以删除或简化：**

主要用于 Terminal 历史记录弹窗，Chat 不需要。

#### 2.8 app/services/mux_connection_manager.py

**删除以下方法：**

| 方法 | 行号范围 | 说明 |
|------|---------|------|
| `_handle_terminal_message()` | ~400-550 | Terminal 消息处理 |
| `terminal_output_callback()` | ~550-600 | Terminal 输出回调 |
| Terminal 相关变量 | 类属性 | `self.terminal_callbacks` 等 |

**修改 `route_message()`：**
```python
# 移除前
async def route_message(self, client_id: str, message: dict):
    channel = message.get("c", message.get("channel"))
    if channel == 0:  # terminal
        await self._handle_terminal_message(...)
    elif channel == 1:  # chat
        await self._handle_chat_message(...)

# 移除后
async def route_message(self, client_id: str, message: dict):
    # 只处理 chat 消息
    await self._handle_chat_message(...)
```

#### 2.9 app/main.py 或路由文件

**删除 Terminal 路由：**
```python
# 删除
@app.websocket("/ws/terminal/{working_dir:path}/{session_id}")
async def terminal_websocket(websocket: WebSocket, ...):
    ...
```

---

### 三、CSS 清理

#### static/styles.css

删除以下 CSS 类/选择器：

```css
/* Terminal 视图相关 */
#terminal-view { ... }
.terminal-container { ... }
.toolbar { ... }
.font-controls-float { ... }
.context-bar { ... }
.bottom-input-bar { ... }
.special-keys { ... }
.more-keys-panel { ... }

/* SSH Terminal 相关 */
#ssh-terminal-view { ... }
.ssh-toolbar { ... }
.ssh-terminal-container { ... }
```

---

### 四、移除顺序建议

**Phase 1: 删除独立文件**
1. 删除 `static/terminal.js`
2. 删除 `static/ssh-*.js` (3个文件)
3. 删除 `app/api/terminal.py`
4. 删除 `app/services/terminal_manager.py`

**Phase 2: 清理 HTML**
1. 删除 index.html 中的 xterm.js 引入
2. 删除 `#terminal-view` 整个 div
3. 删除 `#ssh-terminal-view` 整个 div

**Phase 3: 清理 JavaScript**
1. 简化 `websocket.js` - 删除所有 Terminal 方法
2. 简化 `mux-websocket.js` - 删除 Terminal 通道
3. 简化 `session-manager.js` - 删除 Terminal 属性
4. 简化 `app.js` - 删除 Terminal 视图切换

**Phase 4: 清理后端**
1. 修改 `mux_connection_manager.py` - 删除 Terminal 处理
2. 删除 Terminal 路由
3. 清理数据库相关（如果有 Terminal 历史存储）

**Phase 5: 清理 CSS**
1. 删除所有 Terminal 相关样式

---

### 五、风险点

1. **Session Manager 依赖** - 确保移除 Terminal 属性后，Chat 相关逻辑不受影响
2. **WebSocket 消息路由** - 确保只处理 Chat 消息不会导致异常
3. **悬浮按钮** - 需要确认是否保留，以及如何适配纯 Chat 模式
4. **历史记录** - 如果 Chat 也需要历史记录，需要保留相关基础设施

---

### 六、验证清单

移除后需要验证：

- [ ] 打开 Chat session 正常工作
- [ ] 发送消息正常
- [ ] 接收消息正常（流式）
- [ ] Minimize 后重新打开正常（BUG-003 场景）
- [ ] 关闭 session 后悬浮按钮消失
- [ ] 页面刷新后重新连接正常
- [ ] 多个 Chat session 并行正常
- [ ] 无 JS 错误
- [ ] 无 Python 错误

---

### 七、总代码量估计

| 类别 | 删除行数 |
|------|---------|
| 前端 JS | ~2000 行 |
| HTML | ~150 行 |
| CSS | ~300 行 |
| 后端 Python | ~600 行 |
| **总计** | **~3000 行** |

移除后代码库将更加精简，专注于 Chat 功能。
