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
Remote Machines API

管理远程 SSH 机器的 CRUD 接口。
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional

from app.api.auth import verify_token
from app.services.database import db
from app.core.logging import logger

router = APIRouter(prefix="/api/remote-machines", tags=["remote-machines"])


# ==================== Request/Response Models ====================

class RemoteMachineCreate(BaseModel):
    name: str
    host: str
    port: int = 22
    username: str
    password: str
    auth_type: str = "password"


class RemoteMachineUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    username: Optional[str] = None
    password: Optional[str] = None
    auth_type: Optional[str] = None


class RemoteMachineResponse(BaseModel):
    id: int
    name: str
    host: str
    port: int
    username: str
    auth_type: str
    created_at: str
    updated_at: str


class TestConnectionRequest(BaseModel):
    host: str
    port: int = 22
    username: str
    password: str


class TestConnectionResponse(BaseModel):
    success: bool
    message: str


# ==================== API Endpoints ====================

@router.get("", response_model=List[RemoteMachineResponse])
async def list_remote_machines(_: str = Depends(verify_token)):
    """获取所有远程机器列表"""
    try:
        machines = db.get_remote_machines()
        return [
            RemoteMachineResponse(
                id=m["id"],
                name=m["name"],
                host=m["host"],
                port=m["port"],
                username=m["username"],
                auth_type=m["auth_type"],
                created_at=m["created_at"],
                updated_at=m["updated_at"]
            )
            for m in machines
        ]
    except Exception as e:
        logger.error(f"List remote machines error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{machine_id}", response_model=RemoteMachineResponse)
async def get_remote_machine(machine_id: int, _: str = Depends(verify_token)):
    """获取单个远程机器信息"""
    try:
        machine = db.get_remote_machine(machine_id)
        if not machine:
            raise HTTPException(status_code=404, detail="Remote machine not found")
        return RemoteMachineResponse(
            id=machine["id"],
            name=machine["name"],
            host=machine["host"],
            port=machine["port"],
            username=machine["username"],
            auth_type=machine["auth_type"],
            created_at=machine["created_at"],
            updated_at=machine["updated_at"]
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get remote machine error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("", response_model=RemoteMachineResponse)
async def create_remote_machine(
    data: RemoteMachineCreate,
    _: str = Depends(verify_token)
):
    """添加远程机器"""
    try:
        machine_id = db.add_remote_machine(
            name=data.name,
            host=data.host,
            port=data.port,
            username=data.username,
            password=data.password,
            auth_type=data.auth_type
        )
        machine = db.get_remote_machine(machine_id)
        return RemoteMachineResponse(
            id=machine["id"],
            name=machine["name"],
            host=machine["host"],
            port=machine["port"],
            username=machine["username"],
            auth_type=machine["auth_type"],
            created_at=machine["created_at"],
            updated_at=machine["updated_at"]
        )
    except Exception as e:
        logger.error(f"Create remote machine error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{machine_id}", response_model=RemoteMachineResponse)
async def update_remote_machine(
    machine_id: int,
    data: RemoteMachineUpdate,
    _: str = Depends(verify_token)
):
    """更新远程机器信息"""
    try:
        # 检查是否存在
        existing = db.get_remote_machine(machine_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Remote machine not found")

        # 更新
        success = db.update_remote_machine(
            machine_id=machine_id,
            name=data.name,
            host=data.host,
            port=data.port,
            username=data.username,
            password=data.password,
            auth_type=data.auth_type
        )
        if not success:
            raise HTTPException(status_code=500, detail="Update failed")

        machine = db.get_remote_machine(machine_id)
        return RemoteMachineResponse(
            id=machine["id"],
            name=machine["name"],
            host=machine["host"],
            port=machine["port"],
            username=machine["username"],
            auth_type=machine["auth_type"],
            created_at=machine["created_at"],
            updated_at=machine["updated_at"]
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update remote machine error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{machine_id}")
async def delete_remote_machine(machine_id: int, _: str = Depends(verify_token)):
    """删除远程机器"""
    try:
        success = db.delete_remote_machine(machine_id)
        if not success:
            raise HTTPException(status_code=404, detail="Remote machine not found")
        return {"success": True, "message": "Remote machine deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete remote machine error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{machine_id}/test", response_model=TestConnectionResponse)
async def test_connection_by_id(machine_id: int, _: str = Depends(verify_token)):
    """测试已保存的远程机器连接"""
    try:
        machine = db.get_remote_machine(machine_id)
        if not machine:
            raise HTTPException(status_code=404, detail="Remote machine not found")

        password = db.get_remote_machine_password(machine_id)

        # 延迟导入，避免循环依赖
        from app.services.ssh_manager import ssh_manager
        success, message = await ssh_manager.test_connection(
            host=machine["host"],
            port=machine["port"],
            username=machine["username"],
            password=password
        )
        return TestConnectionResponse(success=success, message=message)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Test connection error: {e}")
        return TestConnectionResponse(success=False, message=str(e))


@router.post("/test", response_model=TestConnectionResponse)
async def test_connection(data: TestConnectionRequest, _: str = Depends(verify_token)):
    """测试新的远程机器连接（不保存）"""
    try:
        from app.services.ssh_manager import ssh_manager
        success, message = await ssh_manager.test_connection(
            host=data.host,
            port=data.port,
            username=data.username,
            password=data.password
        )
        return TestConnectionResponse(success=success, message=message)
    except Exception as e:
        logger.error(f"Test connection error: {e}")
        return TestConnectionResponse(success=False, message=str(e))


@router.post("/{machine_id}/pin")
async def pin_ssh_session(machine_id: int, _: str = Depends(verify_token)):
    """将 SSH 会话固定到会话列表"""
    try:
        # 检查机器是否存在
        machine = db.get_remote_machine(machine_id)
        if not machine:
            raise HTTPException(status_code=404, detail="Remote machine not found")

        # 检查是否已固定
        if db.is_ssh_session_pinned(machine_id):
            return {"success": True, "message": "Already pinned", "already_pinned": True}

        # 添加固定
        result = db.add_ssh_pinned_session(
            machine_id=machine_id,
            machine_name=machine["name"]
        )

        if result is None:
            return {"success": True, "message": "Already pinned", "already_pinned": True}

        return {"success": True, "id": result, "message": "Pinned successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Pin SSH session error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{machine_id}/pin")
async def unpin_ssh_session(machine_id: int, _: str = Depends(verify_token)):
    """取消固定 SSH 会话"""
    try:
        session_id = f"ssh_{machine_id}"
        success = db.remove_pinned_session(session_id)
        if not success:
            raise HTTPException(status_code=404, detail="Session not pinned")
        return {"success": True, "message": "Unpinned successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unpin SSH session error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{machine_id}/pin")
async def check_ssh_pinned(machine_id: int, _: str = Depends(verify_token)):
    """检查 SSH 会话是否已固定"""
    try:
        is_pinned = db.is_ssh_session_pinned(machine_id)
        return {"pinned": is_pinned}
    except Exception as e:
        logger.error(f"Check SSH pinned error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
