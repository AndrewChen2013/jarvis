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
Terminal History API

Provides access to terminal input/output history.
"""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from app.api.auth import verify_token
from app.services.database import db

router = APIRouter(prefix="/api", tags=["history"])


@router.get("/terminal/sessions")
async def get_terminal_sessions(_: str = Depends(verify_token)):
    """Get list of sessions with terminal history.

    Returns:
        List of sessions with message count and last activity time.
    """
    sessions = db.get_terminal_sessions()

    # Add session names from database
    all_names = db.get_all_session_names()
    for session in sessions:
        session_id = session.get('session_id', '')
        session['name'] = all_names.get(session_id, '')

    return JSONResponse(content={"sessions": sessions})


@router.get("/terminal/history")
async def get_terminal_history(
    session_id: str = Query(default=None, description="Session ID to filter by"),
    limit: int = Query(default=100, ge=1, le=500, description="Max records to return"),
    offset: int = Query(default=0, ge=0, description="Offset for pagination"),
    _: str = Depends(verify_token)
):
    """Get terminal input/output history.

    Args:
        session_id: Filter by specific session (optional)
        limit: Maximum number of records to return
        offset: Offset for pagination

    Returns:
        List of terminal history records.
    """
    history = db.get_terminal_history(
        session_id=session_id,
        limit=limit,
        offset=offset
    )

    return JSONResponse(content={
        "history": history,
        "limit": limit,
        "offset": offset,
        "has_more": len(history) == limit
    })
