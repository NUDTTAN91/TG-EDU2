from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import List, Literal, Optional
from app.database import get_db
from app.models.user import User
from app.utils.dependencies import require_role
from app.admin.services import admin_service
from app.utils.audit import log_action

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
