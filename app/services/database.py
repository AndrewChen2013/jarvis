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
SQLite 数据库服务

统一管理所有本地数据存储：
- 会话命名
- IP 黑名单
- 登录记录
- 安全状态
"""
import os
import json
import sqlite3
from datetime import datetime
from typing import Optional, Dict, List, Any
from threading import Lock
from contextlib import contextmanager

from app.core.logging import logger


class Database:
    """SQLite 数据库服务"""

    def __init__(self, db_path: str = None):
        self.db_path = db_path or os.path.expanduser("~/.claude-remote/claude_remote.db")
        self._lock = Lock()
        self._ensure_dir()
        self._init_db()
        self._migrate_from_json()

    def _ensure_dir(self):
        """确保数据库目录存在"""
        dir_path = os.path.dirname(self.db_path)
        if dir_path and not os.path.exists(dir_path):
            os.makedirs(dir_path, exist_ok=True)

    @contextmanager
    def _get_conn(self):
        """获取数据库连接（线程安全）"""
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init_db(self):
        """初始化数据库表"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()

                # 会话命名表
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS session_names (
                        session_id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """)

                # IP 黑名单表
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS ip_blacklist (
                        ip TEXT PRIMARY KEY,
                        reason TEXT,
                        total_attempts INTEGER DEFAULT 0,
                        blocked_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """)

                # 登录尝试记录表
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS login_attempts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        ip TEXT NOT NULL,
                        success INTEGER DEFAULT 0,
                        attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                # 创建索引加速查询
                cursor.execute("""
                    CREATE INDEX IF NOT EXISTS idx_login_attempts_ip
                    ON login_attempts(ip, attempted_at)
                """)

                # 安全状态表（键值对存储）
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS security_state (
                        key TEXT PRIMARY KEY,
                        value TEXT,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """)

                # 成功登录的 IP 记录（用于检测异常）
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS login_success_ips (
                        ip TEXT PRIMARY KEY,
                        last_login DATETIME DEFAULT CURRENT_TIMESTAMP,
                        login_count INTEGER DEFAULT 1
                    )
                """)

                # 上传历史记录表
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS upload_history (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        filename TEXT NOT NULL,
                        path TEXT NOT NULL,
                        size INTEGER DEFAULT 0,
                        status TEXT DEFAULT 'success',
                        duration REAL DEFAULT 0,
                        error TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                # 创建索引加速查询
                cursor.execute("""
                    CREATE INDEX IF NOT EXISTS idx_upload_history_created
                    ON upload_history(created_at DESC)
                """)

                # 下载历史记录表
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS download_history (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        filename TEXT NOT NULL,
                        path TEXT NOT NULL,
                        size INTEGER DEFAULT 0,
                        status TEXT DEFAULT 'success',
                        duration REAL DEFAULT 0,
                        error TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                cursor.execute("""
                    CREATE INDEX IF NOT EXISTS idx_download_history_created
                    ON download_history(created_at DESC)
                """)

                # 终端历史记录表
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS terminal_history (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        session_id TEXT NOT NULL,
                        direction TEXT NOT NULL,
                        raw_content BLOB,
                        text_content TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                # 按会话查询索引
                cursor.execute("""
                    CREATE INDEX IF NOT EXISTS idx_terminal_session
                    ON terminal_history(session_id, created_at)
                """)
                # 按时间查询索引
                cursor.execute("""
                    CREATE INDEX IF NOT EXISTS idx_terminal_created
                    ON terminal_history(created_at DESC)
                """)

                # 置顶会话表（首屏快捷访问）
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS pinned_sessions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        session_id TEXT NOT NULL UNIQUE,
                        working_dir TEXT NOT NULL,
                        display_name TEXT,
                        position INTEGER DEFAULT 0,
                        type TEXT DEFAULT 'claude',
                        machine_id INTEGER,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                cursor.execute("""
                    CREATE INDEX IF NOT EXISTS idx_pinned_position
                    ON pinned_sessions(position ASC)
                """)

                # 远程机器表（SSH 连接管理）
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS remote_machines (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        host TEXT NOT NULL,
                        port INTEGER DEFAULT 22,
                        username TEXT NOT NULL,
                        password TEXT,
                        auth_type TEXT DEFAULT 'password',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                cursor.execute("""
                    CREATE INDEX IF NOT EXISTS idx_remote_machines_name
                    ON remote_machines(name)
                """)

                # 迁移：为 pinned_sessions 添加新列（如果不存在）
                self._migrate_pinned_sessions(cursor)

                logger.info("Database initialized")

    def _migrate_pinned_sessions(self, cursor):
        """为 pinned_sessions 表添加新列（向后兼容）"""
        try:
            # 检查是否存在 type 列
            cursor.execute("PRAGMA table_info(pinned_sessions)")
            columns = [row[1] for row in cursor.fetchall()]

            if 'type' not in columns:
                cursor.execute("ALTER TABLE pinned_sessions ADD COLUMN type TEXT DEFAULT 'claude'")
                logger.info("Added 'type' column to pinned_sessions")

            if 'machine_id' not in columns:
                cursor.execute("ALTER TABLE pinned_sessions ADD COLUMN machine_id INTEGER")
                logger.info("Added 'machine_id' column to pinned_sessions")
        except Exception as e:
            logger.error(f"Migration error: {e}")

    def _migrate_from_json(self):
        """从 JSON 文件迁移数据"""
        json_path = os.path.expanduser("~/.claude-remote/session_names.json")
        if not os.path.exists(json_path):
            return

        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            if not data:
                return

            migrated = 0
            with self._lock:
                with self._get_conn() as conn:
                    cursor = conn.cursor()
                    for session_id, name in data.items():
                        cursor.execute("""
                            INSERT OR IGNORE INTO session_names (session_id, name)
                            VALUES (?, ?)
                        """, (session_id, name))
                        if cursor.rowcount > 0:
                            migrated += 1

            if migrated > 0:
                logger.info(f"Migrated {migrated} session names from JSON")
                # 备份并删除旧文件
                backup_path = json_path + ".bak"
                os.rename(json_path, backup_path)
                logger.info(f"JSON file backed up to {backup_path}")

        except Exception as e:
            logger.error(f"Migration error: {e}")

    # ==================== 会话命名 ====================

    def get_session_name(self, session_id: str) -> Optional[str]:
        """获取会话名称"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT name FROM session_names WHERE session_id = ?",
                    (session_id,)
                )
                row = cursor.fetchone()
                return row["name"] if row else None

    def set_session_name(self, session_id: str, name: str):
        """设置会话名称"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO session_names (session_id, name, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(session_id) DO UPDATE SET
                        name = excluded.name,
                        updated_at = CURRENT_TIMESTAMP
                """, (session_id, name))
        logger.info(f"Set name for session {session_id[:8]}...: {name}")

    def delete_session_name(self, session_id: str):
        """删除会话名称"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "DELETE FROM session_names WHERE session_id = ?",
                    (session_id,)
                )
                if cursor.rowcount > 0:
                    logger.info(f"Deleted name for session {session_id[:8]}...")

    def get_all_session_names(self) -> Dict[str, str]:
        """获取所有会话名称"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT session_id, name FROM session_names")
                return {row["session_id"]: row["name"] for row in cursor.fetchall()}

    # ==================== IP 黑名单 ====================

    def is_ip_blocked(self, ip: str) -> bool:
        """检查 IP 是否被封禁"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT 1 FROM ip_blacklist WHERE ip = ?",
                    (ip,)
                )
                return cursor.fetchone() is not None

    def block_ip(self, ip: str, reason: str, total_attempts: int = 0):
        """封禁 IP"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO ip_blacklist (ip, reason, total_attempts)
                    VALUES (?, ?, ?)
                    ON CONFLICT(ip) DO UPDATE SET
                        reason = excluded.reason,
                        total_attempts = excluded.total_attempts,
                        blocked_at = CURRENT_TIMESTAMP
                """, (ip, reason, total_attempts))
        logger.warning(f"IP blocked: {ip}, reason: {reason}")

    def unblock_ip(self, ip: str) -> bool:
        """解封 IP"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM ip_blacklist WHERE ip = ?", (ip,))
                if cursor.rowcount > 0:
                    logger.info(f"IP unblocked: {ip}")
                    return True
                return False

    def get_all_blocked_ips(self) -> List[Dict[str, Any]]:
        """获取所有被封禁的 IP"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT ip, reason, total_attempts, blocked_at
                    FROM ip_blacklist
                    ORDER BY blocked_at DESC
                """)
                return [dict(row) for row in cursor.fetchall()]

    # ==================== 登录记录 ====================

    def record_login_attempt(self, ip: str, success: bool):
        """记录登录尝试"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO login_attempts (ip, success)
                    VALUES (?, ?)
                """, (ip, 1 if success else 0))

                if success:
                    # 更新成功登录 IP 记录
                    cursor.execute("""
                        INSERT INTO login_success_ips (ip, last_login, login_count)
                        VALUES (?, CURRENT_TIMESTAMP, 1)
                        ON CONFLICT(ip) DO UPDATE SET
                            last_login = CURRENT_TIMESTAMP,
                            login_count = login_count + 1
                    """, (ip,))

    def get_recent_fail_count(self, ip: str, minutes: int) -> int:
        """获取指定时间内的失败次数"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT COUNT(*) as cnt FROM login_attempts
                    WHERE ip = ? AND success = 0
                    AND attempted_at > datetime('now', ?)
                """, (ip, f"-{minutes} minutes"))
                row = cursor.fetchone()
                return row["cnt"] if row else 0

    def get_total_fail_count(self, ip: str, hours: int) -> int:
        """获取指定小时内的总失败次数"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT COUNT(*) as cnt FROM login_attempts
                    WHERE ip = ? AND success = 0
                    AND attempted_at > datetime('now', ?)
                """, (ip, f"-{hours} hours"))
                row = cursor.fetchone()
                return row["cnt"] if row else 0

    def get_recent_success_ip_count(self, hours: int = 1) -> int:
        """获取最近成功登录的不同 IP 数量"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT COUNT(DISTINCT ip) as cnt FROM login_success_ips
                    WHERE last_login > datetime('now', ?)
                """, (f"-{hours} hours",))
                row = cursor.fetchone()
                return row["cnt"] if row else 0

    def clear_login_attempts(self, ip: str = None):
        """清除登录记录"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                if ip:
                    cursor.execute("DELETE FROM login_attempts WHERE ip = ?", (ip,))
                else:
                    cursor.execute("DELETE FROM login_attempts")

    # ==================== 安全状态 ====================

    def get_security_state(self, key: str) -> Optional[str]:
        """获取安全状态"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT value FROM security_state WHERE key = ?",
                    (key,)
                )
                row = cursor.fetchone()
                return row["value"] if row else None

    def set_security_state(self, key: str, value: str):
        """设置安全状态"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO security_state (key, value, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        updated_at = CURRENT_TIMESTAMP
                """, (key, value))

    def is_emergency_locked(self) -> bool:
        """检查是否处于紧急锁定状态"""
        return self.get_security_state("emergency_lock") == "1"

    def set_emergency_lock(self, locked: bool):
        """设置紧急锁定状态"""
        self.set_security_state("emergency_lock", "1" if locked else "0")
        if locked:
            logger.critical("EMERGENCY LOCK ACTIVATED - All connections refused!")
        else:
            logger.info("Emergency lock released")

    # ==================== 上传历史 ====================

    def record_upload(
        self,
        filename: str,
        path: str,
        size: int,
        status: str = "success",
        duration: float = 0,
        error: str = None
    ) -> int:
        """记录上传历史，返回记录ID"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO upload_history (filename, path, size, status, duration, error)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (filename, path, size, status, duration, error))
                return cursor.lastrowid

    def update_upload(
        self,
        upload_id: int,
        size: int = None,
        status: str = None,
        duration: float = None,
        error: str = None
    ):
        """更新上传记录"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                updates = []
                params = []
                if size is not None:
                    updates.append("size = ?")
                    params.append(size)
                if status is not None:
                    updates.append("status = ?")
                    params.append(status)
                if duration is not None:
                    updates.append("duration = ?")
                    params.append(duration)
                if error is not None:
                    updates.append("error = ?")
                    params.append(error)
                if updates:
                    params.append(upload_id)
                    cursor.execute(f"""
                        UPDATE upload_history SET {', '.join(updates)} WHERE id = ?
                    """, params)

    def get_upload_history(self, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        """获取上传历史"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT id, filename, path, size, status, duration, error, created_at
                    FROM upload_history
                    ORDER BY created_at DESC
                    LIMIT ? OFFSET ?
                """, (limit, offset))
                return [dict(row) for row in cursor.fetchall()]

    # ==================== 下载历史 ====================

    def record_download(
        self,
        filename: str,
        path: str,
        size: int,
        status: str = "success",
        duration: float = 0,
        error: str = None
    ):
        """记录下载历史"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO download_history (filename, path, size, status, duration, error)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (filename, path, size, status, duration, error))

    def get_download_history(self, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        """获取下载历史"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT id, filename, path, size, status, duration, error, created_at
                    FROM download_history
                    ORDER BY created_at DESC
                    LIMIT ? OFFSET ?
                """, (limit, offset))
                return [dict(row) for row in cursor.fetchall()]

    # ==================== 终端历史 ====================

    def record_terminal_io(
        self,
        session_id: str,
        direction: str,
        raw_content: bytes,
        text_content: str
    ):
        """记录终端输入/输出"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO terminal_history (session_id, direction, raw_content, text_content)
                    VALUES (?, ?, ?, ?)
                """, (session_id, direction, raw_content, text_content))

    def get_terminal_history(
        self,
        session_id: str = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """获取终端历史

        Args:
            session_id: 会话ID，为空则获取所有
            limit: 返回数量限制
            offset: 偏移量（分页用）
        """
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                if session_id:
                    cursor.execute("""
                        SELECT id, session_id, direction, text_content, created_at
                        FROM terminal_history
                        WHERE session_id = ?
                        ORDER BY created_at DESC
                        LIMIT ? OFFSET ?
                    """, (session_id, limit, offset))
                else:
                    cursor.execute("""
                        SELECT id, session_id, direction, text_content, created_at
                        FROM terminal_history
                        ORDER BY created_at DESC
                        LIMIT ? OFFSET ?
                    """, (limit, offset))
                return [dict(row) for row in cursor.fetchall()]

    def get_terminal_sessions(self) -> List[Dict[str, Any]]:
        """获取有历史记录的会话列表"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT session_id,
                           COUNT(*) as message_count,
                           MAX(created_at) as last_activity
                    FROM terminal_history
                    GROUP BY session_id
                    ORDER BY last_activity DESC
                """)
                return [dict(row) for row in cursor.fetchall()]

    # ==================== 置顶会话 ====================

    def get_pinned_sessions(self) -> List[Dict[str, Any]]:
        """获取所有置顶会话，按位置排序"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT id, session_id, working_dir, display_name, position,
                           type, machine_id, created_at
                    FROM pinned_sessions
                    ORDER BY position ASC
                """)
                return [dict(row) for row in cursor.fetchall()]

    def add_pinned_session(self, session_id: str, working_dir: str,
                           display_name: str = None) -> Optional[int]:
        """添加置顶会话，返回新记录ID"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                # 获取最大位置
                cursor.execute("SELECT MAX(position) FROM pinned_sessions")
                max_pos = cursor.fetchone()[0] or 0
                try:
                    cursor.execute("""
                        INSERT INTO pinned_sessions (session_id, working_dir, display_name, position)
                        VALUES (?, ?, ?, ?)
                    """, (session_id, working_dir, display_name, max_pos + 1))
                    return cursor.lastrowid
                except sqlite3.IntegrityError:
                    # 已存在
                    return None

    def remove_pinned_session(self, session_id: str) -> bool:
        """移除置顶会话"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    DELETE FROM pinned_sessions WHERE session_id = ?
                """, (session_id,))
                return cursor.rowcount > 0

    def update_pinned_positions(self, positions: List[Dict[str, Any]]) -> bool:
        """批量更新置顶会话位置
        positions: [{"session_id": "xxx", "position": 1}, ...]
        """
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                for item in positions:
                    cursor.execute("""
                        UPDATE pinned_sessions
                        SET position = ?
                        WHERE session_id = ?
                    """, (item['position'], item['session_id']))
                return True

    def is_session_pinned(self, session_id: str) -> bool:
        """检查会话是否已置顶"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT 1 FROM pinned_sessions WHERE session_id = ?
                """, (session_id,))
                return cursor.fetchone() is not None

    def add_ssh_pinned_session(self, machine_id: int,
                               machine_name: str) -> Optional[int]:
        """添加 SSH 置顶会话，返回新记录ID"""
        # SSH 会话使用特殊的 session_id 格式
        session_id = f"ssh_{machine_id}"

        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                # 获取最大位置
                cursor.execute("SELECT MAX(position) FROM pinned_sessions")
                max_pos = cursor.fetchone()[0] or 0
                try:
                    cursor.execute("""
                        INSERT INTO pinned_sessions
                        (session_id, working_dir, display_name, position, type, machine_id)
                        VALUES (?, ?, ?, ?, ?, ?)
                    """, (session_id, "", machine_name, max_pos + 1, "ssh", machine_id))
                    logger.info(f"Pinned SSH session: {machine_name} (machine_id={machine_id})")
                    return cursor.lastrowid
                except sqlite3.IntegrityError:
                    # 已存在
                    return None

    def is_ssh_session_pinned(self, machine_id: int) -> bool:
        """检查 SSH 会话是否已置顶"""
        session_id = f"ssh_{machine_id}"
        return self.is_session_pinned(session_id)

    # ==================== 远程机器管理 ====================

    def get_remote_machines(self) -> List[Dict[str, Any]]:
        """获取所有远程机器列表"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT id, name, host, port, username, auth_type, created_at, updated_at
                    FROM remote_machines
                    ORDER BY created_at DESC
                """)
                return [dict(row) for row in cursor.fetchall()]

    def get_remote_machine(self, machine_id: int) -> Optional[Dict[str, Any]]:
        """获取单个远程机器（包含密码）"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT id, name, host, port, username, password, auth_type,
                           created_at, updated_at
                    FROM remote_machines
                    WHERE id = ?
                """, (machine_id,))
                row = cursor.fetchone()
                return dict(row) if row else None

    def _encrypt_password(self, password: str) -> str:
        """使用 AUTH_TOKEN 加密密码"""
        import base64
        import hashlib
        from app.core.config import settings

        if not password:
            return ""

        # 从 AUTH_TOKEN 派生密钥
        key = hashlib.sha256(settings.AUTH_TOKEN.encode()).digest()

        # XOR 加密
        password_bytes = password.encode('utf-8')
        encrypted = bytes(b ^ key[i % len(key)] for i, b in enumerate(password_bytes))

        # Base64 编码
        return base64.b64encode(encrypted).decode()

    def _decrypt_password(self, encrypted: str) -> str:
        """使用 AUTH_TOKEN 解密密码"""
        import base64
        import hashlib
        from app.core.config import settings

        if not encrypted:
            return ""

        try:
            # 从 AUTH_TOKEN 派生密钥
            key = hashlib.sha256(settings.AUTH_TOKEN.encode()).digest()

            # Base64 解码
            encrypted_bytes = base64.b64decode(encrypted)

            # XOR 解密（XOR 是对称的）
            decrypted = bytes(b ^ key[i % len(key)] for i, b in enumerate(encrypted_bytes))

            return decrypted.decode('utf-8')
        except Exception as e:
            logger.error(f"Decrypt password error: {e}")
            return ""

    def add_remote_machine(
        self,
        name: str,
        host: str,
        port: int,
        username: str,
        password: str,
        auth_type: str = "password"
    ) -> int:
        """添加远程机器，返回新记录ID"""
        # 使用 AUTH_TOKEN 加密密码
        encoded_password = self._encrypt_password(password) if password else None
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO remote_machines (name, host, port, username, password, auth_type)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (name, host, port, username, encoded_password, auth_type))
                logger.info(f"Added remote machine: {name} ({username}@{host}:{port})")
                return cursor.lastrowid

    def update_remote_machine(
        self,
        machine_id: int,
        name: str = None,
        host: str = None,
        port: int = None,
        username: str = None,
        password: str = None,
        auth_type: str = None
    ) -> bool:
        """更新远程机器信息"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                updates = ["updated_at = CURRENT_TIMESTAMP"]
                params = []
                if name is not None:
                    updates.append("name = ?")
                    params.append(name)
                if host is not None:
                    updates.append("host = ?")
                    params.append(host)
                if port is not None:
                    updates.append("port = ?")
                    params.append(port)
                if username is not None:
                    updates.append("username = ?")
                    params.append(username)
                if password is not None:
                    # 使用 AUTH_TOKEN 加密密码
                    encoded = self._encrypt_password(password)
                    updates.append("password = ?")
                    params.append(encoded)
                if auth_type is not None:
                    updates.append("auth_type = ?")
                    params.append(auth_type)

                params.append(machine_id)
                cursor.execute(f"""
                    UPDATE remote_machines SET {', '.join(updates)} WHERE id = ?
                """, params)
                if cursor.rowcount > 0:
                    logger.info(f"Updated remote machine id={machine_id}")
                    return True
                return False

    def delete_remote_machine(self, machine_id: int) -> bool:
        """删除远程机器"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "DELETE FROM remote_machines WHERE id = ?",
                    (machine_id,)
                )
                if cursor.rowcount > 0:
                    logger.info(f"Deleted remote machine id={machine_id}")
                    return True
                return False

    def get_remote_machine_password(self, machine_id: int) -> Optional[str]:
        """获取远程机器密码（解密后）"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT password FROM remote_machines WHERE id = ?",
                    (machine_id,)
                )
                row = cursor.fetchone()
                if row and row["password"]:
                    return self._decrypt_password(row["password"])
                return None

    def reencrypt_all_passwords(self, old_token: str, new_token: str) -> int:
        """当 AUTH_TOKEN 变更时，重新加密所有密码

        Args:
            old_token: 旧的 AUTH_TOKEN
            new_token: 新的 AUTH_TOKEN

        Returns:
            重新加密的密码数量
        """
        import base64
        import hashlib

        # 派生旧密钥
        old_key = hashlib.sha256(old_token.encode()).digest()
        # 派生新密钥
        new_key = hashlib.sha256(new_token.encode()).digest()

        count = 0
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT id, password FROM remote_machines WHERE password IS NOT NULL AND password != ''")
                rows = cursor.fetchall()

                for row in rows:
                    machine_id = row["id"]
                    encrypted = row["password"]

                    try:
                        # 用旧密钥解密
                        encrypted_bytes = base64.b64decode(encrypted)
                        decrypted = bytes(b ^ old_key[i % len(old_key)] for i, b in enumerate(encrypted_bytes))
                        password = decrypted.decode('utf-8')

                        # 用新密钥加密
                        password_bytes = password.encode('utf-8')
                        new_encrypted = bytes(b ^ new_key[i % len(new_key)] for i, b in enumerate(password_bytes))
                        new_encoded = base64.b64encode(new_encrypted).decode()

                        # 更新数据库
                        cursor.execute(
                            "UPDATE remote_machines SET password = ? WHERE id = ?",
                            (new_encoded, machine_id)
                        )
                        count += 1
                    except Exception as e:
                        logger.error(f"Reencrypt password for machine {machine_id} failed: {e}")

        logger.info(f"Reencrypted {count} passwords")
        return count

    # ==================== 清理 ====================

    def cleanup_old_records(self, days: int = 30):
        """清理旧的登录记录"""
        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    DELETE FROM login_attempts
                    WHERE attempted_at < datetime('now', ?)
                """, (f"-{days} days",))
                if cursor.rowcount > 0:
                    logger.info(f"Cleaned up {cursor.rowcount} old login records")


# 全局实例
db = Database()
