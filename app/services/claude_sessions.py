"""
Claude Code 会话扫描服务
扫描 ~/.claude/projects/ 目录下的会话文件
"""
import os
import json
from typing import List, Dict, Optional
from pathlib import Path
from datetime import datetime
from app.core.logging import logger


class ClaudeSessionScanner:
    """Claude 会话扫描器"""

    def __init__(self, claude_dir: str = None):
        self.claude_dir = claude_dir or os.path.expanduser("~/.claude")
        self.projects_dir = os.path.join(self.claude_dir, "projects")

    def _path_to_hash(self, working_dir: str) -> str:
        """将工作目录转换为 Claude 的路径 hash
        例如: /Users/bill → -Users-bill
        """
        # 规范化路径
        path = os.path.normpath(working_dir)
        # 替换 / 为 -
        path_hash = path.replace("/", "-")
        return path_hash

    def _hash_to_path(self, path_hash: str) -> str:
        """将路径 hash 转换回工作目录
        例如: -Users-bill → /Users/bill
        """
        # 替换 - 为 /，但要处理开头的 -
        if path_hash.startswith("-"):
            path = "/" + path_hash[1:].replace("-", "/")
        else:
            path = path_hash.replace("-", "/")
        return path

    def list_working_dirs(self) -> List[str]:
        """列出所有有 Claude 会话的工作目录"""
        if not os.path.exists(self.projects_dir):
            return []

        dirs = []
        for name in os.listdir(self.projects_dir):
            project_path = os.path.join(self.projects_dir, name)
            if os.path.isdir(project_path) and not name.startswith("."):
                working_dir = self._hash_to_path(name)
                dirs.append(working_dir)

        return sorted(dirs)

    def list_sessions(self, working_dir: str) -> List[Dict]:
        """列出某个工作目录下的所有 Claude 会话"""
        path_hash = self._path_to_hash(working_dir)
        project_dir = os.path.join(self.projects_dir, path_hash)

        if not os.path.exists(project_dir):
            return []

        sessions = []
        for filename in os.listdir(project_dir):
            if not filename.endswith(".jsonl"):
                continue

            # 跳过 agent 文件
            if filename.startswith("agent-"):
                continue

            filepath = os.path.join(project_dir, filename)

            # 跳过目录
            if os.path.isdir(filepath):
                continue

            session_id = filename.replace(".jsonl", "")

            # 获取文件修改时间
            mtime = os.path.getmtime(filepath)
            updated_at = datetime.fromtimestamp(mtime)

            # 获取会话 summary
            summary = self._get_session_summary(filepath)

            # 获取文件大小（用于判断是否有内容）
            file_size = os.path.getsize(filepath)

            sessions.append({
                "session_id": session_id,
                "name": summary,
                "working_dir": working_dir,
                "updated_at": updated_at.isoformat(),
                "file_size": file_size
            })

        # 按更新时间降序排序
        sessions.sort(key=lambda x: x["updated_at"], reverse=True)

        return sessions

    def _get_session_summary(self, jsonl_file: str) -> Optional[str]:
        """从会话文件中提取最新的 summary"""
        try:
            summaries = []
            with open(jsonl_file, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        if data.get("type") == "summary":
                            summaries.append(data.get("summary"))
                    except json.JSONDecodeError:
                        continue

            # 返回最新的 summary
            if summaries:
                return summaries[-1]

            return None
        except Exception as e:
            logger.error(f"Error reading session file {jsonl_file}: {e}")
            return None

    def get_session_info(self, working_dir: str, session_id: str) -> Optional[Dict]:
        """获取指定会话的详细信息"""
        path_hash = self._path_to_hash(working_dir)
        filepath = os.path.join(self.projects_dir, path_hash, f"{session_id}.jsonl")

        if not os.path.exists(filepath):
            return None

        mtime = os.path.getmtime(filepath)
        updated_at = datetime.fromtimestamp(mtime)
        summary = self._get_session_summary(filepath)
        file_size = os.path.getsize(filepath)

        return {
            "session_id": session_id,
            "name": summary,
            "working_dir": working_dir,
            "updated_at": updated_at.isoformat(),
            "file_size": file_size
        }


# 全局实例
claude_scanner = ClaudeSessionScanner()
