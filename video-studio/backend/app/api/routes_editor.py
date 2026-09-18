"""
Routes Editor — Trình Chỉnh Sửa Hậu Kỳ, Lưu Video Final & Lên Lịch Đăng TikTok.
Quy trình tinh gọn: Xem/Sửa sub -> Sinh Caption AI (đơn lẻ / hàng loạt) -> Lưu Video Final -> Lên Lịch Đăng.
"""

import json
import logging
import os
import re
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_db
from app.models.channel import Channel
from app.models.job import JobModule, ProcessingJob
from app.models.publish_schedule import PublishSchedule, PublishStatus
from app.models.video import Video, VideoStatus
from app.models.localize_preset import LocalizePreset
from app.services.compose_service import compose_localized_video, generate_srt_file
from app.services.gemini_service import generate_tiktok_caption
from app.services.tiktok_channel_service import get_configured_tiktok_channels
from app.api.routes_publish import parse_scheduled_datetime

logger = logging.getLogger(__name__)

router = APIRouter()


# ─────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────

class GenerateCaptionRequest(BaseModel):
    include_hashtags: bool = True
    style: Optional[str] = "short"
    custom_prompt: Optional[str] = None


class BatchGenerateCaptionRequest(BaseModel):
    video_ids: list[int]
    include_hashtags: bool = True
    style: Optional[str] = "short"
    custom_prompt: Optional[str] = None


class ReRenderSubtitlesRequest(BaseModel):
    segments: list[dict[str, Any]]


class SaveAndScheduleRequest(BaseModel):
    caption: str
    hashtags: list[str] | str = []
    channel_ids: list[int] = []
    scheduled_time: str | None = None  # ISO format string or None for auto-slot


class UpdateCaptionRequest(BaseModel):
    caption: str
    hashtags: Optional[list[str]] = []


# ─────────────────────────────────────────────────────────────────
# Helper Functions
# ─────────────────────────────────────────────────────────────────

def _get_video_localized_dir(video_id: int) -> Path:
    return Path(settings.STORAGE_DIR) / str(video_id) / "localized"


def _get_video_final_path(video_id: int) -> Path:
    return Path(settings.STORAGE_DIR) / str(video_id) / "final.mp4"


def _get_video_script_text(video_id: int) -> str:
    """Đọc kịch bản tiếng Việt từ subtitles.srt hoặc file tạm."""
    srt_path = _get_video_localized_dir(video_id) / "subtitles.srt"
    if srt_path.exists():
        try:
            content = srt_path.read_text(encoding="utf-8")
            lines = []
            for line in content.splitlines():
                line = line.strip()
                if not line or line.isdigit() or "-->" in line:
                    continue
                lines.append(line)
            return " ".join(lines)
        except Exception as e:  # noqa: BLE001
            logger.debug(f"Không thể đọc text phụ đề srt: {e}")
    return ""


# ─────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────

