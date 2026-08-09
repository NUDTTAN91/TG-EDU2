from io import BytesIO
from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import List, Literal, Optional
from app.database import get_db
from app.models.user import User
from app.models.course import Course
from app.models.submission import Submission
from app.models.late_submission import LateSubmission
from app.models.audit_log import AuditLog
from app.models.school_class import class_students
from app.utils.dependencies import require_role
from app.admin.services import admin_service
from app.utils.audit import log_action
from app.utils.ip_util import get_client_ip

router = APIRouter(prefix="/api/admin", tags=["管理"])


class UserCreate(BaseModel):
    username: str
    full_name: str
    password: str = "123456"
    role: Literal["teacher", "student"] = "teacher"
    school_id: Optional[int] = None
    class_id: Optional[int] = None


class StudentImport(BaseModel):
    username: str
    full_name: str
    password: str = "123456"


class StatsResponse(BaseModel):
    total_users: int
    total_teachers: int
    total_students: int
    total_courses: int
    total_submissions: int
    total_assignments: int
    total_schools: int


@router.get("/stats", response_model=StatsResponse)
async def get_stats(
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    data = await admin_service.get_stats(db)
    return StatsResponse(**data)


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def create_user(
    data: UserCreate,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    user, error = await admin_service.create_user(
        db, data.username, data.full_name, data.role, data.password, data.school_id, data.class_id
    )
    if error:
        raise HTTPException(status_code=400, detail=error)
    await log_action(
        db,
        action="create_user",
        category="user_management",
        user_id=current_user.id,
        username=current_user.username,
        detail=f"创建了用户 {data.username}",
    )
    return {"message": "用户创建成功", "id": user.id}


@router.post("/import-students", status_code=status.HTTP_201_CREATED)
async def import_students(
    students: List[StudentImport],
    current_user: User = Depends(require_role("admin", "teacher")),
    db: AsyncSession = Depends(get_db),
):
    count = await admin_service.import_students(db, students)
    return {"message": f"成功导入 {count} 名学生", "count": count}


# ============================================================================
# 批量导入用户 (xlsx)
# ============================================================================

MAX_IMPORT_FILE_SIZE = 2 * 1024 * 1024  # 2 MB


@router.get("/import-users/template")
async def download_import_template(
    current_user: User = Depends(require_role("admin")),
):
    """下载用户导入 xlsx 模板。"""
    try:
        content = admin_service.build_user_import_template()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    filename = "user-import-template.xlsx"
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "X-Content-Type-Options": "nosniff",
    }
    return StreamingResponse(
        BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@router.post("/import-users", status_code=status.HTTP_200_OK)
async def import_users(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """批量导入用户（学生 + 教师）。学校名从 xlsx 行内读取，学校/班级不存在将自动创建。"""
    # 文件扩展名
    filename = (file.filename or "").strip()
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="文件格式不对，需为 .xlsx")

    # 流式读取并限制大小，避免一次性读入过大文件
    buf = BytesIO()
    total = 0
    chunk_size = 128 * 1024
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_IMPORT_FILE_SIZE:
            raise HTTPException(status_code=400, detail="文件过大，上限 2 MB")
        buf.write(chunk)
    file_bytes = buf.getvalue()

    if not file_bytes:
        raise HTTPException(status_code=400, detail="文件为空")

    try:
        report = await admin_service.import_users_from_xlsx(db, file_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    ip = get_client_ip(request)
    await log_action(
        db,
        action="import_users",
        category="user_management",
        user_id=current_user.id,
        username=current_user.username,
        detail=(
            f"批量导入用户 学生{report['created_students']}人 教师{report['created_teachers']}人 "
            f"新建学校{report['created_schools']}个 新建班级{report['created_classes']}个 "
            f"跳过{len(report['skipped'])}行"
        ),
        ip_address=ip,
    )
    return report


@router.get("/users")
async def list_users(
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    users = await admin_service.get_users(db)
    result = []
    for u in users:
        class_names = ", ".join(c.name for c in u.classes) if u.classes else ""
        result.append({
            "id": u.id, "username": u.username, "full_name": u.full_name,
            "role": u.role, "is_active": u.is_active, "school_id": u.school_id,
            "class_name": class_names,
            "avatar": u.avatar,
            "created_at": str(u.created_at) if u.created_at else None,
        })
    return result


@router.put("/users/{user_id}/toggle")
async def toggle_user(
    user_id: int,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    # 检查目标用户是否为超级管理员
    from app.admin.services.admin_service import get_user_by_id
    target_user = await get_user_by_id(db, user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target_user.role == "admin":
        raise HTTPException(status_code=403, detail="不能修改超级管理员账号")
    user, error = await admin_service.toggle_user_status(db, user_id, current_user.id)
    if error:
        code = 404 if "不存在" in error else 403
        raise HTTPException(status_code=code, detail=error)
    await log_action(
        db,
        action="toggle_user",
        category="user_management",
        user_id=current_user.id,
        username=current_user.username,
        detail=f"切换了用户 {target_user.username} 的状态",
    )
    return {"message": f"用户已{'启用' if user.is_active else '禁用'}"}


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    request: Request,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """删除账号。仅允许删除「无业务数据残留」的账号：
    管理员/自身不可删；名下有课程、有提交、有批改记录者拒绝（改用禁用）。
    清理项：班级成员关系、本人补交申请、本人作为审核人的引用置空、审计日志用户引用置空。"""
    from app.admin.services.admin_service import get_user_by_id
    target = await get_user_by_id(db, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target.role == "admin":
        raise HTTPException(status_code=403, detail="不能删除管理员账号")
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="不能删除当前登录账号")

    # 业务数据残留检查
    course_count = (await db.execute(
        select(func.count(Course.id)).where(Course.teacher_id == user_id)
    )).scalar() or 0
    if course_count > 0:
        raise HTTPException(status_code=400, detail=f"该教师名下仍有 {course_count} 门课程，请先删除或改派课程")
    sub_count = (await db.execute(
        select(func.count(Submission.id)).where(Submission.student_id == user_id)
    )).scalar() or 0
    if sub_count > 0:
        raise HTTPException(status_code=400, detail=f"该学生仍有 {sub_count} 条提交记录，请改用「禁用」保留数据")
    graded_count = (await db.execute(
        select(func.count(Submission.id)).where(Submission.graded_by == user_id)
    )).scalar() or 0
    if graded_count > 0:
        raise HTTPException(status_code=400, detail=f"该账号仍有 {graded_count} 条批改记录，请改用「禁用」保留数据")

    username_snapshot = target.username

    # 清理可安全清理的关联
    await db.execute(class_students.delete().where(class_students.c.student_id == user_id))
    await db.execute(LateSubmission.__table__.delete().where(LateSubmission.student_id == user_id))
    await db.execute(update(LateSubmission).where(LateSubmission.reviewed_by == user_id).values(reviewed_by=None))
    await db.execute(update(AuditLog).where(AuditLog.user_id == user_id).values(user_id=None))

    await db.delete(target)
    await db.commit()
    await log_action(
        db,
        action="delete_user",
        category="user_management",
        user_id=current_user.id,
        username=current_user.username,
        detail=f"删除了账号 {username_snapshot}（#{user_id}）",
        ip_address=get_client_ip(request),
    )
    return {"message": f"账号 {username_snapshot} 已删除"}
