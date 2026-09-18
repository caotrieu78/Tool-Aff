from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Enum, func
from sqlalchemy.orm import relationship
from app.core.db import Base
import enum


class VideoStatus(str, enum.Enum):
    raw = "raw"
    processing = "processing"
    done = "done"
    error = "error"


class VideoSourceType(str, enum.Enum):
    localize = "localize"
    affiliate = "affiliate"
    raw = "raw"


class Video(Base):
    """
    Bảng video chính.
    channel_id: chỉ dùng để phân loại kho lưu trữ (KHÔNG phải kênh TikTok đăng).
    Kênh đăng được xác định trong publish_schedule.
    """
    __tablename__ = "videos"

    id = Column(Integer, primary_key=True, index=True)
    channel_id = Column(Integer, ForeignKey("channels.id"), nullable=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    title = Column(String(500), nullable=True)
    file_path = Column(String(1000), nullable=False)  # path to original.mp4
    output_path = Column(String(1000), nullable=True)  # path to output_final.mp4
    thumbnail_path = Column(String(1000), nullable=True)
    duration = Column(Float, nullable=True)            # seconds
    resolution = Column(String(20), nullable=True)     # e.g. "1080x1920"
    file_size = Column(Integer, nullable=True)          # bytes
    status = Column(Enum(VideoStatus), default=VideoStatus.raw, index=True)
    source_type = Column(Enum(VideoSourceType), default=VideoSourceType.raw)
    recognition_type = Column(String(50), default="voice_only", nullable=True)  # voice_only, ocr_only, ai_vision
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships
    channel = relationship("Channel")
    category = relationship("Category")
    jobs = relationship("ProcessingJob", back_populates="video", cascade="all, delete-orphan")
    publish_schedules = relationship("PublishSchedule", back_populates="video")
    products = relationship("Product", back_populates="video")
