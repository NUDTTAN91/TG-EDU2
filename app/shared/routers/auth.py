import os
import re
import uuid
from fastapi import APIRouter, Depends, HTTPException, status, Request, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, Field
from typing import Optional
from app.database import get_db
from app.models.user import User
from app.utils.security import verify_password, create_access_token, get_password_hash
from app.utils.dependencies import get_current_user
from app.utils.audit import log_action
from app.utils.ip_util import get_client_ip

router = APIRouter(prefix="/api/auth", tags=["认证"])


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=8)


class UserInfo(BaseModel):
    id: int
    username: str
    full_name: str
    role: str
    must_change_password: bool
    avatar: Optional[str] = None


@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest, req: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == request.username))
    user = result.scalar_one_or_none()
    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账号已被禁用",
        )
    access_token = create_access_token(data={"sub": str(user.id), "role": user.role})
    ip = get_client_ip(req)
    await log_action(
        db,
        action="user_login",
        category="login",
        user_id=user.id,
        username=user.username,
        detail=f"用户 {user.username} 登录成功",
        ip_address=ip,
    )
    return LoginResponse(
        access_token=access_token,
        user={
            "id": user.id,
            "username": user.username,
            "full_name": user.full_name,
            "role": user.role,
            "must_change_password": user.must_change_password,
            "avatar": user.avatar,
        },
    )


@router.get("/me", response_model=UserInfo)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserInfo(
        id=current_user.id,
        username=current_user.username,
        full_name=current_user.full_name,
        role=current_user.role,
        must_change_password=current_user.must_change_password,
        avatar=current_user.avatar,
    )


@router.post("/change-password")
async def change_password(
    request: ChangePasswordRequest,
    req: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(request.old_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="原密码错误",
        )
    # 密码强度验证：至少8位，必须包含大小写字母和数字
    if len(request.new_password) < 8:
        raise HTTPException(status_code=400, detail="新密码至少8位")
    if not re.search(r'[a-z]', request.new_password):
        raise HTTPException(status_code=400, detail="新密码必须包含小写字母")
    if not re.search(r'[A-Z]', request.new_password):
        raise HTTPException(status_code=400, detail="新密码必须包含大写字母")
    if not re.search(r'[0-9]', request.new_password):
        raise HTTPException(status_code=400, detail="新密码必须包含数字")

    current_user.password_hash = get_password_hash(request.new_password)
    current_user.must_change_password = False
    db.add(current_user)
    await db.commit()
    await log_action(
        db,
        action="change_password",
        category="password",
        user_id=current_user.id,
        username=current_user.username,
        detail=f"用户 {current_user.username} 修改了密码",
        ip_address=get_client_ip(req),
    )
    return {"message": "密码修改成功"}


ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
MAX_AVATAR_SIZE = 2 * 1024 * 1024  # 2MB
AVATAR_UPLOAD_DIR = "data/avatars"


@router.post("/upload-avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="仅支持 jpg/png/gif/webp 格式的图片",
        )

    content = await file.read()
    if len(content) > MAX_AVATAR_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="图片大小不能超过 2MB",
        )

    os.makedirs(AVATAR_UPLOAD_DIR, exist_ok=True)

    ext_map = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
    }
    ext = ext_map.get(file.content_type, ".jpg")
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(AVATAR_UPLOAD_DIR, filename)

    # 删除旧头像文件
    if current_user.avatar:
        old_path = current_user.avatar.lstrip("/")
        if os.path.isfile(old_path):
            os.remove(old_path)

    with open(filepath, "wb") as f:
        f.write(content)

    avatar_url = f"/{filepath}"
    current_user.avatar = avatar_url
    db.add(current_user)
    await db.commit()

    return {"avatar_url": avatar_url}
