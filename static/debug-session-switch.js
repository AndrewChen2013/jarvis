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
 * Session 切换调试脚本
 *
 * 在浏览器控制台中运行：
 *   1. 打开 Jarvis 页面
 *   2. 打开开发者工具 (F12)
 *   3. 在 Console 中粘贴并运行此脚本
 *   4. 运行: debugSessionSwitch.test()
 */

window.debugSessionSwitch = {
  // 配置
  sessions: [
    { id: 'd910c8f8-4358-4158-aadd-f459edcc8d41', workDir: '/Users/bill/jarvis' },
    { id: '84267d14-5e80-473a-b962-87a5c0b08412', workDir: '/Users/bill' },
  ],

  // 结果
  results: [],

  // 拦截消息并记录时间
  interceptMessages() {
    const self = this;

    // 拦截 handleMuxMessageForSession
    if (window.ChatMode && window.ChatMode.handleMuxMessageForSession) {
      const original = window.ChatMode.handleMuxMessageForSession.bind(window.ChatMode);

      window.ChatMode.handleMuxMessageForSession = function(sessionId, type, data) {
        const now = performance.now();
        const entry = self.results.find(r => r.sessionId === sessionId);

        if (entry && !entry.done) {
          entry.events.push({ type, time: now - entry.startTime });

          if (type === 'ready') {
            entry.readyTime = now - entry.startTime;
            console.log(`[${sessionId.substring(0, 8)}] ready: +${entry.readyTime.toFixed(0)}ms`);
          } else if (type === 'history_end') {
            entry.historyEndTime = now - entry.startTime;
            entry.done = true;
            console.log(`[${sessionId.substring(0, 8)}] history_end: +${entry.historyEndTime.toFixed(0)}ms`);
          } else if (type === 'user' || type === 'assistant') {
            entry.messageCount++;
          }
        }

        return original(sessionId, type, data);
      };

      console.log('✓ 已拦截 ChatMode.handleMuxMessageForSession');
    } else {
      console.error('✗ ChatMode.handleMuxMessageForSession 不存在');
    }
  },

  // 连接 session
  async connectSession(sessionId, workDir) {
    return new Promise((resolve, reject) => {
      const entry = {
        sessionId,
        workDir,
        startTime: performance.now(),
        readyTime: null,
        historyEndTime: null,
        messageCount: 0,
        events: [],
        done: false,
      };
      this.results.push(entry);

      console.log(`[${sessionId.substring(0, 8)}] 开始连接...`);

      // 设置超时
      const timeout = setTimeout(() => {
        entry.done = true;
        reject(new Error('连接超时'));
      }, 15000);

      // 轮询检查完成
      const checkDone = setInterval(() => {
        if (entry.done) {
          clearInterval(checkDone);
          clearTimeout(timeout);
          resolve(entry);
        }
      }, 100);

      // 发起连接
      if (window.muxWs) {
        window.muxWs.connectChat(sessionId, workDir, {
          resume: sessionId,
          onConnect: () => {
            console.log(`[${sessionId.substring(0, 8)}] onConnect 回调`);
          },
          onError: (err) => {
            clearInterval(checkDone);
            clearTimeout(timeout);
            entry.done = true;
            reject(err);
          }
        });
      } else {
        clearInterval(checkDone);
        clearTimeout(timeout);
        reject(new Error('muxWs 不存在'));
      }
    });
  },

  // 运行测试
  async test() {
    console.log('\n========== Session 切换测试 ==========\n');

    this.results = [];
    this.interceptMessages();

    try {
      // 1. 连接第一个 session
      console.log('\n--- 步骤 1: 连接第一个 Session ---');
      const result1 = await this.connectSession(
        this.sessions[0].id,
        this.sessions[0].workDir
      );
      console.log(`第一个 Session 完成: ${result1.historyEndTime?.toFixed(0) || 'N/A'}ms`);

      // 等待一下，模拟用户操作
      await new Promise(r => setTimeout(r, 1000));

      // 2. 连接第二个 session（不断开第一个）
      console.log('\n--- 步骤 2: 连接第二个 Session（不断开第一个）---');
      const result2 = await this.connectSession(
        this.sessions[1].id,
        this.sessions[1].workDir
      );
      console.log(`第二个 Session 完成: ${result2.historyEndTime?.toFixed(0) || 'N/A'}ms`);

      // 3. 输出对比
      console.log('\n========== 测试结果 ==========');
      console.log(`Session 1: ${result1.historyEndTime?.toFixed(0) || 'N/A'}ms (${result1.messageCount} 条消息)`);
      console.log(`Session 2: ${result2.historyEndTime?.toFixed(0) || 'N/A'}ms (${result2.messageCount} 条消息)`);

      const diff = (result2.historyEndTime || 0) - (result1.historyEndTime || 0);
      console.log(`差异: ${diff.toFixed(0)}ms`);

      if (diff > 500) {
        console.log('\n⚠️ 第二个 Session 明显慢于第一个！');
      } else if (diff > 100) {
        console.log('\n⚡ 第二个 Session 稍慢');
      } else {
        console.log('\n✅ 两个 Session 速度相近');
      }

      return this.results;

    } catch (err) {
      console.error('测试失败:', err);
      return null;
    }
  },

  // 查看详细事件
  showEvents() {
    this.results.forEach(r => {
      console.log(`\n[${r.sessionId.substring(0, 8)}] 事件列表:`);
      r.events.forEach(e => {
        console.log(`  +${e.time.toFixed(0)}ms: ${e.type}`);
      });
    });
  }
};

console.log('Session 切换调试脚本已加载');
console.log('运行测试: debugSessionSwitch.test()');
console.log('查看事件: debugSessionSwitch.showEvents()');
