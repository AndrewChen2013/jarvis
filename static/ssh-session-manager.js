/**
 * Copyright (c) 2025 BillChen
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * SSH Session Manager - SSH 多终端管理
 * 完全独立的 SSH session 管理系统
 * 支持同时打开多个 SSH 连接，在后台保持连接
 */

// SSH 终端主题
const SSH_THEMES = {
  default: { background: '#1a1a1a', foreground: '#d4d4d4', cursor: '#d4d4d4', name: 'Default' },
  blue:    { background: '#0d1b2a', foreground: '#7ec8e3', cursor: '#7ec8e3', name: 'Blue' },
  green:   { background: '#0d2818', foreground: '#7ddf64', cursor: '#7ddf64', name: 'Green' },
  purple:  { background: '#2d1b4e', foreground: '#d4a5ff', cursor: '#d4a5ff', name: 'Purple' },
  orange:  { background: '#2a1a0a', foreground: '#ffb347', cursor: '#ffb347', name: 'Orange' },
  cyan:    { background: '#0a2a2a', foreground: '#5ce1e6', cursor: '#5ce1e6', name: 'Cyan' },
  red:     { background: '#2a0a0a', foreground: '#ff6b6b', cursor: '#ff6b6b', name: 'Red' },
  gold:    { background: '#1a1a0a', foreground: '#ffd700', cursor: '#ffd700', name: 'Gold' },
  rose:    { background: '#2a0a1a', foreground: '#ff69b4', cursor: '#ff69b4', name: 'Rose' },
  ocean:   { background: '#001f3f', foreground: '#39cccc', cursor: '#39cccc', name: 'Ocean' },
};

const SSH_THEME_ORDER = ['default', 'blue', 'green', 'purple', 'orange', 'cyan', 'red', 'gold', 'rose', 'ocean'];

/**
 * SSH Session 实例
 * 每个 SSH 连接的独立状态
 */
class SSHSessionInstance {
  constructor(machineId, machineName) {
    this.id = `ssh_${machineId}`;
    this.machineId = machineId;
    this.name = machineName;

    // WebSocket 连接
    this.ws = null;

    // xterm 终端
    this.terminal = null;
    this.fitAddon = null;
    this.container = null;

    // 连接状态
    this.status = 'idle'; // idle | connecting | connected | disconnected | error
    this.lastActive = Date.now();

    // 机器信息
    this.machine = null;

    // 重连状态
    this.shouldReconnect = false;
    this.reconnectAttempts = 0;
    this.reconnectTimeout = null;
    this.maxReconnectAttempts = 3;

    // 字体大小（每个 session 独立）
    this.fontSize = null;

    // 主题（每个 session 独立）
    this.theme = null;
  }

  /**
   * 更新最后活跃时间
   */
  touch() {
    this.lastActive = Date.now();
  }

  /**
   * 获取状态颜色
   */
  getStatusColor() {
    switch (this.status) {
      case 'connected': return '#10b981';
      case 'connecting': return '#fbbf24';
      case 'error': return '#ef4444';
      case 'disconnected': return '#6b7280';
      default: return '#6b7280';
    }
  }
}

/**
 * SSH Session Manager
 * 管理多个 SSH 连接
 */
class SSHSessionManager {
  constructor() {
    this.sessions = new Map(); // sessionId -> SSHSessionInstance
    this.activeId = null;
    this.previousId = null;
    this.floatingButton = null;

    // 初始化
    this.init();
  }

  log(msg) {
    console.log('[SSHSessionMgr] ' + msg);
  }

  init() {
    this.log('init');
    // 创建悬浮球
    this.floatingButton = new SSHFloatingButton(this);
  }

  /**
   * 获取 token
   */
  get token() {
    if (window.app && window.app.token) {
      return window.app.token;
    }
    return localStorage.getItem('token') || '';
  }

  /**
   * 计算默认字体大小（和 Claude terminal 对齐）
   */
  calcDefaultFontSize() {
    const saved = localStorage.getItem('ssh-terminal-font-size');
    if (saved) {
      const size = parseInt(saved, 10);
      if (size >= 10 && size <= 24) {
        return size;
      }
    }
    const width = window.innerWidth;
    if (width < 430) return 13;
    else if (width < 820) return 15;
    else return 17;
  }

  /**
   * 获取当前活跃的 session
   */
  getActive() {
    return this.activeId ? this.sessions.get(this.activeId) : null;
  }

