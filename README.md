# Claude Remote - 移动端远程控制 Claude Code

通过 WebSocket 在手机上远程控制 PC 端的 Claude Code。

## 功能特性

- **实时终端转发**: 完整的 xterm.js 终端体验，支持颜色、Unicode 等
- **会话管理**: 支持多会话，自动休眠闲置会话
- **移动优化**: PWA 支持，响应式设计，针对触屏优化
- **安全认证**: Token 认证机制
- **自动重连**: WebSocket 断线自动重连
- **资源监控**: CPU、内存使用监控

## 技术栈

### 后端
- FastAPI - 高性能异步 Web 框架
- WebSocket + msgpack - 实时通信
- Redis/SQLite - 会话持久化
- pty - 伪终端管理
- psutil - 进程资源监控

### 前端 (Backend Static)
- Vanilla JavaScript - 原生 JS 实现
- xterm.js - 专业终端模拟器
- CSS3 - 响应式设计

## 快速开始

### 方式一：自动安装（推荐）

```bash
cd /Users/bill/claude-remote
chmod +x deploy/install.sh
./deploy/install.sh
```

安装脚本会自动完成：
- 检查依赖（Python、Redis、Claude Code）
- 安装后端依赖
- 生成随机 AUTH_TOKEN
- 配置自动启动服务

### 方式二：手动安装

#### 1. 安装依赖

```bash
# macOS
brew install python redis

# Ubuntu/Debian
sudo apt install python3 python3-venv redis-server

# 安装 Claude Code
curl -fsSL https://raw.githubusercontent.com/anthropics/claude-code/main/install.sh | sh
```

#### 2. 后端设置

```bash
cd backend

# 创建虚拟环境
python3 -m venv venv
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env，设置 AUTH_TOKEN

# 启动 Redis
redis-server

# 启动后端
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

后端启动后会打印 AUTH_TOKEN，用于前端登录。
访问 http://localhost:8000


## 配置说明

### 后端配置 (backend/.env)

```bash
# 认证 Token（必须修改）
AUTH_TOKEN=your-secret-token-here

# Redis 配置
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0

# 会话管理
MAX_ACTIVE_SESSIONS=10          # 最大活跃会话数
SESSION_IDLE_TIMEOUT=7200       # 会话闲置超时（秒）

# 进程限制
MAX_PROCESS_MEMORY_MB=2048      # 单个进程最大内存
MAX_PROCESS_CPU_PERCENT=80.0    # 单个进程最大 CPU 占用
```

### Cloudflare Tunnel 配置

如果需要外网访问，推荐使用 Cloudflare Tunnel：

```bash
# 1. 创建隧道（如果还没有）
cloudflared tunnel create claude-remote

# 2. 配置隧道
# 编辑 ~/.cloudflared/config.yml:
tunnel: <tunnel-id>
credentials-file: /Users/bill/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: your-domain.com
    service: http://localhost:8000
  - service: http_status:404

# 3. 设置 DNS
cloudflared tunnel route dns claude-remote your-domain.com

# 4. 运行隧道
cloudflared tunnel run claude-remote

# 5. 配置自动启动（macOS）
cp deploy/launchd/com.cloudflare.tunnel.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.cloudflare.tunnel.plist
```

## 使用方法

1. **登录**: 在手机浏览器打开地址，输入 AUTH_TOKEN
2. **创建会话**: 点击"新建会话"按钮
3. **使用终端**: 像使用本地终端一样操作 Claude Code
4. **会话管理**:
   - 返回列表查看所有会话
   - 删除不需要的会话
   - 超过 2 小时未使用的会话会自动休眠

## 服务管理

### macOS (LaunchAgent)

```bash
# 启动
launchctl start com.claude.remote.backend

# 停止
launchctl stop com.claude.remote.backend

# 查看状态
launchctl list | grep claude.remote

# 查看日志
tail -f ~/claude-remote/logs/backend.log
tail -f ~/claude-remote/logs/backend.error.log
```

### Linux (systemd)

```bash
# 启动
sudo systemctl start claude-remote-backend

# 停止
sudo systemctl stop claude-remote-backend

# 重启
sudo systemctl restart claude-remote-backend

# 查看状态
sudo systemctl status claude-remote-backend

# 查看日志
sudo journalctl -u claude-remote-backend -f

# 开机自启
sudo systemctl enable claude-remote-backend
```


## API 文档

启动后端后访问：
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

### REST API

```bash
# 获取所有会话
GET /api/sessions

# 创建会话
POST /api/sessions
Content-Type: application/json
{
  "name": "My Session",
  "cwd": "/Users/bill"
}

# 获取会话详情
GET /api/sessions/{session_id}

# 删除会话
DELETE /api/sessions/{session_id}
```

### WebSocket

```
连接: ws://localhost:8000/ws/{session_id}?token={auth_token}

消息格式（msgpack 编码）:

客户端 -> 服务器:
{
  "type": "input",
  "data": "ls\n"
}
{
  "type": "resize",
  "cols": 80,
  "rows": 24
}
{
  "type": "ping"
}

服务器 -> 客户端:
{
  "type": "output",
  "data": "file1.txt\nfile2.txt\n"
}
{
  "type": "error",
  "message": "错误信息"
}
{
  "type": "stats",
  "cpu": 12.5,
  "memory": 256.0
}
```

## 故障排查

### 后端无法启动

1. 检查 Redis 是否运行: `redis-cli ping`
2. 检查端口 8000 是否被占用: `lsof -i :8000`
3. 检查 .env 配置是否正确
4. 查看日志: `~/claude-remote/logs/backend.error.log`

### WebSocket 连接失败

1. 确认后端已启动
2. 检查 AUTH_TOKEN 是否正确
3. 查看浏览器控制台错误信息
4. 检查防火墙设置

### 会话无法创建

1. 确认 Claude Code 已安装: `which claude`
2. 检查资源限制配置
3. 查看后端日志

### 终端显示乱码

1. 确认终端编码为 UTF-8
2. 检查 xterm.js 配置
3. 更新 xterm.js 版本

## 开发

### 项目结构

```
claude-remote/
├── backend/              # 后端代码
│   ├── app/
│   │   ├── api/         # API 路由
│   │   ├── core/        # 核心配置
│   │   ├── db/          # 数据库
│   │   ├── models/      # 数据模型
│   │   └── services/    # 业务逻辑
│   ├── static/          # 静态前端资源 (JS/CSS/HTML)
│   ├── requirements.txt
│   └── .env
├── deploy/              # 部署配置
│   ├── launchd/        # macOS 服务
│   ├── systemd/        # Linux 服务
│   └── install.sh      # 安装脚本
└── docker-compose.yml   # Docker 编排
```

### 本地开发

```bash
# 后端热重载
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## 安全建议

1. **修改 AUTH_TOKEN**: 使用强随机字符串
2. **HTTPS**: 生产环境使用 HTTPS（Cloudflare Tunnel 自动提供）
3. **防火墙**: 限制后端端口仅本地访问
4. **定期更新**: 及时更新依赖包
5. **访问控制**: 仅授权设备访问

## 许可证

MIT License

## 作者

Bill Chen

## 支持

如有问题，请查看：
1. 项目文档
2. 后端日志
3. 浏览器控制台
