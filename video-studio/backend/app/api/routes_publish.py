import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_db
from app.models.channel import Channel
from app.models.category import Category
from app.models.publish_schedule import PublishSchedule, PublishStatus
from app.models.video import Video, VideoStatus
from app.services.tiktok_channel_service import get_configured_tiktok_channels
from app.services.tiktok_browser_service import (
    open_login_window,
    check_channel_login_status,
    get_channel_session_info,
    logout_channel,
)
from app.workers.publish_worker import execute_publish_schedule_item

logger = logging.getLogger(__name__)

router = APIRouter()


# ─────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────

class QuickScheduleRequest(BaseModel):
    video_id: int
    channel_ids: list[int] = []
    scheduled_time: Optional[str] = None  # ISO format string or None for next FIFO slot
    caption: Optional[str] = None
    hashtags: Optional[list[str]] = None


class BatchScheduleRequest(BaseModel):
    video_ids: list[int]
    channel_ids: list[int] = []
    start_time: Optional[str] = None
    interval_hours: int = 2
    use_golden_slots: Optional[bool] = False


class UpdateScheduleItemRequest(BaseModel):
    scheduled_time: Optional[str] = None
    caption: Optional[str] = None
    hashtags: Optional[list[str]] = None
    status: Optional[str] = None


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def parse_scheduled_datetime(dt_str: Optional[str]) -> datetime:
    """
    Chuyển đổi chuỗi ngày giờ từ client (ISO UTC hoặc local datetime-local string)
    về timezone-naive UTC datetime chuẩn để lưu DB và so sánh với datetime.utcnow().
    """
    if not dt_str or not dt_str.strip():
        return datetime.utcnow() + timedelta(hours=1)

    clean_str = dt_str.strip()
    try:
        if "Z" in clean_str or "+" in clean_str or ("-" in clean_str and clean_str.count("-") > 2):
            dt = datetime.fromisoformat(clean_str.replace("Z", "+00:00"))
            return dt.astimezone(timezone.utc).replace(tzinfo=None)

        dt_naive = datetime.fromisoformat(clean_str)
        dt_local = dt_naive.astimezone()
        return dt_local.astimezone(timezone.utc).replace(tzinfo=None)
    except Exception as e:
        logger.warning(f"Không thể parse scheduled_time '{dt_str}': {e}")
        return datetime.utcnow() + timedelta(hours=1)


def _get_video_localized_dir(video_id: int) -> Path:
    return Path(settings.STORAGE_DIR) / str(video_id) / "localized"


def _get_video_final_path(video_id: int) -> Path:
    return Path(settings.STORAGE_DIR) / str(video_id) / "final.mp4"


# ─────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────

