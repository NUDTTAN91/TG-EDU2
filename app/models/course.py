from app.utils.time_util import cst_now
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base


class Course(Base):
    __tablename__ = "courses"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(String(500), default="")
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=True)
    semester = Column(String(50), default="")
    created_at = Column(DateTime, default=cst_now)
    updated_at = Column(DateTime, default=cst_now, onupdate=cst_now)

    teacher = relationship("User", back_populates="courses")
    school = relationship("School", back_populates="courses")
    assignments = relationship("Assignment", back_populates="course")
    classes = relationship("Class", back_populates="course")
