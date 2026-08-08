from app.utils.time_util import cst_now
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Table
from sqlalchemy.orm import relationship
from app.database import Base

class_students = Table(
    "class_students",
    Base.metadata,
    Column("class_id", Integer, ForeignKey("classes.id"), primary_key=True),
    Column("student_id", Integer, ForeignKey("users.id"), primary_key=True),
)

# 班级↔课程多对多关联表（唯一事实源）
class_courses = Table(
    "class_courses",
    Base.metadata,
    Column("class_id", Integer, ForeignKey("classes.id"), primary_key=True),
    Column("course_id", Integer, ForeignKey("courses.id"), primary_key=True),
)


class Class(Base):
    __tablename__ = "classes"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    # legacy：仅作为启动迁移搬运来源，业务读写一律走 class_courses
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False)
    created_at = Column(DateTime, default=cst_now)

    course = relationship("Course")
    courses = relationship("Course", secondary=class_courses, back_populates="classes")
    school = relationship("School", back_populates="classes")
    students = relationship("User", secondary=class_students, back_populates="classes")