@router.get("/overview")
async def get_publish_overview(db: AsyncSession = Depends(get_db)):  # noqa: B008
    """
    Lấy toàn bộ thông tin cho trang Lịch Đăng TikTok:
    - ready_videos: Video ĐÃ DỊCH/LỒNG TIẾNG VÀ ĐÃ CÓ CAPTION (Sẵn sàng lên lịch)
    - scheduled_items: Danh sách video đã được lên lịch đăng theo timeline
    - channels: Danh sách kênh TikTok TỪ CẤU HÌNH CÀI ĐẶT
    - stats: Thống kê tổng hợp
    """
    # 1. Lấy danh sách kênh TikTok ĐƯỢC CẤU HÌNH và bổ sung thông tin đăng nhập TikTok
    raw_channels_list = get_configured_tiktok_channels()
    channels_list = []
    for ch in raw_channels_list:
        ch_id = int(ch["id"])
        sess = get_channel_session_info(ch_id)
        channels_list.append({
            **ch,
            "is_logged_in": sess.get("is_logged_in", False),
            "username": sess.get("username") or ch.get("username", ""),
            "avatar_url": sess.get("avatar_url", ""),
            "linked_channel_ids": ch.get("linked_channel_ids", []),
            "linked_category_ids": ch.get("linked_category_ids", []),
        })
    channel_map = {int(c["id"]): str(c.get("name", f"Kênh #{c['id']}")) for c in channels_list}
    channel_user_map = {int(c["id"]): str(c.get("username", "")).lstrip("@") for c in channels_list}

    # Lấy danh sách danh mục & kênh thư viện
    cat_stmt = select(Category)
    cat_res = await db.execute(cat_stmt)
    all_cats = cat_res.scalars().all()
    category_map = {int(getattr(c, "id")): str(getattr(c, "name", "")) for c in all_cats}

    lib_ch_stmt = select(Channel)
    lib_ch_res = await db.execute(lib_ch_stmt)
    all_lib_channels = lib_ch_res.scalars().all()
    lib_channel_map = {int(getattr(ch, "id")): str(getattr(ch, "name", "")) for ch in all_lib_channels}

    # 2. Lấy danh sách video từ database
    v_stmt = select(Video).order_by(Video.updated_at.desc())
    v_res = await db.execute(v_stmt)
    videos = v_res.scalars().all()

    # 3. Lấy tất cả publish_schedules
    sched_stmt = select(PublishSchedule).order_by(PublishSchedule.scheduled_time.asc())
    sched_res = await db.execute(sched_stmt)
    all_schedules = sched_res.scalars().all()

    # Nhóm schedules theo video_id
    video_schedules_map: dict[int, list[dict[str, Any]]] = {}
    scheduled_items: list[dict[str, Any]] = []

    # Map video_id -> video object để tra cứu thông tin nhanh
    video_map: dict[int, Any] = {int(getattr(v, "id", 0)): v for v in videos}

    for raw_s in all_schedules:
        s: Any = raw_s
        v_id = int(getattr(s, "video_id", 0))
        c_id = int(getattr(s, "channel_id", 0))
        ch_name = channel_map.get(c_id, f"Kênh #{c_id}")

        # Parse hashtags
        ht_list: list[str] = []
        if s.hashtags:
            try:
                ht_list = json.loads(str(s.hashtags))
            except Exception:
                ht_list = [t.strip() for t in str(s.hashtags).split() if t.strip()]

        scheduled_iso = None
        if s.scheduled_time:
            scheduled_iso = s.scheduled_time.replace(tzinfo=timezone.utc).isoformat()

        created_iso = None
        if s.created_at:
            created_iso = s.created_at.replace(tzinfo=timezone.utc).isoformat()

        ch_user = channel_user_map.get(c_id, "")
        post_id = getattr(s, "tiktok_post_id", None)
        post_url = None
        if post_id and str(post_id).startswith("http"):
            post_url = str(post_id)
        elif post_id and str(post_id).isdigit() and ch_user:
            post_url = f"https://www.tiktok.com/@{ch_user}/video/{post_id}"
        elif ch_user:
            post_url = f"https://www.tiktok.com/@{ch_user}"
        else:
            post_url = "https://www.tiktok.com/tiktokstudio/content"

        s_dict = {
            "id": int(s.id),
            "video_id": v_id,
            "channel_id": c_id,
            "channel_name": ch_name,
            "channel_username": ch_user,
            "tiktok_post_id": str(post_id) if post_id else None,
            "post_url": post_url,
            "platform": str(s.platform or "tiktok"),
            "scheduled_time": scheduled_iso,
            "status": str(getattr(s.status, "value", s.status)),
            "caption": str(s.caption or ""),
            "hashtags": ht_list,
            "is_manual_override": bool(s.is_manual_override),
            "rejection_reason": getattr(s, "rejection_reason", None),
            "created_at": created_iso,
        }

        if v_id not in video_schedules_map:
            video_schedules_map[v_id] = []
        video_schedules_map[v_id].append(s_dict)

        # Thêm vào danh sách timeline hiển thị: lấy tất cả các trạng thái có liên quan
        s_status_str = str(getattr(s.status, "value", s.status)).lower()
        if s_status_str not in ["scheduled", "posting", "posted", "failed", "rejected"] or not s.scheduled_time:
            continue

        matched_v = video_map.get(v_id)
        v_title = str(matched_v.title) if (matched_v and matched_v.title) else f"Video #{v_id}"
        thumb_url = None
        video_url = ""
        if matched_v:
            thumb_p = getattr(matched_v, "thumbnail_path", None)
            if thumb_p and str(thumb_p).startswith("/api/"):
                thumb_url = str(thumb_p)
            elif thumb_p and os.path.exists(str(thumb_p)):
                rel_t = os.path.relpath(str(thumb_p), settings.STORAGE_DIR).replace(chr(92), "/")
                thumb_url = f"/api/storage/{rel_t}"
            else:
                disk_t = settings.STORAGE_DIR / str(v_id) / "thumbnail.jpg"
                if disk_t.exists():
                    thumb_url = f"/api/storage/{v_id}/thumbnail.jpg"

            final_mp4 = _get_video_final_path(v_id)
            loc_mp4 = _get_video_localized_dir(v_id) / "output_localized.mp4"
            lib_mp4 = Path(settings.STORAGE_DIR) / "library" / str(v_id) / "final.mp4"
            if final_mp4.exists():
                video_url = f"/api/storage/{os.path.relpath(final_mp4, settings.STORAGE_DIR).replace(chr(92), '/')}"
            elif lib_mp4.exists():
                video_url = f"/api/storage/{os.path.relpath(lib_mp4, settings.STORAGE_DIR).replace(chr(92), '/')}"
            elif loc_mp4.exists():
                video_url = f"/api/storage/{os.path.relpath(loc_mp4, settings.STORAGE_DIR).replace(chr(92), '/')}"
            elif getattr(matched_v, "output_path", None) and os.path.exists(str(matched_v.output_path)):
                video_url = f"/api/storage/{os.path.relpath(matched_v.output_path, settings.STORAGE_DIR).replace(chr(92), '/')}"

        scheduled_items.append({
            **s_dict,
            "video_title": v_title,
            "thumbnail_url": thumb_url,
            "video_url": video_url,
        })

    # 4. Lọc các video thành phẩm ĐÃ DỊCH/LỒNG TIẾNG VÀ ĐÃ CÓ CAPTION
    ready_videos: list[dict[str, Any]] = []

    for raw_v in videos:
        v: Any = raw_v
        v_id = int(getattr(v, "id", 0))
        final_mp4 = _get_video_final_path(v_id)
        loc_dir = _get_video_localized_dir(v_id)
        loc_mp4 = loc_dir / "output_localized.mp4"
        lib_mp4 = Path(settings.STORAGE_DIR) / "library" / str(v_id) / "final.mp4"

        # Video sẵn sàng lên lịch (phải là video thành phẩm đã lưu vào Hậu Kỳ)
        has_final = final_mp4.exists()
        has_op = bool(getattr(v, "output_path", None) and os.path.exists(str(v.output_path)))

        if not (has_final or has_op):
            continue

        video_file = final_mp4 if has_final else Path(str(getattr(v, "output_path", "")))
        rel_video_path = os.path.relpath(video_file, settings.STORAGE_DIR).replace(chr(92), "/")

        # Lấy caption và hashtags
        v_caption = ""
        v_hashtags: list[str] = []

        # Ưu tiên lấy từ publish_schedules
        if v_id in video_schedules_map and video_schedules_map[v_id]:
            first_s = video_schedules_map[v_id][0]
            v_caption = first_s["caption"]
            v_hashtags = first_s["hashtags"]

        # Nếu chưa có trong schedule, đọc từ caption.json
        if not v_caption:
            cap_file = loc_dir / "caption.json"
            if cap_file.exists():
                try:
                    with open(cap_file, "r", encoding="utf-8") as cf:
                        cdata = json.load(cf)
                        v_caption = str(cdata.get("caption", "")).strip()
                        if not v_hashtags:
                            v_hashtags = cdata.get("hashtags", [])
                except Exception:
                    pass

        # YÊU CẦU: "ở trạng thái sẵn sàng để lên lịch là ĐÃ CÓ CAPTION VÀ ĐÃ DỊCH"
        if not v_caption.strip():
            # Chưa có caption -> chưa đạt điều kiện "sẵn sàng lên lịch"
            continue

        # Lấy thumbnail
        thumb_url = None
        thumb_p = getattr(v, "thumbnail_path", None)
        if thumb_p and str(thumb_p).startswith("/api/"):
            thumb_url = str(thumb_p)
        elif thumb_p and os.path.exists(str(thumb_p)):
            rel_t = os.path.relpath(str(thumb_p), settings.STORAGE_DIR).replace(chr(92), "/")
            thumb_url = f"/api/storage/{rel_t}"
        else:
            disk_t = settings.STORAGE_DIR / str(v_id) / "thumbnail.jpg"
            if disk_t.exists():
                thumb_url = f"/api/storage/{v_id}/thumbnail.jpg"

        v_schedules = video_schedules_map.get(v_id, [])
        has_schedule = len(v_schedules) > 0

        cat_id = getattr(v, "category_id", None)
        cat_name = category_map.get(int(cat_id), "") if cat_id else ""
        ready_videos.append({
            "id": v_id,
            "title": str(getattr(v, "title", f"Video #{v_id}")),
            "duration": float(getattr(v, "duration", 0.0) or 0.0),
            "thumbnail_url": thumb_url,
            "video_url": f"/api/storage/{rel_video_path}",
            "has_final": has_final,
            "has_schedule": has_schedule,
            "caption": v_caption,
            "hashtags": v_hashtags,
            "schedules": v_schedules,
            "channel_id": getattr(v, "channel_id", None),
            "channel_name": lib_channel_map.get(int(getattr(v, "channel_id", 0)), "") if getattr(v, "channel_id", None) else "",
            "category_id": cat_id,
            "category_name": cat_name,
            "updated_at": v.updated_at.isoformat() if getattr(v, "updated_at", None) else None,
        })

    # Đếm số lượng
    total_ready = len(ready_videos)
    total_scheduled = len(scheduled_items)

    return {
        "ready_videos": ready_videos,
        "scheduled_items": scheduled_items,
        "channels": channels_list,
        "categories": [{"id": int(getattr(c, "id")), "name": str(getattr(c, "name", ""))} for c in all_cats],
        "stats": {
            "total_ready": total_ready,
            "total_scheduled": total_scheduled,
            "total_channels": len(channels_list),
        },
    }


