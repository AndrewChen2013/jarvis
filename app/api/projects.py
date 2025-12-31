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
Claude Projects/Sessions API

直接读取 Claude 的 ~/.claude/projects/ 目录，
提供项目和会话的查询接口。
"""
import os
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import List, Optional

from app.api.auth import verify_token
from app.services.claude_projects import claude_projects
from app.services.naming_store import naming_store
from app.core.logging import logger

router = APIRouter(prefix="/api", tags=["projects"])


# ==================== Response Models ====================

class ProjectResponse(BaseModel):
    working_dir: str
    path_hash: str
    session_count: int
    last_updated: Optional[str]


class SessionResponse(BaseModel):
    session_id: str
    working_dir: str            # 会话的真实工作目录（用于 resume）
    project_dir: str            # 所属项目目录（用于显示）
    summary: Optional[str]
    custom_name: Optional[str]  # 用户自定义名称
    display_name: str           # 显示名称（优先 custom_name，其次 summary）
    updated_at: str
    file_size: int


class SetNameRequest(BaseModel):
    name: str


# ==================== Projects API ====================

@router.get("/projects", response_model=List[ProjectResponse])
async def list_projects(_: str = Depends(verify_token)):
    """列出所有 Claude 项目（工作目录）"""
    try:
        projects = claude_projects.list_projects()
        return [
            ProjectResponse(
                working_dir=p.working_dir,
                path_hash=p.path_hash,
                session_count=p.session_count,
                last_updated=p.last_updated.isoformat() if p.last_updated else None
            )
            for p in projects
        ]
    except Exception as e:
        logger.error(f"List projects error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/sessions", response_model=List[SessionResponse])
async def list_sessions(
    working_dir: str = Query(..., description="工作目录路径"),
    _: str = Depends(verify_token)
):
    """列出某个工作目录下的所有会话"""
    try:
        sessions = claude_projects.list_sessions(working_dir)
        result = []

        for s in sessions:
            custom_name = naming_store.get_name(s.session_id)
            display_name = custom_name or s.summary or s.session_id[:8]

            result.append(SessionResponse(
                session_id=s.session_id,
                working_dir=s.working_dir,
                project_dir=s.project_dir,
                summary=s.summary,
                custom_name=custom_name,
                display_name=display_name,
                updated_at=s.updated_at.isoformat(),
                file_size=s.file_size
            ))

        return result
    except Exception as e:
        logger.error(f"List sessions error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/session/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: str,
    working_dir: str = Query(..., description="工作目录路径"),
    _: str = Depends(verify_token)
):
    """获取单个会话信息"""
    try:
        session = claude_projects.get_session(working_dir, session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        custom_name = naming_store.get_name(session_id)
        display_name = custom_name or session.summary or session_id[:8]

        return SessionResponse(
            session_id=session.session_id,
            working_dir=session.working_dir,
            project_dir=session.project_dir,
            summary=session.summary,
            custom_name=custom_name,
            display_name=display_name,
            updated_at=session.updated_at.isoformat(),
            file_size=session.file_size
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get session error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== Naming API ====================

@router.put("/projects/session/{session_id}/name")
async def set_session_name(
    session_id: str,
    request: SetNameRequest,
    _: str = Depends(verify_token)
):
    """设置会话的自定义名称"""
    try:
        naming_store.set_name(session_id, request.name)
        return {"success": True}
    except Exception as e:
        logger.error(f"Set session name error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/projects/session/{session_id}/name")
async def delete_session_name(
    session_id: str,
    _: str = Depends(verify_token)
):
    """删除会话的自定义名称"""
    try:
        naming_store.delete_name(session_id)
        return {"success": True}
    except Exception as e:
        logger.error(f"Delete session name error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== Delete API ====================

@router.delete("/projects/session/{session_id}")
async def delete_session(
    session_id: str,
    working_dir: str = Query(..., description="工作目录路径"),
    _: str = Depends(verify_token)
):
    """删除会话（删除 .jsonl 文件）"""
    import shutil

    try:
        # 构建文件路径
        path_hash = claude_projects._path_to_hash(working_dir)
        session_file = os.path.join(
            claude_projects.projects_dir,
            path_hash,
            f"{session_id}.jsonl"
        )

        if not os.path.exists(session_file):
            raise HTTPException(status_code=404, detail="Session not found")

        # 删除 .jsonl 文件
        os.remove(session_file)
        logger.info(f"Deleted session file: {session_file}")

        # 删除可能存在的同名目录（tool-results 等）
        session_dir = os.path.join(
            claude_projects.projects_dir,
            path_hash,
            session_id
        )
        if os.path.isdir(session_dir):
            shutil.rmtree(session_dir)
            logger.info(f"Deleted session directory: {session_dir}")

        # 删除自定义名称
        naming_store.delete_name(session_id)

        return {"success": True, "message": "Session deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete session error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/projects")
async def delete_project(
    working_dir: str = Query(..., description="工作目录路径"),
    _: str = Depends(verify_token)
):
    """删除项目（删除整个项目目录）"""
    import shutil

    try:
        # 构建目录路径
        path_hash = claude_projects._path_to_hash(working_dir)
        project_dir = os.path.join(claude_projects.projects_dir, path_hash)

        if not os.path.exists(project_dir):
            raise HTTPException(status_code=404, detail="Project not found")

        # 获取所有 session ID 用于清理命名
        session_ids = []
        for filename in os.listdir(project_dir):
            if filename.endswith(".jsonl") and not filename.startswith("agent-"):
                session_ids.append(filename.replace(".jsonl", ""))

        # 删除整个目录
        shutil.rmtree(project_dir)
        logger.info(f"Deleted project directory: {project_dir}")

        # 删除所有 session 的自定义名称
        for sid in session_ids:
            naming_store.delete_name(sid)

        return {"success": True, "message": "Project deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete project error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== Directory Browser ====================

@router.get("/browse")
async def browse_directory(
    path: str = Query(default=None, description="目录路径"),
    _: str = Depends(verify_token)
):
    """浏览目录，返回子目录列表"""
    try:
        if not path:
            path = os.path.expanduser("~")

        path = os.path.normpath(os.path.expanduser(path))

        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="Path not found")

        if not os.path.isdir(path):
            raise HTTPException(status_code=400, detail="Path is not a directory")

        parent = os.path.dirname(path) if path != "/" else None

        dirs = []
        try:
            for name in sorted(os.listdir(path)):
                if name.startswith("."):
                    continue
                full_path = os.path.join(path, name)
                if os.path.isdir(full_path):
                    dirs.append({"name": name, "path": full_path})
        except PermissionError:
            pass

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
