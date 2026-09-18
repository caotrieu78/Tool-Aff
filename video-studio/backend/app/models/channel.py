from sqlalchemy import Column, Integer, String, DateTime, func
from app.core.db import Base


class Channel(Base):
    """Kênh/nguồn video (dùng để phân loại kho lưu trữ, không phải kênh TikTok đăng)."""
    __tablename__ = "channels"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, unique=True)
    platform_source = Column(String(50), default="douyin")  # douyin, tiktok, other
    created_at = Column(DateTime, server_default=func.now())
