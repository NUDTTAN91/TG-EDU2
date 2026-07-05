from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from app.database import get_db
from app.models.user import User
from app.models.school import School
from app.models.course import Course
from app.models.school_class import Class
from app.utils.dependencies import get_current_user, require_role
from app.utils.audit import log_action

router = APIRouter(prefix="/api/schools", tags=["院校"])


class SchoolCreate(BaseModel):
    name: str


class SchoolResponse(BaseModel):
    id: int
    name: str
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class SchoolPublicResponse(BaseModel):
    id: int
    name: str


class SchoolUpdate(BaseModel):
    name: str


@router.get("/public/", response_model=List[SchoolPublicResponse])
async def get_public_schools(db: AsyncSession = Depends(get_db)):
    """公开接口：无需鉴权，返回所有院校列表（供登录页使用）"""
    result = await db.execute(select(School).order_by(School.name))
    schools = result.scalars().all()
    return [{"id": s.id, "name": s.name} for s in schools]


@router.get("/", response_model=List[SchoolResponse])
async def list_schools(
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(School))
    schools = result.scalars().all()
    return schools


@router.post("/", response_model=SchoolResponse, status_code=status.HTTP_201_CREATED)
async def create_school(
    school: SchoolCreate,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db)
):
    # Check if school name already exists
    existing = await db.execute(select(School).filter(School.name == school.name))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="院校名称已存在"
        )
    
    new_school = School(name=school.name)
    db.add(new_school)
    await db.commit()
    await db.refresh(new_school)
    await log_action(
        db,
        action="create_school",
        category="school_management",
        user_id=current_user.id,
        username=current_user.username,
        detail=f"创建了院校 {school.name}",
    )
    return new_school


@router.get("/{school_id}", response_model=SchoolResponse)
async def get_school(
    school_id: int,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(School).filter(School.id == school_id))
    school = result.scalar_one_or_none()
    if not school:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="院校不存在"
        )
    return school


@router.put("/{school_id}", response_model=SchoolResponse)
async def update_school(
    school_id: int,
    school: SchoolUpdate,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(School).filter(School.id == school_id))
    db_school = result.scalar_one_or_none()
    if not db_school:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="院校不存在"
        )
    
    db_school.name = school.name
    await db.commit()
    await db.refresh(db_school)
    await log_action(
        db,
        action="update_school",
        category="school_management",
        user_id=current_user.id,
        username=current_user.username,
        detail=f"更新了院校 {school.name}",
    )
    return db_school


@router.delete("/{school_id}")
async def delete_school(
    school_id: int,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(School).filter(School.id == school_id))
    school = result.scalar_one_or_none()
    if not school:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="院校不存在"
        )

    user_count = await db.execute(select(func.count(User.id)).where(User.school_id == school_id))
    course_count = await db.execute(select(func.count(Course.id)).where(Course.school_id == school_id))
    class_count = await db.execute(select(func.count(Class.id)).where(Class.school_id == school_id))

    if user_count.scalar() > 0 or course_count.scalar() > 0 or class_count.scalar() > 0:
        raise HTTPException(status_code=409, detail="该院校下还有关联的用户、课程或班级，无法删除")

    school_name = school.name
    await db.delete(school)
    await db.commit()
    await log_action(
        db,
        action="delete_school",
        category="school_management",
        user_id=current_user.id,
        username=current_user.username,
        detail=f"删除了院校 {school_name}",
    )
    return {"message": "院校已删除"}
