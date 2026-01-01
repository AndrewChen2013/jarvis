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
 * Claude Remote - 主应用
 *
 * 模块化架构：
 * - utils.js: 工具函数
 * - debug.js: 调试面板
 * - dialogs.js: 对话框、Toast、帮助面板
 * - settings.js: 设置、用量显示
 * - projects.js: 项目和会话管理
 * - websocket.js: WebSocket 连接、终端控制
 */
class App {
  constructor() {
    this.token = localStorage.getItem('auth_token') || '';
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

    // 多 Session 管理
    this.sessionManager = new SessionManager(this);
    this.floatingButton = new FloatingButton(this);

    // 下拉刷新状态
    this.pullRefresh = {
      startY: 0,
      pulling: false,
      refreshing: false,
      dataThreshold: 80,    // 刷新数据阈值
      reloadThreshold: 160, // 刷新页面阈值
      maxPull: 200          // 最大下拉距离
    };

    this.init();
  }

  /**
   * 获取翻译文本
   */
  t(key, fallback) {
    return window.i18n ? window.i18n.t(key, fallback) : (fallback || key);
  }

  init() {
    // 初始化国际化
    if (window.i18n) {
      window.i18n.init();
    }

    // 绑定事件（包括登录表单）
    this.bindEvents();

    // 检查认证状态
    this.checkAuth();

    // 监听页面可见性变化（iOS Safari 挂起/恢复）
    document.addEventListener('visibilitychange', () => {
      const now = new Date().toISOString().substr(11, 12);
      if (document.hidden) {
        this.debugLog(`[${now}] page hidden`);
      } else {
        this.debugLog(`[${now}] page visible`);
        // 详细记录当前状态
        this.debugLog(`[${now}] visibility check: currentSession=${!!this.currentSession}, shouldReconnect=${this.shouldReconnect}, isConnecting=${this.isConnecting}`);
        if (this.ws) {
          const stateNames = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
          this.debugLog(`[${now}] ws.readyState=${this.ws.readyState} (${stateNames[this.ws.readyState]})`);
        } else {
          this.debugLog(`[${now}] ws=null`);
        }

        // 如果连接已断开或正在关闭，尝试重连
        if (this.currentSession && this.shouldReconnect && !this.isConnecting) {
          // 扩展检查：CLOSING(2) 和 CLOSED(3) 都应该重连
          if (!this.ws || this.ws.readyState >= WebSocket.CLOSING) {
            this.debugLog(`[${now}] page visible, triggering reconnect`);
            this.attemptReconnect();
          } else {
            this.debugLog(`[${now}] ws still open/connecting, no reconnect needed`);
          }
        } else {
          this.debugLog(`[${now}] reconnect conditions not met`);
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

    // 初始化下拉刷新
    this.initPullRefresh();

    // 初始化软键盘适配（防止工具栏被顶走）
    this.initKeyboardHandler();
  }

  /**
   * 初始化软键盘适配
   * 软键盘弹出时，使用 visualViewport API 让工具栏和相关按钮固定在可视区域
   */
  initKeyboardHandler() {
    const toolbar = document.querySelector('#terminal-view .toolbar');
    const fontControls = document.querySelector('.font-controls-float');
    if (!toolbar) return;

    // 使用 visualViewport API（iOS Safari 支持）
    if (window.visualViewport) {
      const updatePositions = () => {
        // visualViewport.offsetTop 是可视区域相对于布局视口的偏移
        // 当软键盘弹出时，页面会往上推，offsetTop 变成负值或视口变小
        const offsetTop = window.visualViewport.offsetTop;

        // 工具栏
        toolbar.style.transform = `translateY(${offsetTop}px)`;

        // 字体控制按钮
        if (fontControls) {
          fontControls.style.transform = `translateY(${offsetTop}px)`;
        }

        // 悬浮按钮
        if (this.floatingButton && this.floatingButton.element) {
          this.floatingButton.element.style.transform = `translateY(${offsetTop}px)`;
        }
      };

      window.visualViewport.addEventListener('resize', updatePositions);
      window.visualViewport.addEventListener('scroll', updatePositions);

      this.debugLog('initKeyboardHandler: visualViewport listener added');
    } else {
      this.debugLog('initKeyboardHandler: visualViewport not supported');
    }
  }

  /**
   * 初始化下拉刷新
   */
  initPullRefresh() {
    const main = document.getElementById('sessions-main');
    const pullRefresh = document.getElementById('pull-refresh');
    const sessionsList = document.getElementById('sessions-list');

    if (!main || !pullRefresh || !sessionsList) return;

    let startY = 0;
    let currentY = 0;
    let pulling = false;

    main.addEventListener('touchstart', (e) => {
      // 只在滚动到顶部时才启用下拉刷新
      if (main.scrollTop <= 0 && !this.pullRefresh.refreshing) {
        startY = e.touches[0].clientY;
        pulling = true;
      }
    }, { passive: true });

    main.addEventListener('touchmove', (e) => {
      if (!pulling || this.pullRefresh.refreshing) return;

      currentY = e.touches[0].clientY;
      const deltaY = currentY - startY;

      // 只处理向下拉
      if (deltaY > 0 && main.scrollTop <= 0) {
        e.preventDefault();

        // 计算下拉距离（带阻尼效果）
        const pullDistance = Math.min(deltaY * 0.5, this.pullRefresh.maxPull);

        // 更新 UI
        pullRefresh.style.transform = `translateY(${pullDistance}px)`;
        sessionsList.style.transform = `translateY(${pullDistance}px)`;

        // 更新状态 - 两段式提示
        const textEl = pullRefresh.querySelector('.pull-refresh-text');
        if (pullDistance >= this.pullRefresh.reloadThreshold) {
          // 大幅下拉 - 刷新页面
          pullRefresh.classList.add('pulling', 'reload-mode');
          if (textEl) textEl.textContent = '⟳ ' + this.t('sessions.releaseToReload', '释放刷新页面');
        } else if (pullDistance >= this.pullRefresh.dataThreshold) {
          // 常规下拉 - 刷新数据
          pullRefresh.classList.add('pulling');
          pullRefresh.classList.remove('reload-mode');
          if (textEl) textEl.textContent = '↻ ' + this.t('sessions.releaseToRefresh', '释放刷新数据');
        } else {
          pullRefresh.classList.remove('pulling', 'reload-mode');
          if (textEl) textEl.textContent = this.t('sessions.pullToRefresh', '下拉刷新');
        }
      }
    }, { passive: false });

    main.addEventListener('touchend', async () => {
      if (!pulling) return;
      pulling = false;

      const deltaY = currentY - startY;
      const pullDistance = Math.min(deltaY * 0.5, this.pullRefresh.maxPull);

      if (pullDistance >= this.pullRefresh.reloadThreshold && !this.pullRefresh.refreshing) {
        // 大幅下拉 - 刷新整个页面
        location.reload();
      } else if (pullDistance >= this.pullRefresh.dataThreshold && !this.pullRefresh.refreshing) {
        // 常规下拉 - 只刷新数据
        this.pullRefresh.refreshing = true;
        const textEl = pullRefresh.querySelector('.pull-refresh-text');
        if (textEl) textEl.textContent = this.t('sessions.refreshing', '刷新中...');

        try {
          await this.loadSessions();
          await this.loadSystemInfo();
        } catch (e) {
          console.error('Refresh data error:', e);
        }

        // 恢复位置
        pullRefresh.style.transform = '';
        sessionsList.style.transform = '';
        pullRefresh.classList.remove('pulling', 'reload-mode');
        this.pullRefresh.refreshing = false;
      } else {
        // 未达到阈值，恢复位置
        pullRefresh.style.transform = '';
        sessionsList.style.transform = '';
        pullRefresh.classList.remove('pulling', 'reload-mode');
      }

      startY = 0;
      currentY = 0;
    }, { passive: true });
  }

  bindEvents() {
    // 登录表单提交
    document.getElementById('login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleLogin();
    });

    // 退出按钮
    document.getElementById('logout-btn').addEventListener('click', () => {
      this.handleLogout();
    });

    // 设置按钮
    document.getElementById('settings-btn').addEventListener('click', () => {
      this.openSettingsModal();
    });

    // 关闭设置模态框
    document.getElementById('settings-modal-close').addEventListener('click', () => {
      this.closeSettingsModal();
    });

    // 点击设置模态框背景关闭
    document.getElementById('settings-modal').addEventListener('click', (e) => {
      if (e.target.id === 'settings-modal') {
        this.closeSettingsModal();
      }
    });

    // 设置菜单项点击 - 语言
    document.getElementById('menu-language').addEventListener('click', () => {
      this.showSettingsPage('language');
    });

    // 设置菜单项点击 - 修改密码
    document.getElementById('menu-password').addEventListener('click', () => {
      this.showSettingsPage('password');
    });

    // 设置返回按钮
    document.getElementById('settings-back-btn').addEventListener('click', () => {
      this.showSettingsMenu();
    });

    // 修改密码表单
    document.getElementById('change-password-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleChangePassword();
    });

    // 会话列表帮助按钮
    document.getElementById('sessions-help-btn').addEventListener('click', (e) => {
      this.toggleSessionsHelpPanel(e);
    });

    // 会话列表帮助关闭按钮
    document.getElementById('sessions-help-close').addEventListener('click', () => {
      this.closeSessionsHelpPanel();
    });

    // 用量抽屉切换按钮
    document.getElementById('usage-toggle-btn').addEventListener('click', () => {
      this.toggleUsageDrawer();
    });

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
      const key = btn.dataset.key;

      // 跳过展开更多按钮
      if (btn.id === 'more-keys-btn') return;

      // ⤒ ⤓ 按钮：支持单击跳转和长按持续滚动
      if (key === 'top' || key === 'bottom') {
        this.setupScrollButton(btn, key);
      } else {
        btn.addEventListener('click', () => {
          console.log('Key pressed:', key);
          this.sendKey(key);
          // 如果按钮在展开面板内，自动收起面板
          if (btn.closest('#more-keys-panel')) {
            this.closeMoreKeysPanel();
          }
        });
      }
    });

    // 展开更多按键按钮
    document.getElementById('more-keys-btn').addEventListener('click', () => {
      this.toggleMoreKeysPanel();
    });

    // 字体大小调整
    document.getElementById('font-decrease').addEventListener('click', () => {
      this.adjustFontSize(-1);
    });

    document.getElementById('font-increase').addEventListener('click', () => {
      this.adjustFontSize(1);
    });

    // Context 展开/收起按钮
    document.getElementById('context-toggle').addEventListener('click', () => {
      this.toggleContextPanel();
    });

    // 返回按钮 - 关闭session
    document.getElementById('back-btn').addEventListener('click', () => {
      this.debugLog('back button clicked (close session)');
      this.closeCurrentSession();
    });

    // 收起按钮 - 放入后台，保持连接
    const minimizeBtn = document.getElementById('minimize-btn');
    if (minimizeBtn) {
      this.debugLog('minimize button bindend');
      minimizeBtn.addEventListener('click', () => {
        this.debugLog('minimize button clicked');
        this.minimizeCurrentSession();
      });
    } else {
      this.debugLog('warning: minimize button not found!');
    }

  }

