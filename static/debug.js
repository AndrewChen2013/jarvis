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
 * 调试模块
 * 提供调试日志、调试面板和远程日志回传功能
 */
const AppDebug = {
  /**
   * 初始化远程日志属性（mixin 只复制函数，需要手动初始化属性）
   */
  _initRemoteLogProps() {
    if (this._remoteLogPropsInited) return;
    this._remoteLogPropsInited = true;
    this._remoteLogEnabled = false;
    this._remoteLogWs = null;
    this._remoteLogBuffer = [];
    this._remoteLogFlushTimer = null;
    this._remoteLogReconnectTimer = null;
    this._remoteLogReconnectAttempts = 0;
    this._remoteLogMaxReconnectAttempts = 5;
    this._remoteLogBufferMaxSize = 100;
    this._remoteLogFlushInterval = 2000; // 2秒批量发送
    this._clientId = null;
  },

  /**
   * 生成客户端 ID
   */
  _generateClientId() {
    this._initRemoteLogProps();
    if (!this._clientId) {
      // 使用 UA + 时间戳生成唯一 ID
      const ua = navigator.userAgent.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
      const ts = Date.now().toString(36);
      const rand = Math.random().toString(36).substring(2, 6);
      this._clientId = `${ua}-${ts}-${rand}`;
    }
    return this._clientId;
  },

  /**
   * 日志上限配置
   */
  _maxLogEntries: 500,
  _trimLogCount: 200,

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

    // 超过上限时清理旧日志
    if (this.debugLogs.length > this._maxLogEntries) {
      this.debugLogs = this.debugLogs.slice(-this._trimLogCount);
      // 重建 DOM 内容
      const content = document.getElementById('debug-log-content');
      if (content) {
        content.innerHTML = this.debugLogs.join('<br>') + '<br>';
      }
    } else {
      // 正常追加
      const content = document.getElementById('debug-log-content');
      if (content) {
        content.innerHTML += logLine + '<br>';
        content.scrollTop = content.scrollHeight;
      }
    }

    // 远程日志回传
    if (this._remoteLogEnabled) {
      this._bufferRemoteLog({
        timestamp: now.toISOString(),
        level: 'debug',
        message: msg,
        clientId: this._generateClientId()
      });
    }
  },

  /**
   * 缓存远程日志
   */
  _bufferRemoteLog(logEntry) {
    this._initRemoteLogProps();
    this._remoteLogBuffer.push(logEntry);

    // 缓冲区满时立即发送
    if (this._remoteLogBuffer.length >= this._remoteLogBufferMaxSize) {
      this._flushRemoteLogs();
    } else if (!this._remoteLogFlushTimer) {
      // 设置定时发送
      this._remoteLogFlushTimer = setTimeout(() => {
        this._flushRemoteLogs();
      }, this._remoteLogFlushInterval);
    }
  },

  /**
   * 发送缓存的远程日志
   */
  _flushRemoteLogs() {
    this._initRemoteLogProps();
    if (this._remoteLogFlushTimer) {
      clearTimeout(this._remoteLogFlushTimer);
      this._remoteLogFlushTimer = null;
    }

    if (this._remoteLogBuffer.length === 0) return;

    const logs = [...this._remoteLogBuffer];
    this._remoteLogBuffer = [];

    // WebSocket 健康时优先使用
    const wsHealthy = this._remoteLogWs &&
                      this._remoteLogWs.readyState === WebSocket.OPEN &&
                      !this._remoteLogWsUnhealthy;

    if (wsHealthy) {
      try {
        this._remoteLogWs.send(JSON.stringify({
          type: 'logs',
          logs: logs
        }));
        // 发送成功，清理本地日志
        this._clearLocalLogs(logs.length);
        return;
      } catch (e) {
        console.warn('[RemoteLog] WebSocket send failed, switching to HTTP:', e);
        // 标记 WebSocket 不健康，后续优先用 HTTP
        this._remoteLogWsUnhealthy = true;
        this._updateRemoteLogStatus('error');
      }
    }

    // WebSocket 不可用或不健康，使用 HTTP 备份链路
    this._sendLogsViaHttp(logs);
  },

  /**
   * 通过 HTTP 发送日志
   */
  async _sendLogsViaHttp(logs) {
    try {
      const response = await fetch('/api/debug/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token || ''}`
        },
        body: JSON.stringify({
          clientId: this._generateClientId(),
          logs: logs
        })
      });

      if (response.ok) {
        // 发送成功，清理本地日志
        this._clearLocalLogs(logs.length);
      } else {
        console.warn('[RemoteLog] HTTP send failed:', response.status);
      }
    } catch (e) {
      console.warn('[RemoteLog] HTTP send error:', e);
    }
  },

  /**
   * 清理已发送的本地日志
   */
  _clearLocalLogs(count) {
    if (!this.debugLogs || this.debugLogs.length === 0) return;

    // 移除已发送的日志（从头部移除）
    this.debugLogs = this.debugLogs.slice(count);

    // 更新 DOM
    const content = document.getElementById('debug-log-content');
    if (content) {
      if (this.debugLogs.length === 0) {
        content.innerHTML = '';
      } else {
        content.innerHTML = this.debugLogs.join('<br>') + '<br>';
      }
    }
  },

  /**
   * 启动远程日志服务
   */
  startRemoteLog() {
    this._initRemoteLogProps();
    if (this._remoteLogEnabled) return;

    this._remoteLogEnabled = true;
    this._remoteLogReconnectAttempts = 0;
    console.log('[RemoteLog] Starting remote log service...');

    this._connectRemoteLogWs();
  },

  /**
   * 连接远程日志 WebSocket
   */
  _connectRemoteLogWs() {
    this._initRemoteLogProps();
    if (this._remoteLogWs) {
      try {
        this._remoteLogWs.close();
      } catch (e) {}
    }

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/debug?client_id=${encodeURIComponent(this._generateClientId())}`;

    try {
      this._remoteLogWs = new WebSocket(wsUrl);

      this._remoteLogWs.onopen = () => {
        console.log('[RemoteLog] WebSocket connected');
        this._remoteLogReconnectAttempts = 0;
        this._remoteLogWsUnhealthy = false;  // 重置健康状态

        // 发送认证
        if (this.token) {
          this._remoteLogWs.send(JSON.stringify({
            type: 'auth',
            token: this.token
          }));
        }

        // 更新状态指示器
        this._updateRemoteLogStatus('connected');
      };

      this._remoteLogWs.onclose = () => {
        console.log('[RemoteLog] WebSocket closed');
        this._updateRemoteLogStatus('disconnected');

        // 自动重连
        if (this._remoteLogEnabled && this._remoteLogReconnectAttempts < this._remoteLogMaxReconnectAttempts) {
          this._remoteLogReconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, this._remoteLogReconnectAttempts - 1), 30000);
          console.log(`[RemoteLog] Reconnecting in ${delay}ms (attempt ${this._remoteLogReconnectAttempts})`);

          this._remoteLogReconnectTimer = setTimeout(() => {
            this._connectRemoteLogWs();
          }, delay);
        }
      };

      this._remoteLogWs.onerror = (e) => {
        console.warn('[RemoteLog] WebSocket error');
        this._updateRemoteLogStatus('error');
      };

      this._remoteLogWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'ack') {
            // 服务器确认收到
          }
        } catch (e) {}
      };

    } catch (e) {
      console.warn('[RemoteLog] Failed to create WebSocket:', e);
      this._updateRemoteLogStatus('error');
    }
  },

  /**
   * 停止远程日志服务
   */
  stopRemoteLog() {
    this._initRemoteLogProps();
    this._remoteLogEnabled = false;

    if (this._remoteLogReconnectTimer) {
      clearTimeout(this._remoteLogReconnectTimer);
      this._remoteLogReconnectTimer = null;
    }

    if (this._remoteLogFlushTimer) {
      clearTimeout(this._remoteLogFlushTimer);
      this._remoteLogFlushTimer = null;
    }

    // 发送剩余日志
    this._flushRemoteLogs();

    if (this._remoteLogWs) {
      try {
        this._remoteLogWs.close();
      } catch (e) {}
      this._remoteLogWs = null;
    }

    this._updateRemoteLogStatus('stopped');
    console.log('[RemoteLog] Stopped');
  },

  /**
   * 更新远程日志状态指示器
   */
  _updateRemoteLogStatus(status) {
    const indicator = document.getElementById('remote-log-status');
    if (indicator) {
      const colors = {
        'connected': '#0f0',
        'disconnected': '#f80',
        'error': '#f00',
        'stopped': '#888'
      };
      indicator.style.backgroundColor = colors[status] || '#888';
      indicator.title = `Remote Log: ${status}`;
    }
  },

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
    header.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:10px;border-bottom:1px solid #333;';

    // 第一行：标题和状态
    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';

    const titleArea = document.createElement('div');
    titleArea.style.cssText = 'display:flex;align-items:center;gap:10px;';
    titleArea.innerHTML = `<span style="color:#0f0;font-weight:bold;">${this.t('debug.title')}</span>`;

    // 远程日志状态指示器
    const statusIndicator = document.createElement('span');
    statusIndicator.id = 'remote-log-status';
    statusIndicator.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#888;display:inline-block;';
    statusIndicator.title = 'Remote Log: stopped';
    titleArea.appendChild(statusIndicator);

    titleRow.appendChild(titleArea);

    // 关闭按钮放标题行右侧
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'padding:5px 10px;background:#c00;color:#fff;border:none;border-radius:4px;font-size:14px;';
    closeBtn.onclick = () => this.toggleDebugPanel();
    titleRow.appendChild(closeBtn);

    header.appendChild(titleRow);

    // 第二行：功能按钮（均匀分布）
    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:8px;';

    // 远程日志开关按钮
    const remoteLogBtn = document.createElement('button');
    remoteLogBtn.id = 'remote-log-toggle';
    remoteLogBtn.textContent = this.t('debug.remoteLog', 'Remote');
    remoteLogBtn.style.cssText = 'padding:5px 12px;background:#333;color:#fff;border:none;border-radius:4px;';
    remoteLogBtn.onclick = () => {
      if (this._remoteLogEnabled) {
        this.stopRemoteLog();
        remoteLogBtn.style.background = '#333';
      } else {
        this.startRemoteLog();
        remoteLogBtn.style.background = '#060';
      }
    };

    // API 日志开关按钮
    const apiLogBtn = document.createElement('button');
    apiLogBtn.id = 'api-log-toggle';
    apiLogBtn.textContent = 'API';
    apiLogBtn.style.cssText = 'padding:5px 12px;background:#333;color:#fff;border:none;border-radius:4px;';
    apiLogBtn.onclick = () => {
      if (this._apiLogEnabled) {
        this.disableApiLog();
        apiLogBtn.style.background = '#333';
      } else {
        this.enableApiLog();
        apiLogBtn.style.background = '#063';
        // 同时开启 Remote
        if (!this._remoteLogEnabled) {
          this.startRemoteLog();
          remoteLogBtn.style.background = '#060';
        }
      }
    };

    // 复制按钮
    const copyBtn = document.createElement('button');
    copyBtn.textContent = this.t('debug.copy');
    copyBtn.style.cssText = 'padding:5px 12px;background:#333;color:#fff;border:none;border-radius:4px;';
    copyBtn.onclick = () => {
      const text = (window.app?.debugLogs || []).join('\n');
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      copyBtn.textContent = this.t('debug.copied');
      setTimeout(() => copyBtn.textContent = this.t('debug.copy'), 1000);
    };

    // 清除按钮
    const clearBtn = document.createElement('button');
    clearBtn.textContent = this.t('debug.clear');
    clearBtn.style.cssText = 'padding:5px 12px;background:#333;color:#fff;border:none;border-radius:4px;';
    clearBtn.onclick = () => {
      this.debugLogs = [];
      const content = document.getElementById('debug-log-content');
      if (content) content.innerHTML = '';
    };

    // Chat 模式按钮
    const chatBtn = document.createElement('button');
    chatBtn.textContent = 'Chat';
    chatBtn.style.cssText = 'padding:5px 12px;background:#333;color:#fff;border:none;border-radius:4px;';
    chatBtn.onclick = () => {
      const session = this.sessionManager?.getActive();
      if (session && session.workDir) {
        this.showChat(session.id, session.workDir);
        this.toggleDebugPanel(); // 关闭调试面板
      } else {
        this.debugLog('[Debug] No active session for chat mode');
      }
    };

    btnGroup.appendChild(remoteLogBtn);
    btnGroup.appendChild(apiLogBtn);
    btnGroup.appendChild(chatBtn);
    btnGroup.appendChild(copyBtn);
    btnGroup.appendChild(clearBtn);
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
  },

  /**
   * 切换调试面板显示
   */
  toggleDebugPanel() {
    this.initDebugPanel();
    const panel = document.getElementById('debug-panel');
    if (panel) {
      const isVisible = panel.style.display === 'flex';
      panel.style.display = isVisible ? 'none' : 'flex';
      // 保存状态到 localStorage
      localStorage.setItem('debug_panel_visible', isVisible ? 'false' : 'true');
    }
  },

  /**
   * 恢复调试面板状态（页面加载时调用）
   */
  restoreDebugPanel() {
    const isVisible = localStorage.getItem('debug_panel_visible') === 'true';
    if (isVisible) {
      this.initDebugPanel();
      const panel = document.getElementById('debug-panel');
      if (panel) {
        panel.style.display = 'flex';
      }
    }
  },

  /**
   * 重置调试面板（语言切换时调用）
   */
  resetDebugPanel() {
    const panel = document.getElementById('debug-panel');
    if (panel) {
      panel.remove();
    }
  },

  /**
   * 设置全局异常捕获
   */
  setupGlobalErrorHandler() {
    // 捕获同步错误
    window.onerror = (message, source, lineno, colno, error) => {
      const errorInfo = `JS Error: ${message} at ${source}:${lineno}:${colno}`;
      this.debugLog(`[ERROR] ${errorInfo}`);

      // 异常时强制用 HTTP 发送，确保不丢失
      this._sendErrorViaHttp({
        type: 'error',
        message: String(message),
        source: source,
        line: lineno,
        column: colno,
        stack: error?.stack || '',
        timestamp: new Date().toISOString(),
        clientId: this._generateClientId?.() || 'unknown'
      });

      return false; // 继续默认处理
    };

    // 捕获未处理的 Promise rejection
    window.onunhandledrejection = (event) => {
      const reason = event.reason;
      const message = reason?.message || String(reason);
      const stack = reason?.stack || '';

      this.debugLog(`[UNHANDLED REJECTION] ${message}`);

      this._sendErrorViaHttp({
        type: 'unhandledrejection',
        message: message,
        stack: stack,
        timestamp: new Date().toISOString(),
        clientId: this._generateClientId?.() || 'unknown'
      });
    };

    console.log('[Debug] Global error handler installed');
  },

  /**
   * 通过 HTTP 直接发送错误（绕过缓冲区，确保不丢失）
   */
  async _sendErrorViaHttp(errorData) {
    try {
      await fetch('/api/debug/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token || ''}`
        },
        body: JSON.stringify({
          clientId: errorData.clientId,
          logs: [{
            timestamp: errorData.timestamp,
            level: 'error',
            message: JSON.stringify(errorData),
            clientId: errorData.clientId
          }]
        })
      });
    } catch (e) {
      // 发送失败也不能抛错，避免死循环
      console.warn('[Debug] Failed to send error to backend:', e);
    }
  },

  /**
   * API 请求日志开关
   */
  _apiLogEnabled: false,
  _originalFetch: null,

  /**
   * 启用 API 请求日志
   */
  enableApiLog() {
    if (this._apiLogEnabled) return;
    this._apiLogEnabled = true;

    // 保存原始 fetch
    if (!this._originalFetch) {
      this._originalFetch = window.fetch.bind(window);
    }

    const self = this;

    // 拦截 fetch
    window.fetch = async function(input, init) {
      const url = typeof input === 'string' ? input : input.url;

      // 跳过 debug API 自身，避免死循环
      if (url.includes('/api/debug/') || url.includes('/ws/debug')) {
        return self._originalFetch(input, init);
      }

      const method = init?.method || 'GET';
      const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
      const startTime = performance.now();

      // 记录请求
      let requestBody = null;
      if (init?.body) {
        try {
          requestBody = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
        } catch {
          requestBody = String(init.body).substring(0, 500);
        }
      }

      self.debugLog(`[API] → ${method} ${url.substring(0, 80)} #${requestId}`);

      try {
        const response = await self._originalFetch(input, init);
        const duration = Math.round(performance.now() - startTime);

        // 克隆响应以便读取 body
        const clonedResponse = response.clone();

        // 尝试解析响应
        let responseBody = null;
        try {
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            responseBody = await clonedResponse.json();
          } else {
            const text = await clonedResponse.text();
            responseBody = text.substring(0, 500);
          }
        } catch {
          responseBody = '[Failed to parse response]';
        }

        // 记录响应
        const status = response.status;
        const logLevel = status >= 400 ? 'ERROR' : 'OK';
        self.debugLog(`[API] ← ${status} ${method} ${url.substring(0, 60)} ${duration}ms #${requestId}`);

        // 详细日志（仅在出错或响应较小时记录详情）
        if (status >= 400 || (responseBody && JSON.stringify(responseBody).length < 1000)) {
          self._logApiDetail(requestId, {
            url, method, status, duration,
            request: requestBody,
            response: responseBody
          });
        }

        return response;
      } catch (error) {
        const duration = Math.round(performance.now() - startTime);
        self.debugLog(`[API] ✗ ${method} ${url.substring(0, 60)} ${duration}ms - ${error.message} #${requestId}`);

        self._logApiDetail(requestId, {
          url, method, duration,
          request: requestBody,
          error: error.message
        });

        throw error;
      }
    };

    console.log('[Debug] API logging enabled');
  },

  /**
   * 禁用 API 请求日志
   */
  disableApiLog() {
    if (!this._apiLogEnabled) return;
    this._apiLogEnabled = false;

    if (this._originalFetch) {
      window.fetch = this._originalFetch;
    }

    console.log('[Debug] API logging disabled');
  },

  /**
   * 记录 API 详情
   */
  _logApiDetail(requestId, detail) {
    // 通过 debugLog 记录，会自动走远程日志通道
    const detailStr = JSON.stringify(detail, null, 0);
    if (detailStr.length < 2000) {
      this.debugLog(`[API-DETAIL] #${requestId} ${detailStr}`);
    } else {
      this.debugLog(`[API-DETAIL] #${requestId} ${detailStr.substring(0, 2000)}... (truncated)`);
    }
  }
};

// 导出到全局
window.AppDebug = AppDebug;

// 立即安装全局异常捕获（尽早捕获错误）
AppDebug.setupGlobalErrorHandler();
