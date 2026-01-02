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
 * 项目和会话管理模块
 * 提供项目列表、会话弹窗、创建会话等功能
 */
const AppProjects = {
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
  },

  /**
   * 关闭创建会话模态框
   */
  closeCreateModal() {
    document.getElementById('create-modal').classList.remove('active');
    this.selectedWorkDir = null;
  },

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
  },

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
  },

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
  },

  /**
   * 选择工作目录
   */
  async selectWorkDir(workDir) {
    this.selectedWorkDir = workDir;
    document.getElementById('selected-workdir-text').textContent = workDir;
    this.showStep('session');
    await this.loadClaudeSessions(workDir);
  },

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
  },

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
  },

  /**
   * 加载项目列表（新版 - 从 Claude Projects）
   */
  async loadSessions() {
    this.debugLog('[loadSessions] called, token=' + (this.token ? 'yes' : 'no'));
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

      if (!projectsResponse.ok) {
        console.error('[loadSessions] API error:', projectsResponse.status, projectsResponse.statusText);
        throw new Error('Failed to load projects');
      }

      const projects = await projectsResponse.json();
      this.debugLog('[loadSessions] success, projects=' + projects.length);
      this.renderProjects(projects, activeSessions);
    } catch (error) {
      this.debugLog('[loadSessions] error: ' + error.name + ' ' + error.message);
      // 页面正在刷新时，忽略所有错误
      if (window._isPageReloading) {
        this.debugLog('[loadSessions] Page reloading, ignoring error');
        return;
      }
      // 忽略 AbortError（页面刷新时请求被取消）
      if (error.name === 'AbortError') {
        this.debugLog('[loadSessions] Request aborted, ignoring');
        return;
      }
      // 只有在 sessions 视图激活时才显示错误弹窗
      const sessionsView = document.getElementById('sessions-view');
      if (sessionsView && sessionsView.classList.contains('active')) {
        this.showError(this.t('error.loadSessions'));
      }
    }
  },

  /**
   * 渲染项目列表（新版）
   */
  renderProjects(projects, activeSessions = { sessions: [], working_dirs: [] }) {
    const container = document.getElementById('sessions-list');
    if (!container) return;  // 页面刷新时可能不存在
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
  },

  /**
   * 显示项目下的会话列表
   */
  async showProjectSessions(workDir) {
    // 防止重复点击
    if (this.isLoadingProjectSessions) {
      return;
    }
    this.isLoadingProjectSessions = true;

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
      // 页面正在刷新时，忽略错误
      if (!window._isPageReloading) {
        this.showError(this.t('sessions.loadFailed'));
      }
    } finally {
      this.isLoadingProjectSessions = false;
    }
  },

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

      // 获取保存的主题颜色
      const savedTheme = this.loadSessionTheme(session.session_id);
      if (savedTheme && typeof TERMINAL_THEMES !== 'undefined' && TERMINAL_THEMES[savedTheme]) {
        item.style.borderLeftColor = TERMINAL_THEMES[savedTheme].foreground;
      }

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

      // 格式化 token 数量
      const tokenDisplay = session.total_tokens > 0 ? this.formatTokens(session.total_tokens) : '--';

      // Context 信息显示 - 方案 A 风格
      const usedK = Math.round((session.context_used || 0) / 1000);
      const maxK = Math.round((session.context_max || 200000) / 1000);
      const freeK = Math.round((session.context_free || 0) / 1000);
      const untilK = Math.round((session.context_until_compact || 0) / 1000);
      const pct = session.context_percentage || 0;

      // 从 categories 提取详细信息
      const categories = session.context_categories || {};
      const sysPrompt = categories['System prompt'];
      const sysTools = categories['System tools'];
      const messages = categories['Messages'];

      // 构建 context 详情 HTML - 方案 A 风格
      let contextHtml = '';
      if (session.context_used > 0) {
        // 主指标行
        const headerLine = `<div class="ctx-header">${usedK}k / ${maxK}k <span class="ctx-pct">(${pct}%)</span></div>`;

        // 分类行：紧凑显示
        let categoryLine = '';
        const catParts = [];
        if (sysPrompt) catParts.push(`<span class="ctx-sys">⛁Sys ${(sysPrompt.tokens / 1000).toFixed(1)}k</span>`);
        if (sysTools) catParts.push(`<span class="ctx-tool">⛁Tool ${(sysTools.tokens / 1000).toFixed(1)}k</span>`);
        if (messages) catParts.push(`<span class="ctx-msg">⛁Msg ${(messages.tokens / 1000).toFixed(1)}k</span>`);
        if (catParts.length > 0) {
          categoryLine = `<div class="ctx-cats">${catParts.join('')}</div>`;
        }

        // 空闲和压缩行 + token（和上面时间对齐）
        const statusLine = `<div class="ctx-status">
          <span class="ctx-free">⛶ Free ${freeK}k</span>
          <span class="ctx-compact">⛝ ${untilK > 0 ? untilK + 'k' : 'soon'}</span>
          <span class="ctx-tokens">⚡${tokenDisplay}</span>
        </div>`;

        contextHtml = `
          <div class="claude-session-context">
            ${headerLine}
            ${categoryLine}
            ${statusLine}
          </div>
        `;
      }

      item.innerHTML = `
        <div class="claude-session-info">
          ${nameHtml}
          <div class="claude-session-meta">
            <span class="claude-session-id">${session.session_id.substring(0, 8)}...</span>
            <span class="claude-session-time">${this.formatTime(session.updated_at)}</span>
          </div>
          ${contextHtml}
        </div>
        <button class="btn-session-history" title="${this.t('history.title', 'History')}">▤</button>
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

      // 点击历史按钮
      item.querySelector('.btn-session-history').addEventListener('click', (e) => {
        e.stopPropagation();
        this.showSessionHistoryModal(session.session_id);
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
  },

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
  },

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
  },

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
  },

  /**
   * 创建新会话（点击"新建会话"按钮）
   */
  createNewSession(workDir) {
    // 新建会话：sessionId 为 null
    this.connectTerminal(workDir, null, this.t('create.newSession', 'New Session'));
  },

  /**
   * 旧版创建会话（兼容）
   * @deprecated 使用 connectTerminal 代替
   */
  async createSession(workDir, claudeSessionId) {
    // 转发到新方法
    const sessionName = claudeSessionId ? null : this.t('create.newSession', 'New Session');
    this.connectTerminal(workDir, claudeSessionId, sessionName);
  },

  /**
   * 从 localStorage 加载 session 主题
   */
  loadSessionTheme(sessionId) {
    try {
      const themes = JSON.parse(localStorage.getItem('session-themes') || '{}');
      return themes[sessionId] || null;
    } catch (e) {
      return null;
    }
  }
};

// 导出到全局
window.AppProjects = AppProjects;
