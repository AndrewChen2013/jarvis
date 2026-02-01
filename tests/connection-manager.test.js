/**
 * Copyright (c) 2025 BillChen
 *
 * ConnectionManager 测试用例
 *
 * 测试 WebSocket 连接管理的状态机、重连策略和页面可见性处理
 */

// 加载真正的 ConnectionManager
const fs = require('fs');
const path = require('path');
const connectionManagerCode = fs.readFileSync(
  path.join(__dirname, '../static/connection-manager.js'),
  'utf8'
);

describe('ConnectionManager 状态机', () => {
  let ConnectionManager;
  let manager;
  let mockSocketIO;

  beforeEach(() => {
    jest.useFakeTimers();

    // Mock SocketIOManager
    mockSocketIO = {
      state: 'disconnected',
      connect: jest.fn(),
      disconnect: jest.fn(),
      onStateChange: null,
      // 模拟连接成功
      simulateConnect: function() {
        this.state = 'connected';
        if (this.onStateChange) this.onStateChange('connected', 'disconnected');
      },
      // 模拟断开连接
      simulateDisconnect: function() {
        this.state = 'disconnected';
        if (this.onStateChange) this.onStateChange('disconnected', 'connected');
      }
    };

    // Mock document for visibility API
    global.document = {
      hidden: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    };

    // Mock window for online/offline events
    global.window = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    };

    // Mock console
    global.console = {
      log: jest.fn(),
      error: jest.fn()
    };

    // 加载 ConnectionManager
    eval(connectionManagerCode);
    ConnectionManager = global.ConnectionManager || module.exports;

    manager = new ConnectionManager(mockSocketIO);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('初始状态', () => {
    test('初始状态应该是 idle', () => {
      expect(manager.state).toBe('idle');
    });

    test('初始重连次数应该是 0', () => {
      expect(manager.reconnectAttempts).toBe(0);
    });
  });

  describe('IDLE -> CONNECTING', () => {
    test('connect() 应该从 idle 转换到 connecting', () => {
      expect(manager.state).toBe('idle');

      manager.connect();

      expect(manager.state).toBe('connecting');
    });

    test('connect() 应该调用 socketIO.connect()', () => {
      manager.connect();

      expect(mockSocketIO.connect).toHaveBeenCalled();
    });

    test('connect() 应该触发 stateChange 事件', () => {
      const listener = jest.fn();
      manager.on('stateChange', listener);

      manager.connect();

      expect(listener).toHaveBeenCalledWith({
        from: 'idle',
        to: 'connecting',
        event: 'connect'
      });
    });
  });

  describe('CONNECTING -> CONNECTED', () => {
    test('socketIO 连接成功应该转换到 connected', () => {
      manager.connect();
      expect(manager.state).toBe('connecting');

      mockSocketIO.simulateConnect();

      expect(manager.state).toBe('connected');
    });

    test('连接成功后 reconnectAttempts 应该归零', () => {
      manager.reconnectAttempts = 3;
      manager.state = 'connecting';

      mockSocketIO.simulateConnect();

      expect(manager.reconnectAttempts).toBe(0);
    });
  });

  describe('CONNECTING -> RECONNECTING (连接失败)', () => {
    test('连接失败应该转换到 reconnecting', () => {
      manager.connect();
      expect(manager.state).toBe('connecting');

      // 模拟连接失败
      mockSocketIO.simulateDisconnect();

      expect(manager.state).toBe('reconnecting');
    });

    test('进入 reconnecting 应该调度重连', () => {
      manager.connect();
      mockSocketIO.simulateDisconnect();

      expect(manager.state).toBe('reconnecting');
      expect(manager.reconnectTimer).not.toBeNull();
    });
  });

  describe('CONNECTED -> RECONNECTING (断开)', () => {
    test('连接断开应该转换到 reconnecting', () => {
      manager.connect();
      mockSocketIO.simulateConnect();
      expect(manager.state).toBe('connected');

      mockSocketIO.simulateDisconnect();

      expect(manager.state).toBe('reconnecting');
    });
  });

  describe('CONNECTED -> IDLE (主动断开)', () => {
    test('disconnect() 应该转换到 idle', () => {
      manager.connect();
      mockSocketIO.simulateConnect();
      expect(manager.state).toBe('connected');

      manager.disconnect();

      expect(manager.state).toBe('idle');
    });

    test('disconnect() 应该调用 socketIO.disconnect()', () => {
      manager.connect();
      mockSocketIO.simulateConnect();

      manager.disconnect();

      expect(mockSocketIO.disconnect).toHaveBeenCalled();
    });
  });

  describe('RECONNECTING -> CONNECTED', () => {
    test('重连成功应该转换到 connected', () => {
      manager.state = 'reconnecting';
      manager.reconnectAttempts = 2;

      mockSocketIO.simulateConnect();

      expect(manager.state).toBe('connected');
      expect(manager.reconnectAttempts).toBe(0);
    });
  });

  describe('RECONNECTING 状态下重连失败应该继续重试', () => {
    test('BUG复现：重连失败后应该调度下一次重连', () => {
      // 模拟场景：
      // 1. 已连接状态
      manager.connect();
      mockSocketIO.simulateConnect();
      expect(manager.state).toBe('connected');

      // 2. 连接断开，进入 RECONNECTING
      mockSocketIO.simulateDisconnect();
      expect(manager.state).toBe('reconnecting');

      // 3. 等待重连定时器触发
      jest.advanceTimersByTime(100);
      expect(mockSocketIO.connect).toHaveBeenCalled();
      expect(manager.reconnectAttempts).toBe(1);

      // 4. 重连失败（Socket.IO 再次变成 disconnected）
      //    这是 BUG 所在：此时 ConnectionManager 在 RECONNECTING 状态，
      //    收到 disconnected 事件后应该继续重试，但现有代码不处理这种情况
      mockSocketIO.connect.mockClear();
      mockSocketIO.simulateDisconnect();

      // 5. 应该仍然在 RECONNECTING 状态，并且调度了下一次重连
      expect(manager.state).toBe('reconnecting');
      expect(manager.reconnectTimer).not.toBeNull();

      // 6. 等待下一次重连定时器触发（200ms）
      jest.advanceTimersByTime(200);
      expect(mockSocketIO.connect).toHaveBeenCalled();
      expect(manager.reconnectAttempts).toBe(2);
    });

    test('连续多次重连失败应该持续重试直到成功', () => {
      manager.connect();
      mockSocketIO.simulateConnect();
      mockSocketIO.simulateDisconnect();
      expect(manager.state).toBe('reconnecting');

      // 模拟 5 次重连失败
      for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(manager._getReconnectDelay());
        mockSocketIO.connect.mockClear();

        // 重连失败
        mockSocketIO.simulateDisconnect();

        expect(manager.state).toBe('reconnecting');
        expect(manager.reconnectTimer).not.toBeNull();
      }

      // 第 6 次重连成功
      jest.advanceTimersByTime(manager._getReconnectDelay());
      mockSocketIO.simulateConnect();

      expect(manager.state).toBe('connected');
      expect(manager.reconnectAttempts).toBe(0);
    });

    test('iOS 后台唤醒场景：suspended 恢复后首次重连失败应该继续重试', () => {
      // 1. 已连接
      manager.connect();
      mockSocketIO.simulateConnect();
      expect(manager.state).toBe('connected');

      // 2. 进入后台，suspended，同时模拟 socket 断开（iOS 常见）
      manager.state = 'suspended';
      mockSocketIO.state = 'disconnected';

      // 3. 回到前台，触发 resume
      manager._transition('resume');
      expect(manager.state).toBe('reconnecting');

      // 4. 首次重连尝试
      jest.advanceTimersByTime(100);
      expect(mockSocketIO.connect).toHaveBeenCalled();

      // 5. 重连失败（网络还没恢复）
      mockSocketIO.connect.mockClear();
      mockSocketIO.simulateDisconnect();

      // 6. 应该继续重试
      expect(manager.state).toBe('reconnecting');
      expect(manager.reconnectTimer).not.toBeNull();

      // 7. 下一次重连成功
      jest.advanceTimersByTime(200);
      mockSocketIO.simulateConnect();

      expect(manager.state).toBe('connected');
    });
  });

  describe('RECONNECTING -> FAILED (超过最大重试)', () => {
    test('超过最大重试次数应该转换到 failed', () => {
      manager.state = 'reconnecting';
      manager.reconnectAttempts = manager.maxRetries;

      // 再次尝试重连
      manager._doReconnect();

      expect(manager.state).toBe('failed');
    });
  });

  describe('FAILED -> CONNECTING (手动重试)', () => {
    test('retry() 应该从 failed 转换到 connecting', () => {
      manager.state = 'failed';

      manager.retry();

      expect(manager.state).toBe('connecting');
    });
  });
});


