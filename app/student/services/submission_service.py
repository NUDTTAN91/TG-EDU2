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


async def create_submission(db: AsyncSession, **kwargs):
    submission = Submission(**kwargs)
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
