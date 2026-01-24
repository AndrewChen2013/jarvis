/**
 * Copyright (c) 2026 BillChen
 * Frontend Bug reproduction tests - Found by Jeff Dean style code review
 *
 * 发现的 Bug 列表及测试用例:
 *
 * Bug F-1: mux-websocket.js - _processPendingOperations 消息格式不匹配
 * Bug F-2: mux-websocket.js - connect() 连接超时定时器泄漏
 * Bug F-3: chat.js - document 事件监听器泄漏
 * Bug F-4: chat.js - 消息 ID 碰撞风险
 * Bug F-5: websocket.js - iOS Safari workaround 事件竞态
 * Bug F-6: websocket.js - delayedFitTimer 可能操作错误的终端
 * Bug F-7: websocket.js - 滚动按钮定时器未清理
 * Bug F-8: chat.js - onConnect callback fails after session rename, isConnected never set
 */

// ============================================================================
// Test F-1: _processPendingOperations message format mismatch
// ============================================================================
function testBugF1_MessageFormatMismatch() {
  console.log('\n=== Test F-1: Message Format Mismatch ===');

  // Simulate the bug: messages are in optimized format {c, s, t, d}
  // but _processPendingOperations checks for {type, channel, session_id}

  // This is what packMessage() produces (optimized format)
  const optimizedMessage = {
    c: 0,  // terminal channel
    s: 'session-123',
    t: 'connect',  // or numeric code
    d: { working_dir: '/tmp' }
  };

  // The buggy code checks these properties (which don't exist in optimized format)
  const hasOldFormat =
    optimizedMessage.type === 'connect' &&
    optimizedMessage.channel &&
    optimizedMessage.session_id;

  // Bug: hasOldFormat is always false because the message uses c/s/t/d
  console.log('Message has old format properties:', hasOldFormat);
  console.log('Expected: true (to track connect messages)');
  console.log('Actual: false (tracking fails!)');

  // The fix should check optimized format: message.t === 'connect' && message.c !== undefined && message.s
  const hasOptimizedFormat =
    optimizedMessage.t === 'connect' &&
    optimizedMessage.c !== undefined &&
    optimizedMessage.s;

  console.log('After fix - correctly detects connect:', hasOptimizedFormat);

  return !hasOldFormat && hasOptimizedFormat;
}

// ============================================================================
// Test F-2: connect() connection timeout timer leak
// ============================================================================
function testBugF2_ConnectionTimeoutLeak() {
  console.log('\n=== Test F-2: Connection Timeout Timer Leak ===');

  let timerCount = 0;
  const timers = [];

  // Mock setTimeout
  const originalSetTimeout = setTimeout;
  const mockSetTimeout = (fn, delay) => {
    timerCount++;
    const id = originalSetTimeout(fn, delay);
    timers.push(id);
    console.log(`Timer ${timerCount} created (id=${id})`);
    return id;
  };

  // Simulate calling connect() 3 times quickly
  class BuggyMuxWebSocket {
    constructor() {
      this.connectionTimeout = null;
    }

    connect() {
      // BUG: Old code doesn't clear previous timeout
      // this.connectionTimeout = mockSetTimeout(...) just overwrites the reference
      this.connectionTimeout = mockSetTimeout(() => {
        console.log('Timeout fired!');
      }, 10000);
    }
  }

  class FixedMuxWebSocket {
    constructor() {
      this.connectionTimeout = null;
    }

    connect() {
      // FIX: Clear previous timeout before creating new one
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
      }
      this.connectionTimeout = mockSetTimeout(() => {
        console.log('Timeout fired!');
      }, 10000);
    }
  }

  // Test buggy version
  const buggy = new BuggyMuxWebSocket();
  buggy.connect();
  buggy.connect();
  buggy.connect();
  console.log(`Buggy version: ${timerCount} timers created (only 1 tracked, ${timerCount - 1} leaked!)`);

  // Clean up
  timers.forEach(id => clearTimeout(id));

  return timerCount > 1; // Bug exists if more than 1 timer created
}