@router.get("/schedule")
async def get_schedule(db: AsyncSession = Depends(get_db)):  # noqa: B008
    """
    Endpoint tương thích cũ, trả về danh sách lịch đăng.
    """
    overview = await get_publish_overview(db)
    return {"schedules": overview["scheduled_items"], "ready_videos": overview["ready_videos"]}


@router.post("/schedule")
async def create_schedule(req: QuickScheduleRequest, db: AsyncSession = Depends(get_db)):  # noqa: B008
    """
    Lên lịch đăng 1 video lên danh sách kênh TikTok được chọn.
    """
    video_id = req.video_id
    v_stmt = select(Video).where(Video.id == video_id)
    v_res = await db.execute(v_stmt)
    video = v_res.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=404, detail="Không tìm thấy video")

    channel_ids = req.channel_ids
    if not channel_ids:
        cfg_channels = get_configured_tiktok_channels()
        if cfg_channels:
            channel_ids = [int(cfg_channels[0]["id"])]
        else:
            raise HTTPException(status_code=400, detail="Chưa có kênh TikTok nào được cấu hình trong Cài Đặt!")

    caption = req.caption or ""
    hashtags = req.hashtags or []
    hashtags_json = json.dumps(hashtags, ensure_ascii=False)

    base_time = parse_scheduled_datetime(req.scheduled_time)

    schedules_created = []
    for idx, ch_id in enumerate(channel_ids):
        slot_time = base_time + timedelta(minutes=idx * 5)

        # Xóa bản ghi lịch cũ cho kênh này nếu đang chờ/lỗi (không xóa lịch sử đã đăng)
        del_stmt = delete(PublishSchedule).where(
            PublishSchedule.video_id == video_id,
            PublishSchedule.channel_id == ch_id,
            PublishSchedule.status.in_([PublishStatus.scheduled, PublishStatus.failed, PublishStatus.rejected, PublishStatus.pending]),
        )
        await db.execute(del_stmt)

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

    return {
        "status": "success",
        "message": f"Đã lên lịch đăng video #{video_id} thành công lên {len(channel_ids)} kênh!",
        "count": len(schedules_created),
        "base_scheduled_time": base_time.isoformat(),
    }


