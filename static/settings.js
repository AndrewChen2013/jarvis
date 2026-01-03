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
 * 设置模块
 * 提供设置弹窗、语言切换、用量显示等功能
 */
const AppSettings = {
  /**
   * 打开设置模态框
   */
  openSettingsModal() {
    document.getElementById('settings-modal').classList.add('active');
    // 清空表单
    document.getElementById('old-password').value = '';
    document.getElementById('new-password').value = '';
    document.getElementById('confirm-password').value = '';
    document.getElementById('password-error').textContent = '';
    // 显示主菜单
    this.showSettingsMenu();
    // 更新语言显示
    this.updateLangDisplay();
  },

  /**
   * 显示设置主菜单
   */
  showSettingsMenu() {
    // 隐藏所有子页面
    document.querySelectorAll('.settings-page').forEach(page => {
      page.classList.remove('active');
    });
    // 显示主菜单
    document.getElementById('settings-menu').style.display = 'flex';
    // 隐藏返回按钮
    document.getElementById('settings-back-btn').classList.add('hidden');
    // 更新标题
    document.getElementById('settings-modal-title').textContent = this.t('sessions.settings');
  },

  /**
   * 显示设置子页面
   */
  showSettingsPage(page) {
    // 隐藏主菜单
    document.getElementById('settings-menu').style.display = 'none';
    // 隐藏所有子页面
    document.querySelectorAll('.settings-page').forEach(p => {
      p.classList.remove('active');
    });
    // 显示目标页面
    const targetPage = document.getElementById(`settings-${page}`);
    if (targetPage) {
      targetPage.classList.add('active');
    }
    // 显示返回按钮
    document.getElementById('settings-back-btn').classList.remove('hidden');
    // 更新标题
    if (page === 'language') {
      document.getElementById('settings-modal-title').textContent = this.t('settings.language');
      this.renderLanguageList();
    } else if (page === 'password') {
      document.getElementById('settings-modal-title').textContent = this.t('settings.title');
    }
  },

  /**
   * 渲染语言列表
   */
  renderLanguageList() {
    const container = document.getElementById('settings-language');
    if (!container || !window.i18n) return;

    const currentLang = window.i18n.currentLang;
    const languages = window.i18n.languages;

    let html = '<div class="lang-list">';
    for (const [code, name] of Object.entries(languages)) {
      const isActive = code === currentLang;
      html += `
        <div class="lang-list-item" data-lang="${code}">
          <span>${name}</span>
          <span class="lang-check">${isActive ? '✓' : ''}</span>
        </div>
      `;
    }
    html += '</div>';

    container.innerHTML = html;

    // 绑定点击事件
    container.querySelectorAll('.lang-list-item').forEach(item => {
      item.addEventListener('click', () => {
        const lang = item.dataset.lang;
        this.switchLanguage(lang);
      });
    });
  },

  /**
   * 切换语言
   */
  switchLanguage(lang) {
    if (window.i18n) {
      window.i18n.setLanguage(lang);
      this.renderLanguageList();
      this.updateLangDisplay();
      // 重置调试面板以更新语言
      this.resetDebugPanel();
      // 刷新会话列表
      this.loadSessions();
    }
  },

  /**
   * 更新主菜单中的语言显示
   */
  updateLangDisplay() {
    const currentLang = window.i18n ? window.i18n.currentLang : 'zh';
    const display = document.getElementById('current-lang-display');
    if (display) {
      display.textContent = window.i18n.getLanguageName(currentLang);
    }
  },

  /**
   * 关闭设置模态框
   */
  closeSettingsModal() {
    document.getElementById('settings-modal').classList.remove('active');
  },

  /**
   * 打开传输模态框
   */
  openTransferModal() {
    document.getElementById('transfer-modal').classList.add('active');
  },

  /**
   * 关闭传输模态框
   */
  closeTransferModal() {
    document.getElementById('transfer-modal').classList.remove('active');
  },

  /**
   * 显示密码错误
   */
  showPasswordError(message) {
    const errorEl = document.getElementById('password-error');
    if (errorEl) {
      errorEl.textContent = message;
    }
  },

  /**
   * 处理修改密码
   */
  async handleChangePassword() {
    const oldPassword = document.getElementById('old-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    const submitBtn = document.getElementById('change-password-btn');

    // 前端验证
    if (!oldPassword || !newPassword || !confirmPassword) {
      this.showPasswordError(this.t('settings.fillAll'));
      return;
    }

    if (newPassword.length < 6) {
      this.showPasswordError(this.t('settings.minLength'));
      return;
    }

    if (newPassword !== confirmPassword) {
      this.showPasswordError(this.t('settings.notMatch'));
      return;
    }

    // 禁用按钮
    submitBtn.disabled = true;
    submitBtn.textContent = this.t('settings.updating');
    this.showPasswordError('');

    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword
        })
      });

      const data = await response.json();

      if (response.ok) {
        // 修改成功，清除本地 token，跳转登录
        this.closeSettingsModal();
        this.clearAuth();
        this.disconnect();
        this.showView('login');
        this.showLoginError(this.t('settings.passwordChanged'));
      } else {
        this.showPasswordError(data.detail || this.t('settings.changeFailed'));
      }
    } catch (error) {
      console.error('Change password error:', error);
      this.showPasswordError(this.t('login.networkError'));
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = this.t('settings.confirm');
    }
  },

  /**
   * 加载系统信息（IP 和主机名）
   */
  async loadSystemInfo() {
    try {
      const response = await fetch('/api/system/info', {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        const usernameEl = document.getElementById('system-username');
        const hostnameEl = document.getElementById('system-hostname');
        const ipEl = document.getElementById('system-ip');
        if (usernameEl) usernameEl.textContent = data.username || '--';
        if (hostnameEl) hostnameEl.textContent = data.hostname || '--';
        if (ipEl) ipEl.textContent = data.ip || '--';
        // 保存用户主目录用于路径简化
        this.homeDir = data.home_dir || '';
      }
    } catch (error) {
      console.error('Load system info error:', error);
    }
  },

  /**
   * 加载账户信息
   */
  async loadAccountInfo() {
    try {
      const response = await fetch('/api/account/info', {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.updateAccountDisplay(data);
      }
    } catch (error) {
      console.error('Load account info error:', error);
    }
  },

  /**
   * 加载用量摘要（使用新的实时 API）
   */
  async loadUsageSummary() {
    // 并行加载所有数据
    await Promise.all([
      this.loadProfile(),
      this.loadRealtimeUsage(),
      this.loadActiveConnections()
    ]);
  },

  /**
   * 加载用户资料
   */
  async loadProfile() {
    try {
      const response = await fetch('/api/profile', {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.updateProfileDisplay(data);
      }
    } catch (error) {
      console.error('Load profile error:', error);
    }
  },

  /**
   * 更新用户资料显示
   */
  updateProfileDisplay(data) {
    const nameEl = document.getElementById('profile-name');
    const planEl = document.getElementById('profile-plan');
    const emailEl = document.getElementById('profile-email');

    if (nameEl) {
      nameEl.textContent = data.user?.name || '--';
    }
    if (planEl) {
      planEl.textContent = data.plan_name || '--';
    }
    if (emailEl) {
      emailEl.textContent = data.user?.email || '--';
    }
  },

  /**
   * 加载实时用量
   */
  async loadRealtimeUsage() {
    try {
      const response = await fetch('/api/usage/realtime', {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.updateRealtimeUsageDisplay(data);
      }
    } catch (error) {
      console.error('Load realtime usage error:', error);
    }
  },

  /**
   * 更新实时用量显示
   */
  updateRealtimeUsageDisplay(data) {
    // 5小时周期
    if (data.five_hour) {
      this.updateUsageBar('5h', data.five_hour);
    }

    // 7天周期
    if (data.seven_day) {
      this.updateUsageBar('7d', data.seven_day);
    }

    // Sonnet 专用
    const sonnetSection = document.getElementById('usage-sonnet-section');
    if (data.seven_day_sonnet) {
      this.updateUsageBar('sonnet', data.seven_day_sonnet);
      if (sonnetSection) sonnetSection.style.display = 'block';
    } else {
      if (sonnetSection) sonnetSection.style.display = 'none';
    }
  },

  /**
   * 更新单个用量进度条
   */
  updateUsageBar(type, data) {
    const progressEl = document.getElementById(`usage-${type}-progress`);
    const percentEl = document.getElementById(`usage-${type}-percent`);
    const resetEl = document.getElementById(`usage-${type}-reset`);

    const percent = data.utilization || 0;

    if (progressEl) {
      progressEl.style.width = `${Math.min(percent, 100)}%`;
      // 颜色
      progressEl.classList.remove('warning', 'danger');
      if (percent >= 90) {
        progressEl.classList.add('danger');
      } else if (percent >= 70) {
        progressEl.classList.add('warning');
      }
    }

    if (percentEl) {
      percentEl.textContent = `${Math.round(percent)}%`;
      percentEl.classList.remove('warning', 'danger');
      if (percent >= 90) {
        percentEl.classList.add('danger');
      } else if (percent >= 70) {
        percentEl.classList.add('warning');
      }
    }

    if (resetEl && data.resets_at) {
      resetEl.textContent = this.formatResetTime(data.resets_at);
    }
  },

  /**
   * 格式化重置时间
   */
  formatResetTime(isoString) {
    try {
      const resetTime = new Date(isoString);
      const now = new Date();
      const diff = resetTime - now;

      if (diff <= 0) {
        return this.t('usage.periodReset') || '已重置';
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const resetIn = this.t('usage.resetIn') || '后重置';

      if (hours > 24) {
        const days = Math.floor(hours / 24);
        return `${days}${this.t('usage.days') || '天'} ${resetIn}`;
      }

      return `${hours}:${String(mins).padStart(2, '0')} ${resetIn}`;
    } catch (e) {
      return '--';
    }
  },

  /**
   * 加载活跃连接数
   */
  async loadActiveConnections() {
    try {
      const response = await fetch('/api/connections/count', {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        const connEl = document.getElementById('active-connections');
        const termEl = document.getElementById('active-terminals');

        if (connEl) {
          connEl.textContent = data.total_connections || 0;
        }
        if (termEl) {
          termEl.textContent = data.active_terminals || 0;
        }
      }
    } catch (error) {
      console.error('Load active connections error:', error);
    }
  },

  /**
   * 渲染用量图表
   */
  renderUsageChart(history) {
    const container = document.getElementById('usage-chart');
    if (!container || history.length === 0) {
      if (container) {
        container.innerHTML = '<div class="chart-loading">' + this.t('usage.noData', 'No data') + '</div>';
      }
      return;
    }

    // 找出最大值用于计算高度比例
    const maxValue = Math.max(...history.map(d => d.total_tokens), 1);
    const chartHeight = 60; // 柱状图最大高度

    // 今天的日期
    const today = new Date().toISOString().split('T')[0];

    container.innerHTML = history.map(day => {
      const height = Math.max((day.total_tokens / maxValue) * chartHeight, 2);
      const isToday = day.date === today;
      const dateLabel = day.date.slice(5); // MM-DD

      return `
        <div class="chart-bar-wrapper">
          <div class="chart-value">${this.formatTokens(day.total_tokens)}</div>
          <div class="chart-bar ${isToday ? 'today' : ''}" style="height: ${height}px"></div>
          <div class="chart-label">${dateLabel}</div>
        </div>
      `;
    }).join('');
  },

  /**
   * 启动周期倒计时
   */
  startCountdown(periodEnd) {
    // 清除之前的倒计时
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }

    const endTime = new Date(periodEnd);

    const updateCountdown = () => {
      // 每次都重新获取元素，确保能找到
      const countdownEl = document.getElementById('period-countdown');
      if (!countdownEl) return;

      const now = new Date();
      const diffMs = endTime - now;

      if (diffMs <= 0) {
        countdownEl.textContent = this.t('usage.periodReset');
        countdownEl.classList.remove('warning', 'danger');
        clearInterval(this.countdownInterval);
        // 5秒后刷新数据
        setTimeout(() => this.loadUsageSummary(), 5000);
        return;
      }

      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diffMs % (1000 * 60)) / 1000);

      countdownEl.textContent = `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')} ${this.t('usage.resetIn')}`;

      // 根据剩余时间设置颜色
      countdownEl.classList.remove('warning', 'danger');
      if (hours < 1) {
        countdownEl.classList.add('danger');
      } else if (hours < 2) {
        countdownEl.classList.add('warning');
      }
    };

    // 立即更新一次
    updateCountdown();
    // 每秒更新
    this.countdownInterval = setInterval(updateCountdown, 1000);
  },

};

// 导出到全局
window.AppSettings = AppSettings;
