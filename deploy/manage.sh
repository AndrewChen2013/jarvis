#!/bin/bash
# Copyright (c) 2025 BillChen
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

set -e

# 检查是否为 root 用户（警告但不阻止）
if [ "$EUID" -eq 0 ]; then
    echo ""
    echo -e "\033[1;33m╔════════════════════════════════════════════════════════════════╗\033[0m"
    echo -e "\033[1;33m║  WARNING: Running as root                                      ║\033[0m"
    echo -e "\033[1;33m║                                                                ║\033[0m"
    echo -e "\033[1;33m║  Claude Code cannot use --dangerously-skip-permissions with   ║\033[0m"
    echo -e "\033[1;33m║  root privileges. You will need to manually confirm each      ║\033[0m"
    echo -e "\033[1;33m║  tool permission request in the terminal.                     ║\033[0m"
    echo -e "\033[1;33m║                                                                ║\033[0m"
    echo -e "\033[1;33m║  For auto-approve mode, use a non-root user instead.          ║\033[0m"
    echo -e "\033[1;33m╚════════════════════════════════════════════════════════════════╝\033[0m"
    echo ""
fi

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 项目路径
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OS=$(uname -s)

# 服务标识
SERVICE_NAME="com.claude.remote.backend"
PLIST_FILE="$HOME/Library/LaunchAgents/${SERVICE_NAME}.plist"
SYSTEMD_FILE="/etc/systemd/system/claude-remote-backend.service"

# 打印函数
print_header() {
    echo ""
    echo -e "${BLUE}===========================================${NC}"
    echo -e "${BLUE}  Claude Remote 管理工具${NC}"
    echo -e "${BLUE}===========================================${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}! $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${BLUE}→ $1${NC}"
}

# 检查服务状态
check_status() {
    echo ""
    print_info "服务状态"
    echo ""

    # 检查进程
    if pgrep -f "uvicorn app.main:app" > /dev/null; then
        PID=$(pgrep -f "uvicorn app.main:app" | head -1)
        print_success "服务运行中 (PID: $PID)"
    else
        print_warning "服务未运行"
    fi

    # 检查开机自启动
    if [[ "$OS" == "Darwin" ]]; then
        if [ -f "$PLIST_FILE" ]; then
            print_success "开机自启动: 已启用"
        else
            print_warning "开机自启动: 未启用"
        fi
    elif [[ "$OS" == "Linux" ]]; then
        if systemctl is-enabled claude-remote-backend &>/dev/null; then
            print_success "开机自启动: 已启用"
        else
            print_warning "开机自启动: 未启用"
        fi
    fi

    # 显示访问地址
    if pgrep -f "uvicorn app.main:app" > /dev/null; then
        echo ""
        print_info "访问地址: http://localhost:8000"
    fi
}

# 安装依赖
install_deps() {
    echo ""
    print_info "安装依赖..."
    echo ""

    # 检查 Python
    if ! command -v python3 &> /dev/null; then
        print_error "未找到 Python 3，请先安装"
        exit 1
    fi
    print_success "Python: $(python3 --version)"

    # 检查 Claude Code
    if ! command -v claude &> /dev/null; then
        print_warning "未找到 Claude Code CLI"
        echo "  请安装: curl -fsSL https://raw.githubusercontent.com/anthropics/claude-code/main/install.sh | sh"
        read -p "是否继续安装？[y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        print_success "Claude Code: 已安装"
    fi

    # 创建虚拟环境
    cd "$PROJECT_ROOT"
    if [ ! -d "venv" ]; then
        print_info "创建虚拟环境..."
        python3 -m venv venv
    fi

    # 安装依赖
    print_info "安装 Python 依赖..."
    source venv/bin/activate
    pip install -q -r requirements.txt
    print_success "依赖安装完成"

    # 配置环境变量
    if [ ! -f "$PROJECT_ROOT/.env" ]; then
        print_info "生成配置文件..."
        cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"

        # 生成随机 token
        RANDOM_TOKEN=$(openssl rand -hex 32)
        if [[ "$OS" == "Darwin" ]]; then
            sed -i '' "s/your-secret-token-here/$RANDOM_TOKEN/" "$PROJECT_ROOT/.env"
        else
            sed -i "s/your-secret-token-here/$RANDOM_TOKEN/" "$PROJECT_ROOT/.env"
        fi

        print_success "已生成随机 AUTH_TOKEN"
        echo ""
        echo -e "${YELLOW}请保存此 token，用于登录:${NC}"
        echo -e "${GREEN}$RANDOM_TOKEN${NC}"
        echo ""
    else
        print_success "配置文件已存在"
    fi

    # 创建日志目录
    mkdir -p "$PROJECT_ROOT/logs"
    print_success "日志目录已创建"
}