@router.post("/batch-schedule")
async def batch_schedule(req: BatchScheduleRequest, db: AsyncSession = Depends(get_db)):  # noqa: B008
    """
    Lên lịch hàng loạt (FIFO): Tự động xếp slot thời gian cho nhiều video được chọn.
    """
    video_ids = req.video_ids
    if not video_ids:
        raise HTTPException(status_code=400, detail="Vui lòng chọn ít nhất 1 video để lên lịch")

    channel_ids = req.channel_ids
    if not channel_ids:
        cfg_channels = get_configured_tiktok_channels()
        if cfg_channels:
            channel_ids = [int(cfg_channels[0]["id"])]
        else:
            raise HTTPException(status_code=400, detail="Chưa có kênh TikTok nào trong Cấu Hình Cài Đặt!")

    start_time = parse_scheduled_datetime(req.start_time)

    # 4 khung giờ vàng chuẩn mẫu: 11:00 (Trưa), 14:00 (Chiều), 19:00 (Tối ⭐), 21:30 (Đêm ⭐)
    GOLDEN_SLOTS = [(11, 0), (14, 0), (19, 0), (21, 30)]

    use_golden = bool(req.use_golden_slots)
    interval = timedelta(hours=max(1, req.interval_hours))
    current_slot = start_time
    total_created = 0

    curr_date = datetime.utcnow().date()
    target_slot_idx = 0
    if use_golden:
        # Chuyển đổi start_time (UTC naive) sang local time để xác định ngày và khung giờ bắt đầu
        start_local = start_time.replace(tzinfo=timezone.utc).astimezone()
        curr_date = start_local.date()
        target_slot_idx = -1
        for idx, (sh, sm) in enumerate(GOLDEN_SLOTS):
            slot_time = datetime(curr_date.year, curr_date.month, curr_date.day, sh, sm).time()
            if start_local.time() <= slot_time:
                target_slot_idx = idx
                break

        if target_slot_idx == -1:
            curr_date += timedelta(days=1)
            target_slot_idx = 0

    for vid in video_ids:
        if use_golden:
            sh, sm = GOLDEN_SLOTS[target_slot_idx]
            local_slot_dt = datetime(curr_date.year, curr_date.month, curr_date.day, sh, sm).astimezone()
            assigned_slot = local_slot_dt.astimezone(timezone.utc).replace(tzinfo=None)
            # Chuyển tiếp sang khung giờ vàng kế tiếp
            target_slot_idx = (target_slot_idx + 1) % len(GOLDEN_SLOTS)
            if target_slot_idx == 0:
                curr_date += timedelta(days=1)
        else:
            assigned_slot = current_slot
            current_slot += interval

        # Đọc caption cho video
        cap_text = ""
        ht_list: list[str] = []
        loc_dir = _get_video_localized_dir(vid)
        cap_file = loc_dir / "caption.json"
        if cap_file.exists():
            try:
                with open(cap_file, "r", encoding="utf-8") as cf:
                    cdata = json.load(cf)
                    cap_text = str(cdata.get("caption", ""))
                    ht_list = cdata.get("hashtags", [])
            except Exception:
                pass

        for ch_id in channel_ids:
            # Xóa lịch cũ nếu đang chờ/lỗi (không xóa lịch sử đã đăng)
            del_stmt = delete(PublishSchedule).where(
                PublishSchedule.video_id == vid,
                PublishSchedule.channel_id == ch_id,
                PublishSchedule.status.in_([PublishStatus.scheduled, PublishStatus.failed, PublishStatus.rejected, PublishStatus.pending]),
            )
            await db.execute(del_stmt)

            new_sched = PublishSchedule(
                video_id=vid,
                channel_id=ch_id,
                platform="tiktok",
                scheduled_time=assigned_slot,
                status=PublishStatus.scheduled,
                is_manual_override=True,
                caption=cap_text,
                hashtags=json.dumps(ht_list, ensure_ascii=False),
            )
            db.add(new_sched)
            total_created += 1

    await db.commit()

    return {
        "status": "success",
        "message": f"Đã lên lịch thành công cho {len(video_ids)} video ({total_created} lượt đăng)!",
        "video_count": len(video_ids),
        "total_slots": total_created,
    }


