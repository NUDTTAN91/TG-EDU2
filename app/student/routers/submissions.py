import os
import re
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, Request, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text
from pydantic import BaseModel, Field
from typing import Optional, Set, Tuple
from datetime import datetime
from pathlib import Path

from app.utils.time_util import cst_now
from app.database import get_db
from app.models.user import User
from app.models.submission import Submission
from app.models.assignment import Assignment
from app.models.course import Course
from app.models.school import School
from app.models.school_class import Class, class_students
from app.config import settings
from app.utils.dependencies import get_current_user, require_role
from app.utils.audit import log_action
from app.teacher.services import assignment_service
from app.student.services import submission_service, late_submission_service


router = APIRouter(prefix="/api/submissions", tags=["提交"])


# ============================================================================
# 常量与工具
# ============================================================================

DEFAULT_ATTACHMENTS = ".cpp,.c,.java,.py,.zip"
DEFAULT_MAX_FILE_SIZE_MB = 50
CHUNK_SIZE = 1024 * 1024  # 1 MB

# 服务端硬白名单：所有作业允许上传的扩展名的并集。教师端 attachments 需为其子集。
# 注意：不包含 .html / .js / .svg 等浏览器可能作为 web 内容执行的扩展名。
HARD_ALLOWED_EXTENSIONS = {
    '.pdf', '.doc', '.docx', '.txt', '.md',
    '.zip', '.rar', '.7z', '.tar', '.gz',
    '.png', '.jpg', '.jpeg', '.gif', '.bmp',
    '.py', '.java', '.cpp', '.c', '.h', '.hpp',
    '.xlsx', '.xls', '.pptx', '.ppt', '.csv',
}


def _safe_name(name: str) -> str:
    """将名称转为安全的文件夹名（去除特殊字符与目录遍历）。"""
    if not name:
        return "unknown"
    cleaned = re.sub(r'[\\/:*?"<>|]', '', name).strip()
    # 剥离前导点，避免出现 .. 或以点开头的隐藏目录
    cleaned = cleaned.lstrip('.').strip() or "unknown"
    return cleaned


def _normalize_ext(ext: str) -> str:
    """扩展名标准化：小写 + 强制以点开头。空扩展名保持空字符串。"""
    if not ext:
        return ""
    ext = ext.strip().lower()
    return ext if ext.startswith('.') else '.' + ext


def _parse_allowed_extensions(raw: Optional[str]) -> Set[str]:
    """解析 assignment.attachments 字段，兼容大小写与前导点缺失。"""
    source = raw or DEFAULT_ATTACHMENTS
    result: Set[str] = set()
    for item in source.split(','):
        item = item.strip()
        if not item:
            continue
        result.add(_normalize_ext(item))
    return result


def _max_size_bytes(assignment: Assignment) -> int:
    mb = assignment.max_file_size_mb or DEFAULT_MAX_FILE_SIZE_MB
    if mb <= 0:
        mb = DEFAULT_MAX_FILE_SIZE_MB
    return mb * 1024 * 1024


async def _ensure_assignment_folder(db: AsyncSession, assignment: Assignment) -> str:
    """确保 assignment.folder_name 存在，返回权威值。使用原子 UPDATE 处理并发。"""
    if assignment.folder_name:
        return assignment.folder_name

    # 生成候选 folder_name
    assign_time = (
        assignment.created_at.strftime("%Y%m%d%H%M%S")
        if assignment.created_at
        else cst_now().strftime("%Y%m%d%H%M%S")
    )
    assign_uuid = uuid.uuid4().hex[:16]
    candidate = f"{assign_time}_{_safe_name(assignment.title)}_{assign_uuid}"

    # 原子 upsert：只在 folder_name IS NULL 时写入
    await db.execute(
        text("UPDATE assignments SET folder_name = :folder WHERE id = :aid AND folder_name IS NULL"),
        {"folder": candidate, "aid": assignment.id},
    )
    await db.commit()

    # 重新读取权威值（可能是其他并发请求写入的）
    result = await db.execute(
        text("SELECT folder_name FROM assignments WHERE id = :aid"),
        {"aid": assignment.id},
    )
    row = result.first()
    final_folder = row[0] if row and row[0] else candidate
    assignment.folder_name = final_folder
    return final_folder


