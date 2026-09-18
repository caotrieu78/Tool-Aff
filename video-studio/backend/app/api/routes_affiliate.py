import os
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.core.db import get_db
from app.models.video import Video, VideoStatus
from app.models.job import ProcessingJob, JobModule, JobStep, JobStatus
from app.services.scene_service import detect_video_scenes, score_and_filter_highlights
from app.services.scraper_service import scrape_product_info
from app.services.job_runner import start_affiliate_job_background

router = APIRouter()


class ScrapeRequest(BaseModel):
    url: str


class DetectScenesRequest(BaseModel):
    video_id: int
    threshold: float = 27.0
    auto_highlight: bool = True
    top_n: Optional[int] = 8


class AffiliateJobSubmitRequest(BaseModel):
    video_id: int
    product_name: Optional[str] = ""
    price: Optional[str] = ""
    description: Optional[str] = ""
    shopee_url: Optional[str] = ""
    tiktok_shop_url: Optional[str] = ""
    note_script: Optional[str] = ""
    category: Optional[str] = "Đồ gia dụng & Tiện ích"
    ai_style: Optional[str] = "ban_hang"
    ai_model: Optional[str] = "gemini-3.8-flash"
    dubbing_mode: Optional[str] = "auto"
    anchor_text: Optional[str] = ""
    auto_highlight: bool = True
    shuffle_order: bool = False
    num_versions: int = 1
    target_duration: Optional[float] = None
    voice_id: Optional[str] = "vi-VN-HoaiMyNeural"
    voice_speed: float = 1.0
    bgm_volume: float = 0.15
    voice_volume: float = 1.0
    keep_original_audio: bool = True
    original_volume: float = 0.1
    ducking: bool = True
    cover_old_sub: bool = False
    blur_amount: int = 25
    show_subtitles: bool = True
    subtitle_config: Optional[Dict[str, Any]] = None
    selected_scenes: Optional[List[Dict[str, Any]]] = None


class AffiliateBulkSubmitRequest(BaseModel):
    video_ids: List[int]
    product_name: Optional[str] = ""
    price: Optional[str] = ""
    description: Optional[str] = ""
    shopee_url: Optional[str] = ""
    tiktok_shop_url: Optional[str] = ""
    note_script: Optional[str] = ""
    category: Optional[str] = "Đồ gia dụng & Tiện ích"
    ai_style: Optional[str] = "ban_hang"
    ai_model: Optional[str] = "gemini-3.8-flash"
    dubbing_mode: Optional[str] = "auto"
    anchor_text: Optional[str] = ""
    auto_highlight: bool = True
    shuffle_order: bool = False
    num_versions: int = 1
    target_duration: Optional[float] = None
    voice_id: Optional[str] = "vi-VN-HoaiMyNeural"
    voice_speed: float = 1.0
    bgm_volume: float = 0.15
    voice_volume: float = 1.0
    show_subtitles: bool = True
    subtitle_config: Optional[Dict[str, Any]] = None


@router.post("/scrape")
async def scrape_product(req: ScrapeRequest):
    """
    Cào thông tin sản phẩm (tên, giá, ảnh, mô tả) từ link Shopee hoặc TikTok Shop.
    """
    info = scrape_product_info(req.url)
    return info


