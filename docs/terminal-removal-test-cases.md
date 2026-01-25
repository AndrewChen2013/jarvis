# Terminal 功能移除 - 测试用例

## 测试环境准备

1. 重启服务器：`python -m uvicorn app.main:app --host 0.0.0.0 --port 8000`
2. 清除浏览器缓存或使用无痕模式
3. 访问 `http://localhost:8000`

---

## 测试用例

### TC-001: 页面加载正常

**步骤：**
1. 打开 `http://localhost:8000`
2. 等待页面完全加载

**预期结果：**
- 页面正常显示项目列表
- 无 JavaScript 错误（控制台无红色错误）
- 无 404 资源加载错误

**验证方法：**
```javascript
// 检查控制台错误
window.onerror === null || console.error count === 0
```

---

### TC-002: 打开 Chat Session

**步骤：**
1. 点击 jarvis 项目（或任意有 session 的项目）
2. 在弹出的 session 列表中点击一个 session
3. 等待连接建立

**预期结果：**
- Session 列表弹窗正常显示
- 点击后进入 Chat 视图
- 显示 "Connected" 状态
- 能看到历史消息（如果有）

**验证方法：**
```javascript
// 检查连接状态
document.querySelector('.chat-status')?.textContent === 'Connected'
// 检查 session manager
window.app?.sessionManager?.sessions?.size >= 1
```

---

### TC-003: 发送消息

**步骤：**
1. 在 Chat 视图中
2. 在输入框输入 "hello"
3. 点击发送按钮或按 Enter

**预期结果：**
- 消息出现在聊天区域
- 显示发送中状态
- 收到 AI 响应（流式显示）

**验证方法：**
```javascript
// 检查消息数量增加
document.querySelectorAll('.chat-message').length > 0
```

---

### TC-004: Minimize 后重新打开 (BUG-003 场景)

**步骤：**
1. 打开一个 Chat session
2. 记录当前 activeId
3. 点击 Minimize 按钮（向下箭头 ∨）
4. 返回项目列表
5. 再次点击同一个 session

**预期结果：**
- activeId 保持不变
- sessions.size 保持为 1
- 悬浮按钮显示 "1"
- 重新打开后聊天历史保留

**验证方法：**
```javascript
// 记录第一次
const firstId = window.app.sessionManager.activeId;
// minimize 后重新打开
const secondId = window.app.sessionManager.activeId;
// 验证
firstId === secondId && window.app.sessionManager.sessions.size === 1
```

---

### TC-005: Close 后重新打开

**步骤：**
1. 打开一个 Chat session
2. 点击 Close 按钮（向左箭头 ←）
3. 检查悬浮按钮
4. 再次打开同一个 session

**预期结果：**
- 关闭后悬浮按钮消失（无后台 session）
- sessions.size 变为 0
- 重新打开后是新的 session（新 ID）

**验证方法：**
```javascript
// 关闭后
window.app.sessionManager.sessions.size === 0
// 悬浮按钮不可见
document.querySelector('.floating-session-btn')?.style.display === 'none'
```

---

### TC-006: 多 Session 并行

**步骤：**
1. 打开第一个 session (jarvis 项目)
2. 点击 Minimize
3. 打开第二个 session (不同项目或不同 session)
4. 点击悬浮按钮切换回第一个

**预期结果：**
- 两个 session 都能正常工作
- 悬浮按钮显示正确数量
- 切换后各自的聊天历史保留

**验证方法：**
```javascript
window.app.sessionManager.sessions.size === 2
```

---

### TC-007: 页面刷新后恢复

**步骤：**
1. 打开一个 Chat session
2. 发送一条消息
3. 刷新页面
4. 重新打开同一个 session

**预期结果：**
- 页面刷新后能正常加载
- 重新打开 session 能连接成功
- 历史消息从服务器加载

---

### TC-008: 无 Terminal 相关错误

**步骤：**
1. 打开浏览器开发者工具
2. 切换到 Console 标签
3. 执行所有上述测试

**预期结果：**
- 无 "terminal" 相关的错误
- 无 "xterm" 相关的错误
- 无 "undefined" 相关的错误

**验证方法：**
```javascript
// 在控制台检查
typeof window.Terminal === 'undefined'  // Terminal 类不应存在
typeof window.xterm === 'undefined'     // xterm 不应存在
```

---

### TC-009: UI 完整性检查

**步骤：**
1. 检查主页面布局
2. 检查 Chat 视图布局

**预期结果：**
- 主页面：项目列表正常显示，无空白区域
- Chat 视图：工具栏、消息区域、输入框正常显示
- 无 "Terminal" 相关的按钮或选项

---

### TC-010: 后端 API 检查

**步骤：**
1. 检查 `/ws/terminal/` 路由不存在
2. 检查 Chat API 正常工作

**预期结果：**
- Terminal WebSocket 路由返回 404
- Chat 功能正常

**验证方法：**
```bash
# Terminal 路由不存在
curl -I http://localhost:8000/ws/terminal/test/test
# 应返回 404 或 400
```

---

## 自动化测试脚本

以下是在浏览器中执行的自动化测试：

```javascript
async function runTests() {
  const results = {};

  // TC-001: 页面加载
  results['TC-001'] = {
    name: '页面加载正常',
    pass: document.querySelector('.project-item') !== null
  };

  // TC-008: 无 Terminal 错误
  results['TC-008'] = {
    name: '无 Terminal 相关错误',
    pass: typeof window.Terminal === 'undefined' &&
          typeof window.TerminalWrapper === 'undefined'
  };

  // 输出结果
  console.table(results);
  return results;
}

runTests();
```

---

## 测试执行记录

| 测试用例 | 状态 | 备注 |
|---------|------|------|
| TC-001 | 待测 | |
| TC-002 | 待测 | |
| TC-003 | 待测 | |
| TC-004 | 待测 | |
| TC-005 | 待测 | |
| TC-006 | 待测 | |
| TC-007 | 待测 | |
| TC-008 | 待测 | |
| TC-009 | 待测 | |
| TC-010 | 待测 | |
