from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pathlib import Path
import logging
from app.database import init_db, async_session
from app.config import settings
from app.models.user import User
from app.utils.security import get_password_hash
from sqlalchemy import select

# 显式导入所有模型，确保 Base.metadata 注册全部表
import app.models  # noqa: F401

from app.shared.routers import auth
from app.admin.routers import admin, schools, logs, settings as settings_router
from app.teacher.routers import courses, classes, assignments, ai_grading
from app.student.routers import submissions, late_submissions

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # 验证所有表已创建
    from app.database import engine
    from sqlalchemy import inspect
    async with engine.begin() as conn:
        tables = await conn.run_sync(lambda c: inspect(c).get_table_names())
    logger.info(f"数据库表列表: {tables}")
    await _ensure_admin()
    # AI 批改：崩溃恢复 + 启动单实例队列 worker
    from app.teacher.services import ai_grading_worker
    await ai_grading_worker.recover_stuck()
    ai_grading_worker.start_ai_worker()
    yield


app = FastAPI(title=settings.PROJECT_NAME, lifespan=lifespan)

app.include_router(auth.router)
app.include_router(courses.router)
app.include_router(classes.router)
app.include_router(assignments.router)
app.include_router(submissions.router)
app.include_router(late_submissions.router)
app.include_router(admin.router)
app.include_router(schools.router)
app.include_router(logs.router)
app.include_router(settings_router.router)
app.include_router(ai_grading.router)

# 挂载头像目录（学生提交文件不再公开挂载，改走 GET /api/submissions/{id}/download 鉴权下载）
SUBMISSIONS_DIR = Path("data/submissions")
AVATARS_DIR = Path("data/avatars")
SUBMISSIONS_DIR.mkdir(parents=True, exist_ok=True)
AVATARS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/data/avatars", StaticFiles(directory=str(AVATARS_DIR)), name="avatars")


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "服务器内部错误，请稍后重试"}
    )


UI_DIR = Path("static")
if UI_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(UI_DIR / "assets")), name="assets")

    @app.get("/")
    async def index():
        return FileResponse(str(UI_DIR / "index.html"))

    @app.get("/favicon.ico")
    async def favicon_ico():
        file_path = UI_DIR / "TeamIco.svg"
        if file_path.exists():
            return FileResponse(str(file_path), media_type="image/svg+xml")
        raise HTTPException(status_code=404)

    @app.get("/{filename}.svg")
    async def serve_svg(filename: str):
        file_path = UI_DIR / f"{filename}.svg"
        if file_path.exists():
            return FileResponse(str(file_path), media_type="image/svg+xml")
        raise HTTPException(status_code=404)

    @app.get("/{page}.html")
    async def serve_page(page: str):
        file_path = UI_DIR / f"{page}.html"
        if file_path.exists():
            return FileResponse(str(file_path))
        return FileResponse(str(UI_DIR / "index.html"))

    @app.get("/{role}/{page}")
    async def serve_role_page(role: str, page: str):
        role_dirs = {"admin": "static/admin", "teacher": "static/teacher", "student": "static/student"}
        if role in role_dirs:
            file_path = Path(role_dirs[role]) / page
            if file_path.exists():
                return FileResponse(str(file_path))
        raise HTTPException(status_code=404)


async def _ensure_admin():
    async with async_session() as db:
        result = await db.execute(
            select(User).where(User.username == settings.ADMIN_USERNAME)
        )
        if not result.scalar_one_or_none():
            admin_user = User(
                username=settings.ADMIN_USERNAME,
                full_name="超级管理员",
                password_hash=get_password_hash(settings.ADMIN_PASSWORD),
                role="admin",
            )
            db.add(admin_user)
            await db.commit()
