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

from pydantic_settings import BaseSettings
import secrets


class Settings(BaseSettings):
    # API Settings
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "Jarvis"

    # Security
    SECRET_KEY: str = secrets.token_urlsafe(32)
    AUTH_TOKEN: str = secrets.token_urlsafe(32)

    # Session Management
    MAX_ACTIVE_SESSIONS: int = 10
    SESSION_IDLE_TIMEOUT: int = 7200  # 2 hours

    # Process Settings
    MAX_PROCESS_MEMORY_MB: int = 2048
    MAX_PROCESS_CPU_PERCENT: float = 80.0

    # WebSocket
    WS_HEARTBEAT_INTERVAL: int = 30
    WS_RECONNECT_DELAY: int = 3

    class Config:
        case_sensitive = True
        env_file = ".env"


settings = Settings()
