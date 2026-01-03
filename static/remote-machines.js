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
 * 远程机器管理模块
 * 提供远程 SSH 机器的添加、编辑、删除、连接功能
 */
const RemoteMachines = {
  machines: [],
  editingMachineId: null,

  /**
   * 初始化模块
   */
  init() {
    this.bindEvents();
  },

  /**
   * 绑定事件
   */
  bindEvents() {
    // 添加远程机器按钮
    const addBtn = document.getElementById('add-remote-machine-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => this.openAddModal());
    }

    // 关闭模态框
    const closeBtn = document.getElementById('remote-machine-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeModal());
    }

    // 测试连接按钮
    const testBtn = document.getElementById('test-connection-btn');
    if (testBtn) {
      testBtn.addEventListener('click', () => this.testConnection());
    }

    // 保存按钮
    const saveBtn = document.getElementById('save-remote-machine-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveMachine());
    }

    // 点击模态框背景关闭
    const modal = document.getElementById('remote-machine-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.closeModal();
        }
      });
    }
  },

  /**
   * 加载远程机器列表
   */
  async loadMachines() {
    const container = document.getElementById('remote-machines-list');
    if (!container) return;

    container.innerHTML = `<div class="loading">${this.t('sessions.loading')}</div>`;

    try {
      const response = await fetch('/api/remote-machines', {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (response.status === 401) {
        this.handleUnauthorized();
        return;
      }

      if (!response.ok) throw new Error('Failed to load remote machines');

      this.machines = await response.json();

      if (this.machines.length === 0) {
        container.innerHTML = `
          <div class="no-sessions">
            <div>${this.t('remote.noMachines')}</div>
          </div>
        `;
        return;
      }

      this.renderMachineList(container);
    } catch (error) {
      console.error('Load remote machines error:', error);
      container.innerHTML = `<div class="no-sessions">${this.t('sessions.loadFailed')}</div>`;
    }
  },

  /**
   * 渲染机器列表
   */
  renderMachineList(container) {
    container.innerHTML = '';

    this.machines.forEach(machine => {
      const item = document.createElement('div');
      item.className = 'remote-machine-item';
      item.innerHTML = `
        <div class="machine-info" data-id="${machine.id}">
          <div class="machine-icon">>_</div>
          <div class="machine-details">
            <div class="machine-name">${this.escapeHtml(machine.name)}</div>
            <div class="machine-host">${this.escapeHtml(machine.username)}@${this.escapeHtml(machine.host)}:${machine.port}</div>
          </div>
        </div>
        <div class="machine-actions">
          <button class="action-btn edit-btn" onclick="RemoteMachines.openEditModal(${machine.id})" title="${this.t('remote.edit')}">✎</button>
          <button class="action-btn delete-btn" onclick="RemoteMachines.deleteMachine(${machine.id})" title="${this.t('remote.delete')}">✕</button>
        </div>
      `;

      // 点击卡片连接
      const infoDiv = item.querySelector('.machine-info');
      infoDiv.addEventListener('click', () => this.connectToMachine(machine));

      container.appendChild(item);
    });

    // 强制 reflow，解决离屏页面不渲染的问题
    container.offsetHeight;
  },

  /**
   * 打开添加模态框
   */
  openAddModal() {
    this.editingMachineId = null;
    this.clearForm();
    document.getElementById('remote-machine-modal-title').textContent = this.t('remote.addMachine');
    document.getElementById('remote-machine-modal').classList.add('active');
  },

  /**
   * 打开编辑模态框
   */
  async openEditModal(machineId) {
    this.editingMachineId = machineId;
    const machine = this.machines.find(m => m.id === machineId);
    if (!machine) return;

    document.getElementById('machine-name').value = machine.name;
    document.getElementById('machine-host').value = machine.host;
    document.getElementById('machine-port').value = machine.port;
    document.getElementById('machine-username').value = machine.username;
    document.getElementById('machine-password').value = ''; // 不显示旧密码
    document.getElementById('machine-password').placeholder = this.t('remote.passwordPlaceholder');

    document.getElementById('remote-machine-modal-title').textContent = this.t('remote.editMachine');
    document.getElementById('remote-machine-modal').classList.add('active');
  },

  /**
   * 关闭模态框
   */
  closeModal() {
    document.getElementById('remote-machine-modal').classList.remove('active');
    this.clearForm();
    this.editingMachineId = null;
  },

  /**
   * 清空表单
   */
  clearForm() {
    document.getElementById('machine-name').value = '';
    document.getElementById('machine-host').value = '';
    document.getElementById('machine-port').value = '22';
    document.getElementById('machine-username').value = '';
    document.getElementById('machine-password').value = '';
    document.getElementById('machine-password').placeholder = '';
    document.getElementById('test-connection-result').textContent = '';
    document.getElementById('test-connection-result').className = 'test-result';
  },

  /**
   * 测试连接
   */
  async testConnection() {
    const resultDiv = document.getElementById('test-connection-result');
    resultDiv.textContent = this.t('remote.testing');
    resultDiv.className = 'test-result testing';

    const data = this.getFormData();
    if (!data) {
      resultDiv.textContent = this.t('remote.fillRequired');
      resultDiv.className = 'test-result error';
      return;
    }

    try {
      const response = await fetch('/api/remote-machines/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify(data)
      });

      const result = await response.json();

      if (result.success) {
        resultDiv.textContent = this.t('remote.testSuccess');
        resultDiv.className = 'test-result success';
      } else {
        resultDiv.textContent = `${this.t('remote.testFailed')}: ${result.message}`;
        resultDiv.className = 'test-result error';
      }
    } catch (error) {
      console.error('Test connection error:', error);
      resultDiv.textContent = this.t('remote.testFailed');
      resultDiv.className = 'test-result error';
    }
  },

  /**
   * 保存机器
   */
  async saveMachine() {
    const data = this.getFormData();
    if (!data) {
      window.app.showAlert(this.t('remote.fillRequired'), { type: 'warning' });
      return;
    }

    // 编辑模式下，如果密码为空则不更新密码
    if (this.editingMachineId && !data.password) {
      delete data.password;
    }

    try {
      const url = this.editingMachineId
        ? `/api/remote-machines/${this.editingMachineId}`
        : '/api/remote-machines';
      const method = this.editingMachineId ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) throw new Error('Save failed');

      this.closeModal();
      await this.loadMachines();
    } catch (error) {
      console.error('Save machine error:', error);
      window.app.showAlert(this.t('remote.saveFailed'), { type: 'error' });
    }
  },

  /**
   * 删除机器
   */
  async deleteMachine(machineId) {
    const machine = this.machines.find(m => m.id === machineId);
    if (!machine) return;

    const confirmed = await window.app.showConfirm(`${this.t('remote.confirmDelete')} "${machine.name}"?`, {
      type: 'danger',
      title: this.t('dialog.delete', 'Delete'),
      confirmText: this.t('common.delete', 'Delete')
    });
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/remote-machines/${machineId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (!response.ok) throw new Error('Delete failed');

      await this.loadMachines();
    } catch (error) {
      console.error('Delete machine error:', error);
      window.app.showAlert(this.t('remote.deleteFailed'), { type: 'error' });
    }
  },

  /**
   * 连接到远程机器
   */
  connectToMachine(machine) {
    // 调用独立的 SSH 终端模块
    if (window.SSHTerminal && typeof window.SSHTerminal.connect === 'function') {
      window.SSHTerminal.connect(machine);
    } else {
      console.error('SSHTerminal module not found');
    }
  },

  /**
   * 获取表单数据
   */
  getFormData() {
    const name = document.getElementById('machine-name').value.trim();
    const host = document.getElementById('machine-host').value.trim();
    const port = parseInt(document.getElementById('machine-port').value) || 22;
    const username = document.getElementById('machine-username').value.trim();
    const password = document.getElementById('machine-password').value;

    // 验证必填字段
    if (!name || !host || !username) {
      return null;
    }

    // 新增时密码必填
    if (!this.editingMachineId && !password) {
      return null;
    }

    return { name, host, port, username, password };
  },

  /**
   * HTML 转义
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * 国际化翻译
   */
  t(key) {
    if (window.i18n && typeof i18n.t === 'function') {
      return i18n.t(key);
    }
    // 默认英文
    const defaults = {
      'sessions.loading': 'Loading...',
      'sessions.loadFailed': 'Load failed',
      'remote.noMachines': 'No remote machines configured',
      'remote.addMachine': 'Add Remote Machine',
      'remote.editMachine': 'Edit Remote Machine',
      'remote.edit': 'Edit',
      'remote.delete': 'Delete',
      'remote.testing': 'Testing connection...',
      'remote.testSuccess': 'Connection successful!',
      'remote.testFailed': 'Connection failed',
      'remote.fillRequired': 'Please fill in all required fields',
      'remote.saveFailed': 'Save failed',
      'remote.deleteFailed': 'Delete failed',
      'remote.confirmDelete': 'Are you sure you want to delete',
      'remote.passwordPlaceholder': 'Leave empty to keep current password'
    };
    return defaults[key] || key;
  },

  /**
   * 处理未授权
   */
  handleUnauthorized() {
    if (window.app && typeof window.app.handleUnauthorized === 'function') {
      window.app.handleUnauthorized();
    }
  },

  /**
   * 获取 token
   */
  get token() {
    if (window.app && window.app.token) {
      return window.app.token;
    }
    return localStorage.getItem('token') || '';
  }
};

// 导出到全局
window.RemoteMachines = RemoteMachines;
