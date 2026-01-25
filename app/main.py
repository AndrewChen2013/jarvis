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
Jarvis - 主应用入口

简化后的架构：
- 直接使用 Claude 的 ~/.claude/projects/ 作为数据源
- 只提供附加命名能力
- Chat 会话管理
"""
from fastapi import FastAPI, WebSocket, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send
from contextlib import asynccontextmanager
from urllib.parse import unquote
import os
import re

from app.core.config import settings
from app.core.logging import logger
from app.services.scheduler import scheduler
from app.api import auth, projects, system, upload, download, pinned, monitor, scheduled_tasks, debug, chat
from app.api.debug import handle_debug_websocket
from app.services.socketio_manager import sio_app
# 导入以注册事件处理器
from app.services.socketio_connection_manager import socketio_manager

# CLAUDE.md watcher (optional, graceful fallback if watchdog not installed)
_claude_md_watcher = None
try:
    from scripts.claude_md_watcher import start_watcher, stop_watcher
    _claude_md_watcher_available = True
except ImportError:
    _claude_md_watcher_available = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    logger.info("Application starting...")

    # 启动 CLAUDE.md 监控器
    if _claude_md_watcher_available:
        try:
            start_watcher()
            logger.info("CLAUDE.md watcher started")
        except Exception as e:
            logger.warning(f"Failed to start CLAUDE.md watcher: {e}")

    # 启动定时任务调度器
    await scheduler.start()

    logger.info(f"Application started successfully")

    yield

    # 清理
    logger.info("Application shutting down...")
    await scheduler.stop()

    # 停止 CLAUDE.md 监控器
    if _claude_md_watcher_available:
        try:
            stop_watcher()
            logger.info("CLAUDE.md watcher stopped")
        except Exception:
            pass

    logger.info("Application stopped")


# 创建应用
app = FastAPI(
    title=settings.PROJECT_NAME,
    lifespan=lifespan
)


class ProxyWebSocketFixMiddleware:
    """
    修复通过 HTTP 代理连接 WebSocket 时的路径问题。

    当客户端通过 VPN/代理（如 Clash、V2Ray）连接 WebSocket 时，
    某些代理会错误地将完整 URL 作为路径转发，例如：
      ws%3A//121.43.155.101%3A8000/ws/mux

    这个中间件会检测并修正这种畸形路径，提取出真正的路径部分。
    """

    def __init__(self, app: ASGIApp):
        self.app = app
        # 匹配 URL 编码的 WebSocket URL: ws%3A// 或 wss%3A//
        self.proxy_path_pattern = re.compile(
            r'^wss?%3A//[^/]+(.*)$',  # 匹配 ws://host 或 wss://host 后面的路径
            re.IGNORECASE
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] == "websocket":
            path = scope.get("path", "")

            # 检测是否是代理导致的畸形路径
            if path.startswith(("ws%3A", "wss%3A", "ws%3a", "wss%3a")):
                # URL 解码
                decoded_path = unquote(path)
                # 提取真正的路径部分 (ws://host:port/real/path -> /real/path)
                match = re.match(r'^wss?://[^/]+(/.*)?$', decoded_path, re.IGNORECASE)
                if match:
                    real_path = match.group(1) or "/"
                    logger.info(f"[ProxyFix] Rewrote WebSocket path: {path[:50]}... -> {real_path}")
                    scope = dict(scope)
                    scope["path"] = real_path

        await self.app(scope, receive, send)


# 添加代理 WebSocket 修复中间件（最先执行）
app.add_middleware(ProxyWebSocketFixMiddleware)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(system.router)
app.include_router(upload.router)
app.include_router(download.router)
app.include_router(pinned.router)
app.include_router(monitor.router)
app.include_router(scheduled_tasks.router)
app.include_router(debug.router)
app.include_router(chat.router)

# 挂载 Socket.IO（支持 WebSocket 降级到 HTTP Long Polling）
app.mount("/socket.io", sio_app)

# 挂载静态文件
static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
async def root():
    """根路径 - 返回主页"""
    index_file = os.path.join(static_dir, "index.html")
    return FileResponse(index_file)


@app.get("/health")
async def health():
    """健康检查"""
    return {"status": "healthy"}


@app.websocket("/ws/debug")
async def websocket_debug(
    websocket: WebSocket,
    client_id: str = Query(...)
):
    """调试日志 WebSocket 端点

    Args:
        client_id: 客户端标识（必填）

    用于接收前端调试日志，写入文件便于分析
    """
    await handle_debug_websocket(
        websocket=websocket,
        client_id=client_id
    )


# /ws/mux and /ws/{session_id} endpoints removed - now using Socket.IO only


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=38010,
        reload=True,
        log_level="info"
    )
