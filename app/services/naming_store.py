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
附加命名存储

提供给 Claude Session 添加自定义名称的能力。
使用简单的 JSON 文件存储，不需要复杂的数据库。
"""
import os
import json
from typing import Optional, Dict
from threading import Lock
from app.core.logging import logger


class NamingStore:
    """附加命名存储"""

    def __init__(self, store_path: str = None):
        self.store_path = store_path or os.path.expanduser("~/.claude-remote/session_names.json")
        self._lock = Lock()
        self._cache: Dict[str, str] = {}
        self._load()

    def _ensure_dir(self):
        """确保存储目录存在"""
        dir_path = os.path.dirname(self.store_path)
        if dir_path and not os.path.exists(dir_path):
            os.makedirs(dir_path, exist_ok=True)

    def _load(self):
        """从文件加载命名数据"""
        try:
            if os.path.exists(self.store_path):
                with open(self.store_path, 'r', encoding='utf-8') as f:
                    self._cache = json.load(f)
                logger.info(f"Loaded {len(self._cache)} session names")
        except Exception as e:
            logger.error(f"Failed to load naming store: {e}")
            self._cache = {}

    def _save(self):
        """保存命名数据到文件"""
        try:
            self._ensure_dir()
            with open(self.store_path, 'w', encoding='utf-8') as f:
                json.dump(self._cache, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Failed to save naming store: {e}")

    def get_name(self, session_id: str) -> Optional[str]:
        """获取会话的自定义名称"""
        with self._lock:
            return self._cache.get(session_id)

    def set_name(self, session_id: str, name: str):
        """设置会话的自定义名称"""
        with self._lock:
            if name:
                self._cache[session_id] = name
            elif session_id in self._cache:
                del self._cache[session_id]
            self._save()
        logger.info(f"Set name for session {session_id[:8]}...: {name}")

    def delete_name(self, session_id: str):
        """删除会话的自定义名称"""
        with self._lock:
            if session_id in self._cache:
                del self._cache[session_id]
                self._save()
                logger.info(f"Deleted name for session {session_id[:8]}...")

    def get_all_names(self) -> Dict[str, str]:
        """获取所有命名映射"""
        with self._lock:
            return self._cache.copy()

    def cleanup_orphans(self, valid_session_ids: set):
        """清理不存在的会话的命名"""
        with self._lock:
            orphans = [sid for sid in self._cache if sid not in valid_session_ids]
            for sid in orphans:
                del self._cache[sid]
            if orphans:
                self._save()
                logger.info(f"Cleaned up {len(orphans)} orphan names")


# 全局实例
naming_store = NamingStore()
