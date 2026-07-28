from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sql_delete
from pydantic import BaseModel, field_validator
from typing import List, Optional
from datetime import datetime
from app.database import get_db
from app.models.user import User
from app.models.assignment import Assignment
from app.models.course import Course
from app.models.submission import Submission
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
    created_at: datetime

    model_config = {"from_attributes": True}


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
        if current_user.school_id:
            # 查询学生所在学校的全部课程下的作业
            result = await db.execute(
                select(Assignment)
                .join(Course, Assignment.course_id == Course.id)
                .where(Course.school_id == current_user.school_id)
                .distinct()
            )
        else:
            # 学生没有学校时，回退到通过班级课程关联查询
            from app.models.school_class import class_students, Class
            result = await db.execute(
                select(Assignment)
                .join(Course, Assignment.course_id == Course.id)
                .join(Class, Class.course_id == Course.id)
                .join(class_students, Class.id == class_students.c.class_id)
                .where(class_students.c.student_id == current_user.id)
                .distinct()
            )
    assignments = result.scalars().all()
    return assignments


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
    assignment = await assignment_service.create_assignment(db, **data.model_dump())
    return assignment


@router.get("/{assignment_id}", response_model=AssignmentResponse)
async def get_assignment(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    assignment = await assignment_service.get_assignment(db, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="作业不存在")
    return assignment


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
    if update_data:
        assignment = await assignment_service.update_assignment(db, assignment, **update_data)
    return assignment


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
    await db.delete(assignment)
    await db.commit()
    return {"message": "作业已删除"}
