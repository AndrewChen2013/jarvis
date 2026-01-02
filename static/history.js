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
 * Terminal History Module
 * Provides terminal input/output history viewing
 */
const AppHistory = {
  // Current state
  _currentSessionId: null,
  _currentOffset: 0,
  _pageSize: 50,

  /**
   * Initialize history functionality
   */
  initHistory() {
    // Initialize properties (mixin only copies functions, not properties)
    this._historySessionId = null;
    this._historyOffset = 0;
    this._historyPageSize = 10;
    this._historyLoading = false;
    this._historyHasMore = true;

    const menuTerminalHistory = document.getElementById('menu-terminal-history');
    const terminalHistoryBtn = document.getElementById('terminal-history-btn');

    if (menuTerminalHistory) {
      menuTerminalHistory.addEventListener('click', () => {
        this.showTerminalHistory();
      });
    }

    // Entry from terminal view
    if (terminalHistoryBtn) {
      terminalHistoryBtn.addEventListener('click', () => {
        this.showTerminalHistoryModal();
      });
    }
  },

  /**
   * Show terminal history (from settings menu)
   */
  async showTerminalHistory() {
    const menu = document.getElementById('settings-menu');
    const backBtn = document.getElementById('settings-back-btn');
    const modalTitle = document.getElementById('settings-modal-title');

    if (menu) menu.style.display = 'none';
    if (backBtn) backBtn.classList.remove('hidden');
    if (modalTitle) modalTitle.textContent = this.t('history.title', 'Terminal History');

    // Create or get history page
    let historyPage = document.getElementById('settings-terminal-history');
    if (!historyPage) {
      historyPage = document.createElement('div');
      historyPage.id = 'settings-terminal-history';
      historyPage.className = 'settings-page';
      document.querySelector('#settings-modal .modal-body').appendChild(historyPage);
    }

    historyPage.classList.add('active');
    this._historySessionId = null;
    await this.loadSessionList(historyPage);
  },

  /**
   * Show terminal history modal (from terminal view)
   * Directly shows current session history without session selection
   */
  async showTerminalHistoryModal() {
    // Must have current session
    const currentSessionId = this.currentSession;
    if (!currentSessionId) {
      this.showToast(this.t('history.noSession', 'No active session'), 'error');
      return;
    }

    // Remove existing modal
    const existingModal = document.getElementById('terminal-history-modal');
    if (existingModal) {
      existingModal.remove();
    }

    // Create modal - simplified without back button
    const modal = document.createElement('div');
    modal.id = 'terminal-history-modal';
    modal.className = 'modal active';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>${this.t('history.sessionHistory', 'Session History')}</h2>
          <button id="history-modal-close" class="btn-close">&times;</button>
        </div>
        <div class="modal-body">
          <div id="history-modal-content" class="history-content">
            <div class="loading">${this.t('common.loading', 'Loading...')}</div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Bind events
    const closeBtn = document.getElementById('history-modal-close');
    const content = document.getElementById('history-modal-content');

    closeBtn.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    // Directly load current session history
    this._historySessionId = currentSessionId;
    await this.loadHistoryForSession(currentSessionId, content, true);
  },

  /**
   * Show history modal for a specific session (from session list)
   * @param {string} sessionId - Session ID to show history for
   */
  async showSessionHistoryModal(sessionId) {
    if (!sessionId) {
      return;
    }

    // Remove existing modal
    const existingModal = document.getElementById('terminal-history-modal');
    if (existingModal) {
      existingModal.remove();
    }

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'terminal-history-modal';
    modal.className = 'modal active';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>${this.t('history.sessionHistory', 'Session History')}</h2>
          <button id="history-modal-close" class="btn-close">&times;</button>
        </div>
        <div class="modal-body">
          <div id="history-modal-content" class="history-content">
            <div class="loading">${this.t('common.loading', 'Loading...')}</div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Bind events
    const closeBtn = document.getElementById('history-modal-close');
    const content = document.getElementById('history-modal-content');

    closeBtn.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    // Load session history
    this._historySessionId = sessionId;
    await this.loadHistoryForSession(sessionId, content, true);
  },

  /**
   * Load session list
   * @param {HTMLElement} container - Container element
   * @param {boolean} isModal - Is in modal mode
   */
  async loadSessionList(container, isModal = false) {
    container.innerHTML = `<div class="loading">${this.t('common.loading', 'Loading...')}</div>`;

    try {
      const response = await fetch('/api/terminal/sessions', {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (!response.ok) {
        throw new Error('Failed to load sessions');
      }

      const data = await response.json();
      const sessions = data.sessions || [];

      if (sessions.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">💬</div>
            <div class="empty-text">${this.t('history.noSessions', 'No terminal history')}</div>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div class="history-session-list">
          ${sessions.map(session => this.renderSessionItem(session)).join('')}
        </div>
      `;

      // Bind click events
      container.querySelectorAll('.history-session-item').forEach(item => {
        item.addEventListener('click', () => {
          const sessionId = item.dataset.sessionId;
          this._historySessionId = sessionId;

          if (isModal) {
            const backBtn = document.getElementById('history-modal-back-btn');
            const title = document.getElementById('history-modal-title');
            if (backBtn) backBtn.classList.remove('hidden');
            if (title) title.textContent = this.t('history.sessionHistory', 'Session History');
          } else {
            // In settings, use back button
            const backBtn = document.getElementById('settings-back-btn');
            if (backBtn) backBtn.classList.remove('hidden');
          }

          this.loadHistoryForSession(sessionId, container, isModal);
        });
      });

    } catch (error) {
      console.error('Load sessions error:', error);
      container.innerHTML = `
        <div class="error-state">
          <div class="error-text">${this.t('history.loadError', 'Failed to load history')}</div>
        </div>
      `;
    }
  },

  /**
   * Render session item
   * @param {Object} session - Session data
   */
  renderSessionItem(session) {
    const name = session.name || session.session_id.substring(0, 8) + '...';
    const count = session.message_count || 0;
    const lastActivity = this.formatDateTime(session.last_activity);

    return `
      <div class="history-session-item" data-session-id="${session.session_id}">
        <div class="history-session-icon">💬</div>
        <div class="history-session-info">
          <div class="history-session-name">${name}</div>
          <div class="history-session-meta">
            ${count} ${this.t('history.messages', 'messages')} · ${lastActivity}
          </div>
        </div>
        <span class="history-session-arrow">›</span>
      </div>
    `;
  },

  /**
   * Load history for a session
   * @param {string} sessionId - Session ID
   * @param {HTMLElement} container - Container element
   * @param {boolean} isModal - Is in modal mode
   */
  async loadHistoryForSession(sessionId, container, isModal = false) {
    container.innerHTML = `<div class="loading">${this.t('common.loading', 'Loading...')}</div>`;
    this._historyOffset = 0;

    try {
      const response = await fetch(
        `/api/terminal/history?session_id=${encodeURIComponent(sessionId)}&limit=${this._historyPageSize}&offset=0`,
        { headers: { 'Authorization': `Bearer ${this.token}` } }
      );

      if (!response.ok) {
        throw new Error('Failed to load history');
      }

      const data = await response.json();
      const history = data.history || [];

      if (history.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📝</div>
            <div class="empty-text">${this.t('history.noMessages', 'No messages in this session')}</div>
          </div>
        `;
        return;
      }

      // Keep time descending order (newest first)
      this._historyHasMore = data.has_more;
      this._historyOffset = 0;
      this._historyLoading = false;

      container.innerHTML = `
        <div class="history-message-list">
          ${history.map(item => this.renderHistoryItem(item)).join('')}
        </div>
      `;

      // 滚动自动加载
      this.setupHistoryScroll(sessionId, container, isModal);

    } catch (error) {
      console.error('Load history error:', error);
      container.innerHTML = `
        <div class="error-state">
          <div class="error-text">${this.t('history.loadError', 'Failed to load history')}</div>
        </div>
      `;
    }
  },

  /**
   * Setup scroll auto-load and pull-to-refresh
   */
  setupHistoryScroll(sessionId, container, isModal) {
    // 找到滚动容器（modal body 或 container 本身）
    const scrollContainer = isModal
      ? container.closest('.modal-body') || container
      : container;

    // 向下滚动自动加载
    const handleScroll = () => {
      if (this._historyLoading || !this._historyHasMore) return;

      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      // 距离底部 100px 时开始加载
      if (scrollHeight - scrollTop - clientHeight < 100) {
        this.loadMoreHistory(sessionId, container);
      }
    };

    scrollContainer.addEventListener('scroll', handleScroll);

    // 下拉刷新
    let startY = 0;
    let pulling = false;
    const pullThreshold = 60;
    let pullIndicator = null;

    const createPullIndicator = () => {
      if (!pullIndicator) {
        pullIndicator = document.createElement('div');
        pullIndicator.className = 'history-pull-indicator';
        pullIndicator.innerHTML = '<div class="history-spinner"></div>';
        container.insertBefore(pullIndicator, container.firstChild);
      }
      return pullIndicator;
    };

    scrollContainer.addEventListener('touchstart', (e) => {
      if (scrollContainer.scrollTop === 0) {
        startY = e.touches[0].clientY;
        pulling = true;
      }
    }, { passive: true });

    scrollContainer.addEventListener('touchmove', (e) => {
      if (!pulling) return;
      const deltaY = e.touches[0].clientY - startY;
      if (deltaY > 0 && deltaY < 120) {
        const indicator = createPullIndicator();
        indicator.style.height = Math.min(deltaY, pullThreshold) + 'px';
        indicator.style.opacity = Math.min(deltaY / pullThreshold, 1);
      }
    }, { passive: true });

    scrollContainer.addEventListener('touchend', async () => {
      if (!pulling || !pullIndicator) return;
      pulling = false;

      const height = parseInt(pullIndicator.style.height) || 0;
      if (height >= pullThreshold) {
        // 触发刷新
        pullIndicator.style.height = '40px';
        await this.refreshHistory(sessionId, container, isModal);
      }

      // 隐藏指示器
      if (pullIndicator) {
        pullIndicator.style.height = '0';
        pullIndicator.style.opacity = '0';
      }
    });
  },

  /**
   * Refresh history (pull-to-refresh)
   */
  async refreshHistory(sessionId, container, isModal) {
    this._historyOffset = 0;
    this._historyHasMore = true;
    await this.loadHistoryForSession(sessionId, container, isModal);
  },

  /**
   * Load more history items
   */
  async loadMoreHistory(sessionId, container) {
    if (this._historyLoading || !this._historyHasMore) return;

    this._historyLoading = true;
    this._historyOffset += this._historyPageSize;

    // 显示加载动画
    const list = container.querySelector('.history-message-list');
    let loader = container.querySelector('.history-loader');
    if (!loader && list) {
      loader = document.createElement('div');
      loader.className = 'history-loader';
      loader.innerHTML = '<div class="history-spinner"></div>';
      list.parentNode.insertBefore(loader, list.nextSibling);
    }
    if (loader) loader.style.display = 'flex';

    try {
      const response = await fetch(
        `/api/terminal/history?session_id=${encodeURIComponent(sessionId)}&limit=${this._historyPageSize}&offset=${this._historyOffset}`,
        { headers: { 'Authorization': `Bearer ${this.token}` } }
      );

      if (!response.ok) {
        throw new Error('Failed to load more');
      }

      const data = await response.json();
      const history = data.history || [];

      // Append at end of list (older items)
      if (list && history.length > 0) {
        const newItems = history.map(item => this.renderHistoryItem(item)).join('');
        list.insertAdjacentHTML('beforeend', newItems);
      }

      this._historyHasMore = data.has_more;

      // 没有更多时移除加载动画
      if (!data.has_more && loader) {
        loader.remove();
      }

    } catch (error) {
      console.error('Load more error:', error);
    } finally {
      this._historyLoading = false;
      if (loader) loader.style.display = 'none';
    }
  },

  /**
   * Render history item
   * @param {Object} item - History item
   */
  renderHistoryItem(item) {
    const time = this.formatTime(item.created_at);
    let content = item.text_content || '';

    // 清理内容
    content = content
      .split('\n')
      .map(line => line.trimEnd())        // 每行去掉尾部空格
      .join('\n')
      .trim()                              // 去掉首尾空白
      .replace(/\n{3,}/g, '\n\n')          // 3个以上换行合并为2个
      .replace(/^\s*\n/gm, '\n');          // 只有空格的行变成空行

    // 再次合并（处理后可能产生新的连续空行）
    content = content.replace(/\n{3,}/g, '\n\n');
    content = this.escapeHtml(content);

    if (!content) return '';  // 跳过空内容

    return `
      <div class="history-message-item">
        <span class="history-time">${time}</span>
        <pre class="history-content">${content}</pre>
      </div>
    `;
  },

  /**
   * Escape HTML characters
   * @param {string} str - Input string
   */
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /**
   * Format time
   * @param {string} isoString - ISO date string
   */
  formatTime(isoString) {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      return '';
    }
  },

  /**
   * Format datetime
   * @param {string} isoString - ISO date string
   */
  formatDateTime(isoString) {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();

      if (isToday) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
          ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    } catch (e) {
      return isoString;
    }
  }
};

// Export to global
window.AppHistory = AppHistory;
