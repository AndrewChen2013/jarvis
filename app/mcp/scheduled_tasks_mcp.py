#!/usr/bin/env python3
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

"""
Claude Remote 定时任务管理 MCP Server

提供定时任务的创建、查询、删除、启用/禁用等功能。
通过 MCP 协议暴露给 Claude，使其能够直接管理定时任务。

启动方式：
    python -m app.mcp.scheduled_tasks_mcp
"""

import json
import sys
import os

# 添加项目根目录到 path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, PROJECT_ROOT)

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

# 延迟导入数据库，避免循环依赖
_db = None

def get_db():
    """获取数据库实例（延迟导入）"""
    global _db
    if _db is None:
        from app.services.database import db
        _db = db
    return _db


# 创建 MCP Server 实例
server = Server("claude-remote-tasks")


@server.list_tools()
async def list_tools():
    """List all available tools"""
    return [
        Tool(
            name="create_scheduled_task",
            description="""Create a new scheduled task. The task will execute the specified prompt according to the cron expression.

Common cron expressions:
- "*/5 * * * *" - Every 5 minutes
- "0 * * * *" - Every hour on the hour
- "0 8 * * *" - Every day at 8 AM
- "0 9 * * 1" - Every Monday at 9 AM
- "0 8 * * 1-5" - Weekdays at 8 AM

Format: minute hour day month weekday""",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Task name, briefly describe the task purpose"
                    },
                    "prompt": {
                        "type": "string",
                        "description": "The prompt to execute, describe what the task should do"
                    },
                    "cron_expr": {
                        "type": "string",
                        "description": "Cron expression defining execution frequency"
                    },
                    "working_dir": {
                        "type": "string",
                        "description": "Working directory (optional, defaults to project root)"
                    },
                    "description": {
                        "type": "string",
                        "description": "Detailed task description (optional)"
                    },
                    "notify_feishu": {
                        "type": "boolean",
                        "description": "Whether to send Feishu notification (default true, but requires feishu_receiver to be set)"
                    },
                    "feishu_receiver": {
                        "type": "string",
                        "description": "Feishu notification receiver (email or open_id). ⚠️ If not set, task results will NOT be sent as notifications"
                    }
                },
                "required": ["name", "prompt", "cron_expr"]
            }
        ),
        Tool(
            name="list_scheduled_tasks",
            description="List all scheduled tasks with name, status, cron expression, and recent execution info.",
            inputSchema={
                "type": "object",
                "properties": {
                    "enabled_only": {
                        "type": "boolean",
                        "description": "Only show enabled tasks (default false, shows all)"
                    }
                }
            }
        ),
        Tool(
            name="get_scheduled_task",
            description="Get detailed info of a scheduled task including execution history.",
            inputSchema={
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "integer",
                        "description": "Task ID"
                    }
                },
                "required": ["task_id"]
            }
        ),
        Tool(
            name="delete_scheduled_task",
            description="Delete a scheduled task. Cannot be undone.",
            inputSchema={
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "integer",
                        "description": "Task ID to delete"
                    }
                },
                "required": ["task_id"]
            }
        ),
        Tool(
            name="toggle_scheduled_task",
            description="Enable or disable a scheduled task. Disabled tasks won't auto-execute but can be triggered manually.",
            inputSchema={
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "integer",
                        "description": "Task ID"
                    }
                },
                "required": ["task_id"]
            }
        ),
        Tool(
            name="update_scheduled_task",
            description="Update scheduled task configuration. Only provide fields to update.",
            inputSchema={
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "integer",
                        "description": "Task ID"
                    },
                    "name": {
                        "type": "string",
                        "description": "New task name"
                    },
                    "prompt": {
                        "type": "string",
                        "description": "New task prompt"
                    },
                    "cron_expr": {
                        "type": "string",
                        "description": "New cron expression"
                    },
                    "description": {
                        "type": "string",
                        "description": "New task description"
                    },
                    "notify_feishu": {
                        "type": "boolean",
                        "description": "Whether to send Feishu notification"
                    },
                    "feishu_receiver": {
                        "type": "string",
                        "description": "Feishu notification receiver"
                    }
                },
                "required": ["task_id"]
            }
        ),
        Tool(
            name="run_scheduled_task_now",
            description="Run a scheduled task immediately (without waiting for cron trigger). Task runs in background.",
            inputSchema={
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "integer",
                        "description": "Task ID to execute"
                    }
                },
                "required": ["task_id"]
            }
        ),
        Tool(
            name="get_task_executions",
            description="Get task execution history.",
            inputSchema={
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "integer",
                        "description": "Task ID"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Number of records to return (default 10)"
                    }
                },
                "required": ["task_id"]
            }
        )
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict):
    """处理工具调用"""
    db = get_db()

    try:
        if name == "create_scheduled_task":
            return await handle_create_task(db, arguments)
        elif name == "list_scheduled_tasks":
            return await handle_list_tasks(db, arguments)
        elif name == "get_scheduled_task":
            return await handle_get_task(db, arguments)
        elif name == "delete_scheduled_task":
            return await handle_delete_task(db, arguments)
        elif name == "toggle_scheduled_task":
            return await handle_toggle_task(db, arguments)
        elif name == "update_scheduled_task":
            return await handle_update_task(db, arguments)
        elif name == "run_scheduled_task_now":
            return await handle_run_task(db, arguments)
        elif name == "get_task_executions":
            return await handle_get_executions(db, arguments)
        else:
            return [TextContent(type="text", text=f"Unknown tool: {name}")]
    except Exception as e:
        return [TextContent(type="text", text=f"Error: {str(e)}")]


