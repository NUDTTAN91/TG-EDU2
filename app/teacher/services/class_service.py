from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.school_class import Class, class_students


async def get_classes_by_course(db: AsyncSession, course_id: int):
    result = await db.execute(select(Class).where(Class.course_id == course_id))
    return result.scalars().all()


async def get_classes_by_school(db: AsyncSession, school_id: int):
    result = await db.execute(select(Class).where(Class.school_id == school_id))
    return result.scalars().all()


async def get_student_classes(db: AsyncSession, student_id: int):
    result = await db.execute(
        select(Class)
        .join(class_students, Class.id == class_students.c.class_id)
        .where(class_students.c.student_id == student_id)
    )
    return result.scalars().all()
