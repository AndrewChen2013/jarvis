/**
 * Claude Remote - 主应用
 */
class App {
  constructor() {
    this.token = 'your-secret-token-change-me';
    this.currentSession = null;
    this.ws = null;
    this.terminal = null;
    this.isComposing = false; // 中文输入法状态
    this.selectedWorkDir = null; // 选中的工作目录
    this.currentBrowsePath = null; // 当前浏览路径
    this.parentPath = null; // 父目录路径
    this.reconnectAttempts = 0; // 重连尝试次数
    this.maxReconnectAttempts = 5; // 最大重连次数
    this.reconnectTimeout = null; // 重连定时器
    this.shouldReconnect = false; // 是否应该重连
    this.isConnecting = false; // 连接锁，防止并发连接
    this.outputQueue = []; // 输出消息队列（终端未就绪时缓存）
    this.currentSessionName = ''; // 当前会话名称

    this.init();
  }

  init() {
    // 加载会话列表
    this.loadSessions();

    // 绑定事件
    this.bindEvents();

    // 监听页面可见性变化（iOS Safari 挂起/恢复）
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.debugLog('页面隐藏');
      } else {
        this.debugLog('页面恢复可见');
        // 检查连接状态
        if (this.currentSession && this.ws) {
          this.debugLog('当前连接状态: state=' + this.ws.readyState);
        }
        // 如果连接已断开且应该重连
        if (this.currentSession && this.shouldReconnect && !this.isConnecting) {
          if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
            this.debugLog('页面恢复触发重连');
            this.attemptReconnect();
          }
        }
      }
    });

    // 调试：捕获页面离开事件
    window.addEventListener('beforeunload', (e) => {
      console.log('beforeunload triggered!');
      // 在开发阶段，如果有活动连接，阻止页面离开以便调试
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.log('WARNING: Page unloading with active WebSocket!');
      }
    });

    // 调试：捕获页面卸载
    window.addEventListener('pagehide', (e) => {
      console.log('pagehide event, persisted:', e.persisted);
    });
  }

  bindEvents() {
    // 创建会话按钮 - 打开模态框
    document.getElementById('create-session').addEventListener('click', () => {
      this.openCreateModal();
    });

    // 关闭模态框
    document.getElementById('modal-close').addEventListener('click', () => {
      this.closeCreateModal();
    });

    // 点击模态框背景关闭
    document.getElementById('create-modal').addEventListener('click', (e) => {
      if (e.target.id === 'create-modal') {
        this.closeCreateModal();
      }
    });

    // 更改工作目录
    document.getElementById('change-workdir').addEventListener('click', () => {
      this.showStep('workdir');
    });

    // 目录浏览器 - 返回上级
    document.getElementById('go-parent').addEventListener('click', () => {
      if (this.parentPath) {
        this.browseDirectory(this.parentPath);
      }
    });

    // 目录浏览器 - 选择当前目录
    document.getElementById('select-current').addEventListener('click', () => {
      if (this.currentBrowsePath) {
        this.selectWorkDir(this.currentBrowsePath);
      }
    });

    // 创建新会话
    document.getElementById('create-new-session').addEventListener('click', () => {
      this.createSession(this.selectedWorkDir, null);
    });

    // 发送按钮
    document.getElementById('send-btn').addEventListener('click', () => {
      this.sendInput();
    });

    // input 事件在 showView 中动态绑定

    // 虚拟按键
    document.querySelectorAll('.key-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        console.log('Key pressed:', key);
        this.sendKey(key);
      });
    });

    // 字体大小调整
    document.getElementById('font-decrease').addEventListener('click', () => {
      this.adjustFontSize(-1);
    });

    document.getElementById('font-increase').addEventListener('click', () => {
      this.adjustFontSize(1);
    });

    // 返回按钮
    document.getElementById('back-btn').addEventListener('click', () => {
      this.disconnect();
      this.showView('sessions');
    });

  }

  // ==================== 模态框操作 ====================

  /**
   * 打开创建会话模态框
   */
  async openCreateModal() {
    document.getElementById('create-modal').classList.add('active');
    this.showStep('workdir');
    await Promise.all([
      this.loadWorkingDirs(),
      this.browseDirectory(null)  // 从用户主目录开始
    ]);
  }

  /**
   * 关闭创建会话模态框
   */
  closeCreateModal() {
    document.getElementById('create-modal').classList.remove('active');
    this.selectedWorkDir = null;
  }

  /**
   * 显示步骤
   */
  showStep(step) {
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    document.getElementById(`step-${step}`).classList.add('active');

    if (step === 'workdir') {
      document.getElementById('modal-title').textContent = '新建会话';
    } else if (step === 'session') {
      document.getElementById('modal-title').textContent = '选择会话';
    }
  }

  /**
   * 加载工作目录列表
   */
  async loadWorkingDirs() {
    const container = document.getElementById('workdir-list');
    container.innerHTML = '<div class="loading">加载中...</div>';

    try {
      const response = await fetch('/api/claude/working-dirs', {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (!response.ok) throw new Error('Failed to load working dirs');

      const data = await response.json();
      const dirs = data.working_dirs || [];

      if (dirs.length === 0) {
        container.innerHTML = '<div class="no-sessions">暂无工作目录记录</div>';
        return;
      }

      container.innerHTML = '';
      dirs.forEach(dir => {
        const item = document.createElement('div');
        item.className = 'workdir-item';
        item.textContent = dir;
        item.addEventListener('click', () => {
          this.selectWorkDir(dir);
        });
        container.appendChild(item);
      });
    } catch (error) {
      console.error('Load working dirs error:', error);
      container.innerHTML = '<div class="no-sessions">加载失败</div>';
    }
  }

  /**
   * 浏览目录
   */
  async browseDirectory(path) {
    const container = document.getElementById('dir-list');
    container.innerHTML = '<div class="loading">加载中...</div>';

    try {
      const url = path
        ? `/api/browse?path=${encodeURIComponent(path)}`
        : '/api/browse';

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (!response.ok) throw new Error('Failed to browse directory');

      const data = await response.json();

      // 更新当前路径
      this.currentBrowsePath = data.current;
      this.parentPath = data.parent;
      document.getElementById('current-path-text').textContent = data.current;

      // 更新上级按钮状态
      document.getElementById('go-parent').disabled = !data.parent;

      const dirs = data.dirs || [];

      if (dirs.length === 0) {
        container.innerHTML = '<div class="no-sessions">无子目录</div>';
        return;
      }

      container.innerHTML = '';
      dirs.forEach(dir => {
        const item = document.createElement('div');
        item.className = 'dir-item';
        item.textContent = dir.name;
        item.addEventListener('click', () => {
          this.browseDirectory(dir.path);
        });
        container.appendChild(item);
      });
    } catch (error) {
      console.error('Browse directory error:', error);
      container.innerHTML = '<div class="no-sessions">加载失败</div>';
    }
  }

  /**
   * 选择工作目录
   */
  async selectWorkDir(workDir) {
    this.selectedWorkDir = workDir;
    document.getElementById('selected-workdir-text').textContent = workDir;
    this.showStep('session');
    await this.loadClaudeSessions(workDir);
  }

  /**
   * 加载 Claude 会话列表
   */
  async loadClaudeSessions(workDir) {
    const container = document.getElementById('claude-sessions');
    container.innerHTML = '<div class="loading">加载中...</div>';

    try {
      const response = await fetch(`/api/claude/sessions?working_dir=${encodeURIComponent(workDir)}`, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (!response.ok) throw new Error('Failed to load Claude sessions');

      const data = await response.json();
      const sessions = data.sessions || [];

      if (sessions.length === 0) {
        container.innerHTML = '<div class="no-sessions">该目录暂无 Claude 会话历史</div>';
        return;
      }

      container.innerHTML = '';
      sessions.forEach(session => {
        const item = document.createElement('div');
        item.className = 'claude-session-item';
        item.innerHTML = `
          <div class="claude-session-name">${this.escapeHtml(session.name || '未命名会话')}</div>
          <div class="claude-session-meta">
            <span class="claude-session-id">${session.session_id.substring(0, 8)}...</span>
            <span>${this.formatTime(session.updated_at)}</span>
          </div>
        `;
        item.addEventListener('click', () => {
          this.createSession(workDir, session.session_id);
        });
        container.appendChild(item);
      });
    } catch (error) {
      console.error('Load Claude sessions error:', error);
      container.innerHTML = '<div class="no-sessions">加载失败</div>';
    }
  }

  // ==================== 会话管理 ====================

  /**
   * 加载会话列表
   */
  async loadSessions() {
    try {
      const response = await fetch('/api/sessions', {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (!response.ok) throw new Error('Failed to load sessions');

      const sessions = await response.json();
      this.renderSessions(sessions);
    } catch (error) {
      console.error('Load sessions error:', error);
      this.showError('加载会话列表失败');
    }
  }

  /**
   * 渲染会话列表
   */
  renderSessions(sessions) {
    const container = document.getElementById('sessions-list');
    container.innerHTML = '';

    if (sessions.length === 0) {
      container.innerHTML = `
        <div class="empty">
          <div class="empty-icon">📱</div>
          <div class="empty-text">暂无会话</div>
          <div class="empty-hint">点击右上角 + 创建新会话</div>
        </div>
      `;
      return;
    }

    sessions.forEach(session => {
      const item = document.createElement('div');
      item.className = `session-item status-${session.status}`;

      // 显示名称，如果没有则显示工作目录的最后一级
      const displayName = session.name || this.getLastPathComponent(session.working_dir);

      // 简化工作目录显示
      const shortPath = this.shortenPath(session.working_dir);

      // 描述（如果有）
      const descHtml = session.description
        ? `<div class="session-desc">${this.escapeHtml(session.description)}</div>`
        : '';

      item.innerHTML = `
        <div class="session-name">${this.escapeHtml(displayName)}</div>
        ${descHtml}
        <div class="session-workdir">${this.escapeHtml(shortPath)}</div>
        <div class="session-footer">
          <div class="session-meta">
            <span class="session-status ${session.status}">${this.getStatusText(session.status)}</span>
            <span class="session-time">${this.formatTime(session.last_active)}</span>
          </div>
          <div class="session-actions">
            <button class="btn-rename" data-id="${session.id}">重命名</button>
            <button class="btn-delete" data-id="${session.id}">删除</button>
          </div>
        </div>
      `;

      // 点击卡片连接
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // 如果点击的是按钮，不触发连接
        if (e.target.classList.contains('btn-delete') || e.target.classList.contains('btn-rename')) return;
        this.debugLog('卡片点击: ' + session.id);
        this.connectSession(session.id, displayName);
      });

      // 重命名按钮
      item.querySelector('.btn-rename').addEventListener('click', (e) => {
        e.stopPropagation();
        this.renameSession(session.id, displayName);
      });

      // 删除按钮
      item.querySelector('.btn-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteSession(session.id);
      });

      container.appendChild(item);
    });
  }

  /**
   * 简化路径显示
   */
  shortenPath(path) {
    if (!path) return '';
    // 替换用户目录为 ~
    const home = '/Users/bill';
    if (path.startsWith(home)) {
      return '~' + path.substring(home.length);
    }
    return path;
  }

  /**
   * 获取状态文本
   */
  getStatusText(status) {
    const statusMap = {
      'active': '运行中',
      'idle': '空闲',
      'stopped': '已停止'
    };
    return statusMap[status] || status;
  }

  /**
   * 创建会话
   */
  async createSession(workDir, claudeSessionId) {
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({
          working_dir: workDir,
          claude_session_id: claudeSessionId,
          name: null  // 让 Claude 自动命名
        })
      });

      if (!response.ok) throw new Error('Failed to create session');

      const session = await response.json();
      this.closeCreateModal();
      const sessionName = session.name || this.getLastPathComponent(workDir);
      this.connectSession(session.id, sessionName);
    } catch (error) {
      console.error('Create session error:', error);
      this.showError('创建会话失败');
    }
  }

  /**
   * 连接会话
   */
  async connectSession(sessionId, sessionName = '') {
    this.debugLog('connectSession: ' + sessionId + ', 锁=' + this.isConnecting + ', ws=' + (this.ws ? this.ws.readyState : 'null'));

    // 保存会话名称
    this.currentSessionName = sessionName || sessionId.substring(0, 8);

    // 连接锁：防止并发连接
    if (this.isConnecting) {
      this.debugLog('正在连接中(锁)，跳过');
      return;
    }

    // 防止重复连接（包括正在连接中的状态）
    if (this.currentSession === sessionId && this.ws) {
      const state = this.ws.readyState;
      if (state === WebSocket.CONNECTING || state === WebSocket.OPEN) {
        this.debugLog('已在连接中(ws)，跳过');
        return;
      }
    }

    // 设置连接锁
    this.isConnecting = true;
    this.debugLog('设置连接锁');

    if (this.ws) {
      this.debugLog('关闭旧连接');
      this.shouldReconnect = false;  // 禁用自动重连
      this.ws.close();
      this.ws = null;
    }

    this.currentSession = sessionId;
    this.outputQueue = [];
    this.terminal = null;

    // 测试：先创建 WebSocket，不切换视图
    this.debugLog('先创建WebSocket（不切换视图）');
    this.connect(sessionId);
    this.debugLog('connectSession完成');
  }

  /**
   * 显示终端视图并初始化状态显示
   */
  showTerminalView() {
    this.debugLog('showTerminalView 开始');
    this.showView('terminal');
    this.debugLog('showView 完成');

    // 设置终端标题为会话名称
    const titleEl = document.getElementById('terminal-title');
    if (titleEl && this.currentSessionName) {
      titleEl.textContent = this.currentSessionName;
    }

    const terminalContainer = document.getElementById('terminal-output');
    this.debugLog('获取容器');
    terminalContainer.innerHTML = `
      <div id="connect-status" class="connect-status">
        <div class="connect-spinner"></div>
        <div class="connect-text">正在连接...</div>
        <div class="connect-detail">准备中</div>
      </div>
    `;
    this.debugLog('showTerminalView 完成');
  }

  /**
   * 在页面上显示调试日志
   */
  debugLog(msg) {
    const now = new Date();
    const time = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    const logLine = `[${time}] ${msg}`;

    console.log('[Debug] ' + msg);
    if (!this.debugLogs) this.debugLogs = [];
    this.debugLogs.push(logLine);

    // 更新日志面板内容
    const content = document.getElementById('debug-log-content');
    if (content) {
      content.innerHTML += logLine + '<br>';
      content.scrollTop = content.scrollHeight;
    }
  }

  /**
   * 初始化调试面板
   */
  initDebugPanel() {
    if (document.getElementById('debug-panel')) return;

    // 创建面板
    const panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;bottom:60px;background:rgba(0,0,0,0.95);z-index:9998;flex-direction:column;';

    // 标题栏
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:10px;border-bottom:1px solid #333;';
    header.innerHTML = '<span style="color:#0f0;font-weight:bold;">调试日志</span>';

    // 按钮组
    const btnGroup = document.createElement('div');

    // 复制按钮
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '复制';
    copyBtn.style.cssText = 'padding:5px 15px;margin-right:10px;background:#333;color:#fff;border:none;border-radius:4px;';
    copyBtn.onclick = () => {
      const text = (window.app?.debugLogs || []).join('\n');
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      copyBtn.textContent = '已复制!';
      setTimeout(() => copyBtn.textContent = '复制', 1000);
    };

    // 清除按钮
    const clearBtn = document.createElement('button');
    clearBtn.textContent = '清除';
    clearBtn.style.cssText = 'padding:5px 15px;margin-right:10px;background:#333;color:#fff;border:none;border-radius:4px;';
    clearBtn.onclick = () => {
      this.debugLogs = [];
      const content = document.getElementById('debug-log-content');
      if (content) content.innerHTML = '';
    };

    // 关闭按钮
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText = 'padding:5px 15px;background:#c00;color:#fff;border:none;border-radius:4px;';
    closeBtn.onclick = () => this.toggleDebugPanel();

    btnGroup.appendChild(copyBtn);
    btnGroup.appendChild(clearBtn);
    btnGroup.appendChild(closeBtn);
    header.appendChild(btnGroup);

    // 日志内容区
    const content = document.createElement('div');
    content.id = 'debug-log-content';
    content.style.cssText = 'flex:1;overflow:auto;padding:10px;color:#0f0;font-size:12px;font-family:monospace;';

    panel.appendChild(header);
    panel.appendChild(content);
    document.body.appendChild(panel);

    // 回填已有日志
    if (this.debugLogs && this.debugLogs.length > 0) {
      content.innerHTML = this.debugLogs.join('<br>');
    }
  }

  /**
   * 切换调试面板显示
   */
  toggleDebugPanel() {
    this.initDebugPanel();
    const panel = document.getElementById('debug-panel');
    if (panel) {
      const isVisible = panel.style.display === 'flex';
      panel.style.display = isVisible ? 'none' : 'flex';
    }
  }

  /**
   * 更新连接状态显示
   */
  updateConnectStatus(text, detail) {
    const statusEl = document.getElementById('connect-status');
    if (statusEl) {
      const textEl = statusEl.querySelector('.connect-text');
      const detailEl = statusEl.querySelector('.connect-detail');
      if (textEl) textEl.textContent = text;
      if (detailEl) detailEl.textContent = detail;

      // 如果是超时或错误，显示重试按钮
      if (text === '连接超时' || text === '连接错误') {
        let retryBtn = statusEl.querySelector('.retry-btn');
        if (!retryBtn) {
          retryBtn = document.createElement('button');
          retryBtn.className = 'retry-btn';
          retryBtn.textContent = '点击重试';
          retryBtn.style.cssText = 'margin-top:15px;padding:12px 30px;font-size:16px;background:#007aff;color:#fff;border:none;border-radius:8px;cursor:pointer;';
          retryBtn.onclick = () => {
            this.debugLog('用户点击重试按钮');
            this.manualRetryConnect();
          };
          statusEl.appendChild(retryBtn);
        }
      }
    }
  }

  /**
   * 手动重试连接（用户点击触发，不经过延迟）
   */
  manualRetryConnect() {
    if (!this.currentSession) return;

    this.debugLog('手动重试: 直接创建 WebSocket');
    this.updateConnectStatus('正在连接...', '手动重试中');

    // 清理旧连接
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/${this.currentSession}?token=${this.token}`;

    // 直接在点击事件中创建 WebSocket（不使用任何延迟）
    try {
      this.ws = new WebSocket(wsUrl);
      this.debugLog('手动重试: WebSocket 创建成功, state=' + this.ws.readyState);
      this.isConnecting = true;
      this.setupWebSocketHandlers(this.currentSession);
    } catch (e) {
      this.debugLog('手动重试: 创建失败 ' + e.message);
      this.updateConnectStatus('连接失败', e.message);
    }
  }

  /**
   * 初始化终端（在 WebSocket 连接成功后调用）
   */
  initTerminal() {
    this.debugLog('initTerminal 开始');
    console.log('initTerminal called, terminal exists:', !!this.terminal);

    // 如果终端已存在，不重复初始化
    if (this.terminal) {
      console.log('Terminal already exists, skipping init');
      this.flushOutputQueue();
      return;
    }

    const terminalContainer = document.getElementById('terminal-output');
    if (!terminalContainer) {
      console.error('Terminal container not found');
      return;
    }

    // 清空状态显示
    terminalContainer.innerHTML = '';

    try {
      console.log('Creating new Terminal instance...');
      this.terminal = new Terminal(terminalContainer, () => {
        // 终端就绪后，刷新队列中的输出
        console.log('Terminal ready callback, flushing queue...');
        this.flushOutputQueue();
      });
      console.log('Terminal created successfully');
    } catch (error) {
      console.error('Terminal init error:', error);
      terminalContainer.innerHTML = '<div style="color:red;padding:20px;">终端初始化失败: ' + error.message + '</div>';
    }
  }

  /**
   * 刷新输出队列
   */
  flushOutputQueue() {
    if (this.outputQueue.length > 0 && this.terminal) {
      console.log('Flushing output queue:', this.outputQueue.length, 'items');
      const combined = this.outputQueue.join('');
      this.outputQueue = [];
      try {
        this.terminal.write(combined);
      } catch (error) {
        console.error('Flush queue error:', error);
      }
    }
  }

  /**
   * 连接 WebSocket
   *
   * 【iOS 26 Safari WebSocket Bug 说明】
   * 在 iOS 26 beta 的 Safari 中，WebSocket 连接本地网络地址时会永久卡在 CONNECTING 状态，
   * onopen/onerror/onclose 回调都不触发。奇怪的是，切换到其他 App 再切回来时连接会突然成功。
   *
   * 解决方案：二次连接法
   * 1. 第一次创建 WebSocket，它会卡住但能"激活"网络栈
   * 2. 等待 1 秒后检查状态，如果仍在 CONNECTING，关闭第一个连接
   * 3. 创建第二个 WebSocket，这次能正常连接
   *
   * 详细记录见: ~/.claude/skills/claude-remote-info/skill.md
   */
  connect(sessionId) {
    this.debugLog('connect() 开始');
    this.reconnectAttempts = 0;

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/${sessionId}?token=${this.token}`;
    this.debugLog('WebSocket URL: ' + wsUrl.substring(0, 60));

    // ====== iOS 26 Safari Workaround: 二次连接法 ======
    // 第一次连接：可能会卡在 CONNECTING，但能激活网络栈
    this.debugLog('第一次创建 WebSocket');
    try {
      this.ws = new WebSocket(wsUrl);
      this.debugLog('第一次创建成功, state=' + this.ws.readyState);
    } catch (e) {
      this.debugLog('第一次创建失败: ' + e.message);
    }

    // 1 秒后检查：如果仍卡在 CONNECTING，关闭并创建第二个连接
    setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
        this.debugLog('第一次连接仍在 CONNECTING，关闭并重试');
        try { this.ws.close(); } catch (e) {}
        this.ws = null;

        // 第二次连接：此时网络栈已激活，连接应该能成功
        this.debugLog('第二次创建 WebSocket');
        try {
          this.ws = new WebSocket(wsUrl);
          this.debugLog('第二次创建成功, state=' + this.ws.readyState);
          // 重新绑定事件到新的 WebSocket 实例
          this.bindWebSocketEvents(sessionId);
        } catch (e) {
          this.debugLog('第二次创建失败: ' + e.message);
          this.isConnecting = false;
          this.updateConnectStatus('连接失败', e.message);
        }
      } else {
        // 第一次连接成功（非 iOS 26 Safari，或已修复）
        this.debugLog('第一次连接状态: ' + (this.ws ? this.ws.readyState : 'null'));
      }
    }, 1000);
    // ====== End iOS 26 Workaround ======

    // 绑定事件到第一个 WebSocket 实例
    this.bindWebSocketEvents(sessionId);
  }

  /**
   * 绑定 WebSocket 事件
   */
  bindWebSocketEvents(sessionId) {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.debugLog('onopen 触发');
      this.isConnecting = false;
      this.shouldReconnect = true;
      this.reconnectAttempts = 0;
      // 连接成功后再切换视图
      this.debugLog('连接成功，切换到终端视图');
      this.showTerminalView();
      this.updateConnectStatus('已连接', 'WebSocket已连接');
    };

    this.ws.onmessage = (event) => {
      this.debugLog('onmessage: ' + event.data.substring(0, 50));
      this.handleMessage(event.data);
    };

    this.ws.onerror = (error) => {
      this.debugLog('onerror 触发');
      this.isConnecting = false;
      this.updateConnectStatus('连接错误', '请检查网络连接');
    };

    this.ws.onclose = (event) => {
      this.debugLog('onclose code=' + event.code);
      this.isConnecting = false;
      this.updateConnectStatus('连接断开', `代码: ${event.code}`);
      this.updateStatus('连接断开', false);

      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }

      if (this.shouldReconnect && this.currentSession) {
        if (event.code === 1001 || event.code === 1006) {
          this.debugLog('触发自动重连');
          this.attemptReconnect();
        }
      } else {
        this.debugLog('不重连: shouldReconnect=' + this.shouldReconnect);
      }
    };

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendMessage({ type: 'ping' });
      }
    }, 10000);
  }

  /**
   * 处理 WebSocket 消息
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      console.log('Received message:', message.type);

      switch (message.type) {
        case 'connecting':
          console.log('Session connecting:', message.message);
          this.updateStatus('连接中...', false);
          this.updateConnectStatus('正在连接...', '启动会话进程');
          break;

        case 'connected':
          this.debugLog('收到connected消息');
          this.updateConnectStatus('已连接', '等待500ms后初始化终端');
          this.updateStatus('已连接', true);
          // 延迟初始化 xterm.js，避免与 DOM 操作冲突
          setTimeout(() => {
            this.debugLog('开始初始化终端');
            this.initTerminal();
            this.debugLog('终端初始化完成，等待resize');
            setTimeout(() => {
              this.debugLog('调用resizeTerminal');
              this.resizeTerminal();
            }, 200);
          }, 500);
          break;

        case 'output':
          console.log('Output received, data length:', message.data?.length);
          if (message.data) {
            if (this.terminal) {
              try {
                this.terminal.write(message.data);
              } catch (writeError) {
                console.error('Terminal write error:', writeError);
              }
            } else {
              // 终端未就绪，放入队列
              console.log('Terminal not ready, queuing output');
              this.outputQueue.push(message.data);
            }
          }
          break;

        case 'error':
          console.error('Server error:', message.message);
          this.updateConnectStatus('错误', message.message);
          this.showError(message.message);
          break;

        case 'pong':
          // 心跳响应
          console.log('Pong received');
          break;

        case 'clients':
          console.log('Client count:', message.count);
          break;

        default:
          console.log('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Handle message error:', error);
    }
  }

  /**
   * 发送消息
   */
  sendMessage(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // 使用 JSON 发送
      this.ws.send(JSON.stringify(data));
    }
  }

  /**
   * 发送输入
   */
  sendInput() {
    const inputRow = document.getElementById('input-row');
    const inputEl = inputRow?.querySelector('.input-field');
    if (!inputEl || !inputEl.value) return;

    // 发送输入内容 + 回车
    this.sendMessage({ type: 'input', data: inputEl.value });
    this.sendMessage({ type: 'input', data: '\r' });

    // 清空输入框
    inputEl.value = '';
  }

  /**
   * 发送按键
   */
  sendKey(key) {
    const keyMap = {
      'up': '\x1b[A',
      'down': '\x1b[B',
      'escape': '\x1b',
      'tab': '\t',
      'ctrl-c': '\x03',
      'ctrl-d': '\x04',
      'enter': '\r',
    };

    const sequence = keyMap[key];
    if (sequence) {
      this.sendMessage({
        type: 'input',
        data: sequence
      });
    }
  }

  /**
   * 尝试重连
   */
  attemptReconnect() {
    this.debugLog('attemptReconnect 调用');

    // 检查连接锁
    if (this.isConnecting) {
      this.debugLog('正在连接中(锁)，跳过重连');
      return;
    }

    // 清理之前的重连定时器
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.debugLog('达到最大重连次数');
      this.updateStatus('连接失败，请手动重连', false);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 10000);

    this.debugLog(`重连 ${this.reconnectAttempts}/${this.maxReconnectAttempts}, ${delay}ms后`);
    this.updateStatus(`重连中 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`, false);

    this.reconnectTimeout = setTimeout(() => {
      if (this.shouldReconnect && this.currentSession && !this.isConnecting) {
        this.debugLog('执行重连');
        this.isConnecting = true;  // 设置连接锁
        this.connect(this.currentSession);
      } else {
        this.debugLog('取消重连: shouldReconnect=' + this.shouldReconnect + ', isConnecting=' + this.isConnecting);
      }
    }, delay);
  }

  /**
   * 调整字体大小
   */
  adjustFontSize(delta) {
    if (!this.terminal) return;

    const currentSize = this.terminal.fontSize;
    const newSize = Math.max(10, Math.min(24, currentSize + delta));

    this.terminal.setFontSize(newSize);

    // 调整后重新计算大小
    setTimeout(() => this.resizeTerminal(), 100);
  }

  /**
   * 调整终端大小
   */
  resizeTerminal() {
    if (!this.terminal) return;

    // 先让终端适配容器
    this.terminal.fit();

    // 等待适配完成后获取大小
    setTimeout(() => {
      const size = this.terminal.getSize();
      console.log('Terminal resized to:', size);
      this.sendMessage({
        type: 'resize',
        rows: size.rows,
        cols: size.cols
      });
    }, 50);
  }

  /**
   * 重命名会话
   */
  async renameSession(sessionId, currentName) {
    const newName = prompt('输入新名称:', currentName);
    if (!newName || newName === currentName) return;

    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({ name: newName })
      });

      if (!response.ok) throw new Error('Failed to rename session');

      this.loadSessions();
    } catch (error) {
      console.error('Rename session error:', error);
      this.showError('重命名失败');
    }
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId) {
    if (!confirm('确定要删除这个会话吗？')) return;

    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (!response.ok) throw new Error('Failed to delete session');

      this.loadSessions();
    } catch (error) {
      console.error('Delete session error:', error);
      this.showError('删除会话失败');
    }
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.debugLog('disconnect 调用');
    // 禁用自动重连
    this.shouldReconnect = false;
    // 重置连接锁
    this.isConnecting = false;

    // 清理重连定时器
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.terminal) {
      this.terminal.dispose();
      this.terminal = null;
    }

    // 清空输出队列
    this.outputQueue = [];

    this.currentSession = null;
  }

  /**
   * 显示视图
   */
  showView(viewName) {
    this.debugLog('showView: ' + viewName);
    document.querySelectorAll('.view').forEach(view => {
      view.classList.remove('active');
    });
    this.debugLog('移除active完成');

    document.getElementById(`${viewName}-view`).classList.add('active');
    this.debugLog('添加active完成');

    // 动态创建/销毁 input
    const inputRow = document.getElementById('input-row');
    let input = inputRow.querySelector('.input-field');

    if (viewName === 'terminal') {
      if (!input) {
        input = document.createElement('input');
        input.type = 'text';
        input.className = 'input-field';
        input.autocomplete = 'off';

        // 监听输入法
        input.addEventListener('compositionstart', () => { this.isComposing = true; });
        input.addEventListener('compositionend', () => { this.isComposing = false; });

        // 回车发送
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !this.isComposing) {
            e.preventDefault();
            this.sendInput();
          }
        });

        inputRow.insertBefore(input, inputRow.firstChild);
      }
    } else {
      if (input) {
        input.remove();
      }
    }

    if (viewName === 'sessions') {
      this.loadSessions();
    }
  }

  /**
   * 更新连接状态
   */
  updateStatus(text, connected) {
    const status = document.getElementById('connection-status');
    status.textContent = text;
    status.className = 'connection-status ' + (connected ? 'connected' : 'disconnected');
  }

  /**
   * 显示错误
   */
  showError(message) {
    alert(message);
  }

  /**
   * HTML 转义
   */
  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * 获取路径最后一级
   */
  getLastPathComponent(path) {
    if (!path) return '';
    const parts = path.split('/').filter(p => p);
    return parts[parts.length - 1] || path;
  }

  /**
   * 格式化时间
   */
  formatTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diff = now - date;

    // 小于1分钟
    if (diff < 60000) {
      return '刚刚';
    }
    // 小于1小时
    if (diff < 3600000) {
      return Math.floor(diff / 60000) + '分钟前';
    }
    // 小于24小时
    if (diff < 86400000) {
      return Math.floor(diff / 3600000) + '小时前';
    }
    // 其他
    return date.toLocaleDateString();
  }
}

// 页面加载完成后初始化
window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
