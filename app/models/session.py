from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime
from uuid import UUID, uuid4


class SessionCreate(BaseModel):
    """创建会话请求"""
    working_dir: str = Field(..., min_length=1)
    claude_session_id: Optional[str] = None  # 恢复的 Claude 会话 ID
    name: Optional[str] = None


class SessionUpdate(BaseModel):
    """更新会话请求"""
    name: Optional[str] = None


class Session(BaseModel):
    """会话模型"""
    id: str
    name: Optional[str] = None
    description: Optional[str] = None  # Claude 会话描述
    working_dir: str
    status: Literal["active", "idle", "stopped"] = "idle"
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    last_active: datetime = Field(default_factory=datetime.now)
    pid: Optional[int] = None
    claude_session_id: Optional[str] = None  # Claude 会话 ID

    class Config:
        from_attributes = True


class Message(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    session_id: UUID
    role: Literal["user", "assistant", "system"]
    content: str
    created_at: datetime = Field(default_factory=datetime.now)

    class Config:
        from_attributes = True
