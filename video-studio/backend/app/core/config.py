import os
import sys
from pydantic_settings import BaseSettings
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent  # backend/

# Chỉ load .env khi chạy trong chế độ dev (không phải PyInstaller frozen binary)
_IS_FROZEN = getattr(sys, "frozen", False)
_ENV_FILE = "" if _IS_FROZEN else str(BASE_DIR / ".env")


class Settings(BaseSettings):
    # App
    APP_NAME: str = "Video Studio"
    DEBUG: bool = not _IS_FROZEN  # Tắt debug mode trong production

    # Database
    DATABASE_URL: str = f"sqlite+aiosqlite:///{BASE_DIR}/storage/video_studio.db"

    # Storage
    STORAGE_DIR: Path = BASE_DIR / "storage" / "library"

    # Gemini (managed via DB key pool, but fallback env key)
    GEMINI_API_KEY: str = ""
    KIE_API_KEY: str = ""

    # TikTok OAuth
    TIKTOK_CLIENT_KEY: str = ""
    TIKTOK_CLIENT_SECRET: str = ""

    # Security (for encrypting tokens)
    SECRET_KEY: str = "CHANGE_ME_IN_PRODUCTION_USE_RANDOM_32_BYTES"

    # Video processing limits — nâng lên 60 phút (giới hạn upload video thường thấy của TikTok cho
    # tài khoản đã xác minh). Các bước xử lý (OCR/STT/dịch/TTS/ffmpeg) đều đã được cập nhật để chạy
    # theo lô/cửa sổ thời gian, không còn phụ thuộc vào việc video phải ngắn để chạy trong 1 lần gọi.
    MAX_VIDEO_DURATION_SECONDS: int = 3600  # 60 phút

    # Job queue
    JOB_POLL_INTERVAL_SECONDS: int = 2
    # Số job xử lý video (localize/affiliate) chạy song song tối đa cùng lúc.
    # Mỗi job tốn nhiều CPU/RAM (ffmpeg, Whisper, TTS, torch) nên giới hạn để
    # tránh quá tải máy khi người dùng submit hàng loạt (bulk affiliate).
    MAX_CONCURRENT_JOBS: int = 2

    # ── Licensing (Phase 5 - Google Sheets & Hardware ID) ────────────────────
    # CẤU HÌNH ADMIN — Hardcoded trong binary, người dùng KHÔNG THỂ thay đổi.
    # Để thay đổi: sửa tại đây rồi build lại binary.
    GOOGLE_SHEET_ID: str = "1p5hu9mp_sQ649i3XsoLLjsEt4FxlKX7hTHS1CQq6Jkg"
    LICENSE_SERVER_URL: str = "https://script.google.com/macros/s/AKfycbyywF3FE7it_rpO3wCHAP4idHcr1vvVNeAw4SZXBb0iVBAIPOgxreyzFyv_iQqblAhd/exec"
    LICENSE_CACHE_FILE: Path = BASE_DIR / "storage" / ".license_cache.json"
    LICENSE_GRACE_HOURS: int = 72  # Cho phép dùng offline 72h sau lần verify online gần nhất
    LICENSE_ADMIN_CONTACT: str = "Liên hệ Zalo / Hotline Cao Triều: 0386.690.764 để kích hoạt hoặc gia hạn bản quyền."

    class Config:
        # Trong production (frozen binary): KHÔNG đọc .env — cấu hình được lock trong binary
        # Trong dev: đọc .env để tiện thay đổi nhanh
        env_file = _ENV_FILE
        extra = "ignore"


settings = Settings()

# Ensure storage dir exists
os.makedirs(settings.STORAGE_DIR, exist_ok=True)
