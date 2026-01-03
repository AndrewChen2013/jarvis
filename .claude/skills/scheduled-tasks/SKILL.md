# Scheduled Task Management Skill

## Overview

Allows users to create, query, and manage scheduled tasks through natural language. Tasks will periodically execute a prompt and push results to Feishu.

## Trigger Conditions

Use this Skill when user says things like:
- "Add a scheduled task..."
- "Create a task that runs every morning at 8am..."
- "Set up a daily reminder..."
- "I want to run something every Monday..."
- "List scheduled tasks" / "Show all tasks"
- "Delete task..."

## IMPORTANT: Creating Tasks

When creating a new task, you MUST:

1. **Ask for the notification receiver** before creating the task:
   - "Who should receive the notification? (email or Feishu user_id)"

2. **If user provides an email**:
   - Use Feishu MCP to convert email to user_id:
   ```
   Use mcp_feishu tool: get_user_id_by_email with email parameter
   ```
   - If conversion fails, ask user to provide user_id directly

3. **If user provides a user_id** (starts with `ou_`):
   - Use it directly

4. **Create the task with receiver configured**:
   ```bash
   python scripts/task_cli.py create \
     --name "Task Name" \
     --cron "*/5 * * * *" \
     --prompt "Your prompt" \
     --receiver "ou_xxxxx"
   ```

## Commands

All commands should be run from the project root directory.

### Create Task

```bash
python scripts/task_cli.py create \
  --name "Task Name" \
  --cron "*/5 * * * *" \
  --prompt "Your prompt here" \
  --receiver "ou_xxxxx"
```

Options:
- `--name, -n` (required): Task name
- `--prompt, -p` (required): Prompt to execute
- `--cron, -c` (required): Cron expression
- `--receiver, -r`: Feishu receiver user_id (ou_xxxxx format)
- `--description, -d`: Task description
- `--workdir, -w`: Working directory (default: project root)
- `--session, -s`: Session ID to resume (default: create new session)
- `--timezone, -t`: Timezone (default: Asia/Shanghai)
- `--no-feishu`: Disable Feishu notification

### List Tasks

```bash
python scripts/task_cli.py list
```

### Delete Task

```bash
python scripts/task_cli.py delete --id 123
```

### Toggle Task On/Off

```bash
python scripts/task_cli.py toggle --id 123
```

### Run Task Immediately

```bash
python scripts/task_cli.py run --id 123
```

## Cron Expression Reference

| Description | Cron |
|-------------|------|
| Every minute | `*/1 * * * *` |
| Every 5 minutes | `*/5 * * * *` |
| Every hour | `0 * * * *` |
| Daily at 8am | `0 8 * * *` |
| Daily at 10pm | `0 22 * * *` |
| Monday at 9am | `0 9 * * 1` |
| Weekdays at 8am | `0 8 * * 1-5` |

Format: `minute hour day month weekday`

## Example Conversation

**User**: Create a task to check Google News every 5 minutes

**Claude**: I'll help you create that task. Who should receive the notification? (email or Feishu user_id)

**User**: biao.chen@zilliz.com

**Claude**: Let me convert this email to Feishu user_id...
[Uses Feishu MCP to get user_id]

Got user_id: ou_xxxxx. Now creating the task:

```bash
python scripts/task_cli.py create \
  --name "Google News Update" \
  --cron "*/5 * * * *" \
  --prompt "Get latest 3 Google News headlines and summarize in Chinese" \
  --receiver "ou_xxxxx"
```

Task created! It will run every 5 minutes and push results to your Feishu.