async def _resolve_upload_context(
    db: AsyncSession, assignment: Assignment, current_user: User
) -> Tuple[str, str, str, str]:
    """构建学校名/班级名/课程名/作业文件夹（用于四级目录路径）。"""
    # 课程
    course_result = await db.execute(
        select(Course).where(Course.id == assignment.course_id)
    )
    course = course_result.scalar_one_or_none()

    # 学校名
    school_name = "unknown"
    if course and course.school_id:
        school_result = await db.execute(
            select(School).where(School.id == course.school_id)
        )
        school = school_result.scalar_one_or_none()
        school_name = _safe_name(school.name if school else "")

    course_name = _safe_name(course.name if course else "")

    # 查找学生在此课程对应的班级（可能有多个班，取一个即可）
    class_result = await db.execute(
        select(Class)
        .join(class_students, Class.id == class_students.c.class_id)
        .where(
            class_students.c.student_id == current_user.id,
            Class.course_id == assignment.course_id,
        )
        .order_by(Class.id)
        .limit(1)
    )
    student_class = class_result.scalars().first()

    # 兜底：查学生的任意班级
    if not student_class:
        fallback = await db.execute(
            select(Class)
            .join(class_students, Class.id == class_students.c.class_id)
            .where(class_students.c.student_id == current_user.id)
            .order_by(Class.id)
            .limit(1)
        )
        student_class = fallback.scalars().first()

    class_name = _safe_name(student_class.name if student_class else "")

    assign_folder = await _ensure_assignment_folder(db, assignment)
    return school_name, class_name, course_name, assign_folder


def _build_filename(current_user: User, file_ext: str) -> str:
    """新文件名：学号_姓名_时间_16位uuid.扩展名"""
    student_number = _safe_name(current_user.username or "")
    student_name = _safe_name(current_user.full_name or current_user.username or "")
    submit_time = cst_now().strftime("%Y%m%d%H%M%S")
    short_uuid = uuid.uuid4().hex[:16]
    return f"{student_number}_{student_name}_{submit_time}_{short_uuid}{file_ext}"


async def _stream_write(upload: UploadFile, dest_path: str, max_size: int) -> None:
    """流式写入并累计字节数；超限或异常时清理 tmp 文件。"""
    tmp_path = dest_path + ".tmp"
    written = 0
    try:
        with open(tmp_path, "wb") as f:
            while True:
                chunk = await upload.read(CHUNK_SIZE)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_size:
                    raise HTTPException(status_code=400, detail="文件大小超过限制")
                f.write(chunk)
        os.replace(tmp_path, dest_path)
    except Exception:
        # 清理 tmp
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass
        raise


def _validate_file_ext(file_ext: str, assignment: Assignment) -> None:
    if not file_ext:
        raise HTTPException(status_code=400, detail="缺少文件扩展名")
    if file_ext not in HARD_ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"不允许的文件格式: {file_ext}")
    allowed = _parse_allowed_extensions(assignment.attachments)
    if file_ext not in allowed:
        raise HTTPException(status_code=400, detail=f"不允许的文件格式: {file_ext}")


def _safe_upload_path(*parts: str) -> str:
    """拼接上传路径并强制约束在 UPLOAD_DIR 之下，防止路径遍历。"""
    root = Path(settings.UPLOAD_DIR).resolve()
    joined = root.joinpath(*parts).resolve()
    if root != joined and root not in joined.parents:
        raise HTTPException(status_code=400, detail="非法的目标路径")
    return str(joined)


async def _authorize_submission_access(
    db: AsyncSession, submission: Submission, current_user: User
) -> None:
    """归属校验：本人 / 该课程教师 / admin，其他一律 403。"""
    if current_user.role == "admin":
        return
    if current_user.role == "student":
        if submission.student_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权访问此提交")
        return
    # teacher
    assignment_result = await db.execute(
        select(Assignment).where(Assignment.id == submission.assignment_id)
    )
    assignment = assignment_result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="关联作业不存在")
    course_result = await db.execute(
        select(Course).where(Course.id == assignment.course_id)
    )
    course = course_result.scalar_one_or_none()
    if not course or course.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此提交")


# ============================================================================
# Pydantic 模型
# ============================================================================

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


# ============================================================================
# POST /api/submissions/  提交作业（首次）
# ============================================================================

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

    # 截止时间检查：若逾期，需已批准的补交申请方可提交
    if assignment.deadline and cst_now() > assignment.deadline:
        has_approved = await late_submission_service.get_approved_late_for_assignment(
            db, assignment_id, current_user.id
        )
        if not has_approved:
            raise HTTPException(status_code=403, detail="已过截止时间，请申请补交")

    # 重复提交检查（POST 只处理首次；覆盖走 PUT）
    existing = await submission_service.get_submission_by_student_assignment(
        db, current_user.id, assignment_id
    )
    if existing:
        raise HTTPException(
            status_code=409, detail="你已提交过此作业，如需更新请使用重新提交"
        )

    # 文件扩展名与大小
    safe_filename = os.path.basename(file.filename or "unknown")
    file_ext = _normalize_ext(os.path.splitext(safe_filename)[1])
    _validate_file_ext(file_ext, assignment)
    max_size = _max_size_bytes(assignment)

    # 目录 + 文件名
    school_name, class_name, course_name, assign_folder = await _resolve_upload_context(
        db, assignment, current_user
    )
    upload_subdir = _safe_upload_path(school_name, class_name, course_name, assign_folder)
    os.makedirs(upload_subdir, exist_ok=True)
    new_filename = _build_filename(current_user, file_ext)
    file_path = os.path.join(upload_subdir, new_filename)

    # 流式写入
    await _stream_write(file, file_path, max_size)

    # 写入 DB；失败则回滚并删文件
    try:
        submission = await submission_service.create_submission(
            db,
            assignment_id=assignment_id,
            student_id=current_user.id,
            file_path=file_path,
            file_name=safe_filename,
        )
    except Exception:
        await db.rollback()
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError:
                pass
        raise

    return submission


