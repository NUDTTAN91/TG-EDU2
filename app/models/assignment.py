import uuid
from app.utils.time_util import cst_now
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Boolean, Table
from sqlalchemy.orm import relationship
from app.database import Base

# 作业↔班级定向表：作业只对被定向的班级可见。
# 空定向（无任何行）= 兼容旧数据，视为「该课程下全部班级可见」
assignment_classes = Table(
    "assignment_classes",
    Base.metadata,
    Column("assignment_id", Integer, ForeignKey("assignments.id"), primary_key=True),
    Column("class_id", Integer, ForeignKey("classes.id"), primary_key=True),
)


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
    auto_ai_grade = Column(Boolean, default=False)  # 提交即自动 AI 批改
    created_at = Column(DateTime, default=cst_now)
    updated_at = Column(DateTime, default=cst_now, onupdate=cst_now)

    course = relationship("Course", back_populates="assignments")
    submissions = relationship("Submission", back_populates="assignment")
    classes = relationship("Class", secondary=assignment_classes)
