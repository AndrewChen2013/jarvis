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
Claude Projects 扫描服务

直接读取 ~/.claude/projects/ 目录，作为唯一真实来源。
不再维护自己的 session 管理，只提供读取能力。
"""
import os
import json
import shutil
from typing import List, Dict, Optional
from dataclasses import dataclass
from datetime import datetime
from app.core.logging import logger
from app.services.naming_store import naming_store


@dataclass
class ClaudeSession:
    """Claude 会话（对应一个 .jsonl 文件）"""
    session_id: str          # 文件名（不含 .jsonl）
    working_dir: str         # 会话的真实工作目录（从 JSONL 提取）
    project_dir: str         # 所属项目目录（从 hash 推断，可能不准确）
    summary: Optional[str]   # 从文件读取的 summary
    updated_at: datetime     # 文件修改时间
    file_size: int           # 文件大小
    total_tokens: int = 0    # 总 token 消耗


@dataclass
class ClaudeProject:
    """Claude 项目（对应一个工作目录）"""
    working_dir: str         # 工作目录路径
    path_hash: str           # 目录 hash（用于文件系统）
    session_count: int       # 会话数量
    last_updated: Optional[datetime]  # 最近更新时间


class ClaudeProjectsScanner:
    """Claude 项目扫描器"""

    def __init__(self, claude_dir: str = None):
        self.claude_dir = claude_dir or os.path.expanduser("~/.claude")
        self.projects_dir = os.path.join(self.claude_dir, "projects")

    def _path_to_hash(self, working_dir: str) -> str:
        """将工作目录转换为 Claude 的路径 hash
        例如: /Users/bill → -Users-bill
        Claude 会把 /、空格、~ 都替换为 -
        """
        path = os.path.normpath(working_dir)
        path = path.replace("/", "-")
        path = path.replace(" ", "-")
        path = path.replace("~", "-")
        return path

    def _hash_to_path(self, path_hash: str) -> str:
        """将路径 hash 转换回工作目录

        注意：Claude 的 hash 方式是把 /、空格、~ 都替换为 -，这是有损转换。

        我们的策略：
        1. 先尝试简单替换
        2. 尝试已知的特殊路径模式（如 iCloud）
        3. 如果路径不存在，尝试智能修复
        """
        if not path_hash.startswith("-"):
            return path_hash.replace("-", "/")

        # 简单替换
        simple_path = "/" + path_hash[1:].replace("-", "/")
        if os.path.exists(simple_path):
            return simple_path

        # 尝试已知的特殊路径模式
        # iCloud: Mobile-Documents -> "Mobile Documents", com-apple-XXX -> com~apple~XXX
        special_path = "/" + path_hash[1:].replace("-", "/")
        special_path = special_path.replace("/Mobile/Documents/", "/Mobile Documents/")
        special_path = special_path.replace("/com/apple/", "/com~apple~")
        if os.path.exists(special_path):
            logger.info(f"[Projects] Fixed iCloud path: {path_hash} -> {special_path}")
            return special_path

        # 智能修复：尝试不同的 - 和 / 组合
        parts = path_hash[1:].split("-")

        def try_combinations(parts, index, current_path):
            """递归尝试不同组合"""
            if index >= len(parts):
                full_path = "/" + current_path
                if os.path.exists(full_path):
                    return full_path
                return None

            part = parts[index]

            # 尝试用 / 连接
            path_with_slash = current_path + "/" + part if current_path else part
            result = try_combinations(parts, index + 1, path_with_slash)
            if result:
                return result

            # 尝试用 - 连接
            if current_path:
                path_with_dash = current_path + "-" + part
                result = try_combinations(parts, index + 1, path_with_dash)
                if result:
                    return result

            # 尝试用空格连接
            if current_path:
                path_with_space = current_path + " " + part
                result = try_combinations(parts, index + 1, path_with_space)
                if result:
                    return result

            # 尝试用 ~ 连接
            if current_path:
                path_with_tilde = current_path + "~" + part
                result = try_combinations(parts, index + 1, path_with_tilde)
                if result:
                    return result

            return None

        # 限制搜索深度，避免组合爆炸
        if len(parts) <= 10:
            result = try_combinations(parts, 0, "")
            if result:
                logger.info(f"[Projects] Fixed path: {path_hash} -> {result}")
                return result

        # 都失败了，返回简单替换的结果
        logger.warning(f"[Projects] Cannot resolve path for hash: {path_hash}, using fallback: {simple_path}")
        return simple_path

    def list_projects(self) -> List[ClaudeProject]:
        """列出所有 Claude 项目"""
        if not os.path.exists(self.projects_dir):
            return []

        projects = []
        for name in os.listdir(self.projects_dir):
            project_path = os.path.join(self.projects_dir, name)
            if not os.path.isdir(project_path) or name.startswith("."):
                continue

            working_dir = self._hash_to_path(name)

            # 统计会话数量和最近更新时间（只统计有实际对话的 session）
            session_count = 0
            last_updated = None

            for filename in os.listdir(project_path):
                if not filename.endswith(".jsonl") or filename.startswith("agent-"):
                    continue
                filepath = os.path.join(project_path, filename)
                session_id = filename.replace(".jsonl", "")

                # 检查是否有实际对话（与 list_sessions 使用相同逻辑）
                metadata = self._parse_session_metadata(filepath)
                if not metadata["has_messages"]:
                    # 自动清理空 session
                    self._cleanup_empty_session(project_path, session_id)
                    continue

                session_count += 1
                try:
                    mtime = datetime.fromtimestamp(os.path.getmtime(filepath))
                    if last_updated is None or mtime > last_updated:
                        last_updated = mtime
                except OSError:
                    continue

            projects.append(ClaudeProject(
                working_dir=working_dir,
                path_hash=name,
                session_count=session_count,
                last_updated=last_updated
            ))

        # 按最近更新时间排序
        projects.sort(key=lambda p: p.last_updated or datetime.min, reverse=True)
        return projects

    def list_sessions(self, working_dir: str) -> List[ClaudeSession]:
        """列出某个工作目录下的所有 Claude 会话"""
        path_hash = self._path_to_hash(working_dir)
        project_path = os.path.join(self.projects_dir, path_hash)

        if not os.path.exists(project_path):
            return []

        sessions = []
        for filename in os.listdir(project_path):
            if not filename.endswith(".jsonl") or filename.startswith("agent-"):
                continue

            filepath = os.path.join(project_path, filename)
            if os.path.isdir(filepath):
                continue

            session_id = filename.replace(".jsonl", "")

            try:
                mtime = datetime.fromtimestamp(os.path.getmtime(filepath))
                file_size = os.path.getsize(filepath)
            except OSError:
                continue

            # 从 JSONL 提取 metadata（包括真实 cwd）
            metadata = self._parse_session_metadata(filepath)

            # 跳过没有实际对话的 session（无法 resume）
            if not metadata["has_messages"]:
                continue

            # 使用 JSONL 中的真实 cwd，如果没有则回退到传入的 working_dir
            real_cwd = metadata["cwd"] or working_dir

            sessions.append(ClaudeSession(
                session_id=session_id,
                working_dir=real_cwd,
                project_dir=working_dir,  # 项目目录（从 hash 推断）
                summary=metadata["summary"],
                updated_at=mtime,
                file_size=file_size,
                total_tokens=metadata["total_tokens"]
            ))

        # 按更新时间降序排序
        sessions.sort(key=lambda s: s.updated_at, reverse=True)
        return sessions

    def get_session(self, working_dir: str, session_id: str) -> Optional[ClaudeSession]:
        """获取单个会话信息"""
        path_hash = self._path_to_hash(working_dir)
        filepath = os.path.join(self.projects_dir, path_hash, f"{session_id}.jsonl")

        if not os.path.exists(filepath):
            return None

        try:
            mtime = datetime.fromtimestamp(os.path.getmtime(filepath))
            file_size = os.path.getsize(filepath)

            # 从 JSONL 提取 metadata（包括真实 cwd）
            metadata = self._parse_session_metadata(filepath)

            # 没有实际对话的 session 视为不存在
            if not metadata["has_messages"]:
                return None

            real_cwd = metadata["cwd"] or working_dir

            return ClaudeSession(
                session_id=session_id,
                working_dir=real_cwd,
                project_dir=working_dir,
                summary=metadata["summary"],
                updated_at=mtime,
                file_size=file_size,
                total_tokens=metadata["total_tokens"]
            )
        except OSError as e:
            logger.error(f"Error reading session {session_id}: {e}")
            return None

    def _parse_session_metadata(self, jsonl_file: str) -> Dict:
        """从会话文件中提取 metadata（summary、真实 cwd、是否有对话、token 使用量）

        Returns:
            {
                "summary": str or None,  # 最新的 summary
                "cwd": str or None,      # 会话的真实工作目录
                "has_messages": bool,    # 是否有实际对话（user/assistant 消息）
                "total_tokens": int      # 总 token 消耗
            }
        """
        result = {"summary": None, "cwd": None, "has_messages": False, "total_tokens": 0}

        try:
            summaries = []
            with open(jsonl_file, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        # 提取 summary
                        if data.get("type") == "summary":
                            summaries.append(data.get("summary"))
                        # 提取 cwd（从第一条包含 cwd 的消息获取）
                        if result["cwd"] is None and "cwd" in data:
                            result["cwd"] = data["cwd"]
                        # 检查是否有实际对话消息
                        if data.get("type") in ("user", "assistant"):
                            result["has_messages"] = True
                        # 提取 token 使用量（从 assistant 消息中）
                        if data.get("type") == "assistant":
                            msg = data.get("message", {})
                            usage = msg.get("usage", {})
                            if usage:
                                result["total_tokens"] += usage.get("input_tokens", 0)
                                result["total_tokens"] += usage.get("cache_creation_input_tokens", 0)
                                result["total_tokens"] += usage.get("cache_read_input_tokens", 0)
                                result["total_tokens"] += usage.get("output_tokens", 0)
                    except json.JSONDecodeError:
                        continue

            result["summary"] = summaries[-1] if summaries else None
            return result
        except Exception as e:
            logger.error(f"Error reading session file {jsonl_file}: {e}")
            return result

    def session_exists(self, working_dir: str, session_id: str) -> bool:
        """检查会话是否存在"""
        path_hash = self._path_to_hash(working_dir)
        filepath = os.path.join(self.projects_dir, path_hash, f"{session_id}.jsonl")
        return os.path.exists(filepath)

    def _cleanup_empty_session(self, project_path: str, session_id: str) -> bool:
        """清理空 session（无实际对话的 session）

        删除：
        1. .jsonl 文件
        2. 同名目录（如果存在，包含 tool-results 等）
        3. naming_store 中的自定义名称

        Returns:
            True if cleaned up, False otherwise
        """
        try:
            # 删除 .jsonl 文件
            jsonl_file = os.path.join(project_path, f"{session_id}.jsonl")
            if os.path.exists(jsonl_file):
                os.remove(jsonl_file)
                logger.info(f"[Cleanup] Deleted empty session file: {session_id}.jsonl")

            # 删除同名目录（tool-results 等）
            session_dir = os.path.join(project_path, session_id)
            if os.path.isdir(session_dir):
                shutil.rmtree(session_dir)
                logger.info(f"[Cleanup] Deleted session directory: {session_id}/")

            # 删除 naming_store 中的记录
            naming_store.delete_name(session_id)

            return True
        except Exception as e:
            logger.error(f"[Cleanup] Failed to clean up session {session_id}: {e}")
            return False


# 全局实例
claude_projects = ClaudeProjectsScanner()
