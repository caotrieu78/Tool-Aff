from sqlalchemy import Column, Integer, Float, Boolean, ForeignKey, DateTime, func
from sqlalchemy.orm import relationship
from app.core.db import Base


class DuplicateCheckLog(Base):
    """
    Log cảnh báo video trùng lặp khi import.
    Không tự động chặn — chỉ hiển thị cảnh báo để người dùng tự quyết định.
    """
    __tablename__ = "duplicate_check_logs"

    id = Column(Integer, primary_key=True, index=True)
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=False)
    matched_video_id = Column(Integer, ForeignKey("videos.id"), nullable=False)
    similarity_score = Column(Float, nullable=False)    # 0.0 - 1.0
    checked_at = Column(DateTime, server_default=func.now())
    is_dismissed = Column(Boolean, default=False)       # người dùng đã xem/bỏ qua

    video = relationship("Video", foreign_keys=[video_id])
    matched_video = relationship("Video", foreign_keys=[matched_video_id])
