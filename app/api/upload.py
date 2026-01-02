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
文件上传 API

提供文件上传到指定目录的功能。
"""
import os
from pathlib import Path
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.responses import JSONResponse

from app.api.auth import verify_token
from app.core.logging import logger

router = APIRouter(prefix="/api", tags=["upload"])

# 最大文件大小：500MB
MAX_FILE_SIZE = 500 * 1024 * 1024


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    _: str = Depends(verify_token)
):
    """上传文件到用户主目录

    Args:
        file: 上传的文件

    Returns:
        上传结果，包含文件路径和大小
    """
    try:
        # 目标目录为用户主目录
        target_path = Path.home()

        # 读取文件内容（带大小限制）
        content = await file.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB"
            )

        # 获取安全的文件名
        filename = file.filename
        if not filename:
            raise HTTPException(status_code=400, detail="Filename is required")

        # 清理文件名，移除路径分隔符
        safe_filename = os.path.basename(filename)
        if not safe_filename:
            raise HTTPException(status_code=400, detail="Invalid filename")

        # 完整的目标文件路径
        dest_path = target_path / safe_filename

        # 如果文件已存在，添加数字后缀
        if dest_path.exists():
            base_name = dest_path.stem
            extension = dest_path.suffix
            counter = 1
            while dest_path.exists():
                dest_path = target_path / f"{base_name}_{counter}{extension}"
                counter += 1

        # 写入文件
        with open(dest_path, "wb") as f:
            f.write(content)

        logger.info(f"File uploaded: {dest_path} ({len(content)} bytes)")

        return JSONResponse(content={
            "success": True,
            "filename": dest_path.name,
            "path": str(dest_path),
            "size": len(content)
        })

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
