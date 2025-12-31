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
Claude Code 用量统计服务
解析 ~/.claude/projects 下的 JSONL 文件，统计 token 用量
"""
import os
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict

from app.core.logging import logger


@dataclass
class UsageSummary:
    """用量摘要"""
    # 当前 5 小时周期
    current_period_input: int = 0
    current_period_output: int = 0
    current_period_total: int = 0
    period_start: Optional[str] = None
    period_end: Optional[str] = None

    # 今日用量
    today_input: int = 0
    today_output: int = 0
    today_total: int = 0

    # 本月用量
    month_input: int = 0
    month_output: int = 0
    month_total: int = 0

    # 限额和百分比 (基于 Max5 套餐 88k tokens/5h)
    period_limit: int = 88000
    period_percentage: float = 0.0

    # 统计信息
    sessions_count: int = 0
    last_updated: Optional[str] = None


class UsageTracker:
    """用量追踪器"""

    CLAUDE_PROJECTS_DIR = Path.home() / ".claude" / "projects"

    # 套餐限额 (每 5 小时)
    PLAN_LIMITS = {
        "pro": 19000,
        "max5": 88000,
        "max20": 220000,
    }

    def __init__(self, plan: str = "max5"):
        self.plan = plan
        self.period_limit = self.PLAN_LIMITS.get(plan, 88000)

    def get_period_bounds(self, now: datetime = None) -> tuple[datetime, datetime]:
        """获取当前 5 小时周期的边界

        Claude 的计费周期从每天 0:00 UTC 开始，每 5 小时一个周期
        """
        if now is None:
            now = datetime.utcnow()

        # 计算今天开始以来的小时数
        hours_since_midnight = now.hour
        # 计算当前在第几个 5 小时周期
        period_index = hours_since_midnight // 5

        # 周期开始和结束时间
        period_start = now.replace(hour=period_index * 5, minute=0, second=0, microsecond=0)
        period_end = period_start + timedelta(hours=5)

        return period_start, period_end

    def parse_jsonl_file(self, filepath: Path) -> List[Dict]:
        """解析单个 JSONL 文件"""
        records = []
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            data = json.loads(line)
                            # 只提取 assistant 消息（包含 usage 信息）
                            if data.get('type') == 'assistant' and 'message' in data:
                                msg = data['message']
                                if 'usage' in msg:
                                    records.append({
                                        'timestamp': data.get('timestamp'),
                                        'model': msg.get('model'),
                                        'input_tokens': msg['usage'].get('input_tokens', 0),
                                        'output_tokens': msg['usage'].get('output_tokens', 0),
                                        'cache_read': msg['usage'].get('cache_read_input_tokens', 0),
                                        'cache_creation': msg['usage'].get('cache_creation_input_tokens', 0),
                                    })
                        except json.JSONDecodeError:
                            continue
        except Exception as e:
            logger.warning(f"Error parsing {filepath}: {e}")

        return records

    def collect_all_records(self, since: datetime = None) -> List[Dict]:
        """收集所有项目的用量记录"""
        if not self.CLAUDE_PROJECTS_DIR.exists():
            logger.warning(f"Claude projects directory not found: {self.CLAUDE_PROJECTS_DIR}")
            return []

        all_records = []

        # 遍历所有项目目录
        for project_dir in self.CLAUDE_PROJECTS_DIR.iterdir():
            if not project_dir.is_dir():
                continue

            # 遍历项目下的所有 JSONL 文件
            for jsonl_file in project_dir.glob("*.jsonl"):
                # 可选：根据文件修改时间过滤
                if since:
                    mtime = datetime.fromtimestamp(jsonl_file.stat().st_mtime)
                    if mtime < since:
                        continue

                records = self.parse_jsonl_file(jsonl_file)
                all_records.extend(records)

        return all_records

    def calculate_summary(self) -> UsageSummary:
        """计算用量摘要"""
        now = datetime.utcnow()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        period_start, period_end = self.get_period_bounds(now)

        # 只获取本月的记录（优化性能）
        records = self.collect_all_records(since=month_start - timedelta(days=1))

        summary = UsageSummary(
            period_limit=self.period_limit,
            period_start=period_start.isoformat() + 'Z',
            period_end=period_end.isoformat() + 'Z',
            last_updated=now.isoformat() + 'Z',
        )

        sessions = set()

        for record in records:
            try:
                ts_str = record.get('timestamp')
                if not ts_str:
                    continue

                # 解析时间戳
                ts = datetime.fromisoformat(ts_str.replace('Z', '+00:00')).replace(tzinfo=None)

                input_tokens = record.get('input_tokens', 0) or 0
                output_tokens = record.get('output_tokens', 0) or 0
                total = input_tokens + output_tokens

                # 当前 5 小时周期
                if period_start <= ts < period_end:
                    summary.current_period_input += input_tokens
                    summary.current_period_output += output_tokens
                    summary.current_period_total += total

                # 今日
                if ts >= today_start:
                    summary.today_input += input_tokens
                    summary.today_output += output_tokens
                    summary.today_total += total

                # 本月
                if ts >= month_start:
                    summary.month_input += input_tokens
                    summary.month_output += output_tokens
                    summary.month_total += total

            except Exception as e:
                logger.debug(f"Error processing record: {e}")
                continue

        # 计算周期使用百分比
        if summary.period_limit > 0:
            summary.period_percentage = round(
                (summary.current_period_total / summary.period_limit) * 100, 1
            )

        summary.sessions_count = len(sessions)

        return summary

    def to_dict(self) -> Dict:
        """返回用量摘要字典"""
        summary = self.calculate_summary()
        return asdict(summary)

    def calculate_daily_history(self, days: int = 7) -> List[Dict]:
        """计算过去 N 天的每日用量"""
        now = datetime.utcnow()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

        # 获取过去 N 天的记录
        start_date = today_start - timedelta(days=days)
        records = self.collect_all_records(since=start_date - timedelta(days=1))

        # 初始化每日统计
        daily_stats = {}
        for i in range(days + 1):  # 包含今天
            date = (today_start - timedelta(days=days - i)).strftime('%Y-%m-%d')
            daily_stats[date] = {
                'date': date,
                'input_tokens': 0,
                'output_tokens': 0,
                'total_tokens': 0,
            }

        # 统计每日用量
        for record in records:
            try:
                ts_str = record.get('timestamp')
                if not ts_str:
                    continue

                ts = datetime.fromisoformat(ts_str.replace('Z', '+00:00')).replace(tzinfo=None)
                date_key = ts.strftime('%Y-%m-%d')

                if date_key in daily_stats:
                    input_tokens = record.get('input_tokens', 0) or 0
                    output_tokens = record.get('output_tokens', 0) or 0
                    daily_stats[date_key]['input_tokens'] += input_tokens
                    daily_stats[date_key]['output_tokens'] += output_tokens
                    daily_stats[date_key]['total_tokens'] += input_tokens + output_tokens
            except Exception:
                continue

        # 转换为列表并排序
        return sorted(daily_stats.values(), key=lambda x: x['date'])


# 全局实例
usage_tracker = UsageTracker(plan="max5")
