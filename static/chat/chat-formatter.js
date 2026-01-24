/**
 * Copyright (c) 2025 BillChen
 *
 * Chat Mode - Formatter module
 * Markdown formatting, code highlighting, and text utilities
 */

Object.assign(ChatMode, {
  /**
   * Format message content (Markdown-like)
   */
  formatContent(content) {
    if (!content) return '';

    let html = this.escapeHtml(content);

    // Code blocks (```) - with copy button
    let codeBlockId = 0;
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const id = `code-${Date.now()}-${codeBlockId++}`;
      const langLabel = lang ? `<span class="code-lang">${lang}</span>` : '';
      const highlighted = this.highlightCode(code.trim(), lang);

      return `<div class="code-block-wrapper">
        <div class="code-block-header">
          ${langLabel}
          <button class="code-copy-btn" onclick="ChatMode.copyCode('${id}')" title="Copy code">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
        </div>
        <pre id="${id}"><code class="language-${lang}">${highlighted}</code></pre>
      </div>`;
    });

    // Inline code (`)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold (**)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic (*)
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
  },

  /**
   * Simple syntax highlighting using regex
   */
  highlightCode(code, lang = '') {
    if (!code) return '';

    // Escape HTML first
    let escaped = this.escapeHtml(code);

    // Basic keywords
    const keywords = ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'export', 'import', 'from', 'class', 'extends', 'async', 'await', 'try', 'catch', 'finally', 'new', 'this', 'super'];
    const keywordRegex = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g');

    escaped = escaped.replace(keywordRegex, '<span class="hl-keyword">$1</span>');

    // Strings
    escaped = escaped.replace(/(["'])(?:(?=(\\?))\2.)*?\1/g, '<span class="hl-string">$&</span>');

    // Numbers
    escaped = escaped.replace(/\b\d+(\.\d+)?\b/g, '<span class="hl-number">$&</span>');

    // Booleans
    escaped = escaped.replace(/\b(true|false|null|undefined)\b/g, '<span class="hl-bool">$1</span>');

    // Comments
    escaped = escaped.replace(/\/\/.*/g, '<span class="hl-comment">$&</span>');
    escaped = escaped.replace(/\/\*[\s\S]*?\*\//g, '<span class="hl-comment">$&</span>');

    return escaped;
  },

  /**
   * Highlight pattern matches in text
   */
  highlightPattern(text, pattern) {
    if (!pattern) return this.escapeHtml(text);

    try {
      const escaped = this.escapeHtml(text);
      const regex = new RegExp(`(${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      return escaped.replace(regex, '<mark class="grep-match">$1</mark>');
    } catch (e) {
      return this.escapeHtml(text);
    }
  },

  /**
   * Copy code to clipboard
   */
  copyCode(codeId) {
    const codeEl = document.getElementById(codeId);
    if (!codeEl) return;

    const code = codeEl.textContent;
    navigator.clipboard.writeText(code).then(() => {
      // Show feedback
      const btn = codeEl.parentElement?.querySelector('.code-copy-btn');
      if (btn) {
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 6L9 17l-5-5"/>
        </svg>`;
        btn.classList.add('copied');
        setTimeout(() => {
          btn.innerHTML = originalHtml;
          btn.classList.remove('copied');
        }, 2000);
      }
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  },

  /**
   * Format timestamp for display
   */
  formatTimestamp(timestamp) {
    if (!timestamp) return '';
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();

      if (isToday) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
               ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    } catch (e) {
      return '';
    }
  }
});
