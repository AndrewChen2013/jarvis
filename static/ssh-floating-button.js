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
 * SSH Floating Button - SSH 悬浮球
 * 完全独立于 Claude 悬浮球
 * 用于 SSH 多终端快速切换
 * 支持扇形展开菜单
 */

class SSHFloatingButton {
  constructor(manager) {
    this.manager = manager; // SSHSessionManager
    this.element = null;
    this.menu = null;
    this.isDragging = false;
    this.isLongPress = false;
    this.isMenuActive = false;
    this.longPressTimer = null;
    this.startX = 0;
    this.startY = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.offsetX = 0;
    this.offsetY = 0;

    // 扇形菜单相关
    this.menuItems = [];
    this.selectedItem = null;
    this.menuCenterX = 0;
    this.menuCenterY = 0;

    this.LONG_PRESS_DURATION = 500;
    this.DRAG_THRESHOLD = 10;
    this.RADIAL_RADIUS = 80;
    this.ITEM_SIZE = 44;
    this.SELECT_THRESHOLD = 30;

    this.init();
  }

  log(msg) {
    console.log('[SSHFloatBtn] ' + msg);
  }

  init() {
    this.createElement();
    this.createRadialMenu();
    this.bindEvents();
    this.loadPosition();
    this.hide();
  }

  /**
   * 创建悬浮按钮元素
   */
  createElement() {
    this.element = document.createElement('div');
    this.element.id = 'ssh-floating-btn';
    this.element.className = 'ssh-floating-btn';
    this.element.innerHTML = '<span class="ssh-floating-btn-count">0</span>';

    document.body.appendChild(this.element);
  }

  /**
   * 创建扇形菜单容器
   */
  createRadialMenu() {
    this.menu = document.createElement('div');
    this.menu.id = 'ssh-radial-menu';
    this.menu.className = 'ssh-radial-menu';

    const overlay = document.createElement('div');
    overlay.className = 'ssh-radial-menu-overlay';
    overlay.addEventListener('click', () => this.hideRadialMenu());
    this.menu.appendChild(overlay);

    document.body.appendChild(this.menu);
  }

  /**
   * 绑定事件
   */
  bindEvents() {
    // Touch 事件
    this.element.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    document.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    document.addEventListener('touchend', (e) => this.onTouchEnd(e));
    document.addEventListener('touchcancel', (e) => this.onTouchEnd(e));

    // Mouse 事件
    this.element.addEventListener('mousedown', (e) => this.onMouseDown(e));
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    document.addEventListener('mouseup', (e) => this.onMouseUp(e));
  }

  // ==================== Touch 事件 ====================

  onTouchStart(e) {
    if (e.touches.length !== 1) return;
    e.preventDefault();

    const touch = e.touches[0];
    this.startX = touch.clientX;
    this.startY = touch.clientY;
    this.isDragging = false;
    this.isLongPress = false;
    this.touchActive = true;

    const rect = this.element.getBoundingClientRect();
    this.offsetX = touch.clientX - rect.left - rect.width / 2;
    this.offsetY = touch.clientY - rect.top - rect.height / 2;

    this.longPressTimer = setTimeout(() => {
      if (!this.isDragging && this.touchActive) {
        this.isLongPress = true;
        this.isMenuActive = true;
        this.showRadialMenu();
        this.vibrate();
      }
    }, this.LONG_PRESS_DURATION);

    this.element.classList.add('pressed');
  }

  onTouchMove(e) {
    if (!this.touchActive) return;
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];

    if (this.isMenuActive) {
      e.preventDefault();
      this.updateMenuSelection(touch.clientX, touch.clientY);
      return;
    }

    const deltaX = Math.abs(touch.clientX - this.startX);
    const deltaY = Math.abs(touch.clientY - this.startY);

    if (deltaX > this.DRAG_THRESHOLD || deltaY > this.DRAG_THRESHOLD) {
      this.isDragging = true;
      clearTimeout(this.longPressTimer);
    }

