from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional
from app.database import get_db
from app.models.user import User
from app.models.course import Course
from app.models.assignment import Assignment
from app.models.school_class import Class, class_students
from app.utils.dependencies import get_current_user, require_role

router = APIRouter(prefix="/api/courses", tags=["课程"])


class CourseCreate(BaseModel):
    name: str
    description: str = ""
    school_id: Optional[int] = None
    teacher_id: Optional[int] = None


class CourseResponse(BaseModel):
    id: int
    name: str
    description: str
    teacher_id: int
    school_id: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("/", response_model=List[CourseResponse])
async def list_courses(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == "admin":
        result = await db.execute(select(Course))
    elif current_user.role == "teacher":
        result = await db.execute(select(Course).where(Course.teacher_id == current_user.id))
    else:  # student
        # 优先通过 school_id 直接查询，兑底用 class 关联查询
        if current_user.school_id:
            result = await db.execute(
                select(Course).where(Course.school_id == current_user.school_id)
            )
        else:
            result = await db.execute(
                select(Course)
                .join(Class, Course.id == Class.course_id)
                .join(class_students, Class.id == class_students.c.class_id)
                .where(class_students.c.student_id == current_user.id)
                .distinct()
            )
    courses = result.scalars().all()
    return courses


@router.post("/", response_model=CourseResponse, status_code=status.HTTP_201_CREATED)
async def create_course(
    course_data: CourseCreate,
    current_user: User = Depends(require_role("admin", "teacher")),
    db: AsyncSession = Depends(get_db),
):
    course = Course(
        name=course_data.name,
        description=course_data.description,
        teacher_id=course_data.teacher_id or current_user.id,
        school_id=course_data.school_id,
    )
    db.add(course)
    await db.commit()
    await db.refresh(course)
    return course


@router.get("/{course_id}", response_model=CourseResponse)
async def get_course(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Course).where(Course.id == course_id))
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")
    return course


@router.put("/{course_id}", response_model=CourseResponse)
async def update_course(
    course_id: int,
    course_data: CourseCreate,
    current_user: User = Depends(require_role("admin", "teacher")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Course).where(Course.id == course_id))
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")
    if current_user.role != "admin" and course.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权修改此课程")
    course.name = course_data.name
    course.description = course_data.description
    db.add(course)
    await db.commit()
    await db.refresh(course)
    return course


@router.delete("/{course_id}")
async def delete_course(
    course_id: int,
    current_user: User = Depends(require_role("admin", "teacher")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Course).where(Course.id == course_id))
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")
    if current_user.role != "admin" and course.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权删除此课程")

    assignment_count = await db.execute(select(func.count(Assignment.id)).where(Assignment.course_id == course_id))
    class_count = await db.execute(select(func.count(Class.id)).where(Class.course_id == course_id))

    if assignment_count.scalar() > 0 or class_count.scalar() > 0:
        raise HTTPException(status_code=409, detail="该课程下还有关联的作业或班级，无法删除")

    await db.delete(course)
    await db.commit()
    return {"message": "课程已删除"}
