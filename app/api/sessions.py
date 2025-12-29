from fastapi import APIRouter, HTTPException, Depends, Header, Query
from typing import List, Optional
import os

from app.models.session import Session, SessionCreate, SessionUpdate
from app.services.session_manager import SessionManager
from app.core.config import settings
from app.core.logging import logger


router = APIRouter(prefix="/api", tags=["sessions"])


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
