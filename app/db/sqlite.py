import aiosqlite
import json
from datetime import datetime
from typing import Optional, List, Dict
from pathlib import Path
from app.core.logging import logger


class SQLiteDB:
    """SQLite 数据库管理器"""

    def __init__(self, db_path: str = "data/sessions.db"):
        self.db_path = db_path
        self.conn: Optional[aiosqlite.Connection] = None

    async def connect(self):
        """连接数据库"""
        # 确保目录存在
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)

        self.conn = await aiosqlite.connect(self.db_path)
        self.conn.row_factory = aiosqlite.Row

        # 创建表
        await self.conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                name TEXT,
                working_dir TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'idle',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_active TEXT NOT NULL,
                pid INTEGER,
                claude_session_id TEXT
            )
        """)
        await self.conn.commit()

        # 迁移：添加 claude_session_id 列（如果不存在）
        try:
            await self.conn.execute("ALTER TABLE sessions ADD COLUMN claude_session_id TEXT")
            await self.conn.commit()
        except Exception:
            pass  # 列已存在

        # 迁移：添加 description 列（如果不存在）
        try:
            await self.conn.execute("ALTER TABLE sessions ADD COLUMN description TEXT")
            await self.conn.commit()
        except Exception:
            pass  # 列已存在

        logger.info("SQLite connected successfully")

    async def disconnect(self):
        """断开连接"""
        if self.conn:
            await self.conn.close()
            logger.info("SQLite disconnected")

    async def save_session(self, session_data: Dict):
        """保存会话"""
        await self.conn.execute("""
            INSERT OR REPLACE INTO sessions
            (id, name, description, working_dir, status, created_at, updated_at, last_active, pid, claude_session_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            session_data["id"],
            session_data.get("name", ""),  # 默认空字符串避免 NULL
            session_data.get("description"),
            session_data["working_dir"],
            session_data["status"],
            session_data["created_at"],
            session_data["updated_at"],
            session_data["last_active"],
            session_data.get("pid"),
            session_data.get("claude_session_id")
        ))
        await self.conn.commit()

    async def get_session(self, session_id: str) -> Optional[Dict]:
        """获取会话"""
        async with self.conn.execute(
            "SELECT * FROM sessions WHERE id = ?",
            (session_id,)
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                return dict(row)
            return None

    async def update_session(self, session_id: str, updates: Dict):
        """更新会话"""
        # 构建更新语句
        fields = []
        values = []
        for key, value in updates.items():
            fields.append(f"{key} = ?")
            values.append(value)

        if not fields:
            return

        values.append(session_id)
        query = f"UPDATE sessions SET {', '.join(fields)} WHERE id = ?"

        await self.conn.execute(query, values)
        await self.conn.commit()

    async def delete_session(self, session_id: str):
        """删除会话"""
        await self.conn.execute(
            "DELETE FROM sessions WHERE id = ?",
            (session_id,)
        )
        await self.conn.commit()

    async def list_sessions(self) -> List[Dict]:
        """列出所有会话"""
        async with self.conn.execute(
            "SELECT * FROM sessions ORDER BY created_at DESC"
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

    async def cleanup_old_sessions(self, max_age_seconds: int):
        """清理旧会话"""
        cutoff_time = datetime.now().timestamp() - max_age_seconds
        cutoff_str = datetime.fromtimestamp(cutoff_time).isoformat()

        await self.conn.execute("""
            DELETE FROM sessions
            WHERE last_active < ? AND status != 'active'
        """, (cutoff_str,))
        await self.conn.commit()
