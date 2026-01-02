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
 * Swipe Module
 * Handles horizontal swipe navigation and pinned sessions grid
 */
const AppSwipe = {
  // Current page index
  _currentPage: 0,
  // Pinned sessions data
  _pinnedSessions: [],
  // Sessions loaded flag
  _sessionsLoaded: false,
  // Edit mode state
  _editMode: false,
  // SortableJS instance
  _sortable: null,
  // Preview mode state
  _previewMode: false,
  // Swipe up tracking
  _swipeUpStartY: null,
  _swipeUpStartTime: null,

  /**
   * Get page order from localStorage (0=projects first, 1=sessions first)
   */
  getPageOrder() {
    return parseInt(localStorage.getItem('pageOrder') || '0');
  },

  /**
   * Set page order to localStorage
   */
  setPageOrder(order) {
    localStorage.setItem('pageOrder', order.toString());
    this.applyPageOrder();
  },

  /**
   * Toggle page order
   */
  togglePageOrder() {
    const current = this.getPageOrder();
    this.setPageOrder(current === 0 ? 1 : 0);
  },

  /**
   * Enter preview mode - show pages as thumbnails for reordering
   */
  enterPreviewMode() {
    if (this._previewMode) return;
    this._previewMode = true;

    const container = document.getElementById('swipe-container');
    const main = document.getElementById('sessions-main');
    if (!container || !main) return;

    // Add preview mode class
    main.classList.add('preview-mode');

    // Create preview overlay
    const overlay = document.createElement('div');
    overlay.id = 'preview-overlay';
    overlay.className = 'preview-overlay';

    // Get current page order and build previews
    const order = this.getPageOrder();
    const pages = [
      { id: 'page-projects', name: this.t('swipe.projects', 'Projects') },
      { id: 'page-all-sessions', name: this.t('swipe.sessions', 'Sessions') }
    ];

    // Reorder based on current order
    if (order === 1) {
      pages.reverse();
    }

    // Create preview containers with page clones
    let previewHtml = '<div class="preview-container">';
    pages.forEach((page, index) => {
      previewHtml += `
        <div class="preview-item" data-page-id="${page.id}" data-index="${index}" draggable="true">
          <div class="preview-frame">
            <div class="preview-content" id="preview-${page.id}"></div>
          </div>
          <div class="preview-label">${page.name}</div>
        </div>
      `;
    });
    previewHtml += '</div>';
    previewHtml += `<div class="preview-hint">${this.t('swipe.dragToReorder', 'Drag to reorder')}</div>`;

    overlay.innerHTML = previewHtml;
    main.appendChild(overlay);

    // Copy scaled content into previews
    pages.forEach(page => {
      const originalPage = document.getElementById(page.id);
      const previewContent = document.getElementById(`preview-${page.id}`);
      if (originalPage && previewContent) {
        const clone = originalPage.cloneNode(true);
        clone.id = '';
        clone.style.cssText = 'transform: scale(0.35); transform-origin: top left; width: 285.7%; height: 285.7%; pointer-events: none;';
        previewContent.appendChild(clone);
      }
    });

    // Setup drag and drop for preview items
    this._setupPreviewDragDrop(overlay);

    // Click on overlay background to exit
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('preview-hint')) {
        this.exitPreviewMode();
      }
    });

    // Click on preview item to select and exit
    overlay.querySelectorAll('.preview-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (item.classList.contains('dragging')) return;
        const pageId = item.dataset.pageId;
        this.exitPreviewMode();
        // Navigate to the clicked page
        const pageIndex = pageId === 'page-projects'
          ? (this.getPageOrder() === 0 ? 0 : 1)
          : (this.getPageOrder() === 0 ? 1 : 0);
        this.goToPage(pageIndex);
      });
    });
  },

  /**
   * Exit preview mode
   */
  exitPreviewMode() {
    if (!this._previewMode) return;
    this._previewMode = false;

    const main = document.getElementById('sessions-main');
    const overlay = document.getElementById('preview-overlay');
    if (main) main.classList.remove('preview-mode');
    if (overlay) {
      overlay.classList.add('fade-out');
      setTimeout(() => overlay.remove(), 200);
    }
  },

  /**
   * Setup drag and drop for preview items
   */
  _setupPreviewDragDrop(overlay) {
    const container = overlay.querySelector('.preview-container');
    if (!container) return;

    const items = container.querySelectorAll('.preview-item');
    let draggedItem = null;
    let dragStartX = 0;
    let initialLeft = 0;

    items.forEach(item => {
      // Touch events for mobile
      item.addEventListener('touchstart', (e) => {
        draggedItem = item;
        draggedItem.classList.add('dragging');
        const rect = item.getBoundingClientRect();
        dragStartX = e.touches[0].clientX;
        initialLeft = rect.left;
        if (navigator.vibrate) navigator.vibrate(20);
      }, { passive: true });

      item.addEventListener('touchmove', (e) => {
        if (!draggedItem) return;
        e.preventDefault();
        const deltaX = e.touches[0].clientX - dragStartX;
        draggedItem.style.transform = `translateX(${deltaX}px) scale(1.05)`;
        draggedItem.style.zIndex = '10';

        // Check if we should swap
        items.forEach(other => {
          if (other === draggedItem) return;
          const otherRect = other.getBoundingClientRect();
          const currentX = e.touches[0].clientX;
          if (currentX > otherRect.left && currentX < otherRect.right) {
            other.classList.add('swap-target');
          } else {
            other.classList.remove('swap-target');
          }
        });
      });

      item.addEventListener('touchend', (e) => {
        if (!draggedItem) return;

        // Check if we need to swap
        let swapped = false;
        items.forEach(other => {
          if (other !== draggedItem && other.classList.contains('swap-target')) {
            // Swap positions
            this._swapPreviewItems(draggedItem, other, container);
            swapped = true;
          }
          other.classList.remove('swap-target');
        });

        // Reset styles
        draggedItem.style.transform = '';
        draggedItem.style.zIndex = '';
        draggedItem.classList.remove('dragging');
        draggedItem = null;

        if (swapped) {
          // Toggle page order
          this.togglePageOrder();
          this.showToast(this.t('swipe.orderChanged', 'Page order changed'));
          if (navigator.vibrate) navigator.vibrate(50);
        }
      });

      item.addEventListener('touchcancel', () => {
        if (draggedItem) {
          draggedItem.style.transform = '';
          draggedItem.style.zIndex = '';
          draggedItem.classList.remove('dragging');
        }
        draggedItem = null;
        items.forEach(other => other.classList.remove('swap-target'));
      });
    });
  },

  /**
   * Swap two preview items visually
   */
  _swapPreviewItems(item1, item2, container) {
    const items = Array.from(container.children);
    const index1 = items.indexOf(item1);
    const index2 = items.indexOf(item2);

    if (index1 < index2) {
      container.insertBefore(item2, item1);
    } else {
      container.insertBefore(item1, item2);
    }
  },

  /**
   * Apply page order (reorder DOM elements)
   */
  applyPageOrder() {
    const container = document.getElementById('swipe-container');
    const projectsPage = document.getElementById('page-projects');
    const sessionsPage = document.getElementById('page-all-sessions');

    if (!container || !projectsPage || !sessionsPage) return;

    const order = this.getPageOrder();
    if (order === 1) {
      // Sessions first
      container.insertBefore(sessionsPage, projectsPage);
    } else {
      // Projects first (default)
      container.insertBefore(projectsPage, sessionsPage);
    }

    // Update page indicator
    this.updatePageIndicator();
  },

  /**
   * Initialize swipe functionality
   */
  initSwipe() {
    const container = document.getElementById('swipe-container');
    const indicator = document.getElementById('page-indicator');

    if (!container || !indicator) return;

    // Apply saved page order
    this.applyPageOrder();

    // Listen for scroll to update indicator
    container.addEventListener('scroll', () => {
      const pageWidth = container.offsetWidth;
      const scrollLeft = container.scrollLeft;
      const newPage = Math.round(scrollLeft / pageWidth);

      if (newPage !== this._currentPage) {
        this._currentPage = newPage;
        this.updatePageIndicator();

        // Load pinned sessions when switching to sessions page
        const sessionsPageIndex = this.getPageOrder() === 1 ? 0 : 1;
        if (newPage === sessionsPageIndex && !this._sessionsLoaded) {
          this.loadPinnedSessions();
        }
      }
    });

    // Click on indicator dots
    indicator.querySelectorAll('.page-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        const page = parseInt(dot.dataset.page);
        this.goToPage(page);
      });
    });

    // Swipe up on indicator area to enter preview mode
    const indicatorArea = document.createElement('div');
    indicatorArea.className = 'indicator-swipe-area';
    indicator.parentNode.insertBefore(indicatorArea, indicator);
    indicatorArea.appendChild(indicator);

    indicatorArea.addEventListener('touchstart', (e) => {
      if (this._previewMode) return;
      this._swipeUpStartY = e.touches[0].clientY;
      this._swipeUpStartTime = Date.now();
    }, { passive: true });

    indicatorArea.addEventListener('touchmove', (e) => {
      if (this._previewMode || this._swipeUpStartY === null) return;
      const deltaY = this._swipeUpStartY - e.touches[0].clientY;
      // Show visual feedback during swipe
      if (deltaY > 20) {
        indicatorArea.classList.add('swiping-up');
      }
    }, { passive: true });

    indicatorArea.addEventListener('touchend', (e) => {
      indicatorArea.classList.remove('swiping-up');
      if (this._previewMode || this._swipeUpStartY === null) {
        this._swipeUpStartY = null;
        return;
      }

      const touch = e.changedTouches[0];
      const deltaY = this._swipeUpStartY - touch.clientY;
      const deltaTime = Date.now() - this._swipeUpStartTime;

      // Enter preview mode if swiped up by 60px+ within 500ms
      if (deltaY > 60 && deltaTime < 500) {
        this.enterPreviewMode();
        if (navigator.vibrate) navigator.vibrate(30);
      }

      this._swipeUpStartY = null;
      this._swipeUpStartTime = null;
    });

    indicatorArea.addEventListener('touchcancel', () => {
      indicatorArea.classList.remove('swiping-up');
      this._swipeUpStartY = null;
      this._swipeUpStartTime = null;
    });

    // Load pinned sessions if sessions page is first (visible on load)
    const sessionsFirst = this.getPageOrder() === 1;
    if (sessionsFirst) {
      // Sessions page is at index 0, which is visible on initial load
      this.loadPinnedSessions();
    }
  },

  /**
   * Go to specific page
   */
  goToPage(pageIndex) {
    const container = document.getElementById('swipe-container');
    if (!container) return;

    const pageWidth = container.offsetWidth;
    container.scrollTo({
      left: pageWidth * pageIndex,
      behavior: 'smooth'
    });
  },

  /**
   * Update page indicator
   */
  updatePageIndicator() {
    const dots = document.querySelectorAll('.page-dot');
    dots.forEach((dot, index) => {
      dot.classList.toggle('active', index === this._currentPage);
    });
  },

  /**
   * Load pinned sessions from API
   */
  async loadPinnedSessions() {
    const grid = document.getElementById('all-sessions-grid');
    if (!grid) return;

    grid.innerHTML = `<div class="loading">${this.t('sessions.loading', 'Loading...')}</div>`;

    try {
      // Get pinned sessions from API
      const response = await fetch('/api/pinned-sessions', {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (!response.ok) throw new Error('Failed to load pinned sessions');

      const data = await response.json();
      this._pinnedSessions = data.sessions || [];

      // Get active sessions
      const activeSessions = await this.fetchActiveSessions();
      const activeSessionIds = activeSessions.sessions || [];

      this._sessionsLoaded = true;
      this.renderPinnedSessionsGrid(activeSessionIds);
    } catch (error) {
      console.error('Load pinned sessions error:', error);
      grid.innerHTML = `
        <div class="empty">
          <div class="empty-icon">⚠️</div>
          <div class="empty-text">${this.t('error.loadSessions', 'Load failed')}</div>
        </div>
      `;
    }
  },

  /**
   * Render pinned sessions grid
   */
  renderPinnedSessionsGrid(activeSessionIds = []) {
    const grid = document.getElementById('all-sessions-grid');
    if (!grid) return;

    if (this._pinnedSessions.length === 0) {
      grid.innerHTML = `
        <div class="empty">
          <div class="empty-icon">📌</div>
          <div class="empty-text">${this.t('sessions.noPinned', 'No pinned sessions')}</div>
          <div class="empty-hint">${this.t('sessions.pinHint', 'Pin sessions from project list')}</div>
        </div>
      `;
      return;
    }

    // Get frontend connected session IDs
    const frontendConnectedIds = new Set();
    if (this.sessionManager) {
      for (const [id, session] of this.sessionManager.sessions) {
        if (session.claudeSessionId && session.status === 'connected') {
          frontendConnectedIds.add(session.claudeSessionId);
        }
      }
    }

    let html = '';
    for (const session of this._pinnedSessions) {
      const isBackendActive = activeSessionIds.includes(session.session_id);
      const isFrontendConnected = frontendConnectedIds.has(session.session_id);
      const timeStr = this.formatRelativeTime(session.updated_at || session.created_at);
      const projectName = this.getProjectDisplayName(session.working_dir);

      // Status class: frontend-connected (blue) > backend-active (green)
      let statusClass = '';
      if (isFrontendConnected) {
        statusClass = 'is-frontend-connected';
      } else if (isBackendActive) {
        statusClass = 'is-backend-active';
      }

      // Context info (if available)
      let contextHtml = '';
      if (session.context_used > 0) {
        const usedK = Math.round(session.context_used / 1000);
        const maxK = Math.round((session.context_max || 200000) / 1000);
        const pct = session.context_percentage || 0;
        contextHtml = `<span class="session-grid-context">⛁ ${usedK}k/${maxK}k (${pct}%)</span>`;
      }

      html += `
        <div class="session-grid-item ${statusClass}"
             data-session-id="${session.session_id}"
             data-working-dir="${session.working_dir}"
             draggable="true">
          <button class="btn-unpin" title="${this.t('sessions.unpin', 'Unpin')}">✕</button>
          <div class="session-grid-name">${this.escapeHtml(session.display_name || session.session_id.substring(0, 8))}</div>
          <div class="session-grid-project">${this.escapeHtml(projectName)}</div>
          <div class="session-grid-meta">${contextHtml}<span class="session-grid-time">${timeStr}</span></div>
        </div>
      `;
    }

    grid.innerHTML = html;

    // Bind click events
    grid.querySelectorAll('.session-grid-item').forEach(item => {
      // Click to open terminal (only if not in edit mode)
      item.addEventListener('click', (e) => {
        // Ignore if clicking unpin button
        if (e.target.classList.contains('btn-unpin')) return;
        // In edit mode, click exits edit mode
        if (this._editMode) {
          this.exitEditMode();
          return;
        }

        const sessionId = item.dataset.sessionId;
        const workingDir = item.dataset.workingDir;
        const displayName = item.querySelector('.session-grid-name')?.textContent || sessionId;
        this.connectTerminal(workingDir, sessionId, displayName);
      });

      // Unpin button
      const unpinBtn = item.querySelector('.btn-unpin');
      if (unpinBtn) {
        unpinBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.unpinSession(item.dataset.sessionId);
        });
      }
    });

    // Initialize SortableJS
    this.initSortable(grid);

    // Click on empty area to exit edit mode
    grid.addEventListener('click', (e) => {
      if (e.target === grid && this._editMode) {
        this.exitEditMode();
      }
    });
  },

  /**
   * Initialize SortableJS for drag and drop
   */
  initSortable(grid) {
    if (this._sortable) {
      this._sortable.destroy();
    }

    if (typeof Sortable === 'undefined') {
      console.warn('SortableJS not loaded');
      return;
    }

    const self = this;
    this._sortable = new Sortable(grid, {
      animation: 200,
      delay: 300,
      delayOnTouchOnly: true,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      // 简化 fallback 配置
      forceFallback: true,
      fallbackTolerance: 3,
      swapThreshold: 0.65,

      onStart: function(evt) {
        // Enter edit mode on drag start
        self.enterEditMode();
        // Disable page scroll during drag
        const page = document.getElementById('page-all-sessions');
        if (page) page.classList.add('dragging');
        if (navigator.vibrate) navigator.vibrate(50);

        // 手动创建跟随手指的克隆元素
        self._createDragClone(evt.item);
        // 监听 touchmove 实现平滑跟随
        self._startDragTracking();
      },

      onEnd: async function(evt) {
        // 停止跟踪并移除克隆元素
        self._stopDragTracking();
        self._removeDragClone();
        // Re-enable page scroll
        const page = document.getElementById('page-all-sessions');
        if (page) page.classList.remove('dragging');

        if (evt.oldIndex !== evt.newIndex) {
          // Reorder local array
          const [movedSession] = self._pinnedSessions.splice(evt.oldIndex, 1);
          self._pinnedSessions.splice(evt.newIndex, 0, movedSession);

          // Save new positions to backend
          const positions = self._pinnedSessions.map((s, i) => ({
            session_id: s.session_id,
            position: i
          }));

          try {
            await fetch('/api/pinned-sessions/reorder', {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${self.token}`
              },
              body: JSON.stringify({ positions })
            });
          } catch (error) {
            console.error('Reorder error:', error);
          }
        }
      }
    });
  },

  /**
   * Enter edit mode - show delete buttons with animation
   */
  enterEditMode() {
    if (this._editMode) return;
    this._editMode = true;
    const grid = document.getElementById('all-sessions-grid');
    if (grid) {
      grid.classList.add('edit-mode');
    }
  },

  /**
   * Exit edit mode - hide delete buttons
   */
  exitEditMode() {
    if (!this._editMode) return;
    this._editMode = false;
    const grid = document.getElementById('all-sessions-grid');
    if (grid) {
      grid.classList.remove('edit-mode');
    }
  },

  /**
   * Pin a session
   */
  async pinSession(sessionId, workingDir, displayName) {
    try {
      const response = await fetch('/api/pinned-sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({
          session_id: sessionId,
          working_dir: workingDir,
          display_name: displayName
        })
      });

      if (response.status === 409) {
        this.showToast(this.t('sessions.alreadyPinned', 'Already pinned'));
        return false;
      }

      if (!response.ok) throw new Error('Failed to pin session');

      this.showToast(this.t('sessions.pinned', 'Session pinned'));
      this._sessionsLoaded = false;

      // Refresh if on sessions page
      const sessionsPageIndex = this.getPageOrder() === 1 ? 0 : 1;
      if (this._currentPage === sessionsPageIndex) {
        this.loadPinnedSessions();
      }

      return true;
    } catch (error) {
      console.error('Pin session error:', error);
      this.showToast(this.t('error.pinFailed', 'Pin failed'));
      return false;
    }
  },

  /**
   * Unpin a session
   */
  async unpinSession(sessionId) {
    try {
      const response = await fetch(`/api/pinned-sessions/${sessionId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (!response.ok) throw new Error('Failed to unpin session');

      // Remove from local array
      this._pinnedSessions = this._pinnedSessions.filter(s => s.session_id !== sessionId);

      // Re-render grid
      const activeSessions = await this.fetchActiveSessions();
      this.renderPinnedSessionsGrid(activeSessions.sessions || []);

      this.showToast(this.t('sessions.unpinned', 'Session unpinned'));
    } catch (error) {
      console.error('Unpin session error:', error);
      this.showToast(this.t('error.unpinFailed', 'Unpin failed'));
    }
  },

  /**
   * Check if session is pinned
   */
  async isSessionPinned(sessionId) {
    try {
      const response = await fetch(`/api/pinned-sessions/${sessionId}/check`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      if (response.ok) {
        const data = await response.json();
        return data.pinned;
      }
    } catch (error) {
      console.error('Check pinned error:', error);
    }
    return false;
  },

  /**
   * 开始跟踪触摸移动（平滑动画）
   */
  _startDragTracking() {
    this._onTouchMove = (e) => {
      if (e.touches && e.touches[0]) {
        this._updateDragClone(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    this._onMouseMove = (e) => {
      this._updateDragClone(e.clientX, e.clientY);
    };
    document.addEventListener('touchmove', this._onTouchMove, { passive: true });
    document.addEventListener('mousemove', this._onMouseMove, { passive: true });
  },

  /**
   * 停止跟踪触摸移动
   */
  _stopDragTracking() {
    if (this._onTouchMove) {
      document.removeEventListener('touchmove', this._onTouchMove);
      this._onTouchMove = null;
    }
    if (this._onMouseMove) {
      document.removeEventListener('mousemove', this._onMouseMove);
      this._onMouseMove = null;
    }
  },

  /**
   * 创建跟随手指的拖动克隆元素
   */
  _createDragClone(item) {
    // 移除旧的克隆
    this._removeDragClone();

    // 克隆元素
    const clone = item.cloneNode(true);
    clone.id = 'drag-clone';
    clone.className = 'session-grid-item drag-clone';

    // 获取原始元素位置和尺寸
    const rect = item.getBoundingClientRect();
    clone.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      z-index: 99999;
      pointer-events: none;
      opacity: 0.95;
      transform: scale(1.05) rotate(2deg);
      box-shadow: 0 20px 50px rgba(0,0,0,0.5);
      border: 2px solid #4a9eff;
      transition: none;
    `;

    document.body.appendChild(clone);
    this._dragClone = clone;
    this._dragOffset = {
      x: rect.width / 2,
      y: rect.height / 2
    };

    // 让原始元素变半透明
    item.style.opacity = '0.3';
    this._dragOriginal = item;
  },

  /**
   * 更新克隆元素位置
   */
  _updateDragClone(clientX, clientY) {
    if (!this._dragClone) return;
    this._dragClone.style.left = (clientX - this._dragOffset.x) + 'px';
    this._dragClone.style.top = (clientY - this._dragOffset.y) + 'px';
  },

  /**
   * 移除克隆元素
   */
  _removeDragClone() {
    if (this._dragClone) {
      this._dragClone.remove();
      this._dragClone = null;
    }
    if (this._dragOriginal) {
      this._dragOriginal.style.opacity = '';
      this._dragOriginal = null;
    }
  },

  /**
   * Get project display name from path
   */
  getProjectDisplayName(workDir) {
    if (!workDir) return '';
    // Get last part of path
    const parts = workDir.split('/').filter(p => p);
    return parts[parts.length - 1] || workDir;
  },

  /**
   * Format relative time
   */
  formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return this.t('time.justNow', 'Just now');
    if (diffMins < 60) return `${diffMins}${this.t('time.minAgo', 'm ago')}`;
    if (diffHours < 24) return `${diffHours}${this.t('time.hourAgo', 'h ago')}`;
    if (diffDays < 7) return `${diffDays}${this.t('time.dayAgo', 'd ago')}`;

    return date.toLocaleDateString();
  },

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  /**
   * Refresh pinned sessions
   */
  refreshPinnedSessions() {
    this._sessionsLoaded = false;
    const sessionsPageIndex = this.getPageOrder() === 1 ? 0 : 1;
    if (this._currentPage === sessionsPageIndex) {
      this.loadPinnedSessions();
    }
  }
};

// Export for mixin
if (typeof window !== 'undefined') {
  window.AppSwipe = AppSwipe;
}