@router.delete("/schedule/{schedule_id}")
async def delete_schedule(schedule_id: int, db: AsyncSession = Depends(get_db)):  # noqa: B008
    """
    Hủy một lịch đăng khỏi hàng đợi.
    """
    stmt = select(PublishSchedule).where(PublishSchedule.id == schedule_id)
    res = await db.execute(stmt)
    sched = res.scalar_one_or_none()
    if not sched:
        raise HTTPException(status_code=404, detail="Không tìm thấy lịch đăng")

    await db.delete(sched)
    await db.commit()
    return {"success": True, "message": f"Đã hủy lịch đăng #{schedule_id} thành công!"}


@router.put("/schedule/{schedule_id}")
async def update_schedule(schedule_id: int, req: UpdateScheduleItemRequest, db: AsyncSession = Depends(get_db)):  # noqa: B008
    """
    Chỉnh sửa giờ đăng, caption hoặc trạng thái của lịch đăng.
    """
    stmt = select(PublishSchedule).where(PublishSchedule.id == schedule_id)
    res = await db.execute(stmt)
    raw_sched = res.scalar_one_or_none()
    if not raw_sched:
        raise HTTPException(status_code=404, detail="Không tìm thấy lịch đăng")
    sched: Any = raw_sched

    if req.scheduled_time:
        try:
            sched.scheduled_time = parse_scheduled_datetime(req.scheduled_time)
            sched.is_manual_override = True
        except Exception:
            pass

    if req.caption is not None:
        sched.caption = req.caption.strip()

    if req.hashtags is not None:
        sched.hashtags = json.dumps(req.hashtags, ensure_ascii=False)

    if req.status:
        try:
            sched.status = PublishStatus(req.status)
        except Exception:
            pass

    await db.commit()
    return {"success": True, "message": "Đã cập nhật lịch đăng thành công!"}


