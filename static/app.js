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

    // 刷新用量按钮
    document.getElementById('refresh-usage').addEventListener('click', () => {
      this.loadUsageSummary();
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
        this.showView('sessions');
        this.loadSessions();
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
      this.showView('sessions');
      this.loadSessions();
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
        this.showView('sessions');
        this.loadSessions();
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

  /**
   * 打开设置模态框
   */
  openSettingsModal() {
    document.getElementById('settings-modal').classList.add('active');
    // 清空表单
    document.getElementById('old-password').value = '';
    document.getElementById('new-password').value = '';
    document.getElementById('confirm-password').value = '';
    document.getElementById('password-error').textContent = '';
    // 显示主菜单
    this.showSettingsMenu();
    // 更新语言显示
    this.updateLangDisplay();
  }

  /**
   * 显示设置主菜单
   */
  showSettingsMenu() {
    // 隐藏所有子页面
    document.querySelectorAll('.settings-page').forEach(page => {
      page.classList.remove('active');
    });
    // 显示主菜单
    document.getElementById('settings-menu').style.display = 'flex';
    // 隐藏返回按钮
    document.getElementById('settings-back-btn').classList.add('hidden');
    // 更新标题
    document.getElementById('settings-modal-title').textContent = this.t('sessions.settings');
  }

  /**
   * 显示设置子页面
   */
  showSettingsPage(page) {
    // 隐藏主菜单
    document.getElementById('settings-menu').style.display = 'none';
    // 隐藏所有子页面
    document.querySelectorAll('.settings-page').forEach(p => {
      p.classList.remove('active');
    });
    // 显示目标页面
    const targetPage = document.getElementById(`settings-${page}`);
    if (targetPage) {
      targetPage.classList.add('active');
    }
    // 显示返回按钮
    document.getElementById('settings-back-btn').classList.remove('hidden');
    // 更新标题
    if (page === 'language') {
      document.getElementById('settings-modal-title').textContent = this.t('settings.language');
      this.renderLanguageList();
    } else if (page === 'password') {
      document.getElementById('settings-modal-title').textContent = this.t('settings.title');
    }
  }

  /**
   * 渲染语言列表
   */
  renderLanguageList() {
    const container = document.getElementById('settings-language');
    if (!container || !window.i18n) return;

    const currentLang = window.i18n.currentLang;
    const languages = window.i18n.languages;

    let html = '<div class="lang-list">';
    for (const [code, name] of Object.entries(languages)) {
      const isActive = code === currentLang;
      html += `
        <div class="lang-list-item" data-lang="${code}">
          <span>${name}</span>
          <span class="lang-check">${isActive ? '✓' : ''}</span>
        </div>
      `;
    }
    html += '</div>';

    container.innerHTML = html;

    // 绑定点击事件
    container.querySelectorAll('.lang-list-item').forEach(item => {
      item.addEventListener('click', () => {
        const lang = item.dataset.lang;
        this.switchLanguage(lang);
      });
    });
  }

  /**
   * 切换语言
   */
  switchLanguage(lang) {
    if (window.i18n) {
      window.i18n.setLanguage(lang);
      this.renderLanguageList();
      this.updateLangDisplay();
      // 重置调试面板以更新语言
      this.resetDebugPanel();
      // 刷新会话列表
      this.loadSessions();
    }
  }

  /**
   * 更新主菜单中的语言显示
   */
  updateLangDisplay() {
    const currentLang = window.i18n ? window.i18n.currentLang : 'zh';
    const display = document.getElementById('current-lang-display');
    if (display) {
      display.textContent = window.i18n.getLanguageName(currentLang);
    }
  }

  /**
   * 关闭设置模态框
   */
  closeSettingsModal() {
    document.getElementById('settings-modal').classList.remove('active');
  }

  /**
   * 显示密码错误
   */
  showPasswordError(message) {
    const errorEl = document.getElementById('password-error');
    if (errorEl) {
      errorEl.textContent = message;
    }
  }

  /**
   * 处理修改密码
   */
  async handleChangePassword() {
    const oldPassword = document.getElementById('old-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    const submitBtn = document.getElementById('change-password-btn');

    // 前端验证
    if (!oldPassword || !newPassword || !confirmPassword) {
      this.showPasswordError(this.t('settings.fillAll'));
      return;
    }

    if (newPassword.length < 6) {
      this.showPasswordError(this.t('settings.minLength'));
      return;
    }

    if (newPassword !== confirmPassword) {
      this.showPasswordError(this.t('settings.notMatch'));
      return;
    }

    // 禁用按钮
    submitBtn.disabled = true;
    submitBtn.textContent = this.t('settings.updating');
    this.showPasswordError('');

    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword
        })
      });

      const data = await response.json();

      if (response.ok) {
        // 修改成功，清除本地 token，跳转登录
        this.closeSettingsModal();
        this.clearAuth();
        this.disconnect();
        this.showView('login');
        this.showLoginError(this.t('settings.passwordChanged'));
      } else {
        this.showPasswordError(data.detail || this.t('settings.changeFailed'));
      }
    } catch (error) {
      console.error('Change password error:', error);
      this.showPasswordError(this.t('login.networkError'));
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = this.t('settings.confirm');
    }
  }

  /**
   * 加载系统信息（IP 和主机名）
   */
  async loadSystemInfo() {
    try {
      const response = await fetch('/api/system/info', {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        const usernameEl = document.getElementById('system-username');
        const hostnameEl = document.getElementById('system-hostname');
        const ipEl = document.getElementById('system-ip');
        if (usernameEl) usernameEl.textContent = data.username || '--';
        if (hostnameEl) hostnameEl.textContent = data.hostname || '--';
        if (ipEl) ipEl.textContent = data.ip || '--';
        // 保存用户主目录用于路径简化
        this.homeDir = data.home_dir || '';
      }
    } catch (error) {
      console.error('Load system info error:', error);
    }
  }

  /**
   * 加载账户信息
   */
  async loadAccountInfo() {
    try {
      const response = await fetch('/api/account/info', {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.updateAccountDisplay(data);
      }
    } catch (error) {
      console.error('Load account info error:', error);
    }
  }

  /**
   * 更新账户信息显示
   */
  updateAccountDisplay(data) {
    const planEl = document.getElementById('account-plan');
    const limitEl = document.getElementById('account-limit');
    const sessionsEl = document.getElementById('usage-sessions');

    if (planEl) {
      planEl.textContent = data.plan_name || 'Unknown';
    }

    if (limitEl) {
      const limit = data.token_limit_per_5h || 0;
      limitEl.textContent = `${this.formatTokens(limit)}/5h`;
    }

    if (sessionsEl && data.stats) {
      sessionsEl.textContent = data.stats.total_sessions || '--';
    }
  }

  /**
   * 加载用量摘要
   */
  async loadUsageSummary() {
    try {
      const response = await fetch('/api/usage/summary', {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.updateUsageDisplay(data);
        // 启动倒计时
        this.startCountdown(data.period_end);
      }
    } catch (error) {
      console.error('Load usage summary error:', error);
    }

    // 同时加载活跃连接数和历史数据
    this.loadActiveConnections();
    this.loadUsageHistory();
  }

  /**
   * 加载活跃连接数
   */
  async loadActiveConnections() {
    try {
      const response = await fetch('/api/connections/count', {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        const el = document.getElementById('active-connections');
        if (el) {
          el.textContent = data.total_connections || 0;
        }
      }
    } catch (error) {
      console.error('Load active connections error:', error);
    }
  }

  /**
   * 加载历史用量
   */
  async loadUsageHistory() {
    try {
      const response = await fetch('/api/usage/history?days=7', {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.renderUsageChart(data.history || []);
      }
    } catch (error) {
      console.error('Load usage history error:', error);
    }
  }

  /**
   * 渲染用量图表
   */
  renderUsageChart(history) {
    const container = document.getElementById('usage-chart');
    if (!container || history.length === 0) {
      if (container) {
        container.innerHTML = '<div class="chart-loading">暂无数据</div>';
      }
      return;
    }

    // 找出最大值用于计算高度比例
    const maxValue = Math.max(...history.map(d => d.total_tokens), 1);
    const chartHeight = 60; // 柱状图最大高度

    // 今天的日期
    const today = new Date().toISOString().split('T')[0];

    container.innerHTML = history.map(day => {
      const height = Math.max((day.total_tokens / maxValue) * chartHeight, 2);
      const isToday = day.date === today;
      const dateLabel = day.date.slice(5); // MM-DD

      return `
        <div class="chart-bar-wrapper">
          <div class="chart-value">${this.formatTokens(day.total_tokens)}</div>
          <div class="chart-bar ${isToday ? 'today' : ''}" style="height: ${height}px"></div>
          <div class="chart-label">${dateLabel}</div>
        </div>
      `;
    }).join('');
  }

  /**
   * 启动周期倒计时
   */
  startCountdown(periodEnd) {
    // 清除之前的倒计时
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }

    const endTime = new Date(periodEnd);

    const updateCountdown = () => {
      // 每次都重新获取元素，确保能找到
      const countdownEl = document.getElementById('period-countdown');
      if (!countdownEl) return;

      const now = new Date();
      const diffMs = endTime - now;

      if (diffMs <= 0) {
        countdownEl.textContent = this.t('usage.periodReset');
        countdownEl.classList.remove('warning', 'danger');
        clearInterval(this.countdownInterval);
        // 5秒后刷新数据
        setTimeout(() => this.loadUsageSummary(), 5000);
        return;
      }

      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diffMs % (1000 * 60)) / 1000);

      countdownEl.textContent = `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')} ${this.t('usage.resetIn')}`;

      // 根据剩余时间设置颜色
      countdownEl.classList.remove('warning', 'danger');
      if (hours < 1) {
        countdownEl.classList.add('danger');
      } else if (hours < 2) {
        countdownEl.classList.add('warning');
      }
    };

    // 立即更新一次
    updateCountdown();
    // 每秒更新
    this.countdownInterval = setInterval(updateCountdown, 1000);
  }

  /**
   * 更新用量显示
   */
  updateUsageDisplay(data) {
    // 更新进度条
    const progressEl = document.getElementById('usage-progress');
    const percentEl = document.getElementById('usage-period-percent');
    const periodTextEl = document.getElementById('usage-period-text');
    const todayEl = document.getElementById('usage-today');
    const monthEl = document.getElementById('usage-month');

    if (progressEl && percentEl) {
      const percent = data.period_percentage || 0;
      progressEl.style.width = `${Math.min(percent, 100)}%`;

      // 根据百分比设置颜色
      progressEl.classList.remove('warning', 'danger');
      percentEl.classList.remove('warning', 'danger');
      if (percent >= 90) {
        progressEl.classList.add('danger');
        percentEl.classList.add('danger');
      } else if (percent >= 70) {
        progressEl.classList.add('warning');
        percentEl.classList.add('warning');
      }

      percentEl.textContent = `${percent}%`;
    }

    if (periodTextEl) {
      const total = data.current_period_total || 0;
      const limit = data.period_limit || 88000;
      periodTextEl.textContent = `当前周期: ${this.formatTokens(total)} / ${this.formatTokens(limit)}`;
    }

    if (todayEl) {
      todayEl.textContent = this.formatTokens(data.today_total || 0);
    }

    if (monthEl) {
      monthEl.textContent = this.formatTokens(data.month_total || 0);
    }
  }

  /**
   * 格式化 token 数量
   */
  formatTokens(tokens) {
    if (tokens >= 1000000) {
      return (tokens / 1000000).toFixed(1) + 'M';
    } else if (tokens >= 1000) {
      return (tokens / 1000).toFixed(1) + 'k';
    }
    return tokens.toString();
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
      document.getElementById('modal-title').textContent = this.t('create.title');
    } else if (step === 'session') {
      document.getElementById('modal-title').textContent = this.t('create.step2');
    }
  }

  /**
   * 加载工作目录列表
   */
  async loadWorkingDirs() {
    const container = document.getElementById('workdir-list');
    container.innerHTML = `<div class="loading">${this.t('sessions.loading')}</div>`;

    try {
      const response = await fetch('/api/projects', {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (response.status === 401) {
        this.handleUnauthorized();
        return;
      }

      if (!response.ok) throw new Error('Failed to load projects');

      const projects = await response.json();

      if (projects.length === 0) {
        container.innerHTML = `<div class="no-sessions">${this.t('create.noHistory')}</div>`;
        return;
      }

      container.innerHTML = '';
      projects.forEach(project => {
        const item = document.createElement('div');
        item.className = 'workdir-item';
        item.innerHTML = `
          <div class="workdir-name">${project.working_dir}</div>
          <div class="workdir-meta">${project.session_count} ${this.t('create.sessions', 'sessions')}</div>
        `;
        item.addEventListener('click', () => {
          this.selectWorkDir(project.working_dir);
        });
        container.appendChild(item);
      });
    } catch (error) {
      console.error('Load working dirs error:', error);
      container.innerHTML = `<div class="no-sessions">${this.t('sessions.loadFailed')}</div>`;
    }
  }

  /**
   * 浏览目录
   */
  async browseDirectory(path) {
    const container = document.getElementById('dir-list');
    container.innerHTML = `<div class="loading">${this.t('sessions.loading')}</div>`;

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
        container.innerHTML = `<div class="no-sessions">${this.t('create.noSubdirs')}</div>`;
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
      container.innerHTML = `<div class="no-sessions">${this.t('sessions.loadFailed')}</div>`;
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
    container.innerHTML = `<div class="loading">${this.t('sessions.loading')}</div>`;

    try {
      const response = await fetch(`/api/projects/sessions?working_dir=${encodeURIComponent(workDir)}`, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (!response.ok) throw new Error('Failed to load sessions');

      const sessions = await response.json();

      if (sessions.length === 0) {
        container.innerHTML = `<div class="no-sessions">${this.t('create.noClaude')}</div>`;
        return;
      }

      container.innerHTML = '';
      sessions.forEach(session => {
        const item = document.createElement('div');
        item.className = 'claude-session-item';
        item.innerHTML = `
          <div class="claude-session-name">${this.escapeHtml(session.display_name || this.t('create.unnamed'))}</div>
          <div class="claude-session-meta">
            <span class="claude-session-id">${session.session_id.substring(0, 8)}...</span>
            <span>${this.formatTime(session.updated_at)}</span>
          </div>
        `;
        item.addEventListener('click', () => {
          // 直接连接终端，使用 session 的真实 working_dir（而非项目目录）
          this.connectTerminal(session.working_dir, session.session_id, session.display_name);
        });
        container.appendChild(item);
      });
    } catch (error) {
      console.error('Load sessions error:', error);
      container.innerHTML = `<div class="no-sessions">${this.t('sessions.loadFailed')}</div>`;
    }
  }

  // ==================== 会话管理 ====================

  /**
   * 获取当前活跃的连接
   */
  async fetchActiveSessions() {
    try {
      const response = await fetch('/api/active-sessions', {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.error('Fetch active sessions error:', error);
    }
    return { sessions: [], working_dirs: [] };
  }

  /**
   * 加载项目列表（新版 - 从 Claude Projects）
   */
  async loadSessions() {
    try {
      // 并行获取项目列表和活跃连接
      const [projectsResponse, activeSessions] = await Promise.all([
        fetch('/api/projects', {
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        }),
        this.fetchActiveSessions()
      ]);

      if (projectsResponse.status === 401) {
        this.handleUnauthorized();
        return;
      }

      if (!projectsResponse.ok) throw new Error('Failed to load projects');

      const projects = await projectsResponse.json();
      this.renderProjects(projects, activeSessions);
    } catch (error) {
      console.error('Load projects error:', error);
      this.showError(this.t('error.loadSessions'));
    }
  }

  /**
   * 渲染项目列表（新版）
   */
  renderProjects(projects, activeSessions = { sessions: [], working_dirs: [] }) {
    const container = document.getElementById('sessions-list');
    container.innerHTML = '';

    if (projects.length === 0) {
      container.innerHTML = `
        <div class="empty">
          <div class="empty-icon">📱</div>
          <div class="empty-text">${this.t('sessions.empty')}</div>
          <div class="empty-hint">${this.t('sessions.emptyHint')}</div>
        </div>
      `;
      return;
    }

    const activeWorkDirs = new Set(activeSessions.working_dirs || []);

    projects.forEach(project => {
      const item = document.createElement('div');
      const isActive = activeWorkDirs.has(project.working_dir);
      item.className = `session-item project-item${isActive ? ' has-active' : ''}`;

      // 显示工作目录名称
      const displayName = this.getLastPathComponent(project.working_dir);
      const shortPath = this.shortenPath(project.working_dir);

      // 活跃状态指示器
      const activeIndicator = isActive ? '<span class="active-indicator"></span>' : '';

      item.innerHTML = `
        <button class="btn-project-delete" title="${this.t('common.delete', 'Delete')}">✕</button>
        <div class="session-name">${activeIndicator}${this.escapeHtml(displayName)}</div>
        <div class="session-workdir">${this.escapeHtml(shortPath)}</div>
        <div class="session-footer">
          <div class="session-meta">
            <span class="session-status">${project.session_count} ${this.t('create.sessions', 'sessions')}</span>
            <span class="session-time">${project.last_updated ? this.formatTime(project.last_updated) : ''}</span>
          </div>
        </div>
      `;

      // 点击删除按钮
      item.querySelector('.btn-project-delete').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showConfirmDialog(
          this.t('projects.deleteTitle', 'Delete Project'),
          `Delete "${displayName}"?\n\nThis will delete all ${project.session_count} sessions. This action cannot be undone.`,
          () => {
            this.deleteProject(project.working_dir, () => {
              this.loadSessions(); // 刷新列表
            });
          }
        );
      });

      // 点击项目展开会话列表
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showProjectSessions(project.working_dir);
      });

      container.appendChild(item);
    });
  }

  /**
   * 显示项目下的会话列表
   */
  async showProjectSessions(workDir) {
    try {
      // 并行获取会话列表和活跃连接
      const [sessionsResponse, activeSessions] = await Promise.all([
        fetch(`/api/projects/sessions?working_dir=${encodeURIComponent(workDir)}`, {
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        }),
        this.fetchActiveSessions()
      ]);

      if (!sessionsResponse.ok) throw new Error('Failed to load sessions');

      const sessions = await sessionsResponse.json();

      // 显示会话选择弹窗
      this.showSessionsModal(workDir, sessions, activeSessions);
    } catch (error) {
      console.error('Load project sessions error:', error);
      this.showError(this.t('sessions.loadFailed'));
    }
  }

  /**
   * 显示会话选择弹窗
   */
  showSessionsModal(workDir, sessions, activeSessions = { sessions: [], working_dirs: [] }) {
    // 创建弹窗
    const modal = document.createElement('div');
    modal.className = 'modal sessions-modal active';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>${this.getLastPathComponent(workDir)}</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="sessions-modal-list"></div>
          <button class="btn btn-primary btn-new-in-modal">${this.t('create.newSession', 'New Session')}</button>
        </div>
      </div>
    `;

    const list = modal.querySelector('.sessions-modal-list');
    const activeSessionIds = new Set(activeSessions.sessions || []);

    sessions.forEach(session => {
      const isActive = activeSessionIds.has(session.session_id);
      const item = document.createElement('div');
      item.className = `claude-session-item${isActive ? ' is-active' : ''}`;

      // 显示名称：自定义名称 + Claude 摘要（如果有自定义名称）
      const customName = session.custom_name;
      const claudeSummary = session.summary;
      let nameHtml = '';

      // 活跃状态指示器
      const activeIndicator = isActive ? '<span class="active-indicator"></span>' : '';

      if (customName) {
        // 有自定义名称：显示自定义名称，下方显示 Claude 摘要
        nameHtml = `
          <div class="claude-session-name">${activeIndicator}${this.escapeHtml(customName)}</div>
          ${claudeSummary ? `<div class="claude-session-summary">${this.escapeHtml(claudeSummary)}</div>` : ''}
        `;
      } else if (claudeSummary) {
        // 只有 Claude 摘要
        nameHtml = `<div class="claude-session-name">${activeIndicator}${this.escapeHtml(claudeSummary)}</div>`;
      } else {
        // 都没有，显示 session ID
        nameHtml = `<div class="claude-session-name">${activeIndicator}${session.session_id.substring(0, 8)}...</div>`;
      }

      item.innerHTML = `
        <div class="claude-session-info">
          ${nameHtml}
          <div class="claude-session-meta">
            <span class="claude-session-id">${session.session_id.substring(0, 8)}...</span>
            <span>${this.formatTime(session.updated_at)}</span>
          </div>
        </div>
        <button class="btn-session-rename" title="${this.t('common.rename', 'Rename')}">✎</button>
        <button class="btn-session-delete" title="${this.t('common.delete', 'Delete')}">✕</button>
      `;

      // 点击会话信息区域进入终端
      item.querySelector('.claude-session-info').addEventListener('click', () => {
        document.body.removeChild(modal);
        // 用自定义名称或摘要作为显示名
        const displayName = customName || claudeSummary || session.session_id.substring(0, 8);
        // 使用 session 的真实 working_dir（而非项目目录 workDir）
        this.connectTerminal(session.working_dir, session.session_id, displayName);
      });

      // 点击重命名按钮
      item.querySelector('.btn-session-rename').addEventListener('click', (e) => {
        e.stopPropagation();
        this.showRenameDialog(session.session_id, session.custom_name || '', (newName) => {
          // 更新显示
          session.custom_name = newName;
          const nameEl = item.querySelector('.claude-session-name');
          nameEl.textContent = newName;
          // 添加或更新摘要显示
          let summaryEl = item.querySelector('.claude-session-summary');
          if (claudeSummary && !summaryEl) {
            summaryEl = document.createElement('div');
            summaryEl.className = 'claude-session-summary';
            summaryEl.textContent = claudeSummary;
            nameEl.after(summaryEl);
          }
        });
      });

      // 点击删除按钮
      item.querySelector('.btn-session-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        const sessionName = customName || claudeSummary || session.session_id.substring(0, 8);
        this.showConfirmDialog(
          this.t('sessions.deleteTitle', 'Delete Session'),
          `Delete "${sessionName}"?\n\nThis action cannot be undone.`,
          () => {
            this.deleteSession(session.session_id, session.working_dir, () => {
              // 从列表中移除
              item.remove();
              // 如果列表为空，关闭弹窗
              if (list.children.length === 0) {
                document.body.removeChild(modal);
                this.loadSessions(); // 刷新项目列表
              }
            });
          }
        );
      });

      list.appendChild(item);
    });

    // 新建按钮
    modal.querySelector('.btn-new-in-modal').addEventListener('click', () => {
      document.body.removeChild(modal);
      this.connectTerminal(workDir, null, this.t('create.newSession', 'New Session'));
    });

    // 关闭按钮
    modal.querySelector('.modal-close').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    // 点击背景关闭
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });

    document.body.appendChild(modal);
  }

  /**
   * 显示重命名对话框
   */
  showRenameDialog(sessionId, currentName, onSuccess) {
    const dialog = document.createElement('div');
    dialog.className = 'modal rename-modal active';
    dialog.innerHTML = `
      <div class="modal-content modal-small">
        <div class="modal-header">
          <h3>${this.t('common.rename', 'Rename')}</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <input type="text" class="form-input rename-input" value="${this.escapeHtml(currentName || '')}" placeholder="${this.t('sessions.namePlaceholder', 'Enter session name')}">
          <div class="rename-actions">
            <button class="btn btn-secondary btn-cancel">${this.t('common.cancel', 'Cancel')}</button>
            <button class="btn btn-primary btn-save">${this.t('common.save', 'Save')}</button>
          </div>
        </div>
      </div>
    `;

    const input = dialog.querySelector('.rename-input');
    const saveBtn = dialog.querySelector('.btn-save');
    const cancelBtn = dialog.querySelector('.btn-cancel');
    const closeBtn = dialog.querySelector('.modal-close');

    const closeDialog = () => {
      document.body.removeChild(dialog);
    };

    const saveRename = async () => {
      const newName = input.value.trim();
      if (!newName) {
        input.focus();
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = this.t('common.saving', 'Saving...');

      try {
        const response = await fetch(`/api/projects/session/${sessionId}/name`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          },
          body: JSON.stringify({ name: newName })
        });

        if (response.ok) {
          closeDialog();
          if (onSuccess) onSuccess(newName);
        } else {
          const data = await response.json();
          alert(data.detail || this.t('error.saveFailed', 'Save failed'));
        }
      } catch (error) {
        console.error('Rename error:', error);
        alert(this.t('error.network', 'Network error'));
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = this.t('common.save', 'Save');
      }
    };

    saveBtn.addEventListener('click', saveRename);
    cancelBtn.addEventListener('click', closeDialog);
    closeBtn.addEventListener('click', closeDialog);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveRename();
      } else if (e.key === 'Escape') {
        closeDialog();
      }
    });

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        closeDialog();
      }
    });

    document.body.appendChild(dialog);
    input.focus();
    input.select();
  }

  /**
   * 显示确认删除弹窗
   */
  showConfirmDialog(title, message, onConfirm) {
    const dialog = document.createElement('div');
    dialog.className = 'confirm-modal';
    // 支持换行：将 \n 转换为 <br>
    const formattedMessage = this.escapeHtml(message).replace(/\n/g, '<br>');
    dialog.innerHTML = `
      <div class="confirm-modal-content">
        <div class="confirm-modal-icon">⚠️</div>
        <div class="confirm-modal-title">${this.escapeHtml(title)}</div>
        <div class="confirm-modal-message">${formattedMessage}</div>
        <div class="confirm-modal-buttons">
          <button class="btn btn-cancel">${this.t('common.cancel', 'Cancel')}</button>
          <button class="btn btn-danger">${this.t('common.delete', 'Delete')}</button>
        </div>
      </div>
    `;

    const closeDialog = () => {
      document.body.removeChild(dialog);
    };

    dialog.querySelector('.btn-cancel').addEventListener('click', closeDialog);
    dialog.querySelector('.btn-danger').addEventListener('click', () => {
      closeDialog();
      onConfirm();
    });

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        closeDialog();
      }
    });

    document.body.appendChild(dialog);
  }

  /**
   * 删除 Session
   */
  async deleteSession(sessionId, workingDir, onSuccess) {
    try {
      const response = await fetch(
        `/api/projects/session/${sessionId}?working_dir=${encodeURIComponent(workingDir)}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        }
      );

      if (response.ok) {
        this.showToast(this.t('sessions.deleted', 'Session deleted'));
        if (onSuccess) onSuccess();
      } else {
        const data = await response.json();
        alert(data.detail || this.t('error.deleteFailed', 'Delete failed'));
      }
    } catch (error) {
      console.error('Delete session error:', error);
      alert(this.t('error.network', 'Network error'));
    }
  }

  /**
   * 删除 Project
   */
  async deleteProject(workingDir, onSuccess) {
    try {
      const response = await fetch(
        `/api/projects?working_dir=${encodeURIComponent(workingDir)}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        }
      );

      if (response.ok) {
        this.showToast(this.t('projects.deleted', 'Project deleted'));
        if (onSuccess) onSuccess();
      } else {
        const data = await response.json();
        alert(data.detail || this.t('error.deleteFailed', 'Delete failed'));
      }
    } catch (error) {
      console.error('Delete project error:', error);
      alert(this.t('error.network', 'Network error'));
    }
  }

  /**
   * 显示 Toast 提示
   */
  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 100px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: #fff;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 3000;
      animation: fadeIn 0.3s, fadeOut 0.3s 2s forwards;
    `;

    // Add animation styles if not already present
    if (!document.getElementById('toast-styles')) {
      const style = document.createElement('style');
      style.id = 'toast-styles';
      style.textContent = `
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) {
        document.body.removeChild(toast);
      }
    }, 2500);
  }

  /**
   * 简化路径显示
   */
  shortenPath(path) {
    if (!path) return '';
    // 替换用户目录为 ~
    const home = this.homeDir || '';
    if (path.startsWith(home)) {
      return '~' + path.substring(home.length);
    }
    return path;
  }

  /**
   * 获取状态文本
   */
  getStatusText(status) {
    return this.t(`session.status.${status}`, status);
  }

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
  }

  /**
   * 创建新会话（点击"新建会话"按钮）
   */
  createNewSession(workDir) {
    // 新建会话：sessionId 为 null
    this.connectTerminal(workDir, null, this.t('create.newSession', 'New Session'));
  }

  /**
   * 旧版创建会话（兼容）
   * @deprecated 使用 connectTerminal 代替
   */
  async createSession(workDir, claudeSessionId) {
    // 转发到新方法
    const sessionName = claudeSessionId ? null : this.t('create.newSession', 'New Session');
    this.connectTerminal(workDir, claudeSessionId, sessionName);
  }

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
  }

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
  }

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
  }

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
    header.innerHTML = `<span style="color:#0f0;font-weight:bold;">${this.t('debug.title')}</span>`;

    // 按钮组
    const btnGroup = document.createElement('div');

    // 复制按钮
    const copyBtn = document.createElement('button');
    copyBtn.textContent = this.t('debug.copy');
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
      copyBtn.textContent = this.t('debug.copied');
      setTimeout(() => copyBtn.textContent = this.t('debug.copy'), 1000);
    };

    // 清除按钮
    const clearBtn = document.createElement('button');
    clearBtn.textContent = this.t('debug.clear');
    clearBtn.style.cssText = 'padding:5px 15px;margin-right:10px;background:#333;color:#fff;border:none;border-radius:4px;';
    clearBtn.onclick = () => {
      this.debugLogs = [];
      const content = document.getElementById('debug-log-content');
      if (content) content.innerHTML = '';
    };

    // 关闭按钮
    const closeBtn = document.createElement('button');
    closeBtn.textContent = this.t('debug.close');
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
   * 重置调试面板（语言切换时调用）
   */
  resetDebugPanel() {
    const panel = document.getElementById('debug-panel');
    if (panel) {
      panel.remove();
    }
  }

  /**
   * 切换帮助面板显示
   */
  toggleHelpPanel(event) {
    if (event) event.stopPropagation();
    const panel = document.getElementById('help-panel');
    if (panel) {
      const isActive = panel.classList.toggle('active');
      // 如果打开面板，添加点击外部关闭的监听
      if (isActive) {
        setTimeout(() => {
          document.addEventListener('click', this.closeHelpOnClickOutside);
        }, 0);
      } else {
        document.removeEventListener('click', this.closeHelpOnClickOutside);
      }
    }
  }

  /**
   * 点击外部关闭帮助面板
   */
  closeHelpOnClickOutside = (event) => {
    const panel = document.getElementById('help-panel');
    const helpBtn = document.getElementById('help-btn');
    // 如果点击的不是面板内部也不是帮助按钮，关闭面板
    if (panel && !panel.contains(event.target) && event.target !== helpBtn) {
      panel.classList.remove('active');
      document.removeEventListener('click', this.closeHelpOnClickOutside);
    }
  }

  /**
   * 切换会话列表帮助面板
   */
  toggleSessionsHelpPanel(event) {
    if (event) event.stopPropagation();
    const panel = document.getElementById('sessions-help-panel');
    if (panel) {
      const isActive = panel.classList.toggle('active');
      if (isActive) {
        setTimeout(() => {
          document.addEventListener('click', this.closeSessionsHelpOnClickOutside);
        }, 0);
      } else {
        document.removeEventListener('click', this.closeSessionsHelpOnClickOutside);
      }
    }
  }

  /**
   * 关闭会话列表帮助面板
   */
  closeSessionsHelpPanel() {
    const panel = document.getElementById('sessions-help-panel');
    if (panel) {
      panel.classList.remove('active');
      document.removeEventListener('click', this.closeSessionsHelpOnClickOutside);
    }
  }

  /**
   * 点击外部关闭会话列表帮助面板
   */
  closeSessionsHelpOnClickOutside = (event) => {
    const panel = document.getElementById('sessions-help-panel');
    const helpBtn = document.getElementById('sessions-help-btn');
    if (panel && !panel.contains(event.target) && event.target !== helpBtn) {
      panel.classList.remove('active');
      document.removeEventListener('click', this.closeSessionsHelpOnClickOutside);
    }
  }

  /**
   * 切换用量抽屉
   */
  toggleUsageDrawer() {
    const drawer = document.getElementById('usage-drawer');
    const btn = document.getElementById('usage-toggle-btn');
    if (drawer && btn) {
      const isActive = drawer.classList.toggle('active');
      btn.classList.toggle('active', isActive);
    }
  }

  /**
   * 切换更多按键面板显示
   */
  toggleMoreKeysPanel() {
    const panel = document.getElementById('more-keys-panel');
    const btn = document.getElementById('more-keys-btn');
    if (panel && btn) {
      const isActive = panel.classList.toggle('active');
      btn.classList.toggle('active', isActive);
    }
  }

  /**
   * 关闭更多按键面板
   */
  closeMoreKeysPanel() {
    const panel = document.getElementById('more-keys-panel');
    const btn = document.getElementById('more-keys-btn');
    if (panel) {
      panel.classList.remove('active');
    }
    if (btn) {
      btn.classList.remove('active');
    }
  }

  /**
   * 更新连接状态显示
   * @param {string} statusKey - 状态类型: 'connected', 'connecting', 'disconnected', 'error', 'timeout'
   * @param {string} detail - 详细信息
   */
  updateConnectStatus(statusKey, detail) {
    // 根据状态类型获取显示文本
    const statusTextMap = {
      'connected': this.t('status.connected'),
      'connecting': this.t('status.connecting'),
      'disconnected': this.t('status.disconnected'),
      'error': this.t('status.error'),
      'timeout': this.t('status.timeout'),
      'failed': this.t('status.failed')
    };
    const text = statusTextMap[statusKey] || statusKey;

    // 更新终端容器内的连接状态（连接中显示）
    const statusEl = document.getElementById('connect-status');
    if (statusEl) {
      const textEl = statusEl.querySelector('.connect-text');
      const detailEl = statusEl.querySelector('.connect-detail');
      if (textEl) textEl.textContent = text;
      if (detailEl) detailEl.textContent = detail || '';

      // 如果是超时或错误，显示重试按钮
      if (statusKey === 'timeout' || statusKey === 'error' || statusKey === 'failed') {
        let retryBtn = statusEl.querySelector('.retry-btn');
        if (!retryBtn) {
          retryBtn = document.createElement('button');
          retryBtn.className = 'retry-btn';
          retryBtn.textContent = this.t('status.clickRetry');
          retryBtn.style.cssText = 'margin-top:15px;padding:12px 30px;font-size:16px;background:#007aff;color:#fff;border:none;border-radius:8px;cursor:pointer;';
          retryBtn.onclick = () => {
            this.debugLog('user clicked retry');
            this.manualRetryConnect();
          };
          statusEl.appendChild(retryBtn);
        }
      }
    }

    // 更新工具栏的圆点和状态文字
    const dot = document.getElementById('connection-dot');
    const statusTextEl = document.getElementById('connection-status');

    if (dot && statusTextEl) {
      // 根据状态设置圆点样式
      dot.className = 'connection-dot';
      statusTextEl.className = 'connection-status';

      if (statusKey === 'connected') {
        dot.classList.add('connected');
        statusTextEl.textContent = ''; // 已连接时不显示文字
      } else if (statusKey === 'connecting') {
        dot.classList.add('connecting');
        statusTextEl.classList.add('connecting');
        statusTextEl.textContent = text;
      } else {
        dot.classList.add('disconnected');
        statusTextEl.classList.add('disconnected');
        statusTextEl.textContent = text;
      }
    }
  }

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
  }

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
  /**
   * 连接 WebSocket（新版）
   */
  connectWebSocket(workDir, sessionId) {
    this.debugLog('connectWebSocket() 开始');
    this.reconnectAttempts = 0;

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
  }

  /**
   * 旧版连接方法（兼容）
   * @deprecated
   */
  connect(sessionId) {
    this.debugLog('connect() 开始 (legacy)');
    this.reconnectAttempts = 0;

    // 如果有 currentWorkDir，使用新端点
    if (this.currentWorkDir) {
      this.connectWebSocket(this.currentWorkDir, this.currentClaudeSessionId);
      return;
    }

    // 否则使用旧端点（兼容）
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/${sessionId}?token=${this.token}`;
    this.debugLog('WebSocket URL: ' + wsUrl.substring(0, 60));
    this._doConnect(wsUrl);
  }

  /**
   * 实际的 WebSocket 连接逻辑
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
  }

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
  }

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
  }

  /**
   * 发送消息 - 使用 MessagePack 二进制协议
   */
  sendMessage(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // 使用 MessagePack 二进制编码
      const packed = MessagePack.encode(data);
      this.ws.send(packed);
    }
  }

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

    // 合并发送：content + '\n'，后端识别并处理
    if (content) {
      this.sendMessage({ type: 'input', data: content + '\n' });
    } else {
      this.sendMessage({ type: 'input', data: '\n' });
    }
  }

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
  }

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
  }

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
        this.connect(this.currentSession);
      } else {
        this.debugLog(`[${execNow}] cancel reconnect: shouldReconnect=${this.shouldReconnect}, currentSession=${!!this.currentSession}, isConnecting=${this.isConnecting}`);
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
      // 减少列数，让内容显示更宽松
      const adjustedCols = Math.max(size.cols - 3, 20);
      console.log('Terminal resized to:', size.rows, 'x', adjustedCols, '(original:', size.cols, ')');
      this.sendMessage({
        type: 'resize',
        rows: size.rows,
        cols: adjustedCols
      });
    }, 50);
  }

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
      return this.t('time.justNow');
    }
    // 小于1小时
    if (diff < 3600000) {
      return Math.floor(diff / 60000) + ' ' + this.t('time.minutesAgo');
    }
    // 小于24小时
    if (diff < 86400000) {
      return Math.floor(diff / 3600000) + ' ' + this.t('time.hoursAgo');
    }
    // 其他
    return date.toLocaleDateString();
  }
}

// 页面加载完成后初始化
window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
