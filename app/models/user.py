from app.utils.time_util import cst_now
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    password_hash = Column(String(128), nullable=False)
    full_name = Column(String(100), default="")
    role = Column(String(20), nullable=False, default="student")  # admin / teacher / student
    is_active = Column(Boolean, default=True)
    avatar = Column(String(500), default="", nullable=True)
    must_change_password = Column(Boolean, default=False)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=True)
    created_at = Column(DateTime, default=cst_now)
    updated_at = Column(DateTime, default=cst_now, onupdate=cst_now)

    school = relationship("School", back_populates="users")
    classes = relationship("Class", secondary="class_students", back_populates="students")
    courses = relationship("Course", back_populates="teacher")
    submissions = relationship("Submission", back_populates="student", foreign_keys="Submission.student_id")
