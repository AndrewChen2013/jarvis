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
系统信息 API

提供系统信息、用量统计等接口。
"""
import socket
import json
import getpass
from pathlib import Path
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, Query

from app.api.auth import verify_token
from app.services.usage_tracker import usage_tracker
from app.services.terminal_manager import terminal_manager
from app.core.logging import logger

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/system/info")
async def get_system_info():
    """获取系统信息（IP、主机名、用户主目录）"""
    try:
        hostname = socket.gethostname()

        # 获取本机 IP
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()

        home_dir = str(Path.home())
        username = getpass.getuser()

        return {
            "ip": ip,
            "hostname": hostname,
            "username": username,
            "home_dir": home_dir
        }
    except Exception:
        return {
            "ip": "127.0.0.1",
            "hostname": "localhost",
            "username": "user",
            "home_dir": "~"
        }


@router.get("/active-sessions")
async def get_active_sessions(_: str = Depends(verify_token)):
    """获取当前活跃的终端连接"""
    try:
        return terminal_manager.get_active_sessions()
    except Exception as e:
        logger.error(f"Get active sessions error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/usage/summary")
async def get_usage_summary(_: str = Depends(verify_token)):
    """获取 Claude Code 用量摘要"""
    try:
        summary = usage_tracker.to_dict()
        return summary
    except Exception as e:
        logger.error(f"Get usage summary error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/usage/history")
async def get_usage_history(
    days: int = Query(default=7, ge=1, le=30, description="历史天数"),
    _: str = Depends(verify_token)
):
    """获取历史用量趋势"""
    try:
        history = usage_tracker.calculate_daily_history(days=days)
        return {"history": history, "days": days}
    except Exception as e:
        logger.error(f"Get usage history error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/terminals/stats")
async def get_terminals_stats(_: str = Depends(verify_token)):
    """获取终端统计信息"""
    try:
        return terminal_manager.get_stats()
    except Exception as e:
        logger.error(f"Get terminals stats error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/account/info")
async def get_account_info(_: str = Depends(verify_token)):
    """获取 Claude 账户信息"""
    try:
        credentials_path = Path.home() / ".claude" / ".credentials.json"
        account_info = {
            "subscription_type": None,
            "rate_limit_tier": None,
            "plan_name": None,
            "token_limit_per_5h": None,
            "token_expires_at": None,
            "scopes": [],
        }

        if credentials_path.exists():
            with open(credentials_path, 'r') as f:
                creds = json.load(f)
                oauth = creds.get("claudeAiOauth", {})

                subscription_type = oauth.get("subscriptionType", "unknown")
                rate_limit_tier = oauth.get("rateLimitTier", "")

                plan_name = "Unknown"
                token_limit = 0
                if "max_5x" in rate_limit_tier:
                    plan_name = "Max 5x"
                    token_limit = 88000
                elif "max_20x" in rate_limit_tier:
                    plan_name = "Max 20x"
                    token_limit = 220000
                elif subscription_type == "pro":
                    plan_name = "Pro"
                    token_limit = 19000

                expires_at = oauth.get("expiresAt")
                expires_at_str = None
                if expires_at:
                    expires_at_str = datetime.fromtimestamp(expires_at / 1000).isoformat()

                account_info = {
                    "subscription_type": subscription_type,
                    "rate_limit_tier": rate_limit_tier,
                    "plan_name": plan_name,
                    "token_limit_per_5h": token_limit,
                    "token_expires_at": expires_at_str,
                    "scopes": oauth.get("scopes", []),
                }

        stats_path = Path.home() / ".claude" / "stats-cache.json"
        if stats_path.exists():
            with open(stats_path, 'r') as f:
                stats = json.load(f)
                account_info["stats"] = {
                    "total_sessions": stats.get("totalSessions", 0),
                    "total_messages": stats.get("totalMessages", 0),
                    "first_session_date": stats.get("firstSessionDate"),
                    "model_usage": stats.get("modelUsage", {}),
                }

        return account_info

    except Exception as e:
        logger.error(f"Get account info error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
