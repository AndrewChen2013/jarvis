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
 * WebSocket Multiplexing Module
 *
 * Provides a single WebSocket connection that handles multiple Terminal and Chat
 * sessions through message routing.
 *
 * Message Format:
 *   {
 *     channel: "terminal" | "chat" | "system",
 *     session_id: "uuid",
 *     type: "message type",
 *     data: {...}
 *   }
 */

class MuxWebSocket {
  constructor() {
    this.ws = null;
    this.authenticated = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.pingInterval = null;
    this.connectionTimeout = null;

    // Session handlers: Map<sessionId, {channel, onMessage, onConnect, onDisconnect}>
    this.handlers = new Map();

    // Subscription data for reconnection: Map<sessionId, {channel, data}>
    this.subscriptionData = new Map();

    // Pending operations waiting for connection
    this.pendingOperations = [];

    // Connection state
    this.state = 'disconnected'; // disconnected, connecting, authenticating, connected

    // Callbacks
    this.onStateChange = null;
  }

  /**
   * Get debug logger from app
   */
  log(msg) {
    if (window.app?.debugLog) {
      window.app.debugLog('[MuxWS] ' + msg);
    } else {
      console.log('[MuxWS] ' + msg);
    }
  }

  /**
   * Connect to the multiplexed WebSocket endpoint
   */
  connect() {
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      this.log('Already connecting...');
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.log('Already connected');
      return;
    }

    this._setState('connecting');
    this.log('Connecting to /ws/mux...');

