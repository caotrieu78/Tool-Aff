"""
Publish Worker — Background worker tự động canh giờ và xuất bản video lên TikTok.
- Quét các lịch đăng đến giờ (scheduled_time <= now)
- Kích hoạt tiktok_browser_service để tự động đăng
- Cập nhật trạng thái thành công (posted) hoặc thất bại/từ chối (failed/rejected)
"""

import asyncio
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import select
from app.core.config import settings
from app.core.db import AsyncSessionLocal
from app.models.publish_schedule import PublishSchedule, PublishStatus
from app.models.video import Video
from app.services.tiktok_browser_service import post_video_to_tiktok
from app.services.tiktok_channel_service import get_configured_tiktok_channels

logger = logging.getLogger(__name__)

# Khóa tránh chạy song song cùng lúc nhiều luồng đăng
_publish_lock = asyncio.Lock()


def resolve_video_publish_file(
    video_id: int,
    original_path: Optional[str] = None,
    output_path: Optional[str] = None,
) -> Optional[Path]:
    """Tìm file video thành phẩm tốt nhất để xuất bản lên TikTok."""
    # 1. Ưu tiên output_path trực tiếp từ bảng Video
    if output_path:
        op = Path(output_path)
        if op.exists() and op.stat().st_size > 1024:
            return op

    storage_root = Path(settings.STORAGE_DIR) / str(video_id)
    library_root = Path(settings.STORAGE_DIR) / "library" / str(video_id)

    # 2. final.mp4 trong thư mục library
    candidate_lib = library_root / "final.mp4"
    if candidate_lib.exists() and candidate_lib.stat().st_size > 1024:
        return candidate_lib

    # 3. Ưu tiên final.mp4 trong thư mục video gốc
    candidate_1 = storage_root / "final.mp4"
    if candidate_1.exists() and candidate_1.stat().st_size > 1024:
        return candidate_1

    # 4. output_localized.mp4 trong thư mục localized
    candidate_loc_out = storage_root / "localized" / "output_localized.mp4"
    if candidate_loc_out.exists() and candidate_loc_out.stat().st_size > 1024:
        return candidate_loc_out

    # 5. final.mp4 trong thư mục localized
    candidate_2 = storage_root / "localized" / "final.mp4"
    if candidate_2.exists() and candidate_2.stat().st_size > 1024:
        return candidate_2

    # 6. File gốc của video nếu không có final
    if original_path:
        orig_p = Path(original_path)
        if orig_p.exists() and orig_p.stat().st_size > 1024:
            return orig_p

    return None