@router.post("/detect-scenes")
async def detect_scenes_endpoint(
    req: DetectScenesRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Phân tích cảnh quay của video gốc và chấm điểm chất lượng (sharpness, motion, brightness).
    """
    stmt = select(Video).where(Video.id == req.video_id)
    res = await db.execute(stmt)
    video = res.scalar_one_or_none()
    if not video or not os.path.exists(str(video.file_path)):
        raise HTTPException(status_code=404, detail="Không tìm thấy file video gốc trên hệ thống")

    scenes = detect_video_scenes(str(video.file_path), threshold=req.threshold)
    if req.auto_highlight and len(scenes) > 2:
        scenes = score_and_filter_highlights(
            str(video.file_path),
            scenes,
            top_n=req.top_n if req.top_n and req.top_n > 0 else None,
        )

    return {
        "video_id": req.video_id,
        "total_scenes": len(scenes),
        "scenes": scenes,
    }


@router.post("/submit")
async def submit_affiliate_job(
    req: AffiliateJobSubmitRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Khởi tạo Job Affiliate Studio (Module 2):
    Dựng 1 hoặc nhiều phiên bản video bán hàng TikTok với kịch bản AI,
    ghép cảnh thông minh, TTS lồng tiếng và phụ đề chuẩn.
    """
    stmt = select(Video).where(Video.id == req.video_id)
    res = await db.execute(stmt)
    video: Any = res.scalar_one_or_none()
    if not video or not os.path.exists(str(video.file_path)):
        raise HTTPException(status_code=404, detail="Không tìm thấy video gốc để xử lý")

    # Mặc định subtitle config nếu chưa có
    sub_conf = req.subtitle_config or {
        "font": "Arial",
        "size": 24,
        "color": "#FFE600",
        "background": "#000000",
        "opacity": 0.75,
        "style_type": "full_box",
        "position_percent": 80,
        "bold": True,
        "italic": False,
    }

    config_payload = {
        "product_name": req.product_name,
        "price": req.price,
        "description": req.description,
        "shopee_url": req.shopee_url,
        "tiktok_shop_url": req.tiktok_shop_url,
        "note_script": req.note_script,
        "category": req.category,
        "ai_style": req.ai_style,
        "ai_model": req.ai_model or "gemini-3.8-flash",
        "dubbing_mode": req.dubbing_mode or "auto",
        "anchor_text": req.anchor_text or "",
        "auto_highlight": req.auto_highlight,
        "shuffle_order": req.shuffle_order,
        "num_versions": req.num_versions,
        "target_duration": req.target_duration,
        "voice_id": req.voice_id,
        "voice_speed": req.voice_speed,
        "bgm_volume": req.bgm_volume,
        "voice_volume": req.voice_volume,
        "keep_original_audio": req.keep_original_audio,
        "original_volume": req.original_volume,
        "ducking": req.ducking,
        "cover_old_sub": req.cover_old_sub,
        "blur_amount": req.blur_amount,
        "show_subtitles": req.show_subtitles,
        "subtitle_config": sub_conf,
        "selected_scenes": req.selected_scenes,
    }

    v: Any = video
    v_id = int(v.id)

    job = ProcessingJob(
        video_id=v_id,
        module=JobModule.affiliate,
        current_step=JobStep.queued,
        status=JobStatus.pending,
        progress_percent=0.0,
        config_json=config_payload,
    )
    db.add(job)
    v.status = VideoStatus.processing
    await db.commit()
    await db.refresh(job)

    j: Any = job
    job_id = int(j.id)

    # Chạy ngầm background task
    start_affiliate_job_background(job_id)

    return {
        "status": "queued",
        "job_id": job_id,
        "video_id": v_id,
        "message": "Đã xếp hàng xử lý pipeline AI Affiliate Studio!",
    }


@router.get("/job/{job_id}")
async def get_affiliate_job_status(
    job_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Lấy trạng thái chi tiết của job Affiliate."""
    stmt = select(ProcessingJob).where(ProcessingJob.id == job_id)
    res = await db.execute(stmt)
    job: Any = res.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job không tồn tại")

    return {
        "id": job.id,
        "video_id": job.video_id,
        "module": job.module,
        "status": job.status,
        "current_step": job.current_step,
        "progress_percent": job.progress_percent,
        "error_log": job.error_log,
        "config": job.config_json,
    }


@router.get("/video/{video_id}/result")
async def get_video_affiliate_result(
    video_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Lấy thông tin video thành phẩm Affiliate đã dựng gần nhất của video này."""
    # 1. Tìm job hoàn thành gần nhất
    stmt = (
        select(ProcessingJob)
        .where(
            ProcessingJob.video_id == video_id,
            ProcessingJob.module == JobModule.affiliate,
            ProcessingJob.status == JobStatus.done,
        )
        .order_by(ProcessingJob.id.desc())
    )
    res = await db.execute(stmt)
    job: Any = res.scalars().first()

    video_dir = settings.STORAGE_DIR / str(video_id)
    out_file = video_dir / "affiliate_output.mp4"
    if not out_file.exists():
        out_file = video_dir / "output_affiliate.mp4"

    if job and job.config_json:
        cfg = job.config_json
        versions = cfg.get("versions") or []
        output_url = cfg.get("output_url")
        if not output_url and out_file.exists():
            output_url = f"/api/storage/{video_id}/{out_file.name}?t={int(out_file.stat().st_mtime)}"

        if output_url or versions:
            return {
                "has_result": True,
                "job_id": job.id,
                "output_url": output_url or (versions[0].get("output_url") if versions else None),
                "title": cfg.get("title") or (versions[0].get("title") if versions else None),
                "caption": cfg.get("caption") or (versions[0].get("caption") if versions else None),
                "hashtags": cfg.get("hashtags") or (versions[0].get("hashtags") if versions else []),
                "versions": versions,
            }

    # 2. Nếu không tìm thấy job nhưng có file trên đĩa
    if out_file.exists() and out_file.stat().st_size > 1000:
        return {
            "has_result": True,
            "job_id": None,
            "output_url": f"/api/storage/{video_id}/{out_file.name}?t={int(out_file.stat().st_mtime)}",
            "title": f"Video Affiliate #{video_id}",
            "caption": "",
            "hashtags": ["#affiliate", "#tiktokshop"],
            "versions": [{
                "version": 1,
                "title": f"Video Affiliate #{video_id}",
                "output_url": f"/api/storage/{video_id}/{out_file.name}?t={int(out_file.stat().st_mtime)}",
            }],
        }

    return {"has_result": False}


@router.post("/submit-bulk")
async def submit_affiliate_bulk(
    req: AffiliateBulkSubmitRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Khởi tạo danh sách nhiều jobs Affiliate hàng loạt cho nhiều video khác nhau.
    Mỗi video sẽ có 1 ProcessingJob độc lập trong hàng đợi.
    """
    if not req.video_ids:
        raise HTTPException(status_code=400, detail="Danh sách video trống")

    sub_conf = req.subtitle_config or {
        "font": "Arial",
        "size": 24,
        "color": "#FFE600",
        "background": "#000000",
        "opacity": 0.75,
        "style_type": "full_box",
        "position_percent": 80,
        "bold": True,
        "italic": False,
    }

    created_jobs = []

    for vid in req.video_ids:
        stmt = select(Video).where(Video.id == vid)
        res = await db.execute(stmt)
        video: Any = res.scalar_one_or_none()
        if not video or not os.path.exists(str(video.file_path)):
            continue

        config_payload = {
            "product_name": req.product_name,
            "price": req.price,
            "description": req.description,
            "shopee_url": req.shopee_url,
            "tiktok_shop_url": req.tiktok_shop_url,
            "note_script": req.note_script,
            "category": req.category,
            "ai_style": req.ai_style,
            "ai_model": req.ai_model or "gemini-3.8-flash",
            "dubbing_mode": req.dubbing_mode or "auto",
            "anchor_text": req.anchor_text or "",
            "auto_highlight": req.auto_highlight,
            "shuffle_order": req.shuffle_order,
            "num_versions": req.num_versions,
            "target_duration": req.target_duration,
            "voice_id": req.voice_id,
            "voice_speed": req.voice_speed,
            "bgm_volume": req.bgm_volume,
            "voice_volume": req.voice_volume,
            "show_subtitles": req.show_subtitles,
            "subtitle_config": sub_conf,
        }

        v_id = int(video.id)
        job = ProcessingJob(
            video_id=v_id,
            module=JobModule.affiliate,
            current_step=JobStep.queued,
            status=JobStatus.pending,
            progress_percent=0.0,
            config_json=config_payload,
        )
        db.add(job)
        video.status = VideoStatus.processing
        await db.commit()
        await db.refresh(job)

        raw_job: Any = job
        j_id = int(getattr(raw_job, "id", 0))
        start_affiliate_job_background(j_id)
        created_jobs.append({
            "job_id": j_id,
            "video_id": v_id,
            "title": getattr(video, "title", f"Video #{v_id}"),
        })

    return {
        "status": "queued",
        "count": len(created_jobs),
        "jobs": created_jobs,
        "message": f"Đã xếp hàng thành công {len(created_jobs)} video vào tiến trình Affiliate Studio!",
    }
