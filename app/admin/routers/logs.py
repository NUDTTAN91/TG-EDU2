from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.database import get_db
from app.utils.dependencies import require_role
from app.models.audit_log import AuditLog
from app.models.user import User
from app.models.school import School
from app.models.school_class import Class, class_students
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

router = APIRouter(prefix="/api/admin/logs", tags=["审计日志"])


class LogResponse(BaseModel):
    id: int
    action: str
    category: str
    user_id: Optional[int] = None
    username: Optional[str] = None
    full_name: Optional[str] = None
    role: Optional[str] = None
    school_name: Optional[str] = None
    class_name: Optional[str] = None
    detail: Optional[str] = None
    ip_address: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


@router.get("/", response_model=List[LogResponse])
async def get_logs(
    category: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("admin")),
):
    query = (
        select(AuditLog, User.full_name, User.role, User.school_id)
        .outerjoin(User, AuditLog.user_id == User.id)
        # 同一微秒/同一秒内的事件用自增 id 做 tie-breaker，保证因果顺序稳定（新在上）
        .order_by(desc(AuditLog.created_at), desc(AuditLog.id))
    )
    if category and category != "all":
        query = query.where(AuditLog.category == category)
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    rows = result.all()

    # 班级/学校列：按本页涉及的用户批量补全，避免逐行 N+1 查询
    user_ids = {row[0].user_id for row in rows if row[0].user_id}
    school_map = {}
    class_rows = []
    if user_ids:
        school_map = dict((await db.execute(select(School.id, School.name))).all())
        class_rows = (await db.execute(
            select(class_students.c.student_id, Class.name)
            .join(Class, Class.id == class_students.c.class_id)
            .where(class_students.c.student_id.in_(user_ids))
        )).all()
    class_map = {}
    for uid, cname in class_rows:
        class_map.setdefault(uid, []).append(cname)

    return [
        LogResponse(
            id=log.id,
            action=log.action,
            category=log.category,
            user_id=log.user_id,
            username=log.username,
            full_name=full_name or None,
            role=role or None,
            school_name=school_map.get(school_id) if school_id else None,
            # 一人多班时用顿号拼接；无班级/无操作者（AI 行）为 None
            class_name="、".join(class_map.get(log.user_id, [])) or None,
            detail=log.detail,
            ip_address=log.ip_address,
            created_at=log.created_at,
        )
        for log, full_name, role, school_id in rows
    ]
