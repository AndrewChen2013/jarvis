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
 * Optimized Message Format (v2):
 *   {
 *     c: 0|1|2,      // channel: 0=terminal, 1=chat, 2=system
 *     s: "uuid",     // session_id (omitted for system)
 *     t: 0-15,       // type code
 *     d: {...}       // data
 *   }
 */

// ============================================================================
// Optimized Message Protocol Constants (v2) - Must match backend
// ============================================================================

// Channel codes
const CH_TERMINAL = 0;
const CH_CHAT = 1;
const CH_SYSTEM = 2;

const CHANNEL_CODES = {
  terminal: CH_TERMINAL,
  chat: CH_CHAT,
  system: CH_SYSTEM
};

const CODE_TO_CHANNEL = {
  [CH_TERMINAL]: 'terminal',
  [CH_CHAT]: 'chat',
  [CH_SYSTEM]: 'system'
};

// Message type codes - Terminal (0-9)
const MT_TERM_CONNECTED = 0;
const MT_TERM_OUTPUT = 1;
const MT_TERM_ERROR = 2;
const MT_TERM_CLOSED = 3;

// Message type codes - Chat (0-19)
const MT_CHAT_READY = 0;
const MT_CHAT_STREAM = 1;
const MT_CHAT_ASSISTANT = 2;
const MT_CHAT_USER = 3;
const MT_CHAT_TOOL_CALL = 4;
const MT_CHAT_TOOL_RESULT = 5;
const MT_CHAT_THINKING_START = 6;
const MT_CHAT_THINKING_DELTA = 7;
const MT_CHAT_THINKING_END = 8;
const MT_CHAT_THINKING = 9;
const MT_CHAT_SYSTEM = 10;
const MT_CHAT_RESULT = 11;
const MT_CHAT_ERROR = 12;
const MT_CHAT_USER_ACK = 13;
const MT_CHAT_HISTORY_END = 14;

// Message type codes - System (0-9)
const MT_SYS_AUTH_SUCCESS = 0;
const MT_SYS_AUTH_FAILED = 1;
const MT_SYS_PONG = 2;

// Forward mapping (name to code) for sending
const MSG_TYPE_CODES = {
  terminal: {
    connected: MT_TERM_CONNECTED,
    output: MT_TERM_OUTPUT,
    error: MT_TERM_ERROR,
    closed: MT_TERM_CLOSED,
    // Client-to-server types (not in backend response codes)
    connect: 'connect',
    disconnect: 'disconnect',
    input: 'input',
    resize: 'resize',
    close: 'close'
  },
  chat: {
    ready: MT_CHAT_READY,
    stream: MT_CHAT_STREAM,
    assistant: MT_CHAT_ASSISTANT,
    user: MT_CHAT_USER,
    tool_call: MT_CHAT_TOOL_CALL,
    tool_result: MT_CHAT_TOOL_RESULT,
    thinking_start: MT_CHAT_THINKING_START,
    thinking_delta: MT_CHAT_THINKING_DELTA,
    thinking_end: MT_CHAT_THINKING_END,
    thinking: MT_CHAT_THINKING,
    system: MT_CHAT_SYSTEM,
    result: MT_CHAT_RESULT,
    error: MT_CHAT_ERROR,
    user_ack: MT_CHAT_USER_ACK,
    history_end: MT_CHAT_HISTORY_END,
    // Client-to-server types
    connect: 'connect',
    disconnect: 'disconnect',
    message: 'message',
    close: 'close'
  },
  system: {
    auth_success: MT_SYS_AUTH_SUCCESS,
    auth_failed: MT_SYS_AUTH_FAILED,
    pong: MT_SYS_PONG,
    // Client-to-server types
    auth: 'auth',
    ping: 'ping'
  }
};

// Reverse mapping (code to name) for receiving
const CODE_TO_MSG_TYPE = {
  terminal: {
    [MT_TERM_CONNECTED]: 'connected',
    [MT_TERM_OUTPUT]: 'output',
    [MT_TERM_ERROR]: 'error',
    [MT_TERM_CLOSED]: 'closed'
  },
  chat: {
    [MT_CHAT_READY]: 'ready',
    [MT_CHAT_STREAM]: 'stream',
    [MT_CHAT_ASSISTANT]: 'assistant',
    [MT_CHAT_USER]: 'user',
    [MT_CHAT_TOOL_CALL]: 'tool_call',
    [MT_CHAT_TOOL_RESULT]: 'tool_result',
    [MT_CHAT_THINKING_START]: 'thinking_start',
    [MT_CHAT_THINKING_DELTA]: 'thinking_delta',
    [MT_CHAT_THINKING_END]: 'thinking_end',
    [MT_CHAT_THINKING]: 'thinking',
    [MT_CHAT_SYSTEM]: 'system',
    [MT_CHAT_RESULT]: 'result',
    [MT_CHAT_ERROR]: 'error',
    [MT_CHAT_USER_ACK]: 'user_ack',
    [MT_CHAT_HISTORY_END]: 'history_end'
  },
  system: {
    [MT_SYS_AUTH_SUCCESS]: 'auth_success',
    [MT_SYS_AUTH_FAILED]: 'auth_failed',
    [MT_SYS_PONG]: 'pong'
  }
};

/**
 * Unpack a message from either old or new format
 * @returns {object} {channel, session_id, type, data}
 */
