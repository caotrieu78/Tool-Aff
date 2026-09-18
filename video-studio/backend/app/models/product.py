from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Text, func
from sqlalchemy.orm import relationship
from app.core.db import Base


class Product(Base):
    """Thông tin sản phẩm cho Module 2 — Affiliate Studio."""
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=False, index=True)
    shopee_url = Column(String(1000), nullable=True)
    tiktok_shop_url = Column(String(1000), nullable=True)
    product_name = Column(String(500), nullable=True)
    price = Column(String(100), nullable=True)
    price_image_path = Column(String(1000), nullable=True)  # ảnh chụp giá
    note_script = Column(Text, nullable=True)               # ghi chú kịch bản tự do
    created_at = Column(DateTime, server_default=func.now())

    video = relationship("Video", back_populates="products")
