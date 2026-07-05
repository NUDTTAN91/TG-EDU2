import logging
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.audit_log import AuditLog

logger = logging.getLogger(__name__)


async def log_action(
    db: AsyncSession,
    action: str,
    category: str,
    user_id: int = None,
    username: str = None,
    detail: str = None,
    ip_address: str = None,
):
    """写入审计日志，失败不影响主流程。"""
    try:
        log = AuditLog(
            action=action,
            category=category,
            user_id=user_id,
            username=username,
            detail=detail,
            ip_address=ip_address,
        )
        db.add(log)
        await db.commit()
    except Exception:
        logger.exception("审计日志写入失败")
        await db.rollback()
