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
 * Session Manager - 多 Session 管理
 * 支持同时打开多个 session，在后台保持连接
 */

/**
 * Session 实例
 *
 * ID 说明：
 * - this.id: SessionManager 中的唯一键，用于前端会话管理
 *   - 新建时为临时 ID（如 "new-1234567890"）
 *   - 连接成功后服务端会返回 UUID，前端会通过 renameSession 更新为 UUID
 *   - 更新后 this.id === this.claudeSessionId
 *
 * - this.claudeSessionId: 服务端的 Claude session UUID
 *   - 连接前为 null
 *   - 连接后由服务端分配
 *   - 用于 API 调用（如获取 context）和 Chat 模式的 --resume
 */
class SessionInstance {
  constructor(sessionId, name) {
    this.id = sessionId;
    this.name = name;
    // WebSocket 由 MuxWebSocket 统一管理，不再存储在 session 中
    this.terminal = null;
    this.container = null;
    this.status = 'idle'; // idle | connecting | connected | disconnected
    this.lastActive = Date.now();

    // 连接参数（每个 session 独立）
    this.workDir = null;
    // 服务端 Claude session UUID，连接成功后由服务端分配
    // rename 后 this.id === this.claudeSessionId
    this.claudeSessionId = null;

    // 重连状态（每个 session 独立）
    this.shouldReconnect = false;
    this.reconnectAttempts = 0;
    this.reconnectTimeout = null;

    // Context 数据缓存（每个 session 独立）
    this.contextData = null;
    this.contextLastUpdate = 0;

    // Context bar 展开状态（每个 session 独立）
    this.contextBarExpanded = false;

    // 字体大小（每个 session 独立，null 表示使用默认值）
    this.fontSize = null;

    // 主题（每个 session 独立，null 表示使用默认值）
    this.theme = null;

    // 输入框内容（每个 session 独立）
    this.inputValue = '';

    // Git 分支信息（每个 session 独立）
    this.gitBranch = null;

    // 视图模式（每个 session 独立，默认 chat）
    this.viewMode = 'chat';
  }

  /**
   * 更新最后活跃时间
   */
  touch() {
    this.lastActive = Date.now();
  }

