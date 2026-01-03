# Claude Remote

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Python](https://img.shields.io/badge/Python-3.10+-green.svg)](https://www.python.org/)

**English** | [中文](README_CN.md)

> Control your computer with natural language, from anywhere.

<p align="center">
  <img src="screenshots/demo.gif" width="300" alt="Demo">
</p>

---

## Liberation

```
In the feudal age, peasants were bound to the land.
In the industrial age, workers were bound to the assembly line.
In the information age, programmers are bound to their desks.

In the AI age, it's time for liberation.
```

**Liberate Space** — No longer chained to your workstation
**Liberate Time** — Even 5-minute fragments become productive
**Liberate Hands** — Voice input, speak instead of type
**Liberate Mind** — Focus on creativity, let AI handle execution

---

## Philosophy

### Natural Language Controls Everything

**The old way:**
```
You → Learn commands → Computer
      (ssh, git, grep, find, curl, docker...)
      (Hard to remember, easy to mess up)
```

**The new way:**
```
You → Natural language → Claude → Computer
      ("Check if there are any 500 errors in yesterday's logs")
      (Claude knows the commands)
```

Claude becomes the **translation layer** between you and your computer:
- You speak human language, Claude translates to machine commands
- No need to memorize syntax
- No need to worry about typos
- As long as Claude understands your intent, it works

**What can Claude do?**
- Write code, fix bugs, run tests
- Search files, check logs, read configs
- Make HTTP requests, call APIs, run scripts
- Manage git, handle processes, deploy services
- **Everything the command line can do**

**What do you need to do?**
- Just express your intent
- "Help me check if nginx has any 500 errors recently"
- "Package this project and deploy to staging"
- "Count how many records are in the users table"

**Don't worry about getting commands right — just make sure Claude understands you.**

### Save Your Time for Thinking

Claude handles the execution — the commands, the syntax, the tedious details. You focus on what matters: ideas, architecture, creativity.

In the AI age, **imagination is your greatest asset**. Don't waste it on memorizing flags and options. Let Claude be your translator, and keep your mind free for what only humans can do: **dream, create, and innovate**.

---

## Vibe Coding

A new way of programming:

- **Think** → **Speak** → **Walk away** → **Come back to results**
- Your job: ideas, decisions, creativity
- Claude's job: execution, translation, implementation

### Fragment Time Programming

Traditional programming requires large time blocks — at least 1-2 hours to "get in the zone."

With Claude Remote:
- **5 minutes** is enough to make progress
- Waiting for elevator? Check the progress
- Waiting for food delivery? Give feedback
- On the subway? Send a new instruction
- **No "getting in the zone" needed** — Claude maintains the context

Fragment time adds up to **real productivity**.

### Multi-Session Parallel

Claude spends 70% of the time outputting. Waiting is waste.

<img src="screenshots/multi-session.jpg" width="300" alt="Multi-Session">

Run 3-4 tasks simultaneously:
- Session A is generating → Switch to Session B, give instructions
- Session B is thinking → Switch to Session C, review output
- Session C done → Back to Session A, continue

**One person, 3-4x efficiency.**

### Voice-Driven

Your phone's keyboard has voice input built-in.

- Speak instead of type
- Eyes closed, lying down, still coding
- "Add form validation to the login page" → Send → Done

**Truly hands-free.**

### Built with Itself

This project was developed using Claude Remote. After the core features were complete, all subsequent development was done via voice input on a phone — during commutes, while walking, in bed.

**Everything you see here was created by Claude Code:**
- 📝 This README — written and translated
- 🎬 The demo GIF — frames extracted from screen recording, composed automatically
- 🖼️ All screenshots — extracted, cropped, and sensitive info masked
- 🌍 9 language translations — i18n files with 200+ entries each

Proof that vibe coding works.

---

## Quick Start

### Prerequisites

- macOS or Linux
- Python 3.10+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

### Installation

```bash
# Clone the repository
git clone https://github.com/AndrewChen2013/claude-remote.git
cd claude-remote

# Run management script
chmod +x deploy/manage.sh
./deploy/manage.sh
```

**First Run:** The script will automatically:
- Create Python virtual environment
- Install dependencies
- Generate a random AUTH_TOKEN
- Start the service

**Subsequent Runs:** Shows an interactive menu:

```
  1) Start service
  2) Stop service
  3) Restart service
  4) View logs

  5) Enable auto-start on boot
  6) Disable auto-start on boot

  7) Reinstall dependencies

  0) Exit
```

**Features:**
- Service management (start/stop/restart)
- Real-time log viewing
- Auto-start on boot (macOS LaunchAgent / Linux systemd)
- Dependency installation and updates

### Access

**Local Network:**
```
http://<your-computer-ip>:8000
```

**Remote Access (Optional):**

If you need access from outside your local network, [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) is one simple option:

```bash
# Install cloudflared
brew install cloudflared

# Create tunnel
cloudflared tunnel create claude-remote

# Configure tunnel (edit ~/.cloudflared/config.yml)
tunnel: <tunnel-id>
credentials-file: ~/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: claude.yourdomain.com
    service: http://localhost:8000
  - service: http_status:404

# Start tunnel
cloudflared tunnel run claude-remote
```

Now access from anywhere: `https://claude.yourdomain.com`

> ⚠️ **Security Warning**
> - Exposing services to the internet carries inherent risks
> - If you're on a corporate network, **consult your network administrator** before setting up any tunnel
> - Consider your organization's security policies and compliance requirements
> - Use strong AUTH_TOKEN and rotate it periodically

---

## Usage

### Login

Enter your AUTH_TOKEN (shown during installation or in `.env` file).

### Project Management

<img src="screenshots/projects.png" width="300" alt="Projects">

Organize your work by project:

- **Project cards**: See all projects with session counts
- **Active indicator**: Green dot shows projects with active sessions
- **Quick access**: Tap a project to see its sessions

### Session Management

<img src="screenshots/sessions.png" width="300" alt="Sessions">

- **Create new session**: Tap `+`, select working directory
- **Resume existing session**: Browse your Claude history and continue
- **Multiple sessions**: Switch between sessions with the floating button
- **Pin sessions**: Long press to pin important sessions to the top
- **Token tracking**: See total tokens used and context window usage for each session

### Terminal

<img src="screenshots/terminal.jpg" width="300" alt="Terminal">

Full terminal experience on mobile:
- **Virtual keys**: Tab, ↑↓, ESC, Backspace, and more
- **Combo keys**: ^L (clear), ^O (verbose), ^B (background), ESC×2 (rollback), ⇧Tab (mode)
- **Slash commands**: /resume, /clear, /help, /compact, /memory
- **Touch scroll**: Smooth scrolling with momentum
- **Font size**: A+/A- buttons, each session remembers its own size

### Voice Input

<img src="screenshots/voice-input.jpg" width="300" alt="Voice Input">

1. Tap the input field
2. Tap the microphone icon on your keyboard
3. Speak your instruction
4. Send

### Scheduled Tasks

<img src="screenshots/scheduled-tasks.png" width="300" alt="Scheduled Tasks">

Automate recurring tasks with cron-based scheduling:

- **Create tasks**: Define prompts that run on a schedule (hourly, daily, weekly)
- **Feishu notifications**: Get task results sent to Feishu/Lark automatically
- **MCP integration**: Use the `claude-remote-tasks` MCP server to manage tasks from Claude Code
- **Execution history**: View past runs and their outputs
- **Manual trigger**: Run any task immediately with one tap

Example use cases:
- Monitor news and send daily summaries
- Check emails and filter important ones
- Track social media updates
- Run periodic system health checks

### System Monitor

<img src="screenshots/monitor.png" width="300" alt="System Monitor">

Real-time system monitoring:

- **CPU & Memory**: Live usage with visual gauges
- **Top Processes**: Sort by CPU or memory, configurable count
- **Claude Remote processes**: See all related processes
- **Disk Usage**: Monitor all mounted volumes

### SSH Remote Machines

<img src="screenshots/remote-machines.png" width="300" alt="Remote Machines">

Connect to remote servers via SSH:

- **Add machines**: Configure SSH host, port, username, and key
- **Quick connect**: One-tap to open SSH terminal
- **Manage connections**: Edit or delete saved machines

---

## Use Cases

| Scenario | Example |
|----------|---------|
| **Continue coding** | "Add error handling to the upload function" |
| **Check progress** | "Show me what you've done so far" |
| **System admin** | "Check if the server has enough disk space" |
| **File operations** | "Find all TODO comments in the project" |
| **Git operations** | "Create a branch for this feature and commit" |
| **Quick queries** | "What's the structure of the config file?" |
| **Scheduled monitoring** | Set up hourly news monitoring with Feishu alerts |
| **Remote server** | SSH into your server and run commands |
| **File transfer** | Upload config files from your phone |

---

## Features

### 📱 Mobile-Optimized Experience

- **Touch Scroll** — Smooth momentum scrolling, feels like a native app
- **Virtual Keyboard** — Terminal shortcuts without switching input methods
- **Font Scaling** — A+/A- buttons, each session remembers its size
- **Pull to Refresh** — Light pull refreshes data, heavy pull reloads page
- **Keyboard Adaptation** — Toolbar stays visible when soft keyboard opens

### 🔀 Multi-Session Management

- **Background Sessions** — Switch sessions without disconnecting, Claude keeps running
- **Floating Switch Button** — Quick jump between active sessions
- **Minimize to Background** — Leave temporarily, resume anytime
- **Rename Sessions** — Give sessions memorable names
- **Delete Sessions** — Clean up old history

### ⌨️ Shortcuts

**Common Keys**

| Key | Function |
|-----|----------|
| TAB | Auto-complete |
| ↑ ↓ | Command history |
| ESC | Stop current operation |
| ⤒ ⤓ | Scroll to top/bottom (hold for continuous) |

**Combo Keys**

| Key | Function |
|-----|----------|
| ^L | Clear screen |
| ^O | Verbose output |
| ^B | Background task |
| ESC×2 | Rollback last action |
| ⇧Tab | Switch mode |

**Slash Commands**

| Command | Function |
|---------|----------|
| /resume | Resume session |
| /clear | Clear conversation |
| /compact | Compact context |
| /memory | View memory |
| /help | Help info |

### 📊 Usage Monitoring

<img src="screenshots/context-info.jpg" width="300" alt="Context Info">

- **Real-time Usage** — View 5-hour and 7-day cycle utilization
- **Sonnet Quota** — Separate display for Sonnet model usage
- **Context Info** — Token consumption, remaining space, distance to compact
- **Account Info** — Shows plan type and connection status

### 🌐 Multi-Language Support

- 9 languages: Chinese, English, Japanese, Korean, French, German, Spanish, Russian, Portuguese
- Switch anytime, settings auto-saved

### ⏰ Scheduled Tasks & MCP Server

- **Cron-based scheduling** — Run tasks hourly, daily, weekly, or custom schedules
- **Feishu/Lark notifications** — Automatically send task results to your chat
- **MCP integration** — Manage tasks from Claude Code with the built-in MCP server
- **Execution history** — View past runs, outputs, and status
- **Session linking** — Each task can create a dedicated Claude Code session

### 📊 System Monitor

- **Live CPU & Memory** — Real-time usage with visual gauges
- **Process List** — Top processes sorted by CPU or memory
- **Disk Usage** — Monitor all mounted volumes
- **Claude Remote Stats** — See all related processes and their resource usage

### 🖥️ SSH Remote Machines

- **Saved connections** — Store SSH host, port, username, and key path
- **Quick connect** — One-tap to open terminal session
- **Integrated terminal** — Full xterm.js terminal experience

### 📁 File Management

- **File browser** — Navigate your filesystem
- **File upload** — Upload files from mobile to any directory
- **Upload history** — Track recent uploads with quick copy path
- **File download** — Download files directly to your device

### 🔐 Secure Access

- **Token Auth** — Random access token generated on first run
- **Change Password** — Update access token anytime
- **Remote Access** — Cloudflare Tunnel for secure exposure

---

## Configuration

Edit `.env` file:

```bash
# Authentication (required)
AUTH_TOKEN=your-secret-token
```

> The AUTH_TOKEN is auto-generated on first run. You can change it anytime in Settings.

### MCP Server for Scheduled Tasks

To enable Claude Code to manage scheduled tasks, add the MCP server to your Claude Code configuration:

**Location:** `~/.claude/claude_desktop_config.json` (or your Claude Code config)

```json
{
  "mcpServers": {
    "claude-remote-tasks": {
      "command": "python",
      "args": ["/path/to/claude-remote/app/mcp/scheduled_tasks_mcp.py"],
      "env": {
        "CLAUDE_REMOTE_URL": "http://localhost:8000",
        "CLAUDE_REMOTE_TOKEN": "your-auth-token"
      }
    }
  }
}
```

**Available MCP Tools:**
- `create_scheduled_task` — Create a new scheduled task
- `list_scheduled_tasks` — List all tasks
- `get_scheduled_task` — Get task details
- `update_scheduled_task` — Modify a task
- `delete_scheduled_task` — Remove a task
- `toggle_scheduled_task` — Enable/disable a task
- `run_scheduled_task_now` — Execute immediately
- `get_task_executions` — View execution history

---

## Service Management

### macOS

```bash
# Start
launchctl start com.claude.remote.backend

# Stop
launchctl stop com.claude.remote.backend

# View logs
tail -f ~/claude-remote/logs/backend.log
```

### Linux

```bash
# Start
sudo systemctl start claude-remote

# Stop
sudo systemctl stop claude-remote

# View logs
sudo journalctl -u claude-remote -f
```

---

## Security Notes

1. **Use strong AUTH_TOKEN** — This is your only authentication
2. **Use Cloudflare Tunnel** — Don't expose port 8000 directly to internet
3. **Firewall** — Only allow local access if not using tunnel
4. **HTTPS** — Cloudflare Tunnel provides this automatically

---

## Troubleshooting

### Can't connect?
- Check if service is running: `curl http://localhost:8000/health`
- Check AUTH_TOKEN matches
- Check firewall settings

### Session won't start?
- Verify Claude Code is installed: `which claude`
- Check logs: `~/claude-remote/logs/backend.error.log`

### Mobile display issues?
- Try adjusting font size with A+/A- buttons
- Refresh the page if terminal doesn't render

---

## License

Apache License, Version 2.0

---

## Author

Bill Chen

---

<p align="center">
  <i>Programming is thinking, not typing.<br>
  Let your mind roam free.</i>
</p>
