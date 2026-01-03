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
 * 上传模块
 * 提供文件上传功能（上传到用户主目录）
 * 支持进度显示、后台上传、debugLog 记录
 */
const AppUpload = {
  // 当前上传状态
  _currentUpload: null,

  /**
   * 初始化上传功能
   * 在 bindEvents 中调用
   */
  initUpload() {
    const fileInput = document.getElementById('file-input');

    if (!fileInput) {
      console.warn('Upload file input not found');
      return;
    }

    // 文件选择后处理上传
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.uploadFile(file);
      }
    });
  },

  /**
   * 上传文件到用户主目录（使用 XHR 支持进度）
   * @param {File} file - 要上传的文件
   */
  uploadFile(file) {
    // 检查文件大小（500MB 限制）
    const maxSize = 500 * 1024 * 1024;
    if (file.size > maxSize) {
      this.showToast(this.t('upload.fileTooLarge', 'File too large (max 500MB)'), 'error');
      return;
    }

    // 关闭设置模态框
    this.closeSettingsModal();

    const startTime = Date.now();
    const fileName = file.name;
    const fileSize = file.size;

    // 记录开始日志
    this.debugLog(`Upload started: ${fileName} (${this.formatFileSize(fileSize)})`);

    // 保存上传状态
    this._currentUpload = {
      fileName,
      fileSize,
      startTime,
      loaded: 0,
      progress: 0
    };

    // 创建 XHR
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);

    // 上传进度事件
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const progress = Math.round((e.loaded / e.total) * 100);
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = e.loaded / elapsed;
        const remaining = (e.total - e.loaded) / speed;

        this._currentUpload.loaded = e.loaded;
        this._currentUpload.progress = progress;

        // 每 10% 记录一次日志
        if (progress % 10 === 0 && progress !== this._lastLoggedProgress) {
          this._lastLoggedProgress = progress;
          this.debugLog(
            `Upload progress: ${fileName} ${progress}% ` +
            `(${this.formatFileSize(e.loaded)}/${this.formatFileSize(e.total)}, ` +
            `${this.formatSpeed(speed)}, ETA ${this.formatTime(remaining)})`
          );
        }
      }
    };

    // 上传完成
    xhr.onload = () => {
      const duration = (Date.now() - startTime) / 1000;
      this._currentUpload = null;
      this._lastLoggedProgress = -1;

      if (xhr.status === 200) {
        try {
          const result = JSON.parse(xhr.responseText);
          const speed = fileSize / duration;

          this.debugLog(
            `Upload completed: ${result.filename} ` +
            `(${this.formatFileSize(result.size)} in ${duration.toFixed(1)}s, ${this.formatSpeed(speed)})`
          );

          // 显示成功弹框
          this.showUploadSuccessDialog(result);
        } catch (e) {
          this.debugLog(`Upload response parse error: ${e.message}`);
          this.showToast(this.t('upload.failed', 'Upload failed'), 'error');
        }
      } else if (xhr.status === 401) {
        this.debugLog(`Upload failed: Unauthorized`);
        this.handleUnauthorized();
      } else if (xhr.status === 413) {
        this.debugLog(`Upload failed: File too large`);
        this.showToast(this.t('upload.fileTooLarge', 'File too large'), 'error');
      } else {
        let errorMsg = 'Upload failed';
        try {
          const error = JSON.parse(xhr.responseText);
          errorMsg = error.detail || errorMsg;
        } catch (e) {}
        this.debugLog(`Upload failed: ${xhr.status} ${errorMsg}`);
        this.showToast(errorMsg, 'error');
      }
    };

    // 上传错误
    xhr.onerror = () => {
      const duration = (Date.now() - startTime) / 1000;
      this._currentUpload = null;

      this.debugLog(`Upload network error: ${fileName} (after ${duration.toFixed(1)}s)`);
      this.showToast(this.t('upload.networkError', 'Network error'), 'error');
    };

    // 上传中断
    xhr.onabort = () => {
      this._currentUpload = null;
      this.debugLog(`Upload aborted: ${fileName}`);
    };

    // 发送请求
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('Authorization', `Bearer ${this.token}`);
    xhr.send(formData);

    this.debugLog(`Upload request sent: ${fileName}`);
  },

  /**
   * 显示上传成功弹框
   * @param {Object} result - 上传结果 {filename, path, size}
   */
  showUploadSuccessDialog(result) {
    // 移除已有的弹框
    const existingDialog = document.getElementById('upload-success-dialog');
    if (existingDialog) {
      existingDialog.remove();
    }

    const sizeStr = this.formatFileSize(result.size);
    const durationStr = result.duration ? `${result.duration}s` : '';

    // 创建弹框
    const dialog = document.createElement('div');
    dialog.id = 'upload-success-dialog';
    dialog.className = 'modal active';
    dialog.innerHTML = `
      <div class="modal-content modal-small">
        <div class="modal-header">
          <h2 data-i18n="upload.successTitle">${this.t('upload.successTitle', 'Upload Successful')}</h2>
          <button class="btn-close" id="upload-dialog-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="upload-success-info">
            <div class="upload-success-icon">✓</div>
            <div class="upload-success-filename">${result.filename}</div>
            <div class="upload-success-size">${sizeStr}${durationStr ? ' · ' + durationStr : ''}</div>
          </div>
          <div class="upload-success-path">
            <label>${this.t('upload.filePath', 'File Path')}:</label>
            <div class="upload-path-box">
              <code id="upload-path-text">${result.path}</code>
            </div>
          </div>
          <button id="upload-copy-path" class="btn btn-primary btn-block">
            ${this.t('upload.copyPath', 'Copy Path')}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    // 绑定事件
    const closeBtn = document.getElementById('upload-dialog-close');
    const copyBtn = document.getElementById('upload-copy-path');

    closeBtn.addEventListener('click', () => {
      dialog.remove();
    });

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        dialog.remove();
      }
    });

    copyBtn.addEventListener('click', () => {
      this.copyToClipboard(result.path);
      copyBtn.textContent = this.t('upload.copied', 'Copied!');
      setTimeout(() => {
        copyBtn.textContent = this.t('upload.copyPath', 'Copy Path');
      }, 1500);
    });
  },

  /**
   * 显示上传历史页面
   */
  async showUploadHistory() {
    // 隐藏主菜单，显示历史页面
    const menu = document.getElementById('settings-menu');
    const backBtn = document.getElementById('settings-back-btn');
    const modalTitle = document.getElementById('settings-modal-title');

    if (menu) menu.style.display = 'none';
    if (backBtn) backBtn.classList.remove('hidden');
    if (modalTitle) modalTitle.textContent = this.t('upload.historyTitle', 'Upload History');

    // 创建或获取历史页面容器
    let historyPage = document.getElementById('settings-upload-history');
    if (!historyPage) {
      historyPage = document.createElement('div');
      historyPage.id = 'settings-upload-history';
      historyPage.className = 'settings-page';
      document.querySelector('#settings-modal .modal-body').appendChild(historyPage);
    }

    historyPage.classList.add('active');
    historyPage.innerHTML = `<div class="loading">${this.t('common.loading', 'Loading...')}</div>`;

    try {
      const response = await fetch('/api/uploads', {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (!response.ok) {
        throw new Error('Failed to load history');
      }

      const data = await response.json();
      const uploads = data.uploads || [];

      if (uploads.length === 0) {
        historyPage.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📁</div>
            <div class="empty-text">${this.t('upload.noHistory', 'No upload history')}</div>
          </div>
        `;
        return;
      }

      // 渲染历史列表
      historyPage.innerHTML = `
        <div class="upload-history-list">
          ${uploads.map(item => this.renderUploadHistoryItem(item)).join('')}
        </div>
      `;

      // 绑定复制事件
      historyPage.querySelectorAll('.upload-history-item').forEach(el => {
        el.addEventListener('click', () => {
          const path = el.dataset.path;
          if (path) {
            this.copyToClipboard(path);
            this.showToast(this.t('upload.pathCopied', 'Path copied'), 'success');
          }
        });
      });

    } catch (error) {
      console.error('Load upload history error:', error);
      historyPage.innerHTML = `
        <div class="error-state">
          <div class="error-text">${this.t('upload.loadError', 'Failed to load history')}</div>
        </div>
      `;
    }
  },

  /**
   * 渲染上传历史项
   * @param {Object} item - 历史记录项
   */
  renderUploadHistoryItem(item) {
    const statusIcon = item.status === 'success' ? '✓' : '✗';
    const statusClass = item.status === 'success' ? 'success' : 'failed';
    const sizeStr = this.formatFileSize(item.size);
    const dateStr = this.formatDateTime(item.created_at);
    const durationStr = item.duration ? `${item.duration.toFixed(1)}s` : '';

    return `
      <div class="upload-history-item ${statusClass}" data-path="${item.path}">
        <div class="upload-history-icon">${statusIcon}</div>
        <div class="upload-history-info">
          <div class="upload-history-filename">${item.filename}</div>
          <div class="upload-history-meta">
            ${sizeStr}${durationStr ? ' · ' + durationStr : ''} · ${dateStr}
          </div>
          ${item.error ? `<div class="upload-history-error">${item.error}</div>` : ''}
        </div>
      </div>
    `;
  },

  /**
   * 复制文本到剪贴板
   * @param {string} text - 要复制的文本
   * @param {boolean} showFeedback - 是否显示反馈 toast
   */
  copyToClipboard(text, showFeedback = false) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => {
          if (showFeedback) {
            this.showToast(this.t('files.copied', 'Copied!'));
          }
        })
        .catch(err => {
          console.warn('Clipboard API failed, using fallback:', err);
          this.fallbackCopy(text, showFeedback);
        });
    } else {
      this.fallbackCopy(text, showFeedback);
    }
  },

  /**
   * 降级复制方法
   * @param {string} text - 要复制的文本
   * @param {boolean} showFeedback - 是否显示反馈 toast
   */
  fallbackCopy(text, showFeedback = false) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (success && showFeedback) {
        this.showToast(this.t('files.copied', 'Copied!'));
      } else if (!success) {
        console.error('execCommand copy failed');
      }
    } catch (error) {
      console.error('Fallback copy failed:', error);
    }
  },

  /**
   * 格式化文件大小
   * @param {number} bytes - 字节数
   * @returns {string} 格式化的大小字符串
   */
  formatFileSize(bytes) {
    if (bytes < 1024) {
      return bytes + ' B';
    } else if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    } else {
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
  },

  /**
   * 格式化速度
   * @param {number} bytesPerSec - 每秒字节数
   * @returns {string} 格式化的速度字符串
   */
  formatSpeed(bytesPerSec) {
    if (bytesPerSec < 1024) {
      return bytesPerSec.toFixed(0) + ' B/s';
    } else if (bytesPerSec < 1024 * 1024) {
      return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
    } else {
      return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s';
    }
  },

  /**
   * 格式化时间
   * @param {number} seconds - 秒数
   * @returns {string} 格式化的时间字符串
   */
  formatTime(seconds) {
    if (seconds < 60) {
      return Math.round(seconds) + 's';
    } else {
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${mins}m${secs}s`;
    }
  },

  /**
   * 格式化日期时间
   * @param {string} isoString - ISO 日期字符串
   * @returns {string} 格式化的日期时间
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

// 导出到全局
window.AppUpload = AppUpload;
