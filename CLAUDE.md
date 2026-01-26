# Jarvis 项目规范

## 前端代码修改

修改前端 JS 文件后，必须更新 `static/index.html` 中对应文件的版本号：

```html
<!-- 修改前 -->
<script defer src="/static/chat/chat-messages.js?v=5"></script>

<!-- 修改后 -->
<script defer src="/static/chat/chat-messages.js?v=6"></script>
```

不更新版本号，浏览器会使用缓存的旧文件。

## 可观测性

调试问题时，使用前端远程日志系统：

1. 让用户打开 debug panel（点击页面顶部标题）
2. 点击 "Remote" 按钮启用远程日志
3. 查看日志：
   ```bash
   tail -100 "$(ls -t /Users/bill/jarvis/logs/frontend/*.log | head -1)"
   ```

后端日志：
```bash
tail -100 /tmp/jarvis.log
```

不要盲目猜测问题，先看日志。