@router.get("/channels/{channel_id}/status")
async def get_channel_login_status(channel_id: int):
    """
    Kiểm tra trạng thái đăng nhập TikTok của một kênh cụ thể.
    """
    status = await check_channel_login_status(channel_id)
    return status


@router.post("/channels/{channel_id}/open-login")
async def open_channel_login(channel_id: int):
    """
    Mở cửa sổ trình duyệt Chromium để người dùng quét mã QR đăng nhập TikTok.
    """
    res = await open_login_window(channel_id)
    return res


@router.post("/channels/{channel_id}/logout")
async def logout_tiktok_channel(channel_id: int):
    """
    Đăng xuất và xóa phiên làm việc của một kênh TikTok.
    """
    success = logout_channel(channel_id)
    return {
        "success": success,
        "message": f"Đã đăng xuất tài khoản TikTok của Kênh #{channel_id}.",
    }


@router.post("/schedule/{schedule_id}/post-now")
async def post_schedule_now(schedule_id: int, headless: Optional[bool] = None):
    """
    Kích hoạt đăng video ngay lập tức lên TikTok (bỏ qua chờ giờ hẹn).
    Mặc định chạy ngầm (headless=True).
    """
    result = await execute_publish_schedule_item(schedule_id, headless_override=headless)
    return result
