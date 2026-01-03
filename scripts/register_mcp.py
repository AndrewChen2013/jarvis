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
自动注册 Jarvis MCP Server 到 ~/.claude.json

在服务启动时运行此脚本，确保 MCP server 已注册到 Claude 配置中。
这样所有在 jarvis 项目目录下运行的 Claude agent 都能看到定时任务管理工具。
"""

import json
import os
import sys

# 项目根目录
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Claude 配置文件路径
CLAUDE_CONFIG_PATH = os.path.expanduser("~/.claude.json")

# MCP Server 配置
MCP_SERVER_NAME = "jarvis-tasks"
MCP_SERVER_CONFIG = {
    "type": "stdio",
    "command": f"{PROJECT_ROOT}/venv/bin/python",
    "args": ["-m", "app.mcp.scheduled_tasks_mcp"],
    "env": {
        "PYTHONPATH": PROJECT_ROOT
    }
}


def load_claude_config() -> dict:
    """加载 Claude 配置文件"""
    if not os.path.exists(CLAUDE_CONFIG_PATH):
        return {}

    try:
        with open(CLAUDE_CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError:
        print(f"Warning: {CLAUDE_CONFIG_PATH} is not valid JSON, skipping")
        return {}


def save_claude_config(config: dict):
    """保存 Claude 配置文件"""
    with open(CLAUDE_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)


def register_mcp_server(global_install: bool = True):
    """注册 MCP Server 到 Claude 配置

    Args:
        global_install: 如果为 True，注册到用户目录（全局可用）；否则注册到项目目录
    """
    config = load_claude_config()

    if "projects" not in config:
        config["projects"] = {}

    # 注册路径：用户目录（全局）或项目目录
    project_path = os.path.expanduser("~") if global_install else PROJECT_ROOT
    if project_path not in config["projects"]:
        config["projects"][project_path] = {
            "allowedTools": [],
            "mcpContextUris": [],
            "mcpServers": {},
            "enabledMcpjsonServers": [],
            "disabledMcpjsonServers": [],
            "hasTrustDialogAccepted": True
        }

    project_config = config["projects"][project_path]

    if "mcpServers" not in project_config:
        project_config["mcpServers"] = {}

    # 检查是否已注册
    current_config = project_config["mcpServers"].get(MCP_SERVER_NAME)
    if current_config == MCP_SERVER_CONFIG:
        print(f"MCP Server '{MCP_SERVER_NAME}' already registered (no changes)")
        return False

    # 注册 MCP Server
    project_config["mcpServers"][MCP_SERVER_NAME] = MCP_SERVER_CONFIG

    # 保存配置
    save_claude_config(config)
    print(f"MCP Server '{MCP_SERVER_NAME}' registered to {project_path}")
    return True


def unregister_mcp_server():
    """从 Claude 配置中移除 MCP Server"""
    config = load_claude_config()

    if "projects" not in config:
        return False

    project_path = PROJECT_ROOT
    if project_path not in config["projects"]:
        return False

    project_config = config["projects"][project_path]
    if "mcpServers" not in project_config:
        return False

    if MCP_SERVER_NAME not in project_config["mcpServers"]:
        print(f"MCP Server '{MCP_SERVER_NAME}' not found")
        return False

    del project_config["mcpServers"][MCP_SERVER_NAME]
    save_claude_config(config)
    print(f"MCP Server '{MCP_SERVER_NAME}' unregistered")
    return True


def main():
    """主函数"""
    import argparse

    parser = argparse.ArgumentParser(description="Register Jarvis MCP Server")
    parser.add_argument(
        "--unregister",
        action="store_true",
        help="Unregister the MCP Server instead of registering"
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check if MCP Server is registered"
    )
    parser.add_argument(
        "--local",
        action="store_true",
        help="Register to project directory only (default: global/user directory)"
    )

    args = parser.parse_args()
    global_install = not args.local

    if args.check:
        config = load_claude_config()
        project_path = os.path.expanduser("~") if global_install else PROJECT_ROOT
        if (
            "projects" in config
            and project_path in config["projects"]
            and "mcpServers" in config["projects"][project_path]
            and MCP_SERVER_NAME in config["projects"][project_path]["mcpServers"]
        ):
            print(f"MCP Server '{MCP_SERVER_NAME}' is registered at {project_path}")
            sys.exit(0)
        else:
            print(f"MCP Server '{MCP_SERVER_NAME}' is NOT registered")
            sys.exit(1)

    if args.unregister:
        success = unregister_mcp_server()
        sys.exit(0 if success else 1)
    else:
        success = register_mcp_server(global_install=global_install)
        sys.exit(0)


if __name__ == "__main__":
    main()