function unpackMessage(message) {
  if ('c' in message) {
    // New optimized format
    const chCode = message.c;
    const channel = CODE_TO_CHANNEL[chCode] || 'system';
    const sessionId = message.s || null;
    const tCode = message.t;
    // Convert type code to name if numeric
    let type;
    if (typeof tCode === 'number') {
      const typeMap = CODE_TO_MSG_TYPE[channel] || {};
      type = typeMap[tCode] || String(tCode);
    } else {
      type = tCode;
    }
    const data = message.d || {};
    return { channel, session_id: sessionId, type, data };
  } else {
    // Old format (legacy)
    return {
      channel: message.channel || '',
      session_id: message.session_id || null,
      type: message.type || '',
      data: message.data || {}
    };
  }
}

/**
 * Pack a message into optimized format
 * @returns {object} Optimized message {c, s, t, d}
 */
function packMessage(channel, sessionId, type, data) {
  const chCode = CHANNEL_CODES[channel];
  if (chCode === undefined) {
    // Unknown channel, use old format
    return { channel, session_id: sessionId, type, data };
  }

  const typeMap = MSG_TYPE_CODES[channel] || {};
  const tCode = typeMap[type] !== undefined ? typeMap[type] : type;

  const msg = { c: chCode, t: tCode, d: data || {} };
  if (sessionId && channel !== 'system') {
    msg.s = sessionId;
  }
  return msg;
}

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

    // Track if we've ever connected successfully (for reconnection detection)
    this.hasConnectedBefore = false;

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
    this.log(`Connecting to /ws/mux... (reconnect=${this.hasConnectedBefore})`);

    // Build WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/mux`;

    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      // BUG-F2 FIX: Clear previous timeout before creating new one
      // Prevents timer leak if connect() is called multiple times quickly
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
      }

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

    // BUG-003 FIX: Reset authenticated state on disconnect
    this.authenticated = false;

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
    // BUG-002 FIX: Also clean up subscriptionData to prevent stale data on reconnect
    this.subscriptionData.delete(key);
  }

  /**
   * Send a message through the multiplexed connection
   * @param {string} channel - "terminal", "chat", or "system"
   * @param {string} sessionId - Session ID (null for system messages)
   * @param {string} type - Message type
   * @param {object} data - Message data
   */
  send(channel, sessionId, type, data) {
    // Pack message into optimized format
    const message = packMessage(channel, sessionId, type, data);

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
      this.log(`Chat ${sessionId.substring(0, 8)} already connected, updating callbacks`);
      // Update callbacks
      const handler = this.handlers.get(key);
      if (options.onMessage) handler.onMessage = options.onMessage;
      if (options.onConnect) handler.onConnect = options.onConnect;
      if (options.onDisconnect) handler.onDisconnect = options.onDisconnect;
      
      // Trigger onConnect immediately since we're already connected
      if (this.state === 'connected' || this.state === 'authenticating') {
        // We might not have the full data from the original ready message, 
        // but we know it's active.
        setTimeout(() => {
          if (options.onConnect) options.onConnect({ working_dir: workingDir, already_connected: true });
        }, 0);
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
    // BUG-006 FIX: Also set to null after clearing
    this.connectionTimeout = null;
    this.reconnectAttempts = 0;

    this._setState('authenticating');

    // Authenticate (use packMessage for optimized format)
    const token = window.app?.authToken || localStorage.getItem('auth_token') || '';
    this._sendRaw(packMessage('system', null, 'auth', { token }));
  }

  _onMessage(event) {
    let rawMessage;

    try {
      if (event.data instanceof ArrayBuffer) {
        // MessagePack
        rawMessage = MessagePack.decode(new Uint8Array(event.data));
      } else {
        // JSON
        rawMessage = JSON.parse(event.data);
      }
    } catch (error) {
      this.log('Failed to parse message: ' + error);
      return;
    }

    // Unpack message (handles both old and new format)
    const { channel, session_id, type, data } = unpackMessage(rawMessage);

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

        // BUG FIX: Create a forwarding handler to handle delayed messages for the old session ID
        // Some messages may arrive with the old session ID after remapping (race condition)
        const forwardHandler = {
          channel: originalHandler.channel,
          sessionId: originalHandler.sessionId,
          onMessage: (type, data) => {
            this.log(`Forwarding ${type} from ${originalKey} to ${handlerKey}`);
            originalHandler.onMessage(type, data);
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

      // Check if this is a reconnection before processing
      const isReconnection = this.hasConnectedBefore;

      // Mark that we've connected at least once
      this.hasConnectedBefore = true;

      // Process pending operations (new subscriptions queued while connecting)
      const processedKeys = this._processPendingOperations();

      // Re-send connect messages for existing subscriptions (only on reconnection)
      // This prevents duplicate connect messages on fresh connections
      // Skip any keys that were already processed via pendingOperations
      if (isReconnection) {
        this._resendSubscriptions(processedKeys);
      }

    } else if (type === 'auth_failed') {
      this.log('Authentication failed: ' + data.reason);
      // BUG-003 FIX: Reset authenticated on auth_failed
      this.authenticated = false;
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
        this._sendRaw(packMessage('system', null, 'ping', {}));
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
    const processedKeys = new Set();

    if (this.pendingOperations.length === 0) return processedKeys;

    this.log(`Processing ${this.pendingOperations.length} pending operations`);

    const ops = [...this.pendingOperations];
    this.pendingOperations = [];

    for (const message of ops) {
      this._sendRaw(message);
      // BUG-F1 FIX: Track connect messages to avoid duplicates in _resendSubscriptions
      // Messages use optimized format {c, s, t, d} not old format {channel, session_id, type, data}
      const isConnect = message.t === 'connect' || message.type === 'connect';
      const channel = message.c !== undefined ? CODE_TO_CHANNEL[message.c] : message.channel;
      const sessionId = message.s || message.session_id;
      if (isConnect && channel && sessionId) {
        processedKeys.add(`${channel}:${sessionId}`);
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
      this._sendRaw(packMessage(sub.channel, sub.sessionId, 'connect', sub.data));
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