@router.get("/videos")
async def list_editor_videos(db: AsyncSession = Depends(get_db)):  # noqa: B008
    """
    Lấy danh sách các video đã có bản việt hóa thành phẩm sẵn sàng để hậu kỳ / lên lịch.
    """
    stmt = (
        select(Video)
        .order_by(Video.updated_at.desc())
    )
    result = await db.execute(stmt)
    videos = result.scalars().all()

    # Lấy danh sách preset để đối chiếu tên cấu hình
    presets_stmt = select(LocalizePreset)
    presets_res = await db.execute(presets_stmt)
    all_presets = presets_res.scalars().all()

    finished_videos = []
    for raw_v in videos:
        v: Any = raw_v
        v_id: int = int(v.id)
        loc_dir = _get_video_localized_dir(v_id)
        loc_mp4 = loc_dir / "output_localized.mp4"
        final_mp4 = _get_video_final_path(v_id)

        # Video thành phẩm là CHỈ CÓ những video ĐÃ ĐƯỢC LƯU THÀNH PHẨM thực tế:
        has_final = final_mp4.exists()
        has_op = bool(v.output_path and os.path.exists(str(v.output_path)))

        if not (has_final or has_op):
            # Chưa được lưu vào Hậu Kỳ -> bỏ qua!
            continue

        if has_final:
            video_file = final_mp4
        else:
            video_file = Path(str(v.output_path))

        rel_video_path = os.path.relpath(video_file, settings.STORAGE_DIR).replace(chr(92), "/")

        # Lấy thumbnail url
        thumb_url = None
        thumb_p = getattr(v, "thumbnail_path", None)
        if thumb_p and str(thumb_p).startswith("/api/"):
            thumb_url = str(thumb_p)
        elif thumb_p and os.path.exists(str(thumb_p)):
            rel_thumb_path = os.path.relpath(str(thumb_p), settings.STORAGE_DIR).replace(chr(92), "/")
            thumb_url = f"/api/storage/{rel_thumb_path}"
        else:
            disk_thumb = settings.STORAGE_DIR / str(v_id) / "thumbnail.jpg"
            if disk_thumb.exists():
                thumb_url = f"/api/storage/{v_id}/thumbnail.jpg"

        # Kiểm tra xem video đã có lịch đăng thực tế chưa (chỉ tính lịch đã lên giờ đăng, không tính bản nháp caption pending)
        sched_stmt = select(PublishSchedule).where(PublishSchedule.video_id == v_id)
        sched_res = await db.execute(sched_stmt)
        schedules = sched_res.scalars().all()
        actual_schedules = [
            s for s in schedules
            if str(getattr(s.status, "value", s.status)).lower() in ["scheduled", "posted"] and s.scheduled_time is not None
        ]
        has_schedule = len(actual_schedules) > 0
        existing_caption = ""
        existing_hashtags: list[str] = []
        if schedules:
            first_sched: Any = schedules[0]
            existing_caption = str(first_sched.caption or "")
            raw_ht = first_sched.hashtags
            if raw_ht:
                try:
                    existing_hashtags = json.loads(str(raw_ht))
                except Exception:  # noqa: BLE001
                    existing_hashtags = [s.strip() for s in str(raw_ht).split() if s.strip()]

        # Nếu chưa có caption trong schedule, kiểm tra file caption.json trong thư mục localized
        loc_dir = _get_video_localized_dir(v_id)
        cap_file = loc_dir / "caption.json"
        if not existing_caption and cap_file.exists():
            try:
                with open(cap_file, "r", encoding="utf-8") as cf:
                    cdata = json.load(cf)
                    existing_caption = str(cdata.get("caption", "")).strip()
                    if not existing_hashtags:
                        existing_hashtags = cdata.get("hashtags", [])
            except Exception:  # noqa: BLE001
                pass

        v_title = str(v.title) if getattr(v, "title", None) else f"Video #{v_id}"
        v_duration = float(v.duration) if getattr(v, "duration", None) else 0.0
        v_status_val = str(getattr(v.status, "value", v.status)) if getattr(v, "status", None) else "raw"
        v_updated = v.updated_at.isoformat() if getattr(v, "updated_at", None) else None

        # Lấy config_summary từ ProcessingJob gần nhất (để hiện cấu hình trên preview)
        config_summary: dict[str, Any] = {}
        job_stmt = (
            select(ProcessingJob)
            .where(ProcessingJob.video_id == v_id, ProcessingJob.module == JobModule.localize)
            .order_by(ProcessingJob.id.desc())
        )
        job_res = await db.execute(job_stmt)
        latest_job = job_res.scalars().first()
        if latest_job:
            cfg = getattr(latest_job, "config_json", None) or {}
            if isinstance(cfg, dict):
                preset_id = cfg.get("preset_id")
                preset_name = cfg.get("preset_name")
                if not preset_name and all_presets:
                    if preset_id:
                        for p in all_presets:
                            p_any: Any = p
                            if getattr(p_any, "id", None) == preset_id:
                                preset_name = str(getattr(p_any, "name", "") or "")
                                break
                    if not preset_name:
                        for p in all_presets:
                            p_any = p
                            pst = getattr(p_any, "settings", None) or {}
                            if (
                                pst.get("voice_id") == cfg.get("voice_id")
                                and pst.get("sub_font") == cfg.get("sub_font")
                            ):
                                preset_name = str(getattr(p_any, "name", "") or "")
                                preset_id = getattr(p_any, "id", None)
                                break
                    if not preset_name:
                        def_p: Any = next((p for p in all_presets if getattr(p, "is_default", False)), all_presets[0] if all_presets else None)
                        if def_p:
                            preset_name = str(getattr(def_p, "name", "") or "")
                            preset_id = getattr(def_p, "id", None)

                config_summary = {
                    "preset_id": preset_id,
                    "preset_name": preset_name or "Cấu hình chuẩn",
                    "sub_font": cfg.get("sub_font", ""),
                    "sub_font_size": cfg.get("sub_font_size", 0),
                    "sub_color": cfg.get("sub_color", ""),
                    "sub_bg_color": cfg.get("sub_bg_color", ""),
                    "sub_style_type": cfg.get("sub_style_type", ""),
                    "voice_id": cfg.get("voice_id", ""),
                    "ai_style": cfg.get("ai_style", ""),
                    "show_subtitles": cfg.get("show_subtitles", True),
                }

        finished_videos.append({
            "id": v_id,
            "title": v_title,
            "duration": v_duration,
            "resolution": getattr(v, "resolution", None),
            "thumbnail_url": thumb_url,
            "video_url": f"/api/storage/{rel_video_path}",
            "has_final": has_final,
            "has_schedule": has_schedule,
            "has_caption": bool(existing_caption.strip()),
            "caption": existing_caption,
            "hashtags": existing_hashtags,
            "config_summary": config_summary,
            "status": v_status_val,
            "updated_at": v_updated,
        })

    return {"videos": finished_videos}


