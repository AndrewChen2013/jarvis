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
      'sessions.logout': '退出登录',
      'sessions.card': '卡片',
      'sessions.help.title': '使用说明',
      'sessions.help.create': '创建新会话',
      'sessions.help.card': '点击进入终端',
      'sessions.help.rename': '修改会话名称',
      'sessions.help.delete': '删除会话记录',
      'sessions.help.password': '修改访问密码',
      'sessions.help.logout': '退出登录',
      'sessions.help.tip': '点击左上角可查看调试日志',
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
      'terminal.help.nav': '导航',
      'terminal.help.danger': '中断',
      'terminal.help.action': '确认',
      'terminal.help.control': '控制',
      'terminal.help.history': '历史命令导航',
      'terminal.help.scroll': '滚动（长按连续）',
      'terminal.help.cancel': '取消当前输入',
      'terminal.help.interrupt': '中断当前操作',
      'terminal.help.complete': '自动补全',
      'terminal.help.send': '发送/确认',
      'terminal.help.tip': '点击 ⋯ 展开组合键和斜杠命令',
      'terminal.keys.combo': '组合键',
      'terminal.keys.clear': '清屏',
      'terminal.keys.verbose': '详细',
      'terminal.keys.background': '后台',
      'terminal.keys.rollback': '回滚',
      'terminal.keys.mode': '模式',
      'terminal.keys.slash': '斜杠命令',
      'terminal.send': '发送',

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

      // 调试面板
      'debug.title': '调试日志',
      'debug.copy': '复制',
      'debug.copied': '已复制!',
      'debug.clear': '清除',
      'debug.close': '关闭',
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
      'sessions.logout': 'Logout',
      'sessions.card': 'Card',
      'sessions.help.title': 'Help',
      'sessions.help.create': 'Create new session',
      'sessions.help.card': 'Click to enter terminal',
      'sessions.help.rename': 'Rename session',
      'sessions.help.delete': 'Delete session',
      'sessions.help.password': 'Change password',
      'sessions.help.logout': 'Logout',
      'sessions.help.tip': 'Click top-left to view debug logs',
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
      'terminal.help.nav': 'Nav',
      'terminal.help.danger': 'Stop',
      'terminal.help.action': 'Action',
      'terminal.help.control': 'Control',
      'terminal.help.history': 'Command history',
      'terminal.help.scroll': 'Scroll (hold for continuous)',
      'terminal.help.cancel': 'Cancel input',
      'terminal.help.interrupt': 'Interrupt operation',
      'terminal.help.complete': 'Auto complete',
      'terminal.help.send': 'Send/Confirm',
      'terminal.help.tip': 'Click ⋯ for more keys and slash commands',
      'terminal.keys.combo': 'Combo keys',
      'terminal.keys.clear': 'Clear',
      'terminal.keys.verbose': 'Verbose',
      'terminal.keys.background': 'Background',
      'terminal.keys.rollback': 'Rollback',
      'terminal.keys.mode': 'Mode',
      'terminal.keys.slash': 'Slash commands',
      'terminal.send': 'Send',

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

      // Debug panel
      'debug.title': 'Debug Log',
      'debug.copy': 'Copy',
      'debug.copied': 'Copied!',
      'debug.clear': 'Clear',
      'debug.close': 'Close',
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
      'sessions.logout': 'ログアウト',
      'sessions.card': 'カード',
      'sessions.help.title': '使い方',
      'sessions.help.create': '新規セッション作成',
      'sessions.help.card': 'クリックでターミナルへ',
      'sessions.help.rename': 'セッション名変更',
      'sessions.help.delete': 'セッション削除',
      'sessions.help.password': 'パスワード変更',
      'sessions.help.logout': 'ログアウト',
      'sessions.help.tip': '左上をクリックでデバッグログ表示',
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
      'terminal.help.nav': 'ナビ',
      'terminal.help.danger': '中断',
      'terminal.help.action': '実行',
      'terminal.help.control': '制御',
      'terminal.help.history': 'コマンド履歴',
      'terminal.help.scroll': 'スクロール（長押しで連続）',
      'terminal.help.cancel': '入力キャンセル',
      'terminal.help.interrupt': '処理中断',
      'terminal.help.complete': '自動補完',
      'terminal.help.send': '送信/確認',
      'terminal.help.tip': '⋯をクリックで詳細表示',
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

      // デバッグパネル
      'debug.title': 'デバッグログ',
      'debug.copy': 'コピー',
      'debug.copied': 'コピーしました!',
      'debug.clear': 'クリア',
      'debug.close': '閉じる',
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
      'sessions.logout': '로그아웃',
      'sessions.card': '카드',
      'sessions.help.title': '사용법',
      'sessions.help.create': '새 세션 만들기',
      'sessions.help.card': '클릭하여 터미널 열기',
      'sessions.help.rename': '세션 이름 변경',
      'sessions.help.delete': '세션 삭제',
      'sessions.help.password': '비밀번호 변경',
      'sessions.help.logout': '로그아웃',
      'sessions.help.tip': '왼쪽 상단을 클릭하여 디버그 로그 보기',
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
      'terminal.help.nav': '탐색',
      'terminal.help.danger': '중단',
      'terminal.help.action': '실행',
      'terminal.help.control': '제어',
      'terminal.help.history': '명령어 기록',
      'terminal.help.scroll': '스크롤 (길게 누르면 연속)',
      'terminal.help.cancel': '입력 취소',
      'terminal.help.interrupt': '작업 중단',
      'terminal.help.complete': '자동 완성',
      'terminal.help.send': '전송/확인',
      'terminal.help.tip': '⋯를 클릭하여 더 보기',
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

      // 디버그 패널
      'debug.title': '디버그 로그',
      'debug.copy': '복사',
      'debug.copied': '복사됨!',
      'debug.clear': '지우기',
      'debug.close': '닫기',
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
      'sessions.logout': 'Déconnexion',
      'sessions.card': 'Carte',
      'sessions.help.title': 'Aide',
      'sessions.help.create': 'Créer une session',
      'sessions.help.card': 'Cliquez pour ouvrir le terminal',
      'sessions.help.rename': 'Renommer la session',
      'sessions.help.delete': 'Supprimer la session',
      'sessions.help.password': 'Changer le mot de passe',
      'sessions.help.logout': 'Déconnexion',
      'sessions.help.tip': 'Cliquez en haut à gauche pour les logs',
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
      'terminal.help.nav': 'Nav',
      'terminal.help.danger': 'Stop',
      'terminal.help.action': 'Action',
      'terminal.help.control': 'Contrôle',
      'terminal.help.history': 'Historique des commandes',
      'terminal.help.scroll': 'Défiler (maintenir pour continu)',
      'terminal.help.cancel': 'Annuler la saisie',
      'terminal.help.interrupt': 'Interrompre',
      'terminal.help.complete': 'Auto-complétion',
      'terminal.help.send': 'Envoyer/Confirmer',
      'terminal.help.tip': 'Cliquez sur ⋯ pour plus',
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

      // Panneau de débogage
      'debug.title': 'Journal de débogage',
      'debug.copy': 'Copier',
      'debug.copied': 'Copié !',
      'debug.clear': 'Effacer',
      'debug.close': 'Fermer',
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
      'sessions.logout': 'Abmelden',
      'sessions.card': 'Karte',
      'sessions.help.title': 'Hilfe',
      'sessions.help.create': 'Neue Sitzung erstellen',
      'sessions.help.card': 'Klicken für Terminal',
      'sessions.help.rename': 'Sitzung umbenennen',
      'sessions.help.delete': 'Sitzung löschen',
      'sessions.help.password': 'Passwort ändern',
      'sessions.help.logout': 'Abmelden',
      'sessions.help.tip': 'Oben links für Debug-Logs',
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
      'terminal.help.nav': 'Nav',
      'terminal.help.danger': 'Stopp',
      'terminal.help.action': 'Aktion',
      'terminal.help.control': 'Steuerung',
      'terminal.help.history': 'Befehlsverlauf',
      'terminal.help.scroll': 'Scrollen (halten für kontinuierlich)',
      'terminal.help.cancel': 'Eingabe abbrechen',
      'terminal.help.interrupt': 'Unterbrechen',
      'terminal.help.complete': 'Auto-Vervollständigung',
      'terminal.help.send': 'Senden/Bestätigen',
      'terminal.help.tip': 'Klicken Sie auf ⋯ für mehr',
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

      // Debug-Panel
      'debug.title': 'Debug-Log',
      'debug.copy': 'Kopieren',
      'debug.copied': 'Kopiert!',
      'debug.clear': 'Löschen',
      'debug.close': 'Schließen',
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
      'sessions.logout': 'Cerrar sesión',
      'sessions.card': 'Tarjeta',
      'sessions.help.title': 'Ayuda',
      'sessions.help.create': 'Crear nueva sesión',
      'sessions.help.card': 'Clic para abrir terminal',
      'sessions.help.rename': 'Renombrar sesión',
      'sessions.help.delete': 'Eliminar sesión',
      'sessions.help.password': 'Cambiar contraseña',
      'sessions.help.logout': 'Cerrar sesión',
      'sessions.help.tip': 'Clic arriba izquierda para logs',
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
      'terminal.help.nav': 'Nav',
      'terminal.help.danger': 'Parar',
      'terminal.help.action': 'Acción',
      'terminal.help.control': 'Control',
      'terminal.help.history': 'Historial de comandos',
      'terminal.help.scroll': 'Desplazar (mantener para continuo)',
      'terminal.help.cancel': 'Cancelar entrada',
      'terminal.help.interrupt': 'Interrumpir',
      'terminal.help.complete': 'Autocompletar',
      'terminal.help.send': 'Enviar/Confirmar',
      'terminal.help.tip': 'Clic en ⋯ para más',
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

      // Panel de depuración
      'debug.title': 'Registro de depuración',
      'debug.copy': 'Copiar',
      'debug.copied': '¡Copiado!',
      'debug.clear': 'Limpiar',
      'debug.close': 'Cerrar',
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
      'sessions.logout': 'Выйти',
      'sessions.card': 'Карточка',
      'sessions.help.title': 'Помощь',
      'sessions.help.create': 'Создать сессию',
      'sessions.help.card': 'Нажмите для терминала',
      'sessions.help.rename': 'Переименовать сессию',
      'sessions.help.delete': 'Удалить сессию',
      'sessions.help.password': 'Изменить пароль',
      'sessions.help.logout': 'Выйти',
      'sessions.help.tip': 'Нажмите слева вверху для логов',
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
      'terminal.help.nav': 'Навиг.',
      'terminal.help.danger': 'Стоп',
      'terminal.help.action': 'Действие',
      'terminal.help.control': 'Управление',
      'terminal.help.history': 'История команд',
      'terminal.help.scroll': 'Прокрутка (удерживать)',
      'terminal.help.cancel': 'Отменить ввод',
      'terminal.help.interrupt': 'Прервать',
      'terminal.help.complete': 'Автодополнение',
      'terminal.help.send': 'Отправить/Подтвердить',
      'terminal.help.tip': 'Нажмите ⋯ для большего',
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

      // Панель отладки
      'debug.title': 'Журнал отладки',
      'debug.copy': 'Копировать',
      'debug.copied': 'Скопировано!',
      'debug.clear': 'Очистить',
      'debug.close': 'Закрыть',
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
      'sessions.logout': 'Sair',
      'sessions.card': 'Cartão',
      'sessions.help.title': 'Ajuda',
      'sessions.help.create': 'Criar nova sessão',
      'sessions.help.card': 'Clique para abrir terminal',
      'sessions.help.rename': 'Renomear sessão',
      'sessions.help.delete': 'Excluir sessão',
      'sessions.help.password': 'Alterar senha',
      'sessions.help.logout': 'Sair',
      'sessions.help.tip': 'Clique no canto superior esquerdo para logs',
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
      'terminal.help.nav': 'Nav',
      'terminal.help.danger': 'Parar',
      'terminal.help.action': 'Ação',
      'terminal.help.control': 'Controle',
      'terminal.help.history': 'Histórico de comandos',
      'terminal.help.scroll': 'Rolar (segurar para contínuo)',
      'terminal.help.cancel': 'Cancelar entrada',
      'terminal.help.interrupt': 'Interromper',
      'terminal.help.complete': 'Auto completar',
      'terminal.help.send': 'Enviar/Confirmar',
      'terminal.help.tip': 'Clique em ⋯ para mais',
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

      // Painel de depuração
      'debug.title': 'Log de depuração',
      'debug.copy': 'Copiar',
      'debug.copied': 'Copiado!',
      'debug.clear': 'Limpar',
      'debug.close': 'Fechar',
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
