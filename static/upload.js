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
 */
const AppUpload = {
  /**
   * 初始化上传功能
   * 在 bindEvents 中调用
   */
  initUpload() {
    const menuUpload = document.getElementById('menu-upload');
    const fileInput = document.getElementById('file-input');

    if (!menuUpload || !fileInput) {
      console.warn('Upload elements not found');
      return;
    }

    // 点击上传菜单时触发文件选择
    menuUpload.addEventListener('click', () => {
      // 确保每次都能触发 change 事件
      fileInput.value = '';
      fileInput.click();
    });

    // 文件选择后处理上传
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.uploadFile(file);
      }
    });
  },

  /**
   * 上传文件到用户主目录
   * @param {File} file - 要上传的文件
   */
  async uploadFile(file) {
    // 检查文件大小（500MB 限制）
    const maxSize = 500 * 1024 * 1024;
    if (file.size > maxSize) {
      this.showToast(this.t('upload.fileTooLarge', 'File too large (max 500MB)'), 'error');
      return;
    }

    // 关闭设置模态框
    this.closeSettingsModal();

    // 显示上传中提示
    const uploadingMsg = this.t('upload.uploading', 'Uploading...');
    this.showToast(`${uploadingMsg} ${file.name}`, 'info');

    try {
      // 创建 FormData
      const formData = new FormData();
      formData.append('file', file);

      // 发送上传请求
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`
        },
        body: formData
      });

      if (response.ok) {
        const result = await response.json();
        this.debugLog(`File uploaded: ${result.path}`);
        // 显示成功弹框
        this.showUploadSuccessDialog(result);
      } else if (response.status === 401) {
        this.handleUnauthorized();
      } else if (response.status === 413) {
        this.showToast(this.t('upload.fileTooLarge', 'File too large'), 'error');
      } else {
        const error = await response.json().catch(() => ({}));
        const errorMsg = error.detail || this.t('upload.failed', 'Upload failed');
        this.showToast(errorMsg, 'error');
      }
    } catch (error) {
      console.error('Upload error:', error);
      this.showToast(this.t('upload.networkError', 'Network error'), 'error');
    }
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
            <div class="upload-success-size">${sizeStr}</div>
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
   * 复制文本到剪贴板
   * @param {string} text - 要复制的文本
   */
  copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(err => {
        console.error('Clipboard write failed:', err);
        this.fallbackCopy(text);
      });
    } else {
      this.fallbackCopy(text);
    }
  },

  /**
   * 降级复制方法
   * @param {string} text - 要复制的文本
   */
  fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
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
  }
};

// 导出到全局
window.AppUpload = AppUpload;
