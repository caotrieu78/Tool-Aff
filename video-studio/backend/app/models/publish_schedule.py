from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, Enum, Text, func
from sqlalchemy.orm import relationship
from app.core.db import Base
import enum


class PublishStatus(str, enum.Enum):
    pending = "pending"           # Chờ duyệt
    approved = "approved"         # Đã duyệt (chưa chọn kênh)
    scheduled = "scheduled"       # Đã lên lịch (chờ giờ đăng)
    posting = "posting"           # Đang đăng video lên TikTok
    posted = "posted"             # Đã đăng thành công
    failed = "failed"             # Lỗi kỹ thuật khi đăng
    rejected = "rejected"         # TikTok từ chối (vi phạm, bản quyền...)


class PublishSchedule(Base):
    """
    Quan hệ nhiều-nhiều giữa video và kênh TikTok đăng.
    1 video có thể đăng lên nhiều kênh → nhiều dòng trong bảng này.
    Caption/hashtag lưu riêng ở đây (không lưu chung ở bảng videos)
    vì mỗi kênh có thể muốn caption khác nhau.
    Slot giờ được gán tự động theo FIFO từ channel_schedule_template.
    """
    __tablename__ = "publish_schedules"

    id = Column(Integer, primary_key=True, index=True)
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=False, index=True)
    channel_id = Column(Integer, ForeignKey("channels.id"), nullable=False, index=True)
    platform = Column(String(50), default="tiktok")
    scheduled_time = Column(DateTime, nullable=True)
    status = Column(Enum(PublishStatus), default=PublishStatus.pending, index=True)

    # True nếu người dùng tự sửa tay giờ đăng (không phải auto FIFO)
    is_manual_override = Column(Boolean, default=False)

    tiktok_post_id = Column(String(255), nullable=True)
    caption = Column(Text, nullable=True)
    hashtags = Column(Text, nullable=True)         # JSON array string
    rejection_reason = Column(Text, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    video = relationship("Video", back_populates="publish_schedules")
    channel = relationship("Channel")
