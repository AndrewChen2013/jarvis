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
使用 SQLite 数据库存储。
"""
from typing import Optional, Dict

from app.services.database import db
from app.core.logging import logger


class NamingStore:
    """附加命名存储（基于 SQLite）"""

    def get_name(self, session_id: str) -> Optional[str]:
        """获取会话的自定义名称"""
        return db.get_session_name(session_id)

    def set_name(self, session_id: str, name: str):
        """设置会话的自定义名称"""
        if name:
            db.set_session_name(session_id, name)
        else:
            db.delete_session_name(session_id)

    def delete_name(self, session_id: str):
        """删除会话的自定义名称"""
        db.delete_session_name(session_id)

    def get_all_names(self) -> Dict[str, str]:
        """获取所有命名映射"""
        return db.get_all_session_names()

    def cleanup_orphans(self, valid_session_ids: set):
        """清理不存在的会话的命名"""
        all_names = self.get_all_names()
        orphans = [sid for sid in all_names if sid not in valid_session_ids]
        for sid in orphans:
            self.delete_name(sid)
        if orphans:
            logger.info(f"Cleaned up {len(orphans)} orphan names")


# 全局实例
naming_store = NamingStore()
