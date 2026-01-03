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
 * i18n - 国际化支持
 */

const i18n = {
  // 当前语言（默认英语）
  currentLang: 'en',

  // 支持的语言列表
  languages: {
    en: 'English',
    zh: '中文',
    ja: '日本語',
    ko: '한국어',
    fr: 'Français',
    de: 'Deutsch',
    es: 'Español',
    ru: 'Русский',
    pt: 'Português'
  },

  // 翻译数据
  translations: {
    zh: {
      // 登录页
      'login.subtitle': '请输入访问令牌',
      'login.placeholder': '访问令牌',
      'login.button': '登录',

      // Session 列表页
      'sessions.usage': '用量统计',
      'sessions.settings': '设置',
      'sessions.help': '帮助',
      'sessions.transfer': '传输',

      // 传输菜单
      'transfer.upload': '上传文件',
      'transfer.download': '下载文件',
      'transfer.uploadHistory': '上传历史',
      'transfer.downloadHistory': '下载历史',
      'transfer.terminalHistory': '终端历史',

      // 设置
      'settings.logout': '退出登录',
      'sessions.logout': '退出登录',
      'sessions.card': '卡片',
      'sessions.help.title': '使用说明',
      'sessions.help.usage': '查看用量统计',
      'sessions.help.pull': '轻拉刷新 / 重拉刷新页面',
      'sessions.help.cardButtons': '重命名 / 删除会话',
      'sessions.help.history': '查看终端历史',
      'sessions.help.tip': '点击左上角可查看调试日志',
      'sessions.help.contextTitle': 'Context 图标说明',
      'sessions.help.ctxUsed': '已用 / 最大容量 (%)',
      'sessions.help.ctxFree': '剩余可用空间',
      'sessions.help.ctxCompact': '距离自动压缩',
      'sessions.help.ctxTotal': '会话总消耗',
      'sessions.help.transferTitle': '传输功能',
      'sessions.help.transfer': '上传/下载文件',
      'sessions.loading': '加载中...',
      'sessions.empty': '暂无会话',
      'sessions.pullToRefresh': '下拉刷新',
      'sessions.releaseToRefresh': '释放刷新数据',
      'sessions.releaseToReload': '释放刷新页面',
      'sessions.refreshing': '刷新中...',

      // 用量统计
      'usage.period': '当前周期',
      'usage.today': '今日',
      'usage.month': '本月',
      'usage.fiveHour': '5小时周期',
      'usage.sevenDay': '7天周期',
      'usage.connections': '连接',
      'usage.terminals': '终端',
      'usage.days': '天',
      'usage.refresh': '刷新',
      'usage.trend': '7日趋势',
      'usage.loading': '加载中...',

      // 创建会话
      'create.title': '新建会话',
      'create.step1': '选择工作目录',
      'create.history': '历史目录',
      'create.browse': '浏览目录',
      'create.select': '选择',
      'create.step2': '选择 Claude 会话',
      'create.change': '更改',
      'create.new': '新建会话',

      // 设置
      'settings.language': '语言',
      'settings.title': '修改密码',
      'settings.oldPassword': '旧密码',
      'settings.newPassword': '新密码',
      'settings.newPasswordHint': '至少6位',
      'settings.confirmPassword': '确认新密码',
      'settings.confirm': '确认修改',

      // 终端页
      'terminal.title': '终端',
      'terminal.minimize': '收起',
      'terminal.close': '关闭',
      'terminal.help.title': '按键说明',
      'terminal.help.keysTitle': '快捷键',
      'terminal.help.nav': '导航',
      'terminal.help.danger': '中断',
      'terminal.help.action': '确认',
      'terminal.help.history': '历史命令',
      'terminal.help.scroll': '滚动（长按连续）',
      'terminal.help.stop': '停止操作',
      'terminal.help.complete': '自动补全',
      'terminal.help.send': '发送',
      'terminal.help.floatTitle': '悬浮按钮',
      'terminal.help.fontSize': '字体缩放',
      'terminal.help.theme': '切换终端主题',
      'terminal.help.context': 'Context（点击刷新并滚底）',
      'terminal.help.workdir': '打开工作目录',
      'terminal.help.switchSession': '切换会话 / 长按选择',
      'terminal.help.historyBtn': '终端历史（滚动加载/下拉刷新）',
      'terminal.help.tip': '点击 ⋯ 展开组合键和斜杠命令',
      'terminal.help.tipDebug': '点击标题查看调试日志',
      'terminal.help.tipFont': '输出排版混乱？试试调整字体大小',
      'terminal.keys.combo': '组合键',
      'terminal.keys.clear': '清屏',
      'terminal.keys.verbose': '详细',
      'terminal.keys.background': '后台',
      'terminal.keys.rollback': '回滚',
      'terminal.keys.mode': '模式',
      'terminal.keys.slash': '斜杠命令',
      'terminal.send': '发送',

      // Context 信息
      'context.title': 'Context',
      'context.used': '已用',
      'context.free': '剩余',
      'context.untilCompact': '后压缩',
      'context.compactSoon': '即将压缩',

      // 连接状态
      'status.connecting': '连接中...',
      'status.connected': '已连接',
      'status.disconnected': '已断开',
      'status.reconnecting': '重连中...',
      'status.error': '连接错误',

      // 通用
      'common.cancel': '取消',
      'common.confirm': '确认',
      'common.delete': '删除',
      'common.rename': '重命名',
      'common.close': '关闭',
      'common.retry': '重试',
      'common.loading': '加载中...',

      // 文件浏览器
      'files.empty': '空文件夹',
      'files.goHome': '返回主目录',
      'files.goToRoot': '根目录',
      'files.uploadFile': '上传文件',
      'files.showHidden': '显示隐藏文件',
      'files.hideHidden': '隐藏隐藏文件',
      'files.sortByName': '按名称排序',
      'files.sortByTime': '按时间排序',
      'files.uploadHistory': '上传历史',
      'files.downloadHistory': '下载历史',
      'files.noUploads': '无上传记录',
      'files.noDownloads': '无下载记录',
      'files.recentUploads': '最近上传',
      'files.recentDownloads': '最近下载',
      'files.historyFailed': '加载历史失败',
      'files.downloadStarted': '下载已开始',
      'files.downloadFailed': '下载失败',
      'files.download': '下载',

      // Session 卡片
      'session.running': '运行中',
      'session.rename': '重命名',
      'session.delete': '删除',
      'session.status.active': '运行中',
      'session.status.idle': '空闲',
      'session.status.stopped': '已停止',

      // 动态内容
      'login.verifying': '验证中...',
      'login.tokenInvalid': '访问令牌无效',
      'login.networkError': '网络错误，请稍后重试',
      'login.tokenExpired': '令牌已失效，请重新登录',
      'login.sessionExpired': '会话已过期，请重新登录',

      'settings.fillAll': '请填写所有字段',
      'settings.minLength': '新密码至少6位',
      'settings.notMatch': '两次输入的新密码不一致',
      'settings.updating': '修改中...',
      'settings.passwordChanged': '密码已修改，请用新密码登录',
      'settings.changeFailed': '修改失败',

      'sessions.emptyHint': '点击右上角 + 创建新会话',
      'sessions.loadFailed': '加载失败',

      'create.noHistory': '暂无工作目录记录',
      'create.noSubdirs': '无子目录',
      'create.noClaude': '该目录暂无 Claude 会话历史',
      'create.unnamed': '未命名会话',
      'create.failed': '创建会话失败',

      'status.timeout': '连接超时',
      'status.clickRetry': '点击重试',
      'status.manualRetry': '手动重试中',
      'status.startingSession': '启动会话进程',
      'status.waitingInit': '等待500ms后初始化终端',
      'status.failed': '连接失败',
      'status.checkNetwork': '请检查网络连接',
      'status.code': '代码',

      'reconnect.failed': '连接失败，请手动重连',
      'reconnect.trying': '重连中',

      'usage.noData': '暂无数据',
      'usage.periodText': '当前周期',
      'usage.resetIn': '后重置',
      'usage.periodReset': '周期已重置',

      'confirm.logout': '确定要退出登录吗？',
      'confirm.delete': '确定要删除这个会话吗？',
      'prompt.rename': '输入新名称:',

      'error.renameFailed': '重命名失败',
      'error.deleteFailed': '删除会话失败',
      'error.loadSessions': '加载会话列表失败',
      'error.terminalInit': '终端初始化失败',

      'time.justNow': '刚刚',
      'time.minutesAgo': '分钟前',
      'time.hoursAgo': '小时前',

      'terminal.inputPlaceholder': '输入消息...',
      'terminal.noWorkDir': '无工作目录',

      // 调试面板
      'debug.title': '调试日志',
      'debug.copy': '复制',
      'debug.copied': '已复制!',
      'debug.clear': '清除',
      'debug.close': '关闭',

      // 上传
      'settings.upload': '上传文件',
      'upload.uploading': '上传中...',
      'upload.success': '上传成功',
      'upload.failed': '上传失败',
      'upload.fileTooLarge': '文件过大（最大 500MB）',
      'upload.networkError': '网络错误',
      'upload.successTitle': '上传成功',
      'upload.filePath': '文件路径',
      'upload.copyPath': '复制路径',
      'upload.copied': '已复制!',
      'upload.historyTitle': '上传历史',
      'upload.noHistory': '暂无上传记录',
      'upload.loadError': '加载失败',
      'upload.pathCopied': '路径已复制',
      'settings.uploadHistory': '上传历史',
      'settings.download': '下载文件',
      'settings.downloadHistory': '下载历史',
      'settings.terminalHistory': '终端历史',

      // 下载
      'download.browserTitle': '文件浏览器',
      'download.parentDir': '上级目录',
      'download.emptyDir': '空目录',
      'download.goHome': '返回主目录',
      'download.success': '开始下载',
      'download.historyTitle': '下载历史',
      'download.noHistory': '暂无下载记录',
      'download.loadError': '加载失败',

      // 终端历史
      'history.title': '终端历史',
      'history.sessionHistory': '会话历史',
      'history.noSessions': '暂无终端历史',
      'history.noMessages': '该会话暂无消息',
      'history.loadError': '加载失败',
      'history.loadMore': '加载更多',
      'history.messages': '条消息',
      'history.input': '输入',
      'history.output': '输出',

      // 终端工具栏
      'terminal.historyBtn': '历史',
      'common.loading': '加载中...',

      // 远程机器
      'remote.title': '远程机器',
      'remote.noMachines': '暂无远程机器',
      'remote.addMachine': '添加远程机器',
      'remote.editMachine': '编辑远程机器',
      'remote.name': '名称',
      'remote.namePlaceholder': '我的服务器',
      'remote.host': '主机地址',
      'remote.hostPlaceholder': '192.168.1.100 或 example.com',
      'remote.port': '端口',
      'remote.username': '用户名',
      'remote.password': '密码',
      'remote.passwordPlaceholder': '留空保持现有密码',
      'remote.testConnection': '测试连接',
      'remote.testing': '正在测试连接...',
      'remote.testSuccess': '连接成功！',
      'remote.testFailed': '连接失败',
      'remote.save': '保存',
      'remote.edit': '编辑',
      'remote.delete': '删除',
      'remote.fillRequired': '请填写所有必填字段',
      'remote.saveFailed': '保存失败',
      'remote.deleteFailed': '删除失败',
      'remote.confirmDelete': '确定要删除',
      'remote.connecting': '正在连接...',
      'remote.connected': '已连接',
      'remote.disconnected': '已断开',

      // SSH 终端
      'ssh.back': '返回',
      'ssh.minimize': '最小化',
      'ssh.disconnect': '断开连接',
      'ssh.pin': '固定到会话列表',
      'ssh.pinSuccess': '已固定到会话列表',
      'ssh.pinFailed': '固定失败',
      'ssh.alreadyPinned': '已固定',
      'ssh.deleted': '机器已删除',

      // 系统监控
      'monitor.title': '系统监控',
      'monitor.memory': '内存',
      'monitor.disk': '磁盘',
      'monitor.topProcesses': '进程排行',
    },

    en: {
      // Login
      'login.subtitle': 'Enter access token',
      'login.placeholder': 'Access token',
      'login.button': 'Login',

      // Sessions list
      'sessions.usage': 'Usage',
      'sessions.settings': 'Settings',
      'sessions.help': 'Help',
      'sessions.transfer': 'Transfer',

      // Transfer Menu
      'transfer.upload': 'Upload File',
      'transfer.download': 'Download File',
      'transfer.uploadHistory': 'Upload History',
      'transfer.downloadHistory': 'Download History',
      'transfer.terminalHistory': 'Terminal History',

      // Settings
      'settings.logout': 'Logout',
      'sessions.logout': 'Logout',
      'sessions.card': 'Card',
      'sessions.help.title': 'Help',
      'sessions.help.usage': 'View usage stats',
      'sessions.help.pull': 'Light pull refresh / Heavy pull reload',
      'sessions.help.cardButtons': 'Rename / Delete session',
      'sessions.help.history': 'View terminal history',
      'sessions.help.tip': 'Click top-left for debug logs',
      'sessions.help.contextTitle': 'Context Icons',
      'sessions.help.ctxUsed': 'Used / Max (%)',
      'sessions.help.ctxFree': 'Free space',
      'sessions.help.ctxCompact': 'Until compact',
      'sessions.help.ctxTotal': 'Total consumed',
      'sessions.help.transferTitle': 'Transfer',
      'sessions.help.transfer': 'Upload/Download files',
      'sessions.loading': 'Loading...',
      'sessions.empty': 'No sessions',
      'sessions.pullToRefresh': 'Pull to refresh',
      'sessions.releaseToRefresh': 'Release to refresh data',
      'sessions.releaseToReload': 'Release to reload page',
      'sessions.refreshing': 'Refreshing...',

      // Usage
      'usage.period': 'Current period',
      'usage.today': 'Today',
      'usage.month': 'Month',
      'usage.fiveHour': '5-hour period',
      'usage.sevenDay': '7-day period',
      'usage.connections': 'Conn',
      'usage.terminals': 'Term',
      'usage.days': 'd',
      'usage.refresh': 'Refresh',
      'usage.trend': '7-day trend',
      'usage.loading': 'Loading...',

      // Create session
      'create.title': 'New Session',
      'create.step1': 'Select working directory',
      'create.history': 'Recent directories',
      'create.browse': 'Browse',
      'create.select': 'Select',
      'create.step2': 'Select Claude session',
      'create.change': 'Change',
      'create.new': 'Create Session',

      // Settings
      'settings.language': 'Language',
      'settings.title': 'Change Password',
      'settings.oldPassword': 'Old password',
      'settings.newPassword': 'New password',
      'settings.newPasswordHint': 'At least 6 characters',
      'settings.confirmPassword': 'Confirm password',
      'settings.confirm': 'Confirm',

      // Terminal
      'terminal.title': 'Terminal',
      'terminal.minimize': 'Minimize',
      'terminal.close': 'Close',
      'terminal.help.title': 'Keyboard shortcuts',
      'terminal.help.keysTitle': 'Shortcuts',
      'terminal.help.nav': 'Nav',
      'terminal.help.danger': 'Stop',
      'terminal.help.action': 'Action',
      'terminal.help.history': 'History',
      'terminal.help.scroll': 'Scroll (hold for continuous)',
      'terminal.help.stop': 'Stop',
      'terminal.help.complete': 'Auto complete',
      'terminal.help.send': 'Send',
      'terminal.help.floatTitle': 'Float buttons',
      'terminal.help.fontSize': 'Font size',
      'terminal.help.theme': 'Switch terminal theme',
      'terminal.help.context': 'Context (tap to refresh & scroll)',
      'terminal.help.workdir': 'Open working directory',
      'terminal.help.switchSession': 'Switch session / hold to select',
      'terminal.help.historyBtn': 'Terminal history (scroll / pull refresh)',
      'terminal.help.tip': 'Click ⋯ for combo keys and slash commands',
      'terminal.help.tipDebug': 'Click title for debug logs',
      'terminal.help.tipFont': 'Garbled output? Try adjusting font size',
      'terminal.keys.combo': 'Combo keys',
      'terminal.keys.clear': 'Clear',
      'terminal.keys.verbose': 'Verbose',
      'terminal.keys.background': 'Background',
      'terminal.keys.rollback': 'Rollback',
      'terminal.keys.mode': 'Mode',
      'terminal.keys.slash': 'Slash commands',
      'terminal.send': 'Send',

      // Context info
      'context.title': 'Context',
      'context.used': 'Used',
      'context.free': 'Free',
      'context.untilCompact': 'until compact',
      'context.compactSoon': 'Compact soon',

      // Connection status
      'status.connecting': 'Connecting...',
      'status.connected': 'Connected',
      'status.disconnected': 'Disconnected',
      'status.reconnecting': 'Reconnecting...',
      'status.error': 'Connection error',

      // Common
      'common.cancel': 'Cancel',
      'common.confirm': 'Confirm',
      'common.delete': 'Delete',
      'common.rename': 'Rename',
      'common.close': 'Close',
      'common.retry': 'Retry',
      'common.loading': 'Loading...',

      // File browser
      'files.empty': 'Empty folder',
      'files.goHome': 'Go Home',
      'files.goToRoot': 'Go to Root',
      'files.uploadFile': 'Upload File',
      'files.showHidden': 'Show Hidden Files',
      'files.hideHidden': 'Hide Hidden Files',
      'files.sortByName': 'Sort by Name',
      'files.sortByTime': 'Sort by Time',
      'files.uploadHistory': 'Upload History',
      'files.downloadHistory': 'Download History',
      'files.noUploads': 'No upload history',
      'files.noDownloads': 'No download history',
      'files.recentUploads': 'Recent Uploads',
      'files.recentDownloads': 'Recent Downloads',
      'files.historyFailed': 'Failed to load history',
      'files.downloadStarted': 'Download started',
      'files.downloadFailed': 'Download failed',
      'files.download': 'Download',

      // Session card
      'session.running': 'Running',
      'session.rename': 'Rename',
      'session.delete': 'Delete',
      'session.status.active': 'Active',
      'session.status.idle': 'Idle',
      'session.status.stopped': 'Stopped',

      // Dynamic content
      'login.verifying': 'Verifying...',
      'login.tokenInvalid': 'Invalid access token',
      'login.networkError': 'Network error, please try again',
      'login.tokenExpired': 'Token expired, please login again',
      'login.sessionExpired': 'Session expired, please login again',

      'settings.fillAll': 'Please fill in all fields',
      'settings.minLength': 'New password must be at least 6 characters',
      'settings.notMatch': 'Passwords do not match',
      'settings.updating': 'Updating...',
      'settings.passwordChanged': 'Password changed, please login with new password',
      'settings.changeFailed': 'Failed to change',

      'sessions.emptyHint': 'Click + to create a new session',
      'sessions.loadFailed': 'Load failed',

      'create.noHistory': 'No recent directories',
      'create.noSubdirs': 'No subdirectories',
      'create.noClaude': 'No Claude sessions in this directory',
      'create.unnamed': 'Unnamed session',
      'create.failed': 'Failed to create session',

      'status.timeout': 'Connection timeout',
      'status.clickRetry': 'Click to retry',
      'status.manualRetry': 'Manual retry',
      'status.startingSession': 'Starting session',
      'status.waitingInit': 'Waiting 500ms to init terminal',
      'status.failed': 'Connection failed',
      'status.checkNetwork': 'Please check your network',
      'status.code': 'Code',

      'reconnect.failed': 'Connection failed, please retry manually',
      'reconnect.trying': 'Reconnecting',

      'usage.noData': 'No data',
      'usage.periodText': 'Current period',
      'usage.resetIn': 'until reset',
      'usage.periodReset': 'Period reset',

      'confirm.logout': 'Are you sure you want to logout?',
      'confirm.delete': 'Are you sure you want to delete this session?',
      'prompt.rename': 'Enter new name:',

      'error.renameFailed': 'Rename failed',
      'error.deleteFailed': 'Failed to delete session',
      'error.loadSessions': 'Failed to load sessions',
      'error.terminalInit': 'Terminal init failed',

      'time.justNow': 'Just now',
      'time.minutesAgo': 'min ago',
      'time.hoursAgo': 'hr ago',

      'terminal.inputPlaceholder': 'Enter message...',
      'terminal.noWorkDir': 'No working directory',

      // Debug panel
      'debug.title': 'Debug Log',
      'debug.copy': 'Copy',
      'debug.copied': 'Copied!',
      'debug.clear': 'Clear',
      'debug.close': 'Close',

      // Upload
      'settings.upload': 'Upload File',
      'upload.uploading': 'Uploading...',
      'upload.success': 'Upload successful',
      'upload.failed': 'Upload failed',
      'upload.fileTooLarge': 'File too large (max 500MB)',
      'upload.networkError': 'Network error',
      'upload.successTitle': 'Upload Successful',
      'upload.filePath': 'File Path',
      'upload.copyPath': 'Copy Path',
      'upload.copied': 'Copied!',
      'upload.historyTitle': 'Upload History',
      'upload.noHistory': 'No upload history',
      'upload.loadError': 'Failed to load',
      'upload.pathCopied': 'Path copied',
      'settings.uploadHistory': 'Upload History',
      'settings.download': 'Download Files',
      'settings.downloadHistory': 'Download History',
      'settings.terminalHistory': 'Terminal History',

      // Download
      'download.browserTitle': 'File Browser',
      'download.parentDir': 'Parent',
      'download.emptyDir': 'Empty directory',
      'download.goHome': 'Go Home',
      'download.success': 'Download started',
      'download.historyTitle': 'Download History',
      'download.noHistory': 'No download history',
      'download.loadError': 'Failed to load',

      // Terminal History
      'history.title': 'Terminal History',
      'history.sessionHistory': 'Session History',
      'history.noSessions': 'No terminal history',
      'history.noMessages': 'No messages in this session',
      'history.loadError': 'Failed to load',
      'history.loadMore': 'Load More',
      'history.messages': 'messages',
      'history.input': 'Input',
      'history.output': 'Output',

      // Terminal Toolbar
      'terminal.historyBtn': 'History',
      'common.loading': 'Loading...',

      // Remote Machines
      'remote.title': 'Remote Machines',
      'remote.noMachines': 'No remote machines configured',
      'remote.addMachine': 'Add Remote Machine',
      'remote.editMachine': 'Edit Remote Machine',
      'remote.name': 'Name',
      'remote.namePlaceholder': 'My Server',
      'remote.host': 'Host',
      'remote.hostPlaceholder': '192.168.1.100 or example.com',
      'remote.port': 'Port',
      'remote.username': 'Username',
      'remote.password': 'Password',
      'remote.passwordPlaceholder': 'Leave empty to keep current password',
      'remote.testConnection': 'Test Connection',
      'remote.testing': 'Testing connection...',
      'remote.testSuccess': 'Connection successful!',
      'remote.testFailed': 'Connection failed',
      'remote.save': 'Save',
      'remote.edit': 'Edit',
      'remote.delete': 'Delete',
      'remote.fillRequired': 'Please fill in all required fields',
      'remote.saveFailed': 'Save failed',
      'remote.deleteFailed': 'Delete failed',
      'remote.confirmDelete': 'Are you sure you want to delete',
      'remote.connecting': 'Connecting...',
      'remote.connected': 'Connected',
      'remote.disconnected': 'Disconnected',

      // SSH Terminal
      'ssh.back': 'Back',
      'ssh.minimize': 'Minimize',
      'ssh.disconnect': 'Disconnect',
      'ssh.pin': 'Pin to Sessions',
      'ssh.pinSuccess': 'Pinned to sessions',
      'ssh.pinFailed': 'Pin failed',
      'ssh.alreadyPinned': 'Already pinned',
      'ssh.deleted': 'Machine deleted',

      // Monitor
      'monitor.title': 'Monitor',
      'monitor.memory': 'Memory',
      'monitor.disk': 'Disk',
      'monitor.topProcesses': 'Top Processes',
    },

    ja: {
      // ログイン
      'login.subtitle': 'アクセストークンを入力',
      'login.placeholder': 'アクセストークン',
      'login.button': 'ログイン',

      // セッション一覧
      'sessions.usage': '使用量',
      'sessions.settings': '設定',
      'sessions.help': 'ヘルプ',
      'sessions.transfer': '転送',

      // 転送メニュー
      'transfer.upload': 'ファイルをアップロード',
      'transfer.download': 'ファイルをダウンロード',
      'transfer.uploadHistory': 'アップロード履歴',
      'transfer.downloadHistory': 'ダウンロード履歴',
      'transfer.terminalHistory': 'ターミナル履歴',

      // 設定
      'settings.logout': 'ログアウト',
      'sessions.logout': 'ログアウト',
      'sessions.card': 'カード',
      'sessions.help.title': '使い方',
      'sessions.help.usage': '使用量を表示',
      'sessions.help.pull': '軽く引いて更新 / 強く引いてリロード',
      'sessions.help.cardButtons': '名前変更 / 削除',
      'sessions.help.history': 'ターミナル履歴を表示',
      'sessions.help.tip': '左上でデバッグログ',
      'sessions.help.contextTitle': 'Context アイコン',
      'sessions.help.ctxUsed': '使用量 / 最大 (%)',
      'sessions.help.ctxFree': '残り容量',
      'sessions.help.ctxCompact': '圧縮まで',
      'sessions.help.ctxTotal': '合計消費',
      'sessions.help.transferTitle': '転送機能',
      'sessions.help.transfer': 'ファイルのアップロード/ダウンロード',
      'sessions.loading': '読み込み中...',
      'sessions.empty': 'セッションなし',
      'sessions.pullToRefresh': '下にスワイプして更新',
      'sessions.releaseToRefresh': '離してデータ更新',
      'sessions.releaseToReload': '離してページ更新',
      'sessions.refreshing': '更新中...',

      // 使用量
      'usage.period': '現在の期間',
      'usage.today': '今日',
      'usage.month': '今月',
      'usage.fiveHour': '5時間周期',
      'usage.sevenDay': '7日周期',
      'usage.connections': '接続',
      'usage.terminals': '端末',
      'usage.days': '日',
      'usage.refresh': '更新',
      'usage.trend': '7日間の推移',
      'usage.loading': '読み込み中...',

      // セッション作成
      'create.title': '新規セッション',
      'create.step1': '作業ディレクトリを選択',
      'create.history': '履歴',
      'create.browse': '参照',
      'create.select': '選択',
      'create.step2': 'Claudeセッションを選択',
      'create.change': '変更',
      'create.new': '新規作成',

      // 設定
      'settings.language': '言語',
      'settings.title': 'パスワード変更',
      'settings.oldPassword': '現在のパスワード',
      'settings.newPassword': '新しいパスワード',
      'settings.newPasswordHint': '6文字以上',
      'settings.confirmPassword': '新しいパスワード（確認）',
      'settings.confirm': '確認',

      // ターミナル
      'terminal.title': 'ターミナル',
      'terminal.minimize': '最小化',
      'terminal.close': '閉じる',
      'terminal.help.title': 'キー操作',
      'terminal.help.keysTitle': 'ショートカット',
      'terminal.help.nav': 'ナビ',
      'terminal.help.danger': '中断',
      'terminal.help.action': '実行',
      'terminal.help.history': '履歴',
      'terminal.help.scroll': 'スクロール（長押しで連続）',
      'terminal.help.stop': '停止',
      'terminal.help.complete': '自動補完',
      'terminal.help.send': '送信',
      'terminal.help.floatTitle': 'フロートボタン',
      'terminal.help.fontSize': 'フォントサイズ',
      'terminal.help.theme': 'テーマ切替',
      'terminal.help.context': 'Context（タップで更新&最下部へ）',
      'terminal.help.workdir': '作業ディレクトリを開く',
      'terminal.help.switchSession': '切替 / 長押しで選択',
      'terminal.help.historyBtn': 'ターミナル履歴（スクロール/プルリフレッシュ）',
      'terminal.help.tip': '⋯をクリックで詳細表示',
      'terminal.help.tipDebug': 'タイトルをクリックでデバッグログ',
      'terminal.help.tipFont': '表示が乱れた？フォントサイズを調整',
      'terminal.keys.combo': 'コンボキー',
      'terminal.keys.clear': 'クリア',
      'terminal.keys.verbose': '詳細',
      'terminal.keys.background': 'バックグラウンド',
      'terminal.keys.rollback': 'ロールバック',
      'terminal.keys.mode': 'モード',
      'terminal.keys.slash': 'スラッシュコマンド',
      'terminal.send': '送信',

      // 接続状態
      'status.connecting': '接続中...',
      'status.connected': '接続済み',
      'status.disconnected': '切断済み',
      'status.reconnecting': '再接続中...',
      'status.error': '接続エラー',

      // 共通
      'common.cancel': 'キャンセル',
      'common.confirm': '確認',
      'common.delete': '削除',
      'common.rename': '名前変更',
      'common.close': '閉じる',
      'common.retry': '再試行',
      'common.loading': '読み込み中...',

      // ファイルブラウザ
      'files.empty': '空のフォルダ',
      'files.goHome': 'ホームへ',
      'files.goToRoot': 'ルートへ',
      'files.uploadFile': 'ファイルをアップロード',
      'files.showHidden': '隠しファイルを表示',
      'files.hideHidden': '隠しファイルを非表示',
      'files.sortByName': '名前順',
      'files.sortByTime': '日時順',
      'files.uploadHistory': 'アップロード履歴',
      'files.downloadHistory': 'ダウンロード履歴',
      'files.noUploads': 'アップロード履歴なし',
      'files.noDownloads': 'ダウンロード履歴なし',
      'files.recentUploads': '最近のアップロード',
      'files.recentDownloads': '最近のダウンロード',
      'files.historyFailed': '履歴の読み込みに失敗',
      'files.downloadStarted': 'ダウンロード開始',
      'files.downloadFailed': 'ダウンロード失敗',
      'files.download': 'ダウンロード',

      // セッションカード
      'session.running': '実行中',
      'session.rename': '名前変更',
      'session.delete': '削除',
      'session.status.active': '実行中',
      'session.status.idle': '待機中',
      'session.status.stopped': '停止',

      // 動的コンテンツ
      'login.verifying': '確認中...',
      'login.tokenInvalid': 'アクセストークンが無効です',
      'login.networkError': 'ネットワークエラー、後でお試しください',
      'login.tokenExpired': 'トークンが期限切れです、再ログインしてください',
      'login.sessionExpired': 'セッションが期限切れです、再ログインしてください',

      'settings.fillAll': 'すべての項目を入力してください',
      'settings.minLength': '新しいパスワードは6文字以上',
      'settings.notMatch': 'パスワードが一致しません',
      'settings.updating': '更新中...',
      'settings.passwordChanged': 'パスワードが変更されました、新しいパスワードでログインしてください',
      'settings.changeFailed': '変更に失敗しました',

      'sessions.emptyHint': '右上の + をクリックして新規作成',
      'sessions.loadFailed': '読み込み失敗',

      'create.noHistory': '履歴なし',
      'create.noSubdirs': 'サブディレクトリなし',
      'create.noClaude': 'このディレクトリにClaudeセッションがありません',
      'create.unnamed': '名前なしセッション',
      'create.failed': 'セッション作成に失敗しました',

      'status.timeout': '接続タイムアウト',
      'status.clickRetry': 'クリックで再試行',
      'status.manualRetry': '手動再試行中',
      'status.startingSession': 'セッション開始中',
      'status.waitingInit': 'ターミナル初期化を待機中',
      'status.failed': '接続失敗',
      'status.checkNetwork': 'ネットワーク接続を確認してください',
      'status.code': 'コード',

      'reconnect.failed': '接続失敗、手動で再接続してください',
      'reconnect.trying': '再接続中',

      'usage.noData': 'データなし',
      'usage.periodText': '現在の期間',
      'usage.resetIn': '後にリセット',
      'usage.periodReset': '期間がリセットされました',

      'confirm.logout': 'ログアウトしますか？',
      'confirm.delete': 'このセッションを削除しますか？',
      'prompt.rename': '新しい名前を入力:',

      'error.renameFailed': '名前変更に失敗しました',
      'error.deleteFailed': 'セッション削除に失敗しました',
      'error.loadSessions': 'セッション一覧の読み込みに失敗しました',
      'error.terminalInit': 'ターミナル初期化に失敗しました',

      'time.justNow': 'たった今',
      'time.minutesAgo': '分前',
      'time.hoursAgo': '時間前',

      'terminal.inputPlaceholder': 'メッセージを入力...',
      'terminal.noWorkDir': '作業ディレクトリなし',

      // デバッグパネル
      'debug.title': 'デバッグログ',
      'debug.copy': 'コピー',
      'debug.copied': 'コピーしました!',
      'debug.clear': 'クリア',
      'debug.close': '閉じる',

      // アップロード
      'settings.upload': 'ファイルをアップロード',
      'upload.uploading': 'アップロード中...',
      'upload.success': 'アップロード成功',
      'upload.failed': 'アップロード失敗',
      'upload.fileTooLarge': 'ファイルが大きすぎます（最大500MB）',
      'upload.networkError': 'ネットワークエラー',
      'upload.successTitle': 'アップロード成功',
      'upload.filePath': 'ファイルパス',
      'upload.copyPath': 'パスをコピー',
      'upload.copied': 'コピーしました!',
      'upload.historyTitle': 'アップロード履歴',
      'upload.noHistory': 'アップロード履歴なし',
      'upload.loadError': '読み込み失敗',
      'upload.pathCopied': 'パスをコピーしました',
      'settings.uploadHistory': 'アップロード履歴',
      'settings.download': 'ファイルダウンロード',
      'settings.downloadHistory': 'ダウンロード履歴',
      'settings.terminalHistory': 'ターミナル履歴',

      // ダウンロード
      'download.browserTitle': 'ファイルブラウザ',
      'download.parentDir': '上へ',
      'download.emptyDir': '空のディレクトリ',
      'download.goHome': 'ホームへ',
      'download.success': 'ダウンロード開始',
      'download.historyTitle': 'ダウンロード履歴',
      'download.noHistory': 'ダウンロード履歴なし',
      'download.loadError': '読み込み失敗',

      // ターミナル履歴
      'history.title': 'ターミナル履歴',
      'history.sessionHistory': 'セッション履歴',
      'history.noSessions': 'ターミナル履歴なし',
      'history.noMessages': 'このセッションにはメッセージがありません',
      'history.loadError': '読み込み失敗',
      'history.loadMore': 'もっと読み込む',
      'history.messages': '件のメッセージ',
      'history.input': '入力',
      'history.output': '出力',

      // ターミナルツールバー
      'terminal.historyBtn': '履歴',
      'common.loading': '読み込み中...',

      // モニター
      'monitor.title': 'モニター',
      'monitor.memory': 'メモリ',
      'monitor.disk': 'ディスク',
      'monitor.topProcesses': 'プロセス一覧',
    },

    ko: {
      // 로그인
      'login.subtitle': '액세스 토큰을 입력하세요',
      'login.placeholder': '액세스 토큰',
      'login.button': '로그인',

      // 세션 목록
      'sessions.usage': '사용량',
      'sessions.settings': '설정',
      'sessions.help': '도움말',
      'sessions.transfer': '전송',

      // 전송 메뉴
      'transfer.upload': '파일 업로드',
      'transfer.download': '파일 다운로드',
      'transfer.uploadHistory': '업로드 기록',
      'transfer.downloadHistory': '다운로드 기록',
      'transfer.terminalHistory': '터미널 기록',

      // 설정
      'settings.logout': '로그아웃',
      'sessions.logout': '로그아웃',
      'sessions.card': '카드',
      'sessions.help.title': '사용법',
      'sessions.help.usage': '사용량 보기',
      'sessions.help.pull': '가볍게 당겨 새로고침 / 세게 당겨 리로드',
      'sessions.help.cardButtons': '이름 변경 / 삭제',
      'sessions.help.history': '터미널 기록 보기',
      'sessions.help.tip': '왼쪽 상단 클릭하여 디버그 로그',
      'sessions.help.contextTitle': 'Context 아이콘',
      'sessions.help.ctxUsed': '사용량 / 최대 (%)',
      'sessions.help.ctxFree': '남은 공간',
      'sessions.help.ctxCompact': '압축까지',
      'sessions.help.ctxTotal': '총 소비',
      'sessions.help.transferTitle': '전송 기능',
      'sessions.help.transfer': '파일 업로드/다운로드',
      'sessions.loading': '로딩 중...',
      'sessions.empty': '세션 없음',
      'sessions.pullToRefresh': '당겨서 새로고침',
      'sessions.releaseToRefresh': '놓으면 데이터 새로고침',
      'sessions.releaseToReload': '놓으면 페이지 새로고침',
      'sessions.refreshing': '새로고침 중...',

      // 사용량
      'usage.period': '현재 기간',
      'usage.today': '오늘',
      'usage.month': '이번 달',
      'usage.fiveHour': '5시간 주기',
      'usage.sevenDay': '7일 주기',
      'usage.connections': '연결',
      'usage.terminals': '터미널',
      'usage.days': '일',
      'usage.refresh': '새로고침',
      'usage.trend': '7일 추이',
      'usage.loading': '로딩 중...',

      // 세션 생성
      'create.title': '새 세션',
      'create.step1': '작업 디렉토리 선택',
      'create.history': '최근 디렉토리',
      'create.browse': '찾아보기',
      'create.select': '선택',
      'create.step2': 'Claude 세션 선택',
      'create.change': '변경',
      'create.new': '새로 만들기',

      // 설정
      'settings.language': '언어',
      'settings.title': '비밀번호 변경',
      'settings.oldPassword': '현재 비밀번호',
      'settings.newPassword': '새 비밀번호',
      'settings.newPasswordHint': '6자 이상',
      'settings.confirmPassword': '새 비밀번호 확인',
      'settings.confirm': '확인',

      // 터미널
      'terminal.title': '터미널',
      'terminal.minimize': '최소화',
      'terminal.close': '닫기',
      'terminal.help.title': '키 설명',
      'terminal.help.keysTitle': '단축키',
      'terminal.help.nav': '탐색',
      'terminal.help.danger': '중단',
      'terminal.help.action': '실행',
      'terminal.help.history': '기록',
      'terminal.help.scroll': '스크롤 (길게 누르면 연속)',
      'terminal.help.stop': '중지',
      'terminal.help.complete': '자동 완성',
      'terminal.help.send': '전송',
      'terminal.help.floatTitle': '플로팅 버튼',
      'terminal.help.fontSize': '글꼴 크기',
      'terminal.help.theme': '테마 전환',
      'terminal.help.context': 'Context（탭하여 새로고침&하단）',
      'terminal.help.workdir': '작업 디렉토리 열기',
      'terminal.help.switchSession': '전환 / 길게 눌러 선택',
      'terminal.help.historyBtn': '터미널 기록 (스크롤/당겨서 새로고침)',
      'terminal.help.tip': '⋯를 클릭하여 더 보기',
      'terminal.help.tipDebug': '제목을 클릭하여 디버그 로그',
      'terminal.help.tipFont': '출력이 깨졌나요? 글꼴 크기 조정',
      'terminal.keys.combo': '조합키',
      'terminal.keys.clear': '지우기',
      'terminal.keys.verbose': '상세',
      'terminal.keys.background': '백그라운드',
      'terminal.keys.rollback': '롤백',
      'terminal.keys.mode': '모드',
      'terminal.keys.slash': '슬래시 명령',
      'terminal.send': '전송',

      // 연결 상태
      'status.connecting': '연결 중...',
      'status.connected': '연결됨',
      'status.disconnected': '연결 끊김',
      'status.reconnecting': '재연결 중...',
      'status.error': '연결 오류',

      // 공통
      'common.cancel': '취소',
      'common.confirm': '확인',
      'common.delete': '삭제',
      'common.rename': '이름 변경',
      'common.close': '닫기',
      'common.retry': '재시도',
      'common.loading': '로딩 중...',

      // 파일 브라우저
      'files.empty': '빈 폴더',
      'files.goHome': '홈으로',
      'files.goToRoot': '루트로',
      'files.uploadFile': '파일 업로드',
      'files.showHidden': '숨김 파일 표시',
      'files.hideHidden': '숨김 파일 숨기기',
      'files.sortByName': '이름순 정렬',
      'files.sortByTime': '시간순 정렬',
      'files.uploadHistory': '업로드 기록',
      'files.downloadHistory': '다운로드 기록',
      'files.noUploads': '업로드 기록 없음',
      'files.noDownloads': '다운로드 기록 없음',
      'files.recentUploads': '최근 업로드',
      'files.recentDownloads': '최근 다운로드',
      'files.historyFailed': '기록 로드 실패',
      'files.downloadStarted': '다운로드 시작됨',
      'files.downloadFailed': '다운로드 실패',
      'files.download': '다운로드',

      // 세션 카드
      'session.running': '실행 중',
      'session.rename': '이름 변경',
      'session.delete': '삭제',
      'session.status.active': '활성',
      'session.status.idle': '유휴',
      'session.status.stopped': '중지됨',

      // 동적 콘텐츠
      'login.verifying': '확인 중...',
      'login.tokenInvalid': '액세스 토큰이 유효하지 않습니다',
      'login.networkError': '네트워크 오류, 나중에 다시 시도하세요',
      'login.tokenExpired': '토큰이 만료되었습니다, 다시 로그인하세요',
      'login.sessionExpired': '세션이 만료되었습니다, 다시 로그인하세요',

      'settings.fillAll': '모든 항목을 입력하세요',
      'settings.minLength': '새 비밀번호는 6자 이상이어야 합니다',
      'settings.notMatch': '비밀번호가 일치하지 않습니다',
      'settings.updating': '업데이트 중...',
      'settings.passwordChanged': '비밀번호가 변경되었습니다, 새 비밀번호로 로그인하세요',
      'settings.changeFailed': '변경 실패',

      'sessions.emptyHint': '오른쪽 상단의 +를 클릭하여 새로 만들기',
      'sessions.loadFailed': '로딩 실패',

      'create.noHistory': '최근 디렉토리 없음',
      'create.noSubdirs': '하위 디렉토리 없음',
      'create.noClaude': '이 디렉토리에 Claude 세션이 없습니다',
      'create.unnamed': '이름 없는 세션',
      'create.failed': '세션 생성 실패',

      'status.timeout': '연결 시간 초과',
      'status.clickRetry': '클릭하여 재시도',
      'status.manualRetry': '수동 재시도 중',
      'status.startingSession': '세션 시작 중',
      'status.waitingInit': '터미널 초기화 대기 중',
      'status.failed': '연결 실패',
      'status.checkNetwork': '네트워크 연결을 확인하세요',
      'status.code': '코드',

      'reconnect.failed': '연결 실패, 수동으로 재연결하세요',
      'reconnect.trying': '재연결 중',

      'usage.noData': '데이터 없음',
      'usage.periodText': '현재 기간',
      'usage.resetIn': '후 초기화',
      'usage.periodReset': '기간이 초기화되었습니다',

      'confirm.logout': '로그아웃하시겠습니까?',
      'confirm.delete': '이 세션을 삭제하시겠습니까?',
      'prompt.rename': '새 이름 입력:',

      'error.renameFailed': '이름 변경 실패',
      'error.deleteFailed': '세션 삭제 실패',
      'error.loadSessions': '세션 목록 로딩 실패',
      'error.terminalInit': '터미널 초기화 실패',

      'time.justNow': '방금',
      'time.minutesAgo': '분 전',
      'time.hoursAgo': '시간 전',

      'terminal.inputPlaceholder': '메시지 입력...',
      'terminal.noWorkDir': '작업 디렉토리 없음',

      // 디버그 패널
      'debug.title': '디버그 로그',
      'debug.copy': '복사',
      'debug.copied': '복사됨!',
      'debug.clear': '지우기',
      'debug.close': '닫기',

      // 업로드
      'settings.upload': '파일 업로드',
      'upload.uploading': '업로드 중...',
      'upload.success': '업로드 성공',
      'upload.failed': '업로드 실패',
      'upload.fileTooLarge': '파일이 너무 큽니다 (최대 500MB)',
      'upload.networkError': '네트워크 오류',
      'upload.successTitle': '업로드 성공',
      'upload.filePath': '파일 경로',
      'upload.copyPath': '경로 복사',
      'upload.copied': '복사됨!',
      'upload.historyTitle': '업로드 기록',
      'upload.noHistory': '업로드 기록 없음',
      'upload.loadError': '로드 실패',
      'upload.pathCopied': '경로 복사됨',
      'settings.uploadHistory': '업로드 기록',
      'settings.download': '파일 다운로드',
      'settings.downloadHistory': '다운로드 기록',
      'settings.terminalHistory': '터미널 기록',

      // 다운로드
      'download.browserTitle': '파일 브라우저',
      'download.parentDir': '상위',
      'download.emptyDir': '빈 디렉토리',
      'download.goHome': '홈으로',
      'download.success': '다운로드 시작',
      'download.historyTitle': '다운로드 기록',
      'download.noHistory': '다운로드 기록 없음',
      'download.loadError': '로드 실패',

      // 터미널 기록
      'history.title': '터미널 기록',
      'history.sessionHistory': '세션 기록',
      'history.noSessions': '터미널 기록 없음',
      'history.noMessages': '이 세션에 메시지 없음',
      'history.loadError': '로드 실패',
      'history.loadMore': '더 보기',
      'history.messages': '개 메시지',
      'history.input': '입력',
      'history.output': '출력',

      // 터미널 도구모음
      'terminal.historyBtn': '기록',
      'common.loading': '로딩 중...',

      // 모니터
      'monitor.title': '모니터',
      'monitor.memory': '메모리',
      'monitor.disk': '디스크',
      'monitor.topProcesses': '프로세스 목록',
    },

    fr: {
      // Connexion
      'login.subtitle': 'Entrez le jeton d\'accès',
      'login.placeholder': 'Jeton d\'accès',
      'login.button': 'Connexion',

      // Liste des sessions
      'sessions.usage': 'Utilisation',
      'sessions.settings': 'Paramètres',
      'sessions.help': 'Aide',
      'sessions.transfer': 'Transfert',

      // Menu transfert
      'transfer.upload': 'Téléverser',
      'transfer.download': 'Télécharger',
      'transfer.uploadHistory': 'Historique envois',
      'transfer.downloadHistory': 'Historique téléchargements',
      'transfer.terminalHistory': 'Historique terminal',

      // Paramètres
      'settings.logout': 'Déconnexion',
      'sessions.logout': 'Déconnexion',
      'sessions.card': 'Carte',
      'sessions.help.title': 'Aide',
      'sessions.help.usage': 'Voir les statistiques',
      'sessions.help.pull': 'Tirer légèrement / fortement pour recharger',
      'sessions.help.cardButtons': 'Renommer / Supprimer',
      'sessions.help.history': 'Voir l\'historique terminal',
      'sessions.help.tip': 'Cliquez en haut à gauche pour logs',
      'sessions.help.contextTitle': 'Icônes Context',
      'sessions.help.ctxUsed': 'Utilisé / Max (%)',
      'sessions.help.ctxFree': 'Espace libre',
      'sessions.help.ctxCompact': 'Avant compactage',
      'sessions.help.ctxTotal': 'Total consommé',
      'sessions.help.transferTitle': 'Transfert',
      'sessions.help.transfer': 'Télécharger/Téléverser fichiers',
      'sessions.loading': 'Chargement...',
      'sessions.empty': 'Aucune session',
      'sessions.pullToRefresh': 'Tirer pour actualiser',
      'sessions.releaseToRefresh': 'Relâcher pour actualiser données',
      'sessions.releaseToReload': 'Relâcher pour recharger page',
      'sessions.refreshing': 'Actualisation...',

      // Utilisation
      'usage.period': 'Période actuelle',
      'usage.today': 'Aujourd\'hui',
      'usage.month': 'Ce mois',
      'usage.fiveHour': 'Période 5h',
      'usage.sevenDay': 'Période 7j',
      'usage.connections': 'Conn.',
      'usage.terminals': 'Term.',
      'usage.days': 'j',
      'usage.refresh': 'Actualiser',
      'usage.trend': 'Tendance 7 jours',
      'usage.loading': 'Chargement...',

      // Création de session
      'create.title': 'Nouvelle session',
      'create.step1': 'Sélectionner le répertoire',
      'create.history': 'Récents',
      'create.browse': 'Parcourir',
      'create.select': 'Sélectionner',
      'create.step2': 'Sélectionner la session Claude',
      'create.change': 'Changer',
      'create.new': 'Créer',

      // Paramètres
      'settings.language': 'Langue',
      'settings.title': 'Changer le mot de passe',
      'settings.oldPassword': 'Ancien mot de passe',
      'settings.newPassword': 'Nouveau mot de passe',
      'settings.newPasswordHint': 'Au moins 6 caractères',
      'settings.confirmPassword': 'Confirmer',
      'settings.confirm': 'Confirmer',

      // Terminal
      'terminal.title': 'Terminal',
      'terminal.minimize': 'Réduire',
      'terminal.close': 'Fermer',
      'terminal.help.title': 'Raccourcis clavier',
      'terminal.help.keysTitle': 'Raccourcis',
      'terminal.help.nav': 'Nav',
      'terminal.help.danger': 'Stop',
      'terminal.help.action': 'Action',
      'terminal.help.history': 'Historique',
      'terminal.help.scroll': 'Défiler (maintenir pour continu)',
      'terminal.help.stop': 'Arrêter',
      'terminal.help.complete': 'Auto-complétion',
      'terminal.help.send': 'Envoyer',
      'terminal.help.floatTitle': 'Boutons flottants',
      'terminal.help.fontSize': 'Taille police',
      'terminal.help.theme': 'Changer thème',
      'terminal.help.context': 'Context（appuyer pour rafraîchir）',
      'terminal.help.workdir': 'Ouvrir répertoire de travail',
      'terminal.help.switchSession': 'Changer / maintenir pour choisir',
      'terminal.help.historyBtn': 'Historique terminal (défiler / tirer)',
      'terminal.help.tip': 'Cliquez sur ⋯ pour plus',
      'terminal.help.tipDebug': 'Cliquez sur titre pour logs',
      'terminal.help.tipFont': 'Affichage confus ? Ajustez la taille',
      'terminal.keys.combo': 'Combinaisons',
      'terminal.keys.clear': 'Effacer',
      'terminal.keys.verbose': 'Détaillé',
      'terminal.keys.background': 'Arrière-plan',
      'terminal.keys.rollback': 'Annuler',
      'terminal.keys.mode': 'Mode',
      'terminal.keys.slash': 'Commandes slash',
      'terminal.send': 'Envoyer',

      // État de connexion
      'status.connecting': 'Connexion...',
      'status.connected': 'Connecté',
      'status.disconnected': 'Déconnecté',
      'status.reconnecting': 'Reconnexion...',
      'status.error': 'Erreur de connexion',

      // Commun
      'common.cancel': 'Annuler',
      'common.confirm': 'Confirmer',
      'common.delete': 'Supprimer',
      'common.rename': 'Renommer',
      'common.close': 'Fermer',
      'common.retry': 'Réessayer',
      'common.loading': 'Chargement...',

      // Navigateur de fichiers
      'files.empty': 'Dossier vide',
      'files.goHome': 'Accueil',
      'files.goToRoot': 'Racine',
      'files.uploadFile': 'Télécharger un fichier',
      'files.showHidden': 'Afficher les fichiers cachés',
      'files.hideHidden': 'Masquer les fichiers cachés',
      'files.sortByName': 'Trier par nom',
      'files.sortByTime': 'Trier par date',
      'files.uploadHistory': 'Historique des téléversements',
      'files.downloadHistory': 'Historique des téléchargements',
      'files.noUploads': 'Aucun téléversement',
      'files.noDownloads': 'Aucun téléchargement',
      'files.recentUploads': 'Téléversements récents',
      'files.recentDownloads': 'Téléchargements récents',
      'files.historyFailed': 'Échec du chargement',
      'files.downloadStarted': 'Téléchargement commencé',
      'files.downloadFailed': 'Échec du téléchargement',
      'files.download': 'Télécharger',

      // Carte de session
      'session.running': 'En cours',
      'session.rename': 'Renommer',
      'session.delete': 'Supprimer',
      'session.status.active': 'Actif',
      'session.status.idle': 'Inactif',
      'session.status.stopped': 'Arrêté',

      // Contenu dynamique
      'login.verifying': 'Vérification...',
      'login.tokenInvalid': 'Jeton d\'accès invalide',
      'login.networkError': 'Erreur réseau, réessayez plus tard',
      'login.tokenExpired': 'Jeton expiré, reconnectez-vous',
      'login.sessionExpired': 'Session expirée, reconnectez-vous',

      'settings.fillAll': 'Veuillez remplir tous les champs',
      'settings.minLength': 'Le mot de passe doit avoir au moins 6 caractères',
      'settings.notMatch': 'Les mots de passe ne correspondent pas',
      'settings.updating': 'Mise à jour...',
      'settings.passwordChanged': 'Mot de passe modifié, reconnectez-vous',
      'settings.changeFailed': 'Échec de la modification',

      'sessions.emptyHint': 'Cliquez sur + pour créer une session',
      'sessions.loadFailed': 'Échec du chargement',

      'create.noHistory': 'Aucun répertoire récent',
      'create.noSubdirs': 'Aucun sous-répertoire',
      'create.noClaude': 'Aucune session Claude dans ce répertoire',
      'create.unnamed': 'Session sans nom',
      'create.failed': 'Échec de la création',

      'status.timeout': 'Délai de connexion dépassé',
      'status.clickRetry': 'Cliquez pour réessayer',
      'status.manualRetry': 'Nouvelle tentative manuelle',
      'status.startingSession': 'Démarrage de la session',
      'status.waitingInit': 'Initialisation du terminal',
      'status.failed': 'Échec de la connexion',
      'status.checkNetwork': 'Vérifiez votre connexion',
      'status.code': 'Code',

      'reconnect.failed': 'Échec de la connexion, reconnectez manuellement',
      'reconnect.trying': 'Reconnexion',

      'usage.noData': 'Aucune donnée',
      'usage.periodText': 'Période actuelle',
      'usage.resetIn': 'avant réinitialisation',
      'usage.periodReset': 'Période réinitialisée',

      'confirm.logout': 'Voulez-vous vous déconnecter ?',
      'confirm.delete': 'Voulez-vous supprimer cette session ?',
      'prompt.rename': 'Entrez le nouveau nom :',

      'error.renameFailed': 'Échec du renommage',
      'error.deleteFailed': 'Échec de la suppression',
      'error.loadSessions': 'Échec du chargement des sessions',
      'error.terminalInit': 'Échec de l\'initialisation du terminal',

      'time.justNow': 'À l\'instant',
      'time.minutesAgo': 'min',
      'time.hoursAgo': 'h',

      'terminal.inputPlaceholder': 'Entrez un message...',
      'terminal.noWorkDir': 'Pas de répertoire de travail',

      // Panneau de débogage
      'debug.title': 'Journal de débogage',
      'debug.copy': 'Copier',
      'debug.copied': 'Copié !',
      'debug.clear': 'Effacer',
      'debug.close': 'Fermer',

      // Téléchargement
      'settings.upload': 'Télécharger fichier',
      'upload.uploading': 'Téléchargement...',
      'upload.success': 'Téléchargement réussi',
      'upload.failed': 'Échec du téléchargement',
      'upload.fileTooLarge': 'Fichier trop volumineux (max 500Mo)',
      'upload.networkError': 'Erreur réseau',
      'upload.successTitle': 'Téléchargement réussi',
      'upload.filePath': 'Chemin du fichier',
      'upload.copyPath': 'Copier le chemin',
      'upload.copied': 'Copié !',
      'upload.historyTitle': 'Historique des téléchargements',
      'upload.noHistory': 'Aucun historique',
      'upload.loadError': 'Échec du chargement',
      'upload.pathCopied': 'Chemin copié',
      'settings.uploadHistory': 'Historique des téléchargements',
      'settings.download': 'Télécharger fichiers',
      'settings.downloadHistory': 'Historique téléchargements',
      'settings.terminalHistory': 'Historique terminal',

      // Téléchargement
      'download.browserTitle': 'Explorateur de fichiers',
      'download.parentDir': 'Parent',
      'download.emptyDir': 'Dossier vide',
      'download.goHome': 'Accueil',
      'download.success': 'Téléchargement démarré',
      'download.historyTitle': 'Historique téléchargements',
      'download.noHistory': 'Aucun historique',
      'download.loadError': 'Échec du chargement',

      // Historique terminal
      'history.title': 'Historique terminal',
      'history.sessionHistory': 'Historique session',
      'history.noSessions': 'Aucun historique',
      'history.noMessages': 'Aucun message dans cette session',
      'history.loadError': 'Échec du chargement',
      'history.loadMore': 'Charger plus',
      'history.messages': 'messages',
      'history.input': 'Entrée',
      'history.output': 'Sortie',

      // Barre outils terminal
      'terminal.historyBtn': 'Historique',
      'common.loading': 'Chargement...',

      // Moniteur
      'monitor.title': 'Moniteur',
      'monitor.memory': 'Mémoire',
      'monitor.disk': 'Disque',
      'monitor.topProcesses': 'Processus',
    },

    de: {
      // Anmeldung
      'login.subtitle': 'Zugriffstoken eingeben',
      'login.placeholder': 'Zugriffstoken',
      'login.button': 'Anmelden',

      // Sitzungsliste
      'sessions.usage': 'Nutzung',
      'sessions.settings': 'Einstellungen',
      'sessions.help': 'Hilfe',
      'sessions.transfer': 'Übertragung',

      // Übertragungsmenü
      'transfer.upload': 'Hochladen',
      'transfer.download': 'Herunterladen',
      'transfer.uploadHistory': 'Upload-Verlauf',
      'transfer.downloadHistory': 'Download-Verlauf',
      'transfer.terminalHistory': 'Terminal-Verlauf',

      // Einstellungen
      'settings.logout': 'Abmelden',
      'sessions.logout': 'Abmelden',
      'sessions.card': 'Karte',
      'sessions.help.title': 'Hilfe',
      'sessions.help.usage': 'Nutzung anzeigen',
      'sessions.help.pull': 'Leicht ziehen / Stark ziehen zum Neuladen',
      'sessions.help.cardButtons': 'Umbenennen / Löschen',
      'sessions.help.history': 'Terminal-Verlauf anzeigen',
      'sessions.help.tip': 'Oben links für Debug-Logs',
      'sessions.help.contextTitle': 'Context-Symbole',
      'sessions.help.ctxUsed': 'Verwendet / Max (%)',
      'sessions.help.ctxFree': 'Frei',
      'sessions.help.ctxCompact': 'Bis Kompakt',
      'sessions.help.ctxTotal': 'Gesamt verbraucht',
      'sessions.help.transferTitle': 'Übertragung',
      'sessions.help.transfer': 'Dateien hoch-/herunterladen',
      'sessions.loading': 'Laden...',
      'sessions.empty': 'Keine Sitzungen',
      'sessions.pullToRefresh': 'Zum Aktualisieren ziehen',
      'sessions.releaseToRefresh': 'Loslassen für Daten-Update',
      'sessions.releaseToReload': 'Loslassen für Seiten-Reload',
      'sessions.refreshing': 'Aktualisiere...',

      // Nutzung
      'usage.period': 'Aktueller Zeitraum',
      'usage.today': 'Heute',
      'usage.month': 'Monat',
      'usage.fiveHour': '5h-Zeitraum',
      'usage.sevenDay': '7-Tage-Zeitraum',
      'usage.connections': 'Verb.',
      'usage.terminals': 'Term.',
      'usage.days': 'T',
      'usage.refresh': 'Aktualisieren',
      'usage.trend': '7-Tage-Trend',
      'usage.loading': 'Laden...',

      // Sitzung erstellen
      'create.title': 'Neue Sitzung',
      'create.step1': 'Arbeitsverzeichnis wählen',
      'create.history': 'Zuletzt verwendet',
      'create.browse': 'Durchsuchen',
      'create.select': 'Auswählen',
      'create.step2': 'Claude-Sitzung wählen',
      'create.change': 'Ändern',
      'create.new': 'Erstellen',

      // Einstellungen
      'settings.language': 'Sprache',
      'settings.title': 'Passwort ändern',
      'settings.oldPassword': 'Altes Passwort',
      'settings.newPassword': 'Neues Passwort',
      'settings.newPasswordHint': 'Mindestens 6 Zeichen',
      'settings.confirmPassword': 'Bestätigen',
      'settings.confirm': 'Bestätigen',

      // Terminal
      'terminal.title': 'Terminal',
      'terminal.minimize': 'Minimieren',
      'terminal.close': 'Schließen',
      'terminal.help.title': 'Tastenkürzel',
      'terminal.help.keysTitle': 'Tastenkürzel',
      'terminal.help.nav': 'Nav',
      'terminal.help.danger': 'Stopp',
      'terminal.help.action': 'Aktion',
      'terminal.help.history': 'Verlauf',
      'terminal.help.scroll': 'Scrollen (halten für kontinuierlich)',
      'terminal.help.stop': 'Stopp',
      'terminal.help.complete': 'Auto-Vervollständigung',
      'terminal.help.send': 'Senden',
      'terminal.help.floatTitle': 'Schwebende Tasten',
      'terminal.help.fontSize': 'Schriftgröße',
      'terminal.help.theme': 'Thema wechseln',
      'terminal.help.context': 'Context（tippen zum Aktualisieren）',
      'terminal.help.workdir': 'Arbeitsverzeichnis öffnen',
      'terminal.help.switchSession': 'Wechseln / halten zum Auswählen',
      'terminal.help.historyBtn': 'Terminal-Verlauf (Scrollen / Ziehen)',
      'terminal.help.tip': 'Klicken Sie auf ⋯ für mehr',
      'terminal.help.tipDebug': 'Klicken Sie auf Titel für Logs',
      'terminal.help.tipFont': 'Ausgabe durcheinander? Schriftgröße anpassen',
      'terminal.keys.combo': 'Tastenkombinationen',
      'terminal.keys.clear': 'Löschen',
      'terminal.keys.verbose': 'Ausführlich',
      'terminal.keys.background': 'Hintergrund',
      'terminal.keys.rollback': 'Zurücksetzen',
      'terminal.keys.mode': 'Modus',
      'terminal.keys.slash': 'Slash-Befehle',
      'terminal.send': 'Senden',

      // Verbindungsstatus
      'status.connecting': 'Verbinden...',
      'status.connected': 'Verbunden',
      'status.disconnected': 'Getrennt',
      'status.reconnecting': 'Neu verbinden...',
      'status.error': 'Verbindungsfehler',

      // Allgemein
      'common.cancel': 'Abbrechen',
      'common.confirm': 'Bestätigen',
      'common.delete': 'Löschen',
      'common.rename': 'Umbenennen',
      'common.close': 'Schließen',
      'common.retry': 'Wiederholen',
      'common.loading': 'Laden...',

      // Dateibrowser
      'files.empty': 'Leerer Ordner',
      'files.goHome': 'Startseite',
      'files.goToRoot': 'Stammverzeichnis',
      'files.uploadFile': 'Datei hochladen',
      'files.showHidden': 'Versteckte Dateien anzeigen',
      'files.hideHidden': 'Versteckte Dateien ausblenden',
      'files.sortByName': 'Nach Name sortieren',
      'files.sortByTime': 'Nach Zeit sortieren',
      'files.uploadHistory': 'Upload-Verlauf',
      'files.downloadHistory': 'Download-Verlauf',
      'files.noUploads': 'Kein Upload-Verlauf',
      'files.noDownloads': 'Kein Download-Verlauf',
      'files.recentUploads': 'Letzte Uploads',
      'files.recentDownloads': 'Letzte Downloads',
      'files.historyFailed': 'Laden fehlgeschlagen',
      'files.downloadStarted': 'Download gestartet',
      'files.downloadFailed': 'Download fehlgeschlagen',
      'files.download': 'Herunterladen',

      // Sitzungskarte
      'session.running': 'Läuft',
      'session.rename': 'Umbenennen',
      'session.delete': 'Löschen',
      'session.status.active': 'Aktiv',
      'session.status.idle': 'Inaktiv',
      'session.status.stopped': 'Gestoppt',

      // Dynamischer Inhalt
      'login.verifying': 'Überprüfen...',
      'login.tokenInvalid': 'Ungültiges Zugriffstoken',
      'login.networkError': 'Netzwerkfehler, später erneut versuchen',
      'login.tokenExpired': 'Token abgelaufen, bitte neu anmelden',
      'login.sessionExpired': 'Sitzung abgelaufen, bitte neu anmelden',

      'settings.fillAll': 'Bitte alle Felder ausfüllen',
      'settings.minLength': 'Passwort muss mindestens 6 Zeichen haben',
      'settings.notMatch': 'Passwörter stimmen nicht überein',
      'settings.updating': 'Aktualisieren...',
      'settings.passwordChanged': 'Passwort geändert, bitte neu anmelden',
      'settings.changeFailed': 'Änderung fehlgeschlagen',

      'sessions.emptyHint': 'Klicken Sie auf + für neue Sitzung',
      'sessions.loadFailed': 'Laden fehlgeschlagen',

      'create.noHistory': 'Keine zuletzt verwendeten Verzeichnisse',
      'create.noSubdirs': 'Keine Unterverzeichnisse',
      'create.noClaude': 'Keine Claude-Sitzungen in diesem Verzeichnis',
      'create.unnamed': 'Unbenannte Sitzung',
      'create.failed': 'Erstellung fehlgeschlagen',

      'status.timeout': 'Verbindungs-Timeout',
      'status.clickRetry': 'Klicken zum Wiederholen',
      'status.manualRetry': 'Manueller Neuversuch',
      'status.startingSession': 'Sitzung wird gestartet',
      'status.waitingInit': 'Terminal wird initialisiert',
      'status.failed': 'Verbindung fehlgeschlagen',
      'status.checkNetwork': 'Netzwerkverbindung prüfen',
      'status.code': 'Code',

      'reconnect.failed': 'Verbindung fehlgeschlagen, manuell neu verbinden',
      'reconnect.trying': 'Neu verbinden',

      'usage.noData': 'Keine Daten',
      'usage.periodText': 'Aktueller Zeitraum',
      'usage.resetIn': 'bis zum Zurücksetzen',
      'usage.periodReset': 'Zeitraum zurückgesetzt',

      'confirm.logout': 'Möchten Sie sich abmelden?',
      'confirm.delete': 'Diese Sitzung löschen?',
      'prompt.rename': 'Neuen Namen eingeben:',

      'error.renameFailed': 'Umbenennen fehlgeschlagen',
      'error.deleteFailed': 'Löschen fehlgeschlagen',
      'error.loadSessions': 'Laden der Sitzungen fehlgeschlagen',
      'error.terminalInit': 'Terminal-Initialisierung fehlgeschlagen',

      'time.justNow': 'Gerade eben',
      'time.minutesAgo': 'Min.',
      'time.hoursAgo': 'Std.',

      'terminal.inputPlaceholder': 'Nachricht eingeben...',
      'terminal.noWorkDir': 'Kein Arbeitsverzeichnis',

      // Debug-Panel
      'debug.title': 'Debug-Log',
      'debug.copy': 'Kopieren',
      'debug.copied': 'Kopiert!',
      'debug.clear': 'Löschen',
      'debug.close': 'Schließen',

      // Upload
      'settings.upload': 'Datei hochladen',
      'upload.uploading': 'Hochladen...',
      'upload.success': 'Upload erfolgreich',
      'upload.failed': 'Upload fehlgeschlagen',
      'upload.fileTooLarge': 'Datei zu groß (max 500MB)',
      'upload.networkError': 'Netzwerkfehler',
      'upload.successTitle': 'Upload erfolgreich',
      'upload.filePath': 'Dateipfad',
      'upload.copyPath': 'Pfad kopieren',
      'upload.copied': 'Kopiert!',
      'upload.historyTitle': 'Upload-Verlauf',
      'upload.noHistory': 'Kein Upload-Verlauf',
      'upload.loadError': 'Laden fehlgeschlagen',
      'upload.pathCopied': 'Pfad kopiert',
      'settings.uploadHistory': 'Upload-Verlauf',
      'settings.download': 'Dateien herunterladen',
      'settings.downloadHistory': 'Download-Verlauf',
      'settings.terminalHistory': 'Terminal-Verlauf',

      // Download
      'download.browserTitle': 'Datei-Browser',
      'download.parentDir': 'Übergeordnet',
      'download.emptyDir': 'Leeres Verzeichnis',
      'download.goHome': 'Zum Startverzeichnis',
      'download.success': 'Download gestartet',
      'download.historyTitle': 'Download-Verlauf',
      'download.noHistory': 'Kein Download-Verlauf',
      'download.loadError': 'Laden fehlgeschlagen',

      // Terminal-Verlauf
      'history.title': 'Terminal-Verlauf',
      'history.sessionHistory': 'Sitzungsverlauf',
      'history.noSessions': 'Kein Terminal-Verlauf',
      'history.noMessages': 'Keine Nachrichten in dieser Sitzung',
      'history.loadError': 'Laden fehlgeschlagen',
      'history.loadMore': 'Mehr laden',
      'history.messages': 'Nachrichten',
      'history.input': 'Eingabe',
      'history.output': 'Ausgabe',

      // Terminal-Symbolleiste
      'terminal.historyBtn': 'Verlauf',
      'common.loading': 'Laden...',

      // Monitor
      'monitor.title': 'Monitor',
      'monitor.memory': 'Speicher',
      'monitor.disk': 'Festplatte',
      'monitor.topProcesses': 'Prozesse',
    },

    es: {
      // Inicio de sesión
      'login.subtitle': 'Ingrese el token de acceso',
      'login.placeholder': 'Token de acceso',
      'login.button': 'Iniciar sesión',

      // Lista de sesiones
      'sessions.usage': 'Uso',
      'sessions.settings': 'Configuración',
      'sessions.help': 'Ayuda',
      'sessions.transfer': 'Transferencia',

      // Menú de transferencia
      'transfer.upload': 'Subir archivo',
      'transfer.download': 'Descargar archivo',
      'transfer.uploadHistory': 'Historial de subidas',
      'transfer.downloadHistory': 'Historial de descargas',
      'transfer.terminalHistory': 'Historial de terminal',

      // Configuración
      'settings.logout': 'Cerrar sesión',
      'sessions.logout': 'Cerrar sesión',
      'sessions.card': 'Tarjeta',
      'sessions.help.title': 'Ayuda',
      'sessions.help.usage': 'Ver estadísticas',
      'sessions.help.pull': 'Tirar suave / fuerte para recargar',
      'sessions.help.cardButtons': 'Renombrar / Eliminar',
      'sessions.help.history': 'Ver historial terminal',
      'sessions.help.tip': 'Clic arriba izquierda para logs',
      'sessions.help.contextTitle': 'Iconos Context',
      'sessions.help.ctxUsed': 'Usado / Máx (%)',
      'sessions.help.ctxFree': 'Espacio libre',
      'sessions.help.ctxCompact': 'Hasta compactar',
      'sessions.help.ctxTotal': 'Total consumido',
      'sessions.help.transferTitle': 'Transferencia',
      'sessions.help.transfer': 'Subir/Descargar archivos',
      'sessions.loading': 'Cargando...',
      'sessions.empty': 'Sin sesiones',
      'sessions.pullToRefresh': 'Desliza para actualizar',
      'sessions.releaseToRefresh': 'Suelta para actualizar datos',
      'sessions.releaseToReload': 'Suelta para recargar página',
      'sessions.refreshing': 'Actualizando...',

      // Uso
      'usage.period': 'Período actual',
      'usage.today': 'Hoy',
      'usage.month': 'Mes',
      'usage.fiveHour': 'Período 5h',
      'usage.sevenDay': 'Período 7d',
      'usage.connections': 'Conex.',
      'usage.terminals': 'Term.',
      'usage.days': 'd',
      'usage.refresh': 'Actualizar',
      'usage.trend': 'Tendencia 7 días',
      'usage.loading': 'Cargando...',

      // Crear sesión
      'create.title': 'Nueva sesión',
      'create.step1': 'Seleccionar directorio',
      'create.history': 'Recientes',
      'create.browse': 'Explorar',
      'create.select': 'Seleccionar',
      'create.step2': 'Seleccionar sesión Claude',
      'create.change': 'Cambiar',
      'create.new': 'Crear',

      // Configuración
      'settings.language': 'Idioma',
      'settings.title': 'Cambiar contraseña',
      'settings.oldPassword': 'Contraseña actual',
      'settings.newPassword': 'Nueva contraseña',
      'settings.newPasswordHint': 'Al menos 6 caracteres',
      'settings.confirmPassword': 'Confirmar',
      'settings.confirm': 'Confirmar',

      // Terminal
      'terminal.title': 'Terminal',
      'terminal.minimize': 'Minimizar',
      'terminal.close': 'Cerrar',
      'terminal.help.title': 'Atajos de teclado',
      'terminal.help.keysTitle': 'Atajos',
      'terminal.help.nav': 'Nav',
      'terminal.help.danger': 'Parar',
      'terminal.help.action': 'Acción',
      'terminal.help.history': 'Historial',
      'terminal.help.scroll': 'Desplazar (mantener para continuo)',
      'terminal.help.stop': 'Detener',
      'terminal.help.complete': 'Autocompletar',
      'terminal.help.send': 'Enviar',
      'terminal.help.floatTitle': 'Botones flotantes',
      'terminal.help.fontSize': 'Tamaño fuente',
      'terminal.help.theme': 'Cambiar tema',
      'terminal.help.context': 'Context（tocar para actualizar）',
      'terminal.help.switchSession': 'Cambiar / mantener para elegir',
      'terminal.help.historyBtn': 'Historial terminal (desplazar / tirar)',
      'terminal.help.tip': 'Clic en ⋯ para más',
      'terminal.help.tipDebug': 'Clic en título para logs',
      'terminal.help.tipFont': '¿Salida desordenada? Ajusta el tamaño',
      'terminal.help.workdir': 'Abrir directorio de trabajo',
      'terminal.keys.combo': 'Combinaciones',
      'terminal.keys.clear': 'Limpiar',
      'terminal.keys.verbose': 'Detallado',
      'terminal.keys.background': 'Fondo',
      'terminal.keys.rollback': 'Revertir',
      'terminal.keys.mode': 'Modo',
      'terminal.keys.slash': 'Comandos slash',
      'terminal.send': 'Enviar',

      // Estado de conexión
      'status.connecting': 'Conectando...',
      'status.connected': 'Conectado',
      'status.disconnected': 'Desconectado',
      'status.reconnecting': 'Reconectando...',
      'status.error': 'Error de conexión',

      // Común
      'common.cancel': 'Cancelar',
      'common.confirm': 'Confirmar',
      'common.delete': 'Eliminar',
      'common.rename': 'Renombrar',
      'common.close': 'Cerrar',
      'common.retry': 'Reintentar',
      'common.loading': 'Cargando...',

      // Explorador de archivos
      'files.empty': 'Carpeta vacía',
      'files.goHome': 'Inicio',
      'files.goToRoot': 'Raíz',
      'files.uploadFile': 'Subir archivo',
      'files.showHidden': 'Mostrar archivos ocultos',
      'files.hideHidden': 'Ocultar archivos ocultos',
      'files.sortByName': 'Ordenar por nombre',
      'files.sortByTime': 'Ordenar por fecha',
      'files.uploadHistory': 'Historial de subidas',
      'files.downloadHistory': 'Historial de descargas',
      'files.noUploads': 'Sin historial de subidas',
      'files.noDownloads': 'Sin historial de descargas',
      'files.recentUploads': 'Subidas recientes',
      'files.recentDownloads': 'Descargas recientes',
      'files.historyFailed': 'Error al cargar historial',
      'files.downloadStarted': 'Descarga iniciada',
      'files.downloadFailed': 'Descarga fallida',
      'files.download': 'Descargar',

      // Tarjeta de sesión
      'session.running': 'Ejecutando',
      'session.rename': 'Renombrar',
      'session.delete': 'Eliminar',
      'session.status.active': 'Activo',
      'session.status.idle': 'Inactivo',
      'session.status.stopped': 'Detenido',

      // Contenido dinámico
      'login.verifying': 'Verificando...',
      'login.tokenInvalid': 'Token de acceso inválido',
      'login.networkError': 'Error de red, intente más tarde',
      'login.tokenExpired': 'Token expirado, inicie sesión de nuevo',
      'login.sessionExpired': 'Sesión expirada, inicie sesión de nuevo',

      'settings.fillAll': 'Complete todos los campos',
      'settings.minLength': 'La contraseña debe tener al menos 6 caracteres',
      'settings.notMatch': 'Las contraseñas no coinciden',
      'settings.updating': 'Actualizando...',
      'settings.passwordChanged': 'Contraseña cambiada, inicie sesión de nuevo',
      'settings.changeFailed': 'Error al cambiar',

      'sessions.emptyHint': 'Clic en + para crear sesión',
      'sessions.loadFailed': 'Error al cargar',

      'create.noHistory': 'Sin directorios recientes',
      'create.noSubdirs': 'Sin subdirectorios',
      'create.noClaude': 'Sin sesiones Claude en este directorio',
      'create.unnamed': 'Sesión sin nombre',
      'create.failed': 'Error al crear sesión',

      'status.timeout': 'Tiempo de conexión agotado',
      'status.clickRetry': 'Clic para reintentar',
      'status.manualRetry': 'Reintento manual',
      'status.startingSession': 'Iniciando sesión',
      'status.waitingInit': 'Inicializando terminal',
      'status.failed': 'Conexión fallida',
      'status.checkNetwork': 'Verifique su conexión',
      'status.code': 'Código',

      'reconnect.failed': 'Conexión fallida, reconecte manualmente',
      'reconnect.trying': 'Reconectando',

      'usage.noData': 'Sin datos',
      'usage.periodText': 'Período actual',
      'usage.resetIn': 'para reinicio',
      'usage.periodReset': 'Período reiniciado',

      'confirm.logout': '¿Desea cerrar sesión?',
      'confirm.delete': '¿Eliminar esta sesión?',
      'prompt.rename': 'Ingrese nuevo nombre:',

      'error.renameFailed': 'Error al renombrar',
      'error.deleteFailed': 'Error al eliminar sesión',
      'error.loadSessions': 'Error al cargar sesiones',
      'error.terminalInit': 'Error al inicializar terminal',

      'time.justNow': 'Ahora mismo',
      'time.minutesAgo': 'min',
      'time.hoursAgo': 'h',

      'terminal.inputPlaceholder': 'Escriba un mensaje...',
      'terminal.noWorkDir': 'Sin directorio de trabajo',

      // Panel de depuración
      'debug.title': 'Registro de depuración',
      'debug.copy': 'Copiar',
      'debug.copied': '¡Copiado!',
      'debug.clear': 'Limpiar',
      'debug.close': 'Cerrar',

      // Subir archivo
      'settings.upload': 'Subir archivo',
      'upload.uploading': 'Subiendo...',
      'upload.success': 'Subida exitosa',
      'upload.failed': 'Error al subir',
      'upload.fileTooLarge': 'Archivo demasiado grande (máx 500MB)',
      'upload.networkError': 'Error de red',
      'upload.successTitle': 'Subida exitosa',
      'upload.filePath': 'Ruta del archivo',
      'upload.copyPath': 'Copiar ruta',
      'upload.copied': '¡Copiado!',
      'upload.historyTitle': 'Historial de subidas',
      'upload.noHistory': 'Sin historial de subidas',
      'upload.loadError': 'Error al cargar',
      'upload.pathCopied': 'Ruta copiada',
      'settings.uploadHistory': 'Historial de subidas',
      'settings.download': 'Descargar archivos',
      'settings.downloadHistory': 'Historial de descargas',
      'settings.terminalHistory': 'Historial de terminal',

      // Descarga
      'download.browserTitle': 'Explorador de archivos',
      'download.parentDir': 'Superior',
      'download.emptyDir': 'Directorio vacío',
      'download.goHome': 'Ir al inicio',
      'download.success': 'Descarga iniciada',
      'download.historyTitle': 'Historial de descargas',
      'download.noHistory': 'Sin historial de descargas',
      'download.loadError': 'Error al cargar',

      // Historial de terminal
      'history.title': 'Historial de terminal',
      'history.sessionHistory': 'Historial de sesión',
      'history.noSessions': 'Sin historial de terminal',
      'history.noMessages': 'Sin mensajes en esta sesión',
      'history.loadError': 'Error al cargar',
      'history.loadMore': 'Cargar más',
      'history.messages': 'mensajes',
      'history.input': 'Entrada',
      'history.output': 'Salida',

      // Barra de herramientas
      'terminal.historyBtn': 'Historial',
      'common.loading': 'Cargando...',

      // Monitor
      'monitor.title': 'Monitor',
      'monitor.memory': 'Memoria',
      'monitor.disk': 'Disco',
      'monitor.topProcesses': 'Procesos',
    },

    ru: {
      // Вход
      'login.subtitle': 'Введите токен доступа',
      'login.placeholder': 'Токен доступа',
      'login.button': 'Войти',

      // Список сессий
      'sessions.usage': 'Использование',
      'sessions.settings': 'Настройки',
      'sessions.help': 'Помощь',
      'sessions.transfer': 'Передача',

      // Меню передачи
      'transfer.upload': 'Загрузить файл',
      'transfer.download': 'Скачать файл',
      'transfer.uploadHistory': 'История загрузок',
      'transfer.downloadHistory': 'История скачиваний',
      'transfer.terminalHistory': 'История терминала',

      // Настройки
      'settings.logout': 'Выйти',
      'sessions.logout': 'Выйти',
      'sessions.card': 'Карточка',
      'sessions.help.title': 'Помощь',
      'sessions.help.usage': 'Статистика',
      'sessions.help.pull': 'Легко потянуть / Сильно для перезагрузки',
      'sessions.help.cardButtons': 'Переименовать / Удалить',
      'sessions.help.history': 'История терминала',
      'sessions.help.tip': 'Нажмите слева вверху для логов',
      'sessions.help.contextTitle': 'Иконки Context',
      'sessions.help.ctxUsed': 'Использовано / Макс (%)',
      'sessions.help.ctxFree': 'Свободно',
      'sessions.help.ctxCompact': 'До сжатия',
      'sessions.help.ctxTotal': 'Всего потрачено',
      'sessions.help.transferTitle': 'Передача',
      'sessions.help.transfer': 'Загрузка/Скачивание файлов',
      'sessions.loading': 'Загрузка...',
      'sessions.empty': 'Нет сессий',
      'sessions.pullToRefresh': 'Потяните для обновления',
      'sessions.releaseToRefresh': 'Отпустите для обновления данных',
      'sessions.releaseToReload': 'Отпустите для перезагрузки',
      'sessions.refreshing': 'Обновление...',

      // Использование
      'usage.period': 'Текущий период',
      'usage.today': 'Сегодня',
      'usage.month': 'Месяц',
      'usage.fiveHour': '5-часовой период',
      'usage.sevenDay': '7-дневный период',
      'usage.connections': 'Подкл.',
      'usage.terminals': 'Терм.',
      'usage.days': 'д',
      'usage.refresh': 'Обновить',
      'usage.trend': 'Тренд за 7 дней',
      'usage.loading': 'Загрузка...',

      // Создание сессии
      'create.title': 'Новая сессия',
      'create.step1': 'Выберите директорию',
      'create.history': 'Недавние',
      'create.browse': 'Обзор',
      'create.select': 'Выбрать',
      'create.step2': 'Выберите сессию Claude',
      'create.change': 'Изменить',
      'create.new': 'Создать',

      // Настройки
      'settings.language': 'Язык',
      'settings.title': 'Изменить пароль',
      'settings.oldPassword': 'Старый пароль',
      'settings.newPassword': 'Новый пароль',
      'settings.newPasswordHint': 'Минимум 6 символов',
      'settings.confirmPassword': 'Подтвердить',
      'settings.confirm': 'Подтвердить',

      // Терминал
      'terminal.title': 'Терминал',
      'terminal.minimize': 'Свернуть',
      'terminal.close': 'Закрыть',
      'terminal.help.title': 'Горячие клавиши',
      'terminal.help.keysTitle': 'Горячие клавиши',
      'terminal.help.nav': 'Навиг.',
      'terminal.help.danger': 'Стоп',
      'terminal.help.action': 'Действие',
      'terminal.help.history': 'История',
      'terminal.help.scroll': 'Прокрутка (удерживать)',
      'terminal.help.stop': 'Стоп',
      'terminal.help.complete': 'Автодополнение',
      'terminal.help.send': 'Отправить',
      'terminal.help.floatTitle': 'Плавающие кнопки',
      'terminal.help.fontSize': 'Размер шрифта',
      'terminal.help.theme': 'Сменить тему',
      'terminal.help.context': 'Context（нажать для обновления）',
      'terminal.help.switchSession': 'Переключить / удерживать',
      'terminal.help.historyBtn': 'История терминала (прокрутка / потянуть)',
      'terminal.help.tip': 'Нажмите ⋯ для большего',
      'terminal.help.tipDebug': 'Нажмите на заголовок для логов',
      'terminal.help.tipFont': 'Вывод сбился? Измените размер шрифта',
      'terminal.help.workdir': 'Открыть рабочий каталог',
      'terminal.keys.combo': 'Комбинации',
      'terminal.keys.clear': 'Очистить',
      'terminal.keys.verbose': 'Подробно',
      'terminal.keys.background': 'Фон',
      'terminal.keys.rollback': 'Откат',
      'terminal.keys.mode': 'Режим',
      'terminal.keys.slash': 'Slash-команды',
      'terminal.send': 'Отправить',

      // Статус подключения
      'status.connecting': 'Подключение...',
      'status.connected': 'Подключено',
      'status.disconnected': 'Отключено',
      'status.reconnecting': 'Переподключение...',
      'status.error': 'Ошибка подключения',

      // Общие
      'common.cancel': 'Отмена',
      'common.confirm': 'Подтвердить',
      'common.delete': 'Удалить',
      'common.rename': 'Переименовать',
      'common.close': 'Закрыть',
      'common.retry': 'Повторить',
      'common.loading': 'Загрузка...',

      // Файловый браузер
      'files.empty': 'Пустая папка',
      'files.goHome': 'Домой',
      'files.goToRoot': 'Корень',
      'files.uploadFile': 'Загрузить файл',
      'files.showHidden': 'Показать скрытые файлы',
      'files.hideHidden': 'Скрыть скрытые файлы',
      'files.sortByName': 'По имени',
      'files.sortByTime': 'По времени',
      'files.uploadHistory': 'История загрузок',
      'files.downloadHistory': 'История скачиваний',
      'files.noUploads': 'Нет загрузок',
      'files.noDownloads': 'Нет скачиваний',
      'files.recentUploads': 'Последние загрузки',
      'files.recentDownloads': 'Последние скачивания',
      'files.historyFailed': 'Ошибка загрузки истории',
      'files.downloadStarted': 'Загрузка начата',
      'files.downloadFailed': 'Ошибка загрузки',
      'files.download': 'Скачать',

      // Карточка сессии
      'session.running': 'Работает',
      'session.rename': 'Переименовать',
      'session.delete': 'Удалить',
      'session.status.active': 'Активна',
      'session.status.idle': 'Ожидание',
      'session.status.stopped': 'Остановлена',

      // Динамический контент
      'login.verifying': 'Проверка...',
      'login.tokenInvalid': 'Неверный токен доступа',
      'login.networkError': 'Ошибка сети, попробуйте позже',
      'login.tokenExpired': 'Токен истёк, войдите снова',
      'login.sessionExpired': 'Сессия истекла, войдите снова',

      'settings.fillAll': 'Заполните все поля',
      'settings.minLength': 'Пароль минимум 6 символов',
      'settings.notMatch': 'Пароли не совпадают',
      'settings.updating': 'Обновление...',
      'settings.passwordChanged': 'Пароль изменён, войдите снова',
      'settings.changeFailed': 'Ошибка изменения',

      'sessions.emptyHint': 'Нажмите + для создания сессии',
      'sessions.loadFailed': 'Ошибка загрузки',

      'create.noHistory': 'Нет недавних директорий',
      'create.noSubdirs': 'Нет поддиректорий',
      'create.noClaude': 'Нет сессий Claude в этой директории',
      'create.unnamed': 'Без названия',
      'create.failed': 'Ошибка создания сессии',

      'status.timeout': 'Таймаут подключения',
      'status.clickRetry': 'Нажмите для повтора',
      'status.manualRetry': 'Ручной повтор',
      'status.startingSession': 'Запуск сессии',
      'status.waitingInit': 'Инициализация терминала',
      'status.failed': 'Ошибка подключения',
      'status.checkNetwork': 'Проверьте подключение',
      'status.code': 'Код',

      'reconnect.failed': 'Ошибка подключения, переподключитесь вручную',
      'reconnect.trying': 'Переподключение',

      'usage.noData': 'Нет данных',
      'usage.periodText': 'Текущий период',
      'usage.resetIn': 'до сброса',
      'usage.periodReset': 'Период сброшен',

      'confirm.logout': 'Выйти из системы?',
      'confirm.delete': 'Удалить эту сессию?',
      'prompt.rename': 'Введите новое имя:',

      'error.renameFailed': 'Ошибка переименования',
      'error.deleteFailed': 'Ошибка удаления сессии',
      'error.loadSessions': 'Ошибка загрузки сессий',
      'error.terminalInit': 'Ошибка инициализации терминала',

      'time.justNow': 'Только что',
      'time.minutesAgo': 'мин.',
      'time.hoursAgo': 'ч.',

      'terminal.inputPlaceholder': 'Введите сообщение...',
      'terminal.noWorkDir': 'Нет рабочего каталога',

      // Панель отладки
      'debug.title': 'Журнал отладки',
      'debug.copy': 'Копировать',
      'debug.copied': 'Скопировано!',
      'debug.clear': 'Очистить',
      'debug.close': 'Закрыть',

      // Загрузка
      'settings.upload': 'Загрузить файл',
      'upload.uploading': 'Загрузка...',
      'upload.success': 'Загрузка успешна',
      'upload.failed': 'Ошибка загрузки',
      'upload.fileTooLarge': 'Файл слишком большой (макс 500МБ)',
      'upload.networkError': 'Ошибка сети',
      'upload.successTitle': 'Загрузка успешна',
      'upload.filePath': 'Путь к файлу',
      'upload.copyPath': 'Копировать путь',
      'upload.copied': 'Скопировано!',
      'upload.historyTitle': 'История загрузок',
      'upload.noHistory': 'Нет истории загрузок',
      'upload.loadError': 'Ошибка загрузки',
      'upload.pathCopied': 'Путь скопирован',
      'settings.uploadHistory': 'История загрузок',
      'settings.download': 'Скачать файлы',
      'settings.downloadHistory': 'История скачиваний',
      'settings.terminalHistory': 'История терминала',

      // Скачивание
      'download.browserTitle': 'Файловый менеджер',
      'download.parentDir': 'Наверх',
      'download.emptyDir': 'Пустая папка',
      'download.goHome': 'На главную',
      'download.success': 'Загрузка начата',
      'download.historyTitle': 'История скачиваний',
      'download.noHistory': 'Нет истории скачиваний',
      'download.loadError': 'Ошибка загрузки',

      // История терминала
      'history.title': 'История терминала',
      'history.sessionHistory': 'История сессии',
      'history.noSessions': 'Нет истории терминала',
      'history.noMessages': 'Нет сообщений в этой сессии',
      'history.loadError': 'Ошибка загрузки',
      'history.loadMore': 'Загрузить ещё',
      'history.messages': 'сообщений',
      'history.input': 'Ввод',
      'history.output': 'Вывод',

      // Панель инструментов
      'terminal.historyBtn': 'История',
      'common.loading': 'Загрузка...',

      // Монитор
      'monitor.title': 'Монитор',
      'monitor.memory': 'Память',
      'monitor.disk': 'Диск',
      'monitor.topProcesses': 'Процессы',
    },

    pt: {
      // Login
      'login.subtitle': 'Digite o token de acesso',
      'login.placeholder': 'Token de acesso',
      'login.button': 'Entrar',

      // Lista de sessões
      'sessions.usage': 'Uso',
      'sessions.settings': 'Configurações',
      'sessions.help': 'Ajuda',
      'sessions.transfer': 'Transferência',

      // Menu de transferência
      'transfer.upload': 'Enviar arquivo',
      'transfer.download': 'Baixar arquivo',
      'transfer.uploadHistory': 'Histórico de envios',
      'transfer.downloadHistory': 'Histórico de downloads',
      'transfer.terminalHistory': 'Histórico do terminal',

      // Configurações
      'settings.logout': 'Sair',
      'sessions.logout': 'Sair',
      'sessions.card': 'Cartão',
      'sessions.help.title': 'Ajuda',
      'sessions.help.usage': 'Ver estatísticas',
      'sessions.help.pull': 'Puxar leve / forte para recarregar',
      'sessions.help.cardButtons': 'Renomear / Excluir',
      'sessions.help.history': 'Ver histórico terminal',
      'sessions.help.tip': 'Clique no canto superior esquerdo para logs',
      'sessions.help.contextTitle': 'Ícones Context',
      'sessions.help.ctxUsed': 'Usado / Máx (%)',
      'sessions.help.ctxFree': 'Espaço livre',
      'sessions.help.ctxCompact': 'Até compactar',
      'sessions.help.ctxTotal': 'Total consumido',
      'sessions.help.transferTitle': 'Transferência',
      'sessions.help.transfer': 'Upload/Download de arquivos',
      'sessions.loading': 'Carregando...',
      'sessions.empty': 'Sem sessões',
      'sessions.pullToRefresh': 'Puxe para atualizar',
      'sessions.releaseToRefresh': 'Solte para atualizar dados',
      'sessions.releaseToReload': 'Solte para recarregar página',
      'sessions.refreshing': 'Atualizando...',

      // Uso
      'usage.period': 'Período atual',
      'usage.today': 'Hoje',
      'usage.month': 'Mês',
      'usage.fiveHour': 'Período 5h',
      'usage.sevenDay': 'Período 7d',
      'usage.connections': 'Conex.',
      'usage.terminals': 'Term.',
      'usage.days': 'd',
      'usage.refresh': 'Atualizar',
      'usage.trend': 'Tendência 7 dias',
      'usage.loading': 'Carregando...',

      // Criar sessão
      'create.title': 'Nova sessão',
      'create.step1': 'Selecionar diretório',
      'create.history': 'Recentes',
      'create.browse': 'Procurar',
      'create.select': 'Selecionar',
      'create.step2': 'Selecionar sessão Claude',
      'create.change': 'Alterar',
      'create.new': 'Criar',

      // Configurações
      'settings.language': 'Idioma',
      'settings.title': 'Alterar senha',
      'settings.oldPassword': 'Senha atual',
      'settings.newPassword': 'Nova senha',
      'settings.newPasswordHint': 'Pelo menos 6 caracteres',
      'settings.confirmPassword': 'Confirmar',
      'settings.confirm': 'Confirmar',

      // Terminal
      'terminal.title': 'Terminal',
      'terminal.minimize': 'Minimizar',
      'terminal.close': 'Fechar',
      'terminal.help.title': 'Atalhos de teclado',
      'terminal.help.keysTitle': 'Atalhos',
      'terminal.help.nav': 'Nav',
      'terminal.help.danger': 'Parar',
      'terminal.help.action': 'Ação',
      'terminal.help.history': 'Histórico',
      'terminal.help.scroll': 'Rolar (segurar para contínuo)',
      'terminal.help.stop': 'Parar',
      'terminal.help.complete': 'Auto completar',
      'terminal.help.send': 'Enviar',
      'terminal.help.floatTitle': 'Botões flutuantes',
      'terminal.help.fontSize': 'Tamanho fonte',
      'terminal.help.theme': 'Mudar tema',
      'terminal.help.context': 'Context（tocar para atualizar）',
      'terminal.help.switchSession': 'Trocar / segurar para escolher',
      'terminal.help.historyBtn': 'Histórico terminal (rolar / puxar)',
      'terminal.help.tip': 'Clique em ⋯ para mais',
      'terminal.help.tipDebug': 'Clique no título para logs',
      'terminal.help.tipFont': 'Saída bagunçada? Ajuste o tamanho',
      'terminal.help.workdir': 'Abrir diretório de trabalho',
      'terminal.keys.combo': 'Combinações',
      'terminal.keys.clear': 'Limpar',
      'terminal.keys.verbose': 'Detalhado',
      'terminal.keys.background': 'Segundo plano',
      'terminal.keys.rollback': 'Reverter',
      'terminal.keys.mode': 'Modo',
      'terminal.keys.slash': 'Comandos slash',
      'terminal.send': 'Enviar',

      // Status de conexão
      'status.connecting': 'Conectando...',
      'status.connected': 'Conectado',
      'status.disconnected': 'Desconectado',
      'status.reconnecting': 'Reconectando...',
      'status.error': 'Erro de conexão',

      // Comum
      'common.cancel': 'Cancelar',
      'common.confirm': 'Confirmar',
      'common.delete': 'Excluir',
      'common.rename': 'Renomear',
      'common.close': 'Fechar',
      'common.retry': 'Tentar novamente',
      'common.loading': 'Carregando...',

      // Navegador de arquivos
      'files.empty': 'Pasta vazia',
      'files.goHome': 'Início',
      'files.goToRoot': 'Raiz',
      'files.uploadFile': 'Carregar arquivo',
      'files.showHidden': 'Mostrar arquivos ocultos',
      'files.hideHidden': 'Ocultar arquivos ocultos',
      'files.sortByName': 'Ordenar por nome',
      'files.sortByTime': 'Ordenar por data',
      'files.uploadHistory': 'Histórico de uploads',
      'files.downloadHistory': 'Histórico de downloads',
      'files.noUploads': 'Sem histórico de uploads',
      'files.noDownloads': 'Sem histórico de downloads',
      'files.recentUploads': 'Uploads recentes',
      'files.recentDownloads': 'Downloads recentes',
      'files.historyFailed': 'Falha ao carregar histórico',
      'files.downloadStarted': 'Download iniciado',
      'files.downloadFailed': 'Falha no download',
      'files.download': 'Baixar',

      // Cartão de sessão
      'session.running': 'Executando',
      'session.rename': 'Renomear',
      'session.delete': 'Excluir',
      'session.status.active': 'Ativo',
      'session.status.idle': 'Inativo',
      'session.status.stopped': 'Parado',

      // Conteúdo dinâmico
      'login.verifying': 'Verificando...',
      'login.tokenInvalid': 'Token de acesso inválido',
      'login.networkError': 'Erro de rede, tente mais tarde',
      'login.tokenExpired': 'Token expirado, faça login novamente',
      'login.sessionExpired': 'Sessão expirada, faça login novamente',

      'settings.fillAll': 'Preencha todos os campos',
      'settings.minLength': 'A senha deve ter pelo menos 6 caracteres',
      'settings.notMatch': 'As senhas não coincidem',
      'settings.updating': 'Atualizando...',
      'settings.passwordChanged': 'Senha alterada, faça login novamente',
      'settings.changeFailed': 'Falha ao alterar',

      'sessions.emptyHint': 'Clique em + para criar sessão',
      'sessions.loadFailed': 'Falha ao carregar',

      'create.noHistory': 'Sem diretórios recentes',
      'create.noSubdirs': 'Sem subdiretórios',
      'create.noClaude': 'Sem sessões Claude neste diretório',
      'create.unnamed': 'Sessão sem nome',
      'create.failed': 'Falha ao criar sessão',

      'status.timeout': 'Tempo de conexão esgotado',
      'status.clickRetry': 'Clique para tentar novamente',
      'status.manualRetry': 'Tentativa manual',
      'status.startingSession': 'Iniciando sessão',
      'status.waitingInit': 'Inicializando terminal',
      'status.failed': 'Falha na conexão',
      'status.checkNetwork': 'Verifique sua conexão',
      'status.code': 'Código',

      'reconnect.failed': 'Falha na conexão, reconecte manualmente',
      'reconnect.trying': 'Reconectando',

      'usage.noData': 'Sem dados',
      'usage.periodText': 'Período atual',
      'usage.resetIn': 'para reinício',
      'usage.periodReset': 'Período reiniciado',

      'confirm.logout': 'Deseja sair?',
      'confirm.delete': 'Excluir esta sessão?',
      'prompt.rename': 'Digite o novo nome:',

      'error.renameFailed': 'Falha ao renomear',
      'error.deleteFailed': 'Falha ao excluir sessão',
      'error.loadSessions': 'Falha ao carregar sessões',
      'error.terminalInit': 'Falha ao inicializar terminal',

      'time.justNow': 'Agora mesmo',
      'time.minutesAgo': 'min',
      'time.hoursAgo': 'h',

      'terminal.inputPlaceholder': 'Digite uma mensagem...',
      'terminal.noWorkDir': 'Sem diretório de trabalho',

      // Painel de depuração
      'debug.title': 'Log de depuração',
      'debug.copy': 'Copiar',
      'debug.copied': 'Copiado!',
      'debug.clear': 'Limpar',
      'debug.close': 'Fechar',

      // Upload
      'settings.upload': 'Enviar arquivo',
      'upload.uploading': 'Enviando...',
      'upload.success': 'Envio bem-sucedido',
      'upload.failed': 'Falha no envio',
      'upload.fileTooLarge': 'Arquivo muito grande (máx 500MB)',
      'upload.networkError': 'Erro de rede',
      'upload.successTitle': 'Envio bem-sucedido',
      'upload.filePath': 'Caminho do arquivo',
      'upload.copyPath': 'Copiar caminho',
      'upload.copied': 'Copiado!',
      'upload.historyTitle': 'Histórico de envios',
      'upload.noHistory': 'Sem histórico de envios',
      'upload.loadError': 'Falha ao carregar',
      'upload.pathCopied': 'Caminho copiado',
      'settings.uploadHistory': 'Histórico de envios',
      'settings.download': 'Baixar arquivos',
      'settings.downloadHistory': 'Histórico de downloads',
      'settings.terminalHistory': 'Histórico do terminal',

      // Download
      'download.browserTitle': 'Navegador de arquivos',
      'download.parentDir': 'Acima',
      'download.emptyDir': 'Pasta vazia',
      'download.goHome': 'Ir para início',
      'download.success': 'Download iniciado',
      'download.historyTitle': 'Histórico de downloads',
      'download.noHistory': 'Sem histórico de downloads',
      'download.loadError': 'Falha ao carregar',

      // Histórico do terminal
      'history.title': 'Histórico do terminal',
      'history.sessionHistory': 'Histórico da sessão',
      'history.noSessions': 'Sem histórico do terminal',
      'history.noMessages': 'Sem mensagens nesta sessão',
      'history.loadError': 'Falha ao carregar',
      'history.loadMore': 'Carregar mais',
      'history.messages': 'mensagens',
      'history.input': 'Entrada',
      'history.output': 'Saída',

      // Barra de ferramentas
      'terminal.historyBtn': 'Histórico',
      'common.loading': 'Carregando...',

      // Monitor
      'monitor.title': 'Monitor',
      'monitor.memory': 'Memória',
      'monitor.disk': 'Disco',
      'monitor.topProcesses': 'Processos',
    }
  },

  /**
   * 初始化
   */
  init() {
    // 从 localStorage 读取语言设置，默认英文
    const savedLang = localStorage.getItem('language');
    if (savedLang && this.translations[savedLang]) {
      this.currentLang = savedLang;
    } else {
      this.currentLang = 'en';
    }
    this.apply();
  },

  /**
   * 获取翻译
   */
  t(key, fallback) {
    const translations = this.translations[this.currentLang];
    return translations[key] || fallback || key;
  },

  /**
   * 切换语言
   */
  setLanguage(lang) {
    console.log('[i18n] setLanguage:', lang);
    if (this.translations[lang]) {
      this.currentLang = lang;
      localStorage.setItem('language', lang);
      console.log('[i18n] Language set to:', this.currentLang);
      this.apply();
    } else {
      console.warn('[i18n] Unknown language:', lang);
    }
  },

  /**
   * 获取语言显示名称
   */
  getLanguageName(lang) {
    return this.languages[lang] || lang;
  },

  /**
   * 获取所有支持的语言
   */
  getSupportedLanguages() {
    return Object.keys(this.languages);
  },

  /**
   * 应用翻译到页面
   */
  apply() {
    // 更新所有带 data-i18n 属性的元素
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      el.textContent = this.t(key);
    });

    // 更新所有带 data-i18n-placeholder 属性的元素
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      el.placeholder = this.t(key);
    });

    // 更新所有带 data-i18n-title 属性的元素
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      el.title = this.t(key);
    });
  }
};

// 导出
window.i18n = i18n;
