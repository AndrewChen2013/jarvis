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
    this.debugLog('[showError] message=' + message + ', stack=' + new Error().stack);
    this.showAlert(message, { type: 'error' });
  },

  /**
   * 显示通用 Alert 弹窗（替代浏览器原生 alert）
   * @param {string} message - 消息内容
   * @param {Object} options - 配置选项
   * @param {string} options.type - 类型：'info', 'success', 'warning', 'error'
   * @param {string} options.title - 标题（可选）
   * @param {string} options.confirmText - 确认按钮文字
   * @returns {Promise} - 点击确认后 resolve
   */
  showAlert(message, options = {}) {
    const { type = 'info', title, confirmText } = options;

    const iconMap = {
      info: '○',
      success: '✓',
      warning: '!',
      error: '✗'
    };

    const titleMap = {
      info: this.t('dialog.info', 'Info'),
      success: this.t('dialog.success', 'Success'),
      warning: this.t('dialog.warning', 'Warning'),
      error: this.t('dialog.error', 'Error')
    };

    return new Promise((resolve) => {
      const dialog = document.createElement('div');
      dialog.className = 'custom-dialog-overlay';
      const formattedMessage = this.escapeHtml(message).replace(/\n/g, '<br>');

      dialog.innerHTML = `
        <div class="custom-dialog custom-dialog-${type}">
          <div class="custom-dialog-icon">${iconMap[type]}</div>
          <div class="custom-dialog-title">${this.escapeHtml(title || titleMap[type])}</div>
          <div class="custom-dialog-message">${formattedMessage}</div>
          <div class="custom-dialog-buttons">
            <button class="btn btn-primary">${confirmText || this.t('common.ok', 'OK')}</button>
          </div>
        </div>
      `;

      const closeDialog = () => {
        dialog.classList.add('closing');
        setTimeout(() => {
          if (dialog.parentNode) {
            document.body.removeChild(dialog);
          }
          resolve();
        }, 200);
      };

      dialog.querySelector('.btn-primary').addEventListener('click', closeDialog);
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog) closeDialog();
      });

      document.body.appendChild(dialog);
      // 触发动画
      requestAnimationFrame(() => dialog.classList.add('active'));
    });
  },

  /**
   * 显示通用 Confirm 弹窗（替代浏览器原生 confirm）
   * @param {string} message - 消息内容
   * @param {Object} options - 配置选项
   * @param {string} options.type - 类型：'info', 'warning', 'danger'
   * @param {string} options.title - 标题（可选）
   * @param {string} options.confirmText - 确认按钮文字
   * @param {string} options.cancelText - 取消按钮文字
   * @returns {Promise<boolean>} - 确认返回 true，取消返回 false
   */
  showConfirm(message, options = {}) {
    const { type = 'warning', title, confirmText, cancelText } = options;

    const iconMap = {
      info: '?',
      warning: '!',
      danger: '✗'
    };

    const titleMap = {
      info: this.t('dialog.confirm', 'Confirm'),
      warning: this.t('dialog.warning', 'Warning'),
      danger: this.t('dialog.danger', 'Danger')
    };

    return new Promise((resolve) => {
      const dialog = document.createElement('div');
      dialog.className = 'custom-dialog-overlay';
      const formattedMessage = this.escapeHtml(message).replace(/\n/g, '<br>');

      const confirmBtnClass = type === 'danger' ? 'btn-danger' : 'btn-primary';

      dialog.innerHTML = `
        <div class="custom-dialog custom-dialog-${type}">
          <div class="custom-dialog-icon">${iconMap[type]}</div>
          <div class="custom-dialog-title">${this.escapeHtml(title || titleMap[type])}</div>
          <div class="custom-dialog-message">${formattedMessage}</div>
          <div class="custom-dialog-buttons">
            <button class="btn btn-secondary btn-cancel">${cancelText || this.t('common.cancel', 'Cancel')}</button>
            <button class="btn ${confirmBtnClass} btn-confirm">${confirmText || this.t('common.confirm', 'Confirm')}</button>
          </div>
        </div>
      `;

      const closeDialog = (result) => {
        dialog.classList.add('closing');
        setTimeout(() => {
          if (dialog.parentNode) {
            document.body.removeChild(dialog);
          }
          resolve(result);
        }, 200);
      };

      dialog.querySelector('.btn-cancel').addEventListener('click', () => closeDialog(false));
      dialog.querySelector('.btn-confirm').addEventListener('click', () => closeDialog(true));
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog) closeDialog(false);
      });

      document.body.appendChild(dialog);
      // 触发动画
      requestAnimationFrame(() => dialog.classList.add('active'));
    });
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
   * 切换 Context 面板显示
   */
  toggleContextPanel() {
    const bar = document.getElementById('context-bar');
    const btn = document.getElementById('context-toggle');
    if (bar && btn) {
      const isCollapsed = bar.classList.toggle('collapsed');
      btn.classList.toggle('expanded', !isCollapsed);

      // 保存展开状态到当前 session
      const session = this.sessionManager?.getActive();
      if (session) {
        session.contextBarExpanded = !isCollapsed;
        this.debugLog(`toggleContextPanel: session=${session.id?.substring(0,8)}, expanded=${!isCollapsed}`);
      } else {
        this.debugLog('toggleContextPanel: no active session');
      }

      // 展开时加载数据
      if (!isCollapsed) {
        this.loadContextInfo();
      }
    }
  },

  /**
   * 恢复 Context Bar 的展开状态（切换 session 时调用）
   * @param {SessionInstance} session - 目标 session
   */
  restoreContextBarState(session) {
    const bar = document.getElementById('context-bar');
    const btn = document.getElementById('context-toggle');
    if (!bar || !btn) {
      this.debugLog('restoreContextBarState: bar or btn not found');
      return;
    }

    const isExpanded = session?.contextBarExpanded || false;
    this.debugLog(`restoreContextBarState: session=${session?.id?.substring(0,8)}, isExpanded=${isExpanded}`);

    if (isExpanded) {
      bar.classList.remove('collapsed');
      btn.classList.add('expanded');
    } else {
      bar.classList.add('collapsed');
      btn.classList.remove('expanded');
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
    if (status) {
      status.textContent = text;
      status.className = 'connection-status ' + (connected ? 'connected' : 'disconnected');
    }

    // 更新连接状态点
    const dot = document.getElementById('connection-dot');
    if (dot) {
      dot.className = 'connection-dot ' + (connected ? 'connected' : 'disconnected');
    }
  },

  /**
   * 刷新 Context 信息（点击时发送 /context 命令）
   */
  async refreshContextInfo() {
    // 发送 /context 命令到终端
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input', data: '/context' }));
      this.ws.send(JSON.stringify({ type: 'input', data: '\r' }));
    }

    // 延迟读取，等待命令输出保存
    setTimeout(() => this.loadContextInfo(), 2000);
  },

  /**
   * 渲染 Context Bar（纯渲染，不请求数据）
   * @param {object} data - context 数据
   */
  renderContextBar(data) {
    const ctxBar = document.getElementById('context-bar');
    if (!ctxBar || !data) return;

    // 计算显示值 - 参照 Claude /context 格式
    const usedK = Math.round((data.context_used || 0) / 1000);
    const maxK = Math.round((data.context_max || 200000) / 1000);
    const freeK = Math.round((data.context_free || 0) / 1000);
    const untilCompact = Math.round((data.context_until_compact || 0) / 1000);
    const percentage = data.context_percentage || 0;

    // 从 categories 提取详细信息
    const categories = data.context_categories || {};
    const sysPrompt = categories['System prompt'];
    const sysTools = categories['System tools'];
    const messages = categories['Messages'];
    const freeSpace = categories['Free space'];
    const autocompact = categories['Autocompact buffer'];

    // 第一行：主指标
    const line1 = `<div class="ctx-header">${usedK}k / ${maxK}k <span class="ctx-pct">(${percentage}%)</span></div>`;

    // 分隔线
    const divider = '<div class="ctx-divider"></div>';

    // 详细分类行
    let detailLines = '';

    // 如果有 categories 数据，显示详细信息
    if (sysPrompt || sysTools || messages) {
      if (sysPrompt) {
        detailLines += `<div class="ctx-row"><span class="ctx-icon">⛁</span><span class="ctx-label">Sys</span><span class="ctx-value">${(sysPrompt.tokens / 1000).toFixed(1)}k</span><span class="ctx-percent">${sysPrompt.percentage.toFixed(1)}%</span></div>`;
      }
      if (sysTools) {
        detailLines += `<div class="ctx-row"><span class="ctx-icon">⛁</span><span class="ctx-label">Tool</span><span class="ctx-value">${(sysTools.tokens / 1000).toFixed(1)}k</span><span class="ctx-percent">${sysTools.percentage.toFixed(1)}%</span></div>`;
      }
      if (messages) {
        detailLines += `<div class="ctx-row ctx-msg"><span class="ctx-icon">⛁</span><span class="ctx-label">Msg</span><span class="ctx-value">${(messages.tokens / 1000).toFixed(1)}k</span><span class="ctx-percent">${messages.percentage.toFixed(1)}%</span></div>`;
      }
      if (freeSpace) {
        detailLines += `<div class="ctx-row ctx-free-row"><span class="ctx-icon">⛶</span><span class="ctx-label">Free</span><span class="ctx-value">${(freeSpace.tokens / 1000).toFixed(0)}k</span><span class="ctx-percent">${freeSpace.percentage.toFixed(1)}%</span></div>`;
      }
      if (autocompact) {
        detailLines += `<div class="ctx-row ctx-compact-row"><span class="ctx-icon">⛝</span><span class="ctx-label">Comp</span><span class="ctx-value">${(autocompact.tokens / 1000).toFixed(0)}k</span><span class="ctx-percent">${autocompact.percentage.toFixed(1)}%</span></div>`;
      }
    } else {
      // Fallback：没有 categories 时用基础数据
      const freePct = maxK > 0 ? ((freeK / maxK) * 100).toFixed(1) : '0.0';
      const compactPct = maxK > 0 ? ((untilCompact / maxK) * 100).toFixed(1) : '0.0';
      detailLines += `<div class="ctx-row ctx-free-row"><span class="ctx-icon">⛶</span><span class="ctx-label">Free</span><span class="ctx-value">${freeK}k</span><span class="ctx-percent">${freePct}%</span></div>`;
      detailLines += `<div class="ctx-row ctx-compact-row"><span class="ctx-icon">⛝</span><span class="ctx-label">Comp</span><span class="ctx-value">${untilCompact > 0 ? untilCompact + 'k' : 'soon'}</span><span class="ctx-percent">${compactPct}%</span></div>`;
    }

    // Skills 显示
    const skills = data.context_skills || [];
    let skillsHtml = '';
    if (skills.length > 0) {
      skillsHtml = '<div class="ctx-divider"></div><div class="ctx-skills-title">Skills</div>';
      for (const skill of skills) {
        const tokenStr = skill.tokens >= 1000
          ? (skill.tokens / 1000).toFixed(1) + 'k'
          : skill.tokens.toString();
        skillsHtml += `<div class="ctx-skill-row"><span class="ctx-skill-icon">└</span><span class="ctx-skill-name">${skill.name}</span><span class="ctx-skill-tokens">${tokenStr}</span></div>`;
      }
    }

    ctxBar.innerHTML = `${line1}${divider}${detailLines}${skillsHtml}`;
  },

  /**
   * 加载 Context 信息
   * 使用当前 session 的 loadContext 方法加载并缓存数据
   */
  async loadContextInfo() {
    // 获取当前活跃的 session
    const session = this.sessionManager?.getActive();
    if (!session || !session.claudeSessionId) {
      return;
    }

    try {
      // 使用 session 的 loadContext 方法（会自动缓存）
      const data = await session.loadContext(this.token);
      if (data) {
        this.renderContextBar(data);
      }
    } catch (e) {
      console.error('Failed to load context info:', e);
    }
  }
};

// 导出到全局
window.AppDialogs = AppDialogs;
