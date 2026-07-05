import uuid
from app.utils.time_util import cst_now
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.database import Base


class Assignment(Base):
    __tablename__ = "assignments"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, default="")
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)
    deadline = Column(DateTime, nullable=True)
    attachments = Column(String(500), default=".cpp,.c,.java,.py,.zip")
    max_file_size_mb = Column(Integer, default=50)
    folder_name = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=cst_now)
    updated_at = Column(DateTime, default=cst_now, onupdate=cst_now)

    course = relationship("Course", back_populates="assignments")
    submissions = relationship("Submission", back_populates="assignment")
