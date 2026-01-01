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
 * 移动端优化的 xterm.js 终端包装器
 * - 使用 xterm.js 处理所有 ANSI 控制序列
 * - 禁用内置键盘输入，使用悬浮按钮
 * - 移动端性能优化配置
 */
class Terminal {
  constructor(container, onReady) {
    this.container = container;
    this.xterm = null;
    this.fitAddon = null;
    this.fontSize = this.calcDefaultFontSize();  // 根据屏幕宽度自动计算
    this.isReady = false;
    this.onReady = onReady;
    this.pendingWrites = [];  // 等待写入的数据队列

    this.init();
  }

  /**
   * 获取默认字体大小
   * 优先从 localStorage 读取，没有则根据屏幕宽度计算
   */
  calcDefaultFontSize() {
    // 优先从 localStorage 读取
    const saved = localStorage.getItem('terminal-font-size');
    if (saved) {
      const size = parseInt(saved, 10);
      if (size >= 10 && size <= 24) {
        return size;
      }
    }

    // 根据屏幕宽度计算默认值
    const width = window.innerWidth;
    if (width < 430) {
      return 13;  // iPhone
    } else if (width < 820) {
      return 15;  // iPad mini / 大手机横屏
    } else {
      return 17;  // iPad / 桌面
    }
  }

  /**
   * 保存字体大小到 localStorage
   */
  saveFontSize(size) {
    localStorage.setItem('terminal-font-size', size.toString());
  }

  init() {
    this.log('Step 1: create xterm instance');

    // 创建 xterm.js 实例，移动端性能优化配置
    this.xterm = new window.Terminal({
      // 移动端适配
      fontSize: this.fontSize,
      fontFamily: 'monospace',  // 使用系统默认等宽字体，加载更快
      lineHeight: 1.2,

      // 主题
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#1e1e1e',          // 光标颜色与背景相同，完全隐藏
        cursorAccent: '#1e1e1e',
        selection: 'rgba(255, 255, 255, 0.3)',
      },

      // 性能优化
      scrollback: 500,        // 减少回滚行数
      cursorBlink: false,     // 禁用光标闪烁
      cursorStyle: 'bar',     // 使用最细的光标样式
      cursorWidth: 1,         // 最小宽度
      cursorInactiveStyle: 'none',  // 非活动时不显示光标
      disableStdin: true,     // 禁用内置输入（我们用自己的输入框）

      // 滚动优化
      smoothScrollDuration: 0,  // 禁用平滑滚动
      scrollOnUserInput: true,
      scrollSensitivity: 20,    // 增大滚动灵敏度（默认1）
      fastScrollSensitivity: 40, // 快速滚动灵敏度
    });
    this.log('Step 1 done');

    this.log('Step 2: create FitAddon');
    this.fitAddon = new window.FitAddon.FitAddon();
    this.xterm.loadAddon(this.fitAddon);
    this.log('Step 2 done');

    this.log('Step 3: open terminal');
    this.xterm.open(this.container);
    this.log('Step 3 done');