describe('重连策略', () => {
  let ConnectionManager;
  let manager;
  let mockSocketIO;

  beforeEach(() => {
    jest.useFakeTimers();

    mockSocketIO = {
      state: 'disconnected',
      connect: jest.fn(),
      disconnect: jest.fn(),
      onStateChange: null,
      simulateConnect: function() {
        this.state = 'connected';
        if (this.onStateChange) this.onStateChange('connected', 'disconnected');
      },
      simulateDisconnect: function() {
        this.state = 'disconnected';
        if (this.onStateChange) this.onStateChange('disconnected', 'connected');
      }
    };

    global.document = {
      hidden: false,
      addEventListener: jest.fn()
    };
    global.window = {
      addEventListener: jest.fn()
    };
    global.console = {
      log: jest.fn(),
      error: jest.fn()
    };

    // 加载真正的 ConnectionManager
    eval(connectionManagerCode);
    ConnectionManager = global.ConnectionManager || module.exports;

    manager = new ConnectionManager(mockSocketIO);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('快速重连延迟', () => {
    test('首次重连延迟应该是 100ms', () => {
      manager.reconnectAttempts = 0;
      const delay = manager._getReconnectDelay();

      expect(delay).toBe(100);
    });

    test('第二次重连延迟应该是 200ms', () => {
      manager.reconnectAttempts = 1;
      const delay = manager._getReconnectDelay();

      expect(delay).toBe(200);
    });

    test('第三次重连延迟应该是 400ms', () => {
      manager.reconnectAttempts = 2;
      const delay = manager._getReconnectDelay();

      expect(delay).toBe(400);
    });

    test('延迟应该有最大值 2000ms', () => {
      manager.reconnectAttempts = 10;
      const delay = manager._getReconnectDelay();

      expect(delay).toBe(2000);
    });

    test('指数退避序列: 100, 200, 400, 800, 1600, 2000, 2000...', () => {
      const delays = [];
      for (let i = 0; i < 8; i++) {
        manager.reconnectAttempts = i;
        delays.push(manager._getReconnectDelay());
      }

      expect(delays).toEqual([100, 200, 400, 800, 1600, 2000, 2000, 2000]);
    });
  });

  describe('重连调度', () => {
    test('进入 reconnecting 状态应该启动重连定时器', () => {
      manager.state = 'connected';
      mockSocketIO.simulateDisconnect();

      expect(manager.state).toBe('reconnecting');
      expect(manager.reconnectTimer).not.toBeNull();
    });

    test('定时器触发后应该调用 socketIO.connect()', () => {
      manager.state = 'connected';
      mockSocketIO.simulateDisconnect();
      mockSocketIO.connect.mockClear();

      // 等待 100ms (首次重连延迟)
      jest.advanceTimersByTime(100);

      expect(mockSocketIO.connect).toHaveBeenCalled();
    });

    test('重连失败后应该增加 reconnectAttempts', () => {
      manager.state = 'connected';
      manager.reconnectAttempts = 0;
      mockSocketIO.simulateDisconnect();

      // 触发首次重连
      jest.advanceTimersByTime(100);

      expect(manager.reconnectAttempts).toBe(1);
    });

    test('连续重连失败应该使用递增延迟', () => {
      manager.state = 'reconnecting';
      manager.reconnectAttempts = 0;

      // 首次：100ms
      manager._scheduleReconnect();
      expect(manager._getReconnectDelay()).toBe(100);

      // 模拟失败，进入下一次
      jest.advanceTimersByTime(100);
      manager.reconnectAttempts = 1;

      // 第二次：200ms
      manager._scheduleReconnect();
      expect(manager._getReconnectDelay()).toBe(200);
    });
  });

  describe('最大重试次数', () => {
    test('默认最大重试次数应该是 20', () => {
      expect(manager.maxRetries).toBe(20);
    });

    test('达到最大重试次数后应该转为 failed', () => {
      manager.state = 'reconnecting';
      manager.reconnectAttempts = 20;

      manager._doReconnect();

      expect(manager.state).toBe('failed');
    });

    test('failed 状态不应该自动重连', () => {
      manager.state = 'failed';
      mockSocketIO.connect.mockClear();

      jest.advanceTimersByTime(10000);

      expect(mockSocketIO.connect).not.toHaveBeenCalled();
    });
  });
});


describe('页面可见性处理', () => {
  let ConnectionManager;
  let manager;
  let mockSocketIO;
  let mockDocumentHidden = false;
  let originalHiddenDescriptor;

  beforeEach(() => {
    jest.useFakeTimers();

    mockSocketIO = {
      state: 'disconnected',
      connect: jest.fn(),
      disconnect: jest.fn(),
      onStateChange: null,
      simulateConnect: function() {
        this.state = 'connected';
        if (this.onStateChange) this.onStateChange('connected', 'disconnected');
      },
      simulateDisconnect: function() {
        this.state = 'disconnected';
        if (this.onStateChange) this.onStateChange('disconnected', 'connected');
      }
    };

    // 重置 mock 状态
    mockDocumentHidden = false;

    // 保存原始的 hidden 属性描述符
    originalHiddenDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden') ||
                               Object.getOwnPropertyDescriptor(document, 'hidden');

    // 使用 defineProperty 来 mock document.hidden
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => mockDocumentHidden
    });

    global.console = {
      log: jest.fn(),
      error: jest.fn()
    };

    // 加载真正的 ConnectionManager
    eval(connectionManagerCode);
    ConnectionManager = global.ConnectionManager || module.exports;

    manager = new ConnectionManager(mockSocketIO);
  });

  afterEach(() => {
    jest.useRealTimers();
    // 恢复原始的 hidden 属性
    if (originalHiddenDescriptor) {
      Object.defineProperty(document, 'hidden', originalHiddenDescriptor);
    }
  });

  // Helper 函数来设置 document.hidden
  const setDocumentHidden = (hidden) => {
    mockDocumentHidden = hidden;
  };

  describe('页面进入后台 (SUSPEND)', () => {
    test('connected 状态下页面隐藏应该转为 suspended', () => {
      manager.connect();
      mockSocketIO.simulateConnect();
      expect(manager.state).toBe('connected');

      // 模拟页面隐藏
      setDocumentHidden(true);
      manager._onVisibilityChange();

      expect(manager.state).toBe('suspended');
    });

    test('reconnecting 状态下页面隐藏应该转为 suspended', () => {
      manager.state = 'reconnecting';
      manager._scheduleReconnect();

      setDocumentHidden(true);
      manager._onVisibilityChange();

      expect(manager.state).toBe('suspended');
    });

    test('suspended 状态应该清除重连定时器', () => {
      manager.state = 'reconnecting';
      manager._scheduleReconnect();
      expect(manager.reconnectTimer).not.toBeNull();

      setDocumentHidden(true);
      manager._onVisibilityChange();

      expect(manager.reconnectTimer).toBeNull();
    });

    test('idle 状态下页面隐藏不应该改变状态', () => {
      expect(manager.state).toBe('idle');

      setDocumentHidden(true);
      manager._onVisibilityChange();

      expect(manager.state).toBe('idle');
    });
  });

  describe('页面恢复可见 (RESUME)', () => {
    test('suspended 状态下页面可见应该立即开始重连', () => {
      manager.state = 'suspended';

      setDocumentHidden(false);
      manager._onVisibilityChange();

      expect(manager.state).toBe('reconnecting');
    });

    test('恢复可见后应该启动重连定时器', () => {
      manager.state = 'suspended';
      manager.reconnectTimer = null;

      setDocumentHidden(false);
      manager._onVisibilityChange();

      expect(manager.reconnectTimer).not.toBeNull();
    });

    test('connected 状态下页面可见不应该改变状态', () => {
      manager.connect();
      mockSocketIO.simulateConnect();
      expect(manager.state).toBe('connected');

      setDocumentHidden(false);
      manager._onVisibilityChange();

      expect(manager.state).toBe('connected');
    });
  });

  describe('移动端典型场景', () => {
    test('场景：切换App后返回 - socket已断开需要重连', () => {
      // 1. 已连接状态
      manager.connect();
      mockSocketIO.simulateConnect();
      expect(manager.state).toBe('connected');

      // 2. 切换到其他 App（页面隐藏）
      setDocumentHidden(true);
      manager._onVisibilityChange();
      expect(manager.state).toBe('suspended');

      // 3. 模拟后台时 socket 断开（移动端常见）
      mockSocketIO.state = 'disconnected';

      // 4. 返回 Jarvis（页面可见）
      setDocumentHidden(false);
      manager._onVisibilityChange();
      expect(manager.state).toBe('reconnecting');

      // 5. 应该在 100ms 内尝试重连
      expect(manager._getReconnectDelay()).toBe(100);
    });

    test('场景：切换App后返回 - socket仍连接直接恢复', () => {
      // 1. 已连接状态
      manager.connect();
      mockSocketIO.simulateConnect();
      expect(manager.state).toBe('connected');

      // 2. 切换到其他 App（页面隐藏）
      setDocumentHidden(true);
      manager._onVisibilityChange();
      expect(manager.state).toBe('suspended');

      // 3. socket 仍然连接（短时间切换）
      // mockSocketIO.state 仍为 'connected'

      // 4. 返回 Jarvis（页面可见）
      setDocumentHidden(false);
      manager._onVisibilityChange();
      // 如果 socket 仍然连接，应该直接转为 connected
      expect(manager.state).toBe('connected');
    });

    test('场景：长时间后台后返回', () => {
      // 1. 已连接
      manager.connect();
      mockSocketIO.simulateConnect();

      // 2. 进入后台
      setDocumentHidden(true);
      manager._onVisibilityChange();
      expect(manager.state).toBe('suspended');

      // 3. 模拟 5 分钟后 socket 已断开
      jest.advanceTimersByTime(5 * 60 * 1000);
      mockSocketIO.state = 'disconnected';

      // 4. 返回前台
      setDocumentHidden(false);
      manager._onVisibilityChange();
      expect(manager.state).toBe('reconnecting');

      // 5. 重连次数应该从 0 开始（suspend 期间不计数）
      // 首次重连延迟仍然是 100ms
      expect(manager._getReconnectDelay()).toBe(100);
    });

    test('场景：弱网环境频繁切换', () => {
      manager.connect();
      mockSocketIO.simulateConnect();

      // 模拟 5 次切换
      for (let i = 0; i < 5; i++) {
        // 进入后台
        setDocumentHidden(true);
        manager._onVisibilityChange();
        expect(manager.state).toBe('suspended');

        // 模拟后台时 socket 断开
        mockSocketIO.state = 'disconnected';

        // 返回前台
        setDocumentHidden(false);
        manager._onVisibilityChange();
        expect(manager.state).toBe('reconnecting');

        // 重连成功
        mockSocketIO.simulateConnect();
        expect(manager.state).toBe('connected');
      }

      // 应该一直保持正常工作
      expect(manager.state).toBe('connected');
      expect(manager.reconnectAttempts).toBe(0);
    });
  });
});


