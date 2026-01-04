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
WebSocket 终端 API

提供 WebSocket ↔ PTY 的代理功能。
"""
import asyncio
import json
import hashlib
import msgpack
from fastapi import WebSocket, WebSocketDisconnect

from app.services.terminal_manager import terminal_manager, Terminal
from app.core.config import settings
from app.core.logging import logger
from app.services.database import db


def _msg_trace_id(data: bytes | str) -> str:
    """生成消息追踪 ID（内容哈希前8位）"""
    if isinstance(data, str):
        data = data.encode('utf-8')
    return hashlib.md5(data).hexdigest()[:8]


async def handle_terminal_websocket(
    websocket: WebSocket,
    working_dir: str,
    session_id: str = None,
    rows: int = None,
    cols: int = None
):
    """处理终端 WebSocket 连接

    Args:
        websocket: WebSocket 连接
        working_dir: 工作目录
        session_id: Claude session_id（None 表示新建）
        rows: 前端期望的行数
        cols: 前端期望的列数
    """
    import hmac

    await websocket.accept()

    # 等待认证消息（连接后第一条消息必须是 auth）
    try:
        auth_message = await asyncio.wait_for(websocket.receive(), timeout=60.0)

        data = None
        if "bytes" in auth_message:
            data = msgpack.unpackb(auth_message["bytes"], raw=False)
        elif "text" in auth_message:
            data = json.loads(auth_message["text"])

        if not data or data.get("type") != "auth":
            await websocket.close(code=1008, reason="First message must be auth")
            logger.warning("WebSocket: first message not auth")
            return

        token = data.get("token", "")
        if not hmac.compare_digest(token, settings.AUTH_TOKEN):
            await websocket.close(code=1008, reason="Invalid token")
            logger.warning("WebSocket: invalid token")
            return

        logger.info("WebSocket: auth successful")

    except asyncio.TimeoutError:
        await websocket.close(code=1008, reason="Auth timeout")
        logger.warning("WebSocket: auth timeout")
        return
    except Exception as e:
        await websocket.close(code=1008, reason="Auth failed")
        logger.warning(f"WebSocket: auth error: {e}")
        return

    terminal = None
    output_callback = None
    ws_count_incremented = False  # 追踪是否已增加计数，确保 increment/decrement 配对

    try:
        # 发送连接中消息
        await _send_message(websocket, {
            "type": "connecting",
            "message": "Starting terminal..."
        })

        # 创建或获取终端
        terminal_id = session_id or f"new-{id(websocket)}"

        # 检查是否已有终端
        terminal = await terminal_manager.get_terminal(terminal_id)

        if not terminal:
            # 创建新终端（使用前端传来的 size）
            actual_rows = rows or 40
            actual_cols = cols or 120
            logger.info(f"[Terminal] Creating new PTY with size {actual_rows}x{actual_cols} (rows={rows}, cols={cols})")
            terminal = await terminal_manager.create_terminal(
                working_dir=working_dir,
                session_id=session_id,
                rows=actual_rows,
                cols=actual_cols
            )
            terminal_id = terminal.terminal_id
        else:
            # 复用现有终端，不做 resize（让前端延迟 resize）
            logger.info(f"[Terminal:{terminal_id[:8]}] Reusing existing PTY")

        # 增加 WebSocket 计数（标记已增加，确保 finally 里正确 decrement）
        terminal_manager.increment_websocket_count(terminal_id)
        ws_count_incremented = True

        # 注册输出回调
        output_buffer = []
        flush_task = [None]
        ws_closed = [False]  # 标记 WebSocket 是否已关闭，避免向关闭的连接发送

        async def flush_buffer():
            if ws_closed[0]:
                output_buffer.clear()
                return
            if output_buffer:
                text = ''.join(output_buffer)
                output_buffer.clear()
                try:
                    await _send_message(websocket, {
                        "type": "output",
                        "data": text
                    })
                    # 注意：不再在这里记录输出到数据库
                    # 输出会在下次用户输入时，通过 pyte 渲染后保存
                except Exception:
                    # 发送失败，标记为已关闭
                    ws_closed[0] = True

        async def delayed_flush():
            try:
                await asyncio.sleep(0.02)  # 20ms
                await flush_buffer()
            except asyncio.CancelledError:
                pass
            finally:
                flush_task[0] = None

        async def output_callback(data: bytes):
            # 如果 WebSocket 已关闭，跳过处理
            if ws_closed[0]:
                return

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

        terminal.add_output_callback(output_callback)

        # 发送连接成功
        await _send_message(websocket, {
            "type": "connected",
            "terminal_id": terminal_id,
            "session_id": session_id,
            "pid": terminal.pid
        })
        logger.info(f"[Terminal:{terminal_id[:8]}] Sent connected message (pid={terminal.pid})")

        # 发送历史输出
        history = terminal.get_output_history()
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
            logger.info(f"[Terminal:{terminal_id[:8]}] Sent {len(text)} bytes of history")

        # 消息处理循环
        while True:
            try:
                message = await websocket.receive()

                if message.get("type") == "websocket.disconnect":
                    break

                # 计算原始消息大小和追踪 ID
                raw_data = message.get("bytes") or message.get("text")
                if raw_data:
                    msg_size = len(raw_data) if raw_data else 0
                    trace_id = _msg_trace_id(raw_data) if raw_data else "empty"
                    # 大消息（>1KB）打印警告级别日志
                    if msg_size > 1024:
                        logger.warning(f"[WS:{terminal_id[:8]}] RECV large msg: trace={trace_id} size={msg_size} bytes")
                    else:
                        logger.debug(f"[WS:{terminal_id[:8]}] RECV: trace={trace_id} size={msg_size}")

                data = None
                if "bytes" in message:
                    try:
                        data = msgpack.unpackb(message["bytes"], raw=False)
                        logger.debug(f"[WS:{terminal_id[:8]}] UNPACK: trace={trace_id} type={data.get('type')}")
                    except Exception as e:
                        logger.error(f"[WS:{terminal_id[:8]}] UNPACK failed: trace={trace_id} error={e}")
                        continue
                elif "text" in message:
                    try:
                        data = json.loads(message["text"])
                        logger.debug(f"[WS:{terminal_id[:8]}] PARSE: trace={trace_id} type={data.get('type')}")
                    except Exception as e:
                        logger.error(f"[WS:{terminal_id[:8]}] PARSE failed: trace={trace_id} error={e}")
                        continue
                else:
                    continue

                await _handle_message(websocket, terminal, data, session_id=session_id, trace_id=trace_id)

            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.error(f"Message loop error: {e}")
                break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Terminal WebSocket error: {e}", exc_info=True)
    finally:
        # 清理
        if terminal and output_callback:
            terminal.remove_output_callback(output_callback)

        if terminal:
            # WebSocket 断开时，保存当前屏幕内容
            if session_id:
                try:
                    screen_content = terminal.get_screen_content()
                    if screen_content.strip():
                        db.record_terminal_io(
                            session_id=session_id,
                            direction="output",
                            raw_content=None,
                            text_content=screen_content
                        )
                        logger.debug(f"[Terminal:{terminal.terminal_id[:8]}] Saved screen on disconnect ({len(screen_content)} chars)")
                    terminal.reset_screen()
                except Exception as e:
                    logger.debug(f"Save screen on disconnect error: {e}")

            # 只在确实增加过计数时才减少（保证 increment/decrement 配对）
            if ws_count_incremented:
                remaining = terminal_manager.decrement_websocket_count(terminal.terminal_id)
                logger.info(f"[Terminal:{terminal.terminal_id[:8]}] WebSocket disconnected (remaining: {remaining})")
            else:
                logger.warning(f"[Terminal:{terminal.terminal_id[:8]}] WebSocket disconnected but count was not incremented")
            # 不立即关闭，让 cleanup_loop 延迟清理（给重连机会）


async def _handle_message(websocket: WebSocket, terminal: Terminal, data: dict, session_id: str = None, trace_id: str = None):
    """处理消息"""
    msg_type = data.get("type")
    tid = terminal.terminal_id[:8]

    if msg_type == "input":
        input_data = data.get("data", "")
        input_size = len(input_data.encode('utf-8')) if input_data else 0

        # 大输入（>1KB）打印警告
        if input_size > 1024:
            logger.warning(f"[Terminal:{tid}] INPUT large: trace={trace_id} size={input_size} bytes")
        else:
            logger.info(f"[Terminal:{tid}] INPUT: trace={trace_id} size={input_size} data={repr(input_data[:50])}")

        # 在写入 PTY 之前，先保存上一批输出的屏幕状态
        if session_id:
            try:
                screen_content = terminal.get_screen_content()
                if screen_content.strip():
                    db.record_terminal_io(
                        session_id=session_id,
                        direction="output",
                        raw_content=None,
                        text_content=screen_content
                    )
                    logger.debug(f"[Terminal:{tid}] Saved screen content ({len(screen_content)} chars)")
                # 重置屏幕，准备接收下一批输出
                terminal.reset_screen()
            except Exception as e:
                logger.debug(f"Save screen content error: {e}")

        # 写入 PTY
        logger.debug(f"[Terminal:{tid}] WRITE_START: trace={trace_id} size={input_size}")
        success = await terminal_manager.write(terminal.terminal_id, input_data)
        if success:
            logger.debug(f"[Terminal:{tid}] WRITE_DONE: trace={trace_id}")
        else:
            logger.error(f"[Terminal:{tid}] WRITE_FAILED: trace={trace_id}")

    elif msg_type == "resize":
        rows = data.get("rows", 40)
        cols = data.get("cols", 120)
        logger.info(f"[Terminal:{terminal.terminal_id[:8]}] Resize request: {rows}x{cols}")
        resized = await terminal_manager.resize(terminal.terminal_id, rows, cols)
        if not resized:
            logger.info(f"[Terminal:{terminal.terminal_id[:8]}] Resize skipped (size unchanged)")

    elif msg_type == "ping":
        await _send_message(websocket, {"type": "pong"})

    elif msg_type == "get_stats":
        stats = terminal_manager.get_stats()
        await _send_message(websocket, {"type": "stats", "data": stats})


async def _send_message(websocket: WebSocket, data: dict):
    """发送消息（使用 MessagePack）"""
    try:
        packed = msgpack.packb(data, use_bin_type=True)
        await websocket.send_bytes(packed)
    except Exception as e:
        logger.error(f"Send message error: {e}")
        raise
