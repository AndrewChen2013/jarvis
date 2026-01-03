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
    show_hidden: bool = Query(default=False, description="Show hidden files"),
    _: str = Depends(verify_token)
):
    """列出目录内容

    Args:
        path: 目录路径，默认为用户主目录
        show_hidden: 是否显示隐藏文件

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
            # 跳过隐藏文件（以.开头），除非 show_hidden=true
            if not show_hidden and item.name.startswith('.'):
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


# 可预览的文件类型
PREVIEWABLE_TEXT = {
    # 基础文本
    '.txt', '.log', '.text',
    # 数据格式
    '.json', '.xml', '.yaml', '.yml', '.toml', '.csv', '.tsv',
    # Markdown / 文档
    '.md', '.markdown', '.rst', '.tex',
    # 编程语言
    '.py', '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
    '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx',
    '.java', '.kt', '.kts', '.scala', '.groovy',
    '.go', '.rs', '.rb', '.php', '.swift', '.m', '.mm',
    '.lua', '.r', '.R', '.pl', '.pm',
    # Web
    '.html', '.htm', '.css', '.scss', '.sass', '.less', '.vue', '.svelte',
    # Shell / 脚本
    '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
    # 配置文件
    '.conf', '.ini', '.cfg', '.config', '.properties', '.plist',
    '.env', '.env.local', '.env.development', '.env.production',
    # Git / 项目文件
    '.gitignore', '.gitattributes', '.dockerignore', '.editorconfig',
    # SQL
    '.sql',
    # 其他
    '.vim', '.el', '.clj', '.cljs', '.edn', '.ex', '.exs', '.erl', '.hrl',
    '.hs', '.lhs', '.ml', '.mli', '.fs', '.fsx', '.dart', '.nim',
}
PREVIEWABLE_IMAGE = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.tiff', '.tif'}
# 不预览的二进制/媒体文件
NON_PREVIEWABLE = {
    # 视频
    '.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm', '.m4v',
    # 音频
    '.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a',
    # 压缩包
    '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar', '.dmg', '.iso',
    # 可执行文件
    '.exe', '.dll', '.so', '.dylib', '.app', '.msi',
    # 其他二进制
    '.bin', '.dat', '.db', '.sqlite', '.sqlite3',
    '.pdf',  # PDF 太复杂，暂不支持
    '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
}
MAX_PREVIEW_SIZE = 5 * 1024 * 1024  # 5MB max for preview


@router.get("/preview")
async def preview_file(
    path: str = Query(..., description="File path to preview"),
    _: str = Depends(verify_token)
):
    """预览文件内容

    支持文本文件和图片预览
    """
    target_path = Path(os.path.expanduser(path)).resolve()

    if not target_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if not target_path.is_file():
        raise HTTPException(status_code=400, detail="Not a file")

    if not os.access(target_path, os.R_OK):
        raise HTTPException(status_code=403, detail="Permission denied")

    file_size = target_path.stat().st_size
    if file_size > MAX_PREVIEW_SIZE:
        raise HTTPException(status_code=413, detail="File too large for preview")

    suffix = target_path.suffix.lower()
    filename = target_path.name

    try:
        # 图片文件 - 返回 base64
        if suffix in PREVIEWABLE_IMAGE:
            import base64
            async with aiofiles.open(target_path, 'rb') as f:
                content = await f.read()

            # 确定 MIME 类型
            mime_types = {
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.svg': 'image/svg+xml',
                '.ico': 'image/x-icon',
                '.bmp': 'image/bmp'
            }
            mime = mime_types.get(suffix, 'application/octet-stream')
            b64 = base64.b64encode(content).decode('utf-8')

            return JSONResponse(content={
                "type": "image",
                "mime": mime,
                "name": filename,
                "size": file_size,
                "data": f"data:{mime};base64,{b64}"
            })

        # 检查是否为不可预览的二进制文件
        elif suffix in NON_PREVIEWABLE:
            raise HTTPException(status_code=415, detail="Binary/media file cannot be previewed")

        # 文本文件
        elif suffix in PREVIEWABLE_TEXT or file_size < 100 * 1024:  # 小于100KB也尝试文本预览
            async with aiofiles.open(target_path, 'r', encoding='utf-8', errors='replace') as f:
                content = await f.read()

            # 检测语法高亮类型 (对应 highlight.js 语言名)
            lang_map = {
                # 基础
                '.txt': 'plaintext', '.log': 'plaintext', '.text': 'plaintext',
                # 数据格式
                '.json': 'json', '.xml': 'xml', '.yaml': 'yaml', '.yml': 'yaml',
                '.toml': 'toml', '.csv': 'csv', '.tsv': 'csv',
                # Markdown
                '.md': 'markdown', '.markdown': 'markdown', '.rst': 'plaintext', '.tex': 'latex',
                # JavaScript/TypeScript
                '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
                '.ts': 'typescript', '.tsx': 'typescript',
                # C/C++
                '.c': 'c', '.h': 'c',
                '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hxx': 'cpp',
                # JVM
                '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin',
                '.scala': 'scala', '.groovy': 'groovy',
                # 系统语言
                '.go': 'go', '.rs': 'rust', '.swift': 'swift',
                '.m': 'objectivec', '.mm': 'objectivec',
                # 脚本语言
                '.py': 'python', '.rb': 'ruby', '.php': 'php',
                '.lua': 'lua', '.r': 'r', '.R': 'r', '.pl': 'perl', '.pm': 'perl',
                # Web
                '.html': 'html', '.htm': 'html', '.css': 'css',
                '.scss': 'scss', '.sass': 'scss', '.less': 'less',
                '.vue': 'xml', '.svelte': 'xml',
                # Shell
                '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.fish': 'bash',
                '.ps1': 'powershell', '.bat': 'dos', '.cmd': 'dos',
                # 配置
                '.conf': 'nginx', '.ini': 'ini', '.cfg': 'ini',
                '.config': 'xml', '.properties': 'properties', '.plist': 'xml',
                '.env': 'bash',
                # SQL
                '.sql': 'sql',
                # 函数式
                '.hs': 'haskell', '.lhs': 'haskell',
                '.ml': 'ocaml', '.mli': 'ocaml',
                '.clj': 'clojure', '.cljs': 'clojure', '.edn': 'clojure',
                '.el': 'lisp', '.vim': 'vim',
                '.ex': 'elixir', '.exs': 'elixir',
                '.erl': 'erlang', '.hrl': 'erlang',
                '.fs': 'fsharp', '.fsx': 'fsharp',
                '.dart': 'dart', '.nim': 'nim',
            }
            lang = lang_map.get(suffix, 'plaintext')

            # 特殊处理：CSV 返回特殊类型
            if suffix in {'.csv', '.tsv'}:
                return JSONResponse(content={
                    "type": "csv",
                    "lang": lang,
                    "name": filename,
                    "size": file_size,
                    "data": content,
                    "delimiter": '\t' if suffix == '.tsv' else ','
                })

            return JSONResponse(content={
                "type": "text",
                "lang": lang,
                "name": filename,
                "size": file_size,
                "data": content
            })

        else:
            raise HTTPException(status_code=415, detail="File type not supported for preview")

    except UnicodeDecodeError:
        raise HTTPException(status_code=415, detail="Binary file cannot be previewed as text")
    except Exception as e:
        logger.error(f"Preview error: {e}")
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
    offset: int = 0,
    _: str = Depends(verify_token)
):
    """获取下载历史记录

    Args:
        limit: 返回记录数量限制
        offset: 分页偏移量

    Returns:
        下载历史列表
    """
    history = db.get_download_history(limit, offset)
    return JSONResponse(content={"downloads": history})
