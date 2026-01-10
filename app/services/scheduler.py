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
定时任务调度器

使用 APScheduler 实现：
- 支持 Cron 表达式
- 服务重启后自动恢复任务
- 每个任务独立的执行器
"""
import asyncio
from datetime import datetime
from typing import Optional, Dict, Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.logging import logger
from app.services.database import db


class SchedulerService:
    """定时任务调度服务"""

    # 同步任务的 job ID
    SYNC_JOB_ID = "_scheduler_sync_"

    def __init__(self):
        self.scheduler: Optional[AsyncIOScheduler] = None
        self._started = False
        self._task_executor = None  # 延迟导入，避免循环依赖
        self._loaded_task_ids: set = set()  # 已加载的任务 ID 集合
        # Bug fix: 保存后台任务的引用，避免被 GC 回收
        self._background_tasks: set = set()

    def _get_task_executor(self):
        """获取任务执行器（延迟导入）"""
        if self._task_executor is None:
            from app.services.task_executor import task_executor
            self._task_executor = task_executor
        return self._task_executor

    async def start(self):
        """启动调度器"""
        if self._started:
            return

        # 创建调度器
        self.scheduler = AsyncIOScheduler(
            timezone="Asia/Shanghai"
        )

        # 从数据库恢复所有启用的任务
        tasks = db.get_enabled_scheduled_tasks()
        for task in tasks:
            self._add_job(task)
            self._loaded_task_ids.add(task['id'])
            logger.info(f"[Scheduler] Restored task: {task['name']} ({task['cron_expr']})")

        # 添加每分钟同步任务的 job
        self.scheduler.add_job(
            self._sync_tasks_from_db,
            trigger='interval',
            minutes=1,
            id=self.SYNC_JOB_ID,
            name="Sync tasks from database"
        )

        self.scheduler.start()
        self._started = True

        # 更新所有任务的下次执行时间
        for task in tasks:
            job_id = f"task_{task['id']}"
            job = self.scheduler.get_job(job_id)
            if job and hasattr(job, 'next_run_time') and job.next_run_time:
                db.update_scheduled_task_next_run(task['id'], job.next_run_time)

        logger.info(f"[Scheduler] Started with {len(tasks)} tasks")

    async def stop(self):
        """停止调度器"""
        if self.scheduler:
            self.scheduler.shutdown(wait=False)
            self._started = False
            logger.info("[Scheduler] Stopped")

    def add_task(self, task_id: int):
        """添加任务到调度器"""
        if not self._started:
            logger.warning("[Scheduler] Not started, cannot add task")
            return

        task = db.get_scheduled_task(task_id)
        if task:
            self._add_job(task)
            self._loaded_task_ids.add(task_id)
            logger.info(f"[Scheduler] Added task: {task['name']} (id={task_id})")

    def remove_task(self, task_id: int):
        """从调度器移除任务"""
        if not self._started:
            return

        job_id = f"task_{task_id}"
        if self.scheduler.get_job(job_id):
            self.scheduler.remove_job(job_id)
            self._loaded_task_ids.discard(task_id)
            logger.info(f"[Scheduler] Removed task: {task_id}")

    def update_task(self, task_id: int):
        """更新任务调度（先删除再添加）"""
        self.remove_task(task_id)
        self.add_task(task_id)

    def pause_task(self, task_id: int):
        """暂停任务"""
        if not self._started:
            return

        job_id = f"task_{task_id}"
        job = self.scheduler.get_job(job_id)
        if job:
            self.scheduler.pause_job(job_id)
            logger.info(f"[Scheduler] Paused task: {task_id}")

    def resume_task(self, task_id: int):
        """恢复任务"""
        if not self._started:
            return

        job_id = f"task_{task_id}"
        job = self.scheduler.get_job(job_id)
        if job:
            self.scheduler.resume_job(job_id)
            logger.info(f"[Scheduler] Resumed task: {task_id}")

    def get_next_run_time(self, task_id: int) -> Optional[datetime]:
        """获取任务的下次执行时间"""
        if not self._started:
            return None

        job_id = f"task_{task_id}"
        job = self.scheduler.get_job(job_id)
        if job and job.next_run_time:
            return job.next_run_time
        return None

    async def _sync_tasks_from_db(self):
        """
        每分钟同步数据库任务到调度器（轻量级）

        只比较任务 ID，不读取完整任务数据：
        - 新增的任务 → 加载到调度器
        - 删除/禁用的任务 → 从调度器移除
        """
        try:
            # 轻量级查询：只获取启用任务的 ID 列表
            db_task_ids = set(db.get_enabled_task_ids())

            # 计算差异
            to_add = db_task_ids - self._loaded_task_ids
            to_remove = self._loaded_task_ids - db_task_ids

            # 没有变化，直接返回
            if not to_add and not to_remove:
                return

            # 添加新任务
            for task_id in to_add:
                task = db.get_scheduled_task(task_id)
                if task and task['enabled']:
                    self._add_job(task)
                    self._loaded_task_ids.add(task_id)
                    logger.info(f"[Scheduler:Sync] Added task: {task['name']} (id={task_id})")

            # 移除已删除/禁用的任务
            for task_id in to_remove:
                job_id = f"task_{task_id}"
                if self.scheduler.get_job(job_id):
                    self.scheduler.remove_job(job_id)
                self._loaded_task_ids.discard(task_id)
                logger.info(f"[Scheduler:Sync] Removed task: {task_id}")

            if to_add or to_remove:
                logger.info(f"[Scheduler:Sync] Synced: +{len(to_add)} -{len(to_remove)} tasks")

        except Exception as e:
            logger.error(f"[Scheduler:Sync] Failed to sync tasks: {e}")

    def _add_job(self, task: Dict[str, Any]):
        """内部方法：添加 job"""
        job_id = f"task_{task['id']}"

        # 如果已存在，先移除
        if self.scheduler.get_job(job_id):
            self.scheduler.remove_job(job_id)

        try:
            trigger = CronTrigger.from_crontab(
                task['cron_expr'],
                timezone=task.get('timezone', 'Asia/Shanghai')
            )

            self.scheduler.add_job(
                self._execute_task,
                trigger=trigger,
                id=job_id,
                args=[task['id']],
                name=task['name'],
                misfire_grace_time=300  # 错过 5 分钟内的任务仍会执行
            )

            # 更新下次执行时间（只有在调度器已启动时才有 next_run_time）
            if self._started:
                job = self.scheduler.get_job(job_id)
                if job and hasattr(job, 'next_run_time') and job.next_run_time:
                    db.update_scheduled_task_next_run(task['id'], job.next_run_time)

        except Exception as e:
            logger.error(f"[Scheduler] Failed to add job for task {task['id']}: {e}")

    async def _execute_task(self, task_id: int):
        """执行任务（由调度器回调）"""
        task = db.get_scheduled_task(task_id)
        if not task or not task['enabled']:
            return

        logger.info(f"[Scheduler] Executing task: {task['name']} (id={task_id})")

        try:
            # 调用任务执行器
            executor = self._get_task_executor()
            await executor.execute(task)

            # 更新上次执行时间和下次执行时间
            db.update_scheduled_task_last_run(task_id, datetime.now())
            job = self.scheduler.get_job(f"task_{task_id}")
            if job and job.next_run_time:
                db.update_scheduled_task_next_run(task_id, job.next_run_time)

        except Exception as e:
            logger.error(f"[Scheduler] Task {task_id} execution error: {e}")

    async def run_task_now(self, task_id: int):
        """立即执行任务（不等待调度）"""
        task = db.get_scheduled_task(task_id)
        if not task:
            logger.error(f"[Scheduler] Task {task_id} not found")
            return False

        logger.info(f"[Scheduler] Running task now: {task['name']} (id={task_id})")

        try:
            executor = self._get_task_executor()
            # Bug fix: 保存任务引用，避免被 GC 回收
            bg_task = asyncio.create_task(executor.execute(task))
            self._background_tasks.add(bg_task)
            bg_task.add_done_callback(self._background_tasks.discard)
            return True
        except Exception as e:
            logger.error(f"[Scheduler] Failed to run task {task_id}: {e}")
            return False


# 全局实例
scheduler = SchedulerService()
