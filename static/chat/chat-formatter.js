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

    // Inline code (`) - check for file paths inside
    html = html.replace(/`([^`]+)`/g, (match, code) => {
      // Check if the code looks like a file path
      if (this.looksLikeFilePath(code)) {
        return `<code class="file-link" data-path="${this.escapeHtml(code)}" onclick="ChatMode.openFilePath('${this.escapeHtml(code)}')">${this.escapeHtml(code)}</code>`;
      }
      return `<code>${code}</code>`;
    });

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
  },

  /**
   * Check if a string looks like a file path
   */
  looksLikeFilePath(text) {
    if (!text || text.length < 3) return false;

    // Remove trailing line number (e.g., :123 or :123:45)
    const pathPart = text.replace(/:\d+(:\d+)?$/, '');

    // Common file extensions that we can preview
    const previewableExts = [
      '.txt', '.log', '.text',
      '.json', '.xml', '.yaml', '.yml', '.toml', '.csv', '.tsv',
      '.md', '.markdown', '.rst', '.tex',
      '.py', '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
      '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx',
      '.java', '.kt', '.kts', '.scala', '.groovy',
      '.go', '.rs', '.rb', '.php', '.swift', '.m', '.mm',
      '.lua', '.r', '.R', '.pl', '.pm',
      '.html', '.htm', '.css', '.scss', '.sass', '.less', '.vue', '.svelte',
      '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
      '.conf', '.ini', '.cfg', '.config', '.properties', '.plist',
      '.env', '.gitignore', '.gitattributes', '.dockerignore', '.editorconfig',
      '.sql', '.vim', '.el', '.clj', '.cljs', '.edn', '.ex', '.exs',
      '.erl', '.hrl', '.hs', '.lhs', '.ml', '.mli', '.fs', '.fsx', '.dart', '.nim'
    ];

    // Check if it has a previewable extension
    const ext = pathPart.substring(pathPart.lastIndexOf('.')).toLowerCase();
    const hasPreviewableExt = previewableExts.includes(ext);

    // Check if it looks like a path (has / or starts with ./ or ../)
    const looksLikePath = pathPart.includes('/') ||
                          pathPart.startsWith('./') ||
                          pathPart.startsWith('../') ||
                          pathPart.startsWith('~');

    // Either: has a previewable extension AND looks like a path
    // Or: is an absolute path starting with /
    return (hasPreviewableExt && looksLikePath) ||
           (pathPart.startsWith('/') && hasPreviewableExt);
  },

  /**
   * Open a file path in the file browser
   */
  openFilePath(path) {
    if (!path) return;

    console.log('[ChatMode] openFilePath called:', path);

    // Remove trailing line number if present (e.g., :123 or :123:45)
    const cleanPath = path.replace(/:\d+(:\d+)?$/, '');

    // Get current session's working directory
    const currentSession = window.sessionManager?.getCurrentSession();
    const workingDir = currentSession?.workDir || '~';

    console.log('[ChatMode] openFilePath: workingDir=', workingDir, 'cleanPath=', cleanPath);

    // Resolve relative path
    let fullPath = cleanPath;
    if (!cleanPath.startsWith('/') && !cleanPath.startsWith('~')) {
      // Relative path - prepend working directory
      fullPath = workingDir + '/' + cleanPath;
    }

    console.log('[ChatMode] openFilePath: fullPath=', fullPath, 'app.openFileFromChat=', !!window.app?.openFileFromChat);

    // Minimize chat window first so preview modal is visible
    this.minimize?.();

    // Call the global file opener function
    if (window.app?.openFileFromChat) {
      window.app.openFileFromChat(fullPath);
    } else {
      console.warn('File opener not available');
    }
  }
});