# 启动服务
start_service() {
    echo ""

    if pgrep -f "uvicorn app.main:app" > /dev/null; then
        print_warning "服务已在运行中"
        return
    fi

    print_info "启动服务..."
    cd "$PROJECT_ROOT"
    source venv/bin/activate

    # 后台启动
    nohup venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 > logs/backend.log 2>&1 &

    sleep 2

    if pgrep -f "uvicorn app.main:app" > /dev/null; then
        print_success "服务已启动"
        print_info "访问地址: http://localhost:8000"
        print_info "日志文件: $PROJECT_ROOT/logs/backend.log"
    else
        print_error "启动失败，请查看日志"
    fi
}

# 停止服务
stop_service() {
    echo ""

    if ! pgrep -f "uvicorn app.main:app" > /dev/null; then
        print_warning "服务未在运行"
        return
    fi

    print_info "停止服务..."
    pkill -f "uvicorn app.main:app" || true
    sleep 1

    if ! pgrep -f "uvicorn app.main:app" > /dev/null; then
        print_success "服务已停止"
    else
        print_warning "强制终止..."
        pkill -9 -f "uvicorn app.main:app" || true
        print_success "服务已强制停止"
    fi
}

# 重启服务
restart_service() {
    stop_service
    start_service
}

# 启用开机自启动
enable_autostart() {
    echo ""
    print_info "配置开机自启动..."

    if [[ "$OS" == "Darwin" ]]; then
        # macOS LaunchAgent
        mkdir -p "$HOME/Library/LaunchAgents"

        # 生成 plist 文件
        cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_NAME}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${PROJECT_ROOT}/venv/bin/uvicorn</string>
        <string>app.main:app</string>
        <string>--host</string>
        <string>0.0.0.0</string>
        <string>--port</string>
        <string>8000</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${PROJECT_ROOT}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
        <key>PYTHONUNBUFFERED</key>
        <string>1</string>
    </dict>

    <key>StandardOutPath</key>
    <string>${PROJECT_ROOT}/logs/backend.log</string>

    <key>StandardErrorPath</key>
    <string>${PROJECT_ROOT}/logs/backend.error.log</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>ProcessType</key>
    <string>Interactive</string>
</dict>
</plist>
EOF

        # 加载服务
        launchctl unload "$PLIST_FILE" 2>/dev/null || true
        launchctl load "$PLIST_FILE"

        print_success "开机自启动已启用 (macOS LaunchAgent)"
        echo ""
        echo "  手动控制命令:"
        echo "    启动: launchctl start $SERVICE_NAME"
        echo "    停止: launchctl stop $SERVICE_NAME"

    elif [[ "$OS" == "Linux" ]]; then
        # Linux systemd
        CURRENT_USER=$(whoami)

        sudo tee "$SYSTEMD_FILE" > /dev/null << EOF
[Unit]
Description=Claude Remote Backend Service
After=network.target

[Service]
Type=simple
User=${CURRENT_USER}
Group=${CURRENT_USER}
WorkingDirectory=${PROJECT_ROOT}
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
EnvironmentFile=${PROJECT_ROOT}/.env
ExecStart=${PROJECT_ROOT}/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

NoNewPrivileges=true
PrivateTmp=true
LimitNOFILE=65536
LimitNPROC=4096

[Install]
WantedBy=multi-user.target
EOF

        sudo systemctl daemon-reload
        sudo systemctl enable claude-remote-backend
        sudo systemctl start claude-remote-backend

        print_success "开机自启动已启用 (systemd)"
        echo ""
        echo "  手动控制命令:"
        echo "    启动: sudo systemctl start claude-remote-backend"
        echo "    停止: sudo systemctl stop claude-remote-backend"
        echo "    状态: sudo systemctl status claude-remote-backend"
    fi
}

