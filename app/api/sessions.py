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

from fastapi import APIRouter, HTTPException, Depends, Header, Query
from pydantic import BaseModel
from typing import List, Optional
import os
import re

from app.models.session import Session, SessionCreate, SessionUpdate
from app.services.session_manager import SessionManager
from app.core.config import settings
from app.core.logging import logger
from app.services.usage_tracker import usage_tracker


router = APIRouter(prefix="/api", tags=["sessions"])


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


def update_env_file(key: str, value: str):
    """更新 .env 文件中的配置项"""
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), '.env')

    # 读取现有内容
    lines = []
    key_found = False
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            lines = f.readlines()

    # 更新或添加配置项
    new_lines = []
    for line in lines:
        if line.strip().startswith(f'{key}='):
            new_lines.append(f'{key}={value}\n')
            key_found = True
        else:
            new_lines.append(line)

    if not key_found:
        new_lines.append(f'{key}={value}\n')

    # 写回文件
    with open(env_path, 'w') as f:
        f.writelines(new_lines)


def get_session_manager() -> SessionManager:
    """依赖注入：获取 session manager"""
    from app.main import session_manager
    return session_manager


def verify_token(authorization: Optional[str] = Header(None)):
    """验证 token"""
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")

    # 支持 "Bearer <token>" 格式
    token = authorization
    if authorization.startswith("Bearer "):
        token = authorization[7:]

    if token != settings.AUTH_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid token")

    return token


# ==================== 认证 ====================

@router.post("/auth/verify")
async def verify_auth(
    _: str = Depends(verify_token)
):
    """验证 token 是否有效

    用于前端登录验证，成功返回 200，失败返回 401
    """
    return {"valid": True}


@router.get("/system/info")
async def get_system_info():
    """获取系统信息（IP、主机名、用户主目录）"""
    import socket
    from pathlib import Path
    try:
        # 获取主机名
        hostname = socket.gethostname()
        # 创建一个 UDP socket 连接外部地址来获取本机 IP
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        # 获取用户主目录
        home_dir = str(Path.home())
        return {"ip": ip, "hostname": hostname, "home_dir": home_dir}
    except Exception:
        return {"ip": "127.0.0.1", "hostname": "localhost", "home_dir": "~"}


@router.post("/auth/change-password")
async def change_password(
    request: ChangePasswordRequest,
    _: str = Depends(verify_token)
):
    """修改密码

    验证旧密码后更新为新密码，并踢出所有现有连接
    """
    # 验证旧密码
    if request.old_password != settings.AUTH_TOKEN:
        raise HTTPException(status_code=400, detail="旧密码错误")

    # 验证新密码
    if len(request.new_password) < 6:
        raise HTTPException(status_code=400, detail="新密码至少6位")

    if request.new_password == request.old_password:
        raise HTTPException(status_code=400, detail="新密码不能与旧密码相同")

    try:
        # 更新内存中的 token
        old_token = settings.AUTH_TOKEN
        settings.AUTH_TOKEN = request.new_password

        # 更新数据库
        from app.main import db
        await db.set_config("AUTH_TOKEN", request.new_password)

        logger.info(f"Password changed successfully")

        # 踢出所有现有 WebSocket 连接
        from app.main import connection_manager
        if connection_manager:
            for session_id in list(connection_manager.active_connections.keys()):
                connections = connection_manager.active_connections.get(session_id, [])
                for ws in connections[:]:
                    try:
                        await ws.close(code=1008, reason="Password changed")
                    except Exception as e:
                        logger.warning(f"Failed to close connection: {e}")
            # 清空连接记录
            connection_manager.active_connections.clear()
            connection_manager.output_callbacks.clear()

        return {"success": True, "message": "密码修改成功，请重新登录"}

    except Exception as e:
        # 回滚
        settings.AUTH_TOKEN = old_token
        logger.error(f"Change password error: {e}")
        raise HTTPException(status_code=500, detail="修改密码失败")


# ==================== 会话管理 ====================

@router.get("/sessions", response_model=List[Session])
async def list_sessions(
    manager: SessionManager = Depends(get_session_manager),
    _: str = Depends(verify_token)
):
    """获取所有会话列表"""
    try:
        sessions = await manager.list_sessions()
        return sessions
    except Exception as e:
        logger.error(f"List sessions error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sessions", response_model=Session, status_code=201)
async def create_session(
    session_data: SessionCreate,
    manager: SessionManager = Depends(get_session_manager),
    _: str = Depends(verify_token)
):
    """创建新会话

    - working_dir: 工作目录（必填）
    - claude_session_id: 要恢复的 Claude 会话 ID（可选，为空则新建）
    - name: 会话名称（可选）
    """
    try:
        session = await manager.create_session(
            working_dir=session_data.working_dir,
            claude_session_id=session_data.claude_session_id,
            name=session_data.name
        )
        return session
    except Exception as e:
        logger.error(f"Create session error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sessions/{session_id}", response_model=Session)
