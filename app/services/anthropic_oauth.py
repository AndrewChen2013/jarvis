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
支持从 macOS Keychain 或 .credentials.json 文件读取 OAuth token。
"""
import json
import subprocess
import sys
import urllib.request
import urllib.error
from pathlib import Path
from typing import Dict, Optional, Any
from datetime import datetime

from app.core.logging import logger


class AnthropicOAuthService:
    """Anthropic OAuth API 服务"""

    CREDENTIALS_PATH = Path.home() / ".claude" / ".credentials.json"
    KEYCHAIN_SERVICE = "Claude Code-credentials"
    API_BASE = "https://api.anthropic.com"

    # API Headers
    HEADERS = {
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-code/2.0.76",
        "Accept": "application/json"
    }

    def __init__(self):
        self._token_cache: Optional[str] = None
        self._token_expires_at: Optional[int] = None

    def _read_from_keychain(self) -> Optional[Dict[str, Any]]:
        """从 macOS Keychain 读取 credentials

        Returns:
            credentials dict 或 None
        """
        if sys.platform != "darwin":
            return None

        try:
            result = subprocess.run(
                ["security", "find-generic-password", "-s", self.KEYCHAIN_SERVICE, "-w"],
                capture_output=True,
                text=True,
                timeout=5
            )

            if result.returncode != 0:
                logger.debug(f"Keychain read failed: {result.stderr}")
                return None

            creds = json.loads(result.stdout.strip())
            logger.debug("Successfully read credentials from Keychain")
            return creds

        except subprocess.TimeoutExpired:
            logger.warning("Keychain read timed out")
            return None
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Keychain credentials: {e}")
            return None
        except Exception as e:
            logger.error(f"Failed to read from Keychain: {e}")
            return None

    def _read_from_file(self) -> Optional[Dict[str, Any]]:
        """从 .credentials.json 文件读取 credentials

        Returns:
            credentials dict 或 None
        """
        try:
            if not self.CREDENTIALS_PATH.exists():
                logger.debug("Credentials file not found")
                return None

            with open(self.CREDENTIALS_PATH) as f:
                creds = json.load(f)

            logger.debug("Successfully read credentials from file")
            return creds

        except Exception as e:
            logger.error(f"Failed to read credentials file: {e}")
            return None

    def _get_credentials(self) -> Optional[Dict[str, Any]]:
        """获取 credentials（优先 Keychain，fallback 到文件）

        每次调用都重新读取，确保获取最新的 credentials。
        credentials 文件很小，读取开销可忽略。

        Returns:
            credentials dict 或 None
        """
        # macOS: 先尝试 Keychain
        if sys.platform == "darwin":
            creds = self._read_from_keychain()
            if creds:
                return creds

        # Fallback 到文件（Linux 或 macOS Keychain 失败时）
        creds = self._read_from_file()
        if creds:
            return creds

        logger.warning("No credentials found (tried Keychain and file)")
        return None

    def _get_token(self) -> Optional[str]:
        """获取 OAuth token"""
        # 检查 token 缓存
        if self._token_cache and self._token_expires_at:
            if datetime.now().timestamp() * 1000 < self._token_expires_at:
                return self._token_cache

        creds = self._get_credentials()
        if not creds:
            return None

        oauth = creds.get("claudeAiOauth", {})
        self._token_cache = oauth.get("accessToken")
        self._token_expires_at = oauth.get("expiresAt")

        return self._token_cache

    def _request(self, endpoint: str, retry: bool = True) -> Optional[Dict[str, Any]]:
        """发送 API 请求

        Args:
            endpoint: API 端点
            retry: 是否在 401 时重试（清除缓存后重新获取 token）
        """
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
            if e.code == 401:
                # Token 可能已过期或被刷新，清除缓存
                self.clear_cache()
                if retry:
                    # 重试一次（用新 token）
                    logger.warning("Anthropic API 401: Token stale, retrying with fresh token")
                    return self._request(endpoint, retry=False)
                else:
                    logger.error("Anthropic API 401: Retry failed, token still invalid")
            else:
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
            creds = self._get_credentials()
            if not creds:
                return None

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

    def clear_cache(self):
        """清除 token 缓存，强制重新获取 token"""
        self._token_cache = None
        self._token_expires_at = None


# 全局实例
anthropic_oauth = AnthropicOAuthService()
