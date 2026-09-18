from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Enum, Text, JSON, func
from sqlalchemy.orm import relationship
from app.core.db import Base
import enum


class JobModule(str, enum.Enum):
    localize = "localize"
    affiliate = "affiliate"


class JobStep(str, enum.Enum):
    ocr = "ocr"
    stt = "stt"
    translate = "translate"  # type: ignore[assignment]  # pyrefly: ignore
    tts = "tts"
    compose = "compose"
    caption = "caption"
    highlight = "highlight"
    scrape = "scrape"
    script = "script"
    queued = "queued"


class JobStatus(str, enum.Enum):
    pending = "pending"       # chờ trong queue
    running = "running"       # đang chạy
    done = "done"             # hoàn thành
    error = "error"           # lỗi
    cancelled = "cancelled"   # bị hủy


class ProcessingJob(Base):
    """
    Job xử lý AI pipeline. Mỗi video có thể có nhiều job (nhiều phiên bản affiliate).
    config_json lưu toàn bộ cấu hình người dùng chọn cho job đó.
    Không có cơ chế resume — nếu app tắt giữa chừng, job sẽ reset về pending.
    """
    __tablename__ = "processing_jobs"

    id = Column(Integer, primary_key=True, index=True)
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=False, index=True)
    parent_job_id = Column(Integer, ForeignKey("processing_jobs.id"), nullable=True)  # cho multi-version affiliate
    module = Column(Enum(JobModule), nullable=False)
    current_step = Column(Enum(JobStep), default=JobStep.queued)
    status = Column(Enum(JobStatus), default=JobStatus.pending, index=True)
    progress_percent = Column(Float, default=0.0)
    error_log = Column(Text, nullable=True)

    # Cấu hình người dùng chọn cho job này
    config_json = Column(JSON, nullable=True)
    # {
    #   "ai_model": "gemini-3.8-flash",
    #   "ai_style": "đời thường",
    #   "voice_id": "vi-VN-HoaiMyNeural",
    #   "voice_speed": 1.0,
    #   "audio_mode": "keep_duration",  // hoặc "balance_stretch"
    #   "volume_original": 10,
    #   "volume_voiceover": 100,
    #   "subtitle_config": {
    #     "font": "Arial",
    #     "size": 24,
    #     "color": "#FFFFFF",
    #     "background": "#000000",
    #     "opacity": 0.7,
    #     "position": "bottom",
    #     "cover_old_subtitle": true
    #   }
    # }

    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    video = relationship("Video", back_populates="jobs")
