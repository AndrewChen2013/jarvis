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
置顶会话 API

管理首屏快捷访问的会话列表。
"""
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.api.auth import verify_token
from app.core.logging import logger
from app.services.database import db
from app.services.claude_projects import claude_projects

router = APIRouter(prefix="/api", tags=["pinned"])


# ==================== Request/Response Models ====================

class PinnedSessionRequest(BaseModel):
    session_id: str
    working_dir: str
    display_name: Optional[str] = None


class ReorderRequest(BaseModel):
    positions: List[dict]  # [{"session_id": "xxx", "position": 1}, ...]


# ==================== API Endpoints ====================

@router.get("/pinned-sessions")
async def get_pinned_sessions(_: str = Depends(verify_token)):
    """获取所有置顶会话（包含 Context 信息）"""
    try:
        pinned = db.get_pinned_sessions()

        # 为每个置顶会话补充 context 信息
        enriched = []
        for p in pinned:
            session_data = dict(p)  # 复制数据库数据

            # 尝试获取完整的 session 信息（包含 context）
            try:
                full_session = claude_projects.get_session(
                    p["working_dir"],
                    p["session_id"]
                )
                if full_session:
                    session_data["context_used"] = full_session.context_used
                    session_data["context_max"] = full_session.context_max
                    session_data["context_percentage"] = full_session.context_percentage
                    session_data["context_free"] = full_session.context_free
                    session_data["context_until_compact"] = full_session.context_until_compact
                    session_data["total_tokens"] = full_session.total_tokens
                    # 添加 session 的最后活动时间
                    session_data["updated_at"] = full_session.updated_at.isoformat()
            except Exception as e:
                logger.debug(f"Could not get context for {p['session_id']}: {e}")

            enriched.append(session_data)

        return JSONResponse(content={"sessions": enriched})
    except Exception as e:
        logger.error(f"Get pinned sessions error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/pinned-sessions")
async def add_pinned_session(
    request: PinnedSessionRequest,
    _: str = Depends(verify_token)
):
    """添加置顶会话"""
    try:
        result = db.add_pinned_session(
            session_id=request.session_id,
            working_dir=request.working_dir,
            display_name=request.display_name
        )
        if result is None:
            return JSONResponse(
                status_code=409,
                content={"error": "Session already pinned"}
            )
        return JSONResponse(content={"id": result, "success": True})
    except Exception as e:
        logger.error(f"Add pinned session error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/pinned-sessions/{session_id}")
async def remove_pinned_session(
    session_id: str,
    _: str = Depends(verify_token)
):
    """移除置顶会话"""
    try:
        success = db.remove_pinned_session(session_id)
        if not success:
            raise HTTPException(status_code=404, detail="Session not found")
        return JSONResponse(content={"success": True})
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Remove pinned session error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/pinned-sessions/reorder")
async def reorder_pinned_sessions(
    request: ReorderRequest,
    _: str = Depends(verify_token)
):
    """重新排序置顶会话"""
    try:
        db.update_pinned_positions(request.positions)
        return JSONResponse(content={"success": True})
    except Exception as e:
        logger.error(f"Reorder pinned sessions error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/pinned-sessions/{session_id}/check")
async def check_session_pinned(
    session_id: str,
    _: str = Depends(verify_token)
):
    """检查会话是否已置顶"""
    try:
        is_pinned = db.is_session_pinned(session_id)
        return JSONResponse(content={"pinned": is_pinned})
    except Exception as e:
        logger.error(f"Check pinned session error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
