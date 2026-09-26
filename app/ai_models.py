"""MiMo 模型目录：全系统模型默认值与候选列表的唯一事实源。

小米 MiMo V2.5 系列已于 2026-10-21 10:00（UTC+8）下线，官方替换关系：
  mimo-v2.5      -> mimo-v2.6-flash
  mimo-v2.5-pro  -> mimo-v2.6-pro
两个 2.6 模型均为全模态，支持图像输入。
"""

# 图片/文档路线（pdf/doc/docx）默认模型
DEFAULT_DOC_MODEL = "mimo-v2.6-flash"
# 纯文本路线（txt/md）默认模型
DEFAULT_TEXT_MODEL = "mimo-v2.6-pro"

# 后台下拉候选（前端由 GET /api/admin/settings/ai 的 models 字段渲染）
MODELS = [
    {"id": "mimo-v2.6-flash", "label": "mimo-v2.6-flash（快，支持图片）", "supports_images": True},
    {"id": "mimo-v2.6-pro", "label": "mimo-v2.6-pro（更准，支持图片）", "supports_images": True},
]

# 已下线模型 -> 官方替换模型（读取/迁移时归一化，防止旧配置继续 400）
RETIRED = {
    "mimo-v2.5": "mimo-v2.6-flash",
    "mimo-v2.5-pro": "mimo-v2.6-pro",
}


def catalog() -> list:
    """返回候选模型列表副本，供前端渲染下拉。"""
    return [dict(m) for m in MODELS]


def resolve(model: str) -> str:
    """把已下线的模型名解析为现行模型名；未知值原样返回。"""
    name = (model or "").strip()
    return RETIRED.get(name, name)