# 禁用开机自启动
disable_autostart() {
    echo ""
    print_info "禁用开机自启动..."

    if [[ "$OS" == "Darwin" ]]; then
        if [ -f "$PLIST_FILE" ]; then
            launchctl unload "$PLIST_FILE" 2>/dev/null || true
            rm -f "$PLIST_FILE"
            print_success "开机自启动已禁用"
        else
            print_warning "开机自启动未启用"
        fi

    elif [[ "$OS" == "Linux" ]]; then
        if [ -f "$SYSTEMD_FILE" ]; then
            sudo systemctl stop claude-remote-backend 2>/dev/null || true
            sudo systemctl disable claude-remote-backend 2>/dev/null || true
            sudo rm -f "$SYSTEMD_FILE"
            sudo systemctl daemon-reload
            print_success "开机自启动已禁用"
        else
            print_warning "开机自启动未启用"
        fi
    fi
}

# 查看日志
view_logs() {
    echo ""
    print_info "最近日志 (Ctrl+C 退出)"
    echo ""

    if [ -f "$PROJECT_ROOT/logs/backend.log" ]; then
        tail -f "$PROJECT_ROOT/logs/backend.log"
    else
        print_warning "日志文件不存在"
    fi
}

# 完整安装
full_install() {
    print_header

    echo "项目目录: $PROJECT_ROOT"
    echo "操作系统: $OS"

    # 1. 安装依赖
    install_deps

    # 2. 询问是否启用开机自启动
    echo ""
    read -p "是否启用开机自启动？[y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        enable_autostart
    else
        print_info "跳过开机自启动配置"
        echo ""
        # 3. 询问是否立即启动
        read -p "是否立即启动服务？[Y/n] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            start_service
        fi
    fi

    echo ""
    echo -e "${GREEN}===========================================${NC}"
    echo -e "${GREEN}  安装完成！${NC}"
    echo -e "${GREEN}===========================================${NC}"
    echo ""
    echo "后续管理请运行: $0"
    echo ""
}

# 显示菜单
show_menu() {
    print_header
    check_status
    echo ""
    echo -e "${BLUE}-------------------------------------------${NC}"
    echo ""
    echo "  1) 启动服务"
    echo "  2) 停止服务"
    echo "  3) 重启服务"
    echo "  4) 查看日志"
    echo ""
    echo "  5) 启用开机自启动"
    echo "  6) 禁用开机自启动"
    echo ""
    echo "  7) 重新安装依赖"
    echo ""
    echo "  0) 退出"
    echo ""
}

# Print usage
print_usage() {
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  start       Start the service"
    echo "  stop        Stop the service"
    echo "  restart     Restart the service"
    echo "  status      Show service status"
    echo "  logs        View logs (tail -f)"
    echo "  enable      Enable autostart on boot"
    echo "  disable     Disable autostart on boot"
    echo "  install     Install/reinstall dependencies"
    echo ""
    echo "If no command is provided, interactive menu will be shown."
    echo ""
}

# 主逻辑
main() {
    # Handle command line arguments
    if [ $# -gt 0 ]; then
        case "$1" in
            start)
                start_service
                ;;
            stop)
                stop_service
                ;;
            restart)
                restart_service
                ;;
            status)
                check_status
                ;;
            logs)
                view_logs
                ;;
            enable)
                enable_autostart
                ;;
            disable)
                disable_autostart
                ;;
            install)
                install_deps
                ;;
            -h|--help|help)
                print_usage
                ;;
            *)
                print_error "Unknown command: $1"
                print_usage
                exit 1
                ;;
        esac
        exit 0
    fi

    # 检查是否首次安装
    if [ ! -d "$PROJECT_ROOT/venv" ] || [ ! -f "$PROJECT_ROOT/.env" ]; then
        full_install
        exit 0
    fi

    # 显示交互菜单
    while true; do
        show_menu
        read -p "请选择操作 [0-7]: " choice

        case $choice in
            1) start_service ;;
            2) stop_service ;;
            3) restart_service ;;
            4) view_logs ;;
            5) enable_autostart ;;
            6) disable_autostart ;;
            7) install_deps ;;
            0) echo ""; print_info "再见！"; echo ""; exit 0 ;;
            *) print_error "无效选项" ;;
        esac

        echo ""
        read -p "按回车键继续..."
    done
}

main "$@"