async def handle_create_task(db, args: dict):
    """创建定时任务"""
    name = args.get("name")
    prompt = args.get("prompt")
    cron_expr = args.get("cron_expr")
    working_dir = args.get("working_dir", PROJECT_ROOT)
    description = args.get("description", "")
    notify_feishu = args.get("notify_feishu", True)
    feishu_receiver = args.get("feishu_receiver", "")

    # 创建任务
    task_id = db.create_scheduled_task(
        name=name,
        description=description,
        working_dir=working_dir,
        prompt=prompt,
        cron_expr=cron_expr,
        notify_feishu=notify_feishu,
        feishu_chat_id=feishu_receiver
    )

    # 注册到调度器
    try:
        from app.services.scheduler import scheduler
        scheduler.add_task(task_id)
    except Exception as e:
        # 调度器可能未运行，忽略
        pass

    result = {
        "success": True,
        "task_id": task_id,
        "message": f"Task '{name}' created successfully! ID: {task_id}",
        "cron_expr": cron_expr,
        "notify_feishu": notify_feishu,
        "feishu_receiver": feishu_receiver or None,
        "next_hint": "Task added to scheduler. Will execute automatically according to cron expression."
    }

    # 如果开启了飞书通知但没有设置接收者，添加提醒
    if notify_feishu and not feishu_receiver:
        result["warning"] = "⚠️ No Feishu receiver set. Task results will NOT be sent as notifications."
        result["hint"] = "To receive notifications: 1) For Feishu: install lark-mcp and set feishu_receiver (email or open_id); 2) For other channels (Slack, Email, etc.): install the corresponding MCP and describe the notification method in your task prompt."

    # 提示 agent 用用户的语言回复
    result["_agent_instruction"] = "IMPORTANT: Reply to the user in the same language they used to make this request."

    return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=2))]


async def handle_list_tasks(db, args: dict):
    """List all tasks"""
    enabled_only = args.get("enabled_only", False)

    tasks = db.get_all_scheduled_tasks()

    if enabled_only:
        tasks = [t for t in tasks if t.get("enabled")]

    if not tasks:
        return [TextContent(type="text", text="No scheduled tasks found.")]

    result = []
    for task in tasks:
        status = "✓ Enabled" if task.get("enabled") else "○ Disabled"
        last_run = task.get("last_run_at", "Never")
        result.append({
            "id": task["id"],
            "name": task["name"],
            "status": status,
            "cron": task["cron_expr"],
            "prompt": task["prompt"][:50] + "..." if len(task["prompt"]) > 50 else task["prompt"],
            "last_run": last_run,
            "notify_feishu": task.get("notify_feishu", False)
        })

    output = f"Total {len(tasks)} scheduled tasks:\n\n"
    output += json.dumps(result, ensure_ascii=False, indent=2)
    output += "\n\n[Reply to user in the same language they used]"

    return [TextContent(type="text", text=output)]