  /**
   * 获取所有后台 session
   */
  getBackgroundSessions() {
    const result = [];
    for (const [id, session] of this.sessions) {
      if (id !== this.activeId) {
        result.push(session);
      }
    }
    return result.sort((a, b) => b.lastActive - a.lastActive);
  }

  /**
   * 获取后台 session 数量
   */
  getBackgroundCount() {
    return this.sessions.size - (this.activeId ? 1 : 0);
  }

  /**
   * 获取所有 session
   */
  getAllSessions() {
    return Array.from(this.sessions.values());
  }

  /**
   * 检查 session 是否已打开
   */
  isSessionOpen(machineId) {
    return this.sessions.has(`ssh_${machineId}`);
  }

  /**
   * 连接到远程机器
   */
  connect(machine) {
    this.log(`connect: ${machine.name} (id=${machine.id})`);

    const sessionId = `ssh_${machine.id}`;
    let session = this.sessions.get(sessionId);

    if (session) {
      // 已存在，切换到它
      this.log('connect: session exists, switch');
      this.switchTo(sessionId);

      // 如果已断开，重新连接
      if (session.status === 'disconnected' || session.status === 'error') {
        this.reconnectSession(session);
      }
    } else {
      // 新建 session
      this.log('connect: create new session');
      session = new SSHSessionInstance(machine.id, machine.name);
      session.machine = machine;
      session.fontSize = this.calcDefaultFontSize();

      // 从 localStorage 读取主题
      const savedTheme = localStorage.getItem('ssh-terminal-theme');
      if (savedTheme && SSH_THEMES[savedTheme]) {
        session.theme = savedTheme;
      } else {
        session.theme = 'default';
      }

      this.sessions.set(sessionId, session);
      this.switchTo(sessionId);

      // 初始化终端并连接
      this.initTerminal(session);
    }

    return session;
  }

  /**
   * 切换到指定 session
   */
  switchTo(sessionId) {
    this.log(`switchTo: ${sessionId}`);
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.log('switchTo: session not found');
      return;
    }

    // 记录上一个活跃的 session
    if (this.activeId && this.activeId !== sessionId) {
      this.previousId = this.activeId;
    }

    // 隐藏所有其他 session 的容器
    for (const [id, s] of this.sessions) {
      if (id !== sessionId && s.container) {
        s.container.style.display = 'none';
      }
    }

    this.activeId = sessionId;
    session.touch();

    // 显示目标 session
    this.showSession(session);