async def get_session(
    session_id: str,
    manager: SessionManager = Depends(get_session_manager),
    _: str = Depends(verify_token)
):
    """获取单个会话详情"""
    try:
        session = await manager.get_session_info(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        return session
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get session error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/sessions/{session_id}", response_model=Session)
async def update_session(
    session_id: str,
    update_data: SessionUpdate,
    manager: SessionManager = Depends(get_session_manager),
    _: str = Depends(verify_token)
):
    """更新会话（目前只支持更新名称）"""
    try:
        session = await manager.get_session_info(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        if update_data.name:
            await manager.update_session_name(session_id, update_data.name)

        return await manager.get_session_info(session_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update session error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: str,
    manager: SessionManager = Depends(get_session_manager),
    _: str = Depends(verify_token)
):
    """删除会话"""
    try:
        session = await manager.get_session_info(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        await manager.delete_session(session_id)
        return None
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete session error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== Claude 会话查询 ====================

@router.get("/claude/working-dirs")
async def list_working_dirs(
    manager: SessionManager = Depends(get_session_manager),
    _: str = Depends(verify_token)
):
    """列出所有有 Claude 会话的工作目录"""
    try:
        dirs = manager.list_working_dirs()
        return {"working_dirs": dirs}
    except Exception as e:
        logger.error(f"List working dirs error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/claude/sessions")
async def list_claude_sessions(
    working_dir: str,
    manager: SessionManager = Depends(get_session_manager),
    _: str = Depends(verify_token)
):
    """列出某个工作目录下的所有 Claude 会话

    Args:
        working_dir: 工作目录路径
    """
    try:
        sessions = manager.list_claude_sessions(working_dir)
        return {"sessions": sessions}
    except Exception as e:
        logger.error(f"List claude sessions error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 会话统计 ====================

@router.get("/sessions/{session_id}/stats")
async def get_session_stats(
    session_id: str,
    manager: SessionManager = Depends(get_session_manager),
    _: str = Depends(verify_token)
):
    """获取会话统计信息"""
    try:
        process = await manager.get_session(session_id)
        if not process:
            raise HTTPException(status_code=404, detail="Session not found or not running")

        stats = process.get_stats()
        return stats
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get session stats error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 目录浏览 ====================

@router.get("/browse")
async def browse_directory(
    path: str = Query(default=None, description="目录路径，为空则返回用户主目录"),
    _: str = Depends(verify_token)
):
    """浏览目录，返回子目录列表

    Args:
        path: 目录路径，为空则返回用户主目录
    """
    try:
        # 默认用户主目录
        if not path:
            path = os.path.expanduser("~")

        # 规范化路径
        path = os.path.normpath(os.path.expanduser(path))

        # 检查路径是否存在
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="Path not found")

        if not os.path.isdir(path):
            raise HTTPException(status_code=400, detail="Path is not a directory")

        # 获取父目录
        parent = os.path.dirname(path) if path != "/" else None

        # 列出子目录
        dirs = []
        try:
            for name in sorted(os.listdir(path)):
                # 跳过隐藏文件
                if name.startswith("."):
                    continue
                full_path = os.path.join(path, name)
                if os.path.isdir(full_path):
                    dirs.append({
                        "name": name,
                        "path": full_path
                    })
        except PermissionError:
            pass  # 忽略没有权限的目录

        return {
            "current": path,
            "parent": parent,
            "dirs": dirs
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Browse directory error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 用量统计 ====================

@router.get("/usage/summary")
async def get_usage_summary(
    _: str = Depends(verify_token)
):
    """获取 Claude Code 用量摘要

    返回当前 5 小时周期、今日、本月的 token 用量统计
    """
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
    """获取历史用量趋势

    返回过去 N 天的每日 token 用量统计
    """
    try:
        history = usage_tracker.calculate_daily_history(days=days)
        return {"history": history, "days": days}
    except Exception as e:
        logger.error(f"Get usage history error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/connections/count")
async def get_connections_count(
    _: str = Depends(verify_token)
):
    """获取当前活跃连接数"""
    try:
        from app.main import connection_manager
        total_connections = 0
        sessions_with_connections = 0

        if connection_manager:
            for session_id, connections in connection_manager.active_connections.items():
                conn_count = len(connections)
                if conn_count > 0:
                    total_connections += conn_count
                    sessions_with_connections += 1

        return {
            "total_connections": total_connections,
            "sessions_with_connections": sessions_with_connections,
        }
    except Exception as e:
        logger.error(f"Get connections count error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/account/info")
async def get_account_info(
    _: str = Depends(verify_token)
):
    """获取 Claude 账户信息

    返回订阅类型、套餐、token 限额、重置时间等
    """
    import json
    from pathlib import Path
    from datetime import datetime

    try:
        # 读取 credentials 文件
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

                # 解析套餐名称和限额
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

                # OAuth token 过期时间
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

        # 读取统计缓存
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