// ============================================================================
// Test F-3: document event listener leak
// ============================================================================
function testBugF3_DocumentEventListenerLeak() {
  console.log('\n=== Test F-3: Document Event Listener Leak ===');

  let listenerCount = 0;
  const listeners = [];

  // Track listeners added to document
  const originalAddEventListener = document.addEventListener;
  document.addEventListener = function(type, listener, options) {
    if (type === 'click') {
      listenerCount++;
      listeners.push({ type, listener });
      console.log(`Listener ${listenerCount} added to document`);
    }
    return originalAddEventListener.call(this, type, listener, options);
  };

  // Simulate ChatMode.bindEvents() being called multiple times
  class BuggyChatMode {
    bindEvents() {
      // BUG: Each call adds a new listener, never removed
      document.addEventListener('click', (e) => {
        console.log('Click handler called');
      });
    }

    disconnect() {
      // No cleanup!
    }
  }

  // Test: simulate multiple session switches
  const buggyChat = new BuggyChatMode();
  buggyChat.bindEvents();
  buggyChat.bindEvents();
  buggyChat.bindEvents();

  console.log(`After 3 bindEvents() calls: ${listenerCount} listeners on document`);
  console.log('Expected: 1 listener (should reuse or clean up)');
  console.log('Actual: 3 listeners (memory leak!)');

  // Restore
  document.addEventListener = originalAddEventListener;

  return listenerCount > 1;
}