  // ==================== 认证相关 ====================

  /**
   * 检查认证状态
   */
  async checkAuth() {
    // 如果没有 token，显示登录页
    if (!this.token) {
      this.showView('login');
      return;
    }

    // 验证 token 是否有效
    try {
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (response.ok) {
        // token 有效，显示会话列表
        // 注意：showView('sessions') 内部会调用 loadSessions()，不要重复调用
        this.showView('sessions');
        this.loadSystemInfo();
        this.loadAccountInfo();
        this.loadUsageSummary();
      } else {
        // token 无效，清除并显示登录页
        this.clearAuth();
        this.showView('login');
        this.showLoginError(this.t('login.tokenExpired'));
      }
    } catch (error) {
      console.error('Auth check error:', error);
      // 网络错误，尝试使用缓存的 token
      // 注意：showView('sessions') 内部会调用 loadSessions()，不要重复调用
      this.showView('sessions');
    }
  }

  /**
   * 处理登录
   */
  async handleLogin() {
    const tokenInput = document.getElementById('login-token');
    const loginBtn = document.getElementById('login-btn');
    const token = tokenInput.value.trim();

    if (!token) {
      this.showLoginError(this.t('login.placeholder'));
      return;
    }

    // 禁用按钮，显示加载状态
    loginBtn.disabled = true;
    loginBtn.textContent = this.t('login.verifying');
    this.showLoginError('');

    try {
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        // 登录成功，保存 token
        this.token = token;
        localStorage.setItem('auth_token', token);

        // 清空输入框
        tokenInput.value = '';

        // 显示会话列表
        // 注意：showView('sessions') 内部会调用 loadSessions()，不要重复调用
        this.showView('sessions');
        this.loadSystemInfo();
        this.loadAccountInfo();
        this.loadUsageSummary();
      } else {
        this.showLoginError(this.t('login.tokenInvalid'));
      }
    } catch (error) {
      console.error('Login error:', error);
      this.showLoginError(this.t('login.networkError'));
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = this.t('login.button');
    }
  }

  /**
   * 处理退出登录
   */
  handleLogout() {
    if (!confirm(this.t('confirm.logout'))) return;

    this.clearAuth();
    // 关闭所有 session
    this.sessionManager.closeAll();
    this.disconnect();
    this.showView('login');
  }

  /**
   * 清除认证信息
   */
  clearAuth() {
    this.token = '';
    localStorage.removeItem('auth_token');
  }

  /**
   * 显示登录错误
   */
  showLoginError(message) {
    const errorEl = document.getElementById('login-error');
    if (errorEl) {
      errorEl.textContent = message;
    }
  }

  /**
   * 处理 401 未授权响应
   */
  handleUnauthorized() {
    this.clearAuth();
    this.disconnect();
    this.showView('login');
    this.showLoginError(this.t('login.sessionExpired'));
  }

  // ==================== 视图管理 ====================

  /**
   * 显示视图
   */
  showView(viewName) {
    this.debugLog('showView: ' + viewName);
    document.querySelectorAll('.view').forEach(view => {
      view.classList.remove('active');
    });
    this.debugLog('remove active done');

    document.getElementById(`${viewName}-view`).classList.add('active');
    this.debugLog('add active done');

    // 动态创建/销毁 input
    const inputRow = document.getElementById('input-row');
    let input = inputRow.querySelector('.input-field');

    if (viewName === 'terminal') {
      if (!input) {
        input = document.createElement('textarea');
        input.className = 'input-field';
        input.autocomplete = 'off';
        input.rows = 1;
        input.placeholder = this.t('terminal.inputPlaceholder');

        // 监听输入法
        input.addEventListener('compositionstart', () => { this.isComposing = true; });
        input.addEventListener('compositionend', () => { this.isComposing = false; });

        // 回车发送（Shift+Enter 换行）
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey && !this.isComposing) {
            e.preventDefault();
            this.sendInput();
          }
        });

        // 自动调整高度
        input.addEventListener('input', () => {
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 300) + 'px';
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
      this.loadUsageSummary();
      // 更新悬浮按钮状态
      if (this.floatingButton) {
        this.floatingButton.update();
      }
    }
  }
}

// ==================== Mixin: 混入模块方法 ====================

/**
 * 将模块方法混入 App 原型
 */
function mixinModule(module) {
  Object.keys(module).forEach(key => {
    if (typeof module[key] === 'function') {
      App.prototype[key] = module[key];
    }
  });
}

// 混入所有模块
if (window.AppUtils) mixinModule(window.AppUtils);
if (window.AppDebug) mixinModule(window.AppDebug);
if (window.AppDialogs) mixinModule(window.AppDialogs);
if (window.AppSettings) mixinModule(window.AppSettings);
if (window.AppProjects) mixinModule(window.AppProjects);
if (window.AppWebSocket) mixinModule(window.AppWebSocket);

// 页面加载完成后初始化
window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
