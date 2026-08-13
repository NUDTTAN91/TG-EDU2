from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sql_delete
from pydantic import BaseModel, field_validator
from typing import List, Optional
from datetime import datetime
import os
import uuid
from app.database import get_db
from app.config import settings
from app.models.user import User
from app.models.assignment import Assignment, assignment_classes
from app.models.assignment_attachment import AssignmentAttachment
from app.models.course import Course
from app.models.submission import Submission
from app.models.school_class import Class, class_students, class_courses
from app.utils.dependencies import get_current_user, require_role
from app.utils.time_util import cst_now
from app.teacher.services import assignment_service

router = APIRouter(prefix="/api/assignments", tags=["作业"])

# 作业附件（材料/卷子）允许格式与存储
ATTACHMENT_EXTS = {
    ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx",
    ".zip", ".rar", ".7z", ".png", ".jpg", ".jpeg", ".txt", ".md",
}
ATTACHMENT_DIR = os.path.join("data", "attachments")
MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024  # 100MB


class AssignmentCreate(BaseModel):
    title: str
    description: str = ""
    course_id: int
    deadline: Optional[datetime] = None
    attachments: str = ".cpp,.c,.java,.py,.zip"
    max_file_size_mb: int = 50
    auto_ai_grade: bool = False
    ai_grading_prompt: str = ""
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
    ai_grading_prompt: Optional[str] = None
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
    ai_grading_prompt: str = ""
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


