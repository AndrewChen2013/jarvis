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
Socket.IO Server Configuration

提供 Socket.IO 服务器实例，支持 WebSocket 和 HTTP Long Polling 自动降级。
解决 VPN/代理环境下 WebSocket 连接被阻断的问题。
"""

import socketio

# 创建异步 Socket.IO 服务器
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*',
    # 支持两种传输方式，WebSocket 优先，polling 作为降级
    transports=['websocket', 'polling'],
    # Ping/Pong 配置
    ping_timeout=60,
    ping_interval=25,
    # 最大消息大小 (10MB，用于大型终端输出)
    max_http_buffer_size=10 * 1024 * 1024,
    # 日志级别
    logger=False,
    engineio_logger=False,
)

# ASGI 应用，用于挂载到 FastAPI
sio_app = socketio.ASGIApp(
    sio,
    static_files=None,
)
