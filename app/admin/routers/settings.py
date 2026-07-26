from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional, List
import httpx

from app.database import get_db
from app.models.user import User
from app.utils.dependencies import require_role
from app.utils.audit import log_action
from app.utils.ip_util import get_client_ip
from app.admin.services import settings_service

router = APIRouter(prefix="/api/admin/settings", tags=["系统设置"])


class AiSettingsUpdate(BaseModel):
    ai_base_url: Optional[str] = None
    ai_api_key: Optional[str] = None
    ai_doc_model: Optional[str] = None
    ai_text_model: Optional[str] = None
    ai_thinking: Optional[bool] = None
    ai_dpi: Optional[int] = None
    ai_jpeg_quality: Optional[int] = None
    ai_max_pages: Optional[int] = None


class AiTestRequest(BaseModel):
    ai_base_url: Optional[str] = None
    ai_api_key: Optional[str] = None
    ai_doc_model: Optional[str] = None
    ai_text_model: Optional[str] = None


@router.get("/ai")
async def get_ai_settings(
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    d = await settings_service.get_ai_settings(db)
    key = d.get("ai_api_key", "")
    return {
        "base_url": d["ai_base_url"],
        "doc_model": d["ai_doc_model"],
        "text_model": d["ai_text_model"],
        "thinking": d["ai_thinking"] == "1",
        "dpi": int(d["ai_dpi"]),
        "jpeg_quality": int(d["ai_jpeg_quality"]),
        "max_pages": int(d["ai_max_pages"]),
        "key_set": bool(key),
        "key_masked": settings_service.mask_key(key),
    }


@router.put("/ai")
async def put_ai_settings(
    data: AiSettingsUpdate,
    request: Request,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    payload = data.model_dump()
    if payload.get("ai_thinking") is not None:
        payload["ai_thinking"] = "1" if payload["ai_thinking"] else "0"
    await settings_service.set_ai_settings(db, payload)
    await log_action(
        db,
        action="update_ai_settings",
        category="system_settings",
        user_id=current_user.id,
        username=current_user.username,
        detail="更新了 AI 批改设置",
        ip_address=get_client_ip(request),
    )
    return {"message": "已保存"}


@router.post("/ai/test")
async def test_ai_settings(
    data: AiTestRequest,
    request: Request,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """对两个绑定模型各发最小请求，逐模型返回连通性结果。未保存的临时值优先。"""
    d = await settings_service.get_ai_settings(db)
    base_url = (data.ai_base_url or d["ai_base_url"]).rstrip("/")
    api_key = data.ai_api_key or d["ai_api_key"]
    models: List[str] = []
    for m in [data.ai_doc_model or d["ai_doc_model"], data.ai_text_model or d["ai_text_model"]]:
        if m and m not in models:
            models.append(m)
    if not api_key:
        results = [{"model": m, "ok": False, "detail": "未配置 API key"} for m in models]
    else:
        results = []
        for m in models:
            try:
                async with httpx.AsyncClient(timeout=20) as client:
                    resp = await client.post(
                        base_url + "/chat/completions",
                        json={
                            "model": m,
                            "messages": [{"role": "user", "content": "ping"}],
                            "max_completion_tokens": 8,
                            "stream": False,
                            "thinking": {"type": "disabled"},
                        },
                        headers={"api-key": api_key, "Content-Type": "application/json"},
                    )
                if resp.status_code == 200:
                    results.append({"model": m, "ok": True, "detail": "连接成功"})
                elif resp.status_code in (401, 403):
                    results.append({"model": m, "ok": False, "detail": f"key 无效（HTTP {resp.status_code}）"})
                else:
                    results.append({"model": m, "ok": False, "detail": f"HTTP {resp.status_code}：{resp.text[:100]}"})
            except httpx.HTTPError as e:
                results.append({"model": m, "ok": False, "detail": f"网络错误：{e}"})
    await log_action(
        db,
        action="test_ai",
        category="system_settings",
        user_id=current_user.id,
        username=current_user.username,
        detail="测试了 AI 连通性：" + "；".join(f"{r['model']}={'OK' if r['ok'] else 'FAIL'}" for r in results),
        ip_address=get_client_ip(request),
    )
    return results
