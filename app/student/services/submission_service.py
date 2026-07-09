from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.utils.time_util import cst_now
from app.models.submission import Submission


async def get_submissions_by_assignment(db: AsyncSession, assignment_id: int):
    result = await db.execute(
        select(Submission).where(Submission.assignment_id == assignment_id)
    )
    return result.scalars().all()


async def get_submissions_by_student(db: AsyncSession, student_id: int):
    result = await db.execute(
        select(Submission).where(Submission.student_id == student_id)
    )
    return result.scalars().all()


async def get_submission(db: AsyncSession, submission_id: int):
    result = await db.execute(select(Submission).where(Submission.id == submission_id))
    return result.scalar_one_or_none()


async def get_submission_by_student_assignment(
    db: AsyncSession, student_id: int, assignment_id: int
):
    result = await db.execute(
        select(Submission).where(
            Submission.student_id == student_id,
            Submission.assignment_id == assignment_id,
        )
    )
    return result.scalar_one_or_none()


async def create_submission(db: AsyncSession, **kwargs):
    submission = Submission(**kwargs)
    db.add(submission)
    await db.commit()
    await db.refresh(submission)
    return submission


async def update_submission_file(
    db: AsyncSession,
    submission: Submission,
    file_path: str,
    file_name: str,
):
    """重新提交时更新文件相关字段，保留成绩/反馈/批改人。"""
    submission.file_path = file_path
    submission.file_name = file_name
    submission.submitted_at = cst_now()
    db.add(submission)
    await db.commit()
    await db.refresh(submission)
    return submission


async def grade_submission(db: AsyncSession, submission: Submission, grade: int, feedback: str, grader_id: int):
    submission.grade = grade
    submission.feedback = feedback
    submission.status = "graded"
    submission.graded_by = grader_id
    submission.graded_at = cst_now()
    db.add(submission)
    await db.commit()
    await db.refresh(submission)
    return submission
