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
 * Socket.IO Connection Manager
 *
 * Drop-in replacement for MuxWebSocket with the same API.
 * Provides automatic fallback from WebSocket to HTTP Long Polling,
 * solving VPN/proxy connection issues.
 */
class SocketIOManager {
  constructor() {
    this.socket = null;
    this.authenticated = false;
    this.state = 'disconnected';

    // Same API as MuxWebSocket
    this.handlers = new Map();
    this.subscriptionData = new Map();
    this.pendingOperations = [];
    this.hasConnectedBefore = false;

    // State change callback
    this.onStateChange = null;
  }

  log(msg) {
    if (window.app?.debugLog) {
      window.app.debugLog('[SocketIO] ' + msg);
    } else {
      console.log('[SocketIO] ' + msg);
    }
  }

  connect() {
    if (this.socket?.connected) {
      this.log('Already connected');
      return;
    }

    // Clean up existing socket before creating new one to prevent duplicate event listeners
    if (this.socket) {
      this.log('Cleaning up existing socket before reconnect');
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    this._setState('connecting');
    this.log('Connecting...');

    // Connect to Socket.IO endpoint
    // WebSocket preferred, polling as fallback
    // Note: If using proxy/VPN that corrupts WebSocket, change to ['polling'] only
    this.socket = io({
      path: '/socket.io/',
      transports: ['websocket', 'polling'],  // WebSocket preferred for better performance
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });

    this.socket.on('connect', () => this._onConnect());
    this.socket.on('disconnect', (reason) => this._onDisconnect(reason));
    this.socket.on('connect_error', (error) => this._onError(error));

    // Auth responses
    this.socket.on('auth_success', () => this._onAuthSuccess());
    this.socket.on('auth_failed', (data) => this._onAuthFailed(data));

    // System events
    this.socket.on('system:pong', () => {});

    // Terminal events
    this.socket.on('terminal:connected', (data) => this._handleMessage('terminal', 'connected', data));
    this.socket.on('terminal:output', (data) => this._handleMessage('terminal', 'output', data));
    this.socket.on('terminal:error', (data) => this._handleMessage('terminal', 'error', data));
    this.socket.on('terminal:closed', (data) => this._handleMessage('terminal', 'closed', data));

    // Chat events
    const chatEvents = [
      'ready', 'stream', 'stream_end', 'assistant', 'user', 'tool_call', 'tool_result',
      'thinking_start', 'thinking_delta', 'thinking_end', 'thinking',
      'system', 'result', 'error', 'user_ack', 'history_end', 'history_page_end'
    ];
    chatEvents.forEach(type => {
      this.socket.on(`chat:${type}`, (data) => this._handleMessage('chat', type, data));
    });
  }

  disconnect() {
    this.log('Disconnecting...');
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.authenticated = false;
    this._setState('disconnected');
  }

  _setState(state) {
    const oldState = this.state;
    this.state = state;
    this.log(`State: ${oldState} -> ${state}`);
    if (this.onStateChange) {
      this.onStateChange(state, oldState);
    }
  }

  _onConnect() {
    this.log('Connected, authenticating...');
    this._setState('authenticating');

    const token = window.app?.authToken || localStorage.getItem('auth_token') || '';
    this.socket.emit('auth', { token });
  }

  _onAuthSuccess() {
    this.log('[DIAG] Authentication successful, setting state to connected');
    this.authenticated = true;
    this._setState('connected');

    const isReconnection = this.hasConnectedBefore;
    this.hasConnectedBefore = true;

    // Process pending operations and get keys that were processed
    const processedKeys = this._processPendingOperations();

    // Re-send subscriptions on reconnection, skipping already processed ones
    if (isReconnection) {
      this._resendSubscriptions(processedKeys);
    }

    // Trigger pending onConnect callbacks
    this._processPendingConnects();
  }

  _onAuthFailed(data) {
    this.log('Authentication failed: ' + (data?.reason || 'Unknown'));
    this.authenticated = false;
    this._setState('disconnected');
    this.socket.disconnect();
  }

  _onDisconnect(reason) {
    this.log(`Disconnected: ${reason}`);
    this._setState('disconnected');

    for (const handler of this.handlers.values()) {
      if (handler.onDisconnect) {
        handler.onDisconnect();
      }
    }
  }

  _onError(error) {
    this.log('Connection error: ' + error.message);
  }

  _handleMessage(channel, type, data) {
    const sessionId = data.session_id;
    const handlerKey = `${channel}:${sessionId}`;

    // Debug logging for stream events
    if (type === 'stream' || type === 'assistant' || type === 'result') {
      this.log(`[DIAG] _handleMessage: ${channel}:${type}, sessionId=${sessionId?.substring(0, 8)}, handlerKey=${handlerKey.substring(0, 15)}`);
    }

    // Handle session ID remapping (same logic as MuxWebSocket)
    let handler = this.handlers.get(handlerKey);

    if (!handler && (type === 'connected' || type === 'ready') && data.original_session_id) {
      const originalKey = `${channel}:${data.original_session_id}`;
      const originalHandler = this.handlers.get(originalKey);
      if (originalHandler) {
        this.log(`Remapping handler: ${originalKey.substring(0, channel.length + 9)} -> ${handlerKey.substring(0, channel.length + 9)}`);

        // Create a forwarding handler to handle delayed messages for the old session ID
        // Some messages may arrive with the old session ID after remapping (race condition)
        const forwardHandler = {
          channel: originalHandler.channel,
          sessionId: originalHandler.sessionId,
          originalSessionId: data.original_session_id,
          onMessage: (type, data) => {
            this.log(`Forwarding ${type} from ${originalKey} to ${handlerKey}`);
            if (originalHandler.onMessage) originalHandler.onMessage(type, data);
          },
          onConnect: originalHandler.onConnect,
          onDisconnect: originalHandler.onDisconnect
        };

        // Keep forwarding handler for 15 seconds to catch delayed messages
        this.handlers.set(originalKey, forwardHandler);
        setTimeout(() => {
          if (this.handlers.get(originalKey) === forwardHandler) {
            this.handlers.delete(originalKey);
            this.log(`Cleaned up forwarding handler for ${originalKey}`);
          }
        }, 15000);

        // Set up the new handler
        this.handlers.set(handlerKey, originalHandler);
        // Store original session ID for later lookup (in case frontend renames session again)
        originalHandler.originalSessionId = data.original_session_id;
        originalHandler.sessionId = sessionId;

        // Update subscription data
        const subData = this.subscriptionData.get(originalKey);
        if (subData) {
          this.subscriptionData.delete(originalKey);
          subData.sessionId = sessionId;
          this.subscriptionData.set(handlerKey, subData);
        }

        handler = originalHandler;
      }
    }

    if (handler) {
      if (type === 'connected' || type === 'ready') {
        this.log(`[DIAG] _handleMessage: ${channel}:${type}, triggering onConnect for ${handlerKey.substring(0, 15)}`);
        if (handler.onConnect) handler.onConnect(data);
      }
      if (handler.onMessage) handler.onMessage(type, data);
    } else {
      this.log(`[DIAG] No handler for ${handlerKey.substring(0, 20)}, type=${type}, handlers=${[...this.handlers.keys()].map(k => k.substring(0, 15)).join(',')}`);
    }
  }

  // ========== API Methods (same as MuxWebSocket) ==========

  subscribe(sessionId, channel, callbacks) {
    const key = `${channel}:${sessionId}`;
    this.log(`Subscribing to ${key.substring(0, channel.length + 9)}`);

    this.handlers.set(key, {
      channel,
      sessionId,
      onMessage: callbacks.onMessage || (() => {}),
      onConnect: callbacks.onConnect || (() => {}),
      onDisconnect: callbacks.onDisconnect || (() => {})
    });
  }

  unsubscribe(sessionId, channel) {
    const key = `${channel}:${sessionId}`;
    this.log(`Unsubscribing from ${key.substring(0, channel.length + 9)}`);
    this.handlers.delete(key);
    this.subscriptionData.delete(key);
  }

  send(channel, sessionId, type, data) {
    if (this.state !== 'connected') {
      this.log(`[DIAG] send QUEUED: ${channel}:${type} (state=${this.state}, pendingCount=${this.pendingOperations.length})`);
      this.pendingOperations.push({ channel, sessionId, type, data });
      this.connect();
      return;
    }

    const eventName = `${channel}:${type}`;
    const payload = { ...data, session_id: sessionId };
    this.log(`[DIAG] send EMIT: ${eventName} to ${sessionId?.substring(0, 8) || 'unknown'}, socket.connected=${this.socket?.connected}`);
    this.socket.emit(eventName, payload);
  }

  connectTerminal(sessionId, workingDir, options = {}) {
    const key = `terminal:${sessionId}`;

    if (this.handlers.has(key)) {
      this.log(`Terminal ${sessionId.substring(0, 8)} already connected, skip`);
      const handler = this.handlers.get(key);
      if (options.onMessage) handler.onMessage = options.onMessage;
      if (options.onConnect) handler.onConnect = options.onConnect;
      if (options.onDisconnect) handler.onDisconnect = options.onDisconnect;
      // Trigger onConnect immediately if already connected
      if (this.state === 'connected' && options.onConnect) {
        options.onConnect({ working_dir: workingDir });
      }
      return;
    }

    this.subscribe(sessionId, 'terminal', {
      onMessage: options.onMessage,
      onConnect: options.onConnect,
      onDisconnect: options.onDisconnect
    });

    const connectData = {
      working_dir: workingDir,
      rows: options.rows || 40,
      cols: options.cols || 120
    };
    this.subscriptionData.set(key, { channel: 'terminal', sessionId, data: connectData });

    this.send('terminal', sessionId, 'connect', connectData);
  }

  disconnectTerminal(sessionId) {
    this.send('terminal', sessionId, 'disconnect', {});
    this.unsubscribe(sessionId, 'terminal');
  }

  closeTerminal(sessionId) {
    this.send('terminal', sessionId, 'close', {});
    this.unsubscribe(sessionId, 'terminal');
  }

  terminalInput(sessionId, text) {
    this.send('terminal', sessionId, 'input', { text });
  }

  terminalResize(sessionId, rows, cols) {
    this.send('terminal', sessionId, 'resize', { rows, cols });
  }

  connectChat(sessionId, workingDir, options = {}) {
    const key = `chat:${sessionId}`;

    if (this.handlers.has(key)) {
      this.log(`Chat ${sessionId.substring(0, 8)} already connected, updating callbacks`);
      const handler = this.handlers.get(key);
      if (options.onMessage) handler.onMessage = options.onMessage;
      if (options.onConnect) handler.onConnect = options.onConnect;
      if (options.onDisconnect) handler.onDisconnect = options.onDisconnect;

      // Trigger onConnect immediately since we're already connected
      if (this.state === 'connected' || this.state === 'authenticating') {
        setTimeout(() => {
          if (options.onConnect) options.onConnect({ working_dir: workingDir, already_connected: true });
        }, 0);
      } else {
        // If not connected yet, mark handler as pending so onConnect
        // will be triggered when connection is established
        handler.pendingConnect = { working_dir: workingDir, already_connected: true };
        this.log(`Chat ${sessionId.substring(0, 8)} not yet connected (state=${this.state}), will trigger onConnect later`);
      }
      return;
    }

    this.subscribe(sessionId, 'chat', {
      onMessage: options.onMessage,
      onConnect: options.onConnect,
      onDisconnect: options.onDisconnect
    });

    const connectData = {
      working_dir: workingDir,
      resume: options.resume
    };
    this.subscriptionData.set(key, { channel: 'chat', sessionId, data: connectData });

    this.send('chat', sessionId, 'connect', connectData);
  }

  disconnectChat(sessionId) {
    this.send('chat', sessionId, 'disconnect', {});
    this.unsubscribe(sessionId, 'chat');
  }

  closeChat(sessionId) {
    this.send('chat', sessionId, 'close', {});
    this.unsubscribe(sessionId, 'chat');
  }

  chatMessage(sessionId, content) {
    // BUG FIX: Look up the handler and use originalSessionId for sending messages
    // The backend mapping uses (sid, originalSessionId) -> backendUUID
    // After ready event, handler.sessionId is updated to backendUUID, but we need
    // to send messages using originalSessionId (the mapping key)
    const key = `chat:${sessionId}`;
    let handler = this.handlers.get(key);

    // If not found directly, search for handler with this sessionId stored in it
    if (!handler) {
      for (const [k, h] of this.handlers) {
        if (k.startsWith('chat:') && (h.sessionId === sessionId || h.originalSessionId === sessionId)) {
          handler = h;
          this.log(`chatMessage: found handler via search for ${sessionId?.substring(0, 8)}`);
          break;
        }
      }
    }

    // Use originalSessionId for sending (this is the backend mapping key)
    // If not remapped yet, use the passed sessionId
    const actualSessionId = handler?.originalSessionId || sessionId;
    this.log(`[DIAG] chatMessage: sessionId=${sessionId?.substring(0, 8)}, actualSessionId=${actualSessionId?.substring(0, 8)}, handler=${handler ? 'found' : 'NULL'}, state=${this.state}`);
    this.send('chat', actualSessionId, 'message', { content });
  }

  loadMoreHistory(sessionId, offset, limit) {
    this.send('chat', sessionId, 'load_more_history', { offset, limit });
  }

  _processPendingOperations() {
    const processedKeys = new Set();

    if (this.pendingOperations.length === 0) return processedKeys;

    this.log(`Processing ${this.pendingOperations.length} pending operations`);
    const ops = [...this.pendingOperations];
    this.pendingOperations = [];

    for (const op of ops) {
      this.send(op.channel, op.sessionId, op.type, op.data);
      // Track connect messages to avoid duplicates in _resendSubscriptions
      if (op.type === 'connect' && op.channel && op.sessionId) {
        processedKeys.add(`${op.channel}:${op.sessionId}`);
      }
    }

    return processedKeys;
  }

  /**
   * Re-send connect messages for existing subscriptions after reconnection
   * @param {Set} skipKeys - Keys to skip (already processed via pendingOperations)
   */
  _resendSubscriptions(skipKeys = new Set()) {
    if (this.subscriptionData.size === 0) return;

    const toResend = [...this.subscriptionData].filter(([key]) => !skipKeys.has(key));
    if (toResend.length === 0) return;

    this.log(`Re-sending ${toResend.length} subscriptions after reconnect (skipped ${skipKeys.size})`);

    for (const [key, sub] of toResend) {
      this.log(`Re-subscribing to ${key.substring(0, sub.channel.length + 9)}`);
      this.send(sub.channel, sub.sessionId, 'connect', sub.data);
    }
  }

  /**
   * Process pending onConnect callbacks for handlers that were updated while disconnected
   * This fixes the bug where switching chat sessions while disconnected leaves isConnected=false
   */
  _processPendingConnects() {
    for (const [key, handler] of this.handlers) {
      if (handler.pendingConnect && handler.onConnect) {
        this.log(`Triggering pending onConnect for ${key}`);
        const pendingData = handler.pendingConnect;
        delete handler.pendingConnect;
        setTimeout(() => {
          handler.onConnect(pendingData);
        }, 0);
      }
    }
  }

  getStats() {
    return {
      state: this.state,
      authenticated: this.authenticated,
      sessions: this.handlers.size,
      transport: this.socket?.io?.engine?.transport?.name || 'unknown'
    };
  }
}

// Global singleton
window.socketIOManager = new SocketIOManager();
