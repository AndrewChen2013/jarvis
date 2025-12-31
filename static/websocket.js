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
 * WebSocket 模块
 * 提供 WebSocket 连接、消息处理、重连等功能
 */
const AppWebSocket = {
  /**
   * 连接终端（新版 - 直接使用 Claude session）
   * @param {string} workDir - 工作目录
   * @param {string} sessionId - Claude session_id（null 表示新建）
   * @param {string} sessionName - 显示名称
   */
  connectTerminal(workDir, sessionId, sessionName) {
    this.closeCreateModal();

    // 保存当前工作目录和会话信息
    this.currentWorkDir = workDir;
    this.currentSession = sessionId || `new-${Date.now()}`;
    this.currentSessionName = sessionName || this.getLastPathComponent(workDir);
    this.currentClaudeSessionId = sessionId;

    this.debugLog(`connectTerminal: session=${this.currentSession}, claudeSessionId=${sessionId}`);

    // 清除旧的全局 terminal 引用（每个 session 有自己的 terminal）
    this.terminal = null;

    // 注册到 SessionManager（支持多 session 后台运行）
    const session = this.sessionManager.openSession(this.currentSession, this.currentSessionName);
    this.debugLog(`connectTerminal: session registered, sessions.size=${this.sessionManager.sessions.size}`);

    // 显示终端视图
    this.showView('terminal');

    // 清空主容器中的旧内容（除了 session 容器）
    const terminalOutput = document.getElementById('terminal-output');
    if (terminalOutput) {
      // 移除非 session-container 的子元素（如连接状态显示）
      Array.from(terminalOutput.children).forEach(child => {
        if (!child.classList.contains('terminal-session-container')) {
          child.remove();
        }
      });
    }

    this.initTerminal();

    // 连接 WebSocket
    this.connectWebSocket(workDir, sessionId);
  },

  /**
   * 收起当前 session（放入后台，保持连接）
   */
  minimizeCurrentSession() {
    this.debugLog(`minimizeCurrentSession: currentSession=${this.currentSession}`);
    if (!this.currentSession) {
      this.debugLog('minimizeCurrentSession: no current session');
      return;
    }

    // 使用 SessionManager 收起
    this.sessionManager.minimizeCurrent();
    this.debugLog(`minimizeCurrentSession: done, sessions.size=${this.sessionManager.sessions.size}`);
  },

  /**
   * 关闭当前 session（断开连接）
   */
  closeCurrentSession() {
    if (!this.currentSession) {
      this.showView('sessions');
      return;
    }

    const sessionId = this.currentSession;

    // 从 SessionManager 关闭
    this.sessionManager.closeSession(sessionId);

    // 清理 app 层面的状态
    this.disconnect();
    this.showView('sessions');
  },

  /**
   * 连接会话
   */
  async connectSession(sessionId, sessionName = '') {
    this.debugLog('connectSession: ' + sessionId + ', lock=' + this.isConnecting + ', ws=' + (this.ws ? this.ws.readyState : 'null'));

    // 保存会话名称
    this.currentSessionName = sessionName || sessionId.substring(0, 8);

    // 检查 SessionManager 中是否已有此 session
    if (this.sessionManager.isSessionOpen(sessionId)) {
      this.debugLog('Session already in background, switch to it');
      const session = this.sessionManager.sessions.get(sessionId);

      // 恢复 app 层面的状态
      this.currentSession = sessionId;
      this.ws = session.ws;
      this.terminal = session.terminal;
      this.shouldReconnect = true;

      // 切换到该 session
      this.sessionManager.switchTo(sessionId);

      // 直接切换视图，不清空终端容器（已有终端）
      this.showView('terminal');

      // 更新标题
      const titleEl = document.getElementById('terminal-title');
      if (titleEl) {
        titleEl.textContent = this.currentSessionName;
      }

      // 更新连接状态显示
      if (session.status === 'connected') {
        const statusEl = document.getElementById('connection-status');
        if (statusEl) {
          statusEl.textContent = '';  // 已连接时不显示文字
          statusEl.className = 'connection-status connected';
        }
        const dot = document.getElementById('connection-dot');
        if (dot) {
          dot.className = 'connection-dot connected';
        }
      }

      return;
    }

    // 连接锁：防止并发连接
    if (this.isConnecting) {
      this.debugLog('connecting (locked), skip');
      return;
    }

    // 防止重复连接（包括正在连接中的状态）
    if (this.currentSession === sessionId && this.ws) {
      const state = this.ws.readyState;
      if (state === WebSocket.CONNECTING || state === WebSocket.OPEN) {
        this.debugLog('already connecting (ws), skip');
        return;
      }
    }

    // 设置连接锁
    this.isConnecting = true;
    this.debugLog('set connection lock');

    // 创建新的 SessionInstance
    const session = this.sessionManager.openSession(sessionId, this.currentSessionName);

    // 不再关闭旧连接，保持在后台
    // 只重置当前状态
    this.currentSession = sessionId;
    this.outputQueue = [];
    this.terminal = null;
    this.ws = null;

    // 创建 WebSocket
    this.debugLog('create new WebSocket');
    this.connect(sessionId);
    this.debugLog('connectSession done');
  },

  /**
   * 显示终端视图并初始化状态显示
   */
  showTerminalView() {
    this.debugLog('showTerminalView start');
    this.showView('terminal');
    this.debugLog('showView done');

    // 设置终端标题为会话名称
    const titleEl = document.getElementById('terminal-title');
    if (titleEl && this.currentSessionName) {
      titleEl.textContent = this.currentSessionName;
    }

    // 获取或创建当前 session 的容器，在里面显示连接状态
    const session = this.currentSession ? this.sessionManager.sessions.get(this.currentSession) : null;
    if (session) {
      const container = this.sessionManager.getOrCreateContainer(session);
      container.style.display = 'block';
      container.innerHTML = `
        <div id="connect-status" class="connect-status">
          <div class="connect-spinner"></div>
          <div class="connect-text">${this.t('status.connecting')}</div>
          <div class="connect-detail"></div>
        </div>
      `;
      this.debugLog('showTerminalView: show connect status in session container');
    } else {
      // 兼容：没有 session 时使用主容器
      const terminalContainer = document.getElementById('terminal-output');
      if (terminalContainer) {
        terminalContainer.innerHTML = `
          <div id="connect-status" class="connect-status">
            <div class="connect-spinner"></div>
            <div class="connect-text">${this.t('status.connecting')}</div>
            <div class="connect-detail"></div>
          </div>
        `;
      }
      this.debugLog('showTerminalView: show connect status in main container');
    }
    this.debugLog('showTerminalView done');
  },

  /**
   * 手动重试连接（用户点击触发，不经过延迟）
   */
  manualRetryConnect() {
    if (!this.currentSession) return;

    this.debugLog('manual retry: create WebSocket');
    this.updateConnectStatus('connecting', this.t('status.manualRetry'));

    // 清理旧连接
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }

    // 构建新的 WebSocket URL
    let wsUrl;
    if (this.currentWorkDir) {
      const params = new URLSearchParams({
        working_dir: this.currentWorkDir,
        token: this.token
      });
      if (this.currentClaudeSessionId) {
        params.append('session_id', this.currentClaudeSessionId);
      }
      wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/terminal?${params.toString()}`;
    } else {
      // 兼容旧版
      wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/${this.currentSession}?token=${this.token}`;
    }

    // 直接在点击事件中创建 WebSocket（不使用任何延迟）
    try {
      this.ws = new WebSocket(wsUrl);
      this.debugLog('manual retry: WebSocket created, state=' + this.ws.readyState);
      this.isConnecting = true;
      this.bindWebSocketEvents();
    } catch (e) {
      this.debugLog('manual retry: failed ' + e.message);
      this.updateConnectStatus('failed', e.message);
    }
  },

  /**
   * 初始化终端（在 WebSocket 连接成功后调用）
   */
  initTerminal() {
    this.debugLog('initTerminal start');

    // 获取当前 session
    const session = this.currentSession ? this.sessionManager.sessions.get(this.currentSession) : null;
    this.debugLog(`initTerminal: session=${session ? session.id : 'null'}`);

    // 检查当前 session 是否已有终端（而不是检查全局 this.terminal）
    if (session && session.terminal) {
      this.debugLog('initTerminal: session already has terminal, reuse it');
      this.terminal = session.terminal;
      // 确保容器显示
      if (session.container) {
        session.container.style.display = 'block';
      }
      this.flushOutputQueue();
      return;
    }

    // 获取或创建 session 专属容器
    let container;
    if (session) {
      container = this.sessionManager.getOrCreateContainer(session);
      container.style.display = 'block';
      container.innerHTML = ''; // 清空状态显示
      this.debugLog(`initTerminal: use session container ${container.id}`);
    } else {
      // 兼容：没有 session 时使用主容器
      container = document.getElementById('terminal-output');
      if (container) {
        container.innerHTML = '';
      }
      this.debugLog('initTerminal: use main container');
    }

    if (!container) {
      console.error('Terminal container not found');
      this.debugLog('initTerminal: container not found!');
      return;
    }

    try {
      console.log('Creating new Terminal instance...');
      this.debugLog('initTerminal: create Terminal instance');
      this.terminal = new Terminal(container, () => {
        // 终端就绪后，刷新队列中的输出
        console.log('Terminal ready callback, flushing queue...');
        this.flushOutputQueue();
      });
      console.log('Terminal created successfully');
      this.debugLog('initTerminal: Terminal created');

      // 保存 terminal 到 SessionManager
      if (session) {
        session.terminal = this.terminal;
        this.debugLog('initTerminal: save terminal to session');
      }
    } catch (error) {
      console.error('Terminal init error:', error);
      this.debugLog('initTerminal: error ' + error.message);
      container.innerHTML = '<div style="color:red;padding:20px;">终端初始化失败: ' + error.message + '</div>';
    }
  },

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
  },

  /**
   * 连接 WebSocket（新版）
   * @param {boolean} isReconnect - 是否是重连，重连时不重置计数器
   */
  connectWebSocket(workDir, sessionId, isReconnect = false) {
    this.debugLog('connectWebSocket() 开始');
    if (!isReconnect) {
      this.reconnectAttempts = 0;
    }

    // 构建新的 WebSocket URL
    const params = new URLSearchParams({
      working_dir: workDir,
      token: this.token
    });
    if (sessionId) {
      params.append('session_id', sessionId);
    }
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/terminal?${params.toString()}`;
    this.debugLog('WebSocket URL: ' + wsUrl.substring(0, 80));

    // 使用通用连接逻辑
    this._doConnect(wsUrl);
  },

  /**
   * 旧版连接方法（兼容）
   * @deprecated
   * @param {boolean} isReconnect - 是否是重连，重连时不重置计数器
   */
  connect(sessionId, isReconnect = false) {
    this.debugLog('connect() 开始 (legacy)');
    if (!isReconnect) {
      this.reconnectAttempts = 0;
    }

    // 如果有 currentWorkDir，使用新端点
    if (this.currentWorkDir) {
      this.connectWebSocket(this.currentWorkDir, this.currentClaudeSessionId, isReconnect);
      return;
    }

    // 否则使用旧端点（兼容）
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/${sessionId}?token=${this.token}`;
    this.debugLog('WebSocket URL: ' + wsUrl.substring(0, 60));
    this._doConnect(wsUrl);
  },

  /**
   * 实际的 WebSocket 连接逻辑
   *
   * 【iOS 26 Safari WebSocket Bug 说明】
   * 在 iOS 26 beta 的 Safari 中，WebSocket 连接本地网络地址时会永久卡在 CONNECTING 状态，
   * onopen/onerror/onclose 回调都不触发。奇怪的是，切换到其他 App 再切回来时连接会突然成功。
   *
   * 解决方案：二次连接法
   * 1. 第一次创建 WebSocket，它会卡住但能"激活"网络栈
   * 2. 等待 1 秒后检查状态，如果仍在 CONNECTING，关闭第一个连接
   * 3. 创建第二个 WebSocket，这次能正常连接
   */
  _doConnect(wsUrl) {
    // ====== iOS 26 Safari Workaround: 二次连接法 ======
    // 第一次连接：可能会卡在 CONNECTING，但能激活网络栈
    this.debugLog('1st WebSocket create');
    try {
      this.ws = new WebSocket(wsUrl);
      this.debugLog('1st create ok, state=' + this.ws.readyState);
    } catch (e) {
      this.debugLog('1st create failed: ' + e.message);
    }

    // 1 秒后检查：如果仍卡在 CONNECTING，关闭并创建第二个连接
    setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
        this.debugLog('1st still CONNECTING, close and retry');
        try { this.ws.close(); } catch (e) {}
        this.ws = null;

        // 第二次连接：此时网络栈已激活，连接应该能成功
        this.debugLog('2nd WebSocket create');
        try {
          this.ws = new WebSocket(wsUrl);
          this.debugLog('2nd create ok, state=' + this.ws.readyState);
          // 重新绑定事件到新的 WebSocket 实例
          this.bindWebSocketEvents();
        } catch (e) {
          this.debugLog('2nd create failed: ' + e.message);
          this.isConnecting = false;
          this.updateConnectStatus('failed', e.message);
        }
      } else {
        // 第一次连接成功（非 iOS 26 Safari，或已修复）
        this.debugLog('1st connection state: ' + (this.ws ? this.ws.readyState : 'null'));
      }
    }, 1000);
    // ====== End iOS 26 Workaround ======

    // 绑定事件到第一个 WebSocket 实例
    this.bindWebSocketEvents();
  },

  /**
   * 绑定 WebSocket 事件
   */
  bindWebSocketEvents() {
    if (!this.ws) return;

    const sessionId = this.currentSession;

    // 设置接收二进制数据
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.debugLog('onopen fired');
      this.isConnecting = false;
      this.shouldReconnect = true;
      this.reconnectAttempts = 0;

      // 清理重连计时器，避免重复连接
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }

      // 保存 ws 到 SessionManager
      const session = this.sessionManager.sessions.get(sessionId);
      if (session) {
        session.ws = this.ws;
        session.status = 'connected';
      }

      // 更新连接状态（终端已在 connectTerminal 中创建，不需要再调用 showTerminalView）
      this.debugLog('Connection success');
      this.updateConnectStatus('connected', '');

      // 更新悬浮按钮
      if (this.floatingButton) {
        this.floatingButton.update();
      }
    };

    this.ws.onmessage = (event) => {
      // 解析消息：支持 MessagePack 二进制和 JSON 文本
      let message;
      try {
        if (event.data instanceof ArrayBuffer) {
          // MessagePack 二进制消息
          message = MessagePack.decode(new Uint8Array(event.data));
        } else {
          // JSON 文本消息（兼容旧版本）
          message = JSON.parse(event.data);
        }
      } catch (e) {
        console.error('Failed to parse message:', e);
        return;
      }
      // 使用捕获的 sessionId，确保消息写入正确的 session 终端
      this.handleMessage(message, sessionId);
    };

    this.ws.onerror = (error) => {
      this.debugLog('onerror triggered');
      this.isConnecting = false;
      this.updateConnectStatus('error', this.t('status.checkNetwork'));
    };

    this.ws.onclose = (event) => {
      const now = new Date().toISOString().substr(11, 12);
      const codeNames = {
        1000: 'Normal Closure',
        1001: 'Going Away',
        1002: 'Protocol Error',
        1003: 'Unsupported Data',
        1005: 'No Status Received',
        1006: 'Abnormal Closure',
        1007: 'Invalid Payload',
        1008: 'Policy Violation',
        1009: 'Message Too Big',
        1010: 'Missing Extension',
        1011: 'Internal Error',
        1012: 'Service Restart',
        1013: 'Try Again Later',
        1015: 'TLS Handshake'
      };
      this.debugLog(`[${now}] onclose code=${event.code} (${codeNames[event.code] || 'Unknown'}), reason="${event.reason}"`);
      this.debugLog(`[${now}] onclose state: shouldReconnect=${this.shouldReconnect}, currentSession=${!!this.currentSession}`);

      this.isConnecting = false;
      this.updateConnectStatus('disconnected', `${this.t('status.code')}: ${event.code}`);
      this.updateStatus(this.t('status.disconnected'), false);

      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }

      // 1008 = Invalid token，需要重新登录
      if (event.code === 1008) {
        this.debugLog(`[${now}] Token invalid, redirect to login`);
        this.handleUnauthorized();
        return;
      }

      // 扩展重连条件：除了主动关闭(1000)和认证失败(1008)外都尝试重连
      if (this.shouldReconnect && this.currentSession) {
        if (event.code !== 1000) {
          this.debugLog(`[${now}] Triggering auto reconnect for code ${event.code}`);
          this.attemptReconnect();
        } else {
          this.debugLog(`[${now}] Normal closure, no auto reconnect`);
        }
      } else {
        this.debugLog(`[${now}] No reconnect: shouldReconnect=${this.shouldReconnect}, currentSession=${!!this.currentSession}`);
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
  },

  /**
   * 处理 WebSocket 消息
   * @param {object} message - 已解析的消息对象
   * @param {string} sessionId - 消息所属的 session ID
   */
  handleMessage(message, sessionId) {
    try {
      console.log('Received message:', message.type, 'for session:', sessionId?.substring(0, 8));

      // 获取消息对应的 session
      const session = sessionId ? this.sessionManager.sessions.get(sessionId) : null;

      switch (message.type) {
        case 'connecting':
          console.log('Session connecting:', message.message);
          this.updateStatus(this.t('status.connecting'), false);
          this.updateConnectStatus('connecting', this.t('status.startingSession'));
          break;

        case 'connected':
          this.debugLog('received connected message');
          this.updateConnectStatus('connected', '');
          this.updateStatus(this.t('status.connected'), true);
          // 终端已在 connectTerminal 中创建，只需 resize
          if (this.terminal) {
            this.debugLog('terminal already exists, just resize');
            setTimeout(() => {
              this.resizeTerminal();
            }, 100);
          }
          break;

        case 'output':
          console.log('Output received, data length:', message.data?.length);
          if (message.data) {
            // 使用 session 对应的终端，而不是全局 this.terminal
            const targetTerminal = session?.terminal || this.terminal;
            if (targetTerminal) {
              try {
                targetTerminal.write(message.data);
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
          this.updateConnectStatus('error', message.message);
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
  },

  /**
   * 发送消息 - 使用 MessagePack 二进制协议
   */
  sendMessage(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // 使用 MessagePack 二进制编码
      const packed = MessagePack.encode(data);
      this.ws.send(packed);
    }
  },

  /**
   * 发送输入
   */
  sendInput() {
    const inputRow = document.getElementById('input-row');
    const inputEl = inputRow?.querySelector('.input-field');
    if (!inputEl) return;

    const content = inputEl.value;

    // 清空输入框并重置高度（立即清空，避免重复发送）
    inputEl.value = '';
    inputEl.style.height = 'auto';

    // 必须分开发送：先发内容，再单独发回车
    // 加延迟避免时序问题
    if (content) {
      this.sendMessage({ type: 'input', data: content });
      // 延迟 100ms 再发送回车，避免时序问题
      setTimeout(() => {
        this.sendMessage({ type: 'input', data: '\r' });
      }, 100);
    } else {
      this.sendMessage({ type: 'input', data: '\r' });
    }
  },

  /**
   * 设置滚动按钮（⤒ ⤓）的单击/长按行为
   */
  setupScrollButton(btn, key) {
    const LONG_PRESS_DELAY = 200;  // 长按触发延迟
    const SCROLL_INTERVAL = 60;    // 持续滚动间隔
    const SCROLL_LINES = 3;        // 每次滚动行数

    let pressTimer = null;
    let scrollTimer = null;
    let isLongPress = false;

    const startScroll = () => {
      isLongPress = true;
      // 开始持续滚动
      scrollTimer = setInterval(() => {
        if (this.terminal && this.terminal.xterm) {
          const lines = key === 'top' ? -SCROLL_LINES : SCROLL_LINES;
          this.terminal.xterm.scrollLines(lines);
        }
      }, SCROLL_INTERVAL);
    };

    const stopScroll = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      if (scrollTimer) {
        clearInterval(scrollTimer);
        scrollTimer = null;
      }

      // 如果不是长按，执行单击跳转
      if (!isLongPress) {
        if (this.terminal && this.terminal.xterm) {
          if (key === 'top') {
            this.terminal.xterm.scrollToTop();
          } else {
            this.terminal.xterm.scrollToBottom();
          }
        }
      }
      isLongPress = false;
    };

    // 触摸事件
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      isLongPress = false;
      pressTimer = setTimeout(startScroll, LONG_PRESS_DELAY);
    }, { passive: false });

    btn.addEventListener('touchend', stopScroll);
    btn.addEventListener('touchcancel', stopScroll);

    // 鼠标事件（桌面端）
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isLongPress = false;
      pressTimer = setTimeout(startScroll, LONG_PRESS_DELAY);
    });

    btn.addEventListener('mouseup', stopScroll);
    btn.addEventListener('mouseleave', stopScroll);
  },

  /**
   * 发送按键
   */
  sendKey(key) {
    const keyMap = {
      // 导航
      'up': '\x1b[A',
      'down': '\x1b[B',
      // 中断/退出
      'escape': '\x1b',
      'ctrl-c': '\x03',
      // 输入/确认
      'tab': '\t',
      'enter': '\r',
      // 编辑
      'backspace': '\x7f',
      // 组合键
      'ctrl-o': '\x0f',      // 切换详细输出模式
      'ctrl-b': '\x02',      // 后台运行
      'esc-esc': '\x1b\x1b', // 回滚（双击 ESC）
      'shift-tab': '\x1b[Z', // 切换权限模式
    };

    // 斜杠命令（需要分两次发送：命令 + 回车）
    const cmdMap = {
      'cmd-resume': '/resume',
      'cmd-clear': '/clear',
      'cmd-help': '/help',
      'cmd-context': '/context',
      'cmd-memory': '/memory',
      'cmd-compact': '/compact',
    };

    // 处理斜杠命令：先发命令，再发回车
    if (cmdMap[key]) {
      // 方法1：直接连续发送两条消息
      this.sendMessage({ type: 'input', data: cmdMap[key] });
      this.sendMessage({ type: 'input', data: '\r' });
      return;
    }

    const sequence = keyMap[key];
    if (sequence) {
      this.sendMessage({
        type: 'input',
        data: sequence
      });
    }
  },

  /**
   * 尝试重连
   */
  attemptReconnect() {
    const now = new Date().toISOString().substr(11, 12);
    this.debugLog(`[${now}] attemptReconnect called`);

    // 检查连接锁
    if (this.isConnecting) {
      this.debugLog(`[${now}] connecting (locked), skip reconnect`);
      return;
    }

    // 清理之前的重连定时器
    if (this.reconnectTimeout) {
      this.debugLog(`[${now}] clearing previous reconnect timer`);
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.debugLog(`[${now}] max reconnect attempts (${this.maxReconnectAttempts}) reached, giving up`);
      this.updateStatus(this.t('reconnect.failed'), false);
      return;
    }

    this.reconnectAttempts++;
    // 首次重连延迟 500ms，后续指数退避
    const delay = this.reconnectAttempts === 1 ? 500 : Math.min(1000 * Math.pow(2, this.reconnectAttempts - 2), 10000);

    this.debugLog(`[${now}] reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts}, delay=${delay}ms`);
    this.updateStatus(`${this.t('reconnect.trying')} (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`, false);

    this.reconnectTimeout = setTimeout(() => {
      const execNow = new Date().toISOString().substr(11, 12);
      this.debugLog(`[${execNow}] reconnect timer fired`);
      if (this.shouldReconnect && this.currentSession && !this.isConnecting) {
        this.debugLog(`[${execNow}] execute reconnect to session ${this.currentSession.substring(0, 8)}`);
        this.isConnecting = true;  // 设置连接锁
        this.connect(this.currentSession, true);  // isReconnect=true，不重置计数器
      } else {
        this.debugLog(`[${execNow}] cancel reconnect: shouldReconnect=${this.shouldReconnect}, currentSession=${!!this.currentSession}, isConnecting=${this.isConnecting}`);
      }
    }, delay);
  },

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
  },

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
      // 减少列数，让内容显示更宽松
      const adjustedCols = Math.max(size.cols - 3, 20);
      console.log('Terminal resized to:', size.rows, 'x', adjustedCols, '(original:', size.cols, ')');
      this.sendMessage({
        type: 'resize',
        rows: size.rows,
        cols: adjustedCols
      });
    }, 50);
  },

  /**
   * 断开连接
   */
  disconnect() {
    this.debugLog('disconnect called');
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

    // 清理倒计时定时器
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
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

    // 关闭更多按键面板
    this.closeMoreKeysPanel();

    this.currentSession = null;
  }
};

// 导出到全局
window.AppWebSocket = AppWebSocket;
