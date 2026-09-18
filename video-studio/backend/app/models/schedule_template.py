from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, JSON, func
from sqlalchemy.orm import relationship
from app.core.db import Base


class ChannelScheduleTemplate(Base):
    """
    Khung giờ đăng lặp lại theo từng kênh TikTok.
    time_slots: JSON array giờ VD ["08:00", "12:00", "20:00"]
    active_days: JSON array thứ trong tuần VD [0,1,2,3,4,5,6] (0=Thứ 2, 6=CN)
    """
    __tablename__ = "channel_schedule_templates"

    id = Column(Integer, primary_key=True, index=True)
    channel_id = Column(Integer, ForeignKey("channels.id"), nullable=False, unique=True)
    time_slots = Column(JSON, default=["08:00", "12:00", "20:00"])
    active_days = Column(JSON, default=[0, 1, 2, 3, 4, 5, 6])  # mặc định cả 7 ngày
    is_active = Column(Boolean, default=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    channel = relationship("Channel")
