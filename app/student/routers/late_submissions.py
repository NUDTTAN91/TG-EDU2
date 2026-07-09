from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime
from pydantic import BaseModel, model_validator
from typing import List, Optional
from app.database import get_db
from app.models.user import User
from app.utils.dependencies import get_current_user, require_role
from app.student.services import late_submission_service

router = APIRouter(prefix="/api/late-submissions", tags=["补交"])


ERROR_STATUS_MAP = {
    "无权": 403,
    "已有": 409,
    "不存在": 404,
    "未迟交": 400,
    "尚未到截止时间": 400,
    "未设置截止时间": 400,
    "参数错误": 400,
}


def get_error_status(error_msg: str) -> int:
    for keyword, status_code in ERROR_STATUS_MAP.items():
        if keyword in error_msg:
            return status_code
    return 400


class LateSubmissionRequest(BaseModel):
    submission_id: Optional[int] = None
    assignment_id: Optional[int] = None
    reason: str = ""

    @model_validator(mode="after")
    def _at_least_one(self):
        if self.submission_id is None and self.assignment_id is None:
            raise ValueError("必须提供 submission_id 或 assignment_id")
        return self


class LateSubmissionResponse(BaseModel):
    id: int
    submission_id: Optional[int] = None
    assignment_id: Optional[int] = None
    student_id: Optional[int] = None
    reason: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


@router.post("/", response_model=LateSubmissionResponse, status_code=status.HTTP_201_CREATED)
async def request_late_submission(
    data: LateSubmissionRequest,
    current_user: User = Depends(require_role("student")),
    db: AsyncSession = Depends(get_db),
):
    late, error = await late_submission_service.create_late_submission(
        db,
        student_id=current_user.id,
        submission_id=data.submission_id,
        assignment_id=data.assignment_id,
        reason=data.reason,
    )
    if error:
        raise HTTPException(status_code=get_error_status(error), detail=error)
    return late


@router.get("/", response_model=List[LateSubmissionResponse])
async def list_late_submissions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == "student":
        return await late_submission_service.get_late_submissions_by_student(db, current_user.id)
    return await late_submission_service.get_all_late_submissions(db)


@router.put("/{late_id}", response_model=LateSubmissionResponse)
async def review_late_submission(
    late_id: int,
    approved: bool,
    current_user: User = Depends(require_role("admin", "teacher")),
    db: AsyncSession = Depends(get_db),
):
    late, error = await late_submission_service.review_late_submission(
        db, late_id, current_user.id, approved
    )
    if error:
        raise HTTPException(status_code=404, detail=error)
    return late
