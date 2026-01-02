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
 * Download Module
 * Provides file browser and download functionality
 */
const AppDownload = {
  // Current download state
  _currentPath: '~',
  _showHidden: false,

  /**
   * Initialize download functionality
   */
  initDownload() {
    const menuDownload = document.getElementById('menu-download');
    const menuDownloadHistory = document.getElementById('menu-download-history');

    if (menuDownload) {
      menuDownload.addEventListener('click', () => {
        this.showFileBrowser();
      });
    }

    if (menuDownloadHistory) {
      menuDownloadHistory.addEventListener('click', () => {
        this.showDownloadHistory();
      });
    }
  },

  /**
   * Show file browser page
   */
  async showFileBrowser() {
    const menu = document.getElementById('settings-menu');
    const backBtn = document.getElementById('settings-back-btn');
    const modalTitle = document.getElementById('settings-modal-title');

    if (menu) menu.style.display = 'none';
    if (backBtn) backBtn.classList.remove('hidden');
    if (modalTitle) modalTitle.textContent = this.t('download.browserTitle', 'File Browser');

    // Create or get browser page
    let browserPage = document.getElementById('settings-file-browser');
    if (!browserPage) {
      browserPage = document.createElement('div');
      browserPage.id = 'settings-file-browser';
      browserPage.className = 'settings-page';
      document.querySelector('#settings-modal .modal-body').appendChild(browserPage);
    }

    browserPage.classList.add('active');
    this._currentPath = '~';
    // 确保 _showHidden 有默认值
    if (typeof this._showHidden === 'undefined') {
      this._showHidden = false;
    }
    await this.loadDirectory('~', browserPage);
  },

  /**
   * Load directory contents
   * @param {string} path - Directory path
   * @param {HTMLElement} container - Container element
   */
  async loadDirectory(path, container) {
    container.innerHTML = `<div class="loading">${this.t('common.loading', 'Loading...')}</div>`;

    try {
      const url = `/api/files?path=${encodeURIComponent(path)}&show_hidden=${this._showHidden}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (!response.ok) {
        const error = await response.json();
        const detail = typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail);
        throw new Error(detail || 'Failed to load directory');
      }

      const data = await response.json();
      this._currentPath = data.path;

      container.innerHTML = this.renderFileBrowser(data);
      this.bindFileBrowserEvents(container, data.parent);

    } catch (error) {
      console.error('Load directory error:', error);
      container.innerHTML = `
        <div class="error-state">
          <div class="error-text">${error.message}</div>
          <button class="btn btn-primary" onclick="window.app.loadDirectory('~', this.closest('.settings-page'))">
            ${this.t('download.goHome', 'Go Home')}
          </button>
        </div>
      `;
    }
  },

  /**
   * Render file browser UI
   * @param {Object} data - Directory data
   */
  renderFileBrowser(data) {
    const items = data.items || [];
    const pathParts = data.path.split('/').filter(p => p);

    const hiddenBtnClass = this._showHidden ? 'active' : '';
    let html = `
      <div class="file-browser">
        <div class="file-browser-header">
          <div class="file-browser-path">
            <button class="btn-path-home" data-path="~">~</button>
            ${pathParts.map((part, idx) => {
              const fullPath = '/' + pathParts.slice(0, idx + 1).join('/');
              return `<span class="path-sep">/</span><button class="btn-path-part" data-path="${fullPath}">${part}</button>`;
            }).join('')}
          </div>
          <div class="file-browser-actions">
            <button class="btn-toggle-hidden ${hiddenBtnClass}" title="${this.t('download.showHidden', 'Show hidden files')}">.*</button>
            ${data.parent ? `<button class="btn-path-up" data-path="${data.parent}">↑</button>` : ''}
          </div>
        </div>
        <div class="file-browser-list">
    `;

    if (items.length === 0) {
      html += `<div class="empty-state">${this.t('download.emptyDir', 'Empty directory')}</div>`;
    } else {
      for (const item of items) {
        const icon = item.is_dir ? '📁' : this.getFileIcon(item.name);
        const sizeStr = item.is_dir ? '' : this.formatFileSize(item.size);
        const dateStr = this.formatDate(item.modified);
        const clickable = item.readable ? '' : 'disabled';

        const canPreview = !item.is_dir && this.canPreview(item.name);
        html += `
          <div class="file-item ${item.is_dir ? 'dir' : 'file'} ${clickable}"
               data-path="${item.path}"
               data-is-dir="${item.is_dir}"
               data-can-preview="${canPreview}"
               data-readable="${item.readable}">
            <span class="file-icon">${icon}</span>
            <div class="file-info">
              <span class="file-name">${item.name}</span>
              <span class="file-meta">${sizeStr}${sizeStr && dateStr ? ' · ' : ''}${dateStr}</span>
            </div>
            ${canPreview && item.readable ? `<button class="btn-preview-file">👁</button>` : ''}
            ${!item.is_dir && item.readable ? `<button class="btn-download-file">↓</button>` : ''}
          </div>
        `;
      }
    }

    html += '</div></div>';
    return html;
  },

  /**
   * Bind file browser events
   * @param {HTMLElement} container - Container element
   * @param {string} parentPath - Parent directory path
   */
  bindFileBrowserEvents(container, parentPath) {
    // Toggle hidden files
    const toggleHiddenBtn = container.querySelector('.btn-toggle-hidden');
    if (toggleHiddenBtn) {
      toggleHiddenBtn.addEventListener('click', () => {
        this._showHidden = !this._showHidden;
        this.loadDirectory(this._currentPath, container);
      });
    }

    // Path navigation
    container.querySelectorAll('.btn-path-home, .btn-path-part, .btn-path-up').forEach(btn => {
      btn.addEventListener('click', () => {
        const path = btn.dataset.path;
        this.loadDirectory(path, container);
      });
    });

    // File/directory click
    container.querySelectorAll('.file-item').forEach(item => {
      const isDir = item.dataset.isDir === 'true';
      const readable = item.dataset.readable === 'true';
      const path = item.dataset.path;

      if (isDir && readable) {
        item.addEventListener('click', (e) => {
          if (!e.target.classList.contains('btn-download-file')) {
            this.loadDirectory(path, container);
          }
        });
      }

      // Preview button
      const previewBtn = item.querySelector('.btn-preview-file');
      if (previewBtn) {
        previewBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.previewFile(path);
        });
      }

      // Download button
      const downloadBtn = item.querySelector('.btn-download-file');
      if (downloadBtn) {
        downloadBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.downloadFile(path);
        });
      }
    });
  },

  /**
   * Download a file
   * @param {string} path - File path
   */
  async downloadFile(path) {
    const filename = path.split('/').pop();
    this.debugLog(`Download started: ${filename}`);
    this.closeSettingsModal();

    try {
      // Create download link
      const response = await fetch(`/api/download?path=${encodeURIComponent(path)}`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Download failed');
      }

      // Get blob and trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      this.debugLog(`Download completed: ${filename}`);
      this.showToast(this.t('download.success', 'Download started'), 'success');

    } catch (error) {
      this.debugLog(`Download failed: ${filename} - ${error.message}`);
      this.showToast(error.message, 'error');
    }
  },

  /**
   * Show download history page
   */
  async showDownloadHistory() {
    const menu = document.getElementById('settings-menu');
    const backBtn = document.getElementById('settings-back-btn');
    const modalTitle = document.getElementById('settings-modal-title');

    if (menu) menu.style.display = 'none';
    if (backBtn) backBtn.classList.remove('hidden');
    if (modalTitle) modalTitle.textContent = this.t('download.historyTitle', 'Download History');

    // Create or get history page
    let historyPage = document.getElementById('settings-download-history');
    if (!historyPage) {
      historyPage = document.createElement('div');
      historyPage.id = 'settings-download-history';
      historyPage.className = 'settings-page';
      document.querySelector('#settings-modal .modal-body').appendChild(historyPage);
    }

    historyPage.classList.add('active');
    historyPage.innerHTML = `<div class="loading">${this.t('common.loading', 'Loading...')}</div>`;

    try {
      const response = await fetch('/api/downloads', {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (!response.ok) {
        throw new Error('Failed to load history');
      }

      const data = await response.json();
      const downloads = data.downloads || [];

      if (downloads.length === 0) {
        historyPage.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📥</div>
            <div class="empty-text">${this.t('download.noHistory', 'No download history')}</div>
          </div>
        `;
        return;
      }

      historyPage.innerHTML = `
        <div class="download-history-list">
          ${downloads.map(item => this.renderDownloadHistoryItem(item)).join('')}
        </div>
      `;

    } catch (error) {
      console.error('Load download history error:', error);
      historyPage.innerHTML = `
        <div class="error-state">
          <div class="error-text">${this.t('download.loadError', 'Failed to load history')}</div>
        </div>
      `;
    }
  },

  /**
   * Render download history item
   * @param {Object} item - History item
   */
  renderDownloadHistoryItem(item) {
    const statusIcon = item.status === 'success' ? '✓' : '✗';
    const statusClass = item.status === 'success' ? 'success' : 'failed';
    const sizeStr = this.formatFileSize(item.size);
    const dateStr = this.formatDateTime(item.created_at);
    const durationStr = item.duration ? `${item.duration.toFixed(1)}s` : '';

    return `
      <div class="download-history-item ${statusClass}">
        <div class="download-history-icon">${statusIcon}</div>
        <div class="download-history-info">
          <div class="download-history-filename">${item.filename}</div>
          <div class="download-history-meta">
            ${sizeStr}${durationStr ? ' · ' + durationStr : ''} · ${dateStr}
          </div>
          ${item.error ? `<div class="download-history-error">${item.error}</div>` : ''}
        </div>
      </div>
    `;
  },

  /**
   * Get preview type for a file
   * @param {string} filename - File name
   * @returns {string|null} - 'image', 'text', 'code', or null
   */
  getPreviewType(filename) {
    const ext = filename.split('.').pop().toLowerCase();

    // Images
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) {
      return 'image';
    }

    // Code/structured files
    if (['json', 'xml', 'yaml', 'yml', 'html', 'css', 'js', 'ts', 'py', 'sh', 'bash', 'zsh'].includes(ext)) {
      return 'code';
    }

    // Text files
    if (['txt', 'log', 'md', 'markdown', 'csv', 'ini', 'conf', 'config', 'env'].includes(ext)) {
      return 'text';
    }

    return null;
  },

  /**
   * Check if file can be previewed
   * @param {string} filename - File name
   */
  canPreview(filename) {
    return this.getPreviewType(filename) !== null;
  },

  /**
   * Preview file
   * @param {string} path - File path
   */
  async previewFile(path) {
    const filename = path.split('/').pop();
    const previewType = this.getPreviewType(filename);

    // Create preview modal
    const modal = document.createElement('div');
    modal.id = 'file-preview-modal';
    modal.className = 'modal file-preview-modal active';
    modal.innerHTML = `
      <div class="modal-content file-preview-content">
        <div class="modal-header">
          <div class="modal-header-left"></div>
          <h2>${filename}</h2>
          <div class="modal-header-right">
            <button id="file-preview-close" class="btn-close">&times;</button>
          </div>
        </div>
        <div class="modal-body file-preview-body">
          <div class="loading">${this.t('common.loading', 'Loading...')}</div>
        </div>
        <div class="file-preview-actions">
          <button id="file-preview-download" class="btn btn-primary">
            ↓ ${this.t('download.download', 'Download')}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Bind events
    const closeBtn = document.getElementById('file-preview-close');
    const downloadBtn = document.getElementById('file-preview-download');
    const body = modal.querySelector('.file-preview-body');

    closeBtn.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    downloadBtn.addEventListener('click', () => {
      modal.remove();
      this.downloadFile(path);
    });

    // Load file
    try {
      const response = await fetch(`/api/download?path=${encodeURIComponent(path)}`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (!response.ok) {
        throw new Error('Failed to load file');
      }

      if (previewType === 'image') {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        body.innerHTML = `<img src="${url}" alt="${filename}" class="preview-image" />`;

        // Clean up blob URL when modal closes
        const cleanup = () => window.URL.revokeObjectURL(url);
        closeBtn.addEventListener('click', cleanup);
        modal.addEventListener('click', (e) => {
          if (e.target === modal) cleanup();
        });
      } else {
        // Text/code preview
        const text = await response.text();
        const ext = filename.split('.').pop().toLowerCase();
        const langClass = ext === 'md' || ext === 'markdown' ? 'markdown' : ext;

        body.innerHTML = `<pre class="preview-text ${langClass}">${this.escapeHtml(text)}</pre>`;
      }

    } catch (error) {
      body.innerHTML = `<div class="error-state">${error.message}</div>`;
    }
  },

  /**
   * Escape HTML for safe display
   * @param {string} text - Text to escape
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * Get file icon based on extension
   * @param {string} filename - File name
   */
  getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
      // Images
      'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'bmp': '🖼️', 'svg': '🖼️', 'webp': '🖼️',
      // Videos
      'mp4': '🎬', 'avi': '🎬', 'mov': '🎬', 'mkv': '🎬', 'webm': '🎬',
      // Audio
      'mp3': '🎵', 'wav': '🎵', 'flac': '🎵', 'aac': '🎵', 'ogg': '🎵',
      // Documents
      'pdf': '📄', 'doc': '📄', 'docx': '📄', 'xls': '📊', 'xlsx': '📊', 'ppt': '📊', 'pptx': '📊',
      // Code
      'js': '📝', 'ts': '📝', 'py': '📝', 'java': '📝', 'c': '📝', 'cpp': '📝', 'h': '📝',
      'html': '📝', 'css': '📝', 'json': '📝', 'xml': '📝', 'md': '📝',
      // Archives
      'zip': '📦', 'rar': '📦', 'tar': '📦', 'gz': '📦', '7z': '📦',
      // Text
      'txt': '📃', 'log': '📃', 'csv': '📃',
    };
    return icons[ext] || '📄';
  },

  /**
   * Format file size
   * @param {number} bytes - Size in bytes
   */
  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  },

  /**
   * Format date (relative or absolute)
   * @param {number} timestamp - Unix timestamp
   */
  formatDate(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  },

  /**
   * Format datetime
   * @param {string} isoString - ISO date string
   */
  formatDateTime(isoString) {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();

      if (isToday) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
          ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    } catch (e) {
      return isoString;
    }
  }
};

// Export to global
window.AppDownload = AppDownload;
