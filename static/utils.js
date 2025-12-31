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
 * 工具函数模块
 * 提供通用的辅助函数
 */
const AppUtils = {
  /**
   * HTML 转义
   */
  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /**
   * 获取路径最后一级
   */
  getLastPathComponent(path) {
    if (!path) return '';
    const parts = path.split('/').filter(p => p);
    return parts[parts.length - 1] || path;
  },

  /**
   * 简化路径显示
   */
  shortenPath(path) {
    if (!path) return '';
    // 替换用户目录为 ~
    const home = this.homeDir || '';
    if (path.startsWith(home)) {
      return '~' + path.substring(home.length);
    }
    return path;
  },

  /**
   * 格式化时间
   */
  formatTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diff = now - date;

    // 小于1分钟
    if (diff < 60000) {
      return this.t('time.justNow');
    }
    // 小于1小时
    if (diff < 3600000) {
      return Math.floor(diff / 60000) + ' ' + this.t('time.minutesAgo');
    }
    // 小于24小时
    if (diff < 86400000) {
      return Math.floor(diff / 3600000) + ' ' + this.t('time.hoursAgo');
    }
    // 其他
    return date.toLocaleDateString();
  },

  /**
   * 格式化 token 数量
   */
  formatTokens(tokens) {
    if (tokens >= 1000000) {
      return (tokens / 1000000).toFixed(1) + 'M';
    } else if (tokens >= 1000) {
      return (tokens / 1000).toFixed(1) + 'k';
    }
    return tokens.toString();
  },

  /**
   * 获取状态文本
   */
  getStatusText(status) {
    return this.t(`session.status.${status}`, status);
  }
};

// 导出到全局
window.AppUtils = AppUtils;
