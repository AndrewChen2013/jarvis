/**
 * Copyright (c) 2026 BillChen
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
 * 前端 Session 切换测试
 *
 * 模拟：
 * 1. 打开 session A
 * 2. 不关闭 session A，直接打开 session B
 * 3. 测量 session B 的打开速度
 *
 * 运行方式：在浏览器控制台中执行
 */

// 测试配置
const TEST_CONFIG = {
  sessionA: 'd910c8f8-4358-4158-aadd-f459edcc8d41',
  sessionB: '84267d14-5e80-473a-b962-87a5c0b08412',
  workingDir: '/Users/bill/jarvis',
};

// 测试结果收集
const testResults = {
  sessionA: { startTime: null, readyTime: null, historyEndTime: null, messages: [] },
  sessionB: { startTime: null, readyTime: null, historyEndTime: null, messages: [] },
};

/**
 * 创建一个 mock session 对象
 */
function createMockSession(sessionId) {
  return {
    id: sessionId,
    chatIsLoadingHistory: false,
    chatPendingHistoryMessages: [],
    chatIsReconnect: false,
    chatMessages: [],
    chatClaudeSessionId: null,
    chatIsStreaming: false,
    chatStreamingMessageId: null,
    chatHistoryOldestIndex: 0,
    chatHasMoreHistory: false,
  };
}

/**
 * 模拟 WebSocket 消息处理
 */
function simulateMessageHandler(session, messageType, data, timing) {
  const elapsed = performance.now() - timing.startTime;

  switch (messageType) {
    case 'ready':
      timing.readyTime = elapsed;
      if (data.history_count > 0) {
        session.chatIsLoadingHistory = true;
        session.chatPendingHistoryMessages = [];
        console.log(`[${session.id.substring(0, 8)}] ready received at +${elapsed.toFixed(1)}ms, expecting ${data.history_count} messages`);
      }
      break;

    case 'user':
    case 'assistant':
      if (session.chatIsLoadingHistory) {
        session.chatPendingHistoryMessages.push({
          type: messageType,
          content: data.content,
          extra: { timestamp: data.timestamp }
        });
      }
      timing.messages.push({ type: messageType, elapsed });
      break;

    case 'history_end':
      timing.historyEndTime = elapsed;
      session.chatIsLoadingHistory = false;
      console.log(`[${session.id.substring(0, 8)}] history_end at +${elapsed.toFixed(1)}ms, received ${session.chatPendingHistoryMessages.length} messages`);
      break;
  }
}

/**
 * 模拟连接 session（不使用真实 WebSocket）
 */
async function simulateConnectSession(sessionId, workingDir, timing) {
  timing.startTime = performance.now();

  const session = createMockSession(sessionId);

  // 模拟后端响应（基于实际日志中的 timing）
  // 后端 5ms 完成，但网络传输可能慢

  // 1. 模拟 ready 消息
  await new Promise(r => setTimeout(r, 5)); // 5ms 网络延迟
  simulateMessageHandler(session, 'ready', { history_count: 15 }, timing);

  // 2. 模拟 15 条历史消息
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1)); // 每条 1ms
    simulateMessageHandler(session, i % 2 === 0 ? 'user' : 'assistant', {
      content: `Message ${i}`,
      timestamp: new Date().toISOString()
    }, timing);
  }

  // 3. 模拟 history_end
  await new Promise(r => setTimeout(r, 1));
  simulateMessageHandler(session, 'history_end', { count: 15, total: 100 }, timing);

  return session;
}

/**
 * 运行测试
 */
async function runTest() {
  console.log('=== Session 切换前端测试 ===\n');

  // 1. 打开 Session A
  console.log('1. 打开 Session A...');
  const sessionA = await simulateConnectSession(
    TEST_CONFIG.sessionA,
    TEST_CONFIG.workingDir,
    testResults.sessionA
  );

  const timeA = testResults.sessionA.historyEndTime;
  console.log(`   Session A 完成: ${timeA.toFixed(1)}ms\n`);

  // 2. 不关闭 Session A，模拟它在后台有活动
  console.log('2. Session A 在后台运行（模拟 Claude 输出）...');
  let backgroundActive = true;
  const backgroundTask = (async () => {
    while (backgroundActive) {
      // 模拟后台消息处理
      await new Promise(r => setTimeout(r, 50));
    }
  })();

  // 等待一点时间
  await new Promise(r => setTimeout(r, 100));

  // 3. 打开 Session B
  console.log('3. 打开 Session B（Session A 仍在后台）...');
  const sessionB = await simulateConnectSession(
    TEST_CONFIG.sessionB,
    TEST_CONFIG.workingDir,
    testResults.sessionB
  );

  const timeB = testResults.sessionB.historyEndTime;
  console.log(`   Session B 完成: ${timeB.toFixed(1)}ms\n`);

  // 停止后台任务
  backgroundActive = false;
  await backgroundTask;

  // 4. 输出结果
  console.log('=== 测试结果 ===');
  console.log(`Session A: ${timeA.toFixed(1)}ms`);
  console.log(`Session B: ${timeB.toFixed(1)}ms`);
  console.log(`差异: ${(timeB - timeA).toFixed(1)}ms`);

  if (timeB > timeA * 2) {
    console.log('\n⚠️ Session B 明显慢于 Session A！');
  } else {
    console.log('\n✅ 两个 Session 速度相近');
  }

  return { timeA, timeB };
}

