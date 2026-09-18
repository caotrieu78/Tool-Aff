from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, func
from sqlalchemy.orm import relationship
from app.core.db import Base


class Category(Base):
    """Danh mục video, hỗ trợ danh mục con (parent_id)."""
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    parent_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    children = relationship("Category", back_populates="parent")
    parent = relationship("Category", back_populates="children", remote_side=[id])
