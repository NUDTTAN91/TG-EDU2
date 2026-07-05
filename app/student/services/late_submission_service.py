from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.utils.time_util import cst_now
from app.models.late_submission import LateSubmission
from app.models.submission import Submission
from app.models.assignment import Assignment


async def get_pending_late_submissions(db: AsyncSession):
    result = await db.execute(
        select(LateSubmission).where(LateSubmission.status == "pending")
    )
    return result.scalars().all()


async def get_late_submissions_by_student(db: AsyncSession, student_id: int):
    result = await db.execute(
        select(LateSubmission)
        .join(Submission, LateSubmission.submission_id == Submission.id)
        .where(Submission.student_id == student_id)
    )
    return result.scalars().all()


async def get_all_late_submissions(db: AsyncSession):
    result = await db.execute(select(LateSubmission))
    return result.scalars().all()


async def create_late_submission(db: AsyncSession, submission_id: int, student_id: int, reason: str = ""):
    result = await db.execute(select(Submission).where(Submission.id == submission_id))
    submission = result.scalar_one_or_none()
    if not submission:
        return None, "提交不存在"
    if submission.student_id != student_id:
        return None, "无权为他人的提交申请补交"

    # 获取 submission 的 assignment，检查是否真的迟交
    assignment_result = await db.execute(
        select(Assignment).where(Assignment.id == submission.assignment_id)
    )
    assignment = assignment_result.scalar_one_or_none()

    if assignment and assignment.deadline and submission.submitted_at <= assignment.deadline:
        return None, "该提交未迟交，无需申请补交"

    # Check if already has a pending late submission
    existing = await db.execute(
        select(LateSubmission).where(
            LateSubmission.submission_id == submission_id,
            LateSubmission.status == "pending",
        )
    )
    if existing.scalar_one_or_none():
        return None, "该提交已有待审批的补交申请"

    late = LateSubmission(
        submission_id=submission_id,
        reason=reason,
    )
    db.add(late)
    await db.commit()
    await db.refresh(late)
    return late, None


async def get_late_submission_by_id(db: AsyncSession, late_id: int):
    result = await db.execute(
        select(LateSubmission).where(LateSubmission.id == late_id)
    )
    return result.scalar_one_or_none()


async def review_late_submission(db: AsyncSession, late_id: int, reviewer_id: int, approved: bool):
    result = await db.execute(
        select(LateSubmission).where(LateSubmission.id == late_id)
    )
    late = result.scalar_one_or_none()
    if not late:
        return None, "补交申请不存在"
    late.status = "approved" if approved else "rejected"
    late.reviewed_by = reviewer_id
    late.reviewed_at = cst_now()
    db.add(late)
    await db.commit()
    return late, None
