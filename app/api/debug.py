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
前端调试日志接收 API

提供 WebSocket 和 HTTP 两种方式接收前端日志：
- WebSocket: /ws/debug - 实时日志流
- HTTP: /api/debug/logs - 批量日志上传
"""

import os
import json
import asyncio
from datetime import datetime
from typing import Dict, List, Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, HTTPException
from pydantic import BaseModel

from app.core.logging import logger
from app.core.config import settings

router = APIRouter(prefix="/api/debug", tags=["debug"])

# 日志文件目录
DEBUG_LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "logs", "frontend")

# 确保目录存在
os.makedirs(DEBUG_LOG_DIR, exist_ok=True)

# 活跃的 WebSocket 连接
_active_connections: Dict[str, WebSocket] = {}


class LogEntry(BaseModel):
    """单条日志"""
    timestamp: str
    level: str = "debug"
    message: str
    clientId: str


class LogBatch(BaseModel):
    """批量日志"""
    clientId: str
    logs: List[LogEntry]


def _get_log_file_path(client_id: str) -> str:
    """获取客户端的日志文件路径"""
    # 使用日期作为文件名前缀，便于管理
    date_str = datetime.now().strftime("%Y%m%d")
    # 清理 client_id，只保留字母数字和连字符
    safe_client_id = "".join(c if c.isalnum() or c == '-' else '_' for c in client_id[:50])
    return os.path.join(DEBUG_LOG_DIR, f"{date_str}_{safe_client_id}.log")


def _write_logs_to_file(client_id: str, logs: List[dict]):
    """将日志写入文件"""
    file_path = _get_log_file_path(client_id)

    try:
        with open(file_path, "a", encoding="utf-8") as f:
            for log in logs:
                # 格式：[timestamp] [level] message
                line = f"[{log.get('timestamp', '')}] [{log.get('level', 'debug').upper()}] {log.get('message', '')}\n"
                f.write(line)
    except Exception as e:
        logger.error(f"[DebugLog] Failed to write to file {file_path}: {e}")


@router.post("/logs")
async def receive_logs(batch: LogBatch):
    """
    HTTP 接口：接收批量日志

    当 WebSocket 不可用时，前端通过此接口上传日志
    """
    if not batch.logs:
        return {"status": "ok", "received": 0}

    # 转换为字典列表
    logs = [log.dict() for log in batch.logs]

    # 写入文件
    _write_logs_to_file(batch.clientId, logs)

    logger.info(f"[DebugLog] HTTP received {len(logs)} logs from {batch.clientId[:20]}")

    return {"status": "ok", "received": len(logs)}


@router.get("/logs/{client_id}")
async def get_logs(client_id: str, lines: int = 100):
    """
    获取指定客户端的最近日志
    """
    file_path = _get_log_file_path(client_id)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Log file not found")

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            all_lines = f.readlines()
            # 返回最后 N 行
            recent_lines = all_lines[-lines:] if len(all_lines) > lines else all_lines
            return {
                "clientId": client_id,
                "totalLines": len(all_lines),
                "lines": [line.rstrip() for line in recent_lines]
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/clients")
async def list_clients():
    """
    列出所有有日志的客户端
    """
    try:
        files = os.listdir(DEBUG_LOG_DIR)
        # 按修改时间排序
        files_with_time = []
        for f in files:
            if f.endswith(".log"):
                path = os.path.join(DEBUG_LOG_DIR, f)
                mtime = os.path.getmtime(path)
                size = os.path.getsize(path)
                files_with_time.append({
                    "filename": f,
                    "modified": datetime.fromtimestamp(mtime).isoformat(),
                    "size": size
                })

        # 按修改时间倒序
        files_with_time.sort(key=lambda x: x["modified"], reverse=True)

        return {"clients": files_with_time}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/logs/{client_id}")
async def delete_logs(client_id: str):
    """
    删除指定客户端的日志
    """
    file_path = _get_log_file_path(client_id)

    if os.path.exists(file_path):
        try:
            os.remove(file_path)
            return {"status": "ok", "deleted": file_path}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return {"status": "ok", "message": "File not found"}


async def handle_debug_websocket(
    websocket: WebSocket,
    client_id: str = Query(...)
):
    """
    WebSocket 接口：实时接收日志

    协议：
    - 客户端发送: {"type": "auth", "token": "xxx"}
    - 客户端发送: {"type": "logs", "logs": [...]}
    - 服务端响应: {"type": "ack", "received": N}
    """
    await websocket.accept()

    logger.info(f"[DebugLog] WebSocket connected: {client_id[:20]}")
    _active_connections[client_id] = websocket

    try:
        while True:
            try:
                message = await websocket.receive()

                if message.get("type") == "websocket.disconnect":
                    break

                data = None
                if "text" in message:
                    try:
                        data = json.loads(message["text"])
                    except json.JSONDecodeError:
                        continue
                elif "bytes" in message:
                    try:
                        data = json.loads(message["bytes"].decode("utf-8"))
                    except:
                        continue

                if not data:
                    continue

                msg_type = data.get("type")

                if msg_type == "auth":
                    # 认证（简单验证）
                    token = data.get("token", "")
                    # 这里可以加入 token 验证逻辑
                    await websocket.send_json({"type": "auth_ok"})

                elif msg_type == "logs":
                    logs = data.get("logs", [])
                    if logs:
                        _write_logs_to_file(client_id, logs)
                        logger.debug(f"[DebugLog] WS received {len(logs)} logs from {client_id[:20]}")
                        await websocket.send_json({"type": "ack", "received": len(logs)})

            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.error(f"[DebugLog] WebSocket error: {e}")
                break

    finally:
        if client_id in _active_connections:
            del _active_connections[client_id]
        logger.info(f"[DebugLog] WebSocket disconnected: {client_id[:20]}")
