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
 * Files Module
 * Provides file browser functionality for the third swipe page
 */
// Previewable file extensions
const PREVIEW_TEXT_EXTS = new Set([
  // 基础文本
  '.txt', '.log', '.text',
  // 数据格式
  '.json', '.xml', '.yaml', '.yml', '.toml', '.csv', '.tsv',
  // Markdown / 文档
  '.md', '.markdown', '.rst', '.tex',
  // 编程语言
  '.py', '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx',
  '.java', '.kt', '.kts', '.scala', '.groovy',
  '.go', '.rs', '.rb', '.php', '.swift', '.m', '.mm',
  '.lua', '.r', '.R', '.pl', '.pm',
  // Web
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.vue', '.svelte',
  // Shell / 脚本
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  // 配置文件
  '.conf', '.ini', '.cfg', '.config', '.properties', '.plist',
  '.env', '.gitignore', '.gitattributes', '.dockerignore', '.editorconfig',
  // SQL
  '.sql',
  // 其他
  '.vim', '.el', '.clj', '.cljs', '.edn', '.ex', '.exs', '.erl', '.hrl',
  '.hs', '.lhs', '.ml', '.mli', '.fs', '.fsx', '.dart', '.nim',
]);
const PREVIEW_IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.tiff', '.tif'
]);
// 不预览的二进制/媒体文件
const NON_PREVIEW_EXTS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm', '.m4v',
  '.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a',
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar', '.dmg', '.iso',
  '.exe', '.dll', '.so', '.dylib', '.app', '.msi',
  '.bin', '.dat', '.db', '.sqlite', '.sqlite3',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
]);
const MAX_PREVIEW_SIZE = 5 * 1024 * 1024; // 5MB

// File icon mapping based on extension
const FILE_ICONS = {
  // Code files
  '.js': '⌘', '.ts': '⌘', '.jsx': '⌘', '.tsx': '⌘', '.mjs': '⌘', '.cjs': '⌘',
  '.py': '⌘', '.rb': '⌘', '.php': '⌘', '.java': '⌘', '.kt': '⌘',
  '.c': '⌘', '.cpp': '⌘', '.h': '⌘', '.hpp': '⌘',
  '.go': '⌘', '.rs': '⌘', '.swift': '⌘', '.m': '⌘',
  '.sh': '⌘', '.bash': '⌘', '.zsh': '⌘',
  // Web files
  '.html': '◇', '.htm': '◇', '.css': '◇', '.scss': '◇', '.less': '◇',
  '.vue': '◇', '.svelte': '◇',
  // Data files
  '.json': '{ }', '.xml': '◈', '.yaml': '◈', '.yml': '◈', '.toml': '◈',
  '.csv': '▦', '.tsv': '▦',
  // Document files
  '.md': '≡', '.markdown': '≡', '.txt': '≡', '.text': '≡',
  '.pdf': '▤', '.doc': '▤', '.docx': '▤',
  '.xls': '▥', '.xlsx': '▥',
  '.ppt': '▧', '.pptx': '▧',
  // Image files
  '.png': '▣', '.jpg': '▣', '.jpeg': '▣', '.gif': '▣', '.webp': '▣',
  '.svg': '▣', '.ico': '▣', '.bmp': '▣',
  // Audio/Video
  '.mp3': '♪', '.wav': '♪', '.flac': '♪', '.aac': '♪', '.ogg': '♪',
  '.mp4': '▶', '.mov': '▶', '.avi': '▶', '.mkv': '▶', '.webm': '▶',
  // Archive
  '.zip': '▢', '.tar': '▢', '.gz': '▢', '.bz2': '▢', '.7z': '▢', '.rar': '▢',
  // Config
  '.env': '⚙', '.gitignore': '⚙', '.dockerignore': '⚙', '.editorconfig': '⚙',
  '.conf': '⚙', '.ini': '⚙', '.cfg': '⚙', '.config': '⚙',
  // Database
  '.sql': '⌸', '.db': '⌸', '.sqlite': '⌸', '.sqlite3': '⌸',
  // Lock files
  '.lock': '⊡',
  // Log files
  '.log': '≣',
};

