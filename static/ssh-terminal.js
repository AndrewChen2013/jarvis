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
 * SSH Terminal Module
 * 使用 SSHSessionManager 管理多个 SSH 连接
 * 这个模块是兼容层，提供简化的 API
 */
const SSHTerminalModule = {
  // Session Manager 实例
  _manager: null,

  /**
   * 获取 Session Manager
   */
  get manager() {
    if (!this._manager && window.SSHSessionManager) {
      this._manager = new SSHSessionManager();
    }
    return this._manager;
  },

  /**
   * 获取当前机器（兼容旧代码）
   */
  get machine() {
    const session = this.manager?.getActive();
    return session?.machine || null;
  },

  /**
   * 获取 WebSocket（兼容旧代码）
   */
  get ws() {
    const session = this.manager?.getActive();
    return session?.ws || null;
  },

  /**
   * 获取终端（兼容旧代码）
   */
  get terminal() {
    const session = this.manager?.getActive();
    return session?.terminal || null;
  },

  /**
   * 初始化
   */
  init() {
    console.log('[SSHTerminal] init');

    // 绑定工具栏按钮事件
    this.bindToolbarEvents();

    // 绑定悬浮按钮事件
    this.bindFloatButtonEvents();
  },

  /**
   * 绑定工具栏按钮事件
   */
  bindToolbarEvents() {
    // 返回按钮
    const backBtn = document.getElementById('ssh-back-btn');
    if (backBtn && !backBtn._bound) {
      backBtn._bound = true;
      backBtn.addEventListener('click', () => {
        this.close();
      });
    }

    // 收起按钮
    const minimizeBtn = document.getElementById('ssh-minimize-btn');
    if (minimizeBtn && !minimizeBtn._bound) {
      minimizeBtn._bound = true;
      minimizeBtn.addEventListener('click', () => {
        this.manager?.minimizeCurrent();
      });
    }

    // Pin 按钮
    const pinBtn = document.getElementById('ssh-pin-btn');
    if (pinBtn && !pinBtn._bound) {
      pinBtn._bound = true;
      pinBtn.addEventListener('click', () => {
        this.manager?.pinCurrentSession();
      });
    }
  },

  /**
   * 绑定悬浮按钮事件
   */
  bindFloatButtonEvents() {
    // 字体调整
    const fontDecrease = document.getElementById('ssh-font-decrease');
    const fontIncrease = document.getElementById('ssh-font-increase');
    if (fontDecrease && !fontDecrease._bound) {
      fontDecrease._bound = true;
      fontDecrease.addEventListener('click', () => {
        this.manager?.changeFontSize(-1);
      });
    }
    if (fontIncrease && !fontIncrease._bound) {
      fontIncrease._bound = true;
      fontIncrease.addEventListener('click', () => {
        this.manager?.changeFontSize(1);
      });
    }

    // 主题切换按钮
    const themeToggle = document.getElementById('ssh-theme-toggle');
    if (themeToggle && !themeToggle._bound) {
      themeToggle._bound = true;
      themeToggle.addEventListener('click', () => {
        this.manager?.toggleTheme();
      });
    }
  },

  /**
   * 连接到远程机器
   * @param {Object} machine - 远程机器对象 {id, name, host, port, username}
   */
  connect(machine) {
    console.log(`[SSHTerminal] connect: ${machine.name}`);

    // 确保事件已绑定
    this.bindToolbarEvents();
    this.bindFloatButtonEvents();

    // 使用 manager 连接
    this.manager?.connect(machine);
  },

  /**
   * 显示 SSH 终端视图
   */
  showView() {
    this.manager?.showView();
  },

  /**
   * 隐藏 SSH 终端视图
   */
  hideView() {
    this.manager?.hideView();
  },

  /**
   * 关闭当前终端
   */
  close() {
    const activeId = this.manager?.activeId;
    if (activeId) {
      this.manager?.closeSession(activeId);
    }
    this.manager?.hideView();
  },

  /**
   * 关闭所有终端
   */
  closeAll() {
    this.manager?.closeAll();
  }
};

// 导出到全局
window.SSHTerminal = SSHTerminalModule;

// 页面加载后初始化
document.addEventListener('DOMContentLoaded', () => {
  // 延迟初始化，确保其他模块已加载
  setTimeout(() => {
    SSHTerminalModule.init();
  }, 100);
});
