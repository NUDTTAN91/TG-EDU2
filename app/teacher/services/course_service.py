from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.course import Course


async def get_courses_by_teacher(db: AsyncSession, teacher_id: int):
    result = await db.execute(select(Course).where(Course.teacher_id == teacher_id))
    return result.scalars().all()


async def get_all_courses(db: AsyncSession):
    result = await db.execute(select(Course))
    return result.scalars().all()
