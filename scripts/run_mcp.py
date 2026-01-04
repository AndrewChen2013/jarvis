#!/usr/bin/env python3
# Copyright (c) 2025 BillChen
#
# Cross-platform MCP Server launcher
# Works on Linux, macOS, and Windows
#
# This script should be run with the venv's Python interpreter.
# It sets up the environment and directly imports the MCP server.

import os
import sys

def main():
    # Get project root (parent of scripts directory)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)

    # Add project root to Python path
    if project_root not in sys.path:
        sys.path.insert(0, project_root)

    # Change to project directory
    os.chdir(project_root)

    # Import and run MCP server
    import asyncio
    from app.mcp.scheduled_tasks_mcp import main as mcp_main
    asyncio.run(mcp_main())


if __name__ == "__main__":
    main()
