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

    this.init();
  }

  init() {
    // 加载会话列表
    this.loadSessions();

    // 绑定事件
    this.bindEvents();
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
        // 如果点击的是按钮，不触发连接
        if (e.target.classList.contains('btn-delete') || e.target.classList.contains('btn-rename')) return;
        this.connectSession(session.id);
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
      this.connectSession(session.id);
    } catch (error) {
      console.error('Create session error:', error);
      this.showError('创建会话失败');
    }
  }

  /**
   * 连接会话
   */
  async connectSession(sessionId) {
    this.currentSession = sessionId;
    this.showView('terminal');

    // 初始化终端
    const terminalContainer = document.getElementById('terminal-output');
    terminalContainer.innerHTML = '';

    try {
      this.terminal = new Terminal(terminalContainer);
    } catch (error) {
      console.error('Terminal init error:', error);
      this.showError('终端初始化失败：' + error.message);
      return;
    }

    // 连接 WebSocket
    this.connect(sessionId);
  }

  /**
   * 连接 WebSocket
   */
  connect(sessionId) {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/${sessionId}?token=${this.token}`;

    this.ws = new WebSocket(wsUrl);
    // 使用 blob 而不是 arraybuffer，方便后续转换
    this.ws.binaryType = 'blob';

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.updateStatus('已连接', true);
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.showError('连接错误');
    };

    this.ws.onclose = (event) => {
      console.log('WebSocket closed, code:', event.code, 'reason:', event.reason, 'wasClean:', event.wasClean);
      this.updateStatus('连接断开', false);
    };

    // 定期发送心跳 (Safari 需要更频繁的心跳)
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendMessage({ type: 'ping' });
      }
    }, 10000);  // 10秒
  }

  /**
   * 处理 WebSocket 消息
   */
  async handleMessage(data) {
    try {
      // 如果是 Blob，转换为文本
      let text;
      if (data instanceof Blob) {
        text = await data.text();
      } else {
        text = data;
      }

      // 解析 JSON
      const message = JSON.parse(text);
      console.log('Received message:', message.type, message);

      switch (message.type) {
        case 'connected':
          console.log('Session connected, clients:', message.clients);
          // 通知终端调整大小
          setTimeout(() => this.resizeTerminal(), 200);
          break;

        case 'output':
          console.log('Output received, data length:', message.data?.length);
          if (this.terminal && message.data) {
            try {
              this.terminal.write(message.data);
            } catch (writeError) {
              console.error('Terminal write error:', writeError);
            }
          } else {
            console.warn('Cannot write: terminal or data missing');
          }
          break;

        case 'error':
          console.error('Server error:', message.message);
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
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.terminal) {
      this.terminal.dispose();
      this.terminal = null;
    }

    this.currentSession = null;
  }

  /**
   * 显示视图
   */
  showView(viewName) {
    document.querySelectorAll('.view').forEach(view => {
      view.classList.remove('active');
    });

    document.getElementById(`${viewName}-view`).classList.add('active');

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
