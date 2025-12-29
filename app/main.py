from fastapi import FastAPI, WebSocket, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
import os

from app.core.config import settings
from app.core.logging import logger
from app.db.sqlite import SQLiteDB
from app.services.session_manager import SessionManager
from app.api.websocket import ConnectionManager
from app.api import sessions


# 全局变量
db: SQLiteDB = None
session_manager: SessionManager = None
connection_manager: ConnectionManager = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    global db, session_manager, connection_manager

    logger.info("Application starting...")

    # 连接数据库
    db = SQLiteDB("data/sessions.db")
    await db.connect()

    # 创建 session manager
    session_manager = SessionManager(db)
    await session_manager.start()

    # 创建 connection manager
    connection_manager = ConnectionManager(session_manager)

    logger.info(f"Application started successfully")
    logger.info(f"Auth token: {settings.AUTH_TOKEN}")

    yield

    # 清理
    logger.info("Application shutting down...")

    if session_manager:
        await session_manager.stop()

    if db:
        await db.disconnect()

    logger.info("Application stopped")


# 创建应用
app = FastAPI(
    title=settings.PROJECT_NAME,
    lifespan=lifespan
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应该限制
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(sessions.router)

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
        # 获取活跃会话数
        active_count = len(session_manager.active_processes) if session_manager else 0

        return {
            "status": "healthy",
            "database": "connected",
            "active_sessions": active_count
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {
            "status": "unhealthy",
            "error": str(e)
        }


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    session_id: str,
    token: str = Query(...)
):
    """WebSocket 端点"""
    await connection_manager.connect(websocket, session_id, token)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
