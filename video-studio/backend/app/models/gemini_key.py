from sqlalchemy import Column, Integer, String, Boolean, Float, DateTime, Enum, func
from app.core.db import Base
import enum


class GeminiKeyStatus(str, enum.Enum):
    active = "active"
    exhausted = "exhausted"  # hết quota ngày, tự reset sáng hôm sau
    error = "error"          # lỗi key không hợp lệ


class GeminiApiKey(Base):
    """
    Pool nhiều Gemini API key — xoay vòng round-robin, failover tự động khi 429.
    Cơ chế:
    - Mỗi lần gọi Gemini → lấy key active tiếp theo (round-robin)
    - Nếu key trả 429 → đánh dấu exhausted → sang key tiếp
    - Dừng job chỉ khi toàn bộ key đều exhausted/error
    - daily_quota_used reset về 0 mỗi ngày (theo giờ VN)
    """
    __tablename__ = "gemini_api_keys"

    id = Column(Integer, primary_key=True, index=True)
    api_key_encrypted = Column(String(2000), nullable=False)   # mã hóa
    label = Column(String(255), nullable=False)                # tên hiển thị
    provider = Column(String(50), default="google", server_default="google")  # "google" | "kie"
    daily_quota_used = Column(Integer, default=0)
    daily_quota_limit = Column(Integer, default=1500)          # free tier
    last_used_at = Column(DateTime, nullable=True)
    status = Column(Enum(GeminiKeyStatus), default=GeminiKeyStatus.active, index=True)
    is_default = Column(Boolean, default=False, server_default="0")  # ưu tiên dùng key này trước
    is_active = Column(Boolean, default=True)                  # user có thể tạm dừng thủ công
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
