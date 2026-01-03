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
系统监控 API

提供 CPU、内存、磁盘、进程等系统监控信息。
"""
import os
import psutil
from typing import List, Optional
from fastapi import APIRouter, Depends, Query

from app.api.auth import verify_token
from app.core.logging import logger

router = APIRouter(prefix="/api", tags=["monitor"])


@router.get("/monitor/overview")
async def get_monitor_overview(
    top_count: int = Query(default=5, ge=1, le=20, description="Top 进程数量"),
    sort_by: str = Query(default="cpu", description="排序方式: cpu 或 memory"),
    _: str = Depends(verify_token)
):
    """获取系统监控概览"""
    try:
        result = {
            "cpu": get_cpu_info(),
            "memory": get_memory_info(),
            "disk": get_disk_info(),
            "jarvis": get_jarvis_info(),
            "top_processes": get_top_processes(top_count, sort_by)
        }
        return result
    except Exception as e:
        logger.error(f"Get monitor overview error: {e}")
        return {"error": str(e)}


def get_cpu_info() -> dict:
    """获取 CPU 信息"""
    try:
        # CPU 使用率（非阻塞，使用上次采样值）
        cpu_percent = psutil.cpu_percent(interval=None)

        # 如果是首次调用返回 0，再调用一次
        if cpu_percent == 0.0:
            cpu_percent = psutil.cpu_percent(interval=0.1)

        load_avg = os.getloadavg()  # macOS/Linux

        return {
            "percent": round(cpu_percent, 1),
            "cores": psutil.cpu_count(),
            "cores_physical": psutil.cpu_count(logical=False),
            "load_avg": [round(x, 2) for x in load_avg]
        }
    except Exception as e:
        logger.error(f"Get CPU info error: {e}")
        return {"percent": 0, "cores": 0, "load_avg": [0, 0, 0]}


def get_memory_info() -> dict:
    """获取内存信息"""
    try:
        mem = psutil.virtual_memory()
        return {
            "total": mem.total,
            "used": mem.used,
            "available": mem.available,
            "percent": round(mem.percent, 1)
        }
    except Exception as e:
        logger.error(f"Get memory info error: {e}")
        return {"total": 0, "used": 0, "available": 0, "percent": 0}


def get_disk_info() -> List[dict]:
    """获取磁盘信息（只返回重要的挂载点）"""
    try:
        disks = []
        partitions = psutil.disk_partitions()

        for part in partitions:
            # 跳过系统虚拟挂载点
            if part.fstype in ('devfs', 'autofs', 'nullfs'):
                continue

            # 跳过只读的系统分区（如 macOS 的 /System/Volumes/xxx）
            if '/System/Volumes' in part.mountpoint:
                continue

            # 只保留重要的挂载点
            important = (
                part.mountpoint == '/' or
                part.mountpoint.startswith('/Volumes/') or
                part.mountpoint.startswith('/Users')
            )

            if not important:
                continue

            try:
                usage = psutil.disk_usage(part.mountpoint)
                disks.append({
                    "mount": part.mountpoint,
                    "device": part.device,
                    "fstype": part.fstype,
                    "total": usage.total,
                    "used": usage.used,
                    "free": usage.free,
                    "percent": round(usage.percent, 1)
                })
            except (PermissionError, OSError):
                continue

        # 按挂载点排序，根目录优先
        disks.sort(key=lambda x: (0 if x["mount"] == "/" else 1, x["mount"]))

        return disks
    except Exception as e:
        logger.error(f"Get disk info error: {e}")
        return []


def get_jarvis_info() -> dict:
    """获取 Jarvis 进程信息"""
    try:
        current_pid = os.getpid()
        current_process = psutil.Process(current_pid)

        main_memory = current_process.memory_info().rss
        main_cpu = current_process.cpu_percent(interval=None)

        # 获取子进程（终端进程）
        terminals = []
        children = current_process.children(recursive=True)

        for child in children:
            try:
                terminals.append({
                    "pid": child.pid,
                    "name": child.name(),
                    "memory": child.memory_info().rss,
                    "cpu": round(child.cpu_percent(interval=None), 1)
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        total_memory = main_memory + sum(t["memory"] for t in terminals)

        return {
            "main_pid": current_pid,
            "main_memory": main_memory,
            "main_cpu": round(main_cpu, 1),
            "terminals": terminals,
            "terminal_count": len(terminals),
            "total_memory": total_memory
        }
    except Exception as e:
        logger.error(f"Get Claude Remote info error: {e}")
        return {
            "main_pid": 0,
            "main_memory": 0,
            "main_cpu": 0,
            "terminals": [],
            "terminal_count": 0,
            "total_memory": 0
        }


def get_top_processes(count: int = 5, sort_by: str = "cpu") -> List[dict]:
    """获取 Top 进程列表"""
    try:
        processes = []

        for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_info']):
            try:
                info = proc.info
                mem_info = info.get('memory_info')
                memory = mem_info.rss if mem_info else 0

                processes.append({
                    "pid": info['pid'],
                    "name": info['name'] or 'Unknown',
                    "cpu": round(info.get('cpu_percent', 0) or 0, 1),
                    "memory": memory
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        # 排序
        if sort_by == "memory":
            processes.sort(key=lambda x: x["memory"], reverse=True)
        else:
            processes.sort(key=lambda x: x["cpu"], reverse=True)

        return processes[:count]
    except Exception as e:
        logger.error(f"Get top processes error: {e}")
        return []