  /**
   * 加载 context 数据并缓存
   * @param {string} token - 认证 token
   * @returns {Promise<object|null>} context 数据
   */
  async loadContext(token) {
    if (!this.claudeSessionId) return null;

    try {
      const response = await fetch(`/api/projects/session/${this.claudeSessionId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        this.contextData = await response.json();
        this.contextLastUpdate = Date.now();
        return this.contextData;
      }
    } catch (e) {
      console.error('Failed to load context:', e);
    }
    return null;
  }

  /**
   * 获取缓存的 context 数据
   * @returns {object|null}
   */
  getCachedContext() {
    return this.contextData;
  }

  /**
   * 检查 context 缓存是否过期（超过 30 秒）
   * @returns {boolean}
   */
  isContextStale() {
    return Date.now() - this.contextLastUpdate > 30000;
  }
}

class SessionManager {
  constructor(app) {
    this.app = app;
    this.sessions = new Map(); // sessionId -> SessionInstance
    this.activeId = null;
    this.previousId = null; // 上一个活跃的 session，用于快速切换
  }

  /**
   * 调试日志
   */
  log(msg) {
    if (this.app && this.app.debugLog) {
      this.app.debugLog('[SessionMgr] ' + msg);
    } else {
      console.log('[SessionMgr] ' + msg);
    }
  }

  /**
   * 获取当前活跃的 session
   */
  getActive() {
    return this.activeId ? this.sessions.get(this.activeId) : null;
  }

  /**
   * 获取当前活跃 session 的 workDir
   */
  getActiveWorkDir() {
    return this.getActive()?.workDir || null;
  }

  /**
   * 获取当前活跃 session 的 claudeSessionId
   */
  getActiveClaudeSessionId() {
    return this.getActive()?.claudeSessionId || null;
  }

  /**
   * 获取当前活跃 session 的 terminal
   */
  getActiveTerminal() {
    return this.getActive()?.terminal || null;
  }

  /**
   * 更新当前活跃 session 的状态
   * @param {string} status - 新状态
   */
  updateActiveStatus(status) {
    const session = this.getActive();
    if (session) {
      session.status = status;
      this.log(`updateActiveStatus: ${session.id.substring(0, 8)} -> ${status}`);
    }
  }

  /**
   * 获取所有后台 session（不包括当前活跃的）
   */
  getBackgroundSessions() {
    const result = [];
    for (const [id, session] of this.sessions) {
      if (id !== this.activeId) {
        result.push(session);
      }
    }
    // 按最后活跃时间排序，最近的在前
    return result.sort((a, b) => b.lastActive - a.lastActive);
  }

  /**
   * 获取后台 session 数量
   */
  getBackgroundCount() {
    return this.sessions.size - (this.activeId ? 1 : 0);
  }

  /**
   * 获取所有 session
   */
  getAllSessions() {
    return Array.from(this.sessions.values());
  }

  /**
   * 检查 session 是否已打开
   */
  isSessionOpen(sessionId) {
    return this.sessions.has(sessionId);
  }

  /**
   * 重命名 session（用于同步前后端 ID）
   * @param {string} oldId - 旧 ID
   * @param {string} newId - 新 ID
   * @returns {boolean} - 是否成功
   */
  renameSession(oldId, newId) {
    if (oldId === newId) {
      return true; // 无需重命名
    }

    const session = this.sessions.get(oldId);
    if (!session) {
      this.log(`renameSession: session ${oldId} not found`);
      return false;
    }

    if (this.sessions.has(newId)) {
      this.log(`renameSession: target ${newId} already exists`);
      return false;
    }

    this.log(`renameSession: ${oldId.substring(0, 8)} -> ${newId.substring(0, 8)}`);

    // 更新 session 实例的 id
    session.id = newId;

    // 更新容器 ID
    if (session.container) {
      session.container.id = `terminal-container-${newId}`;
    }

    // 在 Map 中重新注册
    this.sessions.delete(oldId);
    this.sessions.set(newId, session);

    // 更新 activeId 和 previousId
    if (this.activeId === oldId) {
      this.activeId = newId;
    }
    if (this.previousId === oldId) {
      this.previousId = newId;
    }

    this.log(`renameSession: done, sessions.size=${this.sessions.size}`);
    return true;
  }

  /**
   * 打开或切换到 session
   * @param {string} sessionId
   * @param {string} name
   * @returns {SessionInstance}
   */
  openSession(sessionId, name) {
    this.log(`openSession: ${sessionId}, name=${name}`);
    let session = this.sessions.get(sessionId);

    if (session) {
      // 已存在，切换到它
      this.log(`openSession: exists, switch`);
      this.switchTo(sessionId);
    } else {
      // 新建 session 实例
      this.log(`openSession: new instance`);
      session = new SessionInstance(sessionId, name);
      this.sessions.set(sessionId, session);
      this.switchTo(sessionId);
    }

    this.log(`openSession: sessions.size=${this.sessions.size}`);
    return session;
  }

  /**
   * 切换到指定 session
   */
  switchTo(sessionId) {
    this.log(`switchTo: ${sessionId}, activeId=${this.activeId}`);
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.log(`switchTo: session not found!`);
      return;
    }

    // 保存当前 session 的输入框内容
    const inputField = document.querySelector('.input-field');
    if (this.activeId && this.activeId !== sessionId) {
      const currentSession = this.sessions.get(this.activeId);
      if (currentSession && inputField) {
        currentSession.inputValue = inputField.value;
        this.log(`switchTo: saved input for ${this.activeId.substring(0, 8)}: "${currentSession.inputValue.substring(0, 20)}..."`);
      }
      this.previousId = this.activeId;
    }

    // 隐藏所有 session 的 container（包括没有 container 的也记录下来）
    for (const [id, s] of this.sessions) {
      if (id !== sessionId) {
        if (s.container) {
          this.log(`switchTo: hide ${id.substring(0, 8)}, container=${s.container.id}`);
          s.container.style.display = 'none';
        } else {
          this.log(`switchTo: ${id.substring(0, 8)} has no container`);
        }
      }
    }

    // 切换到新 session
    this.activeId = sessionId;
    session.touch();

    // 检查目标 session 的 container 状态
    this.log(`switchTo: target session ${sessionId.substring(0, 8)}, container=${session.container ? session.container.id : 'NULL'}, terminal=${session.terminal ? 'exists' : 'NULL'}`);

    // 显示目标 session
    this.showSession(session);

    // 恢复目标 session 的输入框内容
    if (inputField && session.inputValue !== undefined) {
      inputField.value = session.inputValue;
      // 触发 input 事件以调整高度
      inputField.dispatchEvent(new Event('input'));
      this.log(`switchTo: restored input for ${sessionId.substring(0, 8)}: "${session.inputValue.substring(0, 20)}..."`);
    }

    // 更新悬浮按钮
    if (this.app.floatingButton) {
      this.app.floatingButton.update();
    }

    // 更新终端标题
    const titleEl = document.getElementById('terminal-title');
    if (titleEl && session.name) {
      titleEl.textContent = session.name;
    }

    // 显示 git 分支信息（从 session 缓存读取）
    const branchEl = document.getElementById('git-branch');
    if (branchEl) {
      branchEl.textContent = session.gitBranch || '';
    }

    // 恢复 context bar 状态
    if (this.app.restoreContextBarState) {
      this.app.restoreContextBarState(session);
    }

    this.log(`switchTo: done`);
  }

  /**
   * 快速切换到上一个 session
   */
  switchToPrevious() {
    if (this.previousId && this.sessions.has(this.previousId)) {
      this.switchTo(this.previousId);
      return true;
    }

    // 没有上一个，切换到最近活跃的后台 session
    const backgrounds = this.getBackgroundSessions();
    if (backgrounds.length > 0) {
      this.switchTo(backgrounds[0].id);
      return true;
    }

    return false;
  }

  /**
   * 收起当前 session（放入后台）
   */
  minimizeCurrent() {
    this.log(`minimizeCurrent: activeId=${this.activeId}`);
    if (!this.activeId) {
      this.log('minimizeCurrent: no active session');
      return;
    }

    const session = this.sessions.get(this.activeId);
    if (session) {
      // 保存输入框内容
      const inputField = document.querySelector('.input-field');
      if (inputField) {
        session.inputValue = inputField.value;
        this.log(`minimizeCurrent: saved input for ${session.id.substring(0, 8)}: "${session.inputValue.substring(0, 20)}..."`);
      }
      this.log(`minimizeCurrent: hide session ${session.id}`);
      this.hideSession(session);
    }

    // 记录为上一个
    this.previousId = this.activeId;
    this.activeId = null;
    this.log(`minimizeCurrent: previousId=${this.previousId}, activeId=null`);

    // 更新悬浮按钮
    if (this.app.floatingButton) {
      this.app.floatingButton.update();
    }

    // 返回 session 列表
    this.log('minimizeCurrent: switch to sessions view');
    this.app.showView('sessions');
  }

  /**
   * 关闭指定 session
   */
  closeSession(sessionId) {
    this.log(`closeSession: ${sessionId}`);
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.log('closeSession: session not found');
      return;
    }

    // 通过 MuxWebSocket 断开连接
    if (window.muxWs) {
      this.log('closeSession: disconnect via MuxWebSocket');
      window.muxWs.closeTerminal(sessionId);
      window.muxWs.closeChat(sessionId);
    }

    // 销毁终端
    if (session.terminal) {
      this.log('closeSession: destroy terminal');
      session.terminal.dispose();
      session.terminal = null;
    }

    // 移除容器
    if (session.container) {
      this.log('closeSession: remove container');
      session.container.remove();
      session.container = null;
    }

    // 从 Map 中移除
    this.sessions.delete(sessionId);
    this.log(`closeSession: sessions.size=${this.sessions.size}`);

    // 如果关闭的是当前活跃的
    if (this.activeId === sessionId) {
      this.activeId = null;
      this.log('closeSession: clear activeId');
    }

    // 如果关闭的是上一个
    if (this.previousId === sessionId) {
      this.previousId = null;
      this.log('closeSession: clear previousId');
    }

    // 更新悬浮按钮
    if (this.app.floatingButton) {
      this.app.floatingButton.update();
    }
  }

  /**
   * 关闭所有 session
   */
  closeAll() {
    for (const sessionId of this.sessions.keys()) {
      this.closeSession(sessionId);
    }
  }

  /**
   * 显示 session（切换到前台）
   */
  showSession(session) {
    const expectedContainerId = `terminal-container-${session.id}`;
    this.log(`showSession: ${session.id.substring(0, 8)}, expectedId=${expectedContainerId}`);
    this.log(`showSession: session.container=${session.container ? session.container.id : 'NULL'}, session.terminal=${session.terminal ? 'exists' : 'NULL'}`);

    const terminalOutput = document.getElementById('terminal-output');
    if (!terminalOutput) {
      this.log(`showSession: ERROR - terminalOutput not found!`);
      return;
    }

    // 通过 ID 查找正确的容器（不依赖可能过期的 session.container 引用）
    let targetContainer = document.getElementById(expectedContainerId);
    this.log(`showSession: targetContainer by ID = ${targetContainer ? 'found' : 'NOT FOUND'}`);

    // 如果 session.container 引用过期（不在 DOM 中或 ID 不匹配），更新它
    if (session.container) {
      const inDOM = document.body.contains(session.container);
      const idMatch = session.container.id === expectedContainerId;
      this.log(`showSession: session.container check - inDOM=${inDOM}, idMatch=${idMatch}`);
      if (!inDOM || !idMatch) {
        this.log(`showSession: session.container is STALE, will use targetContainer`);
        session.container = targetContainer;
      }
    } else if (targetContainer) {
      this.log(`showSession: session.container was NULL, set to targetContainer`);
      session.container = targetContainer;
    }

    // 验证 terminal 是否真的在 container 里（防止 Connected 但不渲染）
    if (session.terminal && session.container) {
      const xtermElement = session.container.querySelector('.xterm');
      if (!xtermElement) {
        this.log(`showSession: WARNING - terminal exists but xterm element NOT in container! Clearing terminal reference.`);
        // terminal 存在但 DOM 不在 container 里，标记为无效
        // 下次 initTerminal 会重新创建
        try {
          session.terminal.dispose();
        } catch (e) {
          this.log(`showSession: dispose error: ${e.message}`);
        }
        session.terminal = null;
      } else {
        this.log(`showSession: terminal xterm element found in container`);
      }
    }

    // 如果没有 container，创建一个
    if (!session.container) {
      this.log(`showSession: creating new container`);
      targetContainer = this.createContainer(session);
    }

    // 隐藏所有 container，然后只显示目标 container
    const allContainers = terminalOutput.querySelectorAll('.terminal-session-container');
    this.log(`showSession: found ${allContainers.length} containers in DOM`);

    allContainers.forEach(container => {
      if (container.id === expectedContainerId) {
        container.style.display = 'block';
        this.log(`showSession: SHOW ${container.id}`);
      } else {
        container.style.display = 'none';
        this.log(`showSession: HIDE ${container.id}`);
      }
    });

    // 最终确认
    if (session.container) {
      session.container.style.display = 'block';
      this.log(`showSession: final confirm - ${session.container.id} is visible`);
    } else {
      this.log(`showSession: WARNING - no container available!`);
    }

    // 恢复该 session 的字体大小
    if (session.fontSize && session.terminal) {
      this.log(`showSession: restoring fontSize ${session.fontSize}`);
      session.terminal.setFontSize(session.fontSize);
    }

    // 恢复该 session 的主题
    if (session.theme && session.terminal) {
      this.log(`showSession: restoring theme ${session.theme}`);
      session.terminal.setTheme(session.theme);
      // 更新主题按钮
      if (this.app && this.app.updateThemeButton) {
        this.app.updateThemeButton(session.theme);
      }
    }
  }

  /**
   * 隐藏 session（放入后台）
   */
  hideSession(session) {
    this.log(`hideSession: ${session.id}, container=${session.container ? session.container.id : 'null'}`);
    if (session.container) {
      session.container.style.display = 'none';
      this.log(`hideSession: set display=none`);
    }
  }

  /**
   * 为 session 创建终端容器
   */
  createContainer(session) {
    this.log(`createContainer: ${session.id}`);
    const container = document.createElement('div');
    container.id = `terminal-container-${session.id}`;
    container.className = 'terminal-session-container';
    container.style.display = 'none';

    const terminalOutput = document.getElementById('terminal-output');
    this.log(`createContainer: terminalOutput=${terminalOutput ? 'exists' : 'null'}`);
    if (terminalOutput) {
      terminalOutput.appendChild(container);
      this.log(`createContainer: added to terminalOutput`);
    } else {
      this.log(`createContainer: terminalOutput not found!`);
    }

    session.container = container;
    return container;
  }

  /**
   * 获取或创建 session 的容器
   */
  getOrCreateContainer(session) {
    this.log(`getOrCreateContainer: ${session.id}, hasContainer=${!!session.container}`);
    if (!session.container) {
      this.createContainer(session);
    }
    return session.container;
  }
}

// 导出
window.SessionManager = SessionManager;
window.SessionInstance = SessionInstance;
