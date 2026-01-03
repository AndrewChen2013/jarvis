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
定时任务 API

提供定时任务的 CRUD 接口，供前端管理页面使用。
"""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.api.auth import verify_token
from app.core.logging import logger
from app.services.database import db
from app.services.scheduler import scheduler

router = APIRouter(prefix="/api/scheduled-tasks", tags=["scheduled-tasks"])


# ==================== Request/Response Models ====================

class ScheduledTaskUpdate(BaseModel):
    """更新定时任务请求"""
    name: Optional[str] = None
    description: Optional[str] = None
    session_id: Optional[str] = None
    working_dir: Optional[str] = None
    prompt: Optional[str] = None
    cron_expr: Optional[str] = None
    timezone: Optional[str] = None
    enabled: Optional[bool] = None
    notify_feishu: Optional[bool] = None
    feishu_chat_id: Optional[str] = None


# ==================== API Endpoints ====================

@router.get("")
async def get_all_tasks(_: str = Depends(verify_token)):
    """获取所有定时任务"""
    try:
        tasks = db.get_all_scheduled_tasks()

        # 为每个任务添加人类可读的 cron 描述
        for task in tasks:
            task['cron_human'] = _cron_to_human(task['cron_expr'])

            # 获取最近一次执行记录
            executions = db.get_task_executions(task['id'], limit=1)
            if executions:
                task['last_execution'] = executions[0]
            else:
                task['last_execution'] = None

        return JSONResponse(content={"tasks": tasks})
    except Exception as e:
        logger.error(f"Get all tasks error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{task_id}")
async def get_task(task_id: int, _: str = Depends(verify_token)):
    """获取单个定时任务"""
    try:
        task = db.get_scheduled_task(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        task['cron_human'] = _cron_to_human(task['cron_expr'])

        # 获取最近执行记录
        executions = db.get_task_executions(task_id, limit=5)
        task['recent_executions'] = executions

        return JSONResponse(content=task)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get task {task_id} error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{task_id}")
async def update_task(
    task_id: int,
    request: ScheduledTaskUpdate,
    _: str = Depends(verify_token)
):
    """更新定时任务"""
    try:
        task = db.get_scheduled_task(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        # 验证 cron 表达式
        if request.cron_expr:
            try:
                from apscheduler.triggers.cron import CronTrigger
                CronTrigger.from_crontab(request.cron_expr)
            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid cron expression: {e}"
                )

        # 更新数据库
        success = db.update_scheduled_task(
            task_id=task_id,
            name=request.name,
            description=request.description,
            session_id=request.session_id,
            working_dir=request.working_dir,
            prompt=request.prompt,
            cron_expr=request.cron_expr,
            timezone=request.timezone,
            enabled=request.enabled,
            notify_feishu=request.notify_feishu,
            feishu_chat_id=request.feishu_chat_id
        )

        if not success:
            raise HTTPException(status_code=500, detail="Failed to update task")

        # 更新调度器
        if request.cron_expr or request.timezone or request.enabled is not None:
            updated_task = db.get_scheduled_task(task_id)
            if updated_task['enabled']:
                scheduler.update_task(task_id)
            else:
                scheduler.remove_task(task_id)

        return JSONResponse(content={"success": True, "message": "Task updated"})

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update task {task_id} error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{task_id}")
async def delete_task(task_id: int, _: str = Depends(verify_token)):
    """删除定时任务"""
    try:
        task = db.get_scheduled_task(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        # 从调度器移除
        scheduler.remove_task(task_id)

        # 从数据库删除
        success = db.delete_scheduled_task(task_id)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to delete task")

        return JSONResponse(content={"success": True, "message": "Task deleted"})

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete task {task_id} error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{task_id}/run")
async def run_task(task_id: int, _: str = Depends(verify_token)):
    """立即执行任务"""
    try:
        task = db.get_scheduled_task(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        # 异步执行
        success = await scheduler.run_task_now(task_id)

        if success:
            return JSONResponse(content={
                "success": True,
                "message": "Task execution started"
            })
        else:
            raise HTTPException(status_code=500, detail="Failed to start task")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Run task {task_id} error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{task_id}/toggle")
async def toggle_task(task_id: int, _: str = Depends(verify_token)):
    """切换任务启用/禁用状态"""
    try:
        task = db.get_scheduled_task(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        new_enabled = not task['enabled']

        success = db.update_scheduled_task(task_id, enabled=new_enabled)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to toggle task")

        # 更新调度器
        if new_enabled:
            scheduler.add_task(task_id)
        else:
            scheduler.remove_task(task_id)

        return JSONResponse(content={
            "success": True,
            "enabled": new_enabled,
            "message": f"Task {'enabled' if new_enabled else 'disabled'}"
        })

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Toggle task {task_id} error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{task_id}/executions")
async def get_task_executions(
    task_id: int,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _: str = Depends(verify_token)
):
    """获取任务执行历史"""
    try:
        task = db.get_scheduled_task(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        executions = db.get_task_executions(task_id, limit=limit, offset=offset)

        return JSONResponse(content={
            "task_id": task_id,
            "task_name": task['name'],
            "executions": executions
        })

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get executions for task {task_id} error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== Helper Functions ====================

def _cron_to_human(cron_expr: str) -> str:
    """将 cron 表达式转换为人类可读的描述"""
    try:
        parts = cron_expr.split()
        if len(parts) != 5:
            return cron_expr

        minute, hour, day, month, weekday = parts

        # 简单的转换规则
        if minute == "0" and hour != "*" and day == "*" and month == "*":
            if weekday == "*":
                return f"每天 {hour}:00"
            elif weekday == "1-5":
                return f"工作日 {hour}:00"
            elif weekday == "1":
                return f"每周一 {hour}:00"
            elif weekday == "0":
                return f"每周日 {hour}:00"
            else:
                weekday_names = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
                try:
                    return f"每{weekday_names[int(weekday)]} {hour}:00"
                except (ValueError, IndexError):
                    pass

        if minute == "0" and hour == "*" and day == "*" and month == "*" and weekday == "*":
            return "每小时"

        if minute.startswith("*/"):
            interval = minute[2:]
            return f"每 {interval} 分钟"

        if hour.startswith("*/"):
            interval = hour[2:]
            return f"每 {interval} 小时"

        if day == "1" and month == "*":
            return f"每月 1 日 {hour}:{minute.zfill(2)}"

        return cron_expr

    except Exception:
        return cron_expr
