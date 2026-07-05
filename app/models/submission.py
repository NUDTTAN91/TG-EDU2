from app.utils.time_util import cst_now
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from app.database import Base


class Submission(Base):
    __tablename__ = "submissions"
    __table_args__ = (
        UniqueConstraint('assignment_id', 'student_id', name='uq_submission_per_student'),
    )

    id = Column(Integer, primary_key=True, index=True)
    assignment_id = Column(Integer, ForeignKey("assignments.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_name = Column(String(200), nullable=False)
    status = Column(String(20), default="submitted")  # submitted / grading / graded
    grade = Column(Integer, nullable=True)
    feedback = Column(Text, default="")
    submitted_at = Column(DateTime, default=cst_now)
    graded_at = Column(DateTime, nullable=True)
    graded_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    assignment = relationship("Assignment", back_populates="submissions")
    student = relationship("User", foreign_keys=[student_id], back_populates="submissions")
    grader = relationship("User", foreign_keys=[graded_by])
    late_submission = relationship("LateSubmission", back_populates="submission", uselist=False)
