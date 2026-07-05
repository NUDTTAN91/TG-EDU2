from app.utils.time_util import cst_now
from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.orm import relationship
from app.database import Base


class School(Base):
    __tablename__ = "schools"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    created_at = Column(DateTime, default=cst_now)

    users = relationship("User", back_populates="school")
    classes = relationship("Class", back_populates="school")
    courses = relationship("Course", back_populates="school")
