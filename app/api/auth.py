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
认证相关 API
"""
import hmac
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel
from typing import Optional

from app.core.config import settings
from app.core.logging import logger

router = APIRouter(prefix="/api/auth", tags=["auth"])


def verify_token(authorization: Optional[str] = Header(None)):
    """验证 token（使用恒定时间比较防止时序攻击）"""
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")

    token = authorization
    if authorization.startswith("Bearer "):
        token = authorization[7:]

    if not hmac.compare_digest(token, settings.AUTH_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid token")

    return token


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


@router.post("/verify")
async def verify_auth(_: str = Depends(verify_token)):
    """验证 token 是否有效"""
    return {"valid": True}


@router.post("/change-password")
async def change_password(
    request: ChangePasswordRequest,
    _: str = Depends(verify_token)
):
    """修改密码"""
    if not hmac.compare_digest(request.old_password, settings.AUTH_TOKEN):
        raise HTTPException(status_code=400, detail="旧密码错误")

    if len(request.new_password) < 6:
        raise HTTPException(status_code=400, detail="新密码至少6位")

    if request.new_password == request.old_password:
        raise HTTPException(status_code=400, detail="新密码不能与旧密码相同")

    try:
        old_token = settings.AUTH_TOKEN
        settings.AUTH_TOKEN = request.new_password

        # 更新配置文件
        _update_env_file("AUTH_TOKEN", request.new_password)

        logger.info("Password changed successfully")
        return {"success": True, "message": "密码修改成功，请重新登录"}

    except Exception as e:
        settings.AUTH_TOKEN = old_token
        logger.error(f"Change password error: {e}")
        raise HTTPException(status_code=500, detail="修改密码失败")


def _update_env_file(key: str, value: str):
    """更新 .env 文件中的配置项"""
    import os
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), '.env')

    lines = []
    key_found = False
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            lines = f.readlines()

    new_lines = []
    for line in lines:
        if line.strip().startswith(f'{key}='):
            new_lines.append(f'{key}={value}\n')
            key_found = True
        else:
            new_lines.append(line)

    if not key_found:
        new_lines.append(f'{key}={value}\n')

    with open(env_path, 'w') as f:
        f.writelines(new_lines)
