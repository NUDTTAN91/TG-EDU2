from app.utils.time_util import cst_now
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.database import Base


class LateSubmission(Base):
    __tablename__ = "late_submissions"

    id = Column(Integer, primary_key=True, index=True)
    # 兼容新旧两种申请模式：旧流程以 submission_id 为主（已提交的补审），
    # 新流程以 assignment_id 为主（学生逾期未提交时直接申请）。两者至少一个非空。
    submission_id = Column(Integer, ForeignKey("submissions.id"), nullable=True)
    assignment_id = Column(Integer, ForeignKey("assignments.id"), nullable=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reason = Column(Text, default="")
    status = Column(String(20), default="pending")  # pending / approved / rejected
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=cst_now)
    reviewed_at = Column(DateTime, nullable=True)

    submission = relationship("Submission", back_populates="late_submission")
    assignment = relationship("Assignment", foreign_keys=[assignment_id])
    student = relationship("User", foreign_keys=[student_id])
    reviewer = relationship("User", foreign_keys=[reviewed_by])
