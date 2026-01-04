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
 * Jarvis - 主应用
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

    // 初始化主题
    this.initTheme();

    // 初始化远程机器模块
    if (window.RemoteMachines) {
      window.RemoteMachines.init();
    }

    // 防止浏览器边缘滑动后退（iOS Safari）
    // 通过 History API 拦截 popstate 事件
    this.initBackGesturePrevention();

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
   * 初始化防止浏览器后退手势
   * 使用 History API 拦截 popstate 事件，阻止 iOS Safari 边缘滑动后退
   */
  initBackGesturePrevention() {
    // 推入一个初始状态，确保有历史记录可以"后退"到
    if (!window.history.state || !window.history.state.preventBack) {
      window.history.pushState({ preventBack: true, index: 1 }, '');
    }

    // 监听 popstate 事件（当用户尝试后退时触发）
    window.addEventListener('popstate', (e) => {
      // 当用户触发后退时，立即推入新状态来阻止真正的后退
      window.history.pushState({ preventBack: true, index: 1 }, '');
      console.log('[BackGesture] Prevented back navigation');
    });

    console.log('[BackGesture] Back gesture prevention initialized');
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
   * 初始化下拉刷新（支持两个页面）
   */
  initPullRefresh() {
    // Projects 页面
    this.initPullRefreshForPage(
      'page-projects',
      'pull-refresh',
      'sessions-list',
      async () => {
        await Promise.all([this.loadSessions(), this.loadSystemInfo()]);
      }
    );

    // Sessions 页面
    this.initPullRefreshForPage(
      'page-all-sessions',
      'pull-refresh-sessions',
      'all-sessions-grid',
      async () => {
        await this.loadPinnedSessions();
      }
    );

    // Files 页面 - 移动整个 files-browser 容器（包括标题栏）
    this.initPullRefreshForPage(
      'page-files',
      'pull-refresh-files',
      'files-list',
      async () => {
        if (this.refreshFilesPage) {
          this.refreshFilesPage();
        }
      },
      'files-browser'  // 移动整个浏览器容器
    );

    // Monitor 页面
    this.initPullRefreshForPage(
      'page-monitor',
      'pull-refresh-monitor',
      'monitor-content',
      async () => {
        if (window.AppMonitor) {
          await window.AppMonitor.loadMonitorData();
        }
      }
    );

    // Remote Machines 页面
    this.initPullRefreshForPage(
      'page-remote',
      'pull-refresh-remote',
      'remote-machines-list',
      async () => {
        if (window.RemoteMachines) {
          await window.RemoteMachines.loadMachines();
        }
      },
      'remote-machines-content'  // 移动整个容器（包括添加按钮）
    );

    // Scheduled Tasks 页面
    // 注意: listId 必须是实际的滚动容器，否则 scrollTop 检测失效
    this.initPullRefreshForPage(
      'page-scheduled-tasks',
      'pull-refresh-tasks',
      'scheduled-tasks-content',  // 滚动容器
      async () => {
        if (window.AppScheduledTasks) {
          window.AppScheduledTasks.refreshTasks();
        }
      }
    );
  }

  /**
   * 为单个页面初始化下拉刷新
   * @param {string} pageId - 页面容器 ID
   * @param {string} pullRefreshId - 下拉刷新指示器 ID
   * @param {string} listId - 用于检测滚动位置的列表 ID
   * @param {Function} refreshCallback - 刷新回调函数
   * @param {string} [contentId] - 可选，要移动的内容容器 ID（如果与 listId 不同）
   */
  initPullRefreshForPage(pageId, pullRefreshId, listId, refreshCallback, contentId = null) {
    const page = document.getElementById(pageId);
    const pullRefresh = document.getElementById(pullRefreshId);
    const list = document.getElementById(listId);
    // 如果指定了 contentId，移动整个 content 容器；否则只移动 list
    const content = contentId ? document.getElementById(contentId) : list;

    if (!page || !pullRefresh || !list || !content) return;

    let startY = 0;
    let currentY = 0;
    let pulling = false;
    let refreshing = false;

    page.addEventListener('touchstart', (e) => {
      // 每次触摸开始时先重置 pulling 状态，防止状态残留
      pulling = false;

      // 编辑模式下禁用下拉刷新（拖动卡片时）
      const grid = document.getElementById('all-sessions-grid');
      if (grid && grid.classList.contains('edit-mode')) {
        return;
      }
      // 只在滚动到顶部时才启用下拉刷新（检查 page 和 list 的 scrollTop）
      const pageAtTop = page.scrollTop <= 0;
      const listAtTop = list.scrollTop <= 0;
      if (pageAtTop && listAtTop && !refreshing) {
        startY = e.touches[0].clientY;
        pulling = true;
      }
    }, { passive: true });

    page.addEventListener('touchmove', (e) => {
      if (!pulling || refreshing) return;

      currentY = e.touches[0].clientY;
      const deltaY = currentY - startY;

      // 只处理向下拉（检查 page 和 list 都在顶部）
      const pageAtTop = page.scrollTop <= 0;
      const listAtTop = list.scrollTop <= 0;
      if (deltaY > 0 && pageAtTop && listAtTop) {
        e.preventDefault();

        // 拖拽时禁用过渡动画
        pullRefresh.classList.add('dragging');
        content.classList.add('dragging');

        // 计算下拉距离（带阻尼效果）
        const pullDistance = Math.min(deltaY * 0.5, this.pullRefresh.maxPull);

        // 更新 UI
        pullRefresh.style.transform = `translateY(${pullDistance}px)`;
        content.style.transform = `translateY(${pullDistance}px)`;

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

    page.addEventListener('touchend', async () => {
      if (!pulling) return;
      pulling = false;

      const deltaY = currentY - startY;
      const pullDistance = Math.min(deltaY * 0.5, this.pullRefresh.maxPull);

      // 移除 dragging 类，启用过渡动画
      pullRefresh.classList.remove('dragging');
      content.classList.remove('dragging');

      if (pullDistance >= this.pullRefresh.reloadThreshold && !refreshing) {
        // 大幅下拉 - 刷新整个页面
        window._isPageReloading = true;
        location.reload();
      } else if (pullDistance >= this.pullRefresh.dataThreshold && !refreshing) {
        // 常规下拉 - 只刷新数据
        refreshing = true;
        const textEl = pullRefresh.querySelector('.pull-refresh-text');
        if (textEl) textEl.textContent = this.t('sessions.refreshing', '刷新中...');

        // 先立即回弹
        pullRefresh.style.transform = '';
        content.style.transform = '';
        pullRefresh.classList.remove('pulling', 'reload-mode');

        // 异步加载数据
        try {
          await refreshCallback();
        } catch (e) {
          console.error('Refresh data error:', e);
        } finally {
          refreshing = false;
          if (textEl) textEl.textContent = this.t('sessions.pullToRefresh', '下拉刷新');
        }
      } else {
        // 未达到阈值，恢复位置（带动画）
        pullRefresh.style.transform = '';
        content.style.transform = '';
        pullRefresh.classList.remove('pulling', 'reload-mode');
      }

      startY = 0;
      currentY = 0;
    }, { passive: true });

    // 触摸取消时也要恢复
    page.addEventListener('touchcancel', () => {
      if (!pulling) return;
      pulling = false;

      pullRefresh.classList.remove('dragging');
      content.classList.remove('dragging');
      pullRefresh.style.transform = '';
      content.style.transform = '';
      pullRefresh.classList.remove('pulling', 'reload-mode');

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

    // 退出按钮（现在在设置菜单中）
    document.getElementById('menu-logout').addEventListener('click', () => {
      this.closeSettingsModal();
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

    // 设置菜单项点击 - 主题
    document.getElementById('menu-theme').addEventListener('click', () => {
      this.showSettingsPage('theme');
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

    // 主题切换按钮
    document.getElementById('theme-toggle').addEventListener('click', () => {
      this.debugLog('theme-toggle button clicked');
      this.toggleTheme();
    });

    // Context 展开/收起按钮
    document.getElementById('context-toggle').addEventListener('click', () => {
      this.toggleContextPanel();
    });

    // 工作目录按钮 - 打开 Files 页面
    document.getElementById('workdir-btn').addEventListener('click', () => {
      this.debugLog('workdir button clicked');
      this.openWorkingDir();
    });

    // 重命名当前 session 按钮
    const renameSessionBtn = document.getElementById('rename-session-btn');
    if (renameSessionBtn) {
      renameSessionBtn.addEventListener('click', () => {
        this.debugLog('rename-session button clicked');
        this.renameCurrentSession();
      });
    } else {
      console.warn('rename-session-btn not found');
    }

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

    // 初始化上传功能
    if (this.initUpload) {
      this.initUpload();
    }

    // 初始化下载功能
    if (this.initDownload) {
      this.initDownload();
    }

    // 初始化历史记录功能
    if (this.initHistory) {
      this.initHistory();
    }

    // 初始化滑动功能
    if (this.initSwipe) {
      this.initSwipe();
    }

    // 初始化文件浏览器
    if (this.initFiles) {
      this.initFiles();
    }

    // 初始化系统监控
    if (window.AppMonitor && window.AppMonitor.initMonitor) {
      window.AppMonitor.initMonitor();
    }

    // 初始化定时任务
    if (window.AppScheduledTasks && window.AppScheduledTasks.initScheduledTasks) {
      window.AppScheduledTasks.initScheduledTasks();
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
        // 注意：showView('sessions') 内部会调用 loadSessions() 和 loadUsageSummary()
        this.showView('sessions');
        // 并发加载其他数据
        Promise.all([
          this.loadSystemInfo(),
          this.loadAccountInfo()
        ]).catch(e => console.error('Load info error:', e));
        // 恢复保存的页面位置
        requestAnimationFrame(() => {
          const container = document.getElementById('swipe-container');
          if (container && this._currentPage !== undefined) {
            const pageWidth = container.offsetWidth;
            container.scrollTo({ left: pageWidth * this._currentPage, behavior: 'instant' });
          }
        });
        // 触发当前页面的懒加载
        if (this._onPageChange && this._currentPage !== undefined) {
          this._onPageChange(this._currentPage);
        }
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
      // 恢复保存的页面位置
      requestAnimationFrame(() => {
        const container = document.getElementById('swipe-container');
        if (container && this._currentPage !== undefined) {
          const pageWidth = container.offsetWidth;
          container.scrollTo({ left: pageWidth * this._currentPage, behavior: 'instant' });
        }
      });
      // 触发当前页面的懒加载
      if (this._onPageChange && this._currentPage !== undefined) {
        this._onPageChange(this._currentPage);
      }
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
        // 注意：showView('sessions') 内部会调用 loadSessions() 和 loadUsageSummary()
        this.showView('sessions');
        // 并发加载其他数据
        Promise.all([
          this.loadSystemInfo(),
          this.loadAccountInfo()
        ]).catch(e => console.error('Load info error:', e));
        // 登录成功后，恢复保存的页面位置（因为 initSwipe 在登录前执行时 container 可能还没布局好）
        requestAnimationFrame(() => {
          const container = document.getElementById('swipe-container');
          if (container && this._currentPage !== undefined) {
            const pageWidth = container.offsetWidth;
            container.scrollTo({ left: pageWidth * this._currentPage, behavior: 'instant' });
          }
        });
        // 登录成功后，触发当前页面的懒加载（因为 initSwipe 在登录前就执行了）
        if (this._onPageChange && this._currentPage !== undefined) {
          this._onPageChange(this._currentPage);
        }
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
  async handleLogout() {
    const confirmed = await this.showConfirm(this.t('confirm.logout'), {
      type: 'warning',
      title: this.t('dialog.logout', 'Logout'),
      confirmText: this.t('common.logout', 'Logout')
    });
    if (!confirmed) return;

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
      // 并发加载会话列表和用量数据
      Promise.all([
        this.loadSessions(),
        this.loadUsageSummary()
      ]).catch(e => console.error('Load sessions error:', e));
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
// Note: AppMonitor and AppScheduledTasks must be before AppSwipe (swipe calls their methods on page change)
if (window.AppUtils) mixinModule(window.AppUtils);
if (window.AppDebug) mixinModule(window.AppDebug);
if (window.AppDialogs) mixinModule(window.AppDialogs);
if (window.AppSettings) mixinModule(window.AppSettings);
if (window.AppMonitor) mixinModule(window.AppMonitor);
if (window.AppScheduledTasks) mixinModule(window.AppScheduledTasks);
if (window.AppSwipe) mixinModule(window.AppSwipe);
if (window.AppProjects) mixinModule(window.AppProjects);
if (window.AppWebSocket) mixinModule(window.AppWebSocket);
if (window.AppUpload) mixinModule(window.AppUpload);
if (window.AppDownload) mixinModule(window.AppDownload);
if (window.AppHistory) mixinModule(window.AppHistory);
if (window.AppFiles) mixinModule(window.AppFiles);

// 页面加载完成后初始化
window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
