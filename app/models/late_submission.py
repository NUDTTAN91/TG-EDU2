from app.utils.time_util import cst_now
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.database import Base


class LateSubmission(Base):
    __tablename__ = "late_submissions"

    id = Column(Integer, primary_key=True, index=True)
    submission_id = Column(Integer, ForeignKey("submissions.id"), nullable=False)
    reason = Column(Text, default="")
    status = Column(String(20), default="pending")  # pending / approved / rejected
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=cst_now)
    reviewed_at = Column(DateTime, nullable=True)

    submission = relationship("Submission", back_populates="late_submission")
    reviewer = relationship("User", foreign_keys=[reviewed_by])