/**
 * 使用真实 WebSocket 测试
 */
async function runRealTest() {
  if (!window.muxWs) {
    console.error('muxWs 不存在，请在 Jarvis 页面中运行');
    return;
  }

  console.log('=== 真实 WebSocket Session 切换测试 ===\n');

  const results = {
    sessionA: { start: null, ready: null, historyEnd: null },
    sessionB: { start: null, ready: null, historyEnd: null },
  };

  // 拦截消息处理
  const originalHandler = window.ChatMode?.handleMuxMessageForSession;
  if (!originalHandler) {
    console.error('ChatMode.handleMuxMessageForSession 不存在');
    return;
  }

  let currentTiming = null;

  window.ChatMode.handleMuxMessageForSession = function(sessionId, type, data) {
    const now = performance.now();

    if (currentTiming) {
      if (type === 'ready') {
        currentTiming.ready = now - currentTiming.start;
        console.log(`[${sessionId.substring(0, 8)}] ready: +${currentTiming.ready.toFixed(1)}ms`);
      } else if (type === 'history_end') {
        currentTiming.historyEnd = now - currentTiming.start;
        console.log(`[${sessionId.substring(0, 8)}] history_end: +${currentTiming.historyEnd.toFixed(1)}ms`);
      }
    }

    return originalHandler.call(this, sessionId, type, data);
  };

  try {
    // 1. 连接 Session A
    console.log('1. 连接 Session A...');
    results.sessionA.start = performance.now();
    currentTiming = results.sessionA;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);

      window.muxWs.connectChat(TEST_CONFIG.sessionA, TEST_CONFIG.workingDir, {
        resume: TEST_CONFIG.sessionA,
        onConnect: () => {
          // 等待 history_end
          setTimeout(() => {
            clearTimeout(timeout);
            resolve();
          }, 2000);
        },
        onError: (err) => {
          clearTimeout(timeout);
          reject(err);
        }
      });
    });

    console.log(`   Session A 总耗时: ${results.sessionA.historyEnd?.toFixed(1) || 'N/A'}ms\n`);

    // 2. 等待一下
    await new Promise(r => setTimeout(r, 500));

    // 3. 连接 Session B（不断开 A）
    console.log('2. 连接 Session B（不断开 A）...');
    results.sessionB.start = performance.now();
    currentTiming = results.sessionB;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);

      window.muxWs.connectChat(TEST_CONFIG.sessionB, '/Users/bill', {
        resume: TEST_CONFIG.sessionB,
        onConnect: () => {
          setTimeout(() => {
            clearTimeout(timeout);
            resolve();
          }, 2000);
        },
        onError: (err) => {
          clearTimeout(timeout);
          reject(err);
        }
      });
    });

    console.log(`   Session B 总耗时: ${results.sessionB.historyEnd?.toFixed(1) || 'N/A'}ms\n`);

    // 4. 结果
    console.log('=== 测试结果 ===');
    console.log(`Session A: ${results.sessionA.historyEnd?.toFixed(1) || 'N/A'}ms`);
    console.log(`Session B: ${results.sessionB.historyEnd?.toFixed(1) || 'N/A'}ms`);

  } finally {
    // 恢复原始 handler
    window.ChatMode.handleMuxMessageForSession = originalHandler;
  }

  return results;
}

// 导出测试函数
if (typeof window !== 'undefined') {
  window.testSessionSwitch = {
    runSimulation: runTest,
    runReal: runRealTest,
    config: TEST_CONFIG,
    results: testResults,
  };

  console.log('Session 切换测试已加载');
  console.log('运行模拟测试: testSessionSwitch.runSimulation()');
  console.log('运行真实测试: testSessionSwitch.runReal()');
}

// 如果在 Node.js 中运行
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runTest, simulateConnectSession, createMockSession };
}