@router.get("/video/{video_id}")
async def get_editor_video_detail(video_id: int, db: AsyncSession = Depends(get_db)):  # noqa: B008
    """
    Lấy thông tin chi tiết một video: phụ đề timeline, video url, caption/hashtags, kênh đăng.
    """
    stmt = select(Video).where(Video.id == video_id)
    result = await db.execute(stmt)
    raw_video = result.scalar_one_or_none()
    if not raw_video:
        raise HTTPException(status_code=404, detail="Không tìm thấy video")

    video: Any = raw_video
    v_id: int = int(video.id)
    loc_dir = _get_video_localized_dir(v_id)
    loc_mp4 = loc_dir / "output_localized.mp4"
    final_mp4 = _get_video_final_path(v_id)
    video_file = final_mp4 if final_mp4.exists() else loc_mp4

    if not video_file.exists():
        raise HTTPException(status_code=400, detail="Video chưa có bản việt hóa thành phẩm")

    rel_video_path = os.path.relpath(video_file, settings.STORAGE_DIR).replace(chr(92), "/")

    # Ưu tiên lấy segments từ file subtitles.json đã lưu đính chính, fallback sang Job config gần nhất
    subtitles_file = loc_dir / "subtitles.json"
    segments: list[Any] = []
    if subtitles_file.exists():
        try:
            with open(subtitles_file, "r", encoding="utf-8") as sf:
                segments = json.load(sf)
        except Exception:  # noqa: BLE001
            segments = []

    job_stmt = (
        select(ProcessingJob)
        .where(ProcessingJob.video_id == v_id, ProcessingJob.module == JobModule.localize)
        .order_by(ProcessingJob.id.desc())
    )
    job_res = await db.execute(job_stmt)
    raw_job = job_res.scalars().first()

    job_config: dict[str, Any] = {}
    if raw_job:
        job_any: Any = raw_job
        cfg = getattr(job_any, "config_json", None)
        if isinstance(cfg, dict):
            job_config = cfg
            if not segments:
                segments = cfg.get("translated_segments") or []

    # Chuẩn hóa danh sách segments có id (1-indexed), start, end, text_vi, text_original
    formatted_segments = []
    for idx, s in enumerate(segments):
        if isinstance(s, dict):
            formatted_segments.append({
                "id": s.get("id", idx + 1),
                "start": float(s.get("start", 0.0)),
                "end": float(s.get("end", 0.0)),
                "text_vi": str(s.get("text_vi") or s.get("text") or "").strip(),
                "text_original": str(s.get("text_zh") or s.get("text_original") or s.get("text") or "").strip(),
            })
    segments = formatted_segments

    # Lấy lịch đăng hiện tại (nếu có)
    sched_stmt = select(PublishSchedule).where(PublishSchedule.video_id == v_id)
    sched_res = await db.execute(sched_stmt)
    schedules = sched_res.scalars().all()
    caption = ""
    hashtags: list[str] = []
    selected_channel_ids: list[int] = []
    if schedules:
        for s in schedules:
            s_any: Any = s
            if hasattr(s_any, "channel_id") and s_any.channel_id:
                selected_channel_ids.append(int(s_any.channel_id))
        first_s: Any = schedules[0]
        caption = str(first_s.caption or "")
        raw_ht = first_s.hashtags
        if raw_ht:
            try:
                hashtags = json.loads(str(raw_ht))
            except Exception:  # noqa: BLE001
                hashtags = [tag.strip() for tag in str(raw_ht).split() if tag.strip()]

    # Nếu chưa có caption trong schedule, lấy từ caption.json nếu có
    cap_file = loc_dir / "caption.json"
    if not caption and cap_file.exists():
        try:
            with open(cap_file, "r", encoding="utf-8") as cf:
                cdata = json.load(cf)
                caption = str(cdata.get("caption", "")).strip()
                if not hashtags:
                    hashtags = cdata.get("hashtags", [])
        except Exception:  # noqa: BLE001
            pass

    # Lấy danh sách kênh TikTok ĐƯỢC CẤU HÌNH trong Cài Đặt
    channels_configured = get_configured_tiktok_channels()

    v_title = str(video.title) if getattr(video, "title", None) else f"Video #{v_id}"
    v_duration = float(video.duration) if getattr(video, "duration", None) else 0.0

    return {
        "id": v_id,
        "title": v_title,
        "duration": v_duration,
        "resolution": getattr(video, "resolution", None),
        "video_url": f"/api/storage/{rel_video_path}",
        "has_final": final_mp4.exists(),
        "segments": segments,
        "caption": caption,
        "hashtags": hashtags,
        "selected_channel_ids": selected_channel_ids,
        "job_config": job_config,
        "channels": [
            {
                "id": int(ch.get("id", 0)),
                "name": str(ch.get("name", "")),
                "platform": str(ch.get("platform_source", "tiktok")),
            }
            for ch in channels_configured
        ],
    }


