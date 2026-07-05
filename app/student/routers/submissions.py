import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
from app.utils.time_util import cst_now
from app.database import get_db
from app.models.user import User
from app.models.submission import Submission
from app.models.assignment import Assignment
from app.models.course import Course
from app.models.school import School
from app.models.school_class import Class, class_students
import re

def _safe_name(name: str) -> str:
    """将名称转为安全的文件夹名（去除特殊字符）"""
    if not name:
        return "unknown"
    return re.sub(r'[\\/:*?"<>|]', '', name).strip() or "unknown"
from app.config import settings
from app.utils.dependencies import get_current_user, require_role
from app.teacher.services import assignment_service
from app.student.services import submission_service

router = APIRouter(prefix="/api/submissions", tags=["提交"])


class SubmissionResponse(BaseModel):
    id: int
    assignment_id: int
    student_id: int
    file_name: str
    file_path: Optional[str] = None
    status: str
    grade: Optional[int] = None
    feedback: str = ""
    submitted_at: datetime
    graded_at: Optional[datetime] = None
    student_name: Optional[str] = None
    username: Optional[str] = None
    avatar: Optional[str] = None

    model_config = {"from_attributes": True}


class GradeRequest(BaseModel):
    grade: int = Field(ge=0, le=100)
    feedback: str = ""


@router.post("/", response_model=SubmissionResponse, status_code=status.HTTP_201_CREATED)
async def submit_assignment(
    assignment_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(require_role("student")),
    db: AsyncSession = Depends(get_db),
):
    assignment = await assignment_service.get_assignment(db, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="作业不存在")

    # 截止时间检查
    if assignment.deadline and cst_now() > assignment.deadline:
        raise HTTPException(status_code=403, detail="已过截止时间，请申请补交")

    # 重复提交检查
    existing = await db.execute(
        select(Submission).where(
            Submission.assignment_id == assignment_id,
            Submission.student_id == current_user.id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="你已提交过此作业，如需更新请联系教师")

    safe_filename = os.path.basename(file.filename or "unknown")
    file_ext = os.path.splitext(safe_filename)[1].lower()
    ALLOWED_EXTENSIONS = {'.pdf', '.doc', '.docx', '.txt', '.zip', '.rar', '.7z', '.png', '.jpg', '.jpeg', '.py', '.java', '.cpp', '.c', '.h', '.js', '.html', '.css', '.xlsx', '.xls', '.pptx', '.ppt'}
    if file_ext and file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"不允许的文件格式: {file_ext}")

    allowed = [f.strip() for f in assignment.attachments.split(",")]
    if file_ext not in allowed:
        raise HTTPException(status_code=400, detail=f"不允许的文件格式: {file_ext}")

    # 查询归属链（用名称而非ID）
    course_result = await db.execute(select(Course).where(Course.id == assignment.course_id))
    course = course_result.scalar_one_or_none()

    # 获取学校名
    school_name = "unknown"
    if course and course.school_id:
        school_result = await db.execute(select(School).where(School.id == course.school_id))
        school = school_result.scalar_one_or_none()
        school_name = _safe_name(school.name if school else "")

    # 获取课程名
    course_name = _safe_name(course.name if course else "")

    # 查找学生在此课程对应的班级
    class_result = await db.execute(
        select(Class).join(class_students, Class.id == class_students.c.class_id)
        .where(class_students.c.student_id == current_user.id, Class.course_id == assignment.course_id)
    )
    student_class = class_result.scalar_one_or_none()

    # 兜底：如果没找到，查找学生所在的任意班级（不限制 course_id）
    if not student_class:
        fallback_result = await db.execute(
            select(Class).join(class_students, Class.id == class_students.c.class_id)
            .where(class_students.c.student_id == current_user.id)
        )
        student_class = fallback_result.scalar_one_or_none()

    class_name = _safe_name(student_class.name if student_class else "")

    # 新文件名：学号_姓名_时间_16位uuid.扩展名
    student_number = current_user.username
    student_name = current_user.full_name or current_user.username
    submit_time = cst_now().strftime("%Y%m%d%H%M%S")
    short_uuid = uuid.uuid4().hex[:16]
    new_filename = f"{student_number}_{student_name}_{submit_time}_{short_uuid}{file_ext}"

    # 使用作业创建时已生成的文件夹名（确保同一作业的所有提交在同一文件夹）
    if assignment.folder_name:
        assign_folder = assignment.folder_name
    else:
        # 兆底：旧作业没有 folder_name 时动态生成并保存
        assign_time = assignment.created_at.strftime("%Y%m%d%H%M%S") if assignment.created_at else "00000000000000"
        assign_uuid = uuid.uuid4().hex[:16]
        assign_folder = f"{assign_time}_{_safe_name(assignment.title)}_{assign_uuid}"
        assignment.folder_name = assign_folder
        db.add(assignment)
        await db.commit()

    # 构建四级目录路径（学校名/班级名/课程名/作业文件夹）
    upload_subdir = os.path.join(
        settings.UPLOAD_DIR,
        school_name,
        class_name,
        course_name,
        assign_folder
    )
    os.makedirs(upload_subdir, exist_ok=True)
    file_path = os.path.join(upload_subdir, new_filename)

    content = await file.read()
    if len(content) > assignment.max_file_size_mb * 1024 * 1024:
        raise HTTPException(status_code=400, detail="文件大小超过限制")

    with open(file_path, "wb") as f:
        f.write(content)

    try:
        submission = await submission_service.create_submission(
            db,
            assignment_id=assignment_id,
            student_id=current_user.id,
            file_path=file_path,
            file_name=safe_filename,
        )
        return submission
    except Exception:
        await db.rollback()
        # DB 失败时回滚文件
        if os.path.exists(file_path):
            os.remove(file_path)
        raise


