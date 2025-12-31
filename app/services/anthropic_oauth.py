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
Anthropic OAuth API 服务

调用 Anthropic OAuth API 获取实时用量和用户资料。
"""
import json
import urllib.request
import urllib.error
from pathlib import Path
from typing import Dict, Optional, Any
from datetime import datetime

from app.core.logging import logger


class AnthropicOAuthService:
    """Anthropic OAuth API 服务"""

    CREDENTIALS_PATH = Path.home() / ".claude" / ".credentials.json"
    API_BASE = "https://api.anthropic.com"

    # API Headers
    HEADERS = {
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-code/2.0.32",
        "Accept": "application/json"
    }

    def __init__(self):
        self._token_cache: Optional[str] = None
        self._token_expires_at: Optional[int] = None

    def _get_token(self) -> Optional[str]:
        """获取 OAuth token"""
        # 检查缓存
        if self._token_cache and self._token_expires_at:
            if datetime.now().timestamp() * 1000 < self._token_expires_at:
                return self._token_cache

        # 读取 credentials 文件
        try:
            if not self.CREDENTIALS_PATH.exists():
                logger.warning("Claude credentials file not found")
                return None

            with open(self.CREDENTIALS_PATH) as f:
                creds = json.load(f)

            oauth = creds.get("claudeAiOauth", {})
            self._token_cache = oauth.get("accessToken")
            self._token_expires_at = oauth.get("expiresAt")

            return self._token_cache
        except Exception as e:
            logger.error(f"Failed to read Claude credentials: {e}")
            return None

    def _request(self, endpoint: str) -> Optional[Dict[str, Any]]:
        """发送 API 请求"""
        token = self._get_token()
        if not token:
            return None

        url = f"{self.API_BASE}{endpoint}"
        headers = {
            **self.HEADERS,
            "Authorization": f"Bearer {token}"
        }

        req = urllib.request.Request(url, headers=headers)

        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            logger.error(f"Anthropic API error {e.code}: {e.read().decode()}")
            return None
        except Exception as e:
            logger.error(f"Anthropic API request failed: {e}")
            return None

    def get_usage(self) -> Optional[Dict[str, Any]]:
        """获取实时用量

        Returns:
            {
                "five_hour": {"utilization": 11.0, "resets_at": "..."},
                "seven_day": {"utilization": 21.0, "resets_at": "..."},
                "seven_day_sonnet": {"utilization": 1.0, "resets_at": "..."},
                "extra_usage": {...}
            }
        """
        return self._request("/api/oauth/usage")

    def get_profile(self) -> Optional[Dict[str, Any]]:
        """获取用户资料

        Returns:
            {
                "account": {
                    "uuid": "...",
                    "full_name": "...",
                    "display_name": "...",
                    "email": "...",
                    "has_claude_max": true,
                    "has_claude_pro": false
                },
                "organization": {
                    "uuid": "...",
                    "name": "...",
                    "organization_type": "claude_max",
                    "rate_limit_tier": "default_claude_max_5x",
                    "has_extra_usage_enabled": false
                }
            }
        """
        return self._request("/api/oauth/profile")

    def get_credentials_info(self) -> Optional[Dict[str, Any]]:
        """获取本地 credentials 信息（不含敏感 token）"""
        try:
            if not self.CREDENTIALS_PATH.exists():
                return None

            with open(self.CREDENTIALS_PATH) as f:
                creds = json.load(f)

            oauth = creds.get("claudeAiOauth", {})
            return {
                "subscription_type": oauth.get("subscriptionType"),
                "rate_limit_tier": oauth.get("rateLimitTier"),
                "scopes": oauth.get("scopes", []),
                "expires_at": oauth.get("expiresAt")
            }
        except Exception as e:
            logger.error(f"Failed to read credentials info: {e}")
            return None


# 全局实例
anthropic_oauth = AnthropicOAuthService()
