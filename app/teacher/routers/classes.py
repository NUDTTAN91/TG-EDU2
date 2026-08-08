from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from app.database import get_db
from app.models.user import User
from app.models.school_class import Class, class_students, class_courses
from app.models.course import Course
from app.models.school import School
from app.models.assignment import Assignment
from app.utils.dependencies import get_current_user, require_role
from app.utils.audit import log_action
from app.utils.ip_util import get_client_ip

router = APIRouter(prefix="/api/classes", tags=["班级"])


class ClassCreate(BaseModel):
    name: str
    school_id: int
    course_id: Optional[int] = None
    course_ids: Optional[List[int]] = None


class ClassUpdate(BaseModel):
    name: Optional[str] = None
    course_id: Optional[int] = None
    course_ids: Optional[List[int]] = None


class AddStudentRequest(BaseModel):
    student_id: int


class ClassResponse(BaseModel):
    id: int
    name: str
    course_id: Optional[int] = None
    course_ids: List[int] = []
    school_id: int
    student_count: int = 0
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


async def _validate_course_ids(db: AsyncSession, course_ids: List[int], school_id: int):
    """所有课程必须存在且属于该学校，否则 400。"""
    if not course_ids:
        return
    valid = (await db.execute(
        select(Course.id).where(Course.id.in_(course_ids), Course.school_id == school_id)
    )).scalars().all()
    if len(set(valid)) != len(set(course_ids)):
        raise HTTPException(status_code=400, detail="存在不存在或不属于该学校的课程")


async def _set_class_courses(db: AsyncSession, class_id: int, course_ids: List[int]):
    """整体替换班级↔课程关联（先删后插，同事务）。"""
    await db.execute(class_courses.delete().where(class_courses.c.class_id == class_id))
    for cid in course_ids:
        await db.execute(class_courses.insert().values(class_id=class_id, course_id=cid))


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

    # 批量取班级↔课程关联，避免 N+1
    course_ids_map = {}
    if class_ids:
        assoc_rows = (await db.execute(
            select(class_courses.c.class_id, class_courses.c.course_id)
            .where(class_courses.c.class_id.in_(class_ids))
        )).all()
        for cid, course_id in assoc_rows:
            course_ids_map.setdefault(cid, []).append(course_id)

    return [
        ClassResponse(
            id=c.id,
            name=c.name,
            course_ids=course_ids_map.get(c.id, []),
            course_id=(course_ids_map.get(c.id) or [None])[0],
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

    # course_ids 解析：course_ids 优先；否则 course_id 非空→[course_id]；
    # 都未传时自动推断（学校仅 1 门课则关联该门），多课程/无课程保持空列表
    if class_data.course_ids is not None:
        course_ids = list(class_data.course_ids)
    elif class_data.course_id is not None:
        course_ids = [class_data.course_id]
    else:
        courses = (await db.execute(
            select(Course).where(Course.school_id == class_data.school_id)
        )).scalars().all()
        course_ids = [courses[0].id] if len(courses) == 1 else []

    await _validate_course_ids(db, course_ids, class_data.school_id)

    new_class = Class(name=class_data.name, school_id=class_data.school_id)
    db.add(new_class)
    await db.flush()
    await _set_class_courses(db, new_class.id, course_ids)
    await db.commit()
    await db.refresh(new_class)
    return ClassResponse(
        id=new_class.id, name=new_class.name, course_ids=course_ids,
        course_id=course_ids[0] if course_ids else None,
        school_id=new_class.school_id, student_count=0, created_at=new_class.created_at,
    )


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
    ids = (await db.execute(
        select(class_courses.c.course_id).where(class_courses.c.class_id == class_id)
    )).scalars().all()
    count = (await db.execute(
        select(func.count(class_students.c.student_id)).where(class_students.c.class_id == class_id)
    )).scalar() or 0
    return ClassResponse(
        id=cls.id, name=cls.name, course_ids=list(ids),
        course_id=ids[0] if ids else None,
        school_id=cls.school_id, student_count=count, created_at=cls.created_at,
    )


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


@router.delete("/{class_id}/students/{student_id}")
async def remove_student_from_class(
    class_id: int,
    student_id: int,
    request: Request,
    current_user: User = Depends(require_role("admin", "teacher")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Class).where(Class.id == class_id))
    cls = result.scalar_one_or_none()
    if not cls:
        raise HTTPException(status_code=404, detail="班级不存在")
    if current_user.role != "admin" and current_user.school_id != cls.school_id:
        raise HTTPException(status_code=403, detail="无权修改此班级")
    exists = await db.execute(
        select(class_students).where(
            class_students.c.class_id == class_id,
            class_students.c.student_id == student_id,
        )
    )
    if not exists.first():
        raise HTTPException(status_code=400, detail="学生不在该班级")
    await db.execute(
        class_students.delete().where(
            class_students.c.class_id == class_id,
            class_students.c.student_id == student_id,
        )
    )
    await db.commit()
    await log_action(
        db,
        action="remove_student_from_class",
        category="school_management",
        user_id=current_user.id,
        username=current_user.username,
        detail=f"将学生 #{student_id} 从班级「{cls.name}」移除",
        ip_address=get_client_ip(request),
    )
    return {"message": "学生已从班级移除"}


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
    if "name" in update_data:
        cls.name = update_data["name"]

    # 关联整体替换：course_ids 优先；否则 course_id 非空→[course_id]、显式 null→[]；
    # 两键都未传时不动关联（exclude_unset 保证不会误清）
    new_ids = None
    if "course_ids" in update_data:
        new_ids = list(update_data["course_ids"] or [])
    elif "course_id" in update_data:
        new_ids = [update_data["course_id"]] if update_data["course_id"] is not None else []
    if new_ids is not None:
        await _validate_course_ids(db, new_ids, cls.school_id)
        await _set_class_courses(db, cls.id, new_ids)

    await db.commit()
    await db.refresh(cls)
    # Get student count
    count_result = await db.execute(
        select(func.count(class_students.c.student_id)).where(class_students.c.class_id == class_id)
    )
    student_count = count_result.scalar() or 0
    ids = (await db.execute(
        select(class_courses.c.course_id).where(class_courses.c.class_id == class_id)
    )).scalars().all()
    return ClassResponse(
        id=cls.id, name=cls.name, course_ids=list(ids),
        course_id=ids[0] if ids else None,
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
    # Remove student associations and course associations
    await db.execute(class_students.delete().where(class_students.c.class_id == class_id))
    await db.execute(class_courses.delete().where(class_courses.c.class_id == class_id))
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
    # Get assignments for the class's courses (many-to-many)
    assignments_result = await db.execute(
        select(Assignment)
        .join(class_courses, class_courses.c.course_id == Assignment.course_id)
        .where(class_courses.c.class_id == class_id)
        .order_by(Assignment.created_at.desc())
    )
    assignments = assignments_result.scalars().all()
    return [
        {"id": a.id, "title": a.title, "description": a.description, "course_id": a.course_id, "deadline": a.deadline}
        for a in assignments
    ]
