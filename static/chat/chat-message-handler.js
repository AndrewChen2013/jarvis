/**
 * Copyright (c) 2025 BillChen
 *
 * Chat Mode - Message Handler
 * 核心消息处理逻辑，独立于 session 状态
 */

const ChatMessageHandler = {
  /**
   * 处理单条消息
   * @param {object} ctx - 处理上下文
   * @param {SessionInstance} ctx.session - 目标 session
   * @param {HTMLElement} ctx.messagesEl - 消息容器元素
   * @param {HTMLElement} ctx.emptyEl - 空状态元素
   * @param {boolean} ctx.isActiveSession - 是否当前活跃 session
   * @param {string} type - 消息类型
   * @param {object} data - 消息数据
   */
  handle(ctx, type, data) {
    const { session, messagesEl } = ctx;

    if (!session || !messagesEl) {
      console.warn('[ChatMessageHandler] Missing context:', { session: !!session, messagesEl: !!messagesEl });
      return;
    }

    switch (type) {
      case 'ready': this._handleReady(ctx, data); break;
      case 'system': this._handleSystem(ctx, data); break;
      case 'user_ack': break; // Already shown
      case 'user': this._handleUser(ctx, data); break;
      case 'stream': this._handleStream(ctx, data); break;
      case 'assistant': this._handleAssistant(ctx, data); break;
      case 'tool_call': this._handleToolCall(ctx, data); break;
      case 'tool_result': this._handleToolResult(ctx, data); break;
      case 'thinking_start': this._handleThinkingStart(ctx, data); break;
      case 'thinking_delta': this._handleThinkingDelta(ctx, data); break;
      case 'thinking_end': this._handleThinkingEnd(ctx, data); break;
      case 'thinking': this._handleThinking(ctx, data); break;
      case 'result': this._handleResult(ctx, data); break;
      case 'error': this._handleError(ctx, data); break;
      case 'history_end': this._handleHistoryEnd(ctx, data); break;
      case 'history_page_end': this._handleHistoryPageEnd(ctx, data); break;
      case 'pong': break;
      default: console.warn('[ChatMessageHandler] Unknown type:', type);
    }
  },

  _handleReady(ctx, data) {
    const { session, messagesEl, isActiveSession } = ctx;
    const existingMsgCount = messagesEl.querySelectorAll('.chat-message').length;
    const isReconnect = existingMsgCount > 0;

    if (data.history_count > 0) {
      session.chatIsLoadingHistory = true;
      session.chatPendingHistoryMessages = [];
      session.chatIsReconnect = isReconnect;
      ChatMode.log(`History loading for ${session.id?.substring(0, 8)}, count=${data.history_count}, isReconnect=${isReconnect}`);
    }

    if (isActiveSession) {
      ChatMode.isConnected = true;
      ChatMode.updateStatus('connected');
      if (ChatMode.sendBtn && ChatMode.inputEl) {
        ChatMode.sendBtn.disabled = !ChatMode.inputEl.value.trim();
      }
    }
  },

  _handleSystem(ctx, data) {
    const { session } = ctx;
    if (data.data?.session_id) {
      session.chatClaudeSessionId = data.data.session_id;
      ChatMode.log(`Updated chatClaudeSessionId for ${session.id?.substring(0, 8)}`);
    }
  },

  _handleUser(ctx, data) {
    const { session } = ctx;
    if (session.chatIsLoadingHistory) {
      session.chatPendingHistoryMessages.push({
        type: 'user', content: data.content, extra: { timestamp: data.timestamp }
      });
      return;
    }
    if (this._isDuplicate(session, 'user', data.content, data.timestamp)) return;
    this._renderMessage(ctx, 'user', data.content, { timestamp: data.timestamp });
  },

  _handleStream(ctx, data) {
    const { session, messagesEl } = ctx;
    this._hideTypingIndicator(messagesEl);

    if (!session.chatIsStreaming) {
      session.chatIsStreaming = true;
      session.chatStreamingMessageId = ChatMode._generateMessageId();
      const msgEl = document.createElement('div');
      msgEl.className = 'chat-message assistant streaming';
      msgEl.id = session.chatStreamingMessageId;
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      bubble.setAttribute('data-raw', '');
      msgEl.appendChild(bubble);
      messagesEl.appendChild(msgEl);
    }

    const msgEl = messagesEl.querySelector(`#${session.chatStreamingMessageId}`);
    if (msgEl) {
      const bubble = msgEl.querySelector('.chat-bubble');
      if (bubble) {
        const newText = (bubble.getAttribute('data-raw') || '') + data.text;
        bubble.setAttribute('data-raw', newText);
        bubble.innerHTML = ChatMode.formatContent(newText);
      }
    }
    this._scrollToBottom(ctx);
  },

  _handleAssistant(ctx, data) {
    const { session, messagesEl } = ctx;
    this._hideTypingIndicator(messagesEl);

    if (session.chatIsLoadingHistory) {
      const extraData = { timestamp: data.timestamp };
      if (data.extra?.tool_calls) extraData.tool_calls = data.extra.tool_calls;
      session.chatPendingHistoryMessages.push({ type: 'assistant', content: data.content, extra: extraData });
      return;
    }

    if (session.chatIsStreaming) {
      this._finalizeStreaming(ctx, data.content);
    } else {
      if (this._isDuplicate(session, 'assistant', data.content, data.timestamp)) return;
      if (data.extra?.tool_calls) {
        for (const tc of data.extra.tool_calls) {
          const toolEl = ChatMode.createToolMessageElement(tc.name, tc.input, data.timestamp);
          messagesEl.appendChild(toolEl);
        }
      }
      if (data.content?.trim()) {
        this._renderMessage(ctx, 'assistant', data.content, { timestamp: data.timestamp });
      }
    }
  },

  _handleToolCall(ctx, data) {
    const { messagesEl } = ctx;
    this._hideTypingIndicator(messagesEl);
    const toolEl = ChatMode.createToolMessageElement(data.tool_name, data.input, data.timestamp);
    messagesEl.appendChild(toolEl);
    this._scrollToBottom(ctx);
  },

  _handleToolResult(ctx, data) {
    const { messagesEl } = ctx;
    // 需要传完整的 ChatMode 上下文，因为 updateToolResult 内部会调用 this.updateBashResult 等方法
    const savedMessagesEl = ChatMode.messagesEl;
    ChatMode.messagesEl = messagesEl;
    ChatMode.updateToolResult(data.tool_id, data);
    ChatMode.messagesEl = savedMessagesEl;
    this._showTypingIndicator(messagesEl);
  },

  _handleThinkingStart(ctx, data) {
    const { session, messagesEl, emptyEl } = ctx;
    this._hideTypingIndicator(messagesEl);
    if (emptyEl) emptyEl.style.display = 'none';

    const thinkingId = 'thinking-' + Date.now();
    session.chatIsThinking = true;
    session.chatThinkingMessageId = thinkingId;

    const t = (key, fb) => window.i18n?.t(key, fb) || fb;
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message thinking';
    msgEl.id = thinkingId;
    msgEl.innerHTML = `
      <div class="chat-bubble thinking-bubble">
        <div class="thinking-header" onclick="ChatMode.toggleThinking('${thinkingId}')">
          <span class="thinking-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></span>
          <span class="thinking-label">${t('chat.thinking', 'Thinking...')}</span>
          <span class="thinking-toggle"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></span>
        </div>
        <div class="thinking-content show" id="${thinkingId}-content"></div>
      </div>`;
    messagesEl.appendChild(msgEl);
    this._scrollToBottom(ctx);
  },

  _handleThinkingDelta(ctx, data) {
    const { session, messagesEl } = ctx;
    if (!session.chatIsThinking || !session.chatThinkingMessageId) return;
    const contentEl = messagesEl.querySelector(`#${session.chatThinkingMessageId}-content`);
    if (contentEl) {
      const newText = (contentEl.getAttribute('data-raw') || '') + data.text;
      contentEl.setAttribute('data-raw', newText);
      contentEl.innerHTML = ChatMode.formatContent(newText);
    }
    this._scrollToBottom(ctx);
  },

  _handleThinkingEnd(ctx, _data) {
    const { session, messagesEl } = ctx;
    if (!session.chatThinkingMessageId) return;
    const msgEl = messagesEl.querySelector(`#${session.chatThinkingMessageId}`);
    if (msgEl) {
      const t = (key, fb) => window.i18n?.t(key, fb) || fb;
      const label = msgEl.querySelector('.thinking-label');
      if (label) label.textContent = t('chat.thought', 'Thought');
      msgEl.querySelector('.thinking-content')?.classList.remove('show');
      msgEl.querySelector('.thinking-toggle')?.classList.remove('expanded');
    }
    session.chatIsThinking = false;
    session.chatThinkingMessageId = null;
    this._showTypingIndicator(messagesEl);
  },

  _handleThinking(ctx, data) {
    const { messagesEl, emptyEl } = ctx;
    this._hideTypingIndicator(messagesEl);
    if (emptyEl) emptyEl.style.display = 'none';

    const msgId = 'thinking-' + Date.now();
    const t = (key, fb) => window.i18n?.t(key, fb) || fb;
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message thinking';
    msgEl.id = msgId;
    msgEl.innerHTML = `
      <div class="chat-bubble thinking-bubble">
        <div class="thinking-header" onclick="ChatMode.toggleThinking('${msgId}')">
          <span class="thinking-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></span>
          <span class="thinking-label">${t('chat.thought', 'Thought')}</span>
          <span class="thinking-toggle"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></span>
        </div>
        <div class="thinking-content" id="${msgId}-content">${ChatMode.formatContent(data.content)}</div>
      </div>`;
    messagesEl.appendChild(msgEl);
    this._scrollToBottom(ctx);
    this._showTypingIndicator(messagesEl);
  },

  _handleResult(ctx, data) {
    const { session, messagesEl, isActiveSession } = ctx;
    this._hideTypingIndicator(messagesEl);
    this._hideProgressMessage(messagesEl);

    messagesEl.querySelectorAll('.chat-message.streaming').forEach(el => el.classList.remove('streaming'));
    session.chatIsStreaming = false;
    session.chatStreamingMessageId = null;

    if (isActiveSession && ChatMode.sendBtn && ChatMode.inputEl) {
      ChatMode.sendBtn.disabled = !ChatMode.inputEl.value.trim() || !ChatMode.isConnected;
    }
    if (data.cost_usd) this._showResultBadge(messagesEl, data);
  },

  _handleError(ctx, data) {
    const { session, messagesEl, isActiveSession } = ctx;
    this._hideTypingIndicator(messagesEl);
    this._hideProgressMessage(messagesEl);

    session.chatIsStreaming = false;
    session.chatStreamingMessageId = null;
    messagesEl.querySelectorAll('.chat-message.streaming').forEach(el => el.classList.remove('streaming'));

    this._renderMessage(ctx, 'system', `Error: ${data.message}`, {});

    if (isActiveSession && ChatMode.sendBtn && ChatMode.inputEl) {
      ChatMode.sendBtn.disabled = !ChatMode.inputEl.value.trim() || !ChatMode.isConnected;
    }
    if (data.permanent && session.id && window.muxWs) {
      window.muxWs.unsubscribe('chat', session.id);
    }
  },

  _handleHistoryEnd(ctx, data) {
    const { session, messagesEl, emptyEl } = ctx;
    session.chatHistoryOldestIndex = data.total - data.count;
    session.chatHasMoreHistory = session.chatHistoryOldestIndex > 0;

    if (session.chatIsReconnect) {
      ChatMode.log(`Skipping history render on reconnect for ${session.id?.substring(0, 8)}`);
      session.chatIsLoadingHistory = false;
      session.chatPendingHistoryMessages = [];
      session.chatIsReconnect = false;
      return;
    }

    const pendingMsgs = session.chatPendingHistoryMessages || [];
    if (pendingMsgs.length > 0) {
      if (emptyEl) emptyEl.style.display = 'none';
      for (const msg of pendingMsgs) {
        if (msg.extra?.tool_calls) {
          for (const tc of msg.extra.tool_calls) {
            const toolEl = ChatMode.createToolMessageElement(tc.name, tc.input, msg.extra.timestamp);
            messagesEl.appendChild(toolEl);
          }
        }
        if (msg.content?.trim()) {
          const msgEl = ChatMode.createMessageElement(msg.type, msg.content, msg.extra);
          messagesEl.appendChild(msgEl);
        }
      }
      session.chatPendingHistoryMessages = [];
    }
    session.chatIsLoadingHistory = false;
    session.chatIsReconnect = false;
    this._scrollToBottom(ctx);
  },

  _handleHistoryPageEnd(ctx, _data) {
    const { session } = ctx;
    session.chatHistoryOldestIndex = _data.oldest_index;
    session.chatHasMoreHistory = _data.has_more;
    session.chatIsLoadingHistory = false;
  },

  // === Helpers ===
  _isDuplicate(session, type, content, timestamp) {
    if (session.chatIsLoadingHistory) return false;
    const messages = session.chatMessages || [];
    if (!messages.length) return false;
    const checkCount = Math.min(messages.length, 50);
    for (let i = messages.length - 1; i >= messages.length - checkCount; i--) {
      const msg = messages[i];
      if (msg.type === type) {
        const match = typeof msg.content === 'string' && typeof content === 'string'
          ? msg.content === content
          : JSON.stringify(msg.content) === JSON.stringify(content);
        if (match) {
          if (timestamp && msg.extra?.timestamp) {
            const diff = Math.abs(new Date(timestamp) - new Date(msg.extra.timestamp));
            if (diff < 60000) return true;
          } else {
            return true;
          }
        }
      }
    }
    return false;
  },

  _renderMessage(ctx, type, content, extra) {
    const { session, messagesEl, emptyEl } = ctx;
    if (emptyEl) emptyEl.style.display = 'none';
    if (!content?.trim()) return null;
    const msgEl = ChatMode.createMessageElement(type, content, extra);
    messagesEl.appendChild(msgEl);
    const msg = { id: msgEl.id, type, content, ...extra };
    if (session.chatMessages) session.chatMessages.push(msg);
    this._scrollToBottom(ctx);
    return msgEl.id;
  },

  _finalizeStreaming(ctx, finalContent) {
    const { session, messagesEl } = ctx;
    if (!session.chatStreamingMessageId && finalContent?.trim()) {
      this._renderMessage(ctx, 'assistant', finalContent, { timestamp: new Date().toISOString() });
      session.chatIsStreaming = false;
      return;
    }
    const msgEl = messagesEl.querySelector(`#${session.chatStreamingMessageId}`);
    if (msgEl) {
      msgEl.classList.remove('streaming');
      const bubble = msgEl.querySelector('.chat-bubble');
      if (bubble) bubble.innerHTML = ChatMode.formatContent(finalContent);
      if (finalContent?.trim() && session.chatMessages) {
        session.chatMessages.push({ id: session.chatStreamingMessageId, type: 'assistant', content: finalContent });
      }
    } else if (finalContent?.trim()) {
      this._renderMessage(ctx, 'assistant', finalContent, { timestamp: new Date().toISOString() });
    }
    messagesEl.querySelectorAll('.chat-message.streaming').forEach(el => el.classList.remove('streaming'));
    session.chatIsStreaming = false;
    session.chatStreamingMessageId = null;
  },

  _scrollToBottom(ctx) {
    const { session, messagesEl } = ctx;
    if (session.chatAutoScrollEnabled === false) return;
    if (!messagesEl || messagesEl.offsetParent === null) return;
    requestAnimationFrame(() => messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' }));
  },

  _hideTypingIndicator(messagesEl) {
    messagesEl?.querySelector('#typingIndicator')?.remove();
  },

  _showTypingIndicator(messagesEl) {
    if (!messagesEl || messagesEl.querySelector('#typingIndicator')) return;
    const indicator = document.createElement('div');
    indicator.id = 'typingIndicator';
    indicator.className = 'chat-message assistant';
    indicator.innerHTML = `<div class="chat-bubble typing-indicator"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>`;
    messagesEl.appendChild(indicator);
  },

  _hideProgressMessage(messagesEl) {
    messagesEl?.querySelector('#progressIndicator')?.remove();
  },

  _showResultBadge(messagesEl, data) {
    const cost = data.cost_usd ? `$${data.cost_usd.toFixed(4)}` : '';
    const duration = data.duration_ms ? `${(data.duration_ms / 1000).toFixed(1)}s` : '';
    if (cost || duration) {
      const badge = document.createElement('div');
      badge.className = 'chat-result-badge success';
      badge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>${[duration, cost].filter(Boolean).join(' / ')}`;
      messagesEl.appendChild(badge);
    }
  }
};

window.ChatMessageHandler = ChatMessageHandler;