@router.post("/video/{video_id}/generate-caption")
async def generate_caption_endpoint(
    video_id: int,
    req: GenerateCaptionRequest,
    db: AsyncSession = Depends(get_db),  # noqa: B008
):
    """
    Sinh Caption & Hashtags TikTok tự động bằng Gemini AI cho 1 video thành phẩm VÀ LƯU NGAY VÀO DB.
    """
    stmt = select(Video).where(Video.id == video_id)
    result = await db.execute(stmt)
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=404, detail="Không tìm thấy video")

    script_text = _get_video_script_text(video_id)
    if not script_text:
        job_stmt = (
            select(ProcessingJob)
            .where(ProcessingJob.video_id == video_id)
            .order_by(ProcessingJob.id.desc())
        )
        job_res = await db.execute(job_stmt)
        j: Any = job_res.scalars().first()
        if j:
            cfg = getattr(j, "config_json", None)
            if isinstance(cfg, dict):
                segs = cfg.get("translated_segments") or []
                script_text = " ".join(s.get("text_vi", "") for s in segs if s.get("text_vi"))

    caption_res = await generate_tiktok_caption(
        db=db,
        script_text=script_text,
        include_hashtags=req.include_hashtags,
        style=req.style or "short",
        custom_prompt=req.custom_prompt,
    )

    caption_text = str(caption_res.get("caption") or caption_res.get("title") or "").strip()
    hashtags_list = caption_res.get("hashtags", [])
    if req.include_hashtags and not hashtags_list:
        found_tags = re.findall(r"#\w+", caption_text)
        if found_tags:
            hashtags_list = [t for t in found_tags if len(t) > 1]
        else:
            hashtags_list = ["#xuhuong", "#fyp", "#videohay"]

    hashtags_json = json.dumps(hashtags_list, ensure_ascii=False)

    # Lưu ngay vào PublishSchedule để không bị mất
    sched_stmt = select(PublishSchedule).where(PublishSchedule.video_id == video_id)
    sched_res = await db.execute(sched_stmt)
    schedules = sched_res.scalars().all()
    if schedules:
        for s in schedules:
            s_any: Any = s
            s_any.caption = caption_text
            s_any.hashtags = hashtags_json
    else:
        ch_id = getattr(video, "channel_id", None)
        if not ch_id:
            ch_stmt = select(Channel).order_by(Channel.id.asc())
            ch_res = await db.execute(ch_stmt)
            first_ch = ch_res.scalars().first()
            if first_ch:
                first_ch_any: Any = first_ch
                ch_id = getattr(first_ch_any, "id", None)
        if ch_id:
            new_sched = PublishSchedule(
                video_id=video_id,
                channel_id=int(ch_id),
                platform="tiktok",
                status=PublishStatus.pending,
                caption=caption_text,
                hashtags=hashtags_json,
            )
            db.add(new_sched)

    # Lưu file caption.json vào thư mục localized của video
    loc_dir = _get_video_localized_dir(video_id)
    loc_dir.mkdir(parents=True, exist_ok=True)
    try:
        with open(loc_dir / "caption.json", "w", encoding="utf-8") as cf:
            json.dump({
                "caption": caption_text,
                "hashtags": hashtags_list,
                "title": caption_res.get("title", ""),
                "updated_at": datetime.utcnow().isoformat(),
            }, cf, ensure_ascii=False, indent=2)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Lỗi ghi caption.json cho video {video_id}: {e}")

    await db.commit()

    return {
        "video_id": video_id,
        "title": caption_res.get("title", ""),
        "caption": caption_text,
        "hashtags": hashtags_list,
    }


