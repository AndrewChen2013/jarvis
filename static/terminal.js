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
    this.fontSize = 12;  // 移动端最佳字体大小
    this.isReady = false;
    this.onReady = onReady;
    this.pendingWrites = [];  // 等待写入的数据队列

    this.init();
  }

  init() {
    this.log('Step 1: 创建 xterm 实例');

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
        cursor: 'transparent',      // 隐藏光标
        cursorAccent: 'transparent',
        selection: 'rgba(255, 255, 255, 0.3)',
      },

      // 性能优化
      scrollback: 500,        // 减少回滚行数
      cursorBlink: false,     // 禁用光标闪烁
      cursorInactiveStyle: 'none',  // 非活动时不显示光标
      disableStdin: true,     // 禁用内置输入（我们用自己的输入框）

      // 滚动优化
      smoothScrollDuration: 0,  // 禁用平滑滚动
      scrollOnUserInput: true,
      scrollSensitivity: 20,    // 增大滚动灵敏度（默认1）
      fastScrollSensitivity: 40, // 快速滚动灵敏度
    });
    this.log('Step 1 完成');

    this.log('Step 2: 创建 FitAddon');
    this.fitAddon = new window.FitAddon.FitAddon();
    this.xterm.loadAddon(this.fitAddon);
    this.log('Step 2 完成');

    this.log('Step 3: 打开终端');
    this.xterm.open(this.container);
    this.log('Step 3 完成');

    // 尝试加载 WebGL 渲染器（GPU 加速）
    this.log('Step 3.5: 尝试 WebGL 加速');
    if (window.WebglAddon) {
      try {
        const webglAddon = new window.WebglAddon.WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon.dispose();
          this.log('WebGL context lost, falling back to canvas');
        });
        this.xterm.loadAddon(webglAddon);
        this.log('WebGL 加速已启用');
      } catch (e) {
        this.log('WebGL 不可用: ' + e.message);
      }
    } else {
      this.log('WebglAddon 未加载');
    }

    this.log('Step 4: 等待 fit()');
    requestAnimationFrame(() => {
      this.log('Step 4a: RAF 回调');
      this.fit();
      this.log('Step 4b: fit 完成');
      this.isReady = true;
      this.log('Step 4c: 刷新队列 ' + this.pendingWrites.length);
      this.flushPendingWrites();
      this.log('Step 4d: 队列完成');

      // 设置触摸滚动（DOM 已渲染）
      this.log('Step 4e: 设置触摸滚动');
      this.setupTouchScroll();

      if (this.onReady) {
        this.log('Step 4f: onReady');
        this.onReady();
        this.log('Step 4g: onReady 完成');
      }
    });

    this.resizeHandler = () => {
      this.fit();
    };

    this.log('Step 5: 添加监听器');
    setTimeout(() => {
      window.addEventListener('resize', this.resizeHandler, { passive: true });
      this.log('Step 5 完成');
    }, 100);

    this.log('init 同步完成');
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

    this.log('触摸滚动已设置(capture模式)');
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
