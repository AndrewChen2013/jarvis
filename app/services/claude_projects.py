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
    # Context 信息 - 基础字段
    context_used: int = 0         # 已用 token
    context_max: int = 200000     # 最大 token
    context_percentage: int = 0   # 使用百分比
    context_free: int = 0         # 剩余空间
    context_until_compact: int = 0  # 距离压缩
    # Context 信息 - 完整数据
    context_model: str = ""       # 模型名称
    context_categories: Optional[Dict] = None   # {category: {tokens, percentage}}
    context_skills: Optional[List] = None       # [{name, source, tokens}]


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

            ctx = metadata.get("context") or {}
            sessions.append(ClaudeSession(
                session_id=session_id,
                working_dir=real_cwd,
                project_dir=working_dir,  # 项目目录（从 hash 推断）
                summary=metadata["summary"],
                updated_at=mtime,
                file_size=file_size,
                total_tokens=metadata["total_tokens"],
                context_used=ctx.get("tokens_used", 0),
                context_max=ctx.get("tokens_max", 200000),
                context_percentage=ctx.get("percentage", 0),
                context_free=ctx.get("free", 0),
                context_until_compact=ctx.get("until_compact", 0),
                context_model=ctx.get("model", ""),
                context_categories=ctx.get("categories"),
                context_skills=ctx.get("skills")
            ))

        # 按更新时间降序排序
        sessions.sort(key=lambda s: s.updated_at, reverse=True)
        return sessions

    def find_session_by_id(self, session_id: str) -> Optional[ClaudeSession]:
        """根据 session_id 搜索所有项目目录找到对应的会话

        Args:
            session_id: Claude session ID（UUID）

        Returns:
            ClaudeSession 或 None
        """
        if not os.path.exists(self.projects_dir):
            return None

        # 搜索所有项目目录
        for project_name in os.listdir(self.projects_dir):
            project_path = os.path.join(self.projects_dir, project_name)
            if not os.path.isdir(project_path) or project_name.startswith("."):
                continue

            filepath = os.path.join(project_path, f"{session_id}.jsonl")
            if os.path.exists(filepath):
                # 找到了，解析并返回
                working_dir = self._hash_to_path(project_name)
                return self.get_session(working_dir, session_id)

        return None

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
            ctx = metadata.get("context") or {}

            return ClaudeSession(
                session_id=session_id,
                working_dir=real_cwd,
                project_dir=working_dir,
                summary=metadata["summary"],
                updated_at=mtime,
                file_size=file_size,
                total_tokens=metadata["total_tokens"],
                context_used=ctx.get("tokens_used", 0),
                context_max=ctx.get("tokens_max", 200000),
                context_percentage=ctx.get("percentage", 0),
                context_free=ctx.get("free", 0),
                context_until_compact=ctx.get("until_compact", 0),
                context_model=ctx.get("model", ""),
                context_categories=ctx.get("categories"),
                context_skills=ctx.get("skills")
            )
        except OSError as e:
            logger.error(f"Error reading session {session_id}: {e}")
            return None

    def _parse_session_metadata(self, jsonl_file: str) -> Dict:
        """从会话文件中提取 metadata（summary、真实 cwd、是否有对话、token 使用量、context 信息）

        Returns:
            {
                "summary": str or None,  # 最新的 summary
                "cwd": str or None,      # 会话的真实工作目录
                "has_messages": bool,    # 是否有实际对话（user/assistant 消息）
                "total_tokens": int,     # 总 token 消耗
                "context": dict or None  # context 使用情况
            }
        """
        result = {"summary": None, "cwd": None, "has_messages": False, "total_tokens": 0, "context": None}

        try:
            summaries = []
            context_data = None
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
                        # 提取 context 信息（从 /context 命令输出）
                        # 与 /api/context 保持一致：检查所有消息，不限定 type
                        content = data.get("message", {}).get("content", "")
                        # content 可能是字符串或列表，需要处理两种情况
                        content_text = self._extract_content_text(content)
                        if "<local-command-stdout>" in content_text and "Context Usage" in content_text:
                            parsed = self._parse_context_output(content_text)
                            if parsed:
                                context_data = parsed
                    except json.JSONDecodeError:
                        continue

            result["summary"] = summaries[-1] if summaries else None
            result["context"] = context_data
            return result
        except Exception as e:
            logger.error(f"Error reading session file {jsonl_file}: {e}")
            return result

    def _extract_content_text(self, content) -> str:
        """从 content 提取文本内容

        content 可能是:
        1. 字符串 - 直接返回
        2. 列表 - 包含多个 content block，如 text, tool_use, tool_result 等

        Returns:
            合并后的文本内容
        """
        if isinstance(content, str):
            return content

        if not isinstance(content, list):
            return ""

        texts = []
        for block in content:
            if isinstance(block, str):
                texts.append(block)
            elif isinstance(block, dict):
                block_type = block.get("type", "")
                # 处理 text 类型
                if block_type == "text":
                    texts.append(block.get("text", ""))
                # 处理 tool_result 类型（/context 输出可能在这里）
                elif block_type == "tool_result":
                    # tool_result 的 content 也可能是字符串或列表
                    tool_content = block.get("content", "")
                    texts.append(self._extract_content_text(tool_content))

        return "\n".join(texts)

    def _parse_context_output(self, content: str) -> Optional[Dict]:
        """解析 /context 命令输出 - 提取完整数据

        支持两种格式：
        1. Markdown 格式: **Tokens:** 64.6k / 200.0k (32%)
        2. 终端 ANSI 格式: claude-opus-4-5-20251101 · 168k/200k tokens (84%)
        """
        import re
        match = re.search(r"<local-command-stdout>(.*?)</local-command-stdout>", content, re.DOTALL)
        if not match:
            return None

        md = match.group(1)

        # 先去除 ANSI 颜色代码，便于解析
        ansi_escape = re.compile(r'\x1b\[[0-9;]*m')
        clean_text = ansi_escape.sub('', md)

        result = {
            "model": "",
            "tokens_used": 0,
            "tokens_max": 200000,
            "percentage": 0,
            "categories": {},  # System prompt, System tools, Messages, Free space, Autocompact buffer
            "skills": [],      # [{name, source, tokens}]
            # 兼容旧字段
            "free": 0,
            "until_compact": 0
        }

        # 尝试解析终端 ANSI 格式: claude-opus-4-5-20251101 · 168k/200k tokens (84%)
        # 格式: model · usedK/maxK tokens (percentage%)
        terminal_match = re.search(r"(claude-[a-z0-9\-\.]+)\s*[·•]\s*([\d.]+)k/([\d.]+)k\s+tokens\s*\((\d+)%\)", clean_text, re.IGNORECASE)
        if terminal_match:
            result["model"] = terminal_match.group(1)
            result["tokens_used"] = int(float(terminal_match.group(2)) * 1000)
            result["tokens_max"] = int(float(terminal_match.group(3)) * 1000)
            result["percentage"] = int(terminal_match.group(4))
        else:
            # 回退到 Markdown 格式解析
            # 解析 Model
            model_match = re.search(r"\*\*Model:\*\*\s*(\S+)", md)
            if model_match:
                result["model"] = model_match.group(1)

            # 解析 Tokens 总量
            tokens_match = re.search(r"\*\*Tokens:\*\*\s*([\d.]+)k\s*/\s*([\d.]+)k\s*\((\d+)%\)", md)
            if tokens_match:
                result["tokens_used"] = int(float(tokens_match.group(1)) * 1000)
                result["tokens_max"] = int(float(tokens_match.group(2)) * 1000)
                result["percentage"] = int(tokens_match.group(3))

        # 解析 Categories - 支持两种格式
        # 1. Markdown 表格格式: | System prompt | 2.9k | 1.5% |
        category_pattern = r"\|\s*(System prompt|System tools|Messages|Free space|Autocompact buffer)\s*\|\s*([\d.]+)k?\s*\|\s*([\d.]+)%\s*\|"
        for match in re.finditer(category_pattern, md):
            name = match.group(1)
            tokens_str = match.group(2)
            pct = float(match.group(3))
            tokens = int(float(tokens_str) * 1000) if 'k' in match.group(0) or float(tokens_str) < 1000 else int(float(tokens_str))
            result["categories"][name] = {"tokens": tokens, "percentage": pct}

        # 2. 终端 ANSI 格式: ⛁ System prompt: 3.0k tokens (1.5%)
        terminal_cat_patterns = [
            (r"System prompt:\s*([\d.]+)k\s*tokens?\s*\(([\d.]+)%\)", "System prompt"),
            (r"System tools:\s*([\d.]+)k\s*tokens?\s*\(([\d.]+)%\)", "System tools"),
            (r"Messages:\s*([\d.]+)k\s*tokens?\s*\(([\d.]+)%\)", "Messages"),
            (r"Free space:\s*([\d.]+)k\s*\(([\d.]+)%\)", "Free space"),
            (r"Autocompact buffer:\s*([\d.]+)k\s*tokens?\s*\(([\d.]+)%\)", "Autocompact buffer"),
        ]
        for pattern, name in terminal_cat_patterns:
            match = re.search(pattern, clean_text, re.IGNORECASE)
            if match and name not in result["categories"]:
                tokens = int(float(match.group(1)) * 1000)
                pct = float(match.group(2))
                result["categories"][name] = {"tokens": tokens, "percentage": pct}

        # 兼容旧字段
        if "Free space" in result["categories"]:
            result["free"] = result["categories"]["Free space"]["tokens"]
        if "Autocompact buffer" in result["categories"] and result["free"] > 0:
            result["until_compact"] = result["free"] - result["categories"]["Autocompact buffer"]["tokens"]

        # 解析 Skills - 支持两种格式
        # 1. Markdown 表格格式: | skill-name | User | 3.1k |
        skill_pattern = r"\|\s*(\S+)\s*\|\s*(User|System)\s*\|\s*([\d.]+)k?\s*\|"
        for match in re.finditer(skill_pattern, md):
            name = match.group(1)
            if name in ("Skill", "-------"):  # 跳过表头
                continue
            source = match.group(2)
            tokens_str = match.group(3)
            tokens = int(float(tokens_str) * 1000) if float(tokens_str) < 100 else int(float(tokens_str))
            result["skills"].append({"name": name, "source": source, "tokens": tokens})

        # 2. 终端 ANSI 格式: └ claude-remote-info: 3.1k tokens
        if not result["skills"]:
            # 检测当前 source（User 或 System）
            current_source = "User"
            for line in clean_text.split('\n'):
                line = line.strip()
                if line == "User":
                    current_source = "User"
                elif line == "System":
                    current_source = "System"
                # 匹配 skill 行: └ skill-name: 3.1k tokens 或 └ skill-name: 630 tokens
                skill_match = re.match(r"[└├]\s*([^:]+):\s*([\d.]+)(k)?\s*tokens?", line)
                if skill_match:
                    name = skill_match.group(1).strip()
                    tokens_str = skill_match.group(2)
                    has_k = skill_match.group(3) == 'k'
                    tokens = int(float(tokens_str) * 1000) if has_k else int(float(tokens_str))
                    result["skills"].append({"name": name, "source": current_source, "tokens": tokens})

        # 如果没有从 categories 获取 free（终端格式没有分类表格），则计算
        if result["free"] == 0 and result["tokens_used"] > 0:
            result["free"] = result["tokens_max"] - result["tokens_used"]
            # until_compact 大约是 free 的 40%（autocompact buffer 约占 22.5%）
            result["until_compact"] = int(result["free"] * 0.4) if result["free"] > 0 else 0

        return result if result["tokens_used"] > 0 else None

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
