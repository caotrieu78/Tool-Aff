from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, Enum, func
from sqlalchemy.orm import relationship
from app.core.db import Base
import enum


class TikTokAccountStatus(str, enum.Enum):
    active = "active"
    expired = "expired"
    error = "error"


class ChannelTikTokAccount(Base):
    """
    Tài khoản TikTok cho mỗi kênh — 3 kênh = 3 OAuth độc lập.
    Token được mã hóa bằng SECRET_KEY trước khi lưu.
    """
    __tablename__ = "channel_tiktok_accounts"

    id = Column(Integer, primary_key=True, index=True)
    channel_id = Column(Integer, ForeignKey("channels.id"), nullable=False, unique=True)
    tiktok_open_id = Column(String(255), nullable=True)
    access_token_encrypted = Column(String(2000), nullable=True)   # mã hóa
    refresh_token_encrypted = Column(String(2000), nullable=True)  # mã hóa
    token_expires_at = Column(DateTime, nullable=True)
    account_status = Column(Enum(TikTokAccountStatus), default=TikTokAccountStatus.active)
    display_name = Column(String(255), nullable=True)   # tên hiển thị tài khoản TikTok
    avatar_url = Column(String(1000), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    channel = relationship("Channel")
