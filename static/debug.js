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
 * 调试模块
 * 提供调试日志和调试面板功能
 */
const AppDebug = {
  /**
   * 在页面上显示调试日志
   */
  debugLog(msg) {
    const now = new Date();
    const time = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    const logLine = `[${time}] ${msg}`;

    console.log('[Debug] ' + msg);
    if (!this.debugLogs) this.debugLogs = [];
    this.debugLogs.push(logLine);

    // 更新日志面板内容
    const content = document.getElementById('debug-log-content');
    if (content) {
      content.innerHTML += logLine + '<br>';
      content.scrollTop = content.scrollHeight;
    }
  },

  /**
   * 初始化调试面板
   */
  initDebugPanel() {
    if (document.getElementById('debug-panel')) return;

    // 创建面板
    const panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;bottom:60px;background:rgba(0,0,0,0.95);z-index:9998;flex-direction:column;';

    // 标题栏
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:10px;border-bottom:1px solid #333;';
    header.innerHTML = `<span style="color:#0f0;font-weight:bold;">${this.t('debug.title')}</span>`;

    // 按钮组
    const btnGroup = document.createElement('div');

    // 复制按钮
    const copyBtn = document.createElement('button');
    copyBtn.textContent = this.t('debug.copy');
    copyBtn.style.cssText = 'padding:5px 15px;margin-right:10px;background:#333;color:#fff;border:none;border-radius:4px;';
    copyBtn.onclick = () => {
      const text = (window.app?.debugLogs || []).join('\n');
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      copyBtn.textContent = this.t('debug.copied');
      setTimeout(() => copyBtn.textContent = this.t('debug.copy'), 1000);
    };

    // 清除按钮
    const clearBtn = document.createElement('button');
    clearBtn.textContent = this.t('debug.clear');
    clearBtn.style.cssText = 'padding:5px 15px;margin-right:10px;background:#333;color:#fff;border:none;border-radius:4px;';
    clearBtn.onclick = () => {
      this.debugLogs = [];
      const content = document.getElementById('debug-log-content');
      if (content) content.innerHTML = '';
    };

    // 关闭按钮
    const closeBtn = document.createElement('button');
    closeBtn.textContent = this.t('debug.close');
    closeBtn.style.cssText = 'padding:5px 15px;background:#c00;color:#fff;border:none;border-radius:4px;';
    closeBtn.onclick = () => this.toggleDebugPanel();

    btnGroup.appendChild(copyBtn);
    btnGroup.appendChild(clearBtn);
    btnGroup.appendChild(closeBtn);
    header.appendChild(btnGroup);

    // 日志内容区
    const content = document.createElement('div');
    content.id = 'debug-log-content';
    content.style.cssText = 'flex:1;overflow:auto;padding:10px;color:#0f0;font-size:12px;font-family:monospace;';

    panel.appendChild(header);
    panel.appendChild(content);
    document.body.appendChild(panel);

    // 回填已有日志
    if (this.debugLogs && this.debugLogs.length > 0) {
      content.innerHTML = this.debugLogs.join('<br>');
    }
  },

  /**
   * 切换调试面板显示
   */
  toggleDebugPanel() {
    this.initDebugPanel();
    const panel = document.getElementById('debug-panel');
    if (panel) {
      const isVisible = panel.style.display === 'flex';
      panel.style.display = isVisible ? 'none' : 'flex';
    }
  },

  /**
   * 重置调试面板（语言切换时调用）
   */
  resetDebugPanel() {
    const panel = document.getElementById('debug-panel');
    if (panel) {
      panel.remove();
    }
  }
};

// 导出到全局
window.AppDebug = AppDebug;