@router.post("/batch-generate-captions")
async def batch_generate_captions_endpoint(
    req: BatchGenerateCaptionRequest,
    db: AsyncSession = Depends(get_db),  # noqa: B008
):
    """
    Sinh Caption & Hashtags AI hàng loạt cho nhiều video đã chọn VÀ LƯU NGAY VÀO DB.
    """
    if not req.video_ids:
        return {"results": {}}

    results = {}
    for vid in req.video_ids:
        script_text = _get_video_script_text(vid)
        if not script_text:
            job_stmt = (
                select(ProcessingJob)
                .where(ProcessingJob.video_id == vid)
                .order_by(ProcessingJob.id.desc())
            )
            job_res = await db.execute(job_stmt)
            j: Any = job_res.scalars().first()
            if j:
                cfg = getattr(j, "config_json", None)
                if isinstance(cfg, dict):
                    segs = cfg.get("translated_segments") or []
                    script_text = " ".join(s.get("text_vi", "") for s in segs if s.get("text_vi"))

        try:
            cap_data = await generate_tiktok_caption(
                db=db,
                script_text=script_text,
                include_hashtags=req.include_hashtags,
                style=req.style or "short",
                custom_prompt=req.custom_prompt,
            )
            c_text = str(cap_data.get("caption") or cap_data.get("title") or "").strip()
            h_list = cap_data.get("hashtags", [])
            if req.include_hashtags and not h_list:
                found_tags = re.findall(r"#\w+", c_text)
                if found_tags:
                    h_list = [t for t in found_tags if len(t) > 1]
                else:
                    h_list = ["#xuhuong", "#fyp", "#videohay"]
            results[str(vid)] = {
                "caption": c_text,
                "hashtags": h_list,
                "title": cap_data.get("title", ""),
            }
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Batch generate caption error for video {vid}: {e}")
            c_text = "Khám phá video cực kỳ thú vị và bổ ích ngay hôm nay! ✨"
            h_list = ["#xuhuong", "#fyp"] if req.include_hashtags else []
            results[str(vid)] = {
                "caption": c_text,
                "hashtags": h_list,
                "title": "Video nổi bật",
            }

        # Lưu ngay vào DB và caption.json cho từng video trong batch
        try:
            h_json = json.dumps(results[str(vid)]["hashtags"], ensure_ascii=False)
            sched_stmt = select(PublishSchedule).where(PublishSchedule.video_id == vid)
            sched_res = await db.execute(sched_stmt)
            schedules = sched_res.scalars().all()
            if schedules:
                for s in schedules:
                    s_any: Any = s
                    s_any.caption = results[str(vid)]["caption"]
                    s_any.hashtags = h_json
            else:
                v_res = await db.execute(select(Video).where(Video.id == vid))
                v_obj = v_res.scalar_one_or_none()
                ch_id = getattr(v_obj, "channel_id", None)
                if not ch_id:
                    ch_res = await db.execute(select(Channel).order_by(Channel.id.asc()))
                    f_ch = ch_res.scalars().first()
                    if f_ch:
                        f_ch_any: Any = f_ch
                        ch_id = getattr(f_ch_any, "id", None)
                if ch_id:
                    db.add(PublishSchedule(
                        video_id=vid,
                        channel_id=int(ch_id),
                        platform="tiktok",
                        status=PublishStatus.pending,
                        caption=results[str(vid)]["caption"],
                        hashtags=h_json,
                    ))

            loc_d = _get_video_localized_dir(vid)
            loc_d.mkdir(parents=True, exist_ok=True)
            with open(loc_d / "caption.json", "w", encoding="utf-8") as cf:
                json.dump({
                    "caption": results[str(vid)]["caption"],
                    "hashtags": results[str(vid)]["hashtags"],
                    "title": results[str(vid)]["title"],
                    "updated_at": datetime.utcnow().isoformat(),
                }, cf, ensure_ascii=False, indent=2)
        except Exception as save_err:  # noqa: BLE001
            logger.warning(f"Lỗi lưu batch caption cho video {vid}: {save_err}")

    await db.commit()
    return {"results": results}


@router.put("/video/{video_id}/caption")
async def update_video_caption(
    video_id: int,
    req: UpdateCaptionRequest,
    db: AsyncSession = Depends(get_db),  # noqa: B008
):
    """
    Cập nhật thủ công nội dung caption và danh sách hashtags cho một video.
    """
    caption_text = req.caption.strip()
    ht_list = req.hashtags if isinstance(req.hashtags, list) else [h.strip() for h in str(req.hashtags).split() if h.strip()]
    h_json = json.dumps(ht_list, ensure_ascii=False)

    # 1. Cập nhật vào PublishSchedule nếu video đã có bản ghi lịch
    sched_stmt = select(PublishSchedule).where(PublishSchedule.video_id == video_id)
    sched_res = await db.execute(sched_stmt)
    schedules = sched_res.scalars().all()
    if schedules:
        for s in schedules:
            s_any: Any = s
            s_any.caption = caption_text
            s_any.hashtags = h_json

    # 2. Cập nhật vào file caption.json trong thư mục localized của video
    loc_d = _get_video_localized_dir(video_id)
    loc_d.mkdir(parents=True, exist_ok=True)
    try:
        with open(loc_d / "caption.json", "w", encoding="utf-8") as cf:
            json.dump({
                "caption": caption_text,
                "hashtags": ht_list,
                "updated_at": datetime.utcnow().isoformat(),
            }, cf, ensure_ascii=False, indent=2)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Lỗi lưu caption.json cho video {video_id}: {e}")

    await db.commit()
    return {
        "status": "success",
        "message": "Đã cập nhật caption và hashtags thành công!",
        "caption": caption_text,
        "hashtags": ht_list,
    }