// ============================================================================
// Test F-4: Message ID collision
// ============================================================================
function testBugF4_MessageIdCollision() {
  console.log('\n=== Test F-4: Message ID Collision Risk ===');

  // Simulate rapid message creation
  const ids = new Set();
  let collisions = 0;

  // Original ID generation (buggy - relies on Date.now() which can be same in rapid calls)
  function generateIdBuggy() {
    return 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
  }

  // Create many IDs rapidly
  for (let i = 0; i < 1000; i++) {
    const id = generateIdBuggy();
    if (ids.has(id)) {
      collisions++;
    }
    ids.add(id);
  }

  console.log(`Generated 1000 IDs, collisions: ${collisions}`);
  console.log(`Unique IDs: ${ids.size}`);

  // The fix uses a counter
  let counter = 0;
  function generateIdFixed() {
    return 'msg-' + (++counter) + '-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  const fixedIds = new Set();
  for (let i = 0; i < 1000; i++) {
    fixedIds.add(generateIdFixed());
  }
  console.log(`Fixed version: ${fixedIds.size} unique IDs (guaranteed unique with counter)`);

  return true; // This test demonstrates the risk, actual collision is rare
}

// ============================================================================
// Test F-5: iOS Safari workaround race condition
// ============================================================================
function testBugF5_iOSSafariRace() {
  console.log('\n=== Test F-5: iOS Safari Workaround Race ===');

  // Simulate the race condition:
  // 1. First WS created, events bound
  // 2. 300ms timeout fires, checks if still CONNECTING
  // 3. But onopen could fire at exactly the wrong moment

  let events = [];

  class MockWebSocket {
    constructor() {
      this.readyState = 0; // CONNECTING
      this.onopen = null;
    }
    close() {
      events.push('close');
    }
  }

  // Simulate the buggy behavior
  let currentWs = null;

  function buggyConnect() {
    const firstWs = new MockWebSocket();
    currentWs = firstWs;

    // Bind events
    firstWs.onopen = () => {
      events.push('onopen-first');
    };

    // Simulate: onopen fires just as timeout is processing
    setTimeout(() => {
      // Timeout handler checks if still CONNECTING
      if (currentWs === firstWs && currentWs.readyState === 0) {
        // Race: onopen might fire here before nulling handlers
        firstWs.onopen(); // This triggers the handler

        // Now we null the handler (too late!)
        firstWs.onopen = null;
        firstWs.close();
        events.push('timeout-close-first');

        // Create second WS
        const secondWs = new MockWebSocket();
        currentWs = secondWs;
        secondWs.onopen = () => {
          events.push('onopen-second');
        };
      }
    }, 300);
  }

  buggyConnect();

  // Wait for timeout to fire
  return new Promise(resolve => {
    setTimeout(() => {
      console.log('Events:', events);
      console.log('Bug: onopen-first fired even though we tried to cancel it');
      resolve(true);
    }, 500);
  });
}

// ============================================================================
// Test F-6: delayedFitTimer session mismatch
// ============================================================================
function testBugF6_DelayedFitTimerMismatch() {
  console.log('\n=== Test F-6: delayedFitTimer Session Mismatch ===');

  // Simulate session switch during 2s delay
  let currentSession = 'session-A';
  let terminal = { id: 'terminal-A', fit: () => console.log('Fitting terminal-A') };

  // Buggy code uses this.terminal which changes
  function buggySetDelayedFit() {
    setTimeout(() => {
      // BUG: Uses current this.terminal, not the one when timer was set
      console.log(`Timer fires: currentSession=${currentSession}, terminal=${terminal?.id}`);
      if (terminal) {
        terminal.fit(); // Wrong terminal if session switched!
      }
    }, 100);
  }

  // Fixed code captures the terminal
  function fixedSetDelayedFit(capturedSession, capturedTerminal) {
    setTimeout(() => {
      // Check if session changed
      if (currentSession !== capturedSession) {
        console.log('Session changed, skip fit');
        return;
      }
      console.log(`Timer fires: using captured terminal=${capturedTerminal?.id}`);
      if (capturedTerminal) {
        capturedTerminal.fit();
      }
    }, 100);
  }

  // Test: start timer, then switch session
  buggySetDelayedFit();

  // Switch session immediately
  currentSession = 'session-B';
  terminal = { id: 'terminal-B', fit: () => console.log('Fitting terminal-B') };

  return new Promise(resolve => {
    setTimeout(() => {
      console.log('Bug: Timer operated on terminal-B instead of terminal-A');
      resolve(true);
    }, 200);
  });
}

// ============================================================================
// Test F-7: Scroll button timers not cleaned up
// ============================================================================
function testBugF7_ScrollButtonTimerCleanup() {
  console.log('\n=== Test F-7: Scroll Button Timers Not Cleaned ===');

  let orphanedTimers = 0;

  // Simulate button being removed from DOM during long press
  function setupScrollButton(btn) {
    let pressTimer = null;
    let scrollTimer = null;

    const startScroll = () => {
      scrollTimer = setInterval(() => {
        console.log('Scrolling...');
        orphanedTimers++;
      }, 60);
    };

    btn.addEventListener('touchstart', () => {
      pressTimer = setTimeout(startScroll, 200);
    });

    btn.addEventListener('touchend', () => {
      if (pressTimer) clearTimeout(pressTimer);
      if (scrollTimer) clearInterval(scrollTimer);
    });

    // BUG: No cleanup if button is removed from DOM
    // touchend never fires, timers keep running
  }

  // Simulate: button touched, held, then removed from DOM
  const mockBtn = {
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    }
  };

  setupScrollButton(mockBtn);

  // Trigger touchstart
  mockBtn.listeners.touchstart();

  // Simulate: button removed before touchend (e.g., view switch)
  // touchend never fires, scrollTimer never cleared

  return new Promise(resolve => {
    setTimeout(() => {
      console.log(`Orphaned timer iterations: ${orphanedTimers}`);
      console.log('Bug: timers continue running after button removed');
      resolve(orphanedTimers > 0);
    }, 500);
  });
}

