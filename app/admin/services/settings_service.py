"""系统设置服务：AI 批改配置的读取/保存/掩码。DB KV 优先，.env 兜底。"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.models.setting import SystemSetting

AI_SETTING_KEYS = [
    "ai_base_url", "ai_api_key", "ai_doc_model", "ai_text_model",
    "ai_thinking", "ai_dpi", "ai_jpeg_quality", "ai_max_pages",
]


def _defaults() -> dict:
    return {
        "ai_base_url": settings.AI_BASE_URL,
        "ai_api_key": settings.AI_API_KEY,
        "ai_doc_model": settings.AI_DOC_MODEL,
        "ai_text_model": settings.AI_TEXT_MODEL,
        "ai_thinking": "1" if settings.AI_THINKING else "0",
        "ai_dpi": str(settings.AI_DPI),
        "ai_jpeg_quality": str(settings.AI_JPEG_QUALITY),
        "ai_max_pages": str(settings.AI_MAX_PAGES),
    }


async def get_ai_settings(db: AsyncSession) -> dict:
    out = _defaults()
    result = await db.execute(select(SystemSetting))
    for row in result.scalars().all():
        if row.key in out:
            out[row.key] = row.value or ""
    return out


async def set_ai_settings(db: AsyncSession, payload: dict):
    """payload 中缺失的键不动；ai_api_key 空串=保留旧值。"""
    for key in AI_SETTING_KEYS:
        if key not in payload or payload[key] is None:
            continue
        value = str(payload[key])
        if key == "ai_api_key" and value == "":
            continue
        result = await db.execute(select(SystemSetting).where(SystemSetting.key == key))
        row = result.scalar_one_or_none()
        if row:
            row.value = value
            db.add(row)
        else:
            db.add(SystemSetting(key=key, value=value))
    await db.commit()


def mask_key(k: str) -> str:
    if not k:
        return ""
    if len(k) <= 4:
        return "****"
    return "****" + k[-4:]


def to_runtime_cfg(d: dict) -> dict:
    """转为批改服务/测试接口需要的运行时结构。"""
    return {
        "base_url": d.get("ai_base_url") or settings.AI_BASE_URL,
        "api_key": d.get("ai_api_key") or "",
        "doc_model": d.get("ai_doc_model") or settings.AI_DOC_MODEL,
        "text_model": d.get("ai_text_model") or settings.AI_TEXT_MODEL,
        "thinking": (d.get("ai_thinking", "1") == "1"),
        "dpi": int(d.get("ai_dpi") or settings.AI_DPI),
        "jpeg_quality": int(d.get("ai_jpeg_quality") or settings.AI_JPEG_QUALITY),
        "max_pages": int(d.get("ai_max_pages") or settings.AI_MAX_PAGES),
        "timeout": settings.AI_TIMEOUT,
    }