@router.post("/video/{video_id}/re-render")
async def re_render_subtitles_endpoint(
    video_id: int,
    req: ReRenderSubtitlesRequest,
    db: AsyncSession = Depends(get_db),  # noqa: B008
):
    """
    Render lại phụ đề khi người dùng chỉnh sửa text trong bảng đính chính phụ đề:
    1. Lưu segments mới vào subtitles.json & subtitles.srt
    2. Nếu có giọng đọc và text thay đổi -> Sinh lại TTS voiceover khớp với câu từ mới
    3. Ghép lại video hoàn chỉnh bằng compose_localized_video với cấu hình hiện tại
    4. Đồng bộ file thành phẩm sang final.mp4 và cập nhật database
    """
    stmt = select(Video).where(Video.id == video_id)
    result = await db.execute(stmt)
    raw_video = result.scalar_one_or_none()
    if not raw_video:
        raise HTTPException(status_code=404, detail="Không tìm thấy video")

    video: Any = raw_video
    loc_dir = _get_video_localized_dir(video_id)
    loc_dir.mkdir(parents=True, exist_ok=True)
    srt_path = loc_dir / "subtitles.srt"
    voiceover_path = loc_dir / "voiceover.mp3"
    output_localized_path = loc_dir / "output_localized.mp4"

    # 1. Lưu segments mới vào subtitles.json làm nguồn chuẩn cho lần tải tiếp theo
    subtitles_json_path = loc_dir / "subtitles.json"
    try:
        with open(subtitles_json_path, "w", encoding="utf-8") as sf:
            json.dump(req.segments, sf, ensure_ascii=False, indent=2)
    except Exception as se:  # noqa: BLE001
        logger.warning(f"Lỗi ghi subtitles.json: {se}")

    # 2. Cập nhật lại file srt từ segments mới vừa đính chính
    generate_srt_file(req.segments, str(srt_path))

    # 3. Lấy cấu hình sub từ latest job
    job_stmt = (
        select(ProcessingJob)
        .where(ProcessingJob.video_id == video_id, ProcessingJob.module == JobModule.localize)
        .order_by(ProcessingJob.id.desc())
    )
    job_res = await db.execute(job_stmt)
    raw_job = job_res.scalars().first()
    cfg: dict[str, Any] = {}
    job_any: Any = raw_job
    if job_any and isinstance(getattr(job_any, "config_json", None), dict):
        cfg = job_any.config_json

    # 4. Kiểm tra xem nội dung lời thoại có thay đổi không -> nếu có cấu hình giọng đọc, sinh lại audio TTS
    old_segments = cfg.get("translated_segments") or []
    old_text = " ".join((s.get("text_vi") or s.get("text", "")).strip() for s in old_segments if isinstance(s, dict))
    new_text = " ".join((s.get("text_vi") or s.get("text", "")).strip() for s in req.segments if isinstance(s, dict))
    voice_id = cfg.get("voice_id")

    if (old_text != new_text or not voiceover_path.exists()) and voice_id:
        try:
            from app.services.tts_service import synthesize_timeline_voiceover
            await synthesize_timeline_voiceover(
                segments=req.segments,
                output_path=str(voiceover_path),
                voice=str(voice_id),
                speed=float(cfg.get("voice_speed", 1.0)),
                total_duration=float(video.duration or 0.0),
            )
            # Tạo lại srt sau khi voiceover được cập nhật
            generate_srt_file(req.segments, str(srt_path))
        except Exception as tts_e:  # noqa: BLE001
            logger.warning(f"[Re-render] Lỗi sinh lại voiceover: {tts_e}")

    # 5. Chạy lại compose nhanh bằng FFmpeg áp dụng cấu hình sub & video gốc
    try:
        compose_localized_video(
            video_path=str(video.file_path),
            voiceover_path=str(voiceover_path) if voiceover_path.exists() else None,
            srt_path=str(srt_path),
            output_path=str(output_localized_path),
            cover_old_sub=bool(cfg.get("cover_old_sub", True)),
            bgm_volume=float(cfg.get("bgm_volume", 20)) / 100.0,
            voice_volume=float(cfg.get("voice_volume", 100)) / 100.0,
            sync_mode=str(cfg.get("sync_mode", "stretch_audio")),
            show_subtitles=bool(cfg.get("show_subtitles", True)),
            sub_position_mode=str(cfg.get("sub_position_mode", "by_original")),
            sub_placement=str(cfg.get("sub_placement", "overlay")),
            auto_fit_sub_size=bool(cfg.get("auto_fit_sub_size", True)),
            sub_position_percent=int(cfg.get("sub_position_percent", 71)),
            sub_font=str(cfg.get("sub_font", "Oswald")),
            sub_font_size=int(cfg.get("sub_font_size", 50)),
            sub_color=str(cfg.get("sub_color", "#FFFFFF")),
            sub_bg_color=str(cfg.get("sub_bg_color", "#000000")),
            sub_bg_opacity=int(cfg.get("sub_bg_opacity", 50)),
            sub_style_type=str(cfg.get("sub_style_type", "box")),
            sub_bold=bool(cfg.get("sub_bold", False)),
            sub_italic=bool(cfg.get("sub_italic", False)),
            sub_margin_v=int(cfg.get("sub_margin_v", 25)),
            blur_amount=int(cfg.get("blur_amount", 20)),
            blur_method=str(cfg.get("blur_method", "boxblur")),
            keep_original_audio=bool(cfg.get("keep_original_audio", True)),
        )

        # Cập nhật segments mới vào job config
        if job_any:
            cfg["translated_segments"] = req.segments
            job_any.config_json = cfg
            await db.commit()

        # Đồng bộ sang file final nếu video đã từng được lưu thành phẩm
        import shutil
        storage_base = settings.STORAGE_DIR / str(video_id)
        final_candidates = [
            storage_base / "output_final.mp4",
            storage_base / "final.mp4",
        ]
        if getattr(video, "output_path", None) and Path(str(video.output_path)).exists():
            final_candidates.append(Path(str(video.output_path)))
        for f_cand in final_candidates:
            if f_cand.exists() and f_cand.resolve() != output_localized_path.resolve():
                try:
                    shutil.copyfile(output_localized_path, f_cand)
                    logger.info(f"[Editor] Đã cập nhật phụ đề mới sang final file: {f_cand}")
                except Exception as copy_err:
                    logger.warning(f"Lỗi copy sang final {f_cand}: {copy_err}")

        rel_path = os.path.relpath(output_localized_path, settings.STORAGE_DIR).replace(chr(92), "/")
        return {
            "status": "success",
            "message": "Đã cập nhật phụ đề và render lại video thành công!",
            "video_url": f"/api/storage/{rel_path}?t={int(datetime.utcnow().timestamp())}",  # noqa: DTZ003
        }
    except Exception as e:  # noqa: BLE001
        logger.error(f"[Re-render] Lỗi render lại phụ đề: {e}")
        raise HTTPException(status_code=500, detail=f"Lỗi render lại video: {e}")


