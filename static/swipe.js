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
// Page constants (accessible to all methods)
const SWIPE_PAGE_IDS = ['page-projects', 'page-all-sessions', 'page-files', 'page-remote', 'page-monitor', 'page-scheduled-tasks'];
const SWIPE_PAGE_NAMES = { 'page-projects': 'Projects', 'page-all-sessions': 'Sessions', 'page-files': 'Files', 'page-remote': 'Remote', 'page-monitor': 'Monitor', 'page-scheduled-tasks': 'Tasks' };

const AppSwipe = {

  // Current page index (default to middle page for optimal navigation)
  _currentPage: 2,
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

  /**
   * Get page order from localStorage as array [0,1,2]
   * Supports migration from old format (0 or 1)
   */
  getPageOrder() {
    const saved = localStorage.getItem('pageOrder');

    // Migration from old binary format
    if (saved === '0' || saved === null || saved === undefined) {
      return [0, 1, 2, 3, 4, 5]; // Projects, Sessions, Files, Remote, Monitor, Tasks
    }
    if (saved === '1') {
      return [1, 0, 2, 3, 4, 5]; // Sessions, Projects, Files, Remote, Monitor, Tasks
    }

    // New array format
    try {
      const order = JSON.parse(saved);
      if (Array.isArray(order)) {
        // Migration: 3 pages -> 6 pages
        if (order.length === 3) {
          return [...order, 3, 4, 5];
        }
        // Migration: 4 pages -> 6 pages
        if (order.length === 4) {
          return [...order, 4, 5];
        }
        // Migration: 5 pages -> 6 pages
        if (order.length === 5) {
          return [...order, 5];
        }
        if (order.length === 6) {
          return order;
        }
      }
    } catch (e) {}

    return [0, 1, 2, 3, 4, 5]; // Default
  },

  /**
   * Set page order to localStorage as JSON array
   */
  setPageOrder(order) {
    localStorage.setItem('pageOrder', JSON.stringify(order));
    this.applyPageOrder();
  },

  /**
   * Swap two pages in the order array
   */
  swapPageOrder(indexA, indexB) {
    const order = this.getPageOrder();
    [order[indexA], order[indexB]] = [order[indexB], order[indexA]];
    this.setPageOrder(order);
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

    // Get current page order and build previews (now supports 3 pages)
    const order = this.getPageOrder();
    const pages = order.map((pageIdx, orderIdx) => ({
      id: SWIPE_PAGE_IDS[pageIdx],
      name: this.t(`swipe.${SWIPE_PAGE_IDS[pageIdx].replace('page-', '').replace('-', '')}`, SWIPE_PAGE_NAMES[SWIPE_PAGE_IDS[pageIdx]]),
      orderIndex: orderIdx
    }));

    // Create preview containers with page clones
    let previewHtml = '<div class="preview-container">';
    pages.forEach((page) => {
      previewHtml += `
        <div class="preview-item" data-page-id="${page.id}" data-order-index="${page.orderIndex}" draggable="true">
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

    // Copy scaled content into previews (scale for 3 items)
    pages.forEach(page => {
      const originalPage = document.getElementById(page.id);
      const previewContent = document.getElementById(`preview-${page.id}`);
      if (originalPage && previewContent) {
        const clone = originalPage.cloneNode(true);
        clone.id = '';
        clone.style.cssText = 'transform: scale(0.28); transform-origin: top left; width: 357%; height: 357%; pointer-events: none;';
        previewContent.appendChild(clone);
      }
    });

    // Setup drag and drop for preview items
    this._setupPreviewDragDrop(overlay);

    // Get the preview container for bounds checking
    const previewContainer = overlay.querySelector('.preview-container');

    // Click handler - exit when clicking on side margins, hint, or lower area
    overlay.addEventListener('click', (e) => {
      // Clicking on preview items is handled separately
      if (e.target.closest('.preview-item')) return;

      // Get container bounds
      if (previewContainer) {
        const containerRect = previewContainer.getBoundingClientRect();
        const clickX = e.clientX;
        const clickY = e.clientY;

        // Exit if clicking below the preview container (hint area and below)
        if (clickY > containerRect.bottom) {
          this.exitPreviewMode();
          return;
        }

        // Exit if clicking on the true side margins (outside container horizontally)
        // Upper blank area should not exit (allow scrolling)
        const isInVerticalRange = clickY >= containerRect.top - 50 && clickY <= containerRect.bottom;
        const isOutsideHorizontally = clickX < containerRect.left - 20 || clickX > containerRect.right + 20;

        if (isOutsideHorizontally && isInVerticalRange) {
          this.exitPreviewMode();
          return;
        }
      }
    });

    // Add swipe down gesture to exit preview mode
    let touchStartY = 0;
    overlay.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touchStartY = e.touches[0].clientY;
      }
    }, { passive: true });

    overlay.addEventListener('touchend', (e) => {
      if (e.changedTouches.length === 1) {
        const deltaY = e.changedTouches[0].clientY - touchStartY;
        // Swipe down more than 100px to exit
        if (deltaY > 100) {
          this.exitPreviewMode();
        }
      }
    });

    // Click on preview item to select and exit
    overlay.querySelectorAll('.preview-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (item.classList.contains('dragging')) return;
        const orderIndex = parseInt(item.dataset.orderIndex);
        this.exitPreviewMode();
        // Navigate to the clicked page
        this.goToPage(orderIndex);
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
   * Setup drag and drop for preview items (iOS-style with real-time shifting)
   */
  _setupPreviewDragDrop(overlay) {
    const container = overlay.querySelector('.preview-container');
    if (!container) return;

    let draggedItem = null;
    let dragStartX = 0;
    let dragStartScrollLeft = 0;
    let autoScrollRAF = null;
    let currentScrollSpeed = 0;
    let lastTouchX = 0;
    let originalIndex = -1;
    let currentTargetIndex = -1;
    let itemPositions = []; // Store original positions of all items
    const self = this;

    // Get all items as array
    const getItems = () => Array.from(container.querySelectorAll('.preview-item'));

    // Calculate item width including gap
    const getItemWidth = () => {
      const items = getItems();
      if (items.length < 2) return 0;
      const rect0 = items[0].getBoundingClientRect();
      const rect1 = items[1].getBoundingClientRect();
      return rect1.left - rect0.left;
    };

    // Update dragged item visual position
    const updateDraggedItemPosition = () => {
      if (!draggedItem) return;
      const fingerDelta = lastTouchX - dragStartX;
      const scrollDelta = container.scrollLeft - dragStartScrollLeft;
      const totalDelta = fingerDelta + scrollDelta;
      draggedItem.style.transform = `translateX(${totalDelta}px) scale(1.05)`;
    };

    // Calculate target index based on finger position
    // Uses midpoints between item centers as slot boundaries
    const calculateTargetIndex = () => {
      if (!draggedItem || itemPositions.length === 0) return originalIndex;

      const fingerX = lastTouchX;
      const scrollDelta = container.scrollLeft - dragStartScrollLeft;
      const n = itemPositions.length;

      // Find which slot the finger is in
      // Slot boundaries are midpoints between adjacent item centers
      for (let i = 0; i < n; i++) {
        const centerX = itemPositions[i].centerX - scrollDelta;

        if (i < n - 1) {
          // Calculate right boundary (midpoint to next item)
          const nextCenterX = itemPositions[i + 1].centerX - scrollDelta;
          const rightBoundary = (centerX + nextCenterX) / 2;

          if (fingerX <= rightBoundary) {
            return i;
          }
        } else {
          // Last item: if we reached here, finger is in the last slot
          return i;
        }
      }

      return originalIndex;
    };

    // Shift items based on target index (iOS-style)
    const updateItemShifts = (targetIdx) => {
      if (targetIdx === currentTargetIndex) return;
      currentTargetIndex = targetIdx;

      const items = getItems();
      const itemWidth = getItemWidth();

      items.forEach((item, idx) => {
        if (item === draggedItem) return;

        let shiftAmount = 0;

        if (originalIndex < targetIdx) {
          // Moving right: items after original and up to target shift left
          if (idx > originalIndex && idx <= targetIdx) {
            shiftAmount = -itemWidth;
          }
        } else if (originalIndex > targetIdx) {
          // Moving left: items from target to before original shift right
          if (idx >= targetIdx && idx < originalIndex) {
            shiftAmount = itemWidth;
          }
        }

        // Apply smooth transition
        item.style.transition = 'transform 0.2s ease-out';
        item.style.transform = shiftAmount !== 0 ? `translateX(${shiftAmount}px)` : '';
      });

      // Haptic feedback on target change
      if (navigator.vibrate && targetIdx !== originalIndex) {
        navigator.vibrate(10);
      }
    };

    // Auto-scroll with acceleration based on edge proximity
    const updateAutoScroll = () => {
      const edgeThreshold = 80;
      const screenWidth = window.innerWidth;
      const maxSpeed = 35;
      const minSpeed = 12;

      // Calculate scroll boundaries
      // Use a conservative limit to ensure left items remain partially visible when dragging right
      const fullMaxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      // Limit scroll to keep at least 60px of content visible on the left side
      const conservativeMaxScroll = Math.max(0, fullMaxScrollLeft - 60);
      const atLeftBoundary = container.scrollLeft <= 1;
      const atRightBoundary = container.scrollLeft >= conservativeMaxScroll - 1;

      let targetSpeed = 0;

      if (lastTouchX < edgeThreshold && !atLeftBoundary) {
        // Scroll left, but only if not at the start
        const proximity = 1 - (lastTouchX / edgeThreshold);
        targetSpeed = -(minSpeed + (maxSpeed - minSpeed) * proximity * proximity);
      } else if (lastTouchX > screenWidth - edgeThreshold && !atRightBoundary) {
        // Scroll right, but only if not at the end
        const proximity = 1 - ((screenWidth - lastTouchX) / edgeThreshold);
        targetSpeed = minSpeed + (maxSpeed - minSpeed) * proximity * proximity;
      }

      // At boundary, immediately stop rather than gradually slow down
      if ((targetSpeed < 0 && atLeftBoundary) || (targetSpeed > 0 && atRightBoundary)) {
        targetSpeed = 0;
        currentScrollSpeed = 0;
      } else {
        currentScrollSpeed += (targetSpeed - currentScrollSpeed) * 0.3;
      }

      if (Math.abs(currentScrollSpeed) > 0.5 || Math.abs(targetSpeed) > 0) {
        // Apply scroll with conservative boundary limits
        const newScrollLeft = container.scrollLeft + currentScrollSpeed;
        container.scrollLeft = Math.max(0, Math.min(conservativeMaxScroll, newScrollLeft));

        updateDraggedItemPosition();
        // Recalculate target as we scroll
        const newTarget = calculateTargetIndex();
        updateItemShifts(newTarget);
        autoScrollRAF = requestAnimationFrame(updateAutoScroll);
      } else {
        currentScrollSpeed = 0;
        autoScrollRAF = null;
      }
    };

    const startAutoScroll = (touchX) => {
      lastTouchX = touchX;
      if (!autoScrollRAF) {
        autoScrollRAF = requestAnimationFrame(updateAutoScroll);
      }
    };

    const stopAutoScroll = () => {
      if (autoScrollRAF) {
        cancelAnimationFrame(autoScrollRAF);
        autoScrollRAF = null;
      }
      currentScrollSpeed = 0;
    };

    // Reset all item transforms
    const resetAllTransforms = () => {
      getItems().forEach(item => {
        item.style.transition = '';
        item.style.transform = '';
      });
    };

    getItems().forEach((item) => {
      item.addEventListener('touchstart', (e) => {
        draggedItem = item;
        draggedItem.classList.add('dragging');
        dragStartX = e.touches[0].clientX;
        lastTouchX = dragStartX;
        dragStartScrollLeft = container.scrollLeft;
        // Calculate current position dynamically (not captured at binding time)
        // This ensures correct index even after previous drags reordered the DOM
        originalIndex = getItems().indexOf(item);
        currentTargetIndex = originalIndex;

        // Disable scroll-snap during drag to allow smooth auto-scroll
        container.style.scrollSnapType = 'none';

        // Store original positions of all items
        itemPositions = getItems().map(it => {
          const rect = it.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            centerX: rect.left + rect.width / 2
          };
        });

        if (navigator.vibrate) navigator.vibrate(20);
      }, { passive: true });

      item.addEventListener('touchmove', (e) => {
        if (!draggedItem) return;
        e.preventDefault();

        const currentX = e.touches[0].clientX;
        lastTouchX = currentX;

        // Update dragged item position
        updateDraggedItemPosition();
        draggedItem.style.zIndex = '10';

        // Calculate and update target position
        const newTarget = calculateTargetIndex();
        updateItemShifts(newTarget);

        // Auto-scroll when near screen edges
        const edgeThreshold = 80;
        const screenWidth = window.innerWidth;

        if (currentX < edgeThreshold || currentX > screenWidth - edgeThreshold) {
          startAutoScroll(currentX);
        } else {
          stopAutoScroll();
        }
      });

      item.addEventListener('touchend', () => {
        stopAutoScroll();
        if (!draggedItem) return;

        const finalTargetIndex = currentTargetIndex;
        const items = getItems();

        // Reset all transforms with animation
        items.forEach(it => {
          if (it !== draggedItem) {
            it.style.transition = 'transform 0.2s ease-out';
            it.style.transform = '';
          }
        });

        // Animate dragged item back
        draggedItem.style.transition = 'transform 0.2s ease-out';
        draggedItem.style.transform = '';
        draggedItem.style.zIndex = '';
        draggedItem.classList.remove('dragging');

        // Clear transitions after animation
        setTimeout(() => {
          resetAllTransforms();
        }, 200);

        // Perform actual DOM reorder if position changed
        if (finalTargetIndex !== originalIndex) {
          // Reorder the DOM
          const allItems = getItems();
          if (finalTargetIndex > originalIndex) {
            // Moving right: insert after target
            const targetItem = allItems[finalTargetIndex];
            container.insertBefore(draggedItem, targetItem.nextSibling);
          } else {
            // Moving left: insert before target
            const targetItem = allItems[finalTargetIndex];
            container.insertBefore(draggedItem, targetItem);
          }

          // Update data-order-index attributes
          getItems().forEach((it, i) => {
            it.dataset.orderIndex = i;
          });

          // Update order in storage
          const order = self.getPageOrder();
          const [movedPage] = order.splice(originalIndex, 1);
          order.splice(finalTargetIndex, 0, movedPage);
          self.setPageOrder(order);

          self.showToast(self.t('swipe.orderChanged', 'Page order changed'));
          if (navigator.vibrate) navigator.vibrate(50);
        }

        // Restore scroll-snap after drag
        container.style.scrollSnapType = '';

        draggedItem = null;
        originalIndex = -1;
        currentTargetIndex = -1;
        itemPositions = [];
      });

      item.addEventListener('touchcancel', () => {
        stopAutoScroll();
        if (draggedItem) {
          draggedItem.style.transform = '';
          draggedItem.style.zIndex = '';
          draggedItem.classList.remove('dragging');
        }
        resetAllTransforms();
        // Restore scroll-snap after drag
        container.style.scrollSnapType = '';
        draggedItem = null;
        originalIndex = -1;
        currentTargetIndex = -1;
        itemPositions = [];
      });
    });
  },

  /**
   * Apply page order (reorder DOM elements for 3 pages)
   */
  applyPageOrder() {
    const container = document.getElementById('swipe-container');
    if (!container) return;

    const order = this.getPageOrder();

    // Get all pages by their IDs
    const pages = order.map(pageIdx => document.getElementById(SWIPE_PAGE_IDS[pageIdx])).filter(p => p);

    // Append pages in order (this reorders them)
    pages.forEach(page => container.appendChild(page));

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

    // Restore last visited page from localStorage, default to middle page (2)
    const savedPage = localStorage.getItem('currentPageIndex');
    const initialPage = savedPage !== null ? parseInt(savedPage) : 2;
    // Clamp to valid range (0-4)
    this._currentPage = Math.max(0, Math.min(4, initialPage));

    // Scroll to saved page without animation on initial load
    // 使用 requestAnimationFrame 确保布局完成后再滚动
    // 注意：必须使用 scrollTo() 而不是 scrollLeft 赋值，后者在某些情况下不生效
    requestAnimationFrame(() => {
      const pageWidth = container.offsetWidth;
      container.scrollTo({ left: pageWidth * this._currentPage, behavior: 'instant' });
    });
    this.updatePageIndicator();

    // Trigger lazy loading for the initial page
    const order = this.getPageOrder();
    const initialPageId = SWIPE_PAGE_IDS[order[this._currentPage]];
    if (initialPageId === 'page-all-sessions' && !this._sessionsLoaded) {
      this.loadPinnedSessions();
    }
    if (initialPageId === 'page-files' && this.loadFilesPage) {
      this.loadFilesPage();
    }
    if (initialPageId === 'page-monitor' && window.AppMonitor) {
      window.AppMonitor.loadMonitorPage();
    }
    if (initialPageId === 'page-remote' && window.RemoteMachines) {
      window.RemoteMachines.loadMachines();
    }
    if (initialPageId === 'page-scheduled-tasks' && window.AppScheduledTasks) {
      window.AppScheduledTasks.loadScheduledTasksPage();
    }

    // Listen for scroll to update indicator
    container.addEventListener('scroll', () => {
      const pageWidth = container.offsetWidth;
      const scrollLeft = container.scrollLeft;
      const newPage = Math.round(scrollLeft / pageWidth);

      if (newPage !== this._currentPage) {
        this._currentPage = newPage;
        this.updatePageIndicator();
        this._onPageChange(newPage);
      }
    });

    // Click on indicator dots
    indicator.querySelectorAll('.page-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        const page = parseInt(dot.dataset.page);
        this.goToPage(page);
      });
    });

    // Two-finger pinch gesture to trigger preview mode
    let pinchStartDistance = null;

    container.addEventListener('touchstart', (e) => {
      if (this._previewMode) return;

      // Detect two-finger touch
      if (e.touches.length === 2) {
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        pinchStartDistance = Math.hypot(
          touch2.clientX - touch1.clientX,
          touch2.clientY - touch1.clientY
        );
      }
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
      if (this._previewMode || pinchStartDistance === null) return;
      if (e.touches.length !== 2) {
        pinchStartDistance = null;
        return;
      }

      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const currentDistance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );

      // Pinch in detected (distance reduced by 50px+)
      if (pinchStartDistance - currentDistance > 50) {
        pinchStartDistance = null;
        this.enterPreviewMode();
        if (navigator.vibrate) navigator.vibrate(30);
      }
    }, { passive: true });

    container.addEventListener('touchend', () => {
      pinchStartDistance = null;
    });

    container.addEventListener('touchcancel', () => {
      pinchStartDistance = null;
    });
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

    // Directly trigger page change logic (scroll event may not fire reliably)
    if (pageIndex !== this._currentPage) {
      this._currentPage = pageIndex;
      this.updatePageIndicator();
      this._onPageChange(pageIndex);
    }
  },

  /**
   * Handle page change - load data for the new page
   */
  _onPageChange(pageIndex) {
    // Save current page index to localStorage
    localStorage.setItem('currentPageIndex', pageIndex.toString());

    const order = this.getPageOrder();
    const currentPageId = SWIPE_PAGE_IDS[order[pageIndex]];

    // Lazy load sessions page
    if (currentPageId === 'page-all-sessions' && !this._sessionsLoaded) {
      this.loadPinnedSessions();
    }

    // Lazy load files page
    if (currentPageId === 'page-files' && this.loadFilesPage) {
      this.loadFilesPage();
    }

    // Lazy load remote machines page
    if (currentPageId === 'page-remote' && window.RemoteMachines) {
      window.RemoteMachines.loadMachines();
    }

    // Lazy load scheduled tasks page
    if (currentPageId === 'page-scheduled-tasks' && window.AppScheduledTasks) {
      window.AppScheduledTasks.loadScheduledTasksPage();
    }

    // Monitor page: start/stop polling
    if (currentPageId === 'page-monitor') {
      if (window.AppMonitor && window.AppMonitor.startMonitorPolling) {
        window.AppMonitor.startMonitorPolling();
      }
    } else {
      if (window.AppMonitor && window.AppMonitor.stopMonitorPolling) {
        window.AppMonitor.stopMonitorPolling();
      }
    }
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
      const sessionType = session.type || 'claude';
      const isSSH = sessionType === 'ssh';

      const isBackendActive = activeSessionIds.includes(session.session_id);
      const isFrontendConnected = frontendConnectedIds.has(session.session_id);
      const timeStr = this.formatRelativeTime(session.updated_at || session.created_at);

      // Status class: frontend-connected (blue) > backend-active (green)
      let statusClass = '';
      if (isFrontendConnected) {
        statusClass = 'is-frontend-connected';
      } else if (isBackendActive) {
        statusClass = 'is-backend-active';
      }

      if (isSSH) {
        // SSH session card
        const machineId = session.machine_id;
        const displayName = session.display_name || 'SSH';
        const hostInfo = session.machine_deleted
          ? this.t('ssh.deleted', 'Machine deleted')
          : `${session.machine_username || ''}@${session.machine_host || ''}`;

        html += `
          <div class="session-grid-item session-grid-ssh ${statusClass}"
               data-session-id="${session.session_id}"
               data-session-type="ssh"
               data-machine-id="${machineId}"
               data-machine-name="${this.escapeHtml(displayName)}"
               draggable="true">
            <button class="btn-unpin" title="${this.t('sessions.unpin', 'Unpin')}">✕</button>
            <div class="session-grid-name"><span class="ssh-icon">⌨</span> ${this.escapeHtml(displayName)}</div>
            <div class="session-grid-project"><span class="project-name ssh-host">${this.escapeHtml(hostInfo)}</span></div>
            <div class="session-grid-meta"><span class="session-grid-time">${timeStr}</span></div>
          </div>
        `;
      } else {
        // Claude session card
        const projectName = this.getProjectDisplayName(session.working_dir);

        // Context info (if available)
        let contextHtml = '';
        if (session.context_used > 0) {
          const usedK = Math.round(session.context_used / 1000);
          const maxK = Math.round((session.context_max || 200000) / 1000);
          const pct = session.context_percentage || 0;
          contextHtml = `<span class="session-grid-context">⛁ ${usedK}k/${maxK}k ${pct}%</span>`;
        }

        // Token count (if available)
        let tokenHtml = '';
        if (session.total_tokens > 0) {
          const tokens = session.total_tokens;
          let tokenStr;
          if (tokens >= 1000000) {
            tokenStr = (tokens / 1000000).toFixed(1) + 'M';
          } else if (tokens >= 1000) {
            tokenStr = (tokens / 1000).toFixed(1) + 'k';
          } else {
            tokenStr = tokens.toString();
          }
          tokenHtml = `<span class="session-grid-tokens">${tokenStr}</span>`;
        }

        html += `
          <div class="session-grid-item ${statusClass}"
               data-session-id="${session.session_id}"
               data-session-type="claude"
               data-working-dir="${session.working_dir}"
               draggable="true">
            <button class="btn-unpin" title="${this.t('sessions.unpin', 'Unpin')}">✕</button>
            <div class="session-grid-name">${this.escapeHtml(session.display_name || session.session_id.substring(0, 8))}</div>
            <div class="session-grid-project">${this.escapeHtml(projectName)}</div>
            <div class="session-grid-meta">${tokenHtml}${contextHtml}<span class="session-grid-time">${timeStr}</span></div>
          </div>
        `;
      }
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

        const sessionType = item.dataset.sessionType || 'claude';

        if (sessionType === 'ssh') {
          // Open SSH terminal
          const machineId = parseInt(item.dataset.machineId, 10);
          const machineName = item.dataset.machineName || 'SSH';
          if (window.SSHTerminal && machineId) {
            window.SSHTerminal.connect({
              id: machineId,
              name: machineName
            });
          } else {
            console.error('SSHTerminal not available or invalid machine_id');
          }
        } else {
          // Open Claude terminal
          const sessionId = item.dataset.sessionId;
          const workingDir = item.dataset.workingDir;
          const displayName = item.querySelector('.session-grid-name')?.textContent || sessionId;
          this.connectTerminal(workingDir, sessionId, displayName);
        }
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

    // Click anywhere on the sessions page to exit edit mode
    const sessionsPage = document.getElementById('page-all-sessions');
    if (sessionsPage && !sessionsPage._editModeClickHandler) {
      sessionsPage._editModeClickHandler = (e) => {
        if (this._editMode) {
          // Don't exit if clicking unpin button
          if (e.target.classList.contains('btn-unpin')) return;
          this.exitEditMode();
        }
      };
      sessionsPage.addEventListener('click', sessionsPage._editModeClickHandler);
    }
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
      const order = this.getPageOrder();
      const sessionsPageIndex = order.indexOf(1); // 1 = sessions page
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
    const order = this.getPageOrder();
    const sessionsPageIndex = order.indexOf(1); // 1 = sessions page
    if (this._currentPage === sessionsPageIndex) {
      this.loadPinnedSessions();
    }
  },

  /**
   * Get the current page index of Files page
   */
  getFilesPageIndex() {
    const order = this.getPageOrder();
    return order.indexOf(2); // 2 = files page
  }
};

// Export for mixin
if (typeof window !== 'undefined') {
  window.AppSwipe = AppSwipe;
}
