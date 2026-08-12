from app.utils.time_util import cst_now
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, BigInteger
from sqlalchemy.orm import relationship
from app.database import Base


class AssignmentAttachment(Base):
    """作业附件（教师上传的材料/卷子等），学生可下载。"""
    __tablename__ = "assignment_attachments"

    id = Column(Integer, primary_key=True, index=True)
    assignment_id = Column(Integer, ForeignKey("assignments.id"), nullable=False, index=True)
    file_name = Column(String(200), nullable=False)   # 原始文件名
    file_path = Column(String(500), nullable=False)   # 服务器存储路径
    file_size = Column(BigInteger, default=0)
    created_at = Column(DateTime, default=cst_now)

    assignment = relationship("Assignment", back_populates="attachments_files")
