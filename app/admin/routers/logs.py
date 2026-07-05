from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.database import get_db
from app.utils.dependencies import require_role
from app.models.audit_log import AuditLog
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
    query = select(AuditLog).order_by(desc(AuditLog.created_at))
    if category and category != "all":
        query = query.where(AuditLog.category == category)
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    return result.scalars().all()
