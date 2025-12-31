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
 * Floating Button - 可拖拽悬浮按钮
 * 用于多 Session 快速切换
 * 支持扇形展开菜单
 */

class FloatingButton {
  constructor(app) {
    this.app = app;
    this.element = null;
    this.menu = null;
    this.isDragging = false;
    this.isLongPress = false;
    this.isMenuActive = false;  // 菜单是否激活
    this.longPressTimer = null;
    this.startX = 0;
    this.startY = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.offsetX = 0;
    this.offsetY = 0;

    // 扇形菜单相关
    this.menuItems = [];        // 菜单项位置信息 [{x, y, session, element}]
    this.selectedItem = null;   // 当前选中的菜单项
    this.menuCenterX = 0;       // 菜单中心 X
    this.menuCenterY = 0;       // 菜单中心 Y

    this.LONG_PRESS_DURATION = 500; // 长按阈值
    this.DRAG_THRESHOLD = 10; // 拖拽阈值
    this.RADIAL_RADIUS = 80; // 扇形展开半径
    this.ITEM_SIZE = 44; // 菜单项大小
    this.SELECT_THRESHOLD = 30; // 选中判定半径

    this.init();
  }

  /**
   * 调试日志
   */
  log(msg) {
    if (this.app && this.app.debugLog) {
      this.app.debugLog('[FloatBtn] ' + msg);
    } else {
      console.log('[FloatBtn] ' + msg);
    }
  }

  init() {
    this.createElement();
    this.createRadialMenu();
    this.bindEvents();
    this.loadPosition();
    this.update();
  }

  /**
   * 创建悬浮按钮元素
   */
  createElement() {
    this.element = document.createElement('div');
    this.element.id = 'floating-btn';
    this.element.className = 'floating-btn';
    this.element.innerHTML = '<span class="floating-btn-count">0</span>';

    document.body.appendChild(this.element);
  }

  /**
   * 创建扇形菜单容器
   */
  createRadialMenu() {
    this.menu = document.createElement('div');
    this.menu.id = 'radial-menu';
    this.menu.className = 'radial-menu';

    // 添加遮罩层
    const overlay = document.createElement('div');
    overlay.className = 'radial-menu-overlay';
    overlay.addEventListener('click', () => this.hideRadialMenu());
    this.menu.appendChild(overlay);

    document.body.appendChild(this.menu);
  }

  /**
   * 绑定事件
   */
  bindEvents() {
    // Touch 事件 - 在按钮上开始，在 document 上追踪
    this.element.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    document.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    document.addEventListener('touchend', (e) => this.onTouchEnd(e));
    document.addEventListener('touchcancel', (e) => this.onTouchEnd(e));

    // Mouse 事件（桌面端）
    this.element.addEventListener('mousedown', (e) => this.onMouseDown(e));
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    document.addEventListener('mouseup', (e) => this.onMouseUp(e));
  }

  // ==================== Touch 事件 ====================