const AppFiles = {
  /**
   * Initialize Files page
   */
  initFiles() {
    // Initialize state (properties can't be mixed in via mixin)
    // Only initialize if not already set (loadFilesPage might have been called before initFiles)
    if (this._currentPath === undefined) this._currentPath = '~';
    if (this._pathHistory === undefined) this._pathHistory = [];
    if (this._showHidden === undefined) this._showHidden = false;
    if (this._filesLoaded === undefined) this._filesLoaded = false;
    if (this._isGoingBack === undefined) this._isGoingBack = false;
    if (this._currentPreviewPath === undefined) this._currentPreviewPath = null;
    if (this._sortMode === undefined) this._sortMode = 0; // 0=A↓, 1=A↑, 2=T↓, 3=T↑
    if (this._previewFontSize === undefined) this._previewFontSize = 14; // default font size for preview
    if (this._fileFavorites === undefined) this._fileFavorites = this.loadFileFavorites();

    // Bind back button
    const backBtn = document.getElementById('files-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => this.goFilesBack());
    }

    // Bind hidden files toggle button
    const hiddenBtn = document.getElementById('files-hidden-btn');
    if (hiddenBtn) {
      hiddenBtn.addEventListener('click', () => this.toggleHiddenFiles());
    }

    // Bind sort button
    const sortBtn = document.getElementById('files-sort-btn');
    if (sortBtn) {
      sortBtn.addEventListener('click', () => this.toggleSort());
    }

    // Bind menu button
    const menuBtn = document.getElementById('files-menu-btn');
    if (menuBtn) {
      menuBtn.addEventListener('click', (e) => this.showFilesMenu(e));
    }

    // Bind confirm modal events
    this.bindFileConfirmEvents();

    // Bind preview modal events
    this.bindFilePreviewEvents();

    // Update button states
    this.updateFilesButtonStates();

    // Render favorites bar
    this.renderFileFavorites();
  },

  /**
   * Load favorites from localStorage
   */
  loadFileFavorites() {
    try {
      const data = localStorage.getItem('file_favorites');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  /**
   * Save favorites to localStorage
   */
  saveFileFavorites() {
    localStorage.setItem('file_favorites', JSON.stringify(this._fileFavorites || []));
  },

  /**
   * Add path to favorites
   */
  addToFavorites(path, name) {
    if (!this._fileFavorites) this._fileFavorites = [];
    // Check if already exists
    if (this._fileFavorites.some(f => f.path === path)) {
      this.showToast?.('Already in favorites') || alert('Already in favorites');
      return;
    }
    this._fileFavorites.push({ path, name });
    this.saveFileFavorites();
    this.renderFileFavorites();
    this.showToast?.('Added to favorites') || console.log('Added to favorites');
  },

  /**
   * Remove path from favorites
   */
  removeFromFavorites(path) {
    if (!this._fileFavorites) return;
    this._fileFavorites = this._fileFavorites.filter(f => f.path !== path);
    this.saveFileFavorites();
    this.renderFileFavorites();
  },

  /**
   * Render favorites bar
   */
  renderFileFavorites() {
    const container = document.getElementById('files-favorites');
    if (!container) return;

    const favorites = this._fileFavorites || [];
    if (favorites.length === 0) {
      container.classList.remove('has-items');
      container.innerHTML = '';
      return;
    }

    container.classList.add('has-items');
    container.innerHTML = favorites.map(fav => `
      <div class="files-fav-item" data-path="${this.escapeHtml(fav.path)}">
        <span class="fav-icon">★</span>
        <span class="fav-name">${this.escapeHtml(fav.name)}</span>
        <span class="fav-remove" data-remove="${this.escapeHtml(fav.path)}">×</span>
      </div>
    `).join('');

    // Bind events
    container.querySelectorAll('.files-fav-item').forEach(item => {
      const path = item.dataset.path;
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('fav-remove')) {
          e.stopPropagation();
          this.removeFromFavorites(e.target.dataset.remove);
        } else {
          this.loadFilesDirectory(path);
        }
      });
    });
  },

  /**
   * Load Files page (called when page becomes visible)
   */
  loadFilesPage() {
    if (this._filesLoaded) return;
    this._filesLoaded = true;
    // Initialize state if not already done (called before initFiles)
    if (this._currentPath === undefined) this._currentPath = '~';
    if (this._pathHistory === undefined) this._pathHistory = [];
    if (this._showHidden === undefined) this._showHidden = false;
    this.loadFilesDirectory(this._currentPath || '~');
  },

  /**
   * Load directory contents
   */
  async loadFilesDirectory(path) {
    const container = document.getElementById('files-list');
    const pathDisplay = document.getElementById('files-current-path');
    const backBtn = document.getElementById('files-back-btn');

    if (!container) return;

    container.innerHTML = `<div class="loading">${this.t('common.loading', 'Loading...')}</div>`;

    try {
      const url = `/api/files?path=${encodeURIComponent(path)}&show_hidden=${this._showHidden}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to load directory');
      }

      const data = await response.json();

      // Update state
      const oldPath = this._currentPath;
      this._currentPath = data.path;

      // Update path display (shortened)
      pathDisplay.textContent = this.shortenFilesPath(data.path);
      pathDisplay.title = data.path; // Full path as tooltip

      // Update back button state
      backBtn.disabled = !data.parent;

      // Add to history if navigating forward (not going back)
      if (data.parent && oldPath !== data.path && !this._isGoingBack) {
        this._pathHistory.push(oldPath);
      }
      this._isGoingBack = false;

      // Render file list
      this.renderFilesList(data.items, data.parent);

    } catch (error) {
      console.error('Load files error:', error);
      container.innerHTML = `
        <div class="empty">
          <div class="empty-icon">!</div>
          <div class="empty-text">${this.escapeHtml(error.message)}</div>
          <button class="btn btn-primary" onclick="window.app.loadFilesDirectory('~')">
            ${this.t('files.goHome', 'Go Home')}
          </button>
        </div>
      `;
    }
  },

  /**
   * Render files list (iPhone Files style)
   */
  renderFilesList(items, parentPath) {
    const container = document.getElementById('files-list');

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="empty">
          <div class="empty-icon">[ ]</div>
          <div class="empty-text">${this.t('files.empty', 'Empty folder')}</div>
        </div>
      `;
      return;
    }

    // Apply sorting
    const sortedItems = this.sortFileItems(items);

    let html = '';
    for (const item of sortedItems) {
      // Use file type icons
      const icon = this.getFileIcon(item.name, item.is_dir);
      const sizeStr = item.is_dir ? '' : this.formatFileSize(item.size);
      const rightContent = item.is_dir
        ? '<span class="files-item-arrow">›</span>'
        : `<span class="files-item-size">${sizeStr}</span>`;

      html += `
        <div class="files-item ${item.is_dir ? 'dir' : 'file'} ${item.readable ? '' : 'disabled'}"
             data-path="${this.escapeHtml(item.path)}"
             data-is-dir="${item.is_dir}"
             data-name="${this.escapeHtml(item.name)}"
             data-size="${item.size || 0}"
             data-modified="${item.modified || 0}"
             data-readable="${item.readable}">
          <span class="files-item-icon">${icon}</span>
          <span class="files-item-name">${this.escapeHtml(item.name)}</span>
          ${rightContent}
        </div>
      `;
    }

    container.innerHTML = html;
    this.bindFilesListEvents();

    // 强制 reflow，解决离屏页面不渲染的问题
    container.offsetHeight;
  },

  /**
   * Check if file can be previewed
   */
  canPreviewFile(name, size) {
    if (size > MAX_PREVIEW_SIZE) return false;
    const ext = this.getFileExtension(name);
    // 明确排除的二进制文件
    if (NON_PREVIEW_EXTS.has(ext)) return false;
    // 支持的文本和图片
    if (PREVIEW_TEXT_EXTS.has(ext) || PREVIEW_IMAGE_EXTS.has(ext)) return true;
    // 小文件（<100KB）也尝试预览
    if (size < 100 * 1024) return true;
    return false;
  },

  /**
   * Get file extension (lowercase)
   */
  getFileExtension(name) {
    const idx = name.lastIndexOf('.');
    return idx >= 0 ? name.slice(idx).toLowerCase() : '';
  },

  /**
   * Get file icon based on extension
   */
  getFileIcon(name, isDir) {
    if (isDir) return '<span class="folder-icon"></span>';
    const ext = this.getFileExtension(name);
    return FILE_ICONS[ext] || '─';
  },

  /**
   * Bind click events to file list items
   */
  bindFilesListEvents() {
    const container = document.getElementById('files-list');
    container.querySelectorAll('.files-item').forEach(item => {
      const isDir = item.dataset.isDir === 'true';
      const readable = item.dataset.readable === 'true';
      const path = item.dataset.path;
      const name = item.dataset.name;
      const size = parseInt(item.dataset.size) || 0;

      if (!readable) return;

      if (isDir) {
        // Directory: click to enter
        item.addEventListener('click', () => {
          this.loadFilesDirectory(path);
        });

        // Directory: long press to add to favorites
        let longPressTimer = null;
        item.addEventListener('touchstart', (e) => {
          longPressTimer = setTimeout(() => {
            e.preventDefault();
            this.addToFavorites(path, name);
            // Vibrate if supported
            if (navigator.vibrate) navigator.vibrate(50);
          }, 500);
        }, { passive: true });

        item.addEventListener('touchend', () => {
          if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
          }
        });

        item.addEventListener('touchmove', () => {
          if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
          }
        });
      } else {
        // File: check if previewable
        item.addEventListener('click', () => {
          if (this.canPreviewFile(name, size)) {
            // Open preview
            this.openFilePreview(path, name);
          } else {
            // Show download confirm modal
            this.showFileConfirmModal({
              path: path,
              name: name,
              size: size,
              modified: parseInt(item.dataset.modified) || 0
            });
          }
        });
      }
    });
  },

  /**
   * Go back to previous directory
   */
  goFilesBack() {
    if (this._pathHistory.length > 0) {
      this._isGoingBack = true;
      const previousPath = this._pathHistory.pop();
      this.loadFilesDirectory(previousPath);
    }
  },

  /**
   * Show file download confirm modal
   */
  showFileConfirmModal(file) {
    const modal = document.getElementById('file-confirm-modal');
    const iconEl = document.getElementById('file-confirm-icon');
    const nameEl = document.getElementById('file-confirm-name');
    const sizeEl = document.getElementById('file-confirm-size');
    const dateEl = document.getElementById('file-confirm-date');

    // Use simple symbol for file icon
    iconEl.textContent = '▢';
    nameEl.textContent = file.name;
    sizeEl.textContent = this.formatFileSize(file.size);
    dateEl.textContent = this.formatFullDate(file.modified);

    // Store file path for download
    modal.dataset.filePath = file.path;
    modal.classList.add('active');
  },

  /**
   * Close file confirm modal
   */
  closeFileConfirmModal() {
    const modal = document.getElementById('file-confirm-modal');
    modal.classList.remove('active');
  },

  /**
   * Bind confirm modal button events
   */
  bindFileConfirmEvents() {
    const modal = document.getElementById('file-confirm-modal');
    const cancelBtn = document.getElementById('file-confirm-cancel');
    const downloadBtn = document.getElementById('file-confirm-download');

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.closeFileConfirmModal());
    }

    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        const path = modal.dataset.filePath;
        this.closeFileConfirmModal();
        this.downloadFileFromPath(path);
      });
    }

    // Click backdrop to close
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.closeFileConfirmModal();
        }
      });
    }
  },

  /**
   * Download file from path
   */
  downloadFileFromPath(path) {
    // Create download link
    const url = `/api/download?path=${encodeURIComponent(path)}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = path.split('/').pop();

    // Add auth header via fetch for download
    fetch(url, {
      headers: { 'Authorization': `Bearer ${this.token}` }
    })
      .then(response => {
        if (!response.ok) throw new Error('Download failed');
        return response.blob();
      })
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        link.href = blobUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
        this.showToast(this.t('files.downloadStarted', 'Download started'));
      })
      .catch(error => {
        console.error('Download error:', error);
        this.showToast(this.t('files.downloadFailed', 'Download failed'));
      });
  },

  /**
   * Toggle hidden files visibility
   */
  toggleHiddenFiles() {
    this._showHidden = !this._showHidden;
    this.updateFilesButtonStates();
    this.loadFilesDirectory(this._currentPath);
  },

  /**
   * Toggle sort mode (4 modes: A↓ → A↑ → T↓ → T↑)
   * 0: name asc (A-Z)
   * 1: name desc (Z-A)
   * 2: time desc (newest first)
   * 3: time asc (oldest first)
   */
  toggleSort() {
    // Initialize sort mode if not set
    if (this._sortMode === undefined) {
      this._sortMode = 0;
    }
    // Cycle through 4 modes
    this._sortMode = (this._sortMode + 1) % 4;
    this.updateFilesButtonStates();
    this.loadFilesDirectory(this._currentPath);
  },

  /**
   * Update button states to reflect current settings
   */
  updateFilesButtonStates() {
    const hiddenBtn = document.getElementById('files-hidden-btn');
    const sortBtn = document.getElementById('files-sort-btn');

    if (hiddenBtn) {
      hiddenBtn.classList.toggle('active', this._showHidden);
      hiddenBtn.title = this._showHidden
        ? this.t('files.hideHidden', 'Hide Hidden Files')
        : this.t('files.showHidden', 'Show Hidden Files');
    }

    if (sortBtn) {
      // Sort mode icons and titles
      const modes = [
        { icon: 'A↓', title: 'files.sortNameAsc', default: 'Name A-Z' },
        { icon: 'A↑', title: 'files.sortNameDesc', default: 'Name Z-A' },
        { icon: 'T↓', title: 'files.sortTimeDesc', default: 'Newest First' },
        { icon: 'T↑', title: 'files.sortTimeAsc', default: 'Oldest First' }
      ];
      const mode = modes[this._sortMode || 0];
      sortBtn.textContent = mode.icon;
      sortBtn.title = this.t(mode.title, mode.default);
    }
  },

  /**
   * Sort items based on current sort settings
   */
  sortFileItems(items) {
    if (!items) return items;

    const sortMode = this._sortMode || 0;

    return [...items].sort((a, b) => {
      // Directories always first
      if (a.is_dir !== b.is_dir) {
        return a.is_dir ? -1 : 1;
      }

      let cmp;
      if (sortMode <= 1) {
        // Sort by name
        cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        return sortMode === 0 ? cmp : -cmp; // 0=asc, 1=desc
      } else {
        // Sort by time
        cmp = (a.modified || 0) - (b.modified || 0);
        return sortMode === 2 ? -cmp : cmp; // 2=desc (newest), 3=asc (oldest)
      }
    });
  },

  /**
   * Show files menu popup
   */
  showFilesMenu(e) {
    // Remove existing popup
    const existing = document.querySelector('.files-menu-popup');
    if (existing) {
      existing.remove();
      return;
    }

    const popup = document.createElement('div');
    popup.className = 'files-menu-popup';
    popup.innerHTML = `
      <div class="files-menu-item" id="files-menu-upload">
        <span class="files-menu-icon">↟</span>
        <span>${this.t('files.uploadFile', 'Upload File')}</span>
      </div>
      <div class="files-menu-divider"></div>
      <div class="files-menu-item" id="files-menu-root">
        <span class="files-menu-icon">/</span>
        <span>${this.t('files.goToRoot', 'Go to Root')}</span>
      </div>
      <div class="files-menu-item" id="files-menu-home">
        <span class="files-menu-icon">~</span>
        <span>${this.t('files.goHome', 'Go Home')}</span>
      </div>
      <div class="files-menu-divider"></div>
      <div class="files-menu-item" id="files-menu-upload-history">
        <span class="files-menu-icon">↑</span>
        <span>${this.t('files.uploadHistory', 'Upload History')}</span>
      </div>
      <div class="files-menu-item" id="files-menu-download-history">
        <span class="files-menu-icon">↓</span>
        <span>${this.t('files.downloadHistory', 'Download History')}</span>
      </div>
    `;

    document.body.appendChild(popup);

    // Position below button
    const btn = e.target;
    const rect = btn.getBoundingClientRect();
    popup.style.top = (rect.bottom + 8) + 'px';
    popup.style.right = (window.innerWidth - rect.right) + 'px';

    // Bind events
    popup.querySelector('#files-menu-upload').addEventListener('click', () => {
      popup.remove();
      // Trigger file input click
      const fileInput = document.getElementById('file-input');
      if (fileInput) {
        fileInput.click();
      }
    });

    popup.querySelector('#files-menu-root').addEventListener('click', () => {
      popup.remove();
      this.loadFilesDirectory('/');
    });

    popup.querySelector('#files-menu-home').addEventListener('click', () => {
      popup.remove();
      this.loadFilesDirectory('~');
    });

    popup.querySelector('#files-menu-upload-history').addEventListener('click', () => {
      popup.remove();
      this.showUploadHistory();
    });

    popup.querySelector('#files-menu-download-history').addEventListener('click', () => {
      popup.remove();
      this.showDownloadHistory();
    });

    // Click outside to close
    setTimeout(() => {
      const closeMenu = (e) => {
        if (!popup.contains(e.target)) {
          popup.remove();
          document.removeEventListener('click', closeMenu);
        }
      };
      document.addEventListener('click', closeMenu);
    }, 10);
  },

  // File history pagination state
  _fileHistoryType: null,
  _fileHistoryOffset: 0,
  _fileHistoryPageSize: 10,
  _fileHistoryLoading: false,
  _fileHistoryHasMore: true,

  /**
   * Show upload history
   */
  async showUploadHistory() {
    this._fileHistoryType = 'upload';
    this._fileHistoryOffset = 0;
    this._fileHistoryHasMore = true;

    await this.showFileHistoryModal(
      this.t('files.recentUploads', 'Upload History'),
      'upload'
    );
  },

  /**
   * Show download history
   */
  async showDownloadHistory() {
    this._fileHistoryType = 'download';
    this._fileHistoryOffset = 0;
    this._fileHistoryHasMore = true;

    await this.showFileHistoryModal(
      this.t('files.recentDownloads', 'Download History'),
      'download'
    );
  },

  /**
   * Show file history modal with pagination
   * @param {string} title - Modal title
   * @param {string} type - 'upload' or 'download'
   */
  async showFileHistoryModal(title, type) {
    // Remove existing modal
    const existingModal = document.getElementById('file-history-modal');
    if (existingModal) {
      existingModal.remove();
    }

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'file-history-modal';
    modal.className = 'modal history-modal active';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <div class="modal-header-left"></div>
          <h2>${title}</h2>
          <div class="modal-header-right">
            <button id="file-history-modal-close" class="btn-close">&times;</button>
          </div>
        </div>
        <div class="modal-body" id="file-history-modal-body">
          <div id="file-history-content" class="history-content">
            <div class="file-history-list" id="file-history-list">
              <div class="file-history-loading">
                <div class="history-spinner"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Bind close events
    const closeBtn = document.getElementById('file-history-modal-close');
    closeBtn.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    // Load initial data
    await this.loadFileHistoryPage(type, true);

    // Setup scroll listener for infinite loading
    const modalBody = document.getElementById('file-history-modal-body');
    if (modalBody) {
      modalBody.addEventListener('scroll', () => {
        if (this._fileHistoryLoading || !this._fileHistoryHasMore) return;

        const { scrollTop, scrollHeight, clientHeight } = modalBody;
        // Load more when 100px from bottom
        if (scrollHeight - scrollTop - clientHeight < 100) {
          this.loadFileHistoryPage(type, false);
        }
      });
    }
  },

  /**
   * Load a page of file history
   * @param {string} type - 'upload' or 'download'
   * @param {boolean} isInitial - Is this the initial load
   */
  async loadFileHistoryPage(type, isInitial) {
    if (this._fileHistoryLoading) return;
    this._fileHistoryLoading = true;

    const list = document.getElementById('file-history-list');
    if (!list) {
      this._fileHistoryLoading = false;
      return;
    }

    // Show loader
    let loader = list.querySelector('.file-history-loading');
    if (!loader && !isInitial) {
      loader = document.createElement('div');
      loader.className = 'file-history-loading';
      loader.innerHTML = '<div class="history-spinner"></div>';
      list.appendChild(loader);
    }

    try {
      const endpoint = type === 'upload' ? '/api/uploads' : '/api/downloads';
      const pageSize = this._fileHistoryPageSize || 10;
      const offset = this._fileHistoryOffset || 0;
      const response = await fetch(
        `${endpoint}?limit=${pageSize}&offset=${offset}`,
        { headers: { 'Authorization': `Bearer ${this.token}` } }
      );

      if (!response.ok) throw new Error('Failed to load history');

      const data = await response.json();
      const items = type === 'upload' ? (data.uploads || []) : (data.downloads || []);

      // Remove loader
      if (loader) loader.remove();

      if (isInitial && items.length === 0) {
        list.innerHTML = `
          <div class="file-history-empty">
            ${this.t(type === 'upload' ? 'files.noUploads' : 'files.noDownloads', 'No history')}
          </div>
        `;
        this._fileHistoryHasMore = false;
        this._fileHistoryLoading = false;
        return;
      }

      // Render items
      const html = items.map(item => this.renderFileHistoryItem(item, type)).join('');

      if (isInitial) {
        list.innerHTML = html;
      } else {
        list.insertAdjacentHTML('beforeend', html);
      }

      // Bind copy buttons for new items
      list.querySelectorAll('.file-history-copy-btn:not([data-bound])').forEach(btn => {
        btn.dataset.bound = 'true';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const path = btn.dataset.path;
          this.copyToClipboard(path, true);  // showFeedback = true
        });
      });

      // Update pagination state
      this._fileHistoryOffset = (this._fileHistoryOffset || 0) + items.length;
      this._fileHistoryHasMore = items.length >= pageSize;

      // Show "no more" indicator if needed
      if (!this._fileHistoryHasMore && this._fileHistoryOffset > pageSize) {
        const noMore = document.createElement('div');
        noMore.className = 'file-history-no-more';
        noMore.textContent = this.t('files.noMoreHistory', 'No more history');
        list.appendChild(noMore);
      }

    } catch (error) {
      console.error('Load file history error:', error);
      if (loader) loader.remove();

      if (isInitial) {
        list.innerHTML = `
          <div class="file-history-error">
            ${this.t('files.historyFailed', 'Failed to load history')}
          </div>
        `;
      }
    } finally {
      this._fileHistoryLoading = false;
    }
  },

  /**
   * Render file history item
   * @param {Object} item - History item
   * @param {string} type - 'upload' or 'download'
   */
  renderFileHistoryItem(item, type) {
    const filename = item.filename || 'Unknown';
    const path = item.path || item.filepath || '';
    const status = item.status || 'unknown';
    const time = this.formatHistoryTime(item.created_at || item.timestamp);
    const size = item.size ? this.formatFileSize(item.size) : '';

    // Status icon
    let statusIcon = '⏳';
    let statusClass = 'pending';
    if (status === 'completed' || status === 'success') {
      statusIcon = '✓';
      statusClass = 'success';
    } else if (status === 'failed' || status === 'error') {
      statusIcon = '✕';
      statusClass = 'error';
    }

    return `
      <div class="file-history-item">
        <div class="file-history-status ${statusClass}">${statusIcon}</div>
        <div class="file-history-info">
          <div class="file-history-name">${this.escapeHtml(filename)}</div>
          <div class="file-history-meta">
            ${size ? `<span class="file-history-size">${size}</span>` : ''}
            <span class="file-history-time">${time}</span>
          </div>
          ${path ? `<div class="file-history-path">${this.escapeHtml(this.shortenFilesPath(path))}</div>` : ''}
        </div>
        ${path ? `<button class="file-history-copy-btn" data-path="${this.escapeHtml(path)}" title="${this.t('files.copyPath', 'Copy Path')}">⎘</button>` : ''}
      </div>
    `;
  },

  /**
   * Format history time
   */
  formatHistoryTime(isoString) {
    if (!isoString) return '';
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
      return '';
    }
  },

  /**
   * Copy text to clipboard
   */
  copyToClipboard(text) {
    // 优先使用 Clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => {
          this.showToast(this.t('files.copied', 'Copied!'));
        })
        .catch((error) => {
          console.warn('Clipboard API failed, using fallback:', error);
          this.fallbackCopy(text);
        });
    } else {
      this.fallbackCopy(text);
    }
  },

  /**
   * Fallback copy method for older browsers
   */
  fallbackCopy(text) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (success) {
        this.showToast(this.t('files.copied', 'Copied!'));
      } else {
        this.showToast(this.t('files.copyFailed', 'Copy failed'), 'error');
      }
    } catch (error) {
      console.error('Fallback copy failed:', error);
      this.showToast(this.t('files.copyFailed', 'Copy failed'), 'error');
    }
  },

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * Shorten path for display
   */
  shortenFilesPath(path) {
    if (!path) return '~';
    // Try to shorten home directory
    const parts = path.split('/');
    if (parts.length >= 3 && parts[1] === 'Users') {
      const home = `/Users/${parts[2]}`;
      if (path.startsWith(home)) {
        return '~' + path.slice(home.length);
      }
    }
    return path;
  },

  /**
   * Format full date for display
   */
  formatFullDate(timestamp) {
    if (!timestamp) return '--';
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  },

  /**
   * Open file preview
   */
  async openFilePreview(path, name) {
    const modal = document.getElementById('file-preview-modal');
    const nameEl = document.getElementById('preview-file-name');
    const bodyEl = document.getElementById('file-preview-body');
    const loadingEl = document.getElementById('preview-loading');
    const errorEl = document.getElementById('preview-error');

    // Reset state
    this._currentPreviewPath = path;
    nameEl.textContent = name;

    // Clear previous content (keep loading and error elements)
    bodyEl.querySelectorAll('.preview-content').forEach(el => el.remove());
    errorEl.style.display = 'none';
    loadingEl.style.display = 'block';
    loadingEl.textContent = 'Loading...';

    modal.classList.add('active');

    try {
      const url = `/api/preview?path=${encodeURIComponent(path)}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Preview failed');
      }

      const data = await response.json();
      loadingEl.style.display = 'none';

      if (data.type === 'image') {
        this.renderImagePreview(bodyEl, data);
      } else if (data.type === 'csv') {
        this.renderCsvPreview(bodyEl, data);
      } else if (data.type === 'text') {
        this.renderTextPreview(bodyEl, data);
      }

    } catch (error) {
      console.error('Preview error:', error);
      loadingEl.style.display = 'none';
      errorEl.textContent = error.message;
      errorEl.style.display = 'block';
    }
  },

  /**
   * Render image preview with zoom, rotate, and pan support
   */
  renderImagePreview(container, data) {
    const wrapper = document.createElement('div');
    wrapper.className = 'preview-content preview-image-wrapper';

    const img = document.createElement('img');
    img.className = 'preview-image';
    img.src = data.data;
    img.alt = data.name;
    img.draggable = false;

    // State
    let scale = 1;
    let rotation = 0;
    let translateX = 0;
    let translateY = 0;
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;
    let lastDistance = 0;

    const updateTransform = () => {
      img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale}) rotate(${rotation}deg)`;
    };

    // 旋转按钮容器
    const controls = document.createElement('div');
    controls.className = 'preview-image-controls';
    controls.innerHTML = `
      <button class="preview-ctrl-btn" data-action="rotate-left" title="Rotate Left">↺</button>
      <button class="preview-ctrl-btn" data-action="rotate-right" title="Rotate Right">↻</button>
      <button class="preview-ctrl-btn" data-action="zoom-in" title="Zoom In">+</button>
      <button class="preview-ctrl-btn" data-action="zoom-out" title="Zoom Out">−</button>
      <button class="preview-ctrl-btn" data-action="reset" title="Reset">⟲</button>
    `;

    controls.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'rotate-left') {
        rotation -= 90;
      } else if (action === 'rotate-right') {
        rotation += 90;
      } else if (action === 'zoom-in') {
        scale = Math.min(scale * 1.5, 10);
      } else if (action === 'zoom-out') {
        scale = Math.max(scale / 1.5, 0.1);
      } else if (action === 'reset') {
        scale = 1;
        rotation = 0;
        translateX = 0;
        translateY = 0;
      }
      updateTransform();
    });

    // 双击重置
    img.addEventListener('dblclick', () => {
      scale = 1;
      rotation = 0;
      translateX = 0;
      translateY = 0;
      updateTransform();
    });

    // 鼠标拖动
    wrapper.addEventListener('mousedown', (e) => {
      if (scale > 1) {
        isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        wrapper.style.cursor = 'grabbing';
      }
    });

    wrapper.addEventListener('mousemove', (e) => {
      if (isDragging) {
        translateX += e.clientX - lastX;
        translateY += e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        updateTransform();
      }
    });

    wrapper.addEventListener('mouseup', () => {
      isDragging = false;
      wrapper.style.cursor = scale > 1 ? 'grab' : 'default';
    });

    wrapper.addEventListener('mouseleave', () => {
      isDragging = false;
      wrapper.style.cursor = 'default';
    });

    // 触摸支持（双指缩放和拖动）
    let initialDistance = 0;
    let initialScale = 1;

    wrapper.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        // 双指缩放
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        initialDistance = Math.sqrt(dx * dx + dy * dy);
        initialScale = scale;
      } else if (e.touches.length === 1 && scale > 1) {
        // 单指拖动
        isDragging = true;
        lastX = e.touches[0].clientX;
        lastY = e.touches[0].clientY;
      }
    }, { passive: true });

    wrapper.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        // 双指缩放
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        scale = Math.min(Math.max(initialScale * (distance / initialDistance), 0.5), 10);
        updateTransform();
        e.preventDefault();
      } else if (e.touches.length === 1 && isDragging) {
        // 单指拖动
        translateX += e.touches[0].clientX - lastX;
        translateY += e.touches[0].clientY - lastY;
        lastX = e.touches[0].clientX;
        lastY = e.touches[0].clientY;
        updateTransform();
        e.preventDefault();
      }
    }, { passive: false });

    wrapper.addEventListener('touchend', () => {
      isDragging = false;
      initialDistance = 0;
    }, { passive: true });

    // 鼠标滚轮缩放
    wrapper.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      scale = Math.min(Math.max(scale * delta, 0.5), 10);
      updateTransform();
    }, { passive: false });

    wrapper.appendChild(img);
    wrapper.appendChild(controls);
    container.appendChild(wrapper);
  },

  /**
   * Render CSV as table
   */
  renderCsvPreview(container, data) {
    const wrapper = document.createElement('div');
    wrapper.className = 'preview-content preview-csv-wrapper';

    const delimiter = data.delimiter || ',';
    const lines = data.data.split('\n').filter(line => line.trim());

    if (lines.length === 0) {
      wrapper.innerHTML = '<div class="preview-empty">Empty file</div>';
      container.appendChild(wrapper);
      return;
    }

    // 解析 CSV（简单实现，不处理引号内的逗号）
    const parseRow = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === delimiter && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };

    const table = document.createElement('table');
    table.className = 'preview-csv-table';

    // 第一行作为表头
    const headerRow = parseRow(lines[0]);
    const thead = document.createElement('thead');
    const headerTr = document.createElement('tr');
    headerRow.forEach(cell => {
      const th = document.createElement('th');
      th.textContent = cell;
      headerTr.appendChild(th);
    });
    thead.appendChild(headerTr);
    table.appendChild(thead);

    // 数据行
    const tbody = document.createElement('tbody');
    for (let i = 1; i < lines.length && i < 1000; i++) { // 限制 1000 行
      const row = parseRow(lines[i]);
      const tr = document.createElement('tr');
      row.forEach(cell => {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    wrapper.appendChild(table);
    if (lines.length > 1000) {
      const notice = document.createElement('div');
      notice.className = 'preview-notice';
      notice.textContent = `Showing 1000 of ${lines.length} rows`;
      wrapper.appendChild(notice);
    }
    container.appendChild(wrapper);
  },

  /**
   * Render text/code preview with syntax highlighting
   */
  renderTextPreview(container, data) {
    const wrapper = document.createElement('div');
    wrapper.className = 'preview-content preview-text-wrapper';

    // Markdown 特殊处理 - 渲染成 HTML
    if (data.lang === 'markdown' && typeof marked !== 'undefined') {
      const markdownWrapper = document.createElement('div');
      markdownWrapper.className = 'preview-markdown';
      try {
        markdownWrapper.innerHTML = marked.parse(data.data);
        // 链接在新窗口打开
        markdownWrapper.querySelectorAll('a').forEach(a => {
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
        });
      } catch (e) {
        markdownWrapper.textContent = data.data;
      }
      wrapper.appendChild(markdownWrapper);
      container.appendChild(wrapper);
      return;
    }

    // 代码预览
    const pre = document.createElement('pre');
    pre.className = 'preview-code';

    const code = document.createElement('code');
    code.className = `language-${data.lang}`;
    code.textContent = data.data;

    pre.appendChild(code);
    wrapper.appendChild(pre);

    // 添加行号 (先添加行号，再高亮)
    this.addLineNumbers(pre, data.data);

    // 先添加到 DOM
    container.appendChild(wrapper);

    // 等待 hljs 加载完成后执行高亮
    const tryHighlight = (attempts = 0) => {
      if (typeof hljs !== 'undefined' && typeof hljs.highlightElement === 'function') {
        try {
          hljs.highlightElement(code);
        } catch (e) {
          console.warn('Highlight failed:', e);
        }
      } else if (attempts < 20) {
        // 每 100ms 重试，最多 2 秒
        setTimeout(() => tryHighlight(attempts + 1), 100);
      }
    };
    // 等待 DOM 渲染后开始尝试
    requestAnimationFrame(() => tryHighlight());
  },

  /**
   * Add line numbers to code preview with folding support
   */
  addLineNumbers(pre, content) {
    const lines = content.split('\n');
    const lineNumbers = document.createElement('div');
    lineNumbers.className = 'line-numbers';

    // Detect foldable blocks (functions, classes, etc.)
    const foldableBlocks = this.detectFoldableBlocks(lines);

    for (let i = 1; i <= lines.length; i++) {
      const num = document.createElement('span');
      num.dataset.line = i;

      // Check if this line starts a foldable block
      const block = foldableBlocks.find(b => b.start === i);
      if (block) {
        num.innerHTML = `<span class="fold-btn" data-start="${block.start}" data-end="${block.end}">▼</span>${i}`;
        num.classList.add('has-fold');
      } else {
        num.textContent = i;
      }

      lineNumbers.appendChild(num);
    }

    pre.insertBefore(lineNumbers, pre.firstChild);
    pre.classList.add('has-line-numbers');

    // Bind fold events
    this.bindFoldEvents(pre, lineNumbers);
  },

  /**
   * Detect foldable code blocks (functions, classes, etc.)
   */
  detectFoldableBlocks(lines) {
    const blocks = [];
    // Patterns for block start
    const blockStartPatterns = [
      /^\s*(function|class|interface|enum)\s+\w+/,           // JS/TS function, class
      /^\s*(const|let|var)\s+\w+\s*=\s*(async\s+)?(\([^)]*\)|[^=]+)\s*=>\s*\{?\s*$/,  // Arrow function
      /^\s*(export\s+)?(default\s+)?(async\s+)?function/,    // Export function
      /^\s*(export\s+)?(default\s+)?class/,                   // Export class
      /^\s*def\s+\w+\s*\(/,                                    // Python def
      /^\s*class\s+\w+[\s:(]/,                                  // Python class
      /^\s*(if|else|elif|for|while|with|try|except|finally)\s*[:(]/,  // Python blocks
      /^\s*(if|else|for|while|switch|try|catch|finally)\s*\(/,  // JS blocks
    ];

    const braceStack = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Check if line matches a block start pattern
      const isBlockStart = blockStartPatterns.some(p => p.test(line));

      if (isBlockStart) {
        // Count braces in this line
        const openBraces = (line.match(/\{/g) || []).length;
        const closeBraces = (line.match(/\}/g) || []).length;
        const netBraces = openBraces - closeBraces;

        if (netBraces > 0 || line.includes('{')) {
          braceStack.push({ start: lineNum, braceCount: netBraces > 0 ? netBraces : 1 });
        } else if (line.trim().endsWith(':')) {
          // Python-style block (indentation based)
          // Find end by indentation
          const startIndent = line.search(/\S/);
          let endLine = lineNum;
          for (let j = i + 1; j < lines.length; j++) {
            const nextLine = lines[j];
            if (nextLine.trim() === '') continue;
            const nextIndent = nextLine.search(/\S/);
            if (nextIndent <= startIndent) {
              endLine = j;
              break;
            }
            endLine = j + 1;
          }
          if (endLine > lineNum + 2) {
            blocks.push({ start: lineNum, end: endLine });
          }
        }
      }

      // Track braces for JS-style blocks
      if (braceStack.length > 0) {
        const openBraces = (line.match(/\{/g) || []).length;
        const closeBraces = (line.match(/\}/g) || []).length;

        for (let b = 0; b < closeBraces && braceStack.length > 0; b++) {
          const block = braceStack[braceStack.length - 1];
          block.braceCount--;
          if (block.braceCount <= 0) {
            const poppedBlock = braceStack.pop();
            if (lineNum > poppedBlock.start + 2) {
              blocks.push({ start: poppedBlock.start, end: lineNum });
            }
          }
        }

        for (let b = 0; b < openBraces && braceStack.length > 0; b++) {
          braceStack[braceStack.length - 1].braceCount++;
        }
      }
    }

    return blocks;
  },

  /**
   * Bind fold/unfold events
   */
  bindFoldEvents(pre, lineNumbers) {
    const code = pre.querySelector('code');
    if (!code) return;

    lineNumbers.querySelectorAll('.fold-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const start = parseInt(btn.dataset.start);
        const end = parseInt(btn.dataset.end);
        const isFolded = btn.classList.contains('folded');

        if (isFolded) {
          // Unfold
          btn.classList.remove('folded');
          btn.textContent = '▼';
          // Show lines
          for (let i = start + 1; i <= end; i++) {
            const lineNumEl = lineNumbers.querySelector(`[data-line="${i}"]`);
            if (lineNumEl) lineNumEl.style.display = '';
          }
          // Show code lines
          this.toggleCodeLines(code, start, end, true);
        } else {
          // Fold
          btn.classList.add('folded');
          btn.textContent = '▶';
          // Hide lines
          for (let i = start + 1; i <= end; i++) {
            const lineNumEl = lineNumbers.querySelector(`[data-line="${i}"]`);
            if (lineNumEl) lineNumEl.style.display = 'none';
          }
          // Hide code lines
          this.toggleCodeLines(code, start, end, false);
        }
      });
    });
  },

  /**
   * Toggle visibility of code lines
   */
  toggleCodeLines(code, start, end, show) {
    // Code is rendered as a single text node or with spans from highlighting
    // We need to wrap lines to control visibility
    if (!code._linesWrapped) {
      this.wrapCodeLines(code);
    }

    const lines = code.querySelectorAll('.code-line');
    for (let i = start; i < end && i < lines.length; i++) {
      lines[i].style.display = show ? '' : 'none';
    }
  },

  /**
   * Wrap each line of code in a span for folding support
   */
  wrapCodeLines(code) {
    const html = code.innerHTML;
    const lines = html.split('\n');
    code.innerHTML = lines.map((line, i) =>
      `<span class="code-line" data-line="${i + 1}">${line}</span>`
    ).join('\n');
    code._linesWrapped = true;
  },

  /**
   * Close file preview
   */
  closeFilePreview() {
    const modal = document.getElementById('file-preview-modal');
    modal.classList.remove('active');
    this._currentPreviewPath = null;
  },

  /**
   * Bind preview modal events
   */
  bindFilePreviewEvents() {
    const modal = document.getElementById('file-preview-modal');
    const closeBtn = document.getElementById('preview-close-btn');
    const downloadBtn = document.getElementById('preview-download-btn');
    const fontIncreaseBtn = document.getElementById('preview-font-increase');
    const fontDecreaseBtn = document.getElementById('preview-font-decrease');

    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeFilePreview());
    }

    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        if (this._currentPreviewPath) {
          this.downloadFileFromPath(this._currentPreviewPath);
        }
      });
    }

    // Font size controls
    if (fontIncreaseBtn) {
      fontIncreaseBtn.addEventListener('click', () => this.adjustPreviewFontSize(2));
    }
    if (fontDecreaseBtn) {
      fontDecreaseBtn.addEventListener('click', () => this.adjustPreviewFontSize(-2));
    }

    // Click backdrop to close
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.closeFilePreview();
        }
      });
    }
  },

  /**
   * Adjust preview font size
   */
  adjustPreviewFontSize(delta) {
    this._previewFontSize = Math.max(10, Math.min(32, this._previewFontSize + delta));
    this.applyPreviewFontSize();
  },

  /**
   * Apply current font size to preview content
   */
  applyPreviewFontSize() {
    const body = document.getElementById('file-preview-body');
    if (!body) return;

    // Apply to code/text content
    const codeEl = body.querySelector('.preview-code');
    if (codeEl) {
      codeEl.style.fontSize = this._previewFontSize + 'px';
    }

    // Apply to markdown content
    const mdEl = body.querySelector('.preview-markdown');
    if (mdEl) {
      mdEl.style.fontSize = this._previewFontSize + 'px';
    }

    // Apply to CSV table
    const csvEl = body.querySelector('.preview-csv-table');
    if (csvEl) {
      csvEl.style.fontSize = this._previewFontSize + 'px';
    }

    // For images, use as zoom factor
    const imgEl = body.querySelector('.preview-image');
    if (imgEl) {
      const scale = this._previewFontSize / 14; // Base scale
      imgEl.style.transform = `scale(${scale})`;
      imgEl.style.transformOrigin = 'center center';
    }
  },

  /**
   * Refresh files page
   */
  refreshFilesPage() {
    this.loadFilesDirectory(this._currentPath);
  }
};

// Export to global
if (typeof window !== 'undefined') {
  window.AppFiles = AppFiles;
}
