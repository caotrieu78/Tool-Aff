from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON
from app.core.db import Base


class LocalizePreset(Base):
    """Model lưu các cấu hình mẫu (Preset) của Studio Việt Hóa, được phân loại theo danh mục."""
    __tablename__ = "localize_presets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    category = Column(String(100), nullable=False, default="Mặc định", index=True)
    name = Column(String(150), nullable=False, index=True)
    description = Column(String(255), nullable=True)
    is_default = Column(Boolean, default=False, index=True)
    settings = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        created_dt = getattr(self, "created_at", None)
        updated_dt = getattr(self, "updated_at", None)
        return {
            "id": getattr(self, "id", None),
            "category": getattr(self, "category", ""),
            "name": getattr(self, "name", ""),
            "description": getattr(self, "description", None),
            "is_default": bool(getattr(self, "is_default", False)),
            "settings": getattr(self, "settings", None) or {},
            "created_at": created_dt.isoformat() if created_dt else None,
            "updated_at": updated_dt.isoformat() if updated_dt else None,
        }
