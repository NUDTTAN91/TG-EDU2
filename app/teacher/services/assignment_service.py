import re
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.assignment import Assignment
from app.utils.time_util import cst_now


def _safe_name(name: str) -> str:
    if not name:
        return "unknown"
    return re.sub(r'[\\/:*?"<>|]', '', name).strip() or "unknown"


async def get_assignments_by_course(db: AsyncSession, course_id: int):
    result = await db.execute(select(Assignment).where(Assignment.course_id == course_id))
    return result.scalars().all()


async def get_assignment(db: AsyncSession, assignment_id: int):
    result = await db.execute(select(Assignment).where(Assignment.id == assignment_id))
    return result.scalar_one_or_none()


async def create_assignment(db: AsyncSession, **kwargs):
    # 生成作业文件夹名（一次性生成，所有学生提交都用同一个文件夹）
    title = kwargs.get('title', 'unknown')
    created_time = cst_now().strftime("%Y%m%d%H%M%S")
    short_uuid = uuid.uuid4().hex[:16]
    kwargs['folder_name'] = f"{created_time}_{_safe_name(title)}_{short_uuid}"
    assignment = Assignment(**kwargs)
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    return assignment


async def update_assignment(db: AsyncSession, assignment: Assignment, **kwargs):
    for key, value in kwargs.items():
        if value is not None:
            setattr(assignment, key, value)
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    return assignment
