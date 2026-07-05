from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from app.models.user import User
from app.models.course import Course
from app.models.submission import Submission
from app.models.assignment import Assignment
from app.models.school import School
from app.models.school_class import Class, class_students
from app.utils.security import get_password_hash


async def create_user(db: AsyncSession, username: str, full_name: str, role: str, password: str = "123456", school_id: int = None, class_id: int = None):
    existing = await db.execute(select(User).where(User.username == username))
    if existing.scalar_one_or_none():
        return None, "用户名已存在"
    user = User(
        username=username,
        full_name=full_name,
        password_hash=get_password_hash(password),
        role=role,
        school_id=school_id,
        must_change_password=(role != "admin"),
    )
    db.add(user)
    await db.flush()
    if class_id and role == "student":
        cls = await db.execute(select(Class).where(Class.id == class_id))
        cls_obj = cls.scalar_one_or_none()
        if cls_obj:
            await db.execute(
                class_students.insert().values(class_id=class_id, student_id=user.id)
            )
    await db.commit()
    await db.refresh(user)
    return user, None


async def get_users(db: AsyncSession):
    result = await db.execute(select(User).options(selectinload(User.classes)))
    return result.scalars().unique().all()


async def get_user_by_id(db: AsyncSession, user_id: int):
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def toggle_user_status(db: AsyncSession, user_id: int, operator_id: int):
    if user_id == operator_id:
        return None, "不能禁用自己的账号"
    user = await get_user_by_id(db, user_id)
    if not user:
        return None, "用户不存在"
    user.is_active = not user.is_active
    db.add(user)
    await db.commit()
    return user, None


async def import_students(db: AsyncSession, students_data: list):
    count = 0
    for s in students_data:
        existing = await db.execute(select(User).where(User.username == s.username))
        if existing.scalar_one_or_none():
            continue
        student = User(
            username=s.username,
            full_name=s.full_name,
            password_hash=get_password_hash(s.password),
            role="student",
            must_change_password=True,
        )
        db.add(student)
        count += 1
    await db.commit()
    return count


async def get_stats(db: AsyncSession):
    total_users = (await db.execute(select(func.count(User.id)))).scalar()
    total_teachers = (await db.execute(select(func.count(User.id)).where(User.role == "teacher"))).scalar()
    total_students = (await db.execute(select(func.count(User.id)).where(User.role == "student"))).scalar()
    total_courses = (await db.execute(select(func.count(Course.id)))).scalar()
    total_submissions = (await db.execute(select(func.count(Submission.id)))).scalar()
    total_assignments = (await db.execute(select(func.count(Assignment.id)))).scalar()
    total_schools = (await db.execute(select(func.count(School.id)))).scalar()
    return {
        "total_users": total_users,
        "total_teachers": total_teachers,
        "total_students": total_students,
        "total_courses": total_courses,
        "total_submissions": total_submissions,
        "total_assignments": total_assignments,
        "total_schools": total_schools,
    }
