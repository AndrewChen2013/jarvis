#!/bin/bash

set -e

echo "=========================================="
echo "Claude Remote 安装脚本"
echo "=========================================="

# 检测操作系统
OS=$(uname -s)
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "项目目录: $PROJECT_ROOT"
echo "操作系统: $OS"
echo ""

# 1. 检查依赖
echo "1. 检查依赖..."

# 检查 Python
if ! command -v python3 &> /dev/null; then
    echo "错误: 未找到 Python 3"
    exit 1
fi
echo "✓ Python: $(python3 --version)"

# 检查 Redis
if ! command -v redis-server &> /dev/null; then
    echo "警告: 未找到 Redis"
    echo "请安装 Redis:"
    if [[ "$OS" == "Darwin" ]]; then
        echo "  brew install redis"
    elif [[ "$OS" == "Linux" ]]; then
        echo "  apt-get install redis-server  # Ubuntu/Debian"
        echo "  yum install redis              # CentOS/RHEL"
    fi
    exit 1
fi
echo "✓ Redis: $(redis-server --version | head -n1)"

# 检查 Claude Code
if ! command -v claude &> /dev/null; then
    echo "警告: 未找到 Claude Code CLI"
    echo "请安装: curl -fsSL https://raw.githubusercontent.com/anthropics/claude-code/main/install.sh | sh"
    exit 1
fi
echo "✓ Claude Code: 已安装"
echo ""

# 2. 安装后端依赖
echo "2. 安装后端依赖..."
cd "$PROJECT_ROOT"

if [ ! -d "venv" ]; then
    python3 -m venv venv
fi

source venv/bin/activate
pip install -r requirements.txt
echo "✓ 后端依赖安装完成"
echo ""

# 4. 配置环境变量
echo "4. 配置环境变量..."
cd "$PROJECT_ROOT"

if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "已创建 .env 文件，请编辑并设置 AUTH_TOKEN"

    # 生成随机 token
    RANDOM_TOKEN=$(openssl rand -hex 32)
    sed -i.bak "s/your-secret-token-here/$RANDOM_TOKEN/" .env
    rm .env.bak

    echo "✓ 已生成随机 AUTH_TOKEN: $RANDOM_TOKEN"
    echo "  请保存此 token，用于前端登录"
fi
echo ""

# 5. 创建日志目录
echo "5. 创建日志目录..."
mkdir -p "$PROJECT_ROOT/logs"
echo "✓ 日志目录创建完成"
echo ""

# 6. 启动 Redis
echo "6. 启动 Redis..."
if [[ "$OS" == "Darwin" ]]; then
    brew services start redis
elif [[ "$OS" == "Linux" ]]; then
    sudo systemctl start redis
fi
echo "✓ Redis 已启动"
echo ""

# 7. 配置自动启动
echo "7. 配置自动启动..."
if [[ "$OS" == "Darwin" ]]; then
    # macOS 使用 LaunchAgent
    PLIST_SRC="$PROJECT_ROOT/deploy/launchd/com.claude.remote.backend.plist"
    PLIST_DST="$HOME/Library/LaunchAgents/com.claude.remote.backend.plist"

    # 创建目录
    mkdir -p "$HOME/Library/LaunchAgents"

    # 复制并更新路径
    sed "s|/Users/bill|$HOME|g" "$PLIST_SRC" > "$PLIST_DST"

    # 加载服务
    launchctl unload "$PLIST_DST" 2>/dev/null || true
    launchctl load "$PLIST_DST"

    echo "✓ LaunchAgent 已配置"
    echo "  启动: launchctl start com.claude.remote.backend"
    echo "  停止: launchctl stop com.claude.remote.backend"
    echo "  查看: launchctl list | grep claude.remote"

elif [[ "$OS" == "Linux" ]]; then
    # Linux 使用 systemd
    SERVICE_SRC="$PROJECT_ROOT/deploy/systemd/claude-remote-backend.service"
    SERVICE_DST="/etc/systemd/system/claude-remote-backend.service"

    # 更新用户名
    CURRENT_USER=$(whoami)
    sudo sed "s/User=bill/User=$CURRENT_USER/" "$SERVICE_SRC" > "$SERVICE_DST"
    sudo sed -i "s|/Users/bill|$HOME|g" "$SERVICE_DST"

    # 重载 systemd
    sudo systemctl daemon-reload
    sudo systemctl enable claude-remote-backend
    sudo systemctl start claude-remote-backend

    echo "✓ systemd 服务已配置"
    echo "  启动: sudo systemctl start claude-remote-backend"
    echo "  停止: sudo systemctl stop claude-remote-backend"
    echo "  状态: sudo systemctl status claude-remote-backend"
    echo "  日志: sudo journalctl -u claude-remote-backend -f"
fi
echo ""

echo "=========================================="
echo "安装完成！"
echo "=========================================="
echo ""
echo "下一步:"
echo "1. 检查配置文件: $PROJECT_ROOT/backend/.env"
echo "3. 访问地址: http://localhost:8000"
echo ""
echo "Cloudflare Tunnel 配置:"
echo "  cloudflared tunnel route dns claude-remote your-domain.com"
echo "  cloudflared tunnel run claude-remote"
echo ""
