import asyncio
import json
import logging
import os
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from pydantic import BaseModel
from typing import Optional, Dict, Any, List, cast

from app.core.config import settings
from app.core.db import get_db
from app.models.job import ProcessingJob, JobModule, JobStatus, JobStep
from app.models.video import Video
from app.models.localize_preset import LocalizePreset
from app.services.job_runner import start_localize_job_background
from app.services.compose_service import generate_srt_file, compose_localized_video
from app.services.tts_service import text_to_speech_file, synthesize_timeline_voiceover

logger = logging.getLogger(__name__)

router = APIRouter()


class LocalizeSubmitRequest(BaseModel):
    video_id: int
    ai_style: Optional[str] = "đời thường"
    voice_id: Optional[str] = "vi-VN-HoaiMyNeural"
    voice_speed: Optional[float] = 1.0
    sync_mode: Optional[str] = "keep_duration"
    recognition_mode: Optional[str] = None

    # Âm thanh & Làm mờ
    volume_voiceover: Optional[int] = 100
    keep_original_audio: Optional[bool] = True
    volume_original: Optional[int] = 15
    volume_original_voice: Optional[int] = 0
    cover_old_subtitle: Optional[bool] = True
    blur_amount: Optional[int] = 25
    blur_method: Optional[str] = "blur"

    # Phụ đề & Vị trí phụ đề dịch (Khối OCR chuẩn)
    show_subtitles: Optional[bool] = True
    sub_position_mode: Optional[str] = "by_original"  # "by_original" | "by_height"
    sub_placement: Optional[str] = "overlay"          # "overlay" | "above" | "below"
    auto_fit_sub_size: Optional[bool] = True
    sub_position_percent: Optional[int] = 71
    sub_font: Optional[str] = "Oswald"
    sub_font_size: Optional[int] = 50
    sub_color: Optional[str] = "#FFFFFF"
    sub_bg_color: Optional[str] = "#000000"
    sub_bg_opacity: Optional[int] = 50
    sub_style_type: Optional[str] = "box"
    sub_bold: Optional[bool] = False
    sub_italic: Optional[bool] = False
    sub_margin_v: Optional[int] = 25

    # Từ điển phát âm
    pronunciation_dict: Optional[Dict[str, str]] = None


