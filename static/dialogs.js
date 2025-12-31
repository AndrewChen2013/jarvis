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
 * 对话框模块
 * 提供确认对话框、Toast、帮助面板等 UI 组件
 */
const AppDialogs = {
  /**
   * 显示确认删除弹窗
   */
  showConfirmDialog(title, message, onConfirm) {
    const dialog = document.createElement('div');
    dialog.className = 'confirm-modal';
    // 支持换行：将 \n 转换为 <br>
    const formattedMessage = this.escapeHtml(message).replace(/\n/g, '<br>');
    dialog.innerHTML = `
      <div class="confirm-modal-content">
        <div class="confirm-modal-icon">⚠️</div>
        <div class="confirm-modal-title">${this.escapeHtml(title)}</div>
        <div class="confirm-modal-message">${formattedMessage}</div>
        <div class="confirm-modal-buttons">
          <button class="btn btn-cancel">${this.t('common.cancel', 'Cancel')}</button>
          <button class="btn btn-danger">${this.t('common.delete', 'Delete')}</button>
        </div>
      </div>
    `;

    const closeDialog = () => {
      document.body.removeChild(dialog);
    };

    dialog.querySelector('.btn-cancel').addEventListener('click', closeDialog);
    dialog.querySelector('.btn-danger').addEventListener('click', () => {
      closeDialog();
      onConfirm();
    });

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        closeDialog();
      }
    });

    document.body.appendChild(dialog);
  },

  /**
   * 显示 Toast 提示
   */
  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 100px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: #fff;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 3000;
      animation: fadeIn 0.3s, fadeOut 0.3s 2s forwards;
    `;

    // Add animation styles if not already present
    if (!document.getElementById('toast-styles')) {
      const style = document.createElement('style');
      style.id = 'toast-styles';
      style.textContent = `
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) {
        document.body.removeChild(toast);
      }
    }, 2500);
  },

  /**
   * 显示错误
   */
  showError(message) {
    alert(message);
  },

  /**
   * 切换帮助面板显示
   */
  toggleHelpPanel(event) {
    if (event) event.stopPropagation();
    const panel = document.getElementById('help-panel');
    if (panel) {
      const isActive = panel.classList.toggle('active');
      // 如果打开面板，添加点击外部关闭的监听
      if (isActive) {
        setTimeout(() => {
          document.addEventListener('click', this.closeHelpOnClickOutside);
        }, 0);
      } else {
        document.removeEventListener('click', this.closeHelpOnClickOutside);
      }
    }
  },

  /**
   * 点击外部关闭帮助面板
   */
  closeHelpOnClickOutside(event) {
    const panel = document.getElementById('help-panel');
    const helpBtn = document.getElementById('help-btn');
    // 如果点击的不是面板内部也不是帮助按钮，关闭面板
    if (panel && !panel.contains(event.target) && event.target !== helpBtn) {
      panel.classList.remove('active');
      document.removeEventListener('click', window.app.closeHelpOnClickOutside);
    }
  },

  /**
   * 切换会话列表帮助面板
   */
  toggleSessionsHelpPanel(event) {
    if (event) event.stopPropagation();
    const panel = document.getElementById('sessions-help-panel');
    if (panel) {
      const isActive = panel.classList.toggle('active');
      if (isActive) {
        setTimeout(() => {
          document.addEventListener('click', this.closeSessionsHelpOnClickOutside);
        }, 0);
      } else {
        document.removeEventListener('click', this.closeSessionsHelpOnClickOutside);
      }
    }
  },

  /**
   * 关闭会话列表帮助面板
   */
  closeSessionsHelpPanel() {
    const panel = document.getElementById('sessions-help-panel');
    if (panel) {
      panel.classList.remove('active');
      document.removeEventListener('click', this.closeSessionsHelpOnClickOutside);
    }
  },

  /**
   * 点击外部关闭会话列表帮助面板
   */
  closeSessionsHelpOnClickOutside(event) {
    const panel = document.getElementById('sessions-help-panel');
    const helpBtn = document.getElementById('sessions-help-btn');
    if (panel && !panel.contains(event.target) && event.target !== helpBtn) {
      panel.classList.remove('active');
      document.removeEventListener('click', window.app.closeSessionsHelpOnClickOutside);
    }
  },

  /**
   * 切换用量抽屉
   */
  toggleUsageDrawer() {
    const drawer = document.getElementById('usage-drawer');
    const btn = document.getElementById('usage-toggle-btn');
    if (drawer && btn) {
      const isActive = drawer.classList.toggle('active');
      btn.classList.toggle('active', isActive);

      if (isActive) {
        // 抽屉打开：加载数据并设置定时轮询
        this.loadUsageSummary();
        this.usagePollingInterval = setInterval(() => {
          this.loadUsageSummary();
        }, 60000); // 1分钟
      } else {
        // 抽屉关闭：清除定时轮询
        if (this.usagePollingInterval) {
          clearInterval(this.usagePollingInterval);
          this.usagePollingInterval = null;
        }
      }
    }
  },

  /**
   * 切换更多按键面板显示
   */
  toggleMoreKeysPanel() {
    const panel = document.getElementById('more-keys-panel');
    const btn = document.getElementById('more-keys-btn');
    if (panel && btn) {
      const isActive = panel.classList.toggle('active');
      btn.classList.toggle('active', isActive);
    }
  },

  /**
   * 关闭更多按键面板
   */
  closeMoreKeysPanel() {
    const panel = document.getElementById('more-keys-panel');
    const btn = document.getElementById('more-keys-btn');
    if (panel) {
      panel.classList.remove('active');
    }
    if (btn) {
      btn.classList.remove('active');
    }
  },

  /**
   * 更新连接状态显示
   * @param {string} statusKey - 状态类型: 'connected', 'connecting', 'disconnected', 'error', 'timeout'
   * @param {string} detail - 详细信息
   */
  updateConnectStatus(statusKey, detail) {
    // 根据状态类型获取显示文本
    const statusTextMap = {
      'connected': this.t('status.connected'),
      'connecting': this.t('status.connecting'),
      'disconnected': this.t('status.disconnected'),
      'error': this.t('status.error'),
      'timeout': this.t('status.timeout'),
      'failed': this.t('status.failed')
    };
    const text = statusTextMap[statusKey] || statusKey;

    // 更新终端容器内的连接状态（连接中显示）
    const statusEl = document.getElementById('connect-status');
    if (statusEl) {
      const textEl = statusEl.querySelector('.connect-text');
      const detailEl = statusEl.querySelector('.connect-detail');
      if (textEl) textEl.textContent = text;
      if (detailEl) detailEl.textContent = detail || '';

      // 如果是超时或错误，显示重试按钮
      if (statusKey === 'timeout' || statusKey === 'error' || statusKey === 'failed') {
        let retryBtn = statusEl.querySelector('.retry-btn');
        if (!retryBtn) {
          retryBtn = document.createElement('button');
          retryBtn.className = 'retry-btn';
          retryBtn.textContent = this.t('status.clickRetry');
          retryBtn.style.cssText = 'margin-top:15px;padding:12px 30px;font-size:16px;background:#007aff;color:#fff;border:none;border-radius:8px;cursor:pointer;';
          retryBtn.onclick = () => {
            this.debugLog('user clicked retry');
            this.manualRetryConnect();
          };
          statusEl.appendChild(retryBtn);
        }
      }
    }

    // 更新工具栏的圆点和状态文字
    const dot = document.getElementById('connection-dot');
    const statusTextEl = document.getElementById('connection-status');

    if (dot && statusTextEl) {
      // 根据状态设置圆点样式
      dot.className = 'connection-dot';
      statusTextEl.className = 'connection-status';

      if (statusKey === 'connected') {
        dot.classList.add('connected');
        statusTextEl.textContent = ''; // 已连接时不显示文字
      } else if (statusKey === 'connecting') {
        dot.classList.add('connecting');
        statusTextEl.classList.add('connecting');
        statusTextEl.textContent = text;
      } else {
        dot.classList.add('disconnected');
        statusTextEl.classList.add('disconnected');
        statusTextEl.textContent = text;
      }
    }
  },

  /**
   * 更新连接状态
   */
  updateStatus(text, connected) {
    const status = document.getElementById('connection-status');
    status.textContent = text;
    status.className = 'connection-status ' + (connected ? 'connected' : 'disconnected');
  }
};

// 导出到全局
window.AppDialogs = AppDialogs;
