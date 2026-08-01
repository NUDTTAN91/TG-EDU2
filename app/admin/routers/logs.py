from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.database import get_db
from app.utils.dependencies import require_role
from app.models.audit_log import AuditLog
from app.models.user import User
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
        select(AuditLog, User.full_name)
        .outerjoin(User, AuditLog.user_id == User.id)
        # 同一微秒/同一秒内的事件用自增 id 做 tie-breaker，保证因果顺序稳定（新在上）
        .order_by(desc(AuditLog.created_at), desc(AuditLog.id))
    )
    if category and category != "all":
        query = query.where(AuditLog.category == category)
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    return [
        LogResponse(
            id=log.id,
            action=log.action,
            category=log.category,
            user_id=log.user_id,
            username=log.username,
            full_name=full_name or None,
            detail=log.detail,
            ip_address=log.ip_address,
            created_at=log.created_at,
        )
        for log, full_name in result.all()
    ]