    // 更新悬浮球
    if (this.floatingButton) {
      this.floatingButton.update();
    }
  }

  /**
   * 快速切换到上一个 session
   */
  switchToPrevious() {
    if (this.previousId && this.sessions.has(this.previousId)) {
      this.switchTo(this.previousId);
      return true;
    }

    const backgrounds = this.getBackgroundSessions();
    if (backgrounds.length > 0) {
      this.switchTo(backgrounds[0].id);
      return true;
    }

    return false;
  }

  /**
   * 收起当前 session（放入后台）
   */
  minimizeCurrent() {
    this.log(`minimizeCurrent: activeId=${this.activeId}`);
    if (!this.activeId) return;

    const session = this.sessions.get(this.activeId);
    if (session && session.container) {
      session.container.style.display = 'none';
    }

    this.previousId = this.activeId;
    this.activeId = null;

    // 更新悬浮球
    if (this.floatingButton) {
      this.floatingButton.update();
    }

    // 隐藏 SSH 终端视图
    this.hideView();
  }

  /**
   * 关闭 session
   */
  closeSession(sessionId) {
    this.log(`closeSession: ${sessionId}`);
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // 断开 WebSocket
    if (session.ws) {
      session.ws.close();
      session.ws = null;
    }

    // 销毁终端
    if (session.terminal) {
      session.terminal.dispose();
      session.terminal = null;
    }

    // 移除容器
    if (session.container) {
      session.container.remove();
      session.container = null;
    }

    // 清除重连定时器
    if (session.reconnectTimeout) {
      clearTimeout(session.reconnectTimeout);
    }

    this.sessions.delete(sessionId);

    if (this.activeId === sessionId) {
      this.activeId = null;
    }
    if (this.previousId === sessionId) {
      this.previousId = null;
    }

    // 更新悬浮球
    if (this.floatingButton) {
      this.floatingButton.update();
    }
  }

  /**
   * 关闭所有 session
   */
  closeAll() {
    for (const sessionId of this.sessions.keys()) {
      this.closeSession(sessionId);
    }
  }

  /**
   * 显示 session
   */
  showSession(session) {
    this.log(`showSession: ${session.id}`);

    // 显示 SSH 终端视图
    this.showView();

    // 更新标题
    const titleEl = document.getElementById('ssh-terminal-title');
    if (titleEl) {
      titleEl.textContent = `[SSH] ${session.name}`;
    }

    // 显示容器
    if (session.container) {
      session.container.style.display = 'block';
    }

    // 恢复字体大小
    if (session.fontSize && session.terminal) {
      session.terminal.options.fontSize = session.fontSize;
      if (session.fitAddon) {
        session.fitAddon.fit();
      }
    }

    // 恢复主题
    if (session.theme && session.terminal) {
      this.applyTheme(session, session.theme);
    }

    // 聚焦终端
    if (session.terminal) {
      session.terminal.focus();
    }
  }

  /**
   * 显示 SSH 终端视图
   */
  showView() {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const sshView = document.getElementById('ssh-terminal-view');
    if (sshView) {
      sshView.classList.add('active');
    }
  }

  /**
   * 隐藏 SSH 终端视图
   */
  hideView() {
    const sshView = document.getElementById('ssh-terminal-view');
    if (sshView) {
      sshView.classList.remove('active');
    }
    const sessionsView = document.getElementById('sessions-view');
    if (sessionsView) {
      sessionsView.classList.add('active');
    }
  }

  /**
   * 初始化终端
   */
  initTerminal(session) {
    this.log(`initTerminal: ${session.id}`);

    // 获取容器
    const outputContainer = document.getElementById('ssh-terminal-output');
    if (!outputContainer) {
      this.log('ERROR: ssh-terminal-output not found');
      return;
    }

    // 创建 session 容器
    const container = document.createElement('div');
    container.id = `ssh-container-${session.id}`;
    container.className = 'ssh-session-container';
    container.style.width = '100%';
    container.style.height = '100%';
    outputContainer.appendChild(container);
    session.container = container;

    // 创建 xterm 终端
    const theme = SSH_THEMES[session.theme] || SSH_THEMES.default;
    const term = new window.Terminal({
      cursorBlink: true,
      fontSize: session.fontSize,
      fontFamily: "'SF Mono', 'Monaco', 'Consolas', 'Liberation Mono', 'Menlo', monospace",
      theme: {
        background: theme.background,
        foreground: theme.foreground,
        cursor: theme.cursor,
        cursorAccent: theme.background,
        selection: 'rgba(255, 255, 255, 0.3)',
      },
      convertEol: true,
      scrollback: 5000,
      allowProposedApi: true
    });

    session.terminal = term;

    // 添加 fit addon
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    session.fitAddon = fitAddon;

    // 打开终端
    term.open(container);

    // 尝试 WebGL 渲染
    try {
      const webglAddon = new WebglAddon.WebglAddon();
      term.loadAddon(webglAddon);
    } catch (e) {
      this.log('WebGL addon failed: ' + e.message);
    }

    // fit 并连接
    setTimeout(() => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        this.connectWebSocket(session, dims.rows, dims.cols);
      } else {
        this.connectWebSocket(session, 24, 80);
      }
    }, 50);
  }

  /**
   * 连接 WebSocket
   */
  connectWebSocket(session, rows, cols) {
    if (!session.machine) return;

    session.status = 'connecting';
    this.updateStatus(session);

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws/ssh?machine_id=${session.machineId}&rows=${rows}&cols=${cols}`;

    this.log(`WebSocket connecting: ${wsUrl}`);

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    session.ws = ws;

    ws.onopen = () => {
      this.log('WebSocket opened');
      ws.send(JSON.stringify({ type: 'auth', token: this.token }));
    };

    ws.onmessage = (event) => {
      try {
        const data = MessagePack.decode(new Uint8Array(event.data));

        if (data.type === 'output' && data.data) {
          session.terminal.write(data.data);
        } else if (data.type === 'connected') {
          this.log('SSH connected');
          session.status = 'connected';
          session.reconnectAttempts = 0;
          this.updateStatus(session);
          if (this.floatingButton) {
            this.floatingButton.update();
          }
        } else if (data.type === 'error') {
          this.log(`SSH error: ${data.message}`);
          session.terminal.write(`\r\n\x1b[31mError: ${data.message}\x1b[0m\r\n`);
          session.status = 'error';
          this.updateStatus(session);
        }
      } catch (e) {
        this.log('Message parse error: ' + e.message);
      }
    };

    ws.onclose = (event) => {
      this.log(`WebSocket closed: code=${event.code}`);
      session.status = 'disconnected';
      this.updateStatus(session);

      // 尝试重连
      if (session.shouldReconnect && session.reconnectAttempts < session.maxReconnectAttempts) {
        session.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, session.reconnectAttempts), 10000);
        this.log(`Will reconnect in ${delay}ms (attempt ${session.reconnectAttempts})`);
        session.reconnectTimeout = setTimeout(() => {
          this.reconnectSession(session);
        }, delay);
      }

      if (this.floatingButton) {
        this.floatingButton.update();
      }
    };

    ws.onerror = (error) => {
      this.log('WebSocket error');
      session.status = 'error';
      this.updateStatus(session);
    };

    // 绑定终端输入
    session.terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(MessagePack.encode({ type: 'input', data }));
      }
    });

    // 绑定终端大小变化
    session.terminal.onResize(({ rows, cols }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(MessagePack.encode({ type: 'resize', rows, cols }));
      }
    });
  }

  /**
   * 重连 session
   */
  reconnectSession(session) {
    this.log(`reconnectSession: ${session.id}`);
    if (!session.machine) return;

    session.shouldReconnect = true;

    if (session.fitAddon) {
      const dims = session.fitAddon.proposeDimensions();
      if (dims) {
        this.connectWebSocket(session, dims.rows, dims.cols);
      } else {
        this.connectWebSocket(session, 24, 80);
      }
    }
  }

  /**
   * 更新连接状态显示
   */
  updateStatus(session) {
    const dot = document.getElementById('ssh-connection-dot');
    const statusEl = document.getElementById('ssh-connection-status');

    if (dot) {
      dot.className = 'connection-dot ' + session.status;
    }
    if (statusEl) {
      const messages = {
        connecting: 'Connecting...',
        connected: '',
        disconnected: 'Disconnected',
        error: 'Error'
      };
      statusEl.textContent = messages[session.status] || '';
      statusEl.className = 'connection-status ' + session.status;
    }
  }

  /**
   * 调整字体大小
   */
  changeFontSize(delta) {
    const session = this.getActive();
    if (!session || !session.terminal) return;

    const newSize = Math.max(10, Math.min(24, session.fontSize + delta));
    if (newSize === session.fontSize) return;

    session.fontSize = newSize;
    session.terminal.options.fontSize = newSize;
    if (session.fitAddon) {
      session.fitAddon.fit();
    }

    localStorage.setItem('ssh-terminal-font-size', newSize.toString());
  }

  /**
   * 切换主题
   */
  toggleTheme() {
    const session = this.getActive();
    if (!session) return;

    const currentIndex = SSH_THEME_ORDER.indexOf(session.theme);
    const nextIndex = (currentIndex + 1) % SSH_THEME_ORDER.length;
    const nextTheme = SSH_THEME_ORDER[nextIndex];

    this.applyTheme(session, nextTheme);
    localStorage.setItem('ssh-terminal-theme', nextTheme);

    this.showToast(`Theme: ${SSH_THEMES[nextTheme].name}`);
  }

  /**
   * 应用主题
   */
  applyTheme(session, themeName) {
    const theme = SSH_THEMES[themeName];
    if (!theme || !session.terminal) return;

    session.theme = themeName;
    session.terminal.options.theme = {
      background: theme.background,
      foreground: theme.foreground,
      cursor: theme.cursor,
      cursorAccent: theme.background,
      selection: 'rgba(255, 255, 255, 0.3)',
    };
  }

  /**
   * 显示 Toast
   */
  showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `ssh-toast ${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 60px;
      left: 50%;
      transform: translateX(-50%);
      padding: 8px 16px;
      background: ${type === 'error' ? '#ef4444' : '#10b981'};
      color: #fff;
      border-radius: 6px;
      font-size: 14px;
      z-index: 1000;
      animation: fadeInOut 2s ease-in-out;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  /**
   * Pin 到 Session 列表
   */
  async pinCurrentSession() {
    const session = this.getActive();
    if (!session || !session.machineId) return;

    try {
      const response = await fetch(`/api/remote-machines/${session.machineId}/pin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (response.ok) {
        const result = await response.json();
        if (result.already_pinned) {
          this.showToast('Already pinned');
        } else {
          this.showToast('Pinned to sessions');
        }
      } else {
        this.showToast('Pin failed', 'error');
      }
    } catch (e) {
      this.log('Pin error: ' + e.message);
      this.showToast('Pin failed', 'error');
    }
  }
}

// 导出
window.SSHSessionManager = SSHSessionManager;
window.SSHSessionInstance = SSHSessionInstance;
window.SSH_THEMES = SSH_THEMES;
window.SSH_THEME_ORDER = SSH_THEME_ORDER;
