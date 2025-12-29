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
    });

    // 创建 FitAddon 用于自适应大小
    this.fitAddon = new window.FitAddon.FitAddon();
    this.xterm.loadAddon(this.fitAddon);

    // 打开终端
    this.xterm.open(this.container);

    // 初始化适配（延迟确保布局完成）
    requestAnimationFrame(() => {
      this.fit();
      // 标记为就绪，处理队列中的数据
      this.isReady = true;
      console.log('Terminal ready, pending writes:', this.pendingWrites.length);
      this.flushPendingWrites();
      if (this.onReady) {
        this.onReady();
      }
    });

    // 监听窗口大小变化
    this.resizeHandler = () => {
      this.fit();
    };
    window.addEventListener('resize', this.resizeHandler);

    // 监听可视区域变化（键盘弹出/收起）
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.resizeHandler);
    }

    console.log('Terminal initialized with xterm.js');
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
    if (this.fitAddon) {
      try {
        this.fitAddon.fit();
        console.log('Terminal fitted to container');
      } catch (error) {
        console.error('Fit error:', error);
      }
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
      window.removeEventListener('resize', this.resizeHandler);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', this.resizeHandler);
      }
    }

    this.isReady = false;
    this.pendingWrites = [];

    if (this.xterm) {
      this.xterm.dispose();
      this.xterm = null;
    }
    if (this.fitAddon) {
      this.fitAddon = null;
    }
  }
}
