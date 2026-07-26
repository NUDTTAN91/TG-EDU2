"""AI 批改队列 worker：单实例顺序消费，天然一次只处理一个文件。"""
import asyncio
import logging

from sqlalchemy import select, update

from app.database import async_session
from app.models.submission import Submission
from app.teacher.services import ai_grading_service

logger = logging.getLogger(__name__)

_worker_task = None
IDLE_SLEEP = 2


async def recover_stuck():
    """崩溃恢复：启动时把卡在 grading 的回置 queued。"""
    async with async_session() as db:
        await db.execute(
            update(Submission).where(Submission.status == "grading").values(status="queued")
        )
        await db.commit()


async def _take_one() -> bool:
    async with async_session() as db:
        row = (await db.execute(
            select(Submission)
            .where(Submission.status == "queued")
            .order_by(Submission.queued_at.asc(), Submission.id.asc())
            .limit(1)
        )).scalar_one_or_none()
        if not row:
            return False
        row.status = "grading"
        db.add(row)
        await db.commit()
        sid = row.id
    await ai_grading_service.process_submission(sid)
    return True


async def _loop():
    while True:
        try:
            processed = await _take_one()
        except Exception:
            logger.exception("AI 批改 worker 循环异常")
            processed = False
        if not processed:
            await asyncio.sleep(IDLE_SLEEP)


def start_ai_worker():
    global _worker_task
    if _worker_task is not None:
        return
    _worker_task = asyncio.get_event_loop().create_task(_loop())
    logger.info("AI 批改 worker 已启动")