@router.post("/submit")
async def submit_localize_job(body: LocalizeSubmitRequest, db: AsyncSession = Depends(get_db)):
    """Khởi tạo và chạy ngầm tiến trình Việt Hóa video."""
    # Kiểm tra video tồn tại
    stmt = select(Video).where(Video.id == body.video_id)
    res = await db.execute(stmt)
    video = res.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=404, detail="Video không tồn tại")

    recog_mode = getattr(video, "recognition_type", None) or body.recognition_mode or "voice_only"

    config = {
        "recognition_mode": recog_mode,
        "ai_model": "gemini-3.8-flash",
        "ai_style": body.ai_style,
        "voice_id": body.voice_id,
        "voice_speed": body.voice_speed,
        "sync_mode": body.sync_mode or "keep_duration",
        "volume_voiceover": body.volume_voiceover,
        "keep_original_audio": body.keep_original_audio,
        "volume_original": body.volume_original,
        "volume_original_voice": body.volume_original_voice,
        "cover_old_subtitle": body.cover_old_subtitle,
        "blur_amount": body.blur_amount or 25,
        "blur_method": body.blur_method or "blur",
        "show_subtitles": body.show_subtitles if body.show_subtitles is not None else True,
        "sub_position_mode": body.sub_position_mode or "by_original",
        "sub_placement": body.sub_placement or "overlay",
        "auto_fit_sub_size": True if body.auto_fit_sub_size is None else bool(body.auto_fit_sub_size),
        "sub_position_percent": body.sub_position_percent if body.sub_position_percent is not None else 71,
        "sub_font": body.sub_font or "Oswald",
        "sub_font_size": body.sub_font_size or 50,
        "sub_color": body.sub_color or "#FFFFFF",
        "sub_bg_color": body.sub_bg_color or "#000000",
        "sub_bg_opacity": body.sub_bg_opacity if body.sub_bg_opacity is not None else 50,
        "sub_style_type": body.sub_style_type or "box",
        "sub_bold": bool(body.sub_bold),
        "sub_italic": bool(body.sub_italic),
        "sub_margin_v": body.sub_margin_v if body.sub_margin_v is not None else 25,
        "pronunciation_dict": body.pronunciation_dict or {},
    }


    job = ProcessingJob(
        video_id=video.id,
        module=JobModule.localize,
        current_step=JobStep.queued,
        status=JobStatus.pending,
        progress_percent=0.0,
        config_json=config,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    j: Any = job
    job_id = int(j.id)

    # Chạy background job
    start_localize_job_background(job_id)

    status_val = j.status.value if hasattr(j.status, "value") else str(j.status)
    return {
        "success": True,
        "job_id": job_id,
        "status": status_val,
        "message": "Đã bắt đầu tiến trình Việt Hóa",
    }


@router.get("/jobs/{job_id}/status")
async def get_job_status(job_id: int, db: AsyncSession = Depends(get_db)):
    """Lấy trạng thái và tiến độ của job."""
    stmt = select(ProcessingJob).where(ProcessingJob.id == job_id)
    res = await db.execute(stmt)
    job = res.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    j: Any = job
    config = j.config_json or {}
    created_str = j.created_at.isoformat() if getattr(j, "created_at", None) is not None else None
    finished_str = j.finished_at.isoformat() if getattr(j, "finished_at", None) is not None else None

    from app.api.routes_jobs import get_latest_job_progress
    latest = get_latest_job_progress(int(j.id))
    cur_p = j.progress_percent
    if latest and latest.get("percent") is not None:
        cur_p = max(float(cur_p or 0.0), float(latest["percent"]))

    return {
        "job_id": int(j.id),
        "video_id": int(j.video_id) if getattr(j, "video_id", None) is not None else None,
        "module": j.module.value if hasattr(j.module, "value") else str(j.module),
        "current_step": j.current_step.value if hasattr(j.current_step, "value") else str(j.current_step),
        "status": j.status.value if hasattr(j.status, "value") else str(j.status),
        "progress_percent": cur_p,
        "error_log": j.error_log,
        "output_url": config.get("output_url"),
        "created_at": created_str,
        "finished_at": finished_str,
    }


@router.get("/jobs/{job_id}/transcript")
async def get_job_transcript(job_id: int, db: AsyncSession = Depends(get_db)):
    """Lấy danh sách các câu thoại đã dịch của job."""
    stmt = select(ProcessingJob).where(ProcessingJob.id == job_id)
    res = await db.execute(stmt)
    job = res.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    j: Any = job
    config = j.config_json or {}
    return {
        "job_id": int(j.id),
        "transcript": config.get("translated_segments", []),
    }


@router.get("/recent")
async def get_recent_localize_jobs(db: AsyncSession = Depends(get_db)):
    """Lấy danh sách các job Việt hóa gần đây."""
    stmt = (
        select(ProcessingJob)
        .where(ProcessingJob.module == JobModule.localize)
        .order_by(desc(ProcessingJob.id))
        .limit(10)
    )
    res = await db.execute(stmt)
    jobs = res.scalars().all()
    job_list: list[dict[str, Any]] = []
    for item in jobs:
        j: Any = item
        st = getattr(j, "status", None)
        st_str = getattr(st, "value", str(st or ""))
        created_val = getattr(j, "created_at", None)
        created_str = created_val.isoformat() if created_val is not None else None
        cfg = getattr(j, "config_json", None) or {}
        job_list.append({
            "id": int(j.id),
            "video_id": int(j.video_id) if getattr(j, "video_id", None) is not None else None,
            "status": st_str,
            "progress_percent": float(j.progress_percent or 0.0),
            "created_at": created_str,
            "output_url": cfg.get("output_url"),
        })
    return {"jobs": job_list}


# ─────────────────────────────────────────────────────────────────
# Studio Chỉnh Sửa Việt Hóa (Localize Studio Editor)
# ─────────────────────────────────────────────────────────────────

class LocalizeEditorReRenderRequest(BaseModel):
    segments: List[Dict[str, Any]]
    config: Optional[Dict[str, Any]] = None
    voice_id: Optional[str] = None
    voice_speed: Optional[float] = None
    sync_mode: Optional[str] = None
    volume_voiceover: Optional[int] = None
    keep_original_audio: Optional[bool] = None
    volume_original: Optional[int] = None
    volume_original_voice: Optional[int] = None

    cover_old_subtitle: Optional[bool] = None
    blur_amount: Optional[int] = None
    blur_method: Optional[str] = None

    show_subtitles: Optional[bool] = None
    sub_position_mode: Optional[str] = None
    sub_placement: Optional[str] = None
    auto_fit_sub_size: Optional[bool] = None
    sub_position_percent: Optional[int] = None
    sub_font: Optional[str] = None
    sub_font_size: Optional[int] = None
    sub_color: Optional[str] = None
    sub_bg_color: Optional[str] = None
    sub_bg_opacity: Optional[int] = None
    sub_style_type: Optional[str] = None
    sub_bold: Optional[bool] = None
    sub_italic: Optional[bool] = None
    sub_margin_v: Optional[int] = None

    re_synthesize_tts: bool = False


@router.get("/editor/{video_id}")
async def get_localize_editor_data(video_id: int, db: AsyncSession = Depends(get_db)):
    """
    Lấy toàn bộ dữ liệu để hiển thị trên Studio Chỉnh Sửa Việt Hóa:
    Video gốc, video thành phẩm, bảng phụ đề câu thoại và toàn bộ thông số cấu hình.
    """
    stmt = select(Video).where(Video.id == video_id)
    res = await db.execute(stmt)
    raw_video = res.scalar_one_or_none()
    if not raw_video:
        raise HTTPException(status_code=404, detail="Không tìm thấy video")

    v: Any = raw_video
    loc_dir = Path(settings.STORAGE_DIR) / str(video_id) / "localized"
    loc_mp4 = loc_dir / "output_localized.mp4"
    orig_mp4 = Path(str(v.file_path)) if getattr(v, "file_path", None) else None

    # Lấy job config gần nhất
    job_stmt = (
        select(ProcessingJob)
        .where(ProcessingJob.video_id == video_id, ProcessingJob.module == JobModule.localize)
        .order_by(desc(ProcessingJob.id))
    )
    job_res = await db.execute(job_stmt)
    job = job_res.scalars().first()
    cfg: dict[str, Any] = {}
    segments: list[Any] = []

    # 1. Ưu tiên đọc từ subtitles.json đã lưu/chỉnh sửa nếu có
    sub_json_file = loc_dir / "subtitles.json"
    if sub_json_file.exists():
        try:
            saved_segs = json.loads(sub_json_file.read_text(encoding="utf-8"))
            if isinstance(saved_segs, list) and len(saved_segs) > 0:
                segments = saved_segs
        except Exception as e:
            logger.warning(f"Lỗi đọc subtitles.json: {e}")

    # 2. Nếu chưa có, lấy từ config_json của ProcessingJob
    if not segments and job:
        j_any: Any = job
        if isinstance(getattr(j_any, "config_json", None), dict):
            cfg = j_any.config_json
            segments = cfg.get("translated_segments") or []

    # 3. Nếu vẫn rỗng, fallback đọc từ subtitles.srt
    if not segments:
        srt_file = loc_dir / "subtitles.srt"
        if srt_file.exists():
            try:
                content = srt_file.read_text(encoding="utf-8")
                # Parse basic srt blocks
                blocks = content.strip().split("\n\n")
                for idx, block in enumerate(blocks):
                    lines = block.strip().split("\n")
                    if len(lines) >= 3:
                        time_line = lines[1]
                        text_lines = " ".join(lines[2:])
                        if "-->" in time_line:
                            parts = time_line.split("-->")
                            start_str = parts[0].strip().replace(",", ".")
                            end_str = parts[1].strip().replace(",", ".")
                            # parse seconds
                            def to_sec(s: str) -> float:
                                segs = s.split(":")
                                return float(segs[0]) * 3600 + float(segs[1]) * 60 + float(segs[2])
                            segments.append({
                                "id": idx + 1,
                                "start": to_sec(start_str),
                                "end": to_sec(end_str),
                                "text": text_lines,
                                "text_vi": text_lines,
                            })
            except Exception:
                pass

    rel_localized = os.path.relpath(loc_mp4, settings.STORAGE_DIR).replace("\\", "/") if loc_mp4.exists() else None
    rel_orig = os.path.relpath(orig_mp4, settings.STORAGE_DIR).replace("\\", "/") if orig_mp4 and orig_mp4.exists() else None

    return {
        "success": True,
        "video": {
            "id": v.id,
            "title": v.title or f"Video #{v.id}",
            "duration": float(v.duration or 0),
            "localized_video_url": f"/api/storage/{rel_localized}" if rel_localized else None,
            "original_video_url": f"/api/storage/{rel_orig}" if rel_orig else None,
            "has_localized": loc_mp4.exists(),
        },
        "segments": segments,
        "config": {
            "voice_id": cfg.get("voice_id", "vi-VN-HoaiMyNeural"),
            "voice_speed": float(cfg.get("voice_speed", 1.0)),
            "sync_mode": cfg.get("sync_mode", "keep_duration"),
            "volume_voiceover": int(cfg.get("volume_voiceover", 100)),
            "keep_original_audio": bool(cfg.get("keep_original_audio", True)),
            "volume_original": int(cfg.get("volume_original", 15)),
            "volume_original_voice": int(cfg.get("volume_original_voice", 0)),
            "cover_old_subtitle": bool(cfg.get("cover_old_subtitle", True)),
            "blur_amount": int(cfg.get("blur_amount", 25)),
            "blur_method": cfg.get("blur_method", "blur"),
            "show_subtitles": bool(cfg.get("show_subtitles", True)),
            "sub_position_mode": cfg.get("sub_position_mode", "by_original"),
            "sub_placement": cfg.get("sub_placement", "overlay"),
            "auto_fit_sub_size": bool(cfg.get("auto_fit_sub_size", True)),
            "sub_position_percent": int(cfg.get("sub_position_percent", 71)),
            "sub_font": cfg.get("sub_font", "Oswald"),
            "sub_font_size": int(cfg.get("sub_font_size", 50)),
            "sub_color": cfg.get("sub_color", "#FFFFFF"),
            "sub_bg_color": cfg.get("sub_bg_color", "#000000"),
            "sub_bg_opacity": int(cfg.get("sub_bg_opacity", 50)),
            "sub_style_type": cfg.get("sub_style_type", "box"),
            "sub_bold": bool(cfg.get("sub_bold", False)),
            "sub_italic": bool(cfg.get("sub_italic", False)),
            "sub_margin_v": int(cfg.get("sub_margin_v", 25)),
        }
    }


@router.post("/editor/{video_id}/re-render")
async def re_render_localize_editor_video(
    video_id: int,
    req: LocalizeEditorReRenderRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Render lại video Việt Hóa khi người dùng chỉnh sửa sub/mẫu sub/lồng tiếng.
    Nếu có yêu cầu re_synthesize_tts -> Sinh lại audio voiceover.
    Burn lại sub và ghép lại video bằng FFmpeg.
    """
    stmt = select(Video).where(Video.id == video_id)
    res = await db.execute(stmt)
    raw_video = res.scalar_one_or_none()
    if not raw_video:
        raise HTTPException(status_code=404, detail="Không tìm thấy video")

    v: Any = raw_video
    orig_file = Path(str(v.file_path))
    if not orig_file.exists():
        raise HTTPException(status_code=400, detail="File video gốc không tồn tại")

    loc_dir = Path(settings.STORAGE_DIR) / str(video_id) / "localized"
    loc_dir.mkdir(parents=True, exist_ok=True)
    srt_path = loc_dir / "subtitles.srt"
    voiceover_path = loc_dir / "voiceover.mp3"
    output_localized_path = loc_dir / "output_localized.mp4"

    # 1. Trích xuất toàn bộ cấu hình từ req hoặc req.config
    c: Dict[str, Any] = req.config or {}

    voice_id = req.voice_id or c.get("voice_id") or "vi-VN-HoaiMyNeural"
    voice_speed = req.voice_speed if req.voice_speed is not None else float(c.get("voice_speed", 1.0))
    sync_mode = req.sync_mode or c.get("sync_mode") or "keep_duration"
    volume_voiceover = req.volume_voiceover if req.volume_voiceover is not None else int(c.get("volume_voiceover", 120))
    volume_original = req.volume_original if req.volume_original is not None else int(c.get("volume_original", 15))
    volume_original_voice = req.volume_original_voice if req.volume_original_voice is not None else int(c.get("volume_original_voice", 0))
    keep_original_audio = req.keep_original_audio if req.keep_original_audio is not None else bool(c.get("keep_original_audio", True))

    cover_old_sub = req.cover_old_subtitle if req.cover_old_subtitle is not None else bool(c.get("cover_old_subtitle", True))
    blur_amount = req.blur_amount if req.blur_amount is not None else int(c.get("blur_amount", 25))
    blur_method = req.blur_method or c.get("blur_method") or "boxblur"

    show_subtitles = req.show_subtitles if req.show_subtitles is not None else bool(c.get("show_subtitles", True))
    sub_position_mode = req.sub_position_mode or c.get("sub_position_mode") or "by_original"
    sub_placement = req.sub_placement or c.get("sub_placement") or "overlay"
    auto_fit_sub_size = req.auto_fit_sub_size if req.auto_fit_sub_size is not None else bool(c.get("auto_fit_sub_size", True))
    sub_position_percent = req.sub_position_percent if req.sub_position_percent is not None else int(c.get("sub_position_percent", 71))
    sub_font = req.sub_font or c.get("sub_font") or "Montserrat"
    sub_font_size = req.sub_font_size if req.sub_font_size is not None else int(c.get("sub_font_size", 45))
    sub_color = req.sub_color or c.get("sub_color") or "#FFFFFF"
    sub_bg_color = req.sub_bg_color or c.get("sub_bg_color") or "#000000"
    sub_bg_opacity = req.sub_bg_opacity if req.sub_bg_opacity is not None else int(c.get("sub_bg_opacity", 85))
    sub_style_type = req.sub_style_type or c.get("sub_style_type") or "box"
    sub_bold = req.sub_bold if req.sub_bold is not None else bool(c.get("sub_bold", True))
    sub_italic = req.sub_italic if req.sub_italic is not None else bool(c.get("sub_italic", False))
    sub_margin_v = req.sub_margin_v if req.sub_margin_v is not None else int(c.get("sub_margin_v", 25))

    # 2. Cập nhật lại file srt & json từ segments mới (đảm bảo luôn theo sub đã chỉnh sửa)
    await asyncio.to_thread(generate_srt_file, req.segments, str(srt_path))
    sub_json_path = loc_dir / "subtitles.json"
    try:
        sub_json_path.write_text(json.dumps(req.segments, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        logger.warning(f"Lỗi lưu subtitles.json: {e}")

    # 3. Lấy job config trước đó để so sánh thay đổi giọng hoặc kịch bản
    job_stmt = (
        select(ProcessingJob)
        .where(ProcessingJob.video_id == video_id, ProcessingJob.module == JobModule.localize)
        .order_by(desc(ProcessingJob.id))
    )
    job_res = await db.execute(job_stmt)
    job = job_res.scalars().first()
    prev_cfg: Dict[str, Any] = {}
    if job:
        j_chk: Any = job
        prev_cfg = j_chk.config_json or {}

    old_voice = prev_cfg.get("voice_id")
    old_speed = prev_cfg.get("voice_speed")
    voice_changed = (old_voice is not None and old_voice != voice_id) or (old_speed is not None and float(old_speed) != float(voice_speed))

    old_segments = prev_cfg.get("translated_segments") or []
    old_text = " ".join((s.get("text_vi") or s.get("text", "")).strip() for s in old_segments if isinstance(s, dict))
    new_text = " ".join((s.get("text_vi") or s.get("text", "")).strip() for s in req.segments if isinstance(s, dict))
    text_changed = old_text != new_text

    need_re_tts = req.re_synthesize_tts or voice_changed or text_changed or (not voiceover_path.exists())

    # 4. Sinh lại audio voiceover theo timeline nếu có thay đổi
    if need_re_tts:
        await synthesize_timeline_voiceover(
            segments=req.segments,
            output_path=str(voiceover_path),
            voice=voice_id,
            speed=voice_speed,
            total_duration=float(v.duration or 0.0),
        )
        # Cập nhật lại file srt & json sau khi thời lượng đã đồng bộ chính xác với audio thực tế
        await asyncio.to_thread(generate_srt_file, req.segments, str(srt_path))
        try:
            sub_json_path.write_text(json.dumps(req.segments, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            logger.warning(f"Lỗi lưu subtitles.json sau TTS: {e}")

    # 5. FFmpeg Re-compose với toàn bộ tùy chọn mẫu sub & âm thanh thực tế
    try:
        await asyncio.to_thread(
            compose_localized_video,
            video_path=str(orig_file),
            voiceover_path=str(voiceover_path) if voiceover_path.exists() else None,
            srt_path=str(srt_path),
            output_path=str(output_localized_path),
            cover_old_sub=cover_old_sub,
            bgm_volume=float(volume_original) / 100.0,
            voice_volume=float(volume_voiceover) / 100.0,
            sync_mode=sync_mode,
            show_subtitles=show_subtitles,
            sub_position_mode=sub_position_mode,
            sub_placement=sub_placement,
            auto_fit_sub_size=auto_fit_sub_size,
            sub_position_percent=sub_position_percent,
            sub_font=sub_font,
            sub_font_size=sub_font_size,
            sub_color=sub_color,
            sub_bg_color=sub_bg_color,
            sub_bg_opacity=sub_bg_opacity,
            sub_style_type=sub_style_type,
            sub_bold=sub_bold,
            sub_italic=sub_italic,
            sub_margin_v=sub_margin_v,
            blur_amount=blur_amount,
            blur_method=blur_method,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi render video: {e}")

    # 6. Cập nhật lại config trong DB của ProcessingJob
    if job:
        j_any: Any = job
        cfg = j_any.config_json or {}
        cfg.update({
            "translated_segments": req.segments,
            "voice_id": voice_id,
            "voice_speed": voice_speed,
            "sync_mode": sync_mode,
            "volume_voiceover": volume_voiceover,
            "keep_original_audio": keep_original_audio,
            "volume_original": volume_original,
            "volume_original_voice": volume_original_voice,
            "cover_old_subtitle": cover_old_sub,
            "blur_amount": blur_amount,
            "blur_method": blur_method,
            "show_subtitles": show_subtitles,
            "sub_position_mode": sub_position_mode,
            "sub_placement": sub_placement,
            "auto_fit_sub_size": auto_fit_sub_size,
            "sub_position_percent": sub_position_percent,
            "sub_font": sub_font,
            "sub_font_size": sub_font_size,
            "sub_color": sub_color,
            "sub_bg_color": sub_bg_color,
            "sub_bg_opacity": sub_bg_opacity,
            "sub_style_type": sub_style_type,
            "sub_bold": sub_bold,
            "sub_italic": sub_italic,
            "sub_margin_v": sub_margin_v,
        })
        j_any.config_json = cfg
        await db.commit()

    # Đồng bộ sang file final nếu video đã từng được lưu thành phẩm
    import shutil
    storage_base = Path(settings.STORAGE_DIR) / str(video_id)
    final_candidates = [
        storage_base / "output_final.mp4",
        storage_base / "final.mp4",
    ]
    if getattr(v, "output_path", None) and Path(str(v.output_path)).exists():
        final_candidates.append(Path(str(v.output_path)))
    for f_cand in final_candidates:
        if f_cand.exists() and f_cand.resolve() != output_localized_path.resolve():
            try:
                shutil.copyfile(output_localized_path, f_cand)
                logger.info(f"[Localize Editor] Đã cập nhật phụ đề mới sang final file: {f_cand}")
            except Exception as copy_err:
                logger.warning(f"Lỗi copy sang final {f_cand}: {copy_err}")

    rel_output = os.path.relpath(output_localized_path, settings.STORAGE_DIR).replace("\\", "/")
    return {
        "success": True,
        "message": "Đã cập nhật phụ đề và render lại video thành công!",
        "video_url": f"/api/storage/{rel_output}?t={int(asyncio.get_event_loop().time())}",
        "localized_video_url": f"/api/storage/{rel_output}?t={int(asyncio.get_event_loop().time())}",
    }


# ==========================================
# CẤU HÌNH STUDIO VIỆT HÓA (PRESETS & CATEGORIES)
# ==========================================

DEFAULT_PRESET_SEED = [
    {
        "category": "TikTok Shop Affiliate",
        "name": "Bán Hàng Hot Trend (Hoài My - Hộp Vàng)",
        "description": "Tối ưu video bán hàng TikTok, phụ đề chữ vàng nền đen nổi bật, giọng nữ Hoài My tự nhiên.",
        "is_default": True,
        "settings": {
            "ai_style": "bán hàng",
            "voice_id": "vi-VN-HoaiMyNeural",
            "voice_speed": 1.0,
            "sync_mode": "hybrid",
            "volume_voiceover": 100,
            "keep_original_audio": True,
            "volume_original": 15,
            "volume_original_voice": 0,
            "cover_old_subtitle": True,
            "blur_amount": 25,
            "blur_method": "blur",
            "show_subtitles": True,
            "sub_position_mode": "by_original",
            "sub_placement": "overlay",
            "auto_fit_sub_size": True,
            "sub_position_percent": 71,
            "sub_font": "Oswald",
            "sub_font_size": 29,
            "sub_color": "#FFD700",
            "sub_bg_color": "#000000",
            "sub_bg_opacity": 82,
            "sub_style_type": "box",
            "sub_bold": True,
            "sub_italic": False,
            "sub_margin_v": 25,
            "pronunciation_dict": {"TikTok": "Tíc Tóc", "Affiliate": "A-phi-li-ét"},
        }
    },
    {
        "category": "Review Phim & Kịch Tính",
        "name": "Review Phim Gay Cấn (Gemini Enceladus - Viền Đen)",
        "description": "Giọng nam Enceladus trầm ấm dẫn dắt, nhịp điệu dồn dập, phụ đề viền đen tương phản cao.",
        "is_default": False,
        "settings": {
            "ai_style": "review phim",
            "voice_id": "gemini-Enceladus",
            "voice_speed": 1.0,
            "sync_mode": "hybrid",
            "volume_voiceover": 100,
            "keep_original_audio": True,
            "volume_original": 12,
            "volume_original_voice": 0,
            "cover_old_subtitle": True,
            "blur_amount": 28,
            "blur_method": "blur",
            "show_subtitles": True,
            "sub_position_mode": "by_original",
            "sub_placement": "overlay",
            "auto_fit_sub_size": True,
            "sub_position_percent": 71,
            "sub_font": "Montserrat",
            "sub_font_size": 30,
            "sub_color": "#FFFFFF",
            "sub_bg_color": "#000000",
            "sub_bg_opacity": 90,
            "sub_style_type": "outline",
            "sub_bold": True,
            "sub_italic": False,
            "sub_margin_v": 25,
            "pronunciation_dict": {},
        }
    },
    {
        "category": "Phim Hoạt Hình & AI",
        "name": "Hoạt Hình AI Hài Hước (Gemini Despina - Hộp Đỏ)",
        "description": "Giọng nữ Despina trẻ trung sôi nổi, phụ đề hộp đỏ bắt mắt giữ chân người xem.",
        "is_default": False,
        "settings": {
            "ai_style": "hoạt hình",
            "voice_id": "gemini-Despina",
            "voice_speed": 1.0,
            "sync_mode": "hybrid",
            "volume_voiceover": 100,
            "keep_original_audio": True,
            "volume_original": 10,
            "volume_original_voice": 0,
            "cover_old_subtitle": True,
            "blur_amount": 25,
            "blur_method": "blur",
            "show_subtitles": True,
            "sub_position_mode": "by_original",
            "sub_placement": "overlay",
            "auto_fit_sub_size": True,
            "sub_position_percent": 71,
            "sub_font": "Quicksand",
            "sub_font_size": 29,
            "sub_color": "#FFFFFF",
            "sub_bg_color": "#E11D48",
            "sub_bg_opacity": 82,
            "sub_style_type": "box",
            "sub_bold": True,
            "sub_italic": False,
            "sub_margin_v": 25,
            "pronunciation_dict": {},
        }
    },
    {
        "category": "Tin Tức & Đời Thường",
        "name": "Tin Tức Đời Thường (Nam Minh Quang - Tự Nhiên)",
        "description": "Giọng nam tự nhiên gần gũi, âm thanh rõ ràng, phụ đề hộp đen thanh lịch.",
        "is_default": False,
        "settings": {
            "ai_style": "đời thường",
            "voice_id": "vi-VN-NamMinhNeural",
            "voice_speed": 1.0,
            "sync_mode": "hybrid",
            "volume_voiceover": 100,
            "keep_original_audio": True,
            "volume_original": 10,
            "volume_original_voice": 0,
            "cover_old_subtitle": True,
            "blur_amount": 25,
            "blur_method": "blur",
            "show_subtitles": True,
            "sub_position_mode": "by_original",
            "sub_placement": "overlay",
            "auto_fit_sub_size": True,
            "sub_position_percent": 71,
            "sub_font": "Roboto",
            "sub_font_size": 28,
            "sub_color": "#FFFFFF",
            "sub_bg_color": "#000000",
            "sub_bg_opacity": 75,
            "sub_style_type": "box",
            "sub_bold": True,
            "sub_italic": False,
            "sub_margin_v": 25,
            "pronunciation_dict": {},
        }
    },
]


class PresetCreateRequest(BaseModel):
    category: Optional[str] = "Mặc định"
    name: str
    description: Optional[str] = None
    is_default: Optional[bool] = False
    settings: Dict[str, Any]


class PresetUpdateRequest(BaseModel):
    category: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    is_default: Optional[bool] = None
    settings: Optional[Dict[str, Any]] = None


async def _seed_presets_if_needed(db: AsyncSession):
    """Seed sẵn một số cấu hình mẫu nếu bảng chưa có dữ liệu."""
    stmt = select(LocalizePreset)
    res = await db.execute(stmt)
    existing = res.scalars().all()
    if not existing:
        for p in DEFAULT_PRESET_SEED:
            item = LocalizePreset(
                category=p["category"],
                name=p["name"],
                description=p["description"],
                is_default=p["is_default"],
                settings=p["settings"],
            )
            db.add(item)
        await db.commit()


@router.get("/presets")
async def get_localize_presets(db: AsyncSession = Depends(get_db)):
    """Lấy danh sách cấu hình mẫu đã lưu, tự động phân nhóm theo danh mục."""
    await _seed_presets_if_needed(db)
    stmt = select(LocalizePreset).order_by(LocalizePreset.category, LocalizePreset.name)
    res = await db.execute(stmt)
    presets = res.scalars().all()

    # Gom nhóm theo category
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    categories: List[str] = []
    for p in presets:
        d = p.to_dict()
        cat = str(getattr(p, "category", "") or "Chung")
        if cat not in grouped:
            grouped[cat] = []
            categories.append(cat)
        grouped[cat].append(d)

    return {
        "presets": [p.to_dict() for p in presets],
        "grouped": grouped,
        "categories": categories,
    }


@router.get("/categories")
async def get_localize_categories(db: AsyncSession = Depends(get_db)):
    """Lấy danh sách các danh mục cấu hình."""
    await _seed_presets_if_needed(db)
    stmt = select(LocalizePreset.category).distinct()
    res = await db.execute(stmt)
    cats = [c for c in res.scalars().all() if c]
    return {"categories": cats}


@router.post("/presets")
async def create_localize_preset(body: PresetCreateRequest, db: AsyncSession = Depends(get_db)):
    """Tạo mới một cấu hình mẫu."""
    name_clean = body.name.strip()
    cat_clean = (body.category or "Mặc định").strip()
    if not name_clean:
        raise HTTPException(status_code=400, detail="Tên cấu hình không được để trống")

    if body.is_default:
        # Bỏ default của các cấu hình khác
        stmt = select(LocalizePreset).where(LocalizePreset.is_default == True)
        res = await db.execute(stmt)
        for p in res.scalars().all():
            p_any: Any = p
            p_any.is_default = False

    preset = LocalizePreset(
        category=cat_clean,
        name=name_clean,
        description=body.description,
        is_default=bool(body.is_default),
        settings=body.settings,
    )
    db.add(preset)
    await db.commit()
    await db.refresh(preset)
    return {"success": True, "preset": preset.to_dict()}


@router.put("/presets/{preset_id}")
async def update_localize_preset(preset_id: int, body: PresetUpdateRequest, db: AsyncSession = Depends(get_db)):
    """Cập nhật cấu hình mẫu đã có."""
    stmt = select(LocalizePreset).where(LocalizePreset.id == preset_id)
    res = await db.execute(stmt)
    raw_preset = res.scalar_one_or_none()
    if not raw_preset:
        raise HTTPException(status_code=404, detail="Không tìm thấy cấu hình")

    preset: Any = raw_preset

    if body.name is not None:
        name_clean = body.name.strip()
        if not name_clean:
            raise HTTPException(status_code=400, detail="Tên cấu hình không được để trống")
        preset.name = name_clean

    if body.category is not None:
        preset.category = body.category.strip() or "Mặc định"

    if body.description is not None:
        preset.description = body.description

    if body.settings is not None:
        preset.settings = body.settings

    if body.is_default is not None:
        if body.is_default:
            stmt2 = select(LocalizePreset).where(LocalizePreset.id != preset_id, LocalizePreset.is_default == True)
            res2 = await db.execute(stmt2)
            for p in res2.scalars().all():
                p_any: Any = p
                p_any.is_default = False
        preset.is_default = body.is_default

    await db.commit()
    await db.refresh(preset)
    return {"success": True, "preset": preset.to_dict()}


@router.delete("/presets/{preset_id}")
async def delete_localize_preset(preset_id: int, db: AsyncSession = Depends(get_db)):
    """Xóa cấu hình mẫu."""
    stmt = select(LocalizePreset).where(LocalizePreset.id == preset_id)
    res = await db.execute(stmt)
    preset = res.scalar_one_or_none()
    if not preset:
        raise HTTPException(status_code=404, detail="Không tìm thấy cấu hình")

    await db.delete(preset)
    await db.commit()
    return {"success": True, "message": "Đã xóa cấu hình"}


@router.post("/presets/{preset_id}/duplicate")
async def duplicate_localize_preset(preset_id: int, db: AsyncSession = Depends(get_db)):
    """Nhân bản một cấu hình mẫu."""
    stmt = select(LocalizePreset).where(LocalizePreset.id == preset_id)
    res = await db.execute(stmt)
    original = res.scalar_one_or_none()
    if not original:
        raise HTTPException(status_code=404, detail="Không tìm thấy cấu hình")

    new_name = f"{original.name} (Bản sao)"
    copy_preset = LocalizePreset(
        category=original.category,
        name=new_name,
        description=original.description,
        is_default=False,
        settings=original.settings,
    )
    db.add(copy_preset)
    await db.commit()
    await db.refresh(copy_preset)
    return {"success": True, "preset": copy_preset.to_dict()}


@router.post("/presets/{preset_id}/set-default")
async def set_default_localize_preset(preset_id: int, db: AsyncSession = Depends(get_db)):
    """Đặt cấu hình làm mặc định."""
    stmt = select(LocalizePreset).where(LocalizePreset.id == preset_id)
    res = await db.execute(stmt)
    target = res.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="Không tìm thấy cấu hình")

    # Bỏ default của tất cả
    stmt_all = select(LocalizePreset)
    res_all = await db.execute(stmt_all)
    for p in res_all.scalars().all():
        p_any: Any = p
        p_any.is_default = (getattr(p_any, "id", None) == preset_id)

    await db.commit()
    await db.refresh(target)
    return {"success": True, "preset": target.to_dict()}