@router.get("/")
async def list_submissions(
    assignment_id: Optional[int] = None,
    page: Optional[int] = Query(None, ge=1),
    page_size: Optional[int] = Query(None, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    base_query = select(Submission, User.username, User.full_name, User.avatar).join(
        User, Submission.student_id == User.id
    )
    if assignment_id:
        base_query = base_query.where(Submission.assignment_id == assignment_id)

    if current_user.role == "admin":
        filtered_query = base_query
    elif current_user.role == "teacher":
        filtered_query = (
            base_query
            .join(Assignment, Submission.assignment_id == Assignment.id)
            .join(Course, Assignment.course_id == Course.id)
            .where(Course.teacher_id == current_user.id)
        )
    else:
        filtered_query = base_query.where(Submission.student_id == current_user.id)

    # Paginated mode
    if page is not None:
        _page_size = page_size or 20
        # Count total
        count_q = select(func.count()).select_from(filtered_query.subquery())
        total = (await db.execute(count_q)).scalar() or 0
        # Fetch page
        paged = filtered_query.offset((page - 1) * _page_size).limit(_page_size)
        result = await db.execute(paged)
        rows = result.all()
        items = [_row_to_response(row) for row in rows]
        return {"items": items, "total": total, "page": page, "page_size": _page_size}

    # Legacy mode: return plain list
    result = await db.execute(filtered_query)
    rows = result.all()
    return [_row_to_response(row) for row in rows]


def _row_to_response(row):
    return SubmissionResponse(
        id=row.Submission.id,
        assignment_id=row.Submission.assignment_id,
        student_id=row.Submission.student_id,
        file_name=row.Submission.file_name,
        file_path=row.Submission.file_path,
        status=row.Submission.status,
        grade=row.Submission.grade,
        feedback=row.Submission.feedback,
        submitted_at=row.Submission.submitted_at,
        graded_at=row.Submission.graded_at,
        student_name=row.full_name or "",
        username=row.username or "",
        avatar=row.avatar or None,
    )


@router.get("/{submission_id}", response_model=SubmissionResponse)
async def get_submission(
    submission_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    submission = await submission_service.get_submission(db, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="提交不存在")
    if current_user.role == "student" and submission.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权查看此提交")
    return submission


@router.put("/{submission_id}/grade")
async def grade_submission(
    submission_id: int,
    data: GradeRequest,
    current_user: User = Depends(require_role("admin", "teacher")),
    db: AsyncSession = Depends(get_db),
):
    submission = await submission_service.get_submission(db, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="提交不存在")

    # 教师课程归属校验
    assignment_result = await db.execute(
        select(Assignment).where(Assignment.id == submission.assignment_id)
    )
    assignment = assignment_result.scalar_one_or_none()

    if current_user.role == "teacher":
        if not assignment:
            raise HTTPException(status_code=404, detail="关联的作业不存在")
        course_result = await db.execute(
            select(Course).where(Course.id == assignment.course_id)
        )
        course = course_result.scalar_one_or_none()
        if not course or course.teacher_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权批改此作业")

    submission = await submission_service.grade_submission(
        db, submission, data.grade, data.feedback, current_user.id
    )
    return {"message": "评分成功", "submission_id": submission.id, "grade": submission.grade}