    // 尝试加载 WebGL 渲染器（GPU 加速）
    this.log('Step 3.5: try WebGL');
    if (window.WebglAddon) {
      try {
        const webglAddon = new window.WebglAddon.WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon.dispose();
          this.log('WebGL context lost, falling back to canvas');
        });
        this.xterm.loadAddon(webglAddon);
        this.log('WebGL enabled');
      } catch (e) {
        this.log('WebGL unavailable: ' + e.message);
      }
    } else {
      this.log('WebglAddon not loaded');
    }

    this.log('Step 4: wait for fit()');
    requestAnimationFrame(() => {
      this.log('Step 4a: RAF callback');
      this.fit();
      this.log('Step 4b: fit done');
      this.isReady = true;
      this.log('Step 4c: flush queue ' + this.pendingWrites.length);
      this.flushPendingWrites();
      this.log('Step 4d: queue done');

      // 设置触摸滚动（DOM 已渲染）
      this.log('Step 4e: setup touch scroll');
      this.setupTouchScroll();

      // 禁用 xterm.js 内部的隐藏 textarea，防止点击终端时弹出软键盘
      this.log('Step 4e2: disable xterm helper textarea');
      this.disableHelperTextarea();

      if (this.onReady) {
        this.log('Step 4f: onReady');
        this.onReady();
        this.log('Step 4g: onReady done');
      }
    });

    this.resizeHandler = () => {
      this.fit();
    };

    this.log('Step 5: add listeners');
    setTimeout(() => {
      window.addEventListener('resize', this.resizeHandler, { passive: true });
      this.log('Step 5 done');
    }, 100);

    this.log('init sync done');
  }

  /**
   * 禁用 xterm.js 内部的隐藏 textarea
   * 防止点击终端时弹出 iOS 软键盘
   */
  disableHelperTextarea() {
    const textarea = this.container.querySelector('.xterm-helper-textarea');
    if (textarea) {
      // 设置为只读，阻止软键盘弹出
      textarea.setAttribute('readonly', 'readonly');
      // 设置 inputmode 为 none，明确告诉浏览器不需要键盘
      textarea.setAttribute('inputmode', 'none');
      // 阻止获取焦点
      textarea.addEventListener('focus', (e) => {
        e.preventDefault();
        textarea.blur();
      }, { capture: true });
      this.log('helper textarea disabled');
    } else {
      this.log('helper textarea not found');
    }
  }

  /**
   * 自定义触摸滚动 - 完全接管触摸处理
   */
  setupTouchScroll() {
    let touchStartY = 0;
    let lastTouchY = 0;
    let velocity = 0;
    let lastTime = 0;
    let momentumId = null;
    let accumulatedDelta = 0;

    // 在整个容器上捕获触摸事件
    const target = this.container;

    // 触摸开始
    target.addEventListener('touchstart', (e) => {
      // 停止惯性滚动
      if (momentumId) {
        cancelAnimationFrame(momentumId);
        momentumId = null;
      }
      touchStartY = e.touches[0].clientY;
      lastTouchY = touchStartY;
      lastTime = Date.now();
      velocity = 0;
      accumulatedDelta = 0;
    }, { passive: false, capture: true });

    // 触摸移动 - 阻止默认行为，完全接管
    target.addEventListener('touchmove', (e) => {
      e.preventDefault();  // 阻止 xterm 和浏览器的默认处理
      e.stopPropagation();

      const currentY = e.touches[0].clientY;
      const deltaY = lastTouchY - currentY;
      const now = Date.now();
      const dt = now - lastTime;

      // 计算速度用于惯性
      if (dt > 0) {
        velocity = deltaY / dt;
      }

      // 累积滑动距离，达到一行高度才滚动
      accumulatedDelta += deltaY;
      const lineHeight = this.fontSize * 1.2;
      const lines = Math.trunc(accumulatedDelta / lineHeight);

      if (lines !== 0 && this.xterm) {
        this.xterm.scrollLines(lines);
        accumulatedDelta -= lines * lineHeight;
      }

      lastTouchY = currentY;
      lastTime = now;
    }, { passive: false, capture: true });

    // 触摸结束 - 惯性滚动
    target.addEventListener('touchend', () => {
      const lineHeight = this.fontSize * 1.2;

      const momentum = () => {
        if (Math.abs(velocity) < 0.02) {
          momentumId = null;
          return;
        }

        // 根据速度滚动
        accumulatedDelta += velocity * 16;
        const lines = Math.trunc(accumulatedDelta / lineHeight);

        if (lines !== 0 && this.xterm) {
          this.xterm.scrollLines(lines);
          accumulatedDelta -= lines * lineHeight;
        }

        // 减速（模拟摩擦力）
        velocity *= 0.95;
        momentumId = requestAnimationFrame(momentum);
      };

      if (Math.abs(velocity) > 0.3) {
        momentumId = requestAnimationFrame(momentum);
      }
    }, { passive: true, capture: true });

    this.log('touch scroll setup (capture mode)');
  }

  /**
   * 在页面上显示日志
   */
  log(msg) {
    console.log('[Terminal] ' + msg);
    // 使用 app 的 debugLog
    if (window.app && window.app.debugLog) {
      window.app.debugLog('[xterm] ' + msg);
    }
  }

  /**
   * 写入数据到终端
   */
  write(data) {
    console.log('Terminal.write called, ready:', this.isReady, 'data length:', data?.length);
    if (!this.isReady) {
      // 终端未就绪，放入队列
      console.log('Terminal not ready, queuing data');
      this.pendingWrites.push(data);
      return;
    }
    if (this.xterm) {
      this.xterm.write(data);
      console.log('xterm.write completed');
    } else {
      console.error('xterm not initialized');
    }
  }

  /**
   * 刷新待写入队列
   */
  flushPendingWrites() {
    if (this.pendingWrites.length > 0 && this.xterm) {
      console.log('Flushing', this.pendingWrites.length, 'pending writes');
      const combined = this.pendingWrites.join('');
      this.pendingWrites = [];
      this.xterm.write(combined);
    }
  }

  /**
   * 清屏
   */
  clear() {
    if (this.xterm) {
      this.xterm.clear();
    }
  }

  /**
   * 自适应容器大小
   */
  fit() {
    console.log('[Terminal] fit() called');
    if (this.fitAddon) {
      try {
        console.log('[Terminal] fit() - calling fitAddon.fit()...');
        this.fitAddon.fit();
        console.log('[Terminal] fit() - fitAddon.fit() completed, rows:', this.xterm?.rows, 'cols:', this.xterm?.cols);
      } catch (error) {
        console.error('[Terminal] fit() error:', error);
      }
    } else {
      console.log('[Terminal] fit() - no fitAddon available');
    }
  }

  /**
   * 调整字体大小
   */
  setFontSize(size) {
    this.fontSize = size;
    if (this.xterm) {
      this.xterm.options.fontSize = size;
      // 字体大小改变后需要重新适配
      setTimeout(() => this.fit(), 100);
    }
  }

  /**
   * 获取终端大小（行列数）
   */
  getSize() {
    if (this.xterm) {
      return {
        rows: this.xterm.rows,
        cols: this.xterm.cols
      };
    }
    return { rows: 24, cols: 80 };
  }

  /**
   * 滚动到底部
   */
  scrollToBottom() {
    if (this.xterm) {
      this.xterm.scrollToBottom();
    }
  }

  /**
   * 销毁终端
   */
  dispose() {
    // 移除事件监听
    if (this.resizeHandler) {
      try {
        window.removeEventListener('resize', this.resizeHandler);
      } catch (e) {
        console.error('Error removing resize listener:', e);
      }
    }

    this.isReady = false;
    this.pendingWrites = [];

    if (this.xterm) {
      try {
        this.xterm.dispose();
      } catch (e) {
        console.error('Error disposing xterm:', e);
      }
      this.xterm = null;
    }
    if (this.fitAddon) {
      this.fitAddon = null;
    }
  }
}
