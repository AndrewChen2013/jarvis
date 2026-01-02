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
安全防护模块

提供 IP 封禁、登录限制、紧急锁定等安全功能。

规则：
- 5 分钟内失败 20 次 -> 永久封禁该 IP
- 24 小时内失败 50 次 -> 永久封禁该 IP
- 同时 ≥10 个不同 IP 登录成功 -> 触发紧急锁定，拒绝所有连接

紧急锁定只能通过本地脚本解除，不提供网络接口。

注意：登录尝试记录存放在内存中，避免暴力攻击时频繁写数据库。
只有封禁记录和紧急锁定状态才写入数据库（持久化）。
"""
import time
from collections import defaultdict
from typing import Tuple, List, Dict
from threading import Lock

from app.services.database import db
from app.core.logging import logger


# 安全规则配置
SHORT_TERM_MINUTES = 5       # 短期窗口：5 分钟
SHORT_TERM_LIMIT = 20        # 短期失败上限：20 次

LONG_TERM_HOURS = 24         # 长期窗口：24 小时
LONG_TERM_LIMIT = 50         # 长期失败上限：50 次

MAX_CONCURRENT_IPS = 10      # 最大并发登录 IP 数
CONCURRENT_CHECK_HOURS = 1   # 并发检查窗口：1 小时

# 内存清理配置
CLEANUP_INTERVAL = 300       # 清理间隔：5 分钟


class SecurityGuard:
    """安全防护守卫

    登录尝试记录存放在内存中，避免暴力攻击时频繁写数据库。
    只有封禁记录和紧急锁定状态才写入数据库。
    """

    def __init__(self):
        # 内存存储：IP -> 失败时间戳列表
        self._fail_attempts: Dict[str, List[float]] = defaultdict(list)
        # 内存存储：成功登录的 IP -> 最后成功时间
        self._success_ips: Dict[str, float] = {}
        # 线程锁
        self._lock = Lock()
        # 上次清理时间
        self._last_cleanup = time.time()

    def _cleanup_old_records(self):
        """清理过期的内存记录"""
        now = time.time()
        if now - self._last_cleanup < CLEANUP_INTERVAL:
            return

        with self._lock:
            self._last_cleanup = now

            # 清理超过 24 小时的失败记录
            cutoff_long = now - (LONG_TERM_HOURS * 3600)
            for ip in list(self._fail_attempts.keys()):
                self._fail_attempts[ip] = [
                    t for t in self._fail_attempts[ip] if t > cutoff_long
                ]
                if not self._fail_attempts[ip]:
                    del self._fail_attempts[ip]

            # 清理超过 1 小时的成功记录
            cutoff_success = now - (CONCURRENT_CHECK_HOURS * 3600)
            for ip in list(self._success_ips.keys()):
                if self._success_ips[ip] < cutoff_success:
                    del self._success_ips[ip]

    def check_request(self, ip: str) -> Tuple[bool, str]:
        """检查请求是否允许

        Args:
            ip: 客户端 IP 地址

        Returns:
            (allowed, reason): 是否允许访问，拒绝原因
        """
        # 1. 检查紧急锁定（从数据库读取，持久化状态）
        if db.is_emergency_locked():
            return False, "Service is in emergency lockdown"

        # 2. 检查 IP 黑名单（从数据库读取，持久化状态）
        if db.is_ip_blocked(ip):
            return False, "IP is blocked"

        return True, ""

    def record_login_attempt(self, ip: str, success: bool) -> Tuple[bool, str]:
        """记录登录尝试并检查是否需要封禁

        Args:
            ip: 客户端 IP
            success: 是否登录成功

        Returns:
            (should_block, reason): 是否应该阻止后续请求
        """
        now = time.time()

        # 定期清理过期记录
        self._cleanup_old_records()

        if success:
            with self._lock:
                self._success_ips[ip] = now
                concurrent_ips = len(self._success_ips)

            # 检查是否触发紧急锁定
            if concurrent_ips >= MAX_CONCURRENT_IPS:
                db.set_emergency_lock(True)
                logger.critical(
                    f"EMERGENCY LOCK: {concurrent_ips} different IPs logged in "
                    f"within {CONCURRENT_CHECK_HOURS} hour(s)"
                )
                return True, "Emergency lockdown triggered"
            return False, ""

        # 登录失败，记录到内存
        with self._lock:
            self._fail_attempts[ip].append(now)

            # 短期检查：5 分钟内的失败次数
            cutoff_short = now - (SHORT_TERM_MINUTES * 60)
            short_term_fails = sum(1 for t in self._fail_attempts[ip] if t > cutoff_short)

            # 长期检查：24 小时内的失败次数
            long_term_fails = len(self._fail_attempts[ip])

        # 检查是否需要封禁
        if short_term_fails >= SHORT_TERM_LIMIT:
            reason = f"Too many failures: {short_term_fails} in {SHORT_TERM_MINUTES} minutes"
            db.block_ip(ip, reason, short_term_fails)
            return True, reason

        if long_term_fails >= LONG_TERM_LIMIT:
            reason = f"Too many failures: {long_term_fails} in {LONG_TERM_HOURS} hours"
            db.block_ip(ip, reason, long_term_fails)
            return True, reason

        return False, ""

    def get_fail_count(self, ip: str) -> Tuple[int, int]:
        """获取 IP 的失败次数（短期, 长期）"""
        now = time.time()
        with self._lock:
            attempts = self._fail_attempts.get(ip, [])
            cutoff_short = now - (SHORT_TERM_MINUTES * 60)
            short_term = sum(1 for t in attempts if t > cutoff_short)
            long_term = len(attempts)
        return short_term, long_term

    def get_status(self) -> dict:
        """获取安全状态"""
        with self._lock:
            return {
                "emergency_locked": db.is_emergency_locked(),
                "blocked_ips": db.get_all_blocked_ips(),
                "recent_success_ips": len(self._success_ips),
                "tracked_ips": len(self._fail_attempts),
            }


# 全局实例
security_guard = SecurityGuard()
