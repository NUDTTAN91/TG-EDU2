from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sql_delete
from pydantic import BaseModel, field_validator
from typing import List, Optional
from datetime import datetime
from app.database import get_db
from app.models.user import User
from app.models.assignment import Assignment, assignment_classes
from app.models.course import Course
from app.models.submission import Submission
from app.models.school_class import Class, class_students, class_courses
from app.utils.dependencies import get_current_user, require_role
from app.teacher.services import assignment_service

router = APIRouter(prefix="/api/assignments", tags=["作业"])


class AssignmentCreate(BaseModel):
    title: str
    description: str = ""
    course_id: int
    deadline: Optional[datetime] = None
    attachments: str = ".cpp,.c,.java,.py,.zip"
    max_file_size_mb: int = 50
    auto_ai_grade: bool = False
    class_ids: Optional[List[int]] = None

    @field_validator("attachments")
    @classmethod
    def _attachments_non_empty(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("attachments 不得为空")
        return v

    @field_validator("max_file_size_mb")
    @classmethod
    def _max_size_positive(cls, v: int) -> int:
        if v is None or v < 1 or v > 500:
            raise ValueError("max_file_size_mb 需在 1 到 500 之间")
        return v


class AssignmentUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    deadline: Optional[datetime] = None
    attachments: Optional[str] = None
    max_file_size_mb: Optional[int] = None
    auto_ai_grade: Optional[bool] = None
    class_ids: Optional[List[int]] = None

    @field_validator("attachments")
    @classmethod
    def _attachments_non_empty(cls, v):
        if v is None:
            return v
        stripped = v.strip()
        if not stripped:
            raise ValueError("attachments 不得为空")
        return stripped

    @field_validator("max_file_size_mb")
    @classmethod
    def _max_size_positive(cls, v):
        if v is None:
            return v
        if v < 1 or v > 500:
            raise ValueError("max_file_size_mb 需在 1 到 500 之间")
        return v


class AssignmentResponse(BaseModel):
    id: int
    title: str
    description: str
    course_id: int
    deadline: Optional[datetime] = None
    attachments: str
    max_file_size_mb: int
    auto_ai_grade: bool = False
    class_ids: List[int] = []
    created_at: datetime

    model_config = {"from_attributes": True}


async def _class_ids_map(db: AsyncSession, assignment_ids):
    """批量取作业→定向班级 id 列表，避免 N+1。"""
    out = {}
    if not assignment_ids:
        return out
    rows = (await db.execute(
        select(assignment_classes.c.assignment_id, assignment_classes.c.class_id)
        .where(assignment_classes.c.assignment_id.in_(assignment_ids))
    )).all()
    for aid, cid in rows:
        out.setdefault(aid, []).append(cid)
    return out


async def _validate_class_ids(db: AsyncSession, class_ids, course_id: int):
    """定向班级必须存在且已关联该作业的课程，否则 400。"""
    if not class_ids:
        return
    valid = (await db.execute(
        select(class_courses.c.class_id)
        .where(class_courses.c.class_id.in_(class_ids), class_courses.c.course_id == course_id)
    )).scalars().all()
    if len(set(valid)) != len(set(class_ids)):
        raise HTTPException(status_code=400, detail="存在未关联该课程的班级，请先在班级管理中关联课程")


async def _set_assignment_classes(db: AsyncSession, assignment_id: int, class_ids):
    """整体替换作业定向班级。"""
    await db.execute(assignment_classes.delete().where(assignment_classes.c.assignment_id == assignment_id))
    for cid in class_ids or []:
        await db.execute(assignment_classes.insert().values(assignment_id=assignment_id, class_id=cid))


def _to_response(a: Assignment, class_ids) -> AssignmentResponse:
    return AssignmentResponse(
        id=a.id, title=a.title, description=a.description or "", course_id=a.course_id,
        deadline=a.deadline, attachments=a.attachments or "", max_file_size_mb=a.max_file_size_mb or 50,
        auto_ai_grade=bool(a.auto_ai_grade), class_ids=class_ids or [], created_at=a.created_at,
    )


@router.get("/", response_model=List[AssignmentResponse])
async def list_assignments(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == "admin":
        result = await db.execute(select(Assignment))
    elif current_user.role == "teacher":
        result = await db.execute(
            select(Assignment)
            .join(Course, Assignment.course_id == Course.id)
            .where(Course.teacher_id == current_user.id)
        )
    else:  # student
        # 学生可见范围严格按班级：
        #   1) 作业被定向到我所在的某个班级；或
        #   2) 作业无定向（旧数据），但我所在班级关联了该作业的课程
        # 不再按 school_id 放行全校课程，避免跨班/跨课程串台
        my_class_ids = (await db.execute(
            select(class_students.c.class_id)
            .where(class_students.c.student_id == current_user.id)
        )).scalars().all()
        if not my_class_ids:
            return []
        targeted = (
            select(Assignment)
            .join(assignment_classes, assignment_classes.c.assignment_id == Assignment.id)
            .where(assignment_classes.c.class_id.in_(my_class_ids))
        )
        untargeted = (
            select(Assignment)
            .join(class_courses, class_courses.c.course_id == Assignment.course_id)
            .where(
                class_courses.c.class_id.in_(my_class_ids),
                ~select(assignment_classes.c.assignment_id)
                .where(assignment_classes.c.assignment_id == Assignment.id)
                .exists(),
            )
        )
        result = await db.execute(targeted.union(untargeted))
        rows = result.all()
        ids = [r[0] for r in rows]
        if not ids:
            return []
        assignments = (await db.execute(select(Assignment).where(Assignment.id.in_(ids)))).scalars().all()
        cmap = await _class_ids_map(db, [a.id for a in assignments])
        return [_to_response(a, cmap.get(a.id)) for a in assignments]

    assignments = result.scalars().all()
    cmap = await _class_ids_map(db, [a.id for a in assignments])
    return [_to_response(a, cmap.get(a.id)) for a in assignments]


@router.post("/", response_model=AssignmentResponse, status_code=status.HTTP_201_CREATED)
async def create_assignment(
    data: AssignmentCreate,
    current_user: User = Depends(require_role("admin", "teacher")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Course).where(Course.id == data.course_id))
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")
    if current_user.role != "admin" and course.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权为此课程创建作业")
    payload = data.model_dump()
    class_ids = payload.pop("class_ids", None) or []
    await _validate_class_ids(db, class_ids, data.course_id)
    assignment = await assignment_service.create_assignment(db, **payload)
    await _set_assignment_classes(db, assignment.id, class_ids)
    await db.commit()
    return _to_response(assignment, class_ids)


@router.get("/{assignment_id}", response_model=AssignmentResponse)
async def get_assignment(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    assignment = await assignment_service.get_assignment(db, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="作业不存在")
    ids = (await db.execute(
        select(assignment_classes.c.class_id).where(assignment_classes.c.assignment_id == assignment_id)
    )).scalars().all()
    return _to_response(assignment, list(ids))


@router.put("/{assignment_id}", response_model=AssignmentResponse)
async def update_assignment(
    assignment_id: int,
    data: AssignmentUpdate,
    current_user: User = Depends(require_role("admin", "teacher")),
    db: AsyncSession = Depends(get_db),
):
    assignment = await assignment_service.get_assignment(db, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="作业不存在")
    if current_user.role != "admin":
        result = await db.execute(select(Course).where(Course.id == assignment.course_id))
        course = result.scalar_one_or_none()
        if course and course.teacher_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权修改此作业")
    update_data = data.model_dump(exclude_unset=True)
    # class_ids 显式提供时整体替换定向（空列表 = 清空定向，回退课程全班可见）
    new_class_ids = update_data.pop("class_ids", None) if "class_ids" in update_data else None
    if update_data:
        assignment = await assignment_service.update_assignment(db, assignment, **update_data)
    if new_class_ids is not None:
        new_class_ids = list(new_class_ids or [])
        await _validate_class_ids(db, new_class_ids, assignment.course_id)
        await _set_assignment_classes(db, assignment.id, new_class_ids)
        await db.commit()
    ids = (await db.execute(
        select(assignment_classes.c.class_id).where(assignment_classes.c.assignment_id == assignment_id)
    )).scalars().all()
    return _to_response(assignment, list(ids))


@router.delete("/{assignment_id}")
async def delete_assignment(
    assignment_id: int,
    current_user: User = Depends(require_role("admin", "teacher")),
    db: AsyncSession = Depends(get_db),
):
    assignment = await assignment_service.get_assignment(db, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="作业不存在")
    if current_user.role != "admin":
        result = await db.execute(select(Course).where(Course.id == assignment.course_id))
        course = result.scalar_one_or_none()
        if not course or course.teacher_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权删除此作业")
    # Delete associated submissions first
    await db.execute(sql_delete(Submission).where(Submission.assignment_id == assignment_id))
    await db.execute(assignment_classes.delete().where(assignment_classes.c.assignment_id == assignment_id))
    await db.delete(assignment)
    await db.commit()
    return {"message": "作业已删除"}
