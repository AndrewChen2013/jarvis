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

# Configuration
PORT=${JARVIS_PORT:-38010}

# Check if running as root (warn but don't block)
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

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project path
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OS=$(uname -s)

# Service identifiers
SERVICE_NAME="com.jarvis.backend"
PLIST_FILE="$HOME/Library/LaunchAgents/${SERVICE_NAME}.plist"
SYSTEMD_FILE="/etc/systemd/system/jarvis-backend.service"

# Print functions
print_header() {
    echo ""
    echo -e "${BLUE}===========================================${NC}"
    echo -e "${BLUE}  Jarvis Management Tool${NC}"
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

# Get service PID (returns empty if not running)
get_service_pid() {
    ps aux | grep "uvicorn app.main:app" | grep -v grep | awk '{print $2}' | head -1
}

# Check service status
check_status() {
    echo ""
    print_info "Service Status"
    echo ""

    # Check process
    PID=$(get_service_pid)
    if [ -n "$PID" ]; then
        print_success "Service running (PID: $PID)"
    else
        print_warning "Service not running"
    fi

    # Check autostart
    if [[ "$OS" == "Darwin" ]]; then
        if [ -f "$PLIST_FILE" ]; then
            print_success "Autostart: Enabled"
        else
            print_warning "Autostart: Disabled"
        fi
    elif [[ "$OS" == "Linux" ]]; then
        if systemctl is-enabled jarvis-backend &>/dev/null; then
            print_success "Autostart: Enabled"
        else
            print_warning "Autostart: Disabled"
        fi
    fi

    # Show access URL
    if [ -n "$PID" ]; then
        echo ""
        print_info "Access URL: http://localhost:$PORT"
    fi
}

# Install Claude Skills to user directory
install_skills() {
    print_info "Installing Claude Skills..."

    SKILLS_SRC="$PROJECT_ROOT/.claude/skills"
    SKILLS_DST="$HOME/.claude/skills"

    if [ ! -d "$SKILLS_SRC" ]; then
        print_warning "No skills to install"
        return
    fi

    mkdir -p "$SKILLS_DST"

    for skill_dir in "$SKILLS_SRC"/*/; do
        if [ -d "$skill_dir" ]; then
            skill_name=$(basename "$skill_dir")
            target_dir="$SKILLS_DST/$skill_name"

            # Create target directory
            mkdir -p "$target_dir"

            # Copy and replace paths
            for file in "$skill_dir"*; do
                if [ -f "$file" ]; then
                    filename=$(basename "$file")
                    # Replace os.getcwd() with actual project path
                    sed "s|sys.path.insert(0, os.getcwd())|sys.path.insert(0, '$PROJECT_ROOT')|g; \
                         s|working_dir=os.getcwd()|working_dir='$PROJECT_ROOT'|g; \
                         s|project_root = os.getcwd()|project_root = '$PROJECT_ROOT'|g" \
                        "$file" > "$target_dir/$filename"
                fi
            done

            print_success "  Skill: $skill_name"
        fi
    done
}

# Install dependencies
install_deps() {
    echo ""
    print_info "Installing dependencies..."
    echo ""

    # Check Python
    if ! command -v python3 &> /dev/null; then
        print_error "Python 3 not found, please install it first"
        exit 1
    fi
    print_success "Python: $(python3 --version)"

    # Check and install Claude Code
    if ! command -v claude &> /dev/null; then
        print_info "Installing Claude Code CLI..."
        curl -fsSL https://raw.githubusercontent.com/anthropics/claude-code/main/install.sh | sh

        if ! command -v claude &> /dev/null; then
            print_error "Claude Code installation failed"
            exit 1
        fi

        print_success "Claude Code: Installed"
        echo ""
        echo -e "${YELLOW}╔════════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${YELLOW}║  IMPORTANT: Claude Code Login Required                         ║${NC}"
        echo -e "${YELLOW}║                                                                ║${NC}"
        echo -e "${YELLOW}║  After installation completes, run:                            ║${NC}"
        echo -e "${YELLOW}║    claude                                                      ║${NC}"
        echo -e "${YELLOW}║                                                                ║${NC}"
        echo -e "${YELLOW}║  Then follow the prompts to log in with your Anthropic        ║${NC}"
        echo -e "${YELLOW}║  account to activate Claude Code.                             ║${NC}"
        echo -e "${YELLOW}╚════════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        read -p "Press Enter after you have logged in to Claude Code..."
    else
        print_success "Claude Code: Installed"
    fi

    # Check and install Ollama
    if ! command -v ollama &> /dev/null; then
        print_info "Installing Ollama..."
        if [[ "$OS" == "Darwin" ]]; then
            # macOS - use brew if available, otherwise curl
            if command -v brew &> /dev/null; then
                brew install ollama
            else
                curl -fsSL https://ollama.com/install.sh | sh
            fi
        else
            # Linux
            curl -fsSL https://ollama.com/install.sh | sh
        fi

        if ! command -v ollama &> /dev/null; then
            print_error "Ollama installation failed"
            print_warning "Experience Memory MCP will not work without Ollama"
        else
            print_success "Ollama: Installed"
        fi
    else
        print_success "Ollama: Installed"
    fi

    # Download embedding model if Ollama is available
    if command -v ollama &> /dev/null; then
        # Ensure Ollama service is running
        if ! pgrep -x "ollama" > /dev/null; then
            print_info "Starting Ollama service..."
            ollama serve &>/dev/null &
            sleep 2
        fi

        if ! ollama list 2>/dev/null | grep -q "qwen3-embedding"; then
            print_info "Downloading embedding model (qwen3-embedding:0.6b)..."
            echo "  This may take a few minutes depending on your network..."
            ollama pull qwen3-embedding:0.6b
            print_success "Embedding model downloaded"
        else
            print_success "Embedding model: qwen3-embedding ready"
        fi
    fi

    # Create virtual environment
    cd "$PROJECT_ROOT"
    if [ ! -d "venv" ]; then
        print_info "Creating virtual environment..."
        python3 -m venv venv
    fi

    # Install dependencies
    print_info "Installing Python dependencies..."
    source venv/bin/activate
    pip install -q -r requirements.txt
    print_success "Dependencies installed"

    # Configure environment variables
    if [ ! -f "$PROJECT_ROOT/.env" ]; then
        print_info "Generating config file..."
        cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"

        # Generate random token
        RANDOM_TOKEN=$(openssl rand -hex 32)
        if [[ "$OS" == "Darwin" ]]; then
            sed -i '' "s/your-secret-token-here/$RANDOM_TOKEN/" "$PROJECT_ROOT/.env"
        else
            sed -i "s/your-secret-token-here/$RANDOM_TOKEN/" "$PROJECT_ROOT/.env"
        fi

        print_success "Random AUTH_TOKEN generated"
        echo ""
        echo -e "${YELLOW}Please save this token for login:${NC}"
        echo -e "${GREEN}$RANDOM_TOKEN${NC}"
        echo ""
    else
        print_success "Config file already exists"
    fi

    # Create logs directory
    mkdir -p "$PROJECT_ROOT/logs"
    print_success "Logs directory created"

    # Install Claude Skills
    install_skills
}

# Start service
start_service() {
    echo ""

    PID=$(get_service_pid)
    if [ -n "$PID" ]; then
        print_warning "Service is already running (PID: $PID)"
        return
    fi

    print_info "Starting service..."
    cd "$PROJECT_ROOT"
    source venv/bin/activate

    # Register MCP Servers to ~/.claude.json
    print_info "Registering MCP Servers..."
    python scripts/register_mcp.py 2>/dev/null || true
    python scripts/register_experience_mcp.py 2>/dev/null || true

    # Start in background
    nohup venv/bin/uvicorn app.main:app --host 0.0.0.0 --port $PORT > logs/backend.log 2>&1 &

    sleep 2

    PID=$(get_service_pid)
    if [ -n "$PID" ]; then
        print_success "Service started (PID: $PID)"
        print_info "Access URL: http://localhost:$PORT"
        print_info "Log file: $PROJECT_ROOT/logs/backend.log"
    else
        print_error "Failed to start, check logs"
    fi
}

# Stop service
stop_service() {
    echo ""

    PID=$(get_service_pid)
    if [ -z "$PID" ]; then
        print_warning "Service is not running"
        return
    fi

    print_info "Stopping service (PID: $PID)..."
    kill "$PID" 2>/dev/null || true
    sleep 1

    PID=$(get_service_pid)
    if [ -z "$PID" ]; then
        print_success "Service stopped"
    else
        print_warning "Force terminating..."
        kill -9 "$PID" 2>/dev/null || true
        sleep 1
        print_success "Service force stopped"
    fi
}

# Restart service
restart_service() {
    stop_service
    start_service
}

# Enable autostart
enable_autostart() {
    echo ""
    print_info "Configuring autostart..."

    if [[ "$OS" == "Darwin" ]]; then
        # macOS LaunchAgent
        mkdir -p "$HOME/Library/LaunchAgents"

        # Generate plist file
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
        <string>${PORT}</string>
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

        # Load service
        launchctl unload "$PLIST_FILE" 2>/dev/null || true
        launchctl load "$PLIST_FILE"

        print_success "Autostart enabled (macOS LaunchAgent)"
        echo ""
        echo "  Manual control commands:"
        echo "    Start: launchctl start $SERVICE_NAME"
        echo "    Stop: launchctl stop $SERVICE_NAME"

    elif [[ "$OS" == "Linux" ]]; then
        # Linux systemd
        CURRENT_USER=$(whoami)

        sudo tee "$SYSTEMD_FILE" > /dev/null << EOF
[Unit]
Description=Jarvis Backend Service
After=network.target

[Service]
Type=simple
User=${CURRENT_USER}
Group=${CURRENT_USER}
WorkingDirectory=${PROJECT_ROOT}
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
EnvironmentFile=${PROJECT_ROOT}/.env
ExecStart=${PROJECT_ROOT}/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
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
        sudo systemctl enable jarvis-backend
        sudo systemctl start jarvis-backend

        print_success "Autostart enabled (systemd)"
        echo ""
        echo "  Manual control commands:"
        echo "    Start: sudo systemctl start jarvis-backend"
        echo "    Stop: sudo systemctl stop jarvis-backend"
        echo "    Status: sudo systemctl status jarvis-backend"
    fi
}

# Disable autostart
disable_autostart() {
    echo ""
    print_info "Disabling autostart..."

    if [[ "$OS" == "Darwin" ]]; then
        if [ -f "$PLIST_FILE" ]; then
            launchctl unload "$PLIST_FILE" 2>/dev/null || true
            rm -f "$PLIST_FILE"
            print_success "Autostart disabled"
        else
            print_warning "Autostart is not enabled"
        fi

    elif [[ "$OS" == "Linux" ]]; then
        if [ -f "$SYSTEMD_FILE" ]; then
            sudo systemctl stop jarvis-backend 2>/dev/null || true
            sudo systemctl disable jarvis-backend 2>/dev/null || true
            sudo rm -f "$SYSTEMD_FILE"
            sudo systemctl daemon-reload
            print_success "Autostart disabled"
        else
            print_warning "Autostart is not enabled"
        fi
    fi
}

# View logs
view_logs() {
    echo ""
    print_info "Recent logs (Ctrl+C to exit)"
    echo ""

    if [ -f "$PROJECT_ROOT/logs/backend.log" ]; then
        tail -f "$PROJECT_ROOT/logs/backend.log"
    else
        print_warning "Log file does not exist"
    fi
}

# ==================== Security Management ====================

# View security status
security_status() {
    cd "$PROJECT_ROOT"
    source venv/bin/activate 2>/dev/null || true
    python3 scripts/security.py list
}

# Unblock IP
security_unblock() {
    local ip="$1"
    if [ -z "$ip" ]; then
        read -p "Enter IP to unblock: " ip
        if [ -z "$ip" ]; then
            print_error "No IP provided"
            return
        fi
    fi
    cd "$PROJECT_ROOT"
    source venv/bin/activate 2>/dev/null || true
    python3 scripts/security.py unblock "$ip"
}

# Release emergency lock
security_unlock() {
    cd "$PROJECT_ROOT"
    source venv/bin/activate 2>/dev/null || true
    python3 scripts/security.py unlock
}

# Reset security state
security_reset() {
    cd "$PROJECT_ROOT"
    source venv/bin/activate 2>/dev/null || true
    python3 scripts/security.py reset
}

# Full installation
full_install() {
    print_header

    echo "Project directory: $PROJECT_ROOT"
    echo "Operating system: $OS"

    # 1. Install dependencies
    install_deps

    # 2. Ask whether to enable autostart
    echo ""
    read -p "Enable autostart on boot? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        enable_autostart
    else
        print_info "Skipping autostart configuration"
        echo ""
        # 3. Ask whether to start now
        read -p "Start service now? [Y/n] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            start_service
        fi
    fi

    echo ""
    echo -e "${GREEN}===========================================${NC}"
    echo -e "${GREEN}  Installation Complete!${NC}"
    echo -e "${GREEN}===========================================${NC}"
    echo ""
    echo "For future management, run: $0"
    echo ""
}

# Show menu
show_menu() {
    print_header
    check_status
    echo ""
    echo -e "${BLUE}-------------------------------------------${NC}"
    echo ""
    echo "  1) Start service"
    echo "  2) Stop service"
    echo "  3) Restart service"
    echo "  4) View logs"
    echo ""
    echo "  5) Enable autostart"
    echo "  6) Disable autostart"
    echo ""
    echo "  7) Reinstall dependencies"
    echo ""
    echo -e "${YELLOW}  --- Security ---${NC}"
    echo "  8) Security status"
    echo "  9) Unblock IP"
    echo "  10) Release emergency lock"
    echo "  11) Reset security state"
    echo ""
    echo "  0) Exit"
    echo ""
}

# Print usage
print_usage() {
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  start            Start the service"
    echo "  stop             Stop the service"
    echo "  restart          Restart the service"
    echo "  status           Show service status"
    echo "  logs             View logs (tail -f)"
    echo "  enable           Enable autostart on boot"
    echo "  disable          Disable autostart on boot"
    echo "  install          Install/reinstall dependencies"
    echo ""
    echo "Security:"
    echo "  security         Show security status (IP blacklist, lock state)"
    echo "  unblock <ip>     Unblock an IP address"
    echo "  unlock           Release emergency lockdown"
    echo "  sec-reset        Reset all security state"
    echo ""
    echo "Note: Login attempts are tracked in memory, not persisted."
    echo ""
    echo "If no command is provided, interactive menu will be shown."
    echo ""
}

# Main logic
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
            security|sec)
                security_status
                ;;
            unblock)
                security_unblock "$2"
                ;;
            unlock)
                security_unlock
                ;;
            sec-reset)
                security_reset
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

    # Check if first-time installation
    if [ ! -d "$PROJECT_ROOT/venv" ] || [ ! -f "$PROJECT_ROOT/.env" ]; then
        full_install
        exit 0
    fi

    # Show interactive menu
    while true; do
        show_menu
        read -p "Select option [0-11]: " choice

        case $choice in
            1) start_service ;;
            2) stop_service ;;
            3) restart_service ;;
            4) view_logs ;;
            5) enable_autostart ;;
            6) disable_autostart ;;
            7) install_deps ;;
            8) security_status ;;
            9) security_unblock ;;
            10) security_unlock ;;
            11) security_reset ;;
            0) echo ""; print_info "Goodbye!"; echo ""; exit 0 ;;
            *) print_error "Invalid option" ;;
        esac

        echo ""
        read -p "Press Enter to continue..."
    done
}

main "$@"