async def execute_publish_schedule_item(
    schedule_id: int,
    headless_override: Optional[bool] = None,
) -> dict[str, Any]:
    """
    Thực thi đăng một lịch đăng cụ thể (dùng cho cả Background Worker và Nút Đăng Ngay).
    Mặc định luôn chạy ngầm (headless=True) trừ khi người dùng ghi đè cấu hình.
    """
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(PublishSchedule).where(PublishSchedule.id == schedule_id))
        raw_sched = res.scalar_one_or_none()
        if not raw_sched:
            return {"success": False, "error": f"Không tìm thấy lịch đăng #{schedule_id}"}

        sched: Any = raw_sched
        v_res = await db.execute(select(Video).where(Video.id == sched.video_id))
        raw_video = v_res.scalar_one_or_none()
        if not raw_video:
            sched.status = PublishStatus.failed
            sched.rejection_reason = "Không tìm thấy video tương ứng trong cơ sở dữ liệu."
            await db.commit()
            return {"success": False, "error": sched.rejection_reason}

        video: Any = raw_video
        file_to_publish = resolve_video_publish_file(
            int(sched.video_id),
            original_path=getattr(video, "file_path", None),
            output_path=getattr(video, "output_path", None),
        )
        if not file_to_publish:
            sched.status = PublishStatus.failed
            sched.rejection_reason = "Chưa có file video hoàn chỉnh (final.mp4) để đăng."
            await db.commit()
            return {"success": False, "error": sched.rejection_reason}

        # Đánh dấu đang xử lý
        sched.status = PublishStatus("posting" if hasattr(PublishStatus, "posting") else "scheduled")
        await db.commit()

        # Parse caption & hashtags
        caption_text = str(sched.caption or getattr(video, "title", "Video mới")).strip()
        ht_list = []
        if sched.hashtags:
            try:
                parsed = json.loads(sched.hashtags)
                if isinstance(parsed, list):
                    ht_list = [str(x) for x in parsed]
            except Exception:
                ht_list = [h.strip() for h in str(sched.hashtags).split() if h.strip()]

        ch_id = int(getattr(sched, "channel_id", 1))

        # Xác định chế độ headless (mặc định luôn True cho chạy ngầm)
        if headless_override is not None:
            is_headless = headless_override
        else:
            cfg_channels = get_configured_tiktok_channels()
            target_ch = next((c for c in cfg_channels if c.get("id") == ch_id), None)
            is_headless = bool(target_ch.get("publish_headless", True)) if target_ch else True

        # Gọi service đăng video bằng Playwright ngầm
        result = await post_video_to_tiktok(
            channel_id=ch_id,
            video_path=str(file_to_publish),
            caption=caption_text,
            hashtags=ht_list,
            headless=is_headless,
        )

        if result.get("success", False) and result.get("status") == "posted":
            sched.status = PublishStatus.posted
            sched.tiktok_post_id = str(result.get("posted_at") or datetime.utcnow().isoformat())
            sched.rejection_reason = None
            logger.info(f"✅ Đã xuất bản thành công lịch đăng #{schedule_id} lên Kênh #{ch_id}")
        else:
            is_rejected = result.get("status") == "rejected"
            sched.status = PublishStatus.rejected if is_rejected else PublishStatus.failed
            sched.rejection_reason = str(result.get("error") or "Lỗi không xác định trong quá trình đăng video.")
            logger.warning(f"⚠️ Lịch đăng #{schedule_id} bị từ chối/thất bại: {sched.rejection_reason}")

        await db.commit()
        return result


async def start_publish_worker():
    """
    Vòng lặp chạy nền định kỳ:
    Quét danh sách lịch đăng đã đến hạn (scheduled_time <= now) và tự động đăng.
    """
    logger.info("⏰ TikTok Publish Worker đã khởi động...")

    # Giải phóng các tác vụ bị kẹt ở trạng thái 'posting' khi khởi động lại worker
    try:
        async with AsyncSessionLocal() as db:
            stuck_stmt = select(PublishSchedule).where(PublishSchedule.status == PublishStatus.posting)
            stuck_res = await db.execute(stuck_stmt)
            stuck_items = stuck_res.scalars().all()
            if stuck_items:
                for it in stuck_items:
                    it_any: Any = it
                    it_any.status = PublishStatus.failed
                    it_any.rejection_reason = "Tiến trình đăng bị gián đoạn do hệ thống khởi động lại."
                await db.commit()
                logger.info(f"🔄 Đã giải phóng {len(stuck_items)} lịch đăng bị kẹt trạng thái 'posting'.")
    except Exception as e:
        logger.warning(f"Lỗi khi dọn dẹp task posting cũ: {e}")

    while True:
        try:
            now = datetime.utcnow()
            async with AsyncSessionLocal() as db:
                stmt = (
                    select(PublishSchedule.id)
                    .where(
                        PublishSchedule.status == PublishStatus.scheduled,
                        PublishSchedule.scheduled_time <= now,
                    )
                    .order_by(PublishSchedule.scheduled_time.asc())
                    .limit(5)
                )
                res = await db.execute(stmt)
                due_schedule_ids = [row[0] for row in res.all()]

            if due_schedule_ids:
                logger.info(f"📬 Tìm thấy {len(due_schedule_ids)} video đến giờ đăng TikTok: {due_schedule_ids}")
                for s_id in due_schedule_ids:
                    async with _publish_lock:
                        await execute_publish_schedule_item(s_id)
                    # Giãn cách giữa 2 lần đăng liên tiếp tối thiểu 10s
                    await asyncio.sleep(10)

        except asyncio.CancelledError:
            logger.info("TikTok Publish Worker đã dừng.")
            break
        except Exception as e:
            logger.error(f"Lỗi trong TikTok Publish Worker: {e}", exc_info=True)

        await asyncio.sleep(30)  # Quét lại mỗi 30 giây
