from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from typing import Optional
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
    """获取某学生的所有补交申请。

    兼容两种申请模式：
    - 新流程：LateSubmission.student_id 直接匹配
    - 旧流程：通过 submission_id → Submission.student_id 关联
    """
    # 新流程：直接匹配 student_id
    direct = await db.execute(
        select(LateSubmission).where(LateSubmission.student_id == student_id)
    )
    direct_list = list(direct.scalars().all())

    # 旧流程：通过 submission 关联
    via_sub = await db.execute(
        select(LateSubmission)
        .join(Submission, LateSubmission.submission_id == Submission.id)
        .where(Submission.student_id == student_id)
    )
    seen_ids = {ls.id for ls in direct_list}
    for ls in via_sub.scalars().all():
        if ls.id not in seen_ids:
            direct_list.append(ls)
            seen_ids.add(ls.id)

    return direct_list


async def get_all_late_submissions(db: AsyncSession):
    result = await db.execute(select(LateSubmission))
    return result.scalars().all()


async def get_late_submission_by_id(db: AsyncSession, late_id: int):
    result = await db.execute(
        select(LateSubmission).where(LateSubmission.id == late_id)
    )
    return result.scalar_one_or_none()


async def get_approved_late_for_assignment(
    db: AsyncSession, assignment_id: int, student_id: int
):
    """查询学生对某作业是否有已批准的补交申请（新旧流程都覆盖）。"""
    # 新流程：assignment_id + student_id
    q1 = await db.execute(
        select(LateSubmission).where(
            LateSubmission.assignment_id == assignment_id,
            LateSubmission.student_id == student_id,
            LateSubmission.status == "approved",
        )
    )
    if q1.scalars().first():
        return True

    # 旧流程：通过 submission → assignment 关联
    q2 = await db.execute(
        select(LateSubmission)
        .join(Submission, LateSubmission.submission_id == Submission.id)
        .where(
            Submission.assignment_id == assignment_id,
            Submission.student_id == student_id,
            LateSubmission.status == "approved",
        )
    )
    return q2.scalars().first() is not None


async def create_late_submission(
    db: AsyncSession,
    student_id: int,
    submission_id: Optional[int] = None,
    assignment_id: Optional[int] = None,
    reason: str = "",
):
    """创建补交申请。

    支持两种模式：
    - 传入 submission_id（旧兼容）：对已提交的作业申请补审
    - 传入 assignment_id（新流程）：学生逾期未提交时直接申请

    至少传入一个。
    """
    if submission_id is None and assignment_id is None:
        return None, "参数错误：需指定 submission_id 或 assignment_id"

    # ===== 分支 1：按 submission_id（旧流程） =====
    if submission_id is not None:
        sub_result = await db.execute(
            select(Submission).where(Submission.id == submission_id)
        )
        submission = sub_result.scalar_one_or_none()
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

        # 该 submission 已有 pending 或 approved 记录，不重复
        existing = await db.execute(
            select(LateSubmission).where(
                LateSubmission.submission_id == submission_id,
                LateSubmission.status.in_(["pending", "approved"]),
            )
        )
        if existing.scalars().first():
            return None, "该提交已有待审批或已批准的补交申请"

        late = LateSubmission(
            submission_id=submission_id,
            assignment_id=submission.assignment_id,
            student_id=student_id,
            reason=reason,
        )
        db.add(late)
        await db.commit()
        await db.refresh(late)
        return late, None

    # ===== 分支 2：按 assignment_id（新流程） =====
    assignment_result = await db.execute(
        select(Assignment).where(Assignment.id == assignment_id)
    )
    assignment = assignment_result.scalar_one_or_none()
    if not assignment:
        return None, "作业不存在"
    if not assignment.deadline:
        return None, "该作业未设置截止时间，无需申请补交"
    if cst_now() <= assignment.deadline:
        return None, "该作业尚未到截止时间，请直接提交"

    # 已有该学生对此作业的 pending / approved 记录（新旧流程都要查）
    existing_new = await db.execute(
        select(LateSubmission).where(
            LateSubmission.assignment_id == assignment_id,
            LateSubmission.student_id == student_id,
            LateSubmission.status.in_(["pending", "approved"]),
        )
    )
    if existing_new.scalars().first():
        return None, "该作业已有待审批或已批准的补交申请"

    existing_old = await db.execute(
        select(LateSubmission)
        .join(Submission, LateSubmission.submission_id == Submission.id)
        .where(
            Submission.assignment_id == assignment_id,
            Submission.student_id == student_id,
            LateSubmission.status.in_(["pending", "approved"]),
        )
    )
    if existing_old.scalars().first():
        return None, "该作业已有待审批或已批准的补交申请"

    late = LateSubmission(
        submission_id=None,
        assignment_id=assignment_id,
        student_id=student_id,
        reason=reason,
    )
    db.add(late)
    await db.commit()
    await db.refresh(late)
    return late, None


async def review_late_submission(
    db: AsyncSession, late_id: int, reviewer_id: int, approved: bool
):
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
    await db.refresh(late)
    return late, None