describe('网络状态处理', () => {
  let ConnectionManager;
  let manager;
  let mockSocketIO;

  beforeEach(() => {
    jest.useFakeTimers();

    mockSocketIO = {
      state: 'disconnected',
      connect: jest.fn(),
      disconnect: jest.fn(),
      onStateChange: null,
      simulateConnect: function() {
        this.state = 'connected';
        if (this.onStateChange) this.onStateChange('connected', 'disconnected');
      }
    };

    global.document = {
      hidden: false,
      addEventListener: jest.fn()
    };

    global.window = {
      addEventListener: jest.fn()
    };

    global.console = {
      log: jest.fn(),
      error: jest.fn()
    };

    // 加载真正的 ConnectionManager
    eval(connectionManagerCode);
    ConnectionManager = global.ConnectionManager || module.exports;

    manager = new ConnectionManager(mockSocketIO);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('网络恢复', () => {
    test('reconnecting 状态下网络恢复应该立即重连', () => {
      manager.state = 'reconnecting';
      manager.reconnectAttempts = 3;
      mockSocketIO.connect.mockClear();

      // 直接调用 manager 的方法
      manager._onNetworkOnline();

      expect(mockSocketIO.connect).toHaveBeenCalled();
    });

    test('网络恢复应该重置重连次数', () => {
      manager.state = 'reconnecting';
      manager.reconnectAttempts = 5;

      manager._onNetworkOnline();

      // 重置后加 1
      expect(manager.reconnectAttempts).toBe(1);
    });

    test('网络恢复应该清除现有重连定时器', () => {
      manager.state = 'reconnecting';
      manager.reconnectTimer = setTimeout(() => {}, 5000);

      manager._onNetworkOnline();

      expect(manager.reconnectTimer).toBeNull();
    });

    test('suspended 状态下网络恢复应该立即重连', () => {
      manager.state = 'suspended';
      mockSocketIO.connect.mockClear();

      manager._onNetworkOnline();

      expect(mockSocketIO.connect).toHaveBeenCalled();
    });

    test('connected 状态下网络恢复不应该触发重连', () => {
      manager.state = 'connected';
      mockSocketIO.connect.mockClear();

      manager._onNetworkOnline();

      expect(mockSocketIO.connect).not.toHaveBeenCalled();
    });
  });
});
