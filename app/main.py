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
Claude Remote - 主应用入口

简化后的架构：
- 直接使用 Claude 的 ~/.claude/projects/ 作为数据源
- 只提供附加命名能力
- 简化的终端管理
"""
from fastapi import FastAPI, WebSocket, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
import os

from app.core.config import settings
from app.core.logging import logger
from app.services.terminal_manager import terminal_manager
from app.api import auth, projects, system, upload, download, history, pinned
from app.api.terminal import handle_terminal_websocket


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    logger.info("Application starting...")

    # 启动终端管理器
    await terminal_manager.start()

    logger.info(f"Application started successfully")

    yield

    # 清理
    logger.info("Application shutting down...")
    await terminal_manager.stop()
    logger.info("Application stopped")


# 创建应用
app = FastAPI(
    title=settings.PROJECT_NAME,
    lifespan=lifespan
)

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
app.include_router(history.router)
app.include_router(pinned.router)

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
    try:
        stats = terminal_manager.get_stats()
        return {
            "status": "healthy",
            "active_terminals": stats["active_terminals"]
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {
            "status": "unhealthy",
            "error": str(e)
        }


@app.websocket("/ws/terminal")
async def websocket_terminal(
    websocket: WebSocket,
    working_dir: str = Query(...),
    session_id: str = Query(default=None),
    rows: int = Query(default=None),
    cols: int = Query(default=None)
):
    """终端 WebSocket 端点

    Args:
        working_dir: 工作目录（必填）
        session_id: Claude session_id（可选，None 表示新建会话）
        rows: 前端期望的终端行数（可选）
        cols: 前端期望的终端列数（可选）

    Note:
        认证通过连接后的第一条消息完成：{ type: "auth", token: "xxx" }
    """
    await handle_terminal_websocket(
        websocket=websocket,
        working_dir=working_dir,
        session_id=session_id,
        rows=rows,
        cols=cols
    )


# 兼容旧的 WebSocket 端点（逐步废弃）
@app.websocket("/ws/{session_id}")
async def websocket_legacy(
    websocket: WebSocket,
    session_id: str,
    token: str = Query(...)
):
    """旧版 WebSocket 端点（兼容）"""
    # 这个端点需要前端配合更新后移除
    logger.warning(f"Legacy WebSocket endpoint used: {session_id}")
    await websocket.close(code=1008, reason="Please use /ws/terminal endpoint")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
