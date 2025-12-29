from pydantic_settings import BaseSettings
from typing import Optional
import secrets


class Settings(BaseSettings):
    # API Settings
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "Claude Remote"

    # Security
    SECRET_KEY: str = secrets.token_urlsafe(32)
    AUTH_TOKEN: str = secrets.token_urlsafe(32)

    # Redis
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_URL: Optional[str] = None

    # PostgreSQL
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "password"
    POSTGRES_DB: str = "claude_remote"
    POSTGRES_URL: Optional[str] = None

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

    @property
    def redis_url_computed(self) -> str:
        if self.REDIS_URL:
            return self.REDIS_URL
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

    @property
    def postgres_url_computed(self) -> str:
        if self.POSTGRES_URL:
            return self.POSTGRES_URL
        return f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"


settings = Settings()
