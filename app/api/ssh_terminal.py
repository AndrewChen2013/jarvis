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
SSH WebSocket 终端 API

提供 WebSocket ↔ SSH Channel 的代理功能。
"""
import asyncio
import json
import msgpack
from fastapi import WebSocket, WebSocketDisconnect

from app.services.ssh_manager import ssh_manager, SSHSession
from app.services.database import db
from app.core.config import settings
from app.core.logging import logger


async def handle_ssh_websocket(
    websocket: WebSocket,
    machine_id: int,
    rows: int = None,
    cols: int = None
):
    """处理 SSH WebSocket 连接

    Args:
        websocket: WebSocket 连接
        machine_id: 远程机器 ID
        rows: 前端期望的行数
        cols: 前端期望的列数
    """
    import hmac

    await websocket.accept()

    # 等待认证消息
    try:
        auth_message = await asyncio.wait_for(websocket.receive(), timeout=10.0)

        data = None
        if "bytes" in auth_message:
            data = msgpack.unpackb(auth_message["bytes"], raw=False)
        elif "text" in auth_message:
            data = json.loads(auth_message["text"])

        if not data or data.get("type") != "auth":
            await websocket.close(code=1008, reason="First message must be auth")
            logger.warning("SSH WebSocket: first message not auth")
            return

        token = data.get("token", "")
        if not hmac.compare_digest(token, settings.AUTH_TOKEN):
            await websocket.close(code=1008, reason="Invalid token")
            logger.warning("SSH WebSocket: invalid token")
            return

        logger.debug("SSH WebSocket: auth successful")

    except asyncio.TimeoutError:
        await websocket.close(code=1008, reason="Auth timeout")
        logger.warning("SSH WebSocket: auth timeout")
        return
    except Exception as e:
        await websocket.close(code=1008, reason="Auth failed")
        logger.warning(f"SSH WebSocket: auth error: {e}")
        return

    session = None
    output_callback = None

    try:
        # 获取远程机器信息
        machine = db.get_remote_machine(machine_id)
        if not machine:
            await _send_message(websocket, {
                "type": "error",
                "message": "Remote machine not found"
            })
            await websocket.close(code=1008, reason="Machine not found")
            return

        password = db.get_remote_machine_password(machine_id)

        # 发送连接中消息
        await _send_message(websocket, {
            "type": "connecting",
            "message": f"Connecting to {machine['username']}@{machine['host']}:{machine['port']}..."
        })

        # 创建 SSH 会话
        actual_rows = rows or 40
        actual_cols = cols or 120
        logger.info(f"[SSH] Creating session to {machine['host']} with size {actual_rows}x{actual_cols}")

        session = await ssh_manager.create_session(
            machine_id=machine_id,
            machine_name=machine["name"],
            host=machine["host"],
            port=machine["port"],
            username=machine["username"],
            password=password,
            rows=actual_rows,
            cols=actual_cols
        )

        if not session:
            await _send_message(websocket, {
                "type": "error",
                "message": "Failed to connect to remote machine"
            })
            await websocket.close(code=1008, reason="Connection failed")
            return

        # 增加 WebSocket 计数
        session.websocket_count += 1

        # 注册输出回调
        output_buffer = []
        flush_task = [None]

        async def flush_buffer():
            if output_buffer:
                text = ''.join(output_buffer)
                output_buffer.clear()
                try:
                    await _send_message(websocket, {
                        "type": "output",
                        "data": text
                    })
                except Exception:
                    pass

        async def delayed_flush():
            try:
                await asyncio.sleep(0.02)  # 20ms
                await flush_buffer()
            except asyncio.CancelledError:
                pass
            finally:
                flush_task[0] = None

        async def output_callback(data: bytes):
            text = data.decode('utf-8', errors='replace')
            output_buffer.append(text)

            buffer_size = sum(len(s) for s in output_buffer)

            if buffer_size > 8192:
                if flush_task[0]:
                    flush_task[0].cancel()
                    flush_task[0] = None
                await flush_buffer()
            else:
                if flush_task[0] is None:
                    flush_task[0] = asyncio.create_task(delayed_flush())

        session.add_output_callback(output_callback)

        # 发送连接成功
        await _send_message(websocket, {
            "type": "connected",
            "session_id": session.session_id,
            "machine_id": machine_id,
            "machine_name": machine["name"],
            "host": machine["host"],
            "username": machine["username"]
        })

        # 发送历史输出
        history = session.get_output_history()
        if history:
            text = history.decode('utf-8', errors='replace')
            chunk_size = 8192
            for i in range(0, len(text), chunk_size):
                chunk = text[i:i + chunk_size]
                await _send_message(websocket, {
                    "type": "output",
                    "data": chunk
                })
                await asyncio.sleep(0.005)
            logger.info(f"[SSH:{session.session_id}] Sent {len(text)} bytes of history")

        # 消息处理循环
        while True:
            try:
                message = await websocket.receive()

                if message.get("type") == "websocket.disconnect":
                    break

                data = None
                if "bytes" in message:
                    try:
                        data = msgpack.unpackb(message["bytes"], raw=False)
                    except Exception:
                        continue
                elif "text" in message:
                    try:
                        data = json.loads(message["text"])
                    except Exception:
                        continue
                else:
                    continue

                await _handle_message(websocket, session, data)

            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.error(f"SSH message loop error: {e}")
                break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"SSH WebSocket error: {e}", exc_info=True)
    finally:
        # 清理
        if session and output_callback:
            session.remove_output_callback(output_callback)

        if session:
            from datetime import datetime
            session.websocket_count -= 1
            session.last_disconnect_at = datetime.now()
            logger.info(f"[SSH:{session.session_id}] WebSocket disconnected (remaining: {session.websocket_count})")

            # 如果没有其他连接，立即关闭 SSH 会话（不像 Claude 终端需要保持）
            if session.websocket_count <= 0:
                await ssh_manager.close_session(session.session_id)


async def _handle_message(websocket: WebSocket, session: SSHSession, data: dict):
    """处理消息"""
    msg_type = data.get("type")

    if msg_type == "input":
        input_data = data.get("data", "")
        if isinstance(input_data, str):
            input_data = input_data.encode('utf-8')
        await ssh_manager.write_input(session.session_id, input_data)

    elif msg_type == "resize":
        rows = data.get("rows", 40)
        cols = data.get("cols", 120)
        logger.info(f"[SSH:{session.session_id}] Resize request: {rows}x{cols}")
        await ssh_manager.resize(session.session_id, rows, cols)

    elif msg_type == "ping":
        await _send_message(websocket, {"type": "pong"})


async def _send_message(websocket: WebSocket, data: dict):
    """发送消息（使用 MessagePack）"""
    try:
        packed = msgpack.packb(data, use_bin_type=True)
        await websocket.send_bytes(packed)
    except Exception as e:
        logger.error(f"Send message error: {e}")
        raise