  onTouchStart(e) {
    this.log('onTouchStart');
    if (e.touches.length !== 1) return;
    e.preventDefault();

    const touch = e.touches[0];
    this.startX = touch.clientX;
    this.startY = touch.clientY;
    this.isDragging = false;
    this.isLongPress = false;
    this.touchActive = true;  // 标记触摸激活

    const rect = this.element.getBoundingClientRect();
    this.offsetX = touch.clientX - rect.left - rect.width / 2;
    this.offsetY = touch.clientY - rect.top - rect.height / 2;

    // 启动长按计时器
    this.longPressTimer = setTimeout(() => {
      this.log('longPress timer fired, isDragging=' + this.isDragging);
      if (!this.isDragging && this.touchActive) {
        this.isLongPress = true;
        this.isMenuActive = true;
        this.log('triggering showRadialMenu');
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

    // 如果菜单已激活，追踪手指位置选择菜单项
    if (this.isMenuActive) {
      e.preventDefault();
      this.updateMenuSelection(touch.clientX, touch.clientY);
      return;
    }

    const deltaX = Math.abs(touch.clientX - this.startX);
    const deltaY = Math.abs(touch.clientY - this.startY);

    // 超过阈值，判定为拖拽（菜单未激活时）
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

  /**
   * 更新菜单选中状态
   */
  updateMenuSelection(touchX, touchY) {
    let closestItem = null;
    let closestDistance = Infinity;

    // 计算手指与中心的距离
    const distFromCenter = Math.sqrt(
      Math.pow(touchX - this.menuCenterX, 2) +
      Math.pow(touchY - this.menuCenterY, 2)
    );

    // 如果手指太靠近中心，不选中任何菜单项
    if (distFromCenter < 40) {
      this.clearMenuSelection();
      return;
    }

    // 找到最近的菜单项
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

    // 更新选中状态
    if (closestItem !== this.selectedItem) {
      this.clearMenuSelection();
      if (closestItem) {
        closestItem.element.classList.add('hover');
        this.selectedItem = closestItem;
        // 轻微震动反馈
        if (navigator.vibrate) {
          navigator.vibrate(10);
        }
      }
    }
  }

  /**
   * 清除菜单选中状态
   */
  clearMenuSelection() {
    if (this.selectedItem) {
      this.selectedItem.element.classList.remove('hover');
      this.selectedItem = null;
    }
  }

  onTouchEnd(e) {
    if (!this.touchActive) return;

    clearTimeout(this.longPressTimer);
    this.element.classList.remove('pressed');
    this.touchActive = false;

    // 如果菜单激活，处理选择
    if (this.isMenuActive) {
      if (this.selectedItem) {
        // 有选中项，执行切换
        const session = this.selectedItem.session;
        this.log(`selected session: ${session.name}`);
        this.vibrate();
        this.app.connectSession(session.id, session.name);
      }
      // 无论是否选中，都关闭菜单
      this.hideRadialMenu();
      this.clearMenuSelection();
      this.isMenuActive = false;
      this.isLongPress = false;
      return;
    }

    if (this.isDragging) {
      // 拖拽结束，吸附到边缘
      this.snapToEdge();
      this.savePosition();
    } else if (!this.isLongPress) {
      // 单击：快速切换
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

    // 如果菜单已激活，追踪鼠标位置选择菜单项
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

    // 如果菜单激活，处理选择
    if (this.isMenuActive) {
      if (this.selectedItem) {
        const session = this.selectedItem.session;
        this.log(`mouse selected session: ${session.name}`);
        this.app.connectSession(session.id, session.name);
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
    if (!this.app.sessionManager) {
      this.log('onSingleClick: no sessionManager');
      return;
    }

    // 获取要切换到的 session
    let targetSession = null;

    const previousId = this.app.sessionManager.previousId;
    this.log(`onSingleClick: previousId=${previousId}`);
    if (previousId && this.app.sessionManager.sessions.has(previousId)) {
      targetSession = this.app.sessionManager.sessions.get(previousId);
      this.log(`onSingleClick: using previousId`);
    } else {
      // 没有上一个，切换到最近活跃的后台 session
      const backgrounds = this.app.sessionManager.getBackgroundSessions();
      this.log(`onSingleClick: background sessions=${backgrounds.length}`);
      if (backgrounds.length > 0) {
        targetSession = backgrounds[0];
      }
    }

    if (targetSession) {
      this.log(`onSingleClick: switch to ${targetSession.id}`);
      // 使用 connectSession 确保 app 状态正确更新
      this.app.connectSession(targetSession.id, targetSession.name);
    } else {
      this.log('onSingleClick: no target, show menu');
      // 没有可切换的 session，展开菜单
      this.showRadialMenu();
    }
  }

  /**
   * 震动反馈
   */
  vibrate() {
    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
  }

  // ==================== 位置控制 ====================

  /**
   * 更新按钮位置
   */
  updatePosition() {
    // 限制在屏幕范围内
    const btnSize = 50;
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

  /**
   * 吸附到屏幕边缘
   */
  snapToEdge() {
    const screenWidth = window.innerWidth;
    const btnSize = 50;
    const margin = 15;

    // 判断靠左还是靠右
    if (this.currentX < screenWidth / 2) {
      this.currentX = margin + btnSize / 2;
    } else {
      this.currentX = screenWidth - margin - btnSize / 2;
    }

    this.updatePosition();

    // 添加吸附动画
    this.element.classList.add('snapping');
    setTimeout(() => {
      this.element.classList.remove('snapping');
    }, 300);
  }

  /**
   * 保存位置到 localStorage
   */
  savePosition() {
    localStorage.setItem('floating-btn-pos', JSON.stringify({
      x: this.currentX,
      y: this.currentY
    }));
  }

  /**
   * 从 localStorage 加载位置
   */
  loadPosition() {
    const saved = localStorage.getItem('floating-btn-pos');
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
   * 设置默认位置（右下角）
   */
  setDefaultPosition() {
    this.currentX = window.innerWidth - 65;
    this.currentY = window.innerHeight - 180;
    this.updatePosition();
  }

  // ==================== 扇形菜单控制 ====================

  /**
   * 计算展开方向和角度范围
   * 根据按钮在屏幕中的位置，智能决定扇形展开方向
   */
  calculateExpandDirection() {
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    const btnX = this.currentX;
    const btnY = this.currentY;

    // 边缘阈值
    const edgeThreshold = 100;

    // 判断位置
    const isLeft = btnX < edgeThreshold;
    const isRight = btnX > screenWidth - edgeThreshold;
    const isTop = btnY < edgeThreshold;
    const isBottom = btnY > screenHeight - edgeThreshold;

    let startAngle, endAngle;

    if (isLeft && isTop) {
      // 左上角 → 向右下展开
      startAngle = 0;
      endAngle = 90;
    } else if (isRight && isTop) {
      // 右上角 → 向左下展开
      startAngle = 90;
      endAngle = 180;
    } else if (isRight && isBottom) {
      // 右下角 → 向左上展开
      startAngle = 180;
      endAngle = 270;
    } else if (isLeft && isBottom) {
      // 左下角 → 向右上展开
      startAngle = 270;
      endAngle = 360;
    } else if (isLeft) {
      // 左边缘 → 向右展开（半圆）
      startAngle = -60;
      endAngle = 60;
    } else if (isRight) {
      // 右边缘 → 向左展开（半圆）
      startAngle = 120;
      endAngle = 240;
    } else if (isTop) {
      // 上边缘 → 向下展开（半圆）
      startAngle = 30;
      endAngle = 150;
    } else if (isBottom) {
      // 下边缘 → 向上展开（半圆）
      startAngle = 210;
      endAngle = 330;
    } else {
      // 中间位置 → 完整半圆（向主要空间展开）
      if (btnX < screenWidth / 2) {
        startAngle = -90;
        endAngle = 90;
      } else {
        startAngle = 90;
        endAngle = 270;
      }
    }

    return { startAngle, endAngle };
  }

  /**
   * 获取 session 名称的缩写（用于显示在圆形按钮上）
   */
  getSessionInitials(name) {
    if (!name) return '?';

    // 移除常见前缀
    name = name.replace(/^(session|会话|セッション)\s*/i, '');

    // 如果是纯数字，直接返回
    if (/^\d+$/.test(name)) {
      return name.substring(0, 2);
    }

    // 如果是中文，取前两个字
    if (/[\u4e00-\u9fa5]/.test(name)) {
      return name.substring(0, 2);
    }

    // 如果是英文，取首字母
    const words = name.split(/[\s_-]+/);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }

    return name.substring(0, 2).toUpperCase();
  }

  /**
   * 计算 tooltip 位置
   */
  getTooltipPosition(angle) {
    // tooltip 显示在菜单项的外侧
    const normalizedAngle = ((angle % 360) + 360) % 360;

    if (normalizedAngle >= 315 || normalizedAngle < 45) {
      return { left: '60px', top: '50%', transform: 'translateY(-50%)' };
    } else if (normalizedAngle >= 45 && normalizedAngle < 135) {
      return { left: '50%', top: '60px', transform: 'translateX(-50%)' };
    } else if (normalizedAngle >= 135 && normalizedAngle < 225) {
      return { right: '60px', top: '50%', transform: 'translateY(-50%)', left: 'auto' };
    } else {
      return { left: '50%', bottom: '60px', transform: 'translateX(-50%)', top: 'auto' };
    }
  }

  /**
   * 显示扇形菜单
   */
  showRadialMenu() {
    this.log('showRadialMenu called');

    if (!this.app.sessionManager) {
      this.log('showRadialMenu: no sessionManager');
      return;
    }

    const sessions = this.app.sessionManager.getAllSessions();
    this.log(`showRadialMenu: ${sessions.length} sessions`);
    const activeId = this.app.sessionManager.activeId;

    // 清除旧的菜单项（保留遮罩）
    const overlay = this.menu.querySelector('.radial-menu-overlay');
    this.menu.innerHTML = '';
    this.menu.appendChild(overlay);

    // 重置菜单项列表
    this.menuItems = [];
    this.selectedItem = null;

    if (sessions.length === 0) {
      // 没有 session，显示提示
      this.log('showRadialMenu: no sessions, hiding');
      this.hideRadialMenu();
      return;
    }

    // 计算展开方向
    const { startAngle, endAngle } = this.calculateExpandDirection();
    const angleRange = endAngle - startAngle;
    const itemCount = sessions.length;

    // 计算每个项目的角度间隔
    const angleStep = itemCount > 1 ? angleRange / (itemCount - 1) : 0;

    // 按钮中心位置（保存供滑动选择使用）
    this.menuCenterX = this.currentX;
    this.menuCenterY = this.currentY;

    // 创建菜单项
    sessions.forEach((session, index) => {
      const item = document.createElement('div');
      item.className = 'radial-menu-item';

      // 添加状态类
      if (session.id === activeId) {
        item.classList.add('current');
      }
      if (session.status === 'connected') {
        item.classList.add('connected');
      }

      // 计算位置
      const angle = itemCount > 1
        ? startAngle + angleStep * index
        : (startAngle + endAngle) / 2;
      const angleRad = (angle * Math.PI) / 180;
      const x = this.menuCenterX + Math.cos(angleRad) * this.RADIAL_RADIUS;
      const y = this.menuCenterY + Math.sin(angleRad) * this.RADIAL_RADIUS;

      item.style.left = `${x}px`;
      item.style.top = `${y}px`;

      // 保存菜单项位置信息（用于滑动选择）
      this.menuItems.push({
        x: x,
        y: y,
        session: session,
        element: item
      });

      // 显示名称缩写
      const text = document.createElement('span');
      text.className = 'radial-menu-item-text';
      text.textContent = this.getSessionInitials(session.name);
      item.appendChild(text);

      // 添加 tooltip（滑动时显示完整名称）
      const tooltip = document.createElement('div');
      tooltip.className = 'radial-menu-item-tooltip';
      tooltip.textContent = session.name || 'Session';
      const tooltipPos = this.getTooltipPosition(angle);
      Object.assign(tooltip.style, tooltipPos);
      item.appendChild(tooltip);

      this.menu.appendChild(item);
    });

    // 不再需要关闭按钮，滑回中心松开即可取消

    // 显示菜单
    this.menu.classList.add('active');
    this.log('radial menu activated, items: ' + this.menuItems.length);
  }

  /**
   * 隐藏扇形菜单
   */
  hideRadialMenu() {
    this.menu.classList.remove('active');
  }

  // 兼容旧方法名
  showMenu() {
    this.showRadialMenu();
  }

  hideMenu() {
    this.hideRadialMenu();
  }

  // ==================== 状态更新 ====================

  /**
   * 更新按钮显示
   */
  update() {
    this.log('update');
    if (!this.app.sessionManager) {
      this.log('update: no sessionManager, hide');
      this.hide();
      return;
    }

    const count = this.app.sessionManager.getBackgroundCount();
    const activeId = this.app.sessionManager.activeId;
    this.log(`update: bgCount=${count}, activeId=${activeId}`);
    const countEl = this.element.querySelector('.floating-btn-count');

    if (count > 0) {
      countEl.textContent = count;
      this.log('update: show, count=' + count);
      this.show();
    } else if (activeId) {
      // 有活跃 session 但没有后台 session，显示 0
      countEl.textContent = '0';
      this.log('update: show, count=0');
      this.show();
    } else {
      this.log('update: hide');
      this.hide();
    }
  }

  /**
   * 显示按钮
   */
  show() {
    this.element.classList.add('visible');
  }

  /**
   * 隐藏按钮
   */
  hide() {
    this.element.classList.remove('visible');
    this.hideRadialMenu();
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
   * 销毁
   */
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
window.FloatingButton = FloatingButton;
