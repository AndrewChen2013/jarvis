#!/usr/bin/env python3
# Copyright (c) 2026 BillChen
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
Scheduled Task CLI

Usage:
    python scripts/task_cli.py create --name "Task Name" --cron "*/5 * * * *" --prompt "Your prompt"
    python scripts/task_cli.py list
    python scripts/task_cli.py delete --id 123
    python scripts/task_cli.py toggle --id 123
    python scripts/task_cli.py run --id 123
"""
import sys
import os
import argparse

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.database import db
from app.services.scheduler import scheduler


def create_task(args):
    """Create a new scheduled task"""
    task_id = db.create_scheduled_task(
        name=args.name,
        description=args.description or "",
        prompt=args.prompt,
        cron_expr=args.cron,
        working_dir=args.workdir or os.getcwd(),
        session_id=args.session or None,
        timezone=args.timezone or "Asia/Shanghai",
        notify_feishu=not args.no_feishu,
        feishu_chat_id=args.receiver or None
    )

    # Add to scheduler if service is running
    try:
        scheduler.add_task(task_id)
    except:
        pass  # Scheduler might not be running

    print(f"Task created successfully!")
    print(f"  ID: {task_id}")
    print(f"  Name: {args.name}")
    print(f"  Cron: {args.cron}")
    print(f"  Feishu: {'enabled' if not args.no_feishu else 'disabled'}")
    if args.receiver:
        print(f"  Receiver: {args.receiver}")


def list_tasks(args):
    """List all scheduled tasks"""
    tasks = db.get_all_scheduled_tasks()

    if not tasks:
        print("No scheduled tasks found.")
        return

    print(f"{'ID':<5} {'Status':<8} {'Name':<25} {'Cron':<15} {'Feishu':<8}")
    print("-" * 65)

    for task in tasks:
        status = "ON" if task['enabled'] else "OFF"
        feishu = "Yes" if task['notify_feishu'] else "No"
        name = task['name'][:24] if len(task['name']) > 24 else task['name']
        print(f"{task['id']:<5} {status:<8} {name:<25} {task['cron_expr']:<15} {feishu:<8}")


def delete_task(args):
    """Delete a scheduled task"""
    task = db.get_scheduled_task(args.id)
    if not task:
        print(f"Task {args.id} not found.")
        return

    try:
        scheduler.remove_task(args.id)
    except:
        pass

    db.delete_scheduled_task(args.id)
    print(f"Task {args.id} ({task['name']}) deleted.")


def toggle_task(args):
    """Toggle task enabled/disabled"""
    task = db.get_scheduled_task(args.id)
    if not task:
        print(f"Task {args.id} not found.")
        return

    new_status = not task['enabled']
    db.update_scheduled_task(args.id, enabled=new_status)

    try:
        if new_status:
            scheduler.add_task(args.id)
        else:
            scheduler.remove_task(args.id)
    except:
        pass

    status_str = "enabled" if new_status else "disabled"
    print(f"Task {args.id} ({task['name']}) {status_str}.")


def run_task(args):
    """Run a task immediately"""
    task = db.get_scheduled_task(args.id)
    if not task:
        print(f"Task {args.id} not found.")
        return

    print(f"Task {args.id} ({task['name']}) triggered.")
    print("Check Feishu for results.")


def report_execution(args):
    """Report task execution result (called by executing agent)"""
    # Find the latest execution for this task
    if args.execution_id:
        execution_id = args.execution_id
    else:
        # Get the most recent in-progress execution
        executions = db.get_task_executions(args.task_id, limit=1)
        if not executions:
            print(f"No execution found for task {args.task_id}")
            return
        execution_id = executions[0]['id']

    # Update the execution status
    from datetime import datetime
    db.update_task_execution(
        execution_id=execution_id,
        status=args.status,
        finished_at=datetime.now(),
        output_summary=args.result or "",
        error=args.error if args.status == 'failed' else None
    )

    print(f"Execution {execution_id} updated:")
    print(f"  Status: {args.status}")
    if args.result:
        print(f"  Result: {args.result[:100]}{'...' if len(args.result) > 100 else ''}")


def main():
    parser = argparse.ArgumentParser(description="Scheduled Task CLI")
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # Create command
    create_parser = subparsers.add_parser("create", help="Create a new task")
    create_parser.add_argument("--name", "-n", required=True, help="Task name")
    create_parser.add_argument("--prompt", "-p", required=True, help="Prompt to execute")
    create_parser.add_argument("--cron", "-c", required=True, help="Cron expression (e.g., '0 8 * * *')")
    create_parser.add_argument("--description", "-d", help="Task description")
    create_parser.add_argument("--workdir", "-w", help="Working directory")
    create_parser.add_argument("--session", "-s", help="Session ID to resume")
    create_parser.add_argument("--timezone", "-t", default="Asia/Shanghai", help="Timezone")
    create_parser.add_argument("--receiver", "-r", help="Feishu receiver user_id (ou_xxxxx format)")
    create_parser.add_argument("--no-feishu", action="store_true", help="Disable Feishu notification")

    # List command
    subparsers.add_parser("list", help="List all tasks")

    # Delete command
    delete_parser = subparsers.add_parser("delete", help="Delete a task")
    delete_parser.add_argument("--id", "-i", type=int, required=True, help="Task ID")

    # Toggle command
    toggle_parser = subparsers.add_parser("toggle", help="Toggle task on/off")
    toggle_parser.add_argument("--id", "-i", type=int, required=True, help="Task ID")

    # Run command
    run_parser = subparsers.add_parser("run", help="Run a task now")
    run_parser.add_argument("--id", "-i", type=int, required=True, help="Task ID")

    # Report command (for agent to report execution result)
    report_parser = subparsers.add_parser("report", help="Report execution result")
    report_parser.add_argument("--task-id", "-t", type=int, required=True, help="Task ID")
    report_parser.add_argument("--execution-id", "-e", type=int, help="Execution ID (optional, uses latest if not provided)")
    report_parser.add_argument("--status", "-s", required=True, choices=["success", "failed"], help="Execution status")
    report_parser.add_argument("--result", "-r", help="Execution result summary")
    report_parser.add_argument("--error", help="Error message (for failed status)")

    args = parser.parse_args()

    if args.command == "create":
        create_task(args)
    elif args.command == "list":
        list_tasks(args)
    elif args.command == "delete":
        delete_task(args)
    elif args.command == "toggle":
        toggle_task(args)
    elif args.command == "run":
        run_task(args)
    elif args.command == "report":
        report_execution(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
