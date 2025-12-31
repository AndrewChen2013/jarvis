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
