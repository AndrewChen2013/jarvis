/**
 * Copyright (c) 2025 BillChen
 *
 * Chat Mode - Tools module
 * Tool renderers (Edit/Bash/Read/Grep/Write) and result handlers
 */

Object.assign(ChatMode, {
  /**
   * Add tool call message
   */
  addToolMessage(action, toolName, data, timestamp) {
    this.log(`[DIAG] addToolMessage called: toolName=${toolName}, action=${action}`);
    if (this.emptyEl) {
      this.emptyEl.style.display = 'none';
    }

    // Add random suffix to ensure uniqueness
    const msgId = 'tool-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message tool';
    msgEl.id = msgId;

    // Tools that should be expanded by default
    const expandedByDefault = ['Grep', 'Edit', 'Read', 'Write', 'Glob', 'Bash', 'LSP'];
    const shouldExpand = expandedByDefault.includes(toolName);
    const contentClass = shouldExpand ? 'tool-content show' : 'tool-content';
    const toggleClass = shouldExpand ? 'tool-toggle expanded' : 'tool-toggle';

    // Render tool-specific content
    let toolContent = '';
    switch (toolName) {
      case 'Edit':
        toolContent = this.renderEditTool(data);
        break;
      case 'Write':
        toolContent = this.renderWriteTool(data);
        break;
      case 'Read':
        toolContent = this.renderReadTool(data);
        break;
      case 'Bash':
        toolContent = this.renderBashTool(data);
        break;
      case 'Grep':
        toolContent = this.renderGrepTool(data);
        break;
      default:
        toolContent = `<pre>${this.escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
    }

    // Get tool icon
    const toolIcon = this.getToolIcon(toolName);

    // Descriptive pending message
    const pendingMsgs = {
      'Bash': 'Executing command...',
      'Read': 'Reading file...',
      'Edit': 'Applying changes...',
      'Grep': 'Searching...',
      'Glob': 'Listing files...',
      'default': 'Processing...'
    };
    const pendingText = pendingMsgs[toolName] || pendingMsgs.default;

    // Format timestamp
    const timeStr = timestamp ? this.formatTimestamp(timestamp) : '';
    const timeHtml = timeStr ? `<span class="tool-time">${timeStr}</span>` : '';

    msgEl.innerHTML = `
      <div class="chat-bubble">
        <div class="tool-header" onclick="ChatMode.toggleToolContent('${msgId}', event)">
          <span class="tool-icon">${toolIcon}</span>
          <span class="tool-name">${toolName}</span>
          ${timeHtml}
          <div class="tool-actions">
            <button class="tool-action-btn" onclick="ChatMode.showFullscreenTool('${msgId}', event)" title="Fullscreen">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
              </svg>
            </button>
            <span class="${toggleClass}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </span>
          </div>
        </div>
        <div class="${contentClass}" id="${msgId}-content">
          ${toolContent.includes('tool-pending') ? toolContent.replace('tool-pending">', `tool-pending">${pendingText}`) : toolContent}
        </div>
      </div>
    `;

    this.messagesEl.appendChild(msgEl);
    this.scrollToBottom();

    return msgId;
  },

  /**
   * Get tool-specific icon
   */
  getToolIcon(toolName) {
    const icons = {
      Edit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>`,
      Write: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="12" y1="18" x2="12" y2="12"/>
        <line x1="9" y1="15" x2="15" y2="15"/>
      </svg>`,
      Read: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>`,
      Bash: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="4 17 10 11 4 5"/>
        <line x1="12" y1="19" x2="20" y2="19"/>
      </svg>`,
      Grep: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>`,
      Glob: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>`,
      default: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
      </svg>`
    };
    return icons[toolName] || icons.default;
  },

  /**
   * Render Edit tool with diff display
   */
  renderEditTool(data) {
    const filePath = data.file_path || '';
    const oldString = data.old_string || '';
    const newString = data.new_string || '';
    const isNewFile = !oldString && newString;
    const replaceAll = data.replace_all;

    // Get filename for display
    const fileName = filePath.split('/').pop();
    const fileExt = fileName.split('.').pop();

    let html = `<div class="tool-file-header">`;
    html += `<span class="tool-file-icon">📄</span>`;
    html += `<span class="tool-file-path" title="${this.escapeHtml(filePath)}">${this.escapeHtml(fileName)}</span>`;
    if (isNewFile) {
      html += `<span class="tool-badge new">NEW</span>`;
    } else if (replaceAll) {
      html += `<span class="tool-badge replace-all">REPLACE ALL</span>`;
    }
    html += `</div>`;

    if (isNewFile) {
      // New file - show all as additions
      html += `<div class="tool-diff">`;
      html += this.renderDiffLines(newString, 'add');
      html += `</div>`;
    } else {
      // Edit - show diff
      html += `<div class="tool-diff">`;
      if (oldString) {
        html += this.renderDiffLines(oldString, 'remove');
      }
      if (newString) {
        html += this.renderDiffLines(newString, 'add');
      }
      html += `</div>`;
    }

    return html;
  },

  /**
   * Render diff lines with proper styling
   */
  renderDiffLines(content, type) {
    // Ensure content is a string before splitting
    if (content == null || typeof content !== 'string') {
      content = String(content || '');
    }
    const lines = content.split('\n');
    const prefix = type === 'add' ? '+' : '-';
    const className = type === 'add' ? 'diff-add' : 'diff-remove';

    return lines.map(line => {
      return `<div class="diff-line ${className}"><span class="diff-prefix">${prefix}</span><span class="diff-content">${this.escapeHtml(line) || ' '}</span></div>`;
    }).join('');
  },

  /**
   * Render Write tool (new file)
   */
  renderWriteTool(data) {
    const filePath = data.file_path || '';
    const content = data.content || '';
    const fileName = filePath.split('/').pop();

    let html = `<div class="tool-file-header">`;
    html += `<span class="tool-file-icon">📄</span>`;
    html += `<span class="tool-file-path" title="${this.escapeHtml(filePath)}">${this.escapeHtml(fileName)}</span>`;
    html += `<span class="tool-badge new">NEW FILE</span>`;
    html += `</div>`;

    // Show content with line numbers
    html += `<div class="tool-code-block">`;
    html += this.renderCodeWithLineNumbers(content, fileName);
    html += `</div>`;

    return html;
  },

  /**
   * Render Read tool with syntax highlighting and line numbers
   */
  renderReadTool(data) {
    const filePath = data.file_path || '';
    const fileName = filePath.split('/').pop();
    const offset = data.offset || 0;
    const limit = data.limit;

    let html = `<div class="tool-file-header">`;
    html += `<span class="tool-file-icon">📖</span>`;
    html += `<span class="tool-file-path" title="${this.escapeHtml(filePath)}">${this.escapeHtml(fileName)}</span>`;
    if (offset || limit) {
      html += `<span class="tool-badge info">`;
      if (offset) html += `offset: ${offset}`;
      if (offset && limit) html += ', ';
      if (limit) html += `limit: ${limit}`;
      html += `</span>`;
    }
    html += `</div>`;

    // Will be populated by tool result
    html += `<div class="tool-code-block"><pre class="tool-pending"></pre></div>`;

    return html;
  },

  /**
   * Render Bash tool with command highlighting
   */
  renderBashTool(data) {
    const command = data.command || '';
    const description = data.description || '';
    const timeout = data.timeout;

    let html = `<div class="tool-bash-header">`;
    html += `<span class="tool-bash-prompt">$</span>`;
    html += `<span class="tool-bash-command">${this.escapeHtml(command)}</span>`;
    if (timeout) {
      html += `<span class="tool-badge info">timeout: ${timeout}ms</span>`;
    }
    html += `</div>`;

    if (description) {
      html += `<div class="tool-bash-desc">${this.escapeHtml(description)}</div>`;
    }

    // Output will be populated by tool result
    html += `<div class="tool-bash-output"><pre class="tool-pending"></pre></div>`;

    return html;
  },

  /**
   * Render Grep tool with pattern highlighting
   */
  renderGrepTool(data) {
    const pattern = data.pattern || '';
    const path = data.path || '.';
    const glob = data.glob || '';
    const outputMode = data.output_mode || 'files_with_matches';

    let html = `<div class="tool-grep-header">`;
    html += `<span class="tool-grep-pattern">"${this.escapeHtml(pattern)}"</span>`;
    html += `<span class="tool-grep-path">in ${this.escapeHtml(path)}</span>`;
    if (glob) {
      html += `<span class="tool-badge info">${this.escapeHtml(glob)}</span>`;
    }
    html += `</div>`;

    // Store pattern for highlighting in results
    html += `<div class="tool-grep-results" data-pattern="${this.escapeHtml(pattern)}">`;
    html += `<pre class="tool-pending"></pre>`;
    html += `</div>`;

    return html;
  },

  /**
   * Render code with line numbers
   */
  renderCodeWithLineNumbers(content, fileName) {
    // Ensure content is a string before splitting
    if (content == null || typeof content !== 'string') {
      return `<div class="code-with-lines"><div class="code-line"><span class="line-content">${this.escapeHtml(String(content || '(empty)'))}</span></div></div>`;
    }
    const lines = content.split('\n');
    const maxLineNum = lines.length;
    const padWidth = String(maxLineNum).length;

    // Check if content is too long, auto-collapse
    const MAX_VISIBLE_LINES = 20;
    const shouldCollapse = lines.length > MAX_VISIBLE_LINES;

    let html = `<div class="code-with-lines${shouldCollapse ? ' collapsed' : ''}">`;

    lines.forEach((line, idx) => {
      const lineNum = String(idx + 1).padStart(padWidth, ' ');
      const isHidden = shouldCollapse && idx >= MAX_VISIBLE_LINES;
      html += `<div class="code-line${isHidden ? ' hidden' : ''}">`;
      html += `<span class="line-number">${lineNum}</span>`;
      html += `<span class="line-content">${this.highlightCode(line) || ' '}</span>`;
      html += `</div>`;
    });

    if (shouldCollapse) {
      html += `<div class="code-expand-btn" onclick="ChatMode.expandCodeBlock(this)">`;
      html += `Show ${lines.length - MAX_VISIBLE_LINES} more lines...`;
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  },

  /**
   * Expand collapsed code block
   */
  expandCodeBlock(btn) {
    const container = btn.closest('.code-with-lines');
    if (container) {
      container.classList.remove('collapsed');
      container.querySelectorAll('.code-line.hidden').forEach(el => el.classList.remove('hidden'));
      btn.remove();
    }
  },

  /**
   * Toggle tool content visibility
   */
  toggleToolContent(msgId, event) {
    if (event) event.stopPropagation();

    // Find the correct container first
    const msgEl = document.getElementById(msgId);
    if (!msgEl) return;

    const content = msgEl.querySelector(`#${msgId}-content`);
    const toggle = msgEl.querySelector(`.tool-toggle`);

    if (content) {
      const isExpanding = !content.classList.contains('show');

      // Store current scroll position state
      const threshold = 100;
      const isNearBottom = (this.messagesEl.scrollHeight - this.messagesEl.scrollTop - this.messagesEl.clientHeight) < threshold;

      content.classList.toggle('show');
      toggle?.classList.toggle('expanded');

      // If expanding and was near bottom, scroll after layout update
      if (isExpanding && isNearBottom) {
        setTimeout(() => {
          this.scrollToBottom();
        }, 50);
      }
    }
  },

  /**
   * Show tool content in full-screen modal
   */
  showFullscreenTool(msgId, event) {
    if (event) event.stopPropagation();

    const msgEl = document.getElementById(msgId);
    if (!msgEl) return;

    const toolName = msgEl.querySelector('.tool-name')?.textContent || 'Tool Output';
    const contentHtml = msgEl.querySelector(`#${msgId}-content`)?.innerHTML || '';

    const overlay = document.createElement('div');
    overlay.className = 'tool-fullscreen-overlay';
    overlay.innerHTML = `
      <div class="tool-fs-header">
        <button class="tool-fs-close" onclick="this.closest('.tool-fullscreen-overlay').remove()">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <span class="tool-fs-title">${toolName}</span>
      </div>
      <div class="tool-fs-content">
        ${contentHtml}
      </div>
    `;

    document.body.appendChild(overlay);
  },

  /**
   * Update tool result
   */
  updateToolResult(toolId, data) {
    // Find the tool message and update it
    const toolMsgs = this.messagesEl.querySelectorAll('.chat-message.tool');
    if (toolMsgs.length === 0) return;

    const lastTool = toolMsgs[toolMsgs.length - 1];
    const toolName = lastTool.querySelector('.tool-name')?.textContent || '';
    const isError = data.is_error || false;
    const stdout = data.stdout || data.content || '';
    const stderr = data.stderr || '';

    // Handle different tool types
    switch (toolName) {
      case 'Bash':
        this.updateBashResult(lastTool, stdout, stderr, isError);
        break;
      case 'Read':
        this.updateReadResult(lastTool, stdout, stderr, isError);
        break;
      case 'Grep':
        this.updateGrepResult(lastTool, stdout, stderr, isError);
        break;
      default:
        // Default handling
        const content = lastTool.querySelector('.tool-content pre');
        if (content) {
          if (isError) {
            content.className = 'tool-error';
          }
          content.textContent = stdout + (stderr ? '\n[stderr]\n' + stderr : '');
        }
    }
  },

  /**
   * Update Bash tool result with stdout/stderr separation
   */
  updateBashResult(toolEl, stdout, stderr, isError) {
    const outputEl = toolEl.querySelector('.tool-bash-output');
    if (!outputEl) return;

    let html = '';

    if (stdout) {
      html += `<div class="bash-stdout"><pre>${this.escapeHtml(stdout)}</pre></div>`;
    }

    if (stderr) {
      html += `<div class="bash-stderr">`;
      html += `<div class="bash-stderr-label">stderr:</div>`;
      html += `<pre>${this.escapeHtml(stderr)}</pre>`;
      html += `</div>`;
    }

    if (isError) {
      html += `<div class="bash-error-badge">✗ Error</div>`;
    } else if (!stdout && !stderr) {
      html += `<div class="bash-success-badge">✓ Success (no output)</div>`;
    }

    outputEl.innerHTML = html;
  },

  /**
   * Update Read tool result with code display
   */
  updateReadResult(toolEl, content, stderr, isError) {
    const codeBlock = toolEl.querySelector('.tool-code-block');
    if (!codeBlock) return;

    if (isError || stderr) {
      codeBlock.innerHTML = `<pre class="tool-error">${this.escapeHtml(stderr || content)}</pre>`;
      return;
    }

    // Get filename for syntax hints
    const fileName = toolEl.querySelector('.tool-file-path')?.textContent || '';
    codeBlock.innerHTML = this.renderCodeWithLineNumbers(content, fileName);
  },

  /**
   * Update Grep tool result with pattern highlighting
   */
  updateGrepResult(toolEl, content, stderr, isError) {
    const resultsEl = toolEl.querySelector('.tool-grep-results');
    if (!resultsEl) return;

    if (isError || stderr) {
      resultsEl.innerHTML = `<pre class="tool-error">${this.escapeHtml(stderr || content)}</pre>`;
      return;
    }

    const pattern = resultsEl.getAttribute('data-pattern') || '';
    // Ensure content is a string before splitting
    if (content == null || typeof content !== 'string') {
      content = String(content || '');
    }
    const lines = content.split('\n').filter(line => line.trim());

    if (lines.length === 0) {
      resultsEl.innerHTML = `<div class="grep-no-results">No matches found</div>`;
      return;
    }

    // Highlight matches in results
    let html = `<div class="grep-results-list">`;
    lines.forEach(line => {
      const highlightedLine = this.highlightPattern(line, pattern);
      html += `<div class="grep-result-line">${highlightedLine}</div>`;
    });
    html += `</div>`;

    if (lines.length > 20) {
      html = `<div class="grep-count">${lines.length} matches</div>` + html;
    }

    resultsEl.innerHTML = html;
  },

  /**
   * Create tool message element (same as addToolMessage but returns element without inserting)
   * Used for history loading
   */
  createToolMessageElement(toolName, data, timestamp) {
    const msgId = 'tool-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message tool';
    msgEl.id = msgId;

    // Tools that should be expanded by default
    const expandedByDefault = ['Grep', 'Edit', 'Read', 'Write', 'Glob', 'Bash', 'LSP'];
    const shouldExpand = expandedByDefault.includes(toolName);
    const contentClass = shouldExpand ? 'tool-content show' : 'tool-content';
    const toggleClass = shouldExpand ? 'tool-toggle expanded' : 'tool-toggle';

    // Render tool-specific content
    let toolContent = '';
    switch (toolName) {
      case 'Edit':
        toolContent = this.renderEditTool(data);
        break;
      case 'Write':
        toolContent = this.renderWriteTool(data);
        break;
      case 'Read':
        toolContent = this.renderReadTool(data);
        break;
      case 'Bash':
        toolContent = this.renderBashTool(data);
        break;
      case 'Grep':
        toolContent = this.renderGrepTool(data);
        break;
      default:
        toolContent = `<pre>${this.escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
    }

    // Get tool icon
    const toolIcon = this.getToolIcon(toolName);

    // Format timestamp
    const timeStr = timestamp ? this.formatTimestamp(timestamp) : '';
    const timeHtml = timeStr ? `<span class="tool-time">${timeStr}</span>` : '';

    msgEl.innerHTML = `
      <div class="chat-bubble">
        <div class="tool-header" onclick="ChatMode.toggleToolContent('${msgId}', event)">
          <span class="tool-icon">${toolIcon}</span>
          <span class="tool-name">${toolName}</span>
          ${timeHtml}
          <div class="tool-actions">
            <button class="tool-action-btn" onclick="ChatMode.showFullscreenTool('${msgId}', event)" title="Fullscreen">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
              </svg>
            </button>
            <span class="${toggleClass}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </span>
          </div>
        </div>
        <div class="${contentClass}" id="${msgId}-content">
          ${toolContent}
        </div>
      </div>
    `;

    return msgEl;
  }
});
