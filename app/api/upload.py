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

提供文件上传到用户主目录的功能。
使用流式写入，避免大文件占用过多内存。
"""
import os
import time
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Request
from fastapi.responses import JSONResponse

from app.api.auth import verify_token
from app.core.logging import logger
from app.services.database import db

router = APIRouter(prefix="/api", tags=["upload"])

# 最大文件大小：500MB
MAX_FILE_SIZE = 500 * 1024 * 1024
# 分块大小：1MB
CHUNK_SIZE = 1024 * 1024
# 进度日志间隔：10%
PROGRESS_LOG_INTERVAL = 10


@router.post("/upload")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    _: str = Depends(verify_token)
):
    """上传文件到用户主目录（流式写入）

    Args:
        file: 上传的文件

    Returns:
        上传结果，包含文件路径和大小
    """
    start_time = time.time()
    filename = file.filename

    if not filename:
        raise HTTPException(status_code=400, detail="Filename is required")

    # 清理文件名，移除路径分隔符
    safe_filename = os.path.basename(filename)
    if not safe_filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    logger.info(f"Upload started: {safe_filename}")

    # 目标目录为用户主目录
    target_path = Path.home()
    dest_path = target_path / safe_filename

    # 如果文件已存在，添加数字后缀
    if dest_path.exists():
        base_name = dest_path.stem
        extension = dest_path.suffix
        counter = 1
        while dest_path.exists():
            dest_path = target_path / f"{base_name}_{counter}{extension}"
            counter += 1

    total_size = 0
    last_progress = 0

    # 开始时就记录到数据库，状态为 uploading
    upload_id = db.record_upload(
        filename=dest_path.name,
        path=str(dest_path),
        size=0,
        status="uploading",
        duration=0
    )

    try:
        # 尝试获取 Content-Length 用于进度计算
        content_length = request.headers.get("content-length")
        expected_size = int(content_length) if content_length else None

        # 流式写入文件
        async with aiofiles.open(dest_path, 'wb') as f:
            while True:
                chunk = await file.read(CHUNK_SIZE)
                if not chunk:
                    break

                total_size += len(chunk)

                # 检查文件大小限制
                if total_size > MAX_FILE_SIZE:
                    # 删除已写入的部分
                    await f.close()
                    if dest_path.exists():
                        os.remove(dest_path)
                    logger.warning(f"Upload rejected: {safe_filename} exceeds {MAX_FILE_SIZE // (1024*1024)}MB")
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB"
                    )

                await f.write(chunk)

                # 记录进度日志（每 10%）
                if expected_size and expected_size > 0:
                    progress = int((total_size / expected_size) * 100)
                    if progress >= last_progress + PROGRESS_LOG_INTERVAL:
                        last_progress = (progress // PROGRESS_LOG_INTERVAL) * PROGRESS_LOG_INTERVAL
                        logger.info(f"Upload progress: {safe_filename} {last_progress}% ({total_size // 1024}KB)")

        # 计算耗时
        duration = time.time() - start_time
        size_mb = total_size / (1024 * 1024)
        speed = size_mb / duration if duration > 0 else 0

        logger.info(
            f"Upload completed: {dest_path.name} "
            f"({size_mb:.2f}MB in {duration:.1f}s, {speed:.2f}MB/s)"
        )

        # 更新数据库记录为成功
        db.update_upload(
            upload_id=upload_id,
            size=total_size,
            status="success",
            duration=duration
        )

        return JSONResponse(content={
            "success": True,
            "filename": dest_path.name,
            "path": str(dest_path),
            "size": total_size,
            "duration": round(duration, 2)
        })

    except HTTPException:
        # 更新数据库记录为失败
        duration = time.time() - start_time
        db.update_upload(
            upload_id=upload_id,
            size=total_size,
            status="failed",
            duration=duration,
            error="File too large or request error"
        )
        raise
    except Exception as e:
        # 记录失败
        duration = time.time() - start_time
        logger.error(f"Upload failed: {safe_filename} - {e}")

        # 更新数据库记录为失败
        db.update_upload(
            upload_id=upload_id,
            size=total_size,
            status="failed",
            duration=duration,
            error=str(e)
        )

        # 清理可能的部分文件
        if dest_path.exists():
            try:
                os.remove(dest_path)
            except Exception:
                pass

        raise HTTPException(status_code=500, detail=str(e))


@router.get("/uploads")
async def get_upload_history(
    limit: int = 50,
    offset: int = 0,
    _: str = Depends(verify_token)
):
    """获取上传历史记录

    Args:
        limit: 返回记录数量限制
        offset: 分页偏移量

    Returns:
        上传历史列表
    """
    history = db.get_upload_history(limit, offset)
    return JSONResponse(content={"uploads": history})
