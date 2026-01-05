#!/usr/bin/env python3
"""
Register Experience Memory MCP Server to Claude configuration.

This script adds the experience-memory MCP server to ~/.claude.json
so it's available globally in Claude Code.

Usage:
    python scripts/register_experience_mcp.py
"""

import json
import os
import sys
from pathlib import Path

# Claude configuration file path
CLAUDE_CONFIG_PATH = Path.home() / ".claude.json"

# Project paths
PROJECT_ROOT = Path(__file__).parent.parent.absolute()
VENV_PYTHON = PROJECT_ROOT / "venv" / "bin" / "python"

# MCP server configuration
MCP_SERVER_CONFIG = {
    "command": str(VENV_PYTHON),  # Use project's venv Python
    "args": ["-m", "app.mcp.experience_memory_mcp"],
    "cwd": str(PROJECT_ROOT),
    "env": {
        "OLLAMA_URL": "http://localhost:11434",
        "EMBEDDING_MODEL": "qwen3-embedding:0.6b"
    }
}


def load_claude_config() -> dict:
    """Load existing Claude configuration or create new one"""
    if CLAUDE_CONFIG_PATH.exists():
        with open(CLAUDE_CONFIG_PATH, "r") as f:
            return json.load(f)
    return {}


def save_claude_config(config: dict):
    """Save Claude configuration"""
    with open(CLAUDE_CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)


def register_mcp():
    """Register the MCP server"""
    config = load_claude_config()

    # Ensure mcpServers section exists
    if "mcpServers" not in config:
        config["mcpServers"] = {}

    # Add or update experience-memory server
    config["mcpServers"]["experience-memory"] = MCP_SERVER_CONFIG

    # Save configuration
    save_claude_config(config)

    print("=" * 60)
    print("Experience Memory MCP Server registered successfully!")
    print("=" * 60)
    print()
    print(f"Configuration file: {CLAUDE_CONFIG_PATH}")
    print()
    print("MCP Server details:")
    print(f"  Name: experience-memory")
    print(f"  Command: {MCP_SERVER_CONFIG['command']}")
    print(f"  Working dir: {MCP_SERVER_CONFIG['cwd']}")
    print()
    print("Before using, make sure:")
    print("  1. Ollama is running: ollama serve")
    print("  2. Model is pulled: ollama pull qwen3-embedding:0.6b")
    print("  3. sqlite-vec is installed: pip install sqlite-vec")
    print()
    print("Available tools:")
    print("  - learn: Record a valuable experience")
    print("  - recall: Search for relevant experiences")
    print("  - list_experiences: Browse the knowledge base")
    print("  - update_experience: Update an existing experience")
    print("  - forget: Delete an experience")
    print()
    print("Restart Claude Code to use the new MCP server.")
    print("=" * 60)


def unregister_mcp():
    """Unregister the MCP server"""
    config = load_claude_config()

    if "mcpServers" in config and "experience-memory" in config["mcpServers"]:
        del config["mcpServers"]["experience-memory"]
        save_claude_config(config)
        print("Experience Memory MCP Server unregistered successfully.")
    else:
        print("Experience Memory MCP Server was not registered.")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--unregister":
        unregister_mcp()
    else:
        register_mcp()


if __name__ == "__main__":
    main()