@router.post("/video/{video_id}/save-and-schedule")
async def save_and_schedule_endpoint(
    video_id: int,
    req: SaveAndScheduleRequest,
    db: AsyncSession = Depends(get_db),  # noqa: B008
):
    """
    LƯU VIDEO FINAL VÀ LÊN LỊCH ĐĂNG TIKTOK:
    1. Copy output_localized.mp4 -> final.mp4
    2. Cập nhật video.output_path = final.mp4, video.status = 'done'
    3. Tạo bản ghi PublishSchedule cho từng kênh TikTok được chọn với trạng thái 'scheduled'
    """
    stmt = select(Video).where(Video.id == video_id)
    result = await db.execute(stmt)
    raw_video = result.scalar_one_or_none()
    if not raw_video:
        raise HTTPException(status_code=404, detail="Không tìm thấy video")

    video: Any = raw_video
    loc_dir = _get_video_localized_dir(video_id)
    loc_mp4 = loc_dir / "output_localized.mp4"
    final_mp4 = _get_video_final_path(video_id)

    if not loc_mp4.exists() and not final_mp4.exists():
        raise HTTPException(status_code=400, detail="Không tìm thấy file video việt hóa thành phẩm")

    # 1. Lưu file final.mp4
    if loc_mp4.exists():
        shutil.copy2(str(loc_mp4), str(final_mp4))

    video.output_path = str(final_mp4)
    video.status = VideoStatus.done
    await db.commit()

    # 2. Xử lý caption và hashtags
    caption = req.caption.strip()
    hashtags_list = req.hashtags if isinstance(req.hashtags, list) else [h.strip() for h in str(req.hashtags).split() if h.strip()]
    hashtags_json = json.dumps(hashtags_list, ensure_ascii=False)

    # 3. Lên lịch đăng
    channel_ids = req.channel_ids
    if not channel_ids:
        cfg_channels = get_configured_tiktok_channels()
        if cfg_channels:
            channel_ids = [int(cfg_channels[0]["id"])]
        else:
            channel_ids = [1]

    base_time = parse_scheduled_datetime(req.scheduled_time)

    schedules_created = []
    for idx, ch_id in enumerate(channel_ids):
        slot_time = base_time + timedelta(minutes=idx * 5)

        del_stmt = (
            select(PublishSchedule)
            .where(PublishSchedule.video_id == video_id, PublishSchedule.channel_id == ch_id)
        )
        del_res = await db.execute(del_stmt)
        for old_sched in del_res.scalars().all():
            await db.delete(old_sched)

        new_sched = PublishSchedule(
            video_id=video_id,
            channel_id=ch_id,
            platform="tiktok",
            scheduled_time=slot_time,
            status=PublishStatus.scheduled,
            is_manual_override=bool(req.scheduled_time),
            caption=caption,
            hashtags=hashtags_json,
        )
        db.add(new_sched)
        schedules_created.append(new_sched)

    await db.commit()

    rel_final_path = os.path.relpath(final_mp4, settings.STORAGE_DIR).replace(chr(92), "/")
    return {
        "status": "success",
        "message": f"Đã lưu Video Final và lên lịch đăng thành công lên {len(channel_ids)} kênh!",
        "final_url": f"/api/storage/{rel_final_path}",
        "channel_count": len(channel_ids),
        "scheduled_time": base_time.isoformat(),
    }