    if (this.isDragging) {
      e.preventDefault();
      this.currentX = touch.clientX - this.offsetX;
      this.currentY = touch.clientY - this.offsetY;
      this.updatePosition();
    }
  }

  onTouchEnd(e) {
    if (!this.touchActive) return;

    clearTimeout(this.longPressTimer);
    this.element.classList.remove('pressed');
    this.touchActive = false;

    if (this.isMenuActive) {
      if (this.selectedItem) {
        const session = this.selectedItem.session;
        this.vibrate();
        this.manager.switchTo(session.id);
      }
      this.hideRadialMenu();
      this.clearMenuSelection();
      this.isMenuActive = false;
      this.isLongPress = false;
      return;
    }

    if (this.isDragging) {
      this.snapToEdge();
      this.savePosition();
    } else if (!this.isLongPress) {
      this.onSingleClick();
    }

    this.isDragging = false;
    this.isLongPress = false;
  }

  // ==================== Mouse 事件 ====================

  onMouseDown(e) {
    e.preventDefault();
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.isDragging = false;
    this.isLongPress = false;
    this.mouseDown = true;

    const rect = this.element.getBoundingClientRect();
    this.offsetX = e.clientX - rect.left - rect.width / 2;
    this.offsetY = e.clientY - rect.top - rect.height / 2;

    this.longPressTimer = setTimeout(() => {
      if (!this.isDragging && this.mouseDown) {
        this.isLongPress = true;
        this.isMenuActive = true;
        this.showRadialMenu();
      }
    }, this.LONG_PRESS_DURATION);

    this.element.classList.add('pressed');
  }

  onMouseMove(e) {
    if (!this.mouseDown) return;

    if (this.isMenuActive) {
      this.updateMenuSelection(e.clientX, e.clientY);
      return;
    }

    const deltaX = Math.abs(e.clientX - this.startX);
    const deltaY = Math.abs(e.clientY - this.startY);

    if (deltaX > this.DRAG_THRESHOLD || deltaY > this.DRAG_THRESHOLD) {
      this.isDragging = true;
      clearTimeout(this.longPressTimer);
    }

    if (this.isDragging) {
      this.currentX = e.clientX - this.offsetX;
      this.currentY = e.clientY - this.offsetY;
      this.updatePosition();
    }
  }

  onMouseUp(e) {
    if (!this.mouseDown) return;
    this.mouseDown = false;

    clearTimeout(this.longPressTimer);
    this.element.classList.remove('pressed');

    if (this.isMenuActive) {
      if (this.selectedItem) {
        const session = this.selectedItem.session;
        this.manager.switchTo(session.id);
      }
      this.hideRadialMenu();
      this.clearMenuSelection();
      this.isMenuActive = false;
      this.isLongPress = false;
      return;
    }

    if (this.isDragging) {
      this.snapToEdge();
      this.savePosition();
    } else if (!this.isLongPress) {
      this.onSingleClick();
    }

    this.isDragging = false;
    this.isLongPress = false;
  }

  // ==================== 交互逻辑 ====================

  /**
   * 单击处理：快速切换到上一个 session
   */
  onSingleClick() {
    this.log('onSingleClick');

    const previousId = this.manager.previousId;
    const activeId = this.manager.activeId;
    const sessionsSize = this.manager.sessions.size;

    // 如果有上一个 session，切换到它
    if (previousId && previousId !== activeId && this.manager.sessions.has(previousId)) {
      this.vibrate();
      this.manager.switchTo(previousId);
      return;
    }

    // 否则切换到最近活跃的后台 session
    const backgrounds = this.manager.getBackgroundSessions();
    if (backgrounds.length > 0) {
      this.vibrate();
      this.manager.switchTo(backgrounds[0].id);
      return;
    }

    // 如果只有一个 session，切换到它
    if (sessionsSize === 1) {
      const session = this.manager.getAllSessions()[0];
      this.vibrate();
      this.manager.switchTo(session.id);
      return;
    }

    // 没有可切换的 session
    if (sessionsSize > 1) {
      this.showRadialMenu();
    }
  }

  vibrate() {
    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
  }

  // ==================== 菜单选择 ====================

  updateMenuSelection(touchX, touchY) {
    let closestItem = null;
    let closestDistance = Infinity;

    const distFromCenter = Math.sqrt(
      Math.pow(touchX - this.menuCenterX, 2) +
      Math.pow(touchY - this.menuCenterY, 2)
    );

    if (distFromCenter < 40) {
      this.clearMenuSelection();
      return;
    }

    for (const item of this.menuItems) {
      const distance = Math.sqrt(
        Math.pow(touchX - item.x, 2) +
        Math.pow(touchY - item.y, 2)
      );

      if (distance < closestDistance && distance < this.SELECT_THRESHOLD + 20) {
        closestDistance = distance;
        closestItem = item;
      }
    }

    if (closestItem !== this.selectedItem) {
      this.clearMenuSelection();
      if (closestItem) {
        closestItem.element.classList.add('hover');
        this.selectedItem = closestItem;
        if (navigator.vibrate) {
          navigator.vibrate(10);
        }
      }
    }
  }

  clearMenuSelection() {
    if (this.selectedItem) {
      this.selectedItem.element.classList.remove('hover');
      this.selectedItem = null;
    }
  }

  // ==================== 位置控制 ====================

  updatePosition() {
    const btnSize = 44;
    const maxX = window.innerWidth - btnSize / 2;
    const maxY = window.innerHeight - btnSize / 2;
    const minX = btnSize / 2;
    const minY = btnSize / 2;

    this.currentX = Math.max(minX, Math.min(maxX, this.currentX));
    this.currentY = Math.max(minY, Math.min(maxY, this.currentY));

    this.element.style.left = `${this.currentX}px`;
    this.element.style.top = `${this.currentY}px`;
    this.element.style.right = 'auto';
    this.element.style.bottom = 'auto';
  }

  snapToEdge() {
    const screenWidth = window.innerWidth;
    const btnSize = 44;
    const margin = 15; // 和 Claude 悬浮球对齐

    // 吸附到边缘
    if (this.currentX < screenWidth / 2) {
      this.currentX = margin + btnSize / 2;
    } else {
      this.currentX = screenWidth - margin - btnSize / 2;
    }

    // 先添加 snapping 类，让位置变化有过渡动画
    this.element.classList.add('snapping');

    // 使用 requestAnimationFrame 确保类已应用
    requestAnimationFrame(() => {
      this.updatePosition();
    });

    setTimeout(() => {
      this.element.classList.remove('snapping');
    }, 350);
  }

  savePosition() {
    localStorage.setItem('ssh-floating-btn-pos', JSON.stringify({
      x: this.currentX,
      y: this.currentY
    }));
  }

  loadPosition() {
    const saved = localStorage.getItem('ssh-floating-btn-pos');
    if (saved) {
      try {
        const pos = JSON.parse(saved);
        this.currentX = pos.x;
        this.currentY = pos.y;
        this.updatePosition();
      } catch (e) {
        this.setDefaultPosition();
      }
    } else {
      this.setDefaultPosition();
    }
  }

  /**
   * 设置默认位置（左下角，和 Claude 悬浮球对齐）
   */
  setDefaultPosition() {
    const btnSize = 44;
    const margin = 15;
    this.currentX = margin + btnSize / 2;
    this.currentY = window.innerHeight - 180;
    this.updatePosition();
  }

  // ==================== 扇形菜单 ====================

  calculateExpandDirection() {
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    const btnX = this.currentX;
    const btnY = this.currentY;
    const edgeThreshold = 100;

    const isLeft = btnX < edgeThreshold;
    const isRight = btnX > screenWidth - edgeThreshold;
    const isTop = btnY < edgeThreshold;
    const isBottom = btnY > screenHeight - edgeThreshold;

    let startAngle, endAngle;

    if (isLeft && isTop) {
      startAngle = 0; endAngle = 90;
    } else if (isRight && isTop) {
      startAngle = 90; endAngle = 180;
    } else if (isRight && isBottom) {
      startAngle = 180; endAngle = 270;
    } else if (isLeft && isBottom) {
      startAngle = 270; endAngle = 360;
    } else if (isLeft) {
      startAngle = -60; endAngle = 60;
    } else if (isRight) {
      startAngle = 120; endAngle = 240;
    } else if (isTop) {
      startAngle = 30; endAngle = 150;
    } else if (isBottom) {
      startAngle = 210; endAngle = 330;
    } else {
      if (btnX < screenWidth / 2) {
        startAngle = -90; endAngle = 90;
      } else {
        startAngle = 90; endAngle = 270;
      }
    }

    return { startAngle, endAngle };
  }

  getSessionInitials(name) {
    if (!name) return '?';
    name = name.replace(/^\[SSH\]\s*/i, '');
    if (/^\d+$/.test(name)) return name.substring(0, 2);
    if (/[\u4e00-\u9fa5]/.test(name)) return name.substring(0, 2);
    const words = name.split(/[\s_-]+/);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  showRadialMenu() {
    this.log('showRadialMenu');

    const sessions = this.manager.getAllSessions();
    if (sessions.length === 0) {
      this.hideRadialMenu();
      return;
    }

    const activeId = this.manager.activeId;

    // 清除旧菜单项
    const overlay = this.menu.querySelector('.ssh-radial-menu-overlay');
    this.menu.innerHTML = '';
    this.menu.appendChild(overlay);

    this.menuItems = [];
    this.selectedItem = null;

    const { startAngle, endAngle } = this.calculateExpandDirection();
    const angleRange = endAngle - startAngle;
    const itemCount = sessions.length;
    const angleStep = itemCount > 1 ? angleRange / (itemCount - 1) : 0;

    this.menuCenterX = this.currentX;
    this.menuCenterY = this.currentY;

    sessions.forEach((session, index) => {
      const item = document.createElement('div');
      item.className = 'ssh-radial-menu-item';

      if (session.id === activeId) {
        item.classList.add('current');
      }
      if (session.status === 'connected') {
        item.classList.add('connected');
      }

      const angle = itemCount > 1
        ? startAngle + angleStep * index
        : (startAngle + endAngle) / 2;
      const angleRad = (angle * Math.PI) / 180;
      const x = this.menuCenterX + Math.cos(angleRad) * this.RADIAL_RADIUS;
      const y = this.menuCenterY + Math.sin(angleRad) * this.RADIAL_RADIUS;

      item.style.left = `${x}px`;
      item.style.top = `${y}px`;

      this.menuItems.push({ x, y, session, element: item });

      const text = document.createElement('span');
      text.className = 'ssh-radial-menu-item-text';
      text.textContent = this.getSessionInitials(session.name);
      item.appendChild(text);

      const tooltip = document.createElement('div');
      tooltip.className = 'ssh-radial-menu-item-tooltip';
      tooltip.textContent = session.name;
      item.appendChild(tooltip);

      this.menu.appendChild(item);
    });

    this.menu.classList.add('active');
  }

  hideRadialMenu() {
    this.menu.classList.remove('active');
  }

  // ==================== 状态更新 ====================

  update() {
    const count = this.manager.getBackgroundCount();
    const activeId = this.manager.activeId;
    const sessionsSize = this.manager.sessions.size;
    const countEl = this.element.querySelector('.ssh-floating-btn-count');

    // 检查是否在 SSH 终端页面
    const isSSHViewActive = document.getElementById('ssh-terminal-view')?.classList.contains('active');

    if (sessionsSize > 0) {
      // 有 SSH session 时显示
      if (isSSHViewActive && count > 0) {
        // 在 SSH 页面，且有后台 session
        countEl.textContent = count;
        this.show();
      } else if (!isSSHViewActive && sessionsSize > 0) {
        // 不在 SSH 页面，但有 SSH session
        countEl.textContent = sessionsSize;
        this.show();
      } else if (isSSHViewActive && count === 0) {
        // 在 SSH 页面，但没有后台 session
        this.hide();
      } else {
        this.hide();
      }
    } else {
      this.hide();
    }
  }

  show() {
    this.element.classList.add('visible');
  }

  hide() {
    this.element.classList.remove('visible');
    this.hideRadialMenu();
  }

  destroy() {
    if (this.element) {
      this.element.remove();
    }
    if (this.menu) {
      this.menu.remove();
    }
  }
}

// 导出
window.SSHFloatingButton = SSHFloatingButton;