# ============================================================================
# PUT /api/submissions/{id}  重新提交（覆盖）
# ============================================================================

@router.put("/{submission_id}", response_model=SubmissionResponse)
async def resubmit_assignment(
    submission_id: int,
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(require_role("student")),
    db: AsyncSession = Depends(get_db),
):
    submission = await submission_service.get_submission(db, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="提交不存在")
    if submission.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权修改此提交")

    assignment = await assignment_service.get_assignment(db, submission.assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="关联作业不存在")

    # 规则：仅 deadline 前允许重新提交
    if assignment.deadline and cst_now() >= assignment.deadline:
        raise HTTPException(status_code=403, detail="已过截止时间，无法重新提交")

    # 文件扩展名与大小
    safe_filename = os.path.basename(file.filename or "unknown")
    file_ext = _normalize_ext(os.path.splitext(safe_filename)[1])
    _validate_file_ext(file_ext, assignment)
    max_size = _max_size_bytes(assignment)

    # 目录 + 新文件名（复用同一 assignment folder）
    school_name, class_name, course_name, assign_folder = await _resolve_upload_context(
        db, assignment, current_user
    )
    upload_subdir = _safe_upload_path(school_name, class_name, course_name, assign_folder)
    os.makedirs(upload_subdir, exist_ok=True)
    new_filename = _build_filename(current_user, file_ext)
    new_file_path = os.path.join(upload_subdir, new_filename)

    old_file_path = submission.file_path

    # 写入新文件（流式 + 原子）
    await _stream_write(file, new_file_path, max_size)

    # 更新 DB；失败时删除新文件回滚
    try:
        submission = await submission_service.update_submission_file(
            db, submission, file_path=new_file_path, file_name=safe_filename
        )
    except Exception:
        await db.rollback()
        if os.path.exists(new_file_path):
            try:
                os.remove(new_file_path)
            except OSError:
                pass
        raise

    # DB 更新成功后再删旧文件（避免 DB 失败时学生数据全丢）
    if old_file_path and old_file_path != new_file_path and os.path.isfile(old_file_path):
        try:
            os.remove(old_file_path)
        except OSError:
            pass

    ip = request.client.host if request.client else None
    await log_action(
        db,
        action="resubmit",
        category="submission",
        user_id=current_user.id,
        username=current_user.username,
        detail=f"重新提交了作业 #{assignment.id} 提交 #{submission.id}",
        ip_address=ip,
    )
    return submission


# ============================================================================
# GET /api/submissions/  列表
# ============================================================================

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
        count_q = select(func.count()).select_from(filtered_query.subquery())
        total = (await db.execute(count_q)).scalar() or 0
        paged = filtered_query.offset((page - 1) * _page_size).limit(_page_size)
        result = await db.execute(paged)
        rows = result.all()
        items = [_row_to_response(row) for row in rows]
        return {"items": items, "total": total, "page": page, "page_size": _page_size}

    result = await db.execute(filtered_query)
    rows = result.all()
    return [_row_to_response(row) for row in rows]


def _row_to_response(row):
    return SubmissionResponse(
        id=row.Submission.id,
        assignment_id=row.Submission.assignment_id,
        student_id=row.Submission.student_id,
        file_name=row.Submission.file_name,
        # file_path 保留以兼容旧前端，但不再作为下载入口
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


# ============================================================================
# GET /api/submissions/{id}  单条
# ============================================================================

@router.get("/{submission_id}", response_model=SubmissionResponse)
async def get_submission(
    submission_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    submission = await submission_service.get_submission(db, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="提交不存在")
    await _authorize_submission_access(db, submission, current_user)
    return submission


# ============================================================================
# GET /api/submissions/{id}/download  鉴权下载
# ============================================================================

@router.get("/{submission_id}/download")
async def download_submission(
    submission_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    submission = await submission_service.get_submission(db, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="提交不存在")
    await _authorize_submission_access(db, submission, current_user)

    file_path = submission.file_path
    if not file_path or not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="文件已丢失")

    filename = submission.file_name or os.path.basename(file_path)
    response = FileResponse(
        path=file_path,
        filename=filename,
        media_type="application/octet-stream",
    )
    # 强制附件下载，禁止内容嗅探
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


# ============================================================================
# PUT /api/submissions/{id}/grade  教师批改
# ============================================================================

@router.put("/{submission_id}/grade")
async def grade_submission(
    submission_id: int,
    data: GradeRequest,
    request: Request,
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

    ip = request.client.host if request.client else None
    await log_action(
        db,
        action="grade_submission",
        category="submission",
        user_id=current_user.id,
        username=current_user.username,
        detail=f"批改了提交 #{submission.id}，分数 {submission.grade}",
        ip_address=ip,
    )
    return {"message": "评分成功", "submission_id": submission.id, "grade": submission.grade}
