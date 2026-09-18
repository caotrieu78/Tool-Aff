import json
import os
import shutil
from pathlib import Path
from typing import List, Optional, Any, cast
from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, asc, delete, update
from pydantic import BaseModel

from app.core.db import get_db
from app.core.config import settings
from app.models.video import Video, VideoStatus, VideoSourceType
from app.models.job import ProcessingJob
from app.models.channel import Channel
from app.models.category import Category
from app.models.publish_schedule import PublishSchedule
from app.services.ingest_service import get_video_metadata, generate_thumbnail

router = APIRouter()


# --- Pydantic Schemas ---
class ChannelCreate(BaseModel):
    name: str
    platform_source: Optional[str] = "douyin"


class CategoryCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None


# --- Video Endpoints ---
@router.post("/import")
async def import_videos(
    files: List[UploadFile] = File(...),
    channel_id: Optional[int] = Form(None),
    category_id: Optional[int] = Form(None),
    recognition_type: Optional[str] = Form("voice_only"),
    db: AsyncSession = Depends(get_db),
):
    """
    Import hàng loạt file MP4:
    - Lưu file vào storage/library/{video_id}/original.mp4
    - Đọc metadata qua FFprobe
    - Từ chối video > 15 phút
    - Tạo thumbnail qua FFmpeg
    - Lưu vào DB bảng videos
    """
    imported = []
    rejected = []

    # Tự động gán kênh & danh mục mặc định nếu chưa chọn
    if channel_id is None:
        first_ch = await db.execute(select(Channel.id).limit(1))
        channel_id = first_ch.scalar_one_or_none()
    if category_id is None:
        first_cat = await db.execute(select(Category.id).limit(1))
        category_id = first_cat.scalar_one_or_none()

    for file in files:
        filename = file.filename or "video.mp4"
        clean_title = Path(filename).stem

        # Tạo DB record trước để lấy ID duy nhất
        new_video: Any = Video(
            title=clean_title,
            channel_id=channel_id,
            category_id=category_id,
            file_path="",
            status=VideoStatus.raw,
            source_type=VideoSourceType.raw,
            recognition_type=recognition_type or "voice_only",
        )
        db.add(new_video)
        await db.flush()  # Sinh new_video.id
        video_id = new_video.id

        # Tạo thư mục riêng cho video này
        video_dir = settings.STORAGE_DIR / str(video_id)
        video_dir.mkdir(parents=True, exist_ok=True)
        dest_video_path = video_dir / "original.mp4"
        dest_thumb_path = video_dir / "thumbnail.jpg"

        # Ghi file vào ổ đĩa
        with open(dest_video_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Trích xuất metadata qua FFprobe
        meta = get_video_metadata(str(dest_video_path))
        duration = meta.get("duration", 0.0)

        # Quy tắc: Giới hạn tối đa 15 phút (900s) — từ chối nếu dài hơn
        if duration > settings.MAX_VIDEO_DURATION_SECONDS:
            # Xóa file và xoá record
            shutil.rmtree(video_dir, ignore_errors=True)
            await db.delete(new_video)
            rejected.append({
                "filename": filename,
                "reason": f"Video dài {duration:.1f}s vượt quá giới hạn tối đa 15 phút (900s)."
            })
            continue

        # Tạo thumbnail tại giây thứ 1 (hoặc nửa thời lượng nếu video ngắn)
        thumb_offset = min(1.0, duration / 2.0) if duration > 0 else 0.0
        generate_thumbnail(str(dest_video_path), str(dest_thumb_path), time_offset=thumb_offset)

        # Cập nhật thông tin vào DB
        new_video.file_path = str(dest_video_path)
        new_video.thumbnail_path = f"/api/storage/{video_id}/thumbnail.jpg" if dest_thumb_path.exists() else None
        new_video.duration = duration
        new_video.resolution = str(meta.get("resolution") or "")
        new_video.file_size = int(meta.get("file_size") or 0)

        imported.append({
            "id": new_video.id,
            "title": new_video.title,
            "duration": new_video.duration,
            "resolution": new_video.resolution,
            "file_size": new_video.file_size,
            "thumbnail_url": new_video.thumbnail_path,
        })

    await db.commit()

    return {
        "success": True,
        "imported_count": len(imported),
        "rejected_count": len(rejected),
        "imported": imported,
        "rejected": rejected,
    }


@router.get("/videos")
async def list_videos(
    channel_id: Optional[int] = Query(None),
    category_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    recognition_type: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort_by: Optional[str] = Query("newest"),
    page: int = Query(1, ge=1),
    limit: int = Query(24, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Lấy danh sách video với tìm kiếm, phân trang và bộ lọc."""
    query = select(Video)

    if channel_id is not None:
        query = query.where(Video.channel_id == channel_id)
    if category_id is not None:
        query = query.where(Video.category_id == category_id)
    if status is not None:
        query = query.where(Video.status == status)
    if recognition_type is not None:
        query = query.where(Video.recognition_type == recognition_type)
    if search:
        query = query.where(Video.title.ilike(f"%{search}%"))

    # Đếm tổng
    count_query = select(func.count()).select_from(query.subquery())
    total_res = await db.execute(count_query)
    total = total_res.scalar() or 0

    # Phân trang & sắp xếp
    if sort_by == "oldest":
        query = query.order_by(asc(Video.created_at))
    elif sort_by == "duration_desc":
        query = query.order_by(desc(Video.duration))
    elif sort_by == "duration_asc":
        query = query.order_by(asc(Video.duration))
    elif sort_by == "size_desc":
        query = query.order_by(desc(Video.file_size))
    elif sort_by == "title_asc":
        query = query.order_by(asc(Video.title))
    else:
        query = query.order_by(desc(Video.created_at))

    query = query.offset((page - 1) * limit).limit(limit)
    res = await db.execute(query)
    videos = res.scalars().all()

    return {
        "total": total,
        "page": page,
        "limit": limit,
        "videos": [
            {
                "id": v_any.id,
                "title": v_any.title,
                "channel_id": v_any.channel_id,
                "category_id": v_any.category_id,
                "duration": v_any.duration,
                "resolution": v_any.resolution,
                "file_size": v_any.file_size,
                "status": getattr(v_any.status, "value", v_any.status) if getattr(v_any, "status", None) else "raw",
                "source_type": getattr(v_any.source_type, "value", v_any.source_type) if getattr(v_any, "source_type", None) else "raw",
                "recognition_type": getattr(v_any, "recognition_type", None) or "voice_only",
                "thumbnail_url": v_any.thumbnail_path,
                "video_url": f"/api/storage/{v_any.id}/original.mp4",
                "created_at": v_any.created_at.isoformat() if getattr(v_any, "created_at", None) else None,
                "caption": _read_caption_for_video(int(getattr(v_any, "id", 0))),
                "has_localized": _check_has_localized(int(getattr(v_any, "id", 0))),
            }
            for v_any in [cast(Any, v) for v in videos]
        ],
    }


def _check_has_localized(video_id: int) -> bool:
    """Kiểm tra video đã hoàn thành lồng tiếng việt hóa (output_localized.mp4) chưa."""
    try:
        loc_file = settings.STORAGE_DIR / str(video_id) / "localized" / "output_localized.mp4"
        return loc_file.exists() and loc_file.stat().st_size > 1000
    except Exception:
        return False


def _read_caption_for_video(video_id: int) -> str:
    """Doc caption tu caption.json trong thu muc localized cua video."""
    try:
        cap_file = settings.STORAGE_DIR / str(video_id) / "localized" / "caption.json"
        if cap_file.exists():
            with open(cap_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                return str(data.get("caption", "")).strip()
    except Exception:  # noqa: BLE001
        pass
    return ""


class UpdateRecognitionTypeRequest(BaseModel):
    recognition_type: str


@router.put("/videos/{video_id}/recognition-type")
async def update_video_recognition_type(
    video_id: int,
    req: UpdateRecognitionTypeRequest,
    db: AsyncSession = Depends(get_db),
):
    """Cập nhật nhanh phân loại nhận diện của video: voice_only, ocr_only, ai_vision."""
    res = await db.execute(select(Video).where(Video.id == video_id))
    video = res.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=404, detail="Video không tồn tại")

    val = req.recognition_type.strip().lower()
    if val not in ("voice_only", "ocr_only", "ai_vision"):
        raise HTTPException(status_code=400, detail="Loại phân loại không hợp lệ (voice_only, ocr_only, ai_vision)")

    video.recognition_type = val  # type: ignore[assignment]
    await db.commit()
    return {"success": True, "video_id": video_id, "recognition_type": val}


@router.delete("/videos/{video_id}")
async def delete_video(video_id: int, db: AsyncSession = Depends(get_db)):
    """Xóa video khỏi DB và xoá folder lưu trữ trên ổ đĩa."""
    res = await db.execute(select(Video).where(Video.id == video_id))
    video = res.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=404, detail="Video không tồn tại")

    # Xóa file trên disk
    video_dir = settings.STORAGE_DIR / str(video_id)
    if video_dir.exists():
        shutil.rmtree(video_dir, ignore_errors=True)

    # Xóa các processing job và publish schedule liên quan
    await db.execute(delete(ProcessingJob).where(ProcessingJob.video_id == video_id))
    await db.execute(delete(PublishSchedule).where(PublishSchedule.video_id == video_id))
    await db.delete(video)
    await db.commit()
    return {"success": True, "message": f"Đã xóa video #{video_id}"}


class BulkDeleteVideosRequest(BaseModel):
    video_ids: List[int]


@router.post("/videos/bulk-delete")
async def bulk_delete_videos(
    req: BulkDeleteVideosRequest,
    db: AsyncSession = Depends(get_db),
):
    """Xóa hàng loạt video theo danh sách ID."""
    if not req.video_ids:
        return {"success": True, "deleted_count": 0, "message": "Không có video nào được chọn"}

    # Xóa file trên disk cho từng video
    for vid in req.video_ids:
        video_dir = settings.STORAGE_DIR / str(vid)
        if video_dir.exists():
            shutil.rmtree(video_dir, ignore_errors=True)

    # Xóa processing jobs và publish schedule liên quan
    await db.execute(delete(ProcessingJob).where(ProcessingJob.video_id.in_(req.video_ids)))
    await db.execute(delete(PublishSchedule).where(PublishSchedule.video_id.in_(req.video_ids)))

    # Xóa records trong bảng videos
    result = await db.execute(delete(Video).where(Video.id.in_(req.video_ids)))
    await db.commit()

    deleted_count = result.rowcount if hasattr(result, "rowcount") else len(req.video_ids)
    return {
        "success": True,
        "deleted_count": deleted_count,
        "deleted_ids": req.video_ids,
        "message": f"Đã xóa thành công {deleted_count} video",
    }


# --- Channel Endpoints ---
@router.get("/channels")
async def list_channels(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Channel).order_by(Channel.name))
    channels = res.scalars().all()
    return {
        "channels": [
            {"id": c.id, "name": c.name, "platform_source": c.platform_source}
            for c in channels
        ]
    }


@router.post("/channels")
async def create_channel(payload: ChannelCreate, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Channel).where(Channel.name == payload.name))
    if res.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Kênh đã tồn tại")

    ch = Channel(name=payload.name, platform_source=payload.platform_source)
    db.add(ch)
    await db.commit()
    await db.refresh(ch)
    return {"id": ch.id, "name": ch.name, "platform_source": ch.platform_source}


@router.delete("/channels/{channel_id}")
async def delete_channel(channel_id: int, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Channel).where(Channel.id == channel_id))
    ch = res.scalar_one_or_none()
    if not ch:
        raise HTTPException(status_code=404, detail="Kênh không tồn tại")

    # Gỡ liên kết ở bảng videos
    await db.execute(
        update(Video).where(Video.channel_id == channel_id).values(channel_id=None)
    )
    await db.delete(ch)
    await db.commit()
    return {"success": True, "message": f"Đã xóa kênh #{channel_id}"}


# --- Category Endpoints ---
@router.get("/categories")
async def list_categories(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Category).order_by(Category.name))
    categories = res.scalars().all()
    return {
        "categories": [
            {"id": c.id, "name": c.name, "parent_id": c.parent_id}
            for c in categories
        ]
    }


@router.post("/categories")
async def create_category(payload: CategoryCreate, db: AsyncSession = Depends(get_db)):
    cat = Category(name=payload.name, parent_id=payload.parent_id)
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return {"id": cat.id, "name": cat.name, "parent_id": cat.parent_id}


@router.delete("/categories/{category_id}")
async def delete_category(category_id: int, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Category).where(Category.id == category_id))
    cat = res.scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="Danh mục không tồn tại")

    # Gỡ liên kết ở bảng videos
    await db.execute(
        update(Video).where(Video.category_id == category_id).values(category_id=None)
    )
    # Gỡ liên kết danh mục con
    await db.execute(
        update(Category).where(Category.parent_id == category_id).values(parent_id=None)
    )
    await db.delete(cat)
    await db.commit()
    return {"success": True, "message": f"Đã xóa danh mục #{category_id}"}
