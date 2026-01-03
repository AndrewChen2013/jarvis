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
import subprocess
from pathlib import Path
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, Query

from app.api.auth import verify_token
from app.services.terminal_manager import terminal_manager
from app.services.anthropic_oauth import anthropic_oauth
from app.core.logging import logger

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/system/info")
async def get_system_info(_: str = Depends(verify_token)):
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


@router.get("/connections/count")
async def get_connections_count(_: str = Depends(verify_token)):
    """获取活跃连接数"""
    try:
        stats = terminal_manager.get_stats()
        total = sum(t.get("websocket_count", 0) for t in stats.get("terminals", []))
        return {
            "total_connections": total,
            "active_terminals": stats.get("active_terminals", 0)
        }
    except Exception as e:
        logger.error(f"Get connections count error: {e}")
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


@router.get("/usage/realtime")
async def get_usage_realtime(_: str = Depends(verify_token)):
    """获取实时用量（来自 Anthropic 服务器）

    返回 5 小时周期、7 天周期等真实用量数据
    """
    try:
        usage = anthropic_oauth.get_usage()
        if not usage:
            raise HTTPException(status_code=503, detail="Unable to fetch usage from Anthropic API")

        # 格式化返回数据
        result = {
            "five_hour": None,
            "seven_day": None,
            "seven_day_sonnet": None,
            "extra_usage": None
        }

        if usage.get("five_hour"):
            result["five_hour"] = {
                "utilization": usage["five_hour"].get("utilization", 0),
                "resets_at": usage["five_hour"].get("resets_at")
            }

        if usage.get("seven_day"):
            result["seven_day"] = {
                "utilization": usage["seven_day"].get("utilization", 0),
                "resets_at": usage["seven_day"].get("resets_at")
            }

        if usage.get("seven_day_sonnet"):
            result["seven_day_sonnet"] = {
                "utilization": usage["seven_day_sonnet"].get("utilization", 0),
                "resets_at": usage["seven_day_sonnet"].get("resets_at")
            }

        if usage.get("extra_usage"):
            result["extra_usage"] = usage["extra_usage"]

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get realtime usage error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/profile")
async def get_profile(_: str = Depends(verify_token)):
    """获取用户资料（来自 Anthropic 服务器）"""
    try:
        profile = anthropic_oauth.get_profile()
        if not profile:
            raise HTTPException(status_code=503, detail="Unable to fetch profile from Anthropic API")

        account = profile.get("account", {})
        org = profile.get("organization", {})

        # 解析套餐信息
        plan_name = "Unknown"
        rate_limit_tier = org.get("rate_limit_tier", "")
        if "max_20x" in rate_limit_tier:
            plan_name = "Max 20x"
        elif "max_5x" in rate_limit_tier:
            plan_name = "Max 5x"
        elif account.get("has_claude_pro"):
            plan_name = "Pro"
        elif account.get("has_claude_max"):
            plan_name = "Max"

        return {
            "user": {
                "uuid": account.get("uuid"),
                "name": account.get("display_name") or account.get("full_name"),
                "email": account.get("email"),
                "has_max": account.get("has_claude_max", False),
                "has_pro": account.get("has_claude_pro", False)
            },
            "organization": {
                "uuid": org.get("uuid"),
                "name": org.get("name"),
                "type": org.get("organization_type"),
                "rate_limit_tier": rate_limit_tier,
                "extra_usage_enabled": org.get("has_extra_usage_enabled", False)
            },
            "plan_name": plan_name
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get profile error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/git/branch")
async def get_git_branch(
    path: str = Query(..., description="工作目录路径"),
    _: str = Depends(verify_token)
):
    """获取指定目录的 git 分支名"""
    try:
        # 检查目录是否存在
        if not Path(path).is_dir():
            return {"branch": None}

        # 执行 git rev-parse 获取当前分支
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=path,
            capture_output=True,
            text=True,
            timeout=5
        )

        if result.returncode == 0:
            branch = result.stdout.strip()
            return {"branch": branch if branch else None}
        else:
            return {"branch": None}

    except subprocess.TimeoutExpired:
        return {"branch": None}
    except Exception as e:
        logger.error(f"Get git branch error: {e}")
        return {"branch": None}


# /api/context 已废弃，请使用 /api/projects/session/{session_id} 获取 context 信息
