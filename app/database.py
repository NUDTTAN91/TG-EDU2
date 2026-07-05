import os
import shutil
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import event, text
from app.config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=False)


@event.listens_for(engine.sync_engine, "connect")
def set_sqlite_pragma(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    # === 物理文件迁移（仅执行一次，幂等） ===
    # 迁移数据库文件
    old_db = "data/database.db"
    new_db_dir = "data/db"
    new_db = "data/db/database.db"
    if os.path.exists(old_db) and not os.path.exists(new_db):
        os.makedirs(new_db_dir, exist_ok=True)
        shutil.move(old_db, new_db)

    # 迁移头像
    old_avatars = "data/uploads/avatars"
    new_avatars = "data/avatars"
    if os.path.exists(old_avatars):
        os.makedirs(new_avatars, exist_ok=True)
        for f in os.listdir(old_avatars):
            src = os.path.join(old_avatars, f)
            dst = os.path.join(new_avatars, f)
            if os.path.isfile(src) and not os.path.exists(dst):
                shutil.move(src, dst)

    # 迁移作业文件
    old_uploads = "data/uploads"
    new_submissions = "data/submissions"
    if os.path.exists(old_uploads):
        for f in os.listdir(old_uploads):
            src = os.path.join(old_uploads, f)
            if os.path.isfile(src):
                dest_dir = os.path.join(new_submissions, "0", "0", "0")
                os.makedirs(dest_dir, exist_ok=True)
                dst = os.path.join(dest_dir, f)
                if not os.path.exists(dst):
                    shutil.move(src, dst)
    # === 物理文件迁移结束 ===

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # Migration: ensure classes.school_id is NOT NULL and classes.course_id is nullable
        def _migrate(connection):
            from sqlalchemy import inspect, text
            insp = inspect(connection)
            if "classes" in insp.get_table_names():
                cols = {c["name"]: c for c in insp.get_columns("classes")}
                # If school_id exists but is nullable, migrate it
                if "school_id" in cols and cols["school_id"].get("nullable", True):
                    # Set school_id to 1 for any rows where it is NULL
                    connection.execute(text("UPDATE classes SET school_id = 1 WHERE school_id IS NULL"))
                    # SQLite cannot ALTER COLUMN nullable, so we recreate the table
                    _recreate_classes_table(connection)
                # If course_id exists and is NOT nullable, also needs migration
                if "course_id" in cols and not cols["course_id"].get("nullable", True):
                    _recreate_classes_table(connection)

        def _recreate_classes_table(connection):
            from sqlalchemy import text
            # Check if table already has correct schema
            from sqlalchemy import inspect
            insp = inspect(connection)
            cols = {c["name"]: c for c in insp.get_columns("classes")}
            school_nullable = cols.get("school_id", {}).get("nullable", True)
            course_nullable = cols.get("course_id", {}).get("nullable", False)
            if not school_nullable and course_nullable:
                return  # Already correct
            # Recreate with correct schema
            connection.execute(text("PRAGMA foreign_keys=OFF"))
            connection.execute(text("""
                CREATE TABLE IF NOT EXISTS classes_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR(100) NOT NULL,
                    course_id INTEGER REFERENCES courses(id),
                    school_id INTEGER NOT NULL REFERENCES schools(id),
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            connection.execute(text("""
                INSERT INTO classes_new (id, name, course_id, school_id, created_at)
                SELECT id, name, course_id,
                       COALESCE(school_id, 1),
                       created_at
                FROM classes
            """))
            connection.execute(text("DROP TABLE classes"))
            connection.execute(text("ALTER TABLE classes_new RENAME TO classes"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_classes_id ON classes(id)"))
            connection.execute(text("PRAGMA foreign_keys=ON"))

        await conn.run_sync(_migrate)

        # 数据迁移已完成，不再每次启动重置 must_change_password
        # 原迁移：UPDATE users SET must_change_password = 1 WHERE role != 'admin' AND must_change_password = 0
        # 此迁移仅在首次部署时需要，已手动执行过

        # 数据迁移：为 users 表添加 avatar 列（如果不存在）
        def _migrate_avatar(connection):
            from sqlalchemy import inspect, text
            insp = inspect(connection)
            if "users" in insp.get_table_names():
                cols = [c["name"] for c in insp.get_columns("users")]
                if "avatar" not in cols:
                    connection.execute(text("ALTER TABLE users ADD COLUMN avatar VARCHAR(500) DEFAULT ''"))

        await conn.run_sync(_migrate_avatar)

    # 数据库路径字段迁移（幂等：REPLACE 不影响已迁移的行）
    async with engine.begin() as conn:
        def _migrate_paths(connection):
            # 更新头像路径：/data/uploads/avatars/ → /data/avatars/
            connection.execute(text(
                "UPDATE users SET avatar = REPLACE(avatar, '/data/uploads/avatars/', '/data/avatars/') WHERE avatar LIKE '/data/uploads/avatars/%'"
            ))
            # 更新作业文件路径：data/uploads/ → data/submissions/0/0/0/
            connection.execute(text(
                "UPDATE submissions SET file_path = REPLACE(file_path, 'data/uploads/', 'data/submissions/0/0/0/') WHERE file_path LIKE 'data/uploads/%'"
            ))
        await conn.run_sync(_migrate_paths)

    # 自动修复班级的 course_id（幂等：只更新 NULL 的行，已关联的不受影响）
    async with engine.begin() as conn:
        def _fix_class_course_id(connection):
            from sqlalchemy import text
            # 查找 course_id 为 NULL 的班级
            result = connection.execute(text(
                "SELECT c.id, c.school_id FROM classes c WHERE c.course_id IS NULL"
            ))
            null_classes = result.fetchall()
            for row in null_classes:
                class_id, school_id = row[0], row[1]
                # 尝试通过 school_id 找到对应的课程
                course_result = connection.execute(text(
                    "SELECT id FROM courses WHERE school_id = :school_id"
                ), {"school_id": school_id})
                courses = course_result.fetchall()
                if len(courses) == 1:
                    # 只有一个课程，自动关联
                    connection.execute(text(
                        "UPDATE classes SET course_id = :course_id WHERE id = :class_id"
                    ), {"course_id": courses[0][0], "class_id": class_id})

        await conn.run_sync(_fix_class_course_id)

    # 为 assignments 表添加 folder_name 字段（幂等：只更新 NULL 的行）
    async with engine.begin() as conn:
        def _migrate_folder_name(connection):
            from sqlalchemy import text, inspect
            insp = inspect(connection)
            if "assignments" not in insp.get_table_names():
                return
            cols = {c["name"]: c for c in insp.get_columns("assignments")}
            if "folder_name" not in cols:
                connection.execute(text(
                    "ALTER TABLE assignments ADD COLUMN folder_name VARCHAR(500)"
                ))
            # 为没有 folder_name 的旧作业生成文件夹名
            import uuid, re
            from datetime import datetime
            result = connection.execute(text(
                "SELECT id, title, created_at FROM assignments WHERE folder_name IS NULL"
            ))
            for row in result.fetchall():
                aid, title, created_at = row[0], row[1], row[2]
                safe_title = re.sub(r'[\\/:*?"<>|]', '', title or '').strip() or 'unknown'
                if isinstance(created_at, str):
                    try:
                        created_at = datetime.fromisoformat(created_at)
                    except (ValueError, TypeError):
                        created_at = None
                time_str = created_at.strftime("%Y%m%d%H%M%S") if created_at else "00000000000000"
                short_uuid = uuid.uuid4().hex[:16]
                folder = f"{time_str}_{safe_title}_{short_uuid}"
                connection.execute(text(
                    "UPDATE assignments SET folder_name = :folder WHERE id = :aid"
                ), {"folder": folder, "aid": aid})

        await conn.run_sync(_migrate_folder_name)
