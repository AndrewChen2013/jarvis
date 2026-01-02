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
文件下载 API

提供文件浏览和下载功能。
"""
import os
import time
import stat
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import JSONResponse, StreamingResponse

from app.api.auth import verify_token
from app.core.logging import logger
from app.services.database import db

router = APIRouter(prefix="/api", tags=["download"])

# 分块大小：1MB
CHUNK_SIZE = 1024 * 1024


def get_file_info(path: Path) -> dict:
    """获取文件/目录信息"""
    try:
        stat_info = path.stat()
        is_dir = path.is_dir()
        return {
            "name": path.name,
            "path": str(path),
            "is_dir": is_dir,
            "size": stat_info.st_size if not is_dir else 0,
            "modified": stat_info.st_mtime,
            "readable": os.access(path, os.R_OK),
        }
    except (PermissionError, OSError) as e:
        return {
            "name": path.name,
            "path": str(path),
            "is_dir": False,
            "size": 0,
            "modified": 0,
            "readable": False,
            "error": str(e)
        }


@router.get("/files")
async def list_files(
    path: str = Query(default="~", description="Directory path to list"),
    _: str = Depends(verify_token)
):
    """列出目录内容

    Args:
        path: 目录路径，默认为用户主目录

    Returns:
        目录内容列表
    """
    # 展开路径（处理 ~ 等）
    target_path = Path(os.path.expanduser(path)).resolve()

    # 安全检查：确保路径存在且是目录
    if not target_path.exists():
        raise HTTPException(status_code=404, detail="Path not found")

    if not target_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    if not os.access(target_path, os.R_OK):
        raise HTTPException(status_code=403, detail="Permission denied")

    try:
        items = []
        for item in sorted(target_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            # 跳过隐藏文件（以.开头）
            if item.name.startswith('.'):
                continue
            items.append(get_file_info(item))

        # 获取父目录
        parent = str(target_path.parent) if target_path != target_path.parent else None

        return JSONResponse(content={
            "path": str(target_path),
            "parent": parent,
            "items": items
        })

    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")
    except Exception as e:
        logger.error(f"List files error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/download")
async def download_file(
    path: str = Query(..., description="File path to download"),
    _: str = Depends(verify_token)
):
    """下载文件

    Args:
        path: 文件路径

    Returns:
        文件流
    """
    start_time = time.time()

    # 展开路径
    target_path = Path(os.path.expanduser(path)).resolve()

    # 安全检查
    if not target_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if not target_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    if not os.access(target_path, os.R_OK):
        raise HTTPException(status_code=403, detail="Permission denied")

    try:
        file_size = target_path.stat().st_size
        filename = target_path.name

        logger.info(f"Download started: {filename} ({file_size} bytes)")

        async def file_streamer():
            """异步文件流生成器"""
            bytes_sent = 0
            try:
                async with aiofiles.open(target_path, 'rb') as f:
                    while True:
                        chunk = await f.read(CHUNK_SIZE)
                        if not chunk:
                            break
                        bytes_sent += len(chunk)
                        yield chunk

                # 下载成功，记录到数据库
                duration = time.time() - start_time
                logger.info(f"Download completed: {filename} ({file_size} bytes in {duration:.1f}s)")
                db.record_download(
                    filename=filename,
                    path=str(target_path),
                    size=file_size,
                    status="success",
                    duration=duration
                )
            except Exception as e:
                # 下载失败
                duration = time.time() - start_time
                logger.error(f"Download failed: {filename} - {e}")
                db.record_download(
                    filename=filename,
                    path=str(target_path),
                    size=bytes_sent,
                    status="failed",
                    duration=duration,
                    error=str(e)
                )
                raise

        # 设置响应头
        headers = {
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(file_size),
        }

        return StreamingResponse(
            file_streamer(),
            media_type="application/octet-stream",
            headers=headers
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Download error: {e}")
        db.record_download(
            filename=target_path.name,
            path=str(target_path),
            size=0,
            status="failed",
            duration=time.time() - start_time,
            error=str(e)
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/downloads")
async def get_download_history(
    limit: int = 50,
    _: str = Depends(verify_token)
):
    """获取下载历史记录

    Args:
        limit: 返回记录数量限制

    Returns:
        下载历史列表
    """
    history = db.get_download_history(limit)
    return JSONResponse(content={"downloads": history})
