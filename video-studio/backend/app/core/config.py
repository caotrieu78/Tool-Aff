import os
from pydantic_settings import BaseSettings
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent  # backend/


class Settings(BaseSettings):
    # App
    APP_NAME: str = "Video Studio"
    DEBUG: bool = True

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

    # Video processing limits
    MAX_VIDEO_DURATION_SECONDS: int = 900  # 15 phút

    # Job queue
    JOB_POLL_INTERVAL_SECONDS: int = 2
    # Số job xử lý video (localize/affiliate) chạy song song tối đa cùng lúc.
    # Mỗi job tốn nhiều CPU/RAM (ffmpeg, Whisper, TTS, torch) nên giới hạn để
    # tránh quá tải máy khi người dùng submit hàng loạt (bulk affiliate).
    MAX_CONCURRENT_JOBS: int = 2

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()

# Ensure storage dir exists
os.makedirs(settings.STORAGE_DIR, exist_ok=True)