    // Build WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/mux`;

    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      // Connection timeout
      this.connectionTimeout = setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
          this.log('Connection timeout');
          this.ws.close();
        }
      }, 10000);

      this.ws.onopen = () => this._onOpen();
      this.ws.onmessage = (event) => this._onMessage(event);
      this.ws.onclose = (event) => this._onClose(event);
      this.ws.onerror = (error) => this._onError(error);

    } catch (error) {
      this.log('Failed to create WebSocket: ' + error);
      this._scheduleReconnect();
    }
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect() {
    this.log('Disconnecting...');
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent auto-reconnect

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this._setState('disconnected');
  }

  /**
   * Subscribe to a session
   * @param {string} sessionId - Session ID
   * @param {string} channel - "terminal" or "chat"
   * @param {object} callbacks - {onMessage, onConnect, onDisconnect}
   */
  subscribe(sessionId, channel, callbacks) {
    // Use compound key to allow same sessionId for different channels (chat/terminal)
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

  /**
   * Unsubscribe from a session
   * @param {string} sessionId - Session ID
   * @param {string} channel - "terminal" or "chat"
   */
  unsubscribe(sessionId, channel) {
    const key = `${channel}:${sessionId}`;
    this.log(`Unsubscribing from ${key.substring(0, channel.length + 9)}`);
    this.handlers.delete(key);
  }

  /**
   * Send a message through the multiplexed connection
   * @param {string} channel - "terminal", "chat", or "system"
   * @param {string} sessionId - Session ID (null for system messages)
   * @param {string} type - Message type
   * @param {object} data - Message data
   */
  send(channel, sessionId, type, data) {
    const message = {
      channel,
      session_id: sessionId,
      type,
      data: data || {}
    };

    if (this.state !== 'connected') {
      this.log(`Queuing message: ${channel}:${type} (state=${this.state})`);
      this.pendingOperations.push(message);
      this.connect();
      return;
    }

    this._sendRaw(message);
  }

  /**
   * Connect to a terminal session
   * @param {string} sessionId - Session ID
   * @param {string} workingDir - Working directory
   * @param {object} options - {rows, cols, onMessage, onConnect, onDisconnect}
   */
  connectTerminal(sessionId, workingDir, options = {}) {
    const key = `terminal:${sessionId}`;

    // Check if already connected to this terminal session
    if (this.handlers.has(key)) {
      this.log(`Terminal ${sessionId.substring(0, 8)} already connected, skip`);
      // Update callbacks if provided
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

    // Save subscription data for reconnection (use compound key)
    const connectData = {
      working_dir: workingDir,
      rows: options.rows || 40,
      cols: options.cols || 120
    };
    this.subscriptionData.set(key, { channel: 'terminal', sessionId, data: connectData });

    this.send('terminal', sessionId, 'connect', connectData);
  }

  /**
   * Disconnect from a terminal session (keep it running)
   * @param {string} sessionId - Session ID
   */
  disconnectTerminal(sessionId) {
    this.send('terminal', sessionId, 'disconnect', {});
    this.unsubscribe(sessionId, 'terminal');
    this.subscriptionData.delete(`terminal:${sessionId}`);
  }

  /**
   * Close a terminal session (stop it)
   * @param {string} sessionId - Session ID
   */
  closeTerminal(sessionId) {
    this.send('terminal', sessionId, 'close', {});
    this.unsubscribe(sessionId, 'terminal');
    this.subscriptionData.delete(`terminal:${sessionId}`);
  }

  /**
   * Send input to a terminal
   * @param {string} sessionId - Session ID
   * @param {string} text - Input text
   */
  terminalInput(sessionId, text) {
    this.send('terminal', sessionId, 'input', { text });
  }

  /**
   * Resize a terminal
   * @param {string} sessionId - Session ID
   * @param {number} rows - Row count
   * @param {number} cols - Column count
   */
  terminalResize(sessionId, rows, cols) {
    this.send('terminal', sessionId, 'resize', { rows, cols });
  }

  /**
   * Connect to a chat session
   * @param {string} sessionId - Session ID
   * @param {string} workingDir - Working directory
   * @param {object} options - {resume, onMessage, onConnect, onDisconnect}
   */
  connectChat(sessionId, workingDir, options = {}) {
    const key = `chat:${sessionId}`;

    // Check if already connected to this chat session
    if (this.handlers.has(key)) {
      this.log(`Chat ${sessionId.substring(0, 8)} already connected, skip`);
      // Update callbacks if provided
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

    this.subscribe(sessionId, 'chat', {
      onMessage: options.onMessage,
      onConnect: options.onConnect,
      onDisconnect: options.onDisconnect
    });

    // Save subscription data for reconnection (use compound key)
    const connectData = {
      working_dir: workingDir,
      resume: options.resume
    };
    this.subscriptionData.set(key, { channel: 'chat', sessionId, data: connectData });

    this.send('chat', sessionId, 'connect', connectData);
  }

  /**
   * Disconnect from a chat session
   * @param {string} sessionId - Session ID
   */
  disconnectChat(sessionId) {
    this.send('chat', sessionId, 'disconnect', {});
    this.unsubscribe(sessionId, 'chat');
    this.subscriptionData.delete(`chat:${sessionId}`);
  }

  /**
   * Close a chat session
   * @param {string} sessionId - Session ID
   */
  closeChat(sessionId) {
    this.send('chat', sessionId, 'close', {});
    this.unsubscribe(sessionId, 'chat');
    this.subscriptionData.delete(`chat:${sessionId}`);
  }

  /**
   * Send a chat message
   * @param {string} sessionId - Session ID
   * @param {string} content - Message content
   */
  chatMessage(sessionId, content) {
    this.send('chat', sessionId, 'message', { content });
  }

  // ============ Internal Methods ============

  _setState(state) {
    const oldState = this.state;
    this.state = state;
    this.log(`State: ${oldState} -> ${state}`);
    if (this.onStateChange) {
      this.onStateChange(state, oldState);
    }
  }

  _onOpen() {
    this.log('WebSocket connected');
    clearTimeout(this.connectionTimeout);
    this.reconnectAttempts = 0;

    this._setState('authenticating');

    // Authenticate
    const token = window.app?.authToken || localStorage.getItem('auth_token') || '';
    this._sendRaw({
      channel: 'system',
      type: 'auth',
      data: { token }
    });
  }

  _onMessage(event) {
    let message;

    try {
      if (event.data instanceof ArrayBuffer) {
        // MessagePack
        message = MessagePack.decode(new Uint8Array(event.data));
      } else {
        // JSON
        message = JSON.parse(event.data);
      }
    } catch (error) {
      this.log('Failed to parse message: ' + error);
      return;
    }

    const { channel, session_id, type, data } = message;

    // Handle system messages
    if (channel === 'system') {
      this._handleSystemMessage(type, data);
      return;
    }

    // Use compound key for handler lookup: channel:session_id
    const handlerKey = `${channel}:${session_id}`;

    // Debug: log incoming message for chat/terminal
    if (type === 'ready' || type === 'connected') {
      this.log(`Received ${type} for ${handlerKey}, original=${data?.original_session_id?.substring(0, 8)}`);
      this.log(`Registered handlers: ${Array.from(this.handlers.keys()).join(', ')}`);
    }

    // Look up handler by compound key
    let handler = this.handlers.get(handlerKey);

    // If no handler found, check if this is a 'connected' or 'ready' message with original_session_id
    // Terminal uses 'connected', Chat uses 'ready'
    if (!handler && (type === 'connected' || type === 'ready') && data.original_session_id) {
      const originalKey = `${channel}:${data.original_session_id}`;
      const originalHandler = this.handlers.get(originalKey);
      if (originalHandler) {
        // Re-map handler from original key to new key
        this.log(`Remapping handler: ${originalKey} -> ${handlerKey}`);
        this.handlers.delete(originalKey);
        this.handlers.set(handlerKey, originalHandler);
        // Update sessionId in handler
        originalHandler.sessionId = session_id;
        handler = originalHandler;

        // Also remap subscription data for reconnection
        const subData = this.subscriptionData.get(originalKey);
        if (subData) {
          this.subscriptionData.delete(originalKey);
          subData.sessionId = session_id;  // Update to new session ID
          this.subscriptionData.set(handlerKey, subData);
        }
      }
    }

    if (handler) {
      // Handle special types
      if (type === 'connected' || type === 'ready') {
        this.log(`Calling onConnect for ${handlerKey}`);
        handler.onConnect(data);
      } else if (type === 'error') {
        this.log(`Error in ${handlerKey}: ${data.message}`);
      }

      // Always call onMessage for all messages
      handler.onMessage(type, data);
    } else {
      this.log(`No handler for ${handlerKey}, type=${type}`);
    }
  }

  _handleSystemMessage(type, data) {
    if (type === 'auth_success') {
      this.log('Authentication successful');
      this.authenticated = true;
      this._setState('connected');

      // Start ping interval
      this._startPingInterval();

      // Process pending operations
      this._processPendingOperations();

      // Re-send connect messages for existing subscriptions (reconnection case)
      this._resendSubscriptions();

    } else if (type === 'auth_failed') {
      this.log('Authentication failed: ' + data.reason);
      this._setState('disconnected');
      this.ws.close();

    } else if (type === 'pong') {
      // Heartbeat response
    }
  }

  _onClose(event) {
    this.log(`WebSocket closed: code=${event.code}, reason=${event.reason}`);

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    this._setState('disconnected');

    // Notify all handlers
    for (const [key, handler] of this.handlers) {
      handler.onDisconnect();
    }

    // Auto-reconnect if not intentional
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this._scheduleReconnect();
    }
  }

  _onError(error) {
    this.log('WebSocket error: ' + error);
  }

  _sendRaw(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log('Cannot send: WebSocket not open');
      return false;
    }

    try {
      const packed = MessagePack.encode(message);
      this.ws.send(packed);
      return true;
    } catch (error) {
      this.log('Send error: ' + error);
      return false;
    }
  }

  _startPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      if (this.state === 'connected') {
        this._sendRaw({
          channel: 'system',
          type: 'ping',
          data: {}
        });
      }
    }, 30000); // Ping every 30 seconds
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.log('Max reconnect attempts reached');
      return;
    }

    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts);
    this.reconnectAttempts++;

    this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      if (this.state === 'disconnected') {
        this.connect();
      }
    }, delay);
  }

  _processPendingOperations() {
    if (this.pendingOperations.length === 0) return;

    this.log(`Processing ${this.pendingOperations.length} pending operations`);

    const ops = [...this.pendingOperations];
    this.pendingOperations = [];

    for (const message of ops) {
      this._sendRaw(message);
    }
  }

  /**
   * Re-send connect messages for existing subscriptions after reconnection
   */
  _resendSubscriptions() {
    if (this.subscriptionData.size === 0) return;

    this.log(`Re-sending ${this.subscriptionData.size} subscriptions after reconnect`);

    for (const [key, sub] of this.subscriptionData) {
      this.log(`Re-subscribing to ${key.substring(0, sub.channel.length + 9)}`);
      this._sendRaw({
        channel: sub.channel,
        session_id: sub.sessionId,
        type: 'connect',
        data: sub.data
      });
    }
  }

  /**
   * Get connection statistics
   */
  getStats() {
    return {
      state: this.state,
      authenticated: this.authenticated,
      sessions: this.handlers.size,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

// Global singleton
window.muxWs = new MuxWebSocket();