async def handle_get_task(db, args: dict):
    """Get single task details"""
    task_id = args.get("task_id")

    task = db.get_scheduled_task(task_id)
    if not task:
        return [TextContent(type="text", text=f"Task ID {task_id} not found")]

    # 获取最近执行记录
    executions = db.get_task_executions(task_id, limit=5)

    result = {
        "task": task,
        "recent_executions": executions
    }

    return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=2))]


async def handle_delete_task(db, args: dict):
    """Delete task"""
    task_id = args.get("task_id")

    task = db.get_scheduled_task(task_id)
    if not task:
        return [TextContent(type="text", text=f"Task ID {task_id} not found")]

    task_name = task["name"]

    # Remove from scheduler
    try:
        from app.services.scheduler import scheduler
        scheduler.remove_task(task_id)
    except:
        pass

    # Delete from database
    db.delete_scheduled_task(task_id)

    return [TextContent(type="text", text=f"Task '{task_name}' (ID: {task_id}) deleted\n\n[Reply to user in the same language they used]")]


async def handle_toggle_task(db, args: dict):
    """Enable/disable task"""
    task_id = args.get("task_id")

    task = db.get_scheduled_task(task_id)
    if not task:
        return [TextContent(type="text", text=f"Task ID {task_id} not found")]

    new_enabled = not task["enabled"]
    db.update_scheduled_task(task_id, enabled=new_enabled)

    # Update scheduler
    try:
        from app.services.scheduler import scheduler
        if new_enabled:
            scheduler.add_task(task_id)
        else:
            scheduler.remove_task(task_id)
    except:
        pass

    status = "enabled" if new_enabled else "disabled"
    return [TextContent(type="text", text=f"Task '{task['name']}' {status}\n\n[Reply to user in the same language they used]")]


async def handle_update_task(db, args: dict):
    """Update task"""
    task_id = args.pop("task_id")

    task = db.get_scheduled_task(task_id)
    if not task:
        return [TextContent(type="text", text=f"Task ID {task_id} not found")]

    # Build update args
    update_args = {}
    if "name" in args:
        update_args["name"] = args["name"]
    if "prompt" in args:
        update_args["prompt"] = args["prompt"]
    if "cron_expr" in args:
        update_args["cron_expr"] = args["cron_expr"]
    if "description" in args:
        update_args["description"] = args["description"]
    if "notify_feishu" in args:
        update_args["notify_feishu"] = args["notify_feishu"]
    if "feishu_receiver" in args:
        update_args["feishu_chat_id"] = args["feishu_receiver"]

    if not update_args:
        return [TextContent(type="text", text="No fields provided to update")]

    db.update_scheduled_task(task_id, **update_args)

    # If cron updated, re-register to scheduler
    if "cron_expr" in update_args and task["enabled"]:
        try:
            from app.services.scheduler import scheduler
            scheduler.update_task(task_id)
        except:
            pass

    return [TextContent(type="text", text=f"Task '{task['name']}' updated. Fields: {list(update_args.keys())}\n\n[Reply to user in the same language they used]")]


async def handle_run_task(db, args: dict):
    """Run task immediately"""
    task_id = args.get("task_id")

    task = db.get_scheduled_task(task_id)
    if not task:
        return [TextContent(type="text", text=f"Task ID {task_id} not found")]

    # Trigger execution
    try:
        from app.services.scheduler import scheduler
        import asyncio
        # Run in background
        asyncio.create_task(scheduler._execute_task(task_id))
        return [TextContent(type="text", text=f"Task '{task['name']}' started (running in background)\n\n[Reply to user in the same language they used]")]
    except Exception as e:
        return [TextContent(type="text", text=f"Execution failed: {str(e)}")]


async def handle_get_executions(db, args: dict):
    """Get execution history"""
    task_id = args.get("task_id")
    limit = args.get("limit", 10)

    task = db.get_scheduled_task(task_id)
    if not task:
        return [TextContent(type="text", text=f"Task ID {task_id} not found")]

    executions = db.get_task_executions(task_id, limit=limit)

    if not executions:
        return [TextContent(type="text", text=f"Task '{task['name']}' has no execution records")]

    result = {
        "task_name": task["name"],
        "total_shown": len(executions),
        "executions": executions
    }

    return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=2))]


async def main():
    """MCP Server entry point"""
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
