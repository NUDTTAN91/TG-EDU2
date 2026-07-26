import logging
from pydantic import model_validator
from pydantic_settings import BaseSettings
from pathlib import Path

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    PROJECT_NAME: str = "TG-EDU2 作业提交系统"
    DATABASE_URL: str = "sqlite+aiosqlite:///./data/db/database.db"
    SECRET_KEY: str = "change-me-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 hours

    ADMIN_USERNAME: str = "tan91"
    ADMIN_PASSWORD: str = "tan91@TG.cn"

    UPLOAD_DIR: str = "./data/submissions"
    AVATAR_DIR: str = "./data/avatars"
    MAX_UPLOAD_SIZE: int = 50 * 1024 * 1024  # 50MB default

    # AI 批改（小米 MiMo，OpenAI 兼容；.env 可覆盖，作为 DB 设置的兜底默认）
    AI_BASE_URL: str = "https://token-plan-cn.xiaomimimo.com/v1"
    AI_API_KEY: str = ""
    AI_DOC_MODEL: str = "mimo-v2.5"        # pdf/doc/docx 图片路线
    AI_TEXT_MODEL: str = "mimo-v2.5-pro"   # txt/md 文本路线
    AI_THINKING: bool = True               # 思维链开关：开=更准更慢
    AI_DPI: int = 200
    AI_JPEG_QUALITY: int = 90
    AI_MAX_PAGES: int = 50
    AI_TIMEOUT: int = 300

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @model_validator(mode='after')
    def check_security_settings(self):
        if self.SECRET_KEY in ("change-me-in-production", ""):
            logger.warning("⚠️  SECRET_KEY 使用默认值，请在 .env 中设置安全的密钥！")
        if self.ADMIN_USERNAME == "tan91":
            logger.warning("⚠️  ADMIN_USERNAME 使用默认值，请在 .env 中修改！")
        if self.ADMIN_PASSWORD == "tan91@TG.cn":
            logger.warning("⚠️  ADMIN_PASSWORD 使用默认值，请在 .env 中修改！")
        return self


settings = Settings()

Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
Path(settings.AVATAR_DIR).mkdir(parents=True, exist_ok=True)
Path("./data/db").mkdir(parents=True, exist_ok=True)
