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

包含安全防护：
- IP 黑名单检查
- 登录失败限制
- 紧急锁定机制
"""
import hmac
from fastapi import APIRouter, HTTPException, Depends, Header, Request
from pydantic import BaseModel
from typing import Optional

from app.core.config import settings
from app.core.logging import logger
from app.services.security import security_guard

router = APIRouter(prefix="/api/auth", tags=["auth"])


def get_client_ip(request: Request) -> str:
    """获取客户端真实 IP（支持反向代理）"""
    # 优先从 X-Forwarded-For 获取（Cloudflare 等代理）
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        # X-Forwarded-For 格式: client, proxy1, proxy2
        return forwarded_for.split(",")[0].strip()

    # 其次从 X-Real-IP 获取
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()

    # 最后使用直接连接的 IP
    if request.client:
        return request.client.host

    return "unknown"


def verify_token_with_security(
    request: Request,
    authorization: Optional[str] = Header(None)
) -> str:
    """验证 token（带安全防护）"""
    ip = get_client_ip(request)

    # 1. 检查是否允许访问（紧急锁定、IP 黑名单）
    allowed, reason = security_guard.check_request(ip)
    if not allowed:
        logger.warning(f"Request blocked from {ip}: {reason}")
        raise HTTPException(status_code=403, detail=reason)

    # 2. 验证 token
    if not authorization:
        # 记录失败
        security_guard.record_login_attempt(ip, success=False)
        raise HTTPException(status_code=401, detail="Missing authorization header")

    token = authorization
    if authorization.startswith("Bearer "):
        token = authorization[7:]

    if not hmac.compare_digest(token, settings.AUTH_TOKEN):
        # 记录失败并检查是否需要封禁
        blocked, reason = security_guard.record_login_attempt(ip, success=False)
        if blocked:
            logger.warning(f"IP {ip} blocked after failed attempt: {reason}")
        raise HTTPException(status_code=401, detail="Invalid token")

    # 3. 登录成功，记录并检查异常
    blocked, reason = security_guard.record_login_attempt(ip, success=True)
    if blocked:
        # 触发了紧急锁定
        raise HTTPException(status_code=503, detail=reason)

    return token


# 保留原来的简单验证（用于不需要 IP 检查的场景）
def verify_token(authorization: Optional[str] = Header(None)) -> str:
    """验证 token（简单版，无 IP 检查）"""
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
async def verify_auth(
    request: Request,
    _: str = Depends(verify_token_with_security)
):
    """验证 token 是否有效（带安全防护）"""
    return {"valid": True}


@router.post("/change-password")
async def change_password(
    request: Request,
    req: ChangePasswordRequest,
    _: str = Depends(verify_token_with_security)
):
    """修改密码"""
    if not hmac.compare_digest(req.old_password, settings.AUTH_TOKEN):
        raise HTTPException(status_code=400, detail="旧密码错误")

    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="新密码至少6位")

    if req.new_password == req.old_password:
        raise HTTPException(status_code=400, detail="新密码不能与旧密码相同")

    try:
        old_token = settings.AUTH_TOKEN
        settings.AUTH_TOKEN = req.new_password

        # 更新配置文件
        _update_env_file("AUTH_TOKEN", req.new_password)

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
