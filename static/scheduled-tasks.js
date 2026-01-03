/**
 * Copyright (c) 2025 BillChen
 * Scheduled Tasks Module - 定时任务管理
 */

window.AppScheduledTasks = {
  _tasksLoaded: false,
  _tasks: [],
  _currentEditTask: null,
  // 历史分页状态
  _historyTaskId: null,
  _historyOffset: 0,
  _historyHasMore: true,
  _historyLoading: false,
  _historyPageSize: 10,

  /**
   * 获取 token
   */
  get token() {
    return localStorage.getItem('auth_token') || '';
  },

  /**
   * 初始化定时任务模块
   */
  initScheduledTasks() {
    // 初始化时绑定事件
    this.bindModalEvents();
  },

  /**
   * 加载定时任务页面（首次进入时调用）
   */
  loadScheduledTasksPage() {
    if (this._tasksLoaded) return;
    this._tasksLoaded = true;
    this.loadTasks();
  },

  /**
   * 刷新任务列表
   */
  refreshTasks() {
    this._tasksLoaded = false;
    this.loadScheduledTasksPage();
  },

  /**
   * 加载任务列表
   */
  async loadTasks() {
    const container = document.getElementById('scheduled-tasks-list');
    if (!container) return;

    try {
      const response = await fetch('/api/scheduled-tasks', {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (response.ok) {
        const data = await response.json();
        this._tasks = data.tasks || [];
        this.renderTaskList();
      } else {
        console.error('[ScheduledTasks] API error:', await response.text());
        container.innerHTML = '<div class="empty-hint">Failed to load tasks</div>';
      }
    } catch (error) {
      console.error('[ScheduledTasks] Load error:', error);
      container.innerHTML = '<div class="empty-hint">Error loading tasks</div>';
    }
  },

  /**
   * 渲染任务列表
   */
  renderTaskList() {
    const container = document.getElementById('scheduled-tasks-list');
    if (!container) return;

    if (this._tasks.length === 0) {
      container.innerHTML = `
        <div class="empty-tasks">
          <div class="empty-icon">◷</div>
          <div class="empty-text" data-i18n="tasks.empty">No scheduled tasks</div>
          <div class="empty-hint" data-i18n="tasks.emptyHint">Use Claude to create scheduled tasks via conversation</div>
        </div>
      `;
      return;
    }

    let html = '';
    for (const task of this._tasks) {
      html += this.renderTaskCard(task);
    }

    container.innerHTML = html;

    // 绑定事件
    this.bindTaskEvents();
  },

  /**
   * 渲染单个任务卡片
   */
  renderTaskCard(task) {
    const statusIcon = task.enabled ? '✓' : '○';
    const statusClass = task.enabled ? 'enabled' : 'disabled';

    // 上次执行状态
    let lastRunHtml = '';
    let lastOutputHtml = '';
    if (task.last_execution) {
      const exec = task.last_execution;
      const statusMap = {
        'success': { icon: '✓', class: 'success' },
        'failed': { icon: '✗', class: 'failed' },
        'timeout': { icon: '◔', class: 'timeout' },
        'skipped': { icon: '»', class: 'skipped' },
        'running': { icon: '●', class: 'running' }
      };
      const st = statusMap[exec.status] || { icon: '?', class: '' };
      const time = this.formatTime(exec.started_at);
      lastRunHtml = `<span class="task-last-run ${st.class}" data-action="toggle-output" title="Click to view output">${st.icon} ${time}</span>`;

      // 执行结果摘要（可展开）
      if (exec.output_summary) {
        const output = this.escapeHtml(exec.output_summary).replace(/\n/g, '<br>');
        lastOutputHtml = `<div class="task-output collapsed">${output}</div>`;
      } else if (exec.error) {
        const error = this.escapeHtml(exec.error).replace(/\n/g, '<br>');
        lastOutputHtml = `<div class="task-output collapsed error">${error}</div>`;
      }
    }

    // 下次执行时间
    let nextRunHtml = '';
    if (task.next_run_at && task.enabled) {
      nextRunHtml = `<span class="task-next-run">◷ ${this.formatTime(task.next_run_at)}</span>`;
    }

    return `
      <div class="task-card ${statusClass}" data-task-id="${task.id}">
        <div class="task-header">
          <div class="task-title-row">
            <span class="task-name">${this.escapeHtml(task.name)}</span>
            <button class="task-toggle-btn ${statusClass}" data-action="toggle" title="${task.enabled ? 'Disable' : 'Enable'}">
              ${statusIcon}
            </button>
          </div>
          <div class="task-schedule">
            <span class="task-cron">${this.escapeHtml(task.cron_human || task.cron_expr)}</span>
            ${task.notify_feishu ? '<span class="task-notify-badge" title="Feishu notification enabled">⚑</span>' : ''}
          </div>
        </div>
        <div class="task-body">
          <div class="task-prompt">${this.escapeHtml(task.prompt.substring(0, 100))}${task.prompt.length > 100 ? '...' : ''}</div>
          <div class="task-meta">
            ${lastRunHtml}
            ${nextRunHtml}
          </div>
          ${lastOutputHtml}
        </div>
        <div class="task-actions">
          ${task.session_id ? `<button class="btn-task-action btn-session" data-action="session" title="Open Session">⌨</button>` : ''}
          <button class="btn-task-action" data-action="run" title="Run now">▶</button>
          <button class="btn-task-action" data-action="history" title="History">▤</button>
          <button class="btn-task-action" data-action="edit" title="Edit">✎</button>
          <button class="btn-task-action btn-danger" data-action="delete" title="Delete">✕</button>
        </div>
      </div>
    `;
  },

  /**
   * 绑定任务卡片事件
   */
  bindTaskEvents() {
    const container = document.getElementById('scheduled-tasks-list');
    if (!container) return;

    container.querySelectorAll('.task-card').forEach(card => {
      card.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const taskId = parseInt(card.dataset.taskId);
          const action = btn.dataset.action;
          this.handleTaskAction(taskId, action);
        });
      });
    });
  },

  /**
   * 处理任务操作
   */
  async handleTaskAction(taskId, action) {
    switch (action) {
      case 'toggle':
        await this.toggleTask(taskId);
        break;
      case 'toggle-output':
        this.toggleOutput(taskId);
        break;
      case 'run':
        await this.runTask(taskId);
        break;
      case 'edit':
        await this.showEditModal(taskId);
        break;
      case 'delete':
        await this.deleteTask(taskId);
        break;
      case 'history':
        await this.showHistory(taskId);
        break;
      case 'session':
        await this.openTaskSession(taskId);
        break;
    }
  },

  /**
   * 切换输出显示
   */
  toggleOutput(taskId) {
    const card = document.querySelector(`.task-card[data-task-id="${taskId}"]`);
    if (!card) return;

    const output = card.querySelector('.task-output');
    if (output) {
      output.classList.toggle('collapsed');
    }
  },

  /**
   * 切换任务状态
   */
  async toggleTask(taskId) {
    try {
      const response = await fetch(`/api/scheduled-tasks/${taskId}/toggle`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (response.ok) {
        const data = await response.json();
        // 更新本地状态
        const task = this._tasks.find(t => t.id === taskId);
        if (task) {
          task.enabled = data.enabled;
          this.renderTaskList();
        }
      } else {
        window.app.showAlert('Failed to toggle task', { type: 'error' });
      }
    } catch (error) {
      console.error('[ScheduledTasks] Toggle error:', error);
      window.app.showAlert('Error toggling task', { type: 'error' });
    }
  },

  /**
   * 立即执行任务
   */
  async runTask(taskId) {
    const task = this._tasks.find(t => t.id === taskId);
    if (!task) return;

    const confirmed = await window.app.showConfirm(`Run "${task.name}" now?`, {
      type: 'info',
      title: 'Run Task',
      confirmText: 'Run'
    });
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/scheduled-tasks/${taskId}/run`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (response.ok) {
        window.app.showAlert('Task started! Check Feishu for results.', { type: 'success' });
      } else {
        const data = await response.json();
        window.app.showAlert('Failed to run task: ' + (data.detail || 'Unknown error'), { type: 'error' });
      }
    } catch (error) {
      console.error('[ScheduledTasks] Run error:', error);
      window.app.showAlert('Error running task', { type: 'error' });
    }
  },

  /**
   * 删除任务
   */
  async deleteTask(taskId) {
    const task = this._tasks.find(t => t.id === taskId);
    if (!task) return;

    const confirmed = await window.app.showConfirm(`Delete "${task.name}"? This cannot be undone.`, {
      type: 'danger',
      title: 'Delete Task',
      confirmText: 'Delete'
    });
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/scheduled-tasks/${taskId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (response.ok) {
        this._tasks = this._tasks.filter(t => t.id !== taskId);
        this.renderTaskList();
      } else {
        window.app.showAlert('Failed to delete task', { type: 'error' });
      }
    } catch (error) {
      console.error('[ScheduledTasks] Delete error:', error);
      window.app.showAlert('Error deleting task', { type: 'error' });
    }
  },

  /**
   * 显示编辑弹窗
   */
  async showEditModal(taskId) {
    const task = this._tasks.find(t => t.id === taskId);
    if (!task) return;

    this._currentEditTask = task;

    // 获取或创建模态框
    let modal = document.getElementById('task-edit-modal');
    if (!modal) {
      modal = this.createEditModal();
      document.body.appendChild(modal);
    }

    // 填充数据
    document.getElementById('task-edit-name').value = task.name;
    document.getElementById('task-edit-description').value = task.description || '';
    document.getElementById('task-edit-prompt').value = task.prompt;
    document.getElementById('task-edit-cron').value = task.cron_expr;
    document.getElementById('task-edit-workdir').value = task.working_dir;
    document.getElementById('task-edit-session').value = task.session_id || '';
    document.getElementById('task-edit-feishu').checked = task.notify_feishu;

    modal.classList.add('active');
  },

  /**
   * 创建编辑弹窗 HTML
   */
  createEditModal() {
    const modal = document.createElement('div');
    modal.id = 'task-edit-modal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content modal-medium">
        <div class="modal-header">
          <h2 data-i18n="tasks.edit">Edit Task</h2>
          <button id="task-edit-close" class="btn-close">&times;</button>
        </div>
        <div class="modal-body">
          <form id="task-edit-form" class="settings-form">
            <div class="form-group">
              <label data-i18n="tasks.name">Name</label>
              <input type="text" id="task-edit-name" class="form-input" required>
            </div>
            <div class="form-group">
              <label data-i18n="tasks.description">Description</label>
              <input type="text" id="task-edit-description" class="form-input">
            </div>
            <div class="form-group">
              <label data-i18n="tasks.prompt">Prompt</label>
              <textarea id="task-edit-prompt" class="form-input form-textarea" rows="4" required></textarea>
            </div>
            <div class="form-group">
              <label data-i18n="tasks.cronExpr">Cron Expression</label>
              <input type="text" id="task-edit-cron" class="form-input" placeholder="0 8 * * *" required>
              <div class="form-hint" id="cron-hint">
                Examples: <code>0 8 * * *</code> (daily 8am), <code>0 * * * *</code> (hourly), <code>0 9 * * 1</code> (Mon 9am)
              </div>
            </div>
            <div class="form-group">
              <label data-i18n="tasks.workdir">Working Directory</label>
              <input type="text" id="task-edit-workdir" class="form-input" required>
            </div>
            <div class="form-group">
              <label data-i18n="tasks.session">Session ID (optional)</label>
              <input type="text" id="task-edit-session" class="form-input" placeholder="Leave empty to create new session">
            </div>
            <div class="form-group form-checkbox">
              <label>
                <input type="checkbox" id="task-edit-feishu" checked>
                <span data-i18n="tasks.notifyFeishu">Notify via Feishu</span>
              </label>
            </div>
            <div class="form-buttons">
              <button type="button" id="task-edit-cancel" class="btn btn-secondary" data-i18n="common.cancel">Cancel</button>
              <button type="submit" class="btn btn-primary" data-i18n="common.save">Save</button>
            </div>
          </form>
        </div>
      </div>
    `;

    // 绑定事件
    modal.querySelector('#task-edit-close').addEventListener('click', () => this.closeEditModal());
    modal.querySelector('#task-edit-cancel').addEventListener('click', () => this.closeEditModal());
    modal.querySelector('#task-edit-form').addEventListener('submit', (e) => this.saveTask(e));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeEditModal();
    });

    return modal;
  },

  /**
   * 关闭编辑弹窗
   */
  closeEditModal() {
    const modal = document.getElementById('task-edit-modal');
    if (modal) {
      modal.classList.remove('active');
    }
    this._currentEditTask = null;
  },

  /**
   * 保存任务
   */
  async saveTask(e) {
    e.preventDefault();
    if (!this._currentEditTask) return;

    const taskId = this._currentEditTask.id;
    const data = {
      name: document.getElementById('task-edit-name').value,
      description: document.getElementById('task-edit-description').value,
      prompt: document.getElementById('task-edit-prompt').value,
      cron_expr: document.getElementById('task-edit-cron').value,
      working_dir: document.getElementById('task-edit-workdir').value,
      session_id: document.getElementById('task-edit-session').value || null,
      notify_feishu: document.getElementById('task-edit-feishu').checked
    };

    try {
      const response = await fetch(`/api/scheduled-tasks/${taskId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });

      if (response.ok) {
        this.closeEditModal();
        // 重新加载任务列表
        this._tasksLoaded = false;
        this.loadTasks();
      } else {
        const errData = await response.json();
        window.app.showAlert('Failed to save: ' + (errData.detail || 'Unknown error'), { type: 'error' });
      }
    } catch (error) {
      console.error('[ScheduledTasks] Save error:', error);
      window.app.showAlert('Error saving task', { type: 'error' });
    }
  },

  /**
   * 打开任务的 Claude 会话
   */
  async openTaskSession(taskId) {
    const task = this._tasks.find(t => t.id === taskId);
    if (!task || !task.session_id) {
      window.app.showAlert('No session available for this task', { type: 'warning' });
      return;
    }

    // 使用 window.app.connectTerminal 打开终端
    if (window.app && window.app.connectTerminal) {
      window.app.connectTerminal(task.working_dir, task.session_id, task.name);
    } else {
      console.error('[ScheduledTasks] window.app.connectTerminal not available');
      window.app.showAlert('Unable to open terminal', { type: 'error' });
    }
  },

  /**
   * 显示执行历史
   */
  async showHistory(taskId) {
    const task = this._tasks.find(t => t.id === taskId);
    if (!task) return;

    // 初始化分页状态
    this._historyTaskId = taskId;
    this._historyOffset = 0;
    this._historyHasMore = true;
    this._historyLoading = false;
    this._historyTaskName = task.name;

    // 显示模态框并加载第一页
    this.showHistoryModal(task.name, [], true);
    await this.loadHistoryPage();
  },

  /**
   * 加载历史页面数据
   */
  async loadHistoryPage() {
    if (this._historyLoading || !this._historyHasMore) return;

    this._historyLoading = true;
    this.updateHistoryLoadingState(true);

    try {
      const response = await fetch(
        `/api/scheduled-tasks/${this._historyTaskId}/executions?limit=${this._historyPageSize}&offset=${this._historyOffset}`,
        { headers: { 'Authorization': `Bearer ${this.token}` } }
      );

      if (!response.ok) {
        window.app.showAlert('Failed to load history', { type: 'error' });
        return;
      }

      const data = await response.json();
      const executions = data.executions || [];

      // 判断是否还有更多数据
      if (executions.length < this._historyPageSize) {
        this._historyHasMore = false;
      }

      // 更新偏移量
      this._historyOffset += executions.length;

      // 追加数据到列表
      this.appendHistoryItems(executions);

    } catch (error) {
      console.error('[ScheduledTasks] History error:', error);
      window.app.showAlert('Error loading history', { type: 'error' });
    } finally {
      this._historyLoading = false;
      this.updateHistoryLoadingState(false);
    }
  },

  /**
   * 刷新历史（下拉刷新）
   */
  async refreshHistory() {
    if (this._historyLoading) return;

    // 重置分页状态
    this._historyOffset = 0;
    this._historyHasMore = true;

    // 清空现有数据
    const container = document.getElementById('task-history-list');
    if (container) {
      container.innerHTML = '';
    }

    // 加载第一页
    await this.loadHistoryPage();
  },

  /**
   * 更新加载状态显示
   */
  updateHistoryLoadingState(isLoading) {
    const loadingIndicator = document.getElementById('history-loading-indicator');
    const refreshIndicator = document.getElementById('history-refresh-indicator');

    if (loadingIndicator) {
      loadingIndicator.style.display = isLoading && this._historyOffset > 0 ? 'block' : 'none';
    }
    if (refreshIndicator) {
      refreshIndicator.style.display = isLoading && this._historyOffset === 0 ? 'block' : 'none';
    }
  },

  /**
   * 追加历史记录项
   */
  appendHistoryItems(executions) {
    const container = document.getElementById('task-history-list');
    if (!container) return;

    // 如果是第一页且没有数据
    if (this._historyOffset === executions.length && executions.length === 0) {
      container.innerHTML = '<div class="empty-hint">No execution history</div>';
      return;
    }

    // 移除空提示（如果有）
    const emptyHint = container.querySelector('.empty-hint');
    if (emptyHint) {
      emptyHint.remove();
    }

    // 生成 HTML 并追加
    let html = '';
    for (const exec of executions) {
      const statusMap = {
        'success': { icon: '✓', class: 'success', label: 'Success' },
        'failed': { icon: '✗', class: 'failed', label: 'Failed' },
        'timeout': { icon: '◔', class: 'timeout', label: 'Timeout' },
        'skipped': { icon: '»', class: 'skipped', label: 'Skipped' },
        'running': { icon: '●', class: 'running', label: 'Running' }
      };
      const st = statusMap[exec.status] || { icon: '?', class: '', label: exec.status };
      const startTime = this.formatTime(exec.started_at);
      const duration = exec.finished_at ? this.formatDuration(exec.started_at, exec.finished_at) : '--';

      html += `
        <div class="history-item ${st.class}">
          <div class="history-status">
            <span class="history-icon">${st.icon}</span>
            <span class="history-label">${st.label}</span>
          </div>
          <div class="history-time">${startTime}</div>
          <div class="history-duration">${duration}</div>
          ${exec.error ? `<div class="history-error">${this.escapeHtml(exec.error)}</div>` : ''}
        </div>
      `;
    }

    container.insertAdjacentHTML('beforeend', html);

    // 更新"没有更多"提示
    this.updateNoMoreHint();
  },

  /**
   * 更新"没有更多"提示
   */
  updateNoMoreHint() {
    const container = document.getElementById('task-history-list');
    const existingHint = document.getElementById('history-no-more');

    if (!this._historyHasMore && this._historyOffset > 0) {
      if (!existingHint) {
        const hint = document.createElement('div');
        hint.id = 'history-no-more';
        hint.className = 'history-no-more';
        hint.textContent = 'No more records';
        container.appendChild(hint);
      }
    } else if (existingHint) {
      existingHint.remove();
    }
  },

  /**
   * 显示历史弹窗
   */
  showHistoryModal(taskName, executions, reset = false) {
    // 获取或创建模态框
    let modal = document.getElementById('task-history-modal');
    if (!modal) {
      modal = this.createHistoryModal();
      document.body.appendChild(modal);
    }

    document.getElementById('task-history-title').textContent = `History: ${taskName}`;

    // 如果是重置（新打开），清空列表
    if (reset) {
      const container = document.getElementById('task-history-list');
      container.innerHTML = '';
    }

    modal.classList.add('active');
  },

  /**
   * 创建历史弹窗
   */
  createHistoryModal() {
    const modal = document.createElement('div');
    modal.id = 'task-history-modal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content modal-medium">
        <div class="modal-header">
          <h2 id="task-history-title">History</h2>
          <button id="task-history-close" class="btn-close">&times;</button>
        </div>
        <div class="modal-body history-modal-body">
          <div id="history-refresh-indicator" class="history-refresh-indicator" style="display: none;">
            <span class="loading-spinner"></span> Refreshing...
          </div>
          <div id="task-history-list" class="history-list"></div>
          <div id="history-loading-indicator" class="history-loading-indicator" style="display: none;">
            <span class="loading-spinner"></span> Loading more...
          </div>
        </div>
      </div>
    `;

    modal.querySelector('#task-history-close').addEventListener('click', () => {
      modal.classList.remove('active');
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });

    // 滚动监听 - 无限加载和下拉刷新
    const modalBody = modal.querySelector('.history-modal-body');
    let pullStartY = 0;
    let isPulling = false;

    // 滚动加载更多
    modalBody.addEventListener('scroll', () => {
      const { scrollTop, scrollHeight, clientHeight } = modalBody;

      // 滚动到底部附近时加载更多
      if (scrollHeight - scrollTop - clientHeight < 50) {
        if (!this._historyLoading && this._historyHasMore) {
          this.loadHistoryPage();
        }
      }
    });

    // 下拉刷新 - 触摸事件
    modalBody.addEventListener('touchstart', (e) => {
      if (modalBody.scrollTop === 0) {
        pullStartY = e.touches[0].clientY;
        isPulling = true;
      }
    }, { passive: true });

    modalBody.addEventListener('touchmove', (e) => {
      if (!isPulling) return;
      const pullDistance = e.touches[0].clientY - pullStartY;

      // 显示刷新提示
      const refreshIndicator = document.getElementById('history-refresh-indicator');
      if (pullDistance > 50 && modalBody.scrollTop === 0) {
        refreshIndicator.style.display = 'block';
        refreshIndicator.textContent = 'Release to refresh...';
      }
    }, { passive: true });

    modalBody.addEventListener('touchend', (e) => {
      if (!isPulling) return;
      isPulling = false;

      const refreshIndicator = document.getElementById('history-refresh-indicator');
      if (refreshIndicator.style.display === 'block' && !this._historyLoading) {
        refreshIndicator.innerHTML = '<span class="loading-spinner"></span> Refreshing...';
        this.refreshHistory();
      }
    });

    return modal;
  },

  /**
   * 绑定模态框事件（全局）
   */
  bindModalEvents() {
    // 页面级别事件绑定，防止重复
  },

  /**
   * 格式化时间
   */
  formatTime(isoString) {
    if (!isoString) return '--';
    const date = new Date(isoString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const taskDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    const timeStr = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    if (taskDate.getTime() === today.getTime()) {
      return `Today ${timeStr}`;
    }

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (taskDate.getTime() === yesterday.getTime()) {
      return `Yesterday ${timeStr}`;
    }

    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' + timeStr;
  },

  /**
   * 格式化持续时间
   */
  formatDuration(startIso, endIso) {
    const start = new Date(startIso);
    const end = new Date(endIso);
    const seconds = Math.round((end - start) / 1000);

    if (seconds < 60) {
      return `${seconds}s`;
    } else if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}m ${secs}s`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${mins}m`;
    }
  },

  /**
   * HTML 转义
   */
  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};