@router.post("/video/{video_id}/save-final")
async def save_final_endpoint(
    video_id: int,
    db: AsyncSession = Depends(get_db),  # noqa: B008
):
    """
    LƯU VIDEO THÀNH PHẨM (CHUYỂN SANG HẬU KỲ):
    1. Nếu video đã có bản thành phẩm trước đó trong Hậu Kỳ -> Tạo bản sao video mới để không ghi đè!
    2. Nếu chưa từng lưu thành phẩm -> Đồng bộ output_localized.mp4 sang final.mp4
    """
    stmt = select(Video).where(Video.id == video_id)
    result = await db.execute(stmt)
    raw_video = result.scalar_one_or_none()
    if not raw_video:
        raise HTTPException(status_code=404, detail="Không tìm thấy video")

    video: Any = raw_video
    loc_dir = _get_video_localized_dir(video_id)
    loc_mp4 = loc_dir / "output_localized.mp4"
    final_mp4 = _get_video_final_path(video_id)

    if not loc_mp4.exists() and not final_mp4.exists():
        raise HTTPException(status_code=400, detail="Không tìm thấy file video việt hóa thành phẩm")

    already_has_final = final_mp4.exists() or bool(video.output_path and os.path.exists(str(video.output_path)))

    if already_has_final and loc_mp4.exists():
        # Tạo bản sao video mới trong Hậu Kỳ để không ghi đè lên video cũ
        new_video = Video(
            title=f"{video.title} (Bản mới)",
            channel_id=video.channel_id,
            category_id=video.category_id,
            file_path=video.file_path,
            duration=video.duration,
            resolution=video.resolution,
            file_size=video.file_size,
            status=VideoStatus.done,
            source_type=video.source_type,
            recognition_type=video.recognition_type,
        )
        db.add(new_video)
        await db.commit()
        await db.refresh(new_video)
        new_v_any: Any = new_video
        new_v_id = int(new_v_any.id)

        new_storage_dir = settings.STORAGE_DIR / str(new_v_id)
        new_storage_dir.mkdir(parents=True, exist_ok=True)

        old_thumb = settings.STORAGE_DIR / str(video_id) / "thumbnail.jpg"
        new_thumb = new_storage_dir / "thumbnail.jpg"
        if old_thumb.exists():
            shutil.copy2(str(old_thumb), str(new_thumb))
            new_v_any.thumbnail_path = str(new_thumb)

        new_final = new_storage_dir / "final.mp4"
        shutil.copy2(str(loc_mp4), str(new_final))
        new_v_any.output_path = str(new_final)
        await db.commit()

        rel_final_path = os.path.relpath(new_final, settings.STORAGE_DIR).replace(chr(92), "/")
        return {
            "status": "success",
            "message": "Đã lưu thành video mới trong Hậu Kỳ (giữ nguyên bản cũ)!",
            "video_id": new_v_id,
            "final_url": f"/api/storage/{rel_final_path}",
            "is_new_video": True,
        }
    else:
        if loc_mp4.exists():
            shutil.copy2(str(loc_mp4), str(final_mp4))
        video.output_path = str(final_mp4)
        video.status = VideoStatus.done
        await db.commit()

        rel_final_path = os.path.relpath(final_mp4, settings.STORAGE_DIR).replace(chr(92), "/")
        return {
            "status": "success",
            "message": "Đã lưu video thành phẩm vào Hậu Kỳ!",
            "video_id": video_id,
            "final_url": f"/api/storage/{rel_final_path}",
            "is_new_video": False,
        }

