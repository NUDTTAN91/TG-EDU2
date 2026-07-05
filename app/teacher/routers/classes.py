from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from app.database import get_db
from app.models.user import User
from app.models.school_class import Class, class_students
from app.models.course import Course
from app.models.school import School
from app.models.assignment import Assignment
from app.utils.dependencies import get_current_user, require_role

router = APIRouter(prefix="/api/classes", tags=["班级"])


class ClassCreate(BaseModel):
    name: str
    school_id: int
    course_id: Optional[int] = None


class ClassUpdate(BaseModel):
    name: Optional[str] = None
    course_id: Optional[int] = None


class AddStudentRequest(BaseModel):
    student_id: int


class ClassResponse(BaseModel):
    id: int
    name: str
    course_id: Optional[int] = None
    school_id: int
    student_count: int = 0
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


@router.get("/", response_model=List[ClassResponse])
async def list_classes(
    school_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == "admin":
        query = select(Class)
        if school_id is not None:
            query = query.where(Class.school_id == school_id)
        result = await db.execute(query)
    elif current_user.role == "teacher":
        query = (
            select(Class)
            .where(Class.school_id == current_user.school_id)
        )
        if school_id is not None:
            query = query.where(Class.school_id == school_id)
        result = await db.execute(query)
    else:
        query = (
            select(Class)
            .join(class_students, Class.id == class_students.c.class_id)
            .where(class_students.c.student_id == current_user.id)
        )
        if school_id is not None:
            query = query.where(Class.school_id == school_id)
        result = await db.execute(query)
    classes = result.scalars().all()

    # Compute student counts
    class_ids = [c.id for c in classes]
    counts = {}
    if class_ids:
        count_result = await db.execute(
            select(class_students.c.class_id, func.count(class_students.c.student_id))
            .where(class_students.c.class_id.in_(class_ids))
            .group_by(class_students.c.class_id)
        )
        counts = dict(count_result.all())

    return [
        ClassResponse(
            id=c.id,
            name=c.name,
            course_id=c.course_id,
            school_id=c.school_id,
            student_count=counts.get(c.id, 0),
            created_at=c.created_at,
        )
        for c in classes
    ]


@router.post("/", response_model=ClassResponse, status_code=status.HTTP_201_CREATED)
async def create_class(
    class_data: ClassCreate,
    current_user: User = Depends(require_role("admin", "teacher")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(School).where(School.id == class_data.school_id))
    school = result.scalar_one_or_none()
    if not school:
        raise HTTPException(status_code=404, detail="学校不存在")
    if current_user.role != "admin" and current_user.school_id != class_data.school_id:
        raise HTTPException(status_code=403, detail="无权为此学校创建班级")

    # course_id 解析逻辑：优先使用显式传入的值，否则尝试自动推断
    course_id = class_data.course_id
    if course_id is not None:
        # 验证课程存在且属于该学校
        course_result = await db.execute(
            select(Course).where(Course.id == course_id, Course.school_id == class_data.school_id)
        )
        if not course_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="课程不存在或不属于该学校")
    else:
        # 尝试自动推断：该学校下只有一个课程时自动关联
        courses_result = await db.execute(
            select(Course).where(Course.school_id == class_data.school_id)
        )
        courses = courses_result.scalars().all()
        if len(courses) == 1:
            course_id = courses[0].id
        elif len(courses) > 1:
            raise HTTPException(status_code=400, detail="该学校下有多个课程，请指定 course_id")
        # len == 0 时保持 None（该学校下没有课程）

    new_class = Class(name=class_data.name, school_id=class_data.school_id, course_id=course_id)
    db.add(new_class)
    await db.commit()
    await db.refresh(new_class)
    return new_class


@router.get("/{class_id}", response_model=ClassResponse)
async def get_class(
    class_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Class).where(Class.id == class_id))
    cls = result.scalar_one_or_none()
    if not cls:
        raise HTTPException(status_code=404, detail="班级不存在")
    return cls


@router.post("/{class_id}/students")
async def add_student_to_class(
    class_id: int,
    req: AddStudentRequest,
    current_user: User = Depends(require_role("admin", "teacher")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Class).where(Class.id == class_id))
    cls = result.scalar_one_or_none()
    if not cls:
        raise HTTPException(status_code=404, detail="班级不存在")
    result = await db.execute(select(User).where(User.id == req.student_id, User.role == "student"))
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="学生不存在")
    exists = await db.execute(
        select(class_students).where(
            class_students.c.class_id == class_id,
            class_students.c.student_id == req.student_id,
        )
    )
    if exists.first():
        raise HTTPException(status_code=400, detail="学生已在该班级中")
    await db.execute(
        class_students.insert().values(class_id=class_id, student_id=req.student_id)
    )
    await db.commit()
    return {"message": "学生已添加到班级"}


@router.get("/{class_id}/students")
async def list_class_students(
    class_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User)
        .join(class_students, User.id == class_students.c.student_id)
        .where(class_students.c.class_id == class_id)
    )
    students = result.scalars().all()
    return [{"id": s.id, "username": s.username, "full_name": s.full_name} for s in students]


@router.put("/{class_id}", response_model=ClassResponse)
async def update_class(
    class_id: int,
    data: ClassUpdate,
    current_user: User = Depends(require_role("admin", "teacher")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Class).where(Class.id == class_id))
    cls = result.scalar_one_or_none()
    if not cls:
        raise HTTPException(status_code=404, detail="班级不存在")
    if current_user.role != "admin":
        if current_user.school_id != cls.school_id:
            raise HTTPException(status_code=403, detail="无权修改此班级")
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(cls, key, value)
    await db.commit()
    await db.refresh(cls)
    # Get student count
    count_result = await db.execute(
        select(func.count(class_students.c.student_id)).where(class_students.c.class_id == class_id)
    )
    student_count = count_result.scalar() or 0
    return ClassResponse(
        id=cls.id, name=cls.name, course_id=cls.course_id,
        school_id=cls.school_id, student_count=student_count, created_at=cls.created_at,
    )


@router.delete("/{class_id}")
async def delete_class(
    class_id: int,
    current_user: User = Depends(require_role("admin", "teacher")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Class).where(Class.id == class_id))
    cls = result.scalar_one_or_none()
    if not cls:
        raise HTTPException(status_code=404, detail="班级不存在")
    if current_user.role != "admin":
        if current_user.school_id != cls.school_id:
            raise HTTPException(status_code=403, detail="无权删除此班级")
    # Remove student associations
    await db.execute(class_students.delete().where(class_students.c.class_id == class_id))
    await db.delete(cls)
    await db.commit()
    return {"message": "班级已删除"}


@router.get("/{class_id}/assignments")
async def list_class_assignments(
    class_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Class).where(Class.id == class_id))
    cls = result.scalar_one_or_none()
    if not cls:
        raise HTTPException(status_code=404, detail="班级不存在")
    # Get assignments for the class's course
    if cls.course_id is None:
        return []
    assignments_result = await db.execute(
        select(Assignment).where(Assignment.course_id == cls.course_id).order_by(Assignment.created_at.desc())
    )
    assignments = assignments_result.scalars().all()
    return [
        {"id": a.id, "title": a.title, "description": a.description, "course_id": a.course_id, "deadline": a.deadline}
        for a in assignments
    ]