def _to_response(a: Assignment, class_ids, show_prompt: bool = True) -> AssignmentResponse:
    return AssignmentResponse(
        id=a.id, title=a.title, description=a.description or "", course_id=a.course_id,
        deadline=a.deadline, attachments=a.attachments or "", max_file_size_mb=a.max_file_size_mb or 50,
        auto_ai_grade=bool(a.auto_ai_grade),
        # AI 批改额外要求仅教师/管理员可见，学生端置空
        ai_grading_prompt=(a.ai_grading_prompt or "") if show_prompt else "",
        class_ids=class_ids or [], created_at=a.created_at,
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
        return [_to_response(a, cmap.get(a.id), show_prompt=False) for a in assignments]

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
    return _to_response(assignment, list(ids), show_prompt=(current_user.role != "student"))


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
    # 清理附件文件 + 记录
    atts = (await db.execute(
        select(AssignmentAttachment).where(AssignmentAttachment.assignment_id == assignment_id)
    )).scalars().all()
    for at in atts:
        try:
            if at.file_path and os.path.isfile(at.file_path):
                os.remove(at.file_path)
        except OSError:
            pass
    await db.execute(sql_delete(AssignmentAttachment).where(AssignmentAttachment.assignment_id == assignment_id))
    await db.delete(assignment)
    await db.commit()
    return {"message": "作业已删除"}


# ============================================================================
# 作业附件（教师上传材料/卷子，学生可下载）
# ============================================================================

async def _owner_or_admin(db: AsyncSession, assignment: Assignment, current_user: User):
    if current_user.role == "admin":
        return
    course = (await db.execute(select(Course).where(Course.id == assignment.course_id))).scalar_one_or_none()
    if not course or course.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权操作此作业的附件")


async def _student_can_view_assignment(db: AsyncSession, assignment: Assignment, current_user: User) -> bool:
    """学生可见性：作业定向到其班级，或作业无定向但其班级关联了该课程。"""
    my_class_ids = (await db.execute(
        select(class_students.c.class_id).where(class_students.c.student_id == current_user.id)
    )).scalars().all()
    if not my_class_ids:
        return False
    targeted = (await db.execute(
        select(assignment_classes.c.class_id).where(assignment_classes.c.assignment_id == assignment.id)
    )).scalars().all()
    if targeted:
        return bool(set(targeted) & set(my_class_ids))
    linked = (await db.execute(
        select(class_courses.c.class_id).where(
            class_courses.c.course_id == assignment.course_id,
            class_courses.c.class_id.in_(my_class_ids),
        )
    )).scalars().all()
    return bool(linked)


@router.post("/{assignment_id}/attachments")
async def upload_attachments(
    assignment_id: int,
    files: List[UploadFile] = File(...),
    current_user: User = Depends(require_role("admin", "teacher")),
    db: AsyncSession = Depends(get_db),
):
    assignment = await assignment_service.get_assignment(db, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="作业不存在")
    await _owner_or_admin(db, assignment, current_user)

    saved = []
    for f in files:
        safe_name = os.path.basename(f.filename or "attachment")
        ext = os.path.splitext(safe_name)[1].lower()
        if ext not in ATTACHMENT_EXTS:
            raise HTTPException(status_code=400, detail=f"不支持的附件格式: {ext or '未知'}")
        data = await f.read()
        if len(data) > MAX_ATTACHMENT_BYTES:
            raise HTTPException(status_code=400, detail=f"附件 {safe_name} 超过 100MB 限制")
        dir_path = os.path.join(ATTACHMENT_DIR, str(assignment_id))
        os.makedirs(dir_path, exist_ok=True)
        store_name = f"{uuid.uuid4().hex}_{safe_name}"
        full_path = os.path.join(dir_path, store_name)
        with open(full_path, "wb") as out:
            out.write(data)
        att = AssignmentAttachment(
            assignment_id=assignment_id,
            file_name=safe_name,
            file_path=full_path,
            file_size=len(data),
        )
        db.add(att)
        saved.append(att)
    await db.commit()
    for at in saved:
        await db.refresh(at)
    return {
        "message": f"已上传 {len(saved)} 个附件",
        "attachments": [
            {"id": at.id, "file_name": at.file_name, "file_size": at.file_size}
            for at in saved
        ],
    }


@router.get("/{assignment_id}/attachments")
async def list_attachments(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    assignment = await assignment_service.get_assignment(db, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="作业不存在")
    if current_user.role == "student":
        if not await _student_can_view_assignment(db, assignment, current_user):
            raise HTTPException(status_code=403, detail="无权查看此作业附件")
    elif current_user.role == "teacher":
        await _owner_or_admin(db, assignment, current_user)
    atts = (await db.execute(
        select(AssignmentAttachment)
        .where(AssignmentAttachment.assignment_id == assignment_id)
        .order_by(AssignmentAttachment.id)
    )).scalars().all()
    return [
        {"id": at.id, "file_name": at.file_name, "file_size": at.file_size,
         "created_at": at.created_at}
        for at in atts
    ]


@router.get("/attachments/{att_id}/download")
async def download_attachment(
    att_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    att = (await db.execute(
        select(AssignmentAttachment).where(AssignmentAttachment.id == att_id)
    )).scalar_one_or_none()
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")
    assignment = await assignment_service.get_assignment(db, att.assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="作业不存在")
    if current_user.role == "student":
        if not await _student_can_view_assignment(db, assignment, current_user):
            raise HTTPException(status_code=403, detail="无权下载此附件")
    elif current_user.role == "teacher":
        await _owner_or_admin(db, assignment, current_user)
    if not att.file_path or not os.path.isfile(att.file_path):
        raise HTTPException(status_code=404, detail="附件文件已丢失")
    return FileResponse(
        path=att.file_path,
        filename=att.file_name,
        media_type="application/octet-stream",
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.delete("/attachments/{att_id}")
async def delete_attachment(
    att_id: int,
    current_user: User = Depends(require_role("admin", "teacher")),
    db: AsyncSession = Depends(get_db),
):
    att = (await db.execute(
        select(AssignmentAttachment).where(AssignmentAttachment.id == att_id)
    )).scalar_one_or_none()
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")
    assignment = await assignment_service.get_assignment(db, att.assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="作业不存在")
    await _owner_or_admin(db, assignment, current_user)
    try:
        if att.file_path and os.path.isfile(att.file_path):
            os.remove(att.file_path)
    except OSError:
        pass
    await db.delete(att)
    await db.commit()
    return {"message": "附件已删除"}
