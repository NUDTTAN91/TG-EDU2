import os
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.assignment import Assignment
from app.models.course import Course
from app.models.submission import Submission
from app.models.user import User
from app.utils.audit import log_action
from app.utils.dependencies import require_role
from app.utils.ip_util import get_client_ip
from app.utils.time_util import cst_now
from app.teacher.services.ai_grading_service import SUPPORTED_EXTS

router = APIRouter(prefix="/api/ai-grading", tags=["AI批改"])


async def _check_owner(db: AsyncSession, assignment: Assignment, current_user: User):
    if current_user.role == "admin":
        return
    course = (await db.execute(
        select(Course).where(Course.id == assignment.course_id)
    )).scalar_one_or_none()
    if not course or course.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权批改此作业")


def _ext_of(submission: Submission) -> str:
    return os.path.splitext(submission.file_name or "")[1].lower()


@router.post("/enqueue-pending")
async def enqueue_pending(
    request: Request,
    mode: str = Query("direct"),
    current_user: User = Depends(require_role("admin", "teacher")),
    db: AsyncSession = Depends(get_db),
):
    """把当前教师课程下未批改的提交批量入队（admin 为全平台）。"""
    if mode not in ("direct", "review"):
        raise HTTPException(status_code=400, detail="mode 必须为 direct 或 review")
    query = (
        select(Submission)
        .join(Assignment, Submission.assignment_id == Assignment.id)
        .join(Course, Assignment.course_id == Course.id)
        .where(Submission.grade.is_(None), Submission.status == "submitted")
    )
    if current_user.role == "teacher":
        query = query.where(Course.teacher_id == current_user.id)
    rows = (await db.execute(query)).scalars().all()
    count = 0
    for s in rows:
        if _ext_of(s) not in SUPPORTED_EXTS or not s.file_path or not os.path.isfile(s.file_path):
            continue
        s.status = "queued"
        s.queued_at = cst_now()
        s.ai_mode = mode
        db.add(s)
        count += 1
    await db.commit()
    await log_action(
        db,
        action="ai_enqueue_batch",
        category="ai_grading",
        user_id=current_user.id,
        username=current_user.username,
        detail=f"批量入队 {count} 份待批提交进入 AI 批改（模式 {mode}）",
        ip_address=get_client_ip(request),
    )
    return {"message": f"已入队 {count} 份", "count": count}


@router.post("/{submission_id}/enqueue")
async def enqueue(
    submission_id: int,
    request: Request,
    mode: str = Query("direct"),
    current_user: User = Depends(require_role("admin", "teacher")),
    db: AsyncSession = Depends(get_db),
):
    if mode not in ("direct", "review"):
        raise HTTPException(status_code=400, detail="mode 必须为 direct 或 review")
    submission = (await db.execute(
        select(Submission).where(Submission.id == submission_id)
    )).scalar_one_or_none()
    if not submission:
        raise HTTPException(status_code=404, detail="提交不存在")
    assignment = (await db.execute(
        select(Assignment).where(Assignment.id == submission.assignment_id)
    )).scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="关联作业不存在")
    await _check_owner(db, assignment, current_user)

    ext = _ext_of(submission)
    if ext not in SUPPORTED_EXTS:
        raise HTTPException(status_code=400, detail=f"AI 批改不支持该文件格式：{ext or '未知'}")
    if not submission.file_path or not os.path.isfile(submission.file_path):
        raise HTTPException(status_code=404, detail="提交文件已丢失")
    if submission.status in ("queued", "grading"):
        raise HTTPException(status_code=409, detail="该提交已在 AI 队列中")

    submission.status = "queued"
    submission.queued_at = cst_now()
    submission.ai_mode = mode
    db.add(submission)
    await db.commit()
    await log_action(
        db,
        action="ai_enqueue",
        category="ai_grading",
        user_id=current_user.id,
        username=current_user.username,
        detail=f"入队提交 #{submission.id} 进入 AI 批改（模式 {mode}）",
        ip_address=get_client_ip(request),
    )
    return {"message": "已入队", "submission_id": submission.id}