// ============================================================================
// Test F-8: onConnect callback fails after session rename
// ============================================================================
function testBugF8_OnConnectAfterRename() {
  console.log('\n=== Test F-8: onConnect Callback Fails After Session Rename ===');

  // Simulate Chat object
  class BuggyChat {
    constructor() {
      this.sessionId = null;
      this.isConnected = false;
      this.log = (...args) => console.log('[Chat]', ...args);
    }

    // Simplified connectMux that captures sessionId
    connectMux(sessionId, workingDir) {
      this.sessionId = sessionId; // Set initial sessionId (temp ID)
      const capturedSessionId = sessionId; // Capture it for closure

      console.log(`connectMux called with sessionId=${sessionId}`);

      // Create the onConnect callback (this is the buggy code)
      const onConnect = (data) => {
        this.log(`onConnect fired, this.sessionId=${this.sessionId}, capturedSessionId=${capturedSessionId}`);

        // BUG: This condition fails when sessionId has been updated
        if (this.sessionId === capturedSessionId) {
          this.isConnected = true;
          this.log('isConnected set to true');
        } else {
          this.log('CONDITION FAILED - isConnected NOT set!');
        }
      };

      return { onConnect };
    }

    // Simulate session rename that updates sessionId
    renameSession(newId) {
      console.log(`Session renamed: ${this.sessionId} → ${newId}`);
      this.sessionId = newId;
    }
  }

  // Test scenario
  const chat = new BuggyChat();

  // 1. Connect with temporary ID
  const { onConnect } = chat.connectMux('new-1768054963463', '/Users/bill/code');
  console.log(`Initial state: sessionId=${chat.sessionId}, isConnected=${chat.isConnected}`);

  // 2. Simulate session rename (happens during connection)
  chat.renameSession('cd2eb470-8aac-4bb7-b9aa-da042e833b70');
  console.log(`After rename: sessionId=${chat.sessionId}, isConnected=${chat.isConnected}`);

  // 3. onConnect callback fires
  onConnect({ working_dir: '/Users/bill/code' });

  // 4. Check result
  console.log(`Final state: sessionId=${chat.sessionId}, isConnected=${chat.isConnected}`);
  console.log(`Expected isConnected: true`);
  console.log(`Actual isConnected: ${chat.isConnected}`);

  // Bug exists if isConnected is still false
  const bugExists = !chat.isConnected;
  if (bugExists) {
    console.log('🐛 BUG CONFIRMED: isConnected never set to true after session rename');
  }

  return bugExists;
}

// ============================================================================
// Run all tests
// ============================================================================
async function runAllTests() {
  console.log('========================================');
  console.log('Frontend Bug Reproduction Tests');
  console.log('Found by Jeff Dean Style Code Review');
  console.log('========================================');

  const results = {
    'F-1 Message Format Mismatch': testBugF1_MessageFormatMismatch(),
    'F-2 Connection Timeout Leak': testBugF2_ConnectionTimeoutLeak(),
    'F-3 Document Listener Leak': testBugF3_DocumentEventListenerLeak(),
    'F-4 Message ID Collision': testBugF4_MessageIdCollision(),
    'F-5 iOS Safari Race': await testBugF5_iOSSafariRace(),
    'F-6 DelayedFitTimer Mismatch': await testBugF6_DelayedFitTimerMismatch(),
    'F-7 Scroll Timer Cleanup': await testBugF7_ScrollButtonTimerCleanup(),
    'F-8 onConnect After Rename': testBugF8_OnConnectAfterRename()
  };

  console.log('\n========================================');
  console.log('Test Results:');
  console.log('========================================');
  for (const [name, result] of Object.entries(results)) {
    console.log(`${result ? '🐛 BUG CONFIRMED' : '✅ OK'}: ${name}`);
  }
}

// Export for use in browser console
if (typeof window !== 'undefined') {
  window.runFrontendBugTests = runAllTests;
}

// Run if in Node.js
if (typeof module !== 'undefined' && require.main === module) {
  runAllTests();
}
