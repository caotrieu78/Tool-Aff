import os
import re
import asyncio
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from sqlalchemy.orm.attributes import flag_modified

from app.core.config import settings
from app.core.db import AsyncSessionLocal
from app.models.job import ProcessingJob, JobStatus, JobStep
from app.models.video import Video, VideoStatus
from app.models.publish_schedule import PublishSchedule, PublishStatus
from app.services.audio_service import extract_audio_wav
from app.services.stt_service import transcribe_chinese_audio
from app.services.gemini_service import translate_chinese_segments
from app.services.tts_service import text_to_speech_file, synthesize_timeline_voiceover, get_available_voices
from app.services.compose_service import generate_srt_file, compose_localized_video, compose_affiliate_video
from app.services.ocr_service import extract_subtitles_from_video_ocr
from app.services.vision_service import (
    generate_script_from_video_vision,
    extract_video_keyframes,
    calculate_optimal_keyframes_count,
)
from app.services.scene_service import detect_video_scenes, score_and_filter_highlights, generate_scene_variations
from app.services.scraper_service import scrape_product_info
from app.services.gemini_service import generate_affiliate_script, analyze_video_product_multimodal
from app.models.product import Product
from app.api.routes_jobs import broadcast_progress

# In-memory storage of running background tasks
_running_tasks: Dict[int, asyncio.Task] = {}

# Giới hạn số job (localize/affiliate) thực sự chạy song song cùng lúc.
_JOB_SEMAPHORE = asyncio.Semaphore(settings.MAX_CONCURRENT_JOBS)


@asynccontextmanager
async def smooth_progress_ticker(job_id: int, step: str, start_p: int, max_p: int, base_msg: str, interval: float = 1.0):
    """
    Tự động tăng dần tiến độ nhẹ nhàng trong khi tác vụ nặng đang chạy dưới nền
    để thanh tiến trình chạy đều đặn 0-100%, không bị khựng đứng hoặc nhảy giật cục.
    """
    stop_ev = asyncio.Event()
    current_p = start_p

    async def _runner():
        nonlocal current_p
        while not stop_ev.is_set() and current_p < max_p:
            await asyncio.sleep(interval)
            if stop_ev.is_set():
                break
            current_p += 1
            try:
                await broadcast_progress(job_id, {
                    "step": step,
                    "percent": current_p,
                    "message": f"{base_msg} ({current_p}%)",
                })
            except Exception:
                pass

    task = asyncio.create_task(_runner())
    try:
        yield
    finally:
        stop_ev.set()
        task.cancel()


async def _run_with_concurrency_limit(coro):
    async with _JOB_SEMAPHORE:
        await coro


async def run_localize_pipeline(job_id: int):
    """
    Tiến trình chạy ngầm toàn bộ pipeline Việt hóa 5 bước cho 1 ProcessingJob.
    """
    async with AsyncSessionLocal() as db:
        stmt = select(ProcessingJob).where(ProcessingJob.id == job_id)
        res = await db.execute(stmt)
        job: Any = res.scalar_one_or_none()
        if not job:
            return

        stmt_v = select(Video).where(Video.id == job.video_id)
        res_v = await db.execute(stmt_v)
        video: Any = res_v.scalar_one_or_none()
        if not video or not os.path.exists(str(video.file_path)):
            job.status = JobStatus.error
            job.error_log = "Không tìm thấy file video gốc trên ổ đĩa"
            await db.commit()
            await broadcast_progress(job_id, {"status": "error", "message": job.error_log})
            return

        config = job.config_json or {}
        # Ưu tiên prompt tùy chỉnh nếu người dùng thiết lập phong cách riêng trong cấu hình
        custom_prompt = str(config.get("ai_style_prompt") or config.get("custom_ai_prompt") or "").strip()
        raw_style = str(config.get("ai_style", "đời thường")).strip()

        if custom_prompt:
            style = custom_prompt
            logger.info(f"[JobRunner] 🎨 Job #{job_id}: Áp dụng Prompt kịch bản tùy chỉnh riêng: '{custom_prompt[:80]}...'")
        elif raw_style.startswith("custom_"):
            style = "đời thường"
            logger.info(f"[JobRunner] 🎨 Job #{job_id}: Phong cách tùy chỉnh không kèm prompt, dùng 'đời thường'")
        else:
            style = raw_style
            logger.info(f"[JobRunner] 🎨 Job #{job_id}: Áp dụng phong cách tiêu chuẩn: '{style}'")
        voice_id = config.get("voice_id", "vi-VN-HoaiMyNeural")
        voice_speed = float(config.get("voice_speed", 1.0))
        
        # 3 Trạng thái nhận diện: voice_only (Có lời không sub), ocr_only (Có sub không lời), ai_vision (Không lời không sub)
        recog_type = str(config.get("recognition_mode") or getattr(video, "recognition_type", None) or "voice_only")

        # Quy tắc làm mờ/che sub cũ: tôn trọng lựa chọn của người dùng (mặc định True) cho tất cả các chế độ
        if "cover_old_subtitle" in config:
            cover_old_sub = bool(config["cover_old_subtitle"])
        elif recog_type == "ocr_only":
            cover_old_sub = True
        else:
            cover_old_sub = True

        bgm_volume = float(config.get("volume_original", 15)) / 100.0
        sync_mode = str(config.get("sync_mode", "keep_duration"))
        keep_original_audio = bool(config.get("keep_original_audio", True))
        voice_volume = float(config.get("volume_voiceover", 100)) / 100.0
        blur_amount = int(config.get("blur_amount", 25))
        blur_method = str(config.get("blur_method", "blur"))
        show_subtitles = bool(config.get("show_subtitles", True))
        sub_font = str(config.get("sub_font", "Oswald"))
        sub_font_size = int(config.get("sub_font_size", 50))
        sub_position_mode = str(config.get("sub_position_mode", "by_original"))
        sub_placement = str(config.get("sub_placement", "overlay"))
        auto_fit_sub_size = bool(config.get("auto_fit_sub_size", True))
        sub_position_percent = int(config.get("sub_position_percent", 71))
        sub_color = str(config.get("sub_color", "#FFFFFF"))
        sub_bg_color = str(config.get("sub_bg_color", "#000000"))
        sub_bg_opacity = int(config.get("sub_bg_opacity", 50))
        sub_style_type = str(config.get("sub_style_type", "box"))
        sub_bold = bool(config.get("sub_bold", False))
        sub_italic = bool(config.get("sub_italic", False))
        sub_margin_v = int(config.get("sub_margin_v", 25))
        pronunciation_dict = config.get("pronunciation_dict") or {}

        # Output folder: storage/jobs/{job_id}/
        job_dir = Path(video.file_path).parent / "localized"
        job_dir.mkdir(parents=True, exist_ok=True)

        # Xóa caption.json cũ nếu có để video mới không bị dính caption cũ
        old_cap_file = job_dir / "caption.json"
        if old_cap_file.exists():
            try:
                old_cap_file.unlink()
            except Exception:
                pass

        # Xóa bản nháp schedule pending cũ nếu có để video mới bắt đầu ở trạng thái Chưa Có Caption
        try:
            del_pending = (
                delete(PublishSchedule)
                .where(PublishSchedule.video_id == video.id, PublishSchedule.status == PublishStatus.pending)
            )
            await db.execute(del_pending)
        except Exception:
            pass

        job.status = JobStatus.running
        job.started_at = datetime.utcnow()
        video.status = VideoStatus.processing
        await db.commit()

        try:
            # ── XỬ LÝ THEO 3 TRẠNG THÁI VIDEO ĐÃ ĐƯỢC PHÂN LOẠI ─────────────
            segments: list[Any] = []
            translated_segments: list[Any] = []

            if recog_type == "ocr_only":
                # TRẠNG THÁI 1: Video có sub - Không lấy lời -> Quét chữ cứng bằng EasyOCR AI
                job.current_step = JobStep.stt
                job.progress_percent = 25.0
                await db.commit()
                await broadcast_progress(job_id, {
                    "step": "ocr",
                    "percent": 25,
                    "message": "Đang quét phụ đề chữ cứng trên màn hình (EasyOCR AI)...",
                })

                async with smooth_progress_ticker(job_id, "ocr", 25, 48, "Đang quét phụ đề chữ cứng (EasyOCR AI)", interval=1.2):
                    segments = await asyncio.to_thread(extract_subtitles_from_video_ocr, video.file_path)

                job.current_step = JobStep.translate
                job.progress_percent = 50.0
                await db.commit()
                await broadcast_progress(job_id, {
                    "step": "translate",
                    "percent": 50,
                    "message": f"Đã quét được {len(segments)} dòng phụ đề. Đang dịch sang tiếng Việt...",
                    "segment_count": len(segments),
                })

                async with smooth_progress_ticker(job_id, "translate", 50, 72, "Đang dịch sang tiếng Việt bằng Gemini AI", interval=0.9):
                    translated_segments = await translate_chinese_segments(db, segments, style=style)

            elif recog_type == "ai_vision":
                # TRẠNG THÁI 3: Video không lời, không sub -> Gemini Multimodal Vision tự xem và biên kịch
                job.current_step = JobStep.translate
                job.progress_percent = 35.0
                await db.commit()
                await broadcast_progress(job_id, {
                    "step": "vision",
                    "percent": 35,
                    "message": "AI Thị Giác đang xem video, phân tích hành động và tự sáng tác kịch bản thuyết minh...",
                })

                dur = float(video.duration or 15.0)
                async with smooth_progress_ticker(job_id, "vision", 35, 72, "AI Thị Giác đang phân tích hành động & sáng tác kịch bản", interval=1.2):
                    translated_segments = await generate_script_from_video_vision(db, video.file_path, dur, style=style)

            else:
                # TRẠNG THÁI 2 (Mặc định): Video có lời - Không có sub -> Whisper STT nghe giọng nói
                job.current_step = JobStep.stt
                job.progress_percent = 10.0
                await db.commit()
                await broadcast_progress(job_id, {
                    "step": "extract",
                    "percent": 10,
                    "message": "Đang trích xuất âm thanh từ video...",
                })

                wav_path = str(job_dir / "audio_source.wav")
                async with smooth_progress_ticker(job_id, "extract", 10, 32, "Đang trích xuất âm thanh từ video", interval=0.7):
                    await asyncio.to_thread(extract_audio_wav, video.file_path, wav_path)

                job.progress_percent = 35.0
                await db.commit()
                await broadcast_progress(job_id, {
                    "step": "stt",
                    "percent": 35,
                    "message": "Đang nhận diện giọng nói tiếng Trung (Whisper STT)...",
                })

                async with smooth_progress_ticker(job_id, "stt", 35, 52, "Đang nhận diện giọng nói (Whisper STT)", interval=1.2):
                    segments = await asyncio.to_thread(transcribe_chinese_audio, wav_path, "large-v3-turbo")

                job.current_step = JobStep.translate
                job.progress_percent = 55.0
                await db.commit()
                await broadcast_progress(job_id, {
                    "step": "translate",
                    "percent": 55,
                    "message": f"Đã nhận diện {len(segments)} câu. Đang dịch sang tiếng Việt bằng Gemini AI...",
                    "segment_count": len(segments),
                })

                async with smooth_progress_ticker(job_id, "translate", 55, 72, "Đang dịch sang tiếng Việt bằng Gemini AI", interval=0.8):
                    translated_segments = await translate_chinese_segments(db, segments, style=style)

            # ── BƯỚC 4: Tạo giọng đọc lồng tiếng TTS (75%) ────────────────────
            job.current_step = JobStep.tts
            job.progress_percent = 75.0
            await db.commit()
            await broadcast_progress(job_id, {
                "step": "tts",
                "percent": 75,
                "message": "Đang tạo giọng đọc tiếng Việt mượt mà (TTS)...",
            })

            # Áp dụng từ điển phát âm (nếu có cấu hình)
            if pronunciation_dict and isinstance(pronunciation_dict, dict):
                for orig_w, repl_w in pronunciation_dict.items():
                    if orig_w and repl_w:
                        for seg in translated_segments:
                            if seg.get("text_vi"):
                                seg["text_vi"] = re.sub(re.escape(orig_w), repl_w, seg["text_vi"], flags=re.IGNORECASE)

            voiceover_path = str(job_dir / "voiceover.mp3")
            # Tạo voiceover rải đều theo timeline video, khớp từng phân đoạn hành động
            async with smooth_progress_ticker(job_id, "tts", 75, 88, "Đang tạo giọng đọc tiếng Việt mượt mà (TTS)", interval=1.0):
                await synthesize_timeline_voiceover(
                    segments=translated_segments,
                    output_path=voiceover_path,
                    voice=voice_id,
                    speed=voice_speed,
                    total_duration=float(video.duration or 0.0),
                )

            # Tạo file phụ đề SRT (sau khi segments đã được đồng bộ mốc thời gian với giọng đọc thực tế)
            srt_path = str(job_dir / "subtitles.srt")
            await asyncio.to_thread(generate_srt_file, translated_segments, srt_path)

            # ── BƯỚC 5: FFmpeg Ghép video & Burn phụ đề (90%) ────────────────
            if cover_old_sub:
                if recog_type == "ocr_only":
                    actual_has_sub = len(segments) > 0
                else:
                    from app.services.ocr_service import check_video_has_hardcoded_subtitles
                    actual_has_sub = await asyncio.to_thread(check_video_has_hardcoded_subtitles, str(video.file_path))

                if not actual_has_sub:
                    cover_old_sub = False
                    logger.info(f"[Job {job_id}] Video không phát hiện phụ đề chữ cứng gốc -> Tự động tắt che mờ để giữ sạch khung hình.")
                else:
                    logger.info(f"[Job {job_id}] Video phát hiện có phụ đề gốc -> Bật dải làm mờ che sub.")

            job.current_step = JobStep.compose
            job.progress_percent = 90.0
            await db.commit()
            await broadcast_progress(job_id, {
                "step": "compose",
                "percent": 90,
                "message": "Đang làm mờ sub cũ, ghép phụ đề mới và mix âm thanh..." if cover_old_sub else "Đang ghép phụ đề mới và mix âm thanh (giữ sạch khung hình)...",
            })

            output_final_path = str(job_dir / "output_localized.mp4")
            async with smooth_progress_ticker(job_id, "compose", 90, 98, "Đang render video và mix âm thanh FFmpeg", interval=1.2):
                await asyncio.to_thread(
                    compose_localized_video,
                    video_path=str(video.file_path),
                    voiceover_path=voiceover_path,
                    srt_path=srt_path,
                    output_path=output_final_path,
                    cover_old_sub=cover_old_sub,
                    bgm_volume=bgm_volume,
                    voice_volume=voice_volume,
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
                    keep_original_audio=keep_original_audio,
                )

            # Hoàn tất thành công!
            job.status = JobStatus.done
            job.current_step = JobStep.compose
            job.progress_percent = 100.0
            job.finished_at = datetime.utcnow()
            video.status = VideoStatus.done

            # Relative URL to play output video
            rel_path = os.path.relpath(output_final_path, settings.STORAGE_DIR).replace("\\", "/")
            config["output_video_path"] = output_final_path
            config["output_url"] = f"/api/storage/{rel_path}?t={int(datetime.utcnow().timestamp())}"
            config["translated_segments"] = translated_segments
            job.config_json = dict(config)
            flag_modified(job, "config_json")
            await db.commit()

            await broadcast_progress(job_id, {
                "status": "done",
                "percent": 100,
                "message": "Việt hóa video hoàn tất thành công!",
                "output_url": config["output_url"],
            })

        except Exception as e:
            job.status = JobStatus.error
            job.error_log = str(e)
            video.status = VideoStatus.error
            await db.commit()
            await broadcast_progress(job_id, {
                "status": "error",
                "message": f"Lỗi trong quá trình xử lý: {str(e)}",
            })


def start_localize_job_background(job_id: int):
    """Khởi chạy job trong background task của asyncio (giới hạn số job chạy song song)."""
    task = asyncio.create_task(_run_with_concurrency_limit(run_localize_pipeline(job_id)))
    _running_tasks[job_id] = task
    return task


async def run_affiliate_pipeline(job_id: int):
    """
    Tiến trình chạy ngầm toàn bộ pipeline AI Dựng Video Affiliate cho 1 ProcessingJob:
    1. Highlight/Scene Detection: Cắt cảnh, chấm điểm, lọc top cảnh nổi bật.
    2. Scrape/Product Info: Đọc hoặc lưu thông tin sản phẩm (Shopee, TikTok Shop).
    3. Gemini Script: Sinh kịch bản bán hàng khớp timing từng cảnh + Caption/Hashtags.
    4. TTS: Đọc kịch bản theo timeline với Edge-TTS hoặc Gemini 2.5 Pro.
    5. Compose: Ghép các cảnh theo thứ tự đã chọn, burn phụ đề xịn, mix voiceover.
    6. Multi-version: Sinh thêm các phiên bản xáo trộn nếu người dùng yêu cầu.
    """
    async with AsyncSessionLocal() as db:
        stmt = select(ProcessingJob).where(ProcessingJob.id == job_id)
        res = await db.execute(stmt)
        job: Any = res.scalar_one_or_none()
        if not job:
            return

        stmt_v = select(Video).where(Video.id == job.video_id)
        res_v = await db.execute(stmt_v)
        video: Any = res_v.scalar_one_or_none()
        if not video or not os.path.exists(str(video.file_path)):
            job.status = JobStatus.error
            job.error_log = "Không tìm thấy file video gốc trên ổ đĩa"
            await db.commit()
            await broadcast_progress(job_id, {"status": "error", "message": job.error_log})
            return

        config = job.config_json or {}
        job.status = JobStatus.running
        job.started_at = datetime.utcnow()
        video.status = VideoStatus.processing
        await db.commit()

        video_dir = os.path.dirname(str(video.file_path))
        video_id = video.id

        try:
            # ─────────────────────────────────────────────────────────────
            # BƯỚC 1: SCENE DETECTION & AUTO-HIGHLIGHT (10% -> 25%)
            # ─────────────────────────────────────────────────────────────
            job.current_step = JobStep.highlight
            job.progress_percent = 10.0
            await db.commit()
            await broadcast_progress(job_id, {
                "step": "highlight",
                "percent": 10,
                "message": "Đang phân tích các cảnh quay và phát hiện điểm nổi bật...",
            })

            preselected_scenes = config.get("selected_scenes")
            if preselected_scenes and isinstance(preselected_scenes, list) and len(preselected_scenes) > 0:
                scenes = preselected_scenes
            else:
                scenes = await asyncio.to_thread(detect_video_scenes, str(video.file_path))
                auto_hl = bool(config.get("auto_highlight", True))
                v_total_dur = float(video.duration or 0.0)
                if auto_hl and len(scenes) > 3:
                    # Nếu video dài > 25s thì mới rút gọn bằng top_n, video ngắn giữ trọn vẹn để không bị cụt thời lượng
                    if v_total_dur > 25.0:
                        top_n = int(config.get("top_highlights_count", 8))
                        scenes = await asyncio.to_thread(score_and_filter_highlights, str(video.file_path), scenes, top_n)
                    else:
                        scenes = await asyncio.to_thread(score_and_filter_highlights, str(video.file_path), scenes, None)

            if not scenes:
                # Fallback tạo 1 cảnh trọn vẹn video
                v_dur = float(video.duration or 15.0)
                scenes = [{"index": 0, "start_time": 0.0, "end_time": v_dur, "duration": v_dur}]

            config["detected_scenes"] = scenes
            job.progress_percent = 25.0
            await db.commit()
            await broadcast_progress(job_id, {
                "step": "highlight",
                "percent": 25,
                "message": f"Đã chọn {len(scenes)} cảnh quay đẹp mắt cho video!",
            })

            # ─────────────────────────────────────────────────────────────
            # BƯỚC 2: PRODUCT SCRAPER & INFO (30% -> 35%)
            # ─────────────────────────────────────────────────────────────
            job.current_step = JobStep.scrape
            job.progress_percent = 30.0
            await db.commit()

            prod_url = str(config.get("shopee_url") or config.get("tiktok_shop_url") or "").strip()
            prod_name = str(config.get("product_name") or "").strip()
            prod_price = str(config.get("price") or "").strip()
            prod_desc = str(config.get("description") or "").strip()
            product_analysis = config.get("product_analysis")

            if prod_url and not prod_name:
                await broadcast_progress(job_id, {
                    "step": "scrape",
                    "percent": 30,
                    "message": "Đang kết nối lấy thông tin sản phẩm từ sàn TMĐT...",
                })
                scraped = await asyncio.to_thread(scrape_product_info, prod_url)
                if scraped.get("product_name"):
                    prod_name = scraped["product_name"]
                    config["product_name"] = prod_name
                if scraped.get("price") and not prod_price:
                    prod_price = scraped["price"]
                    config["price"] = prod_price
                if scraped.get("description") and not prod_desc:
                    prod_desc = scraped["description"]
                    config["description"] = prod_desc

            # Tự động nhận diện sản phẩm đa phương thức (Multimodal Vision & Audio STT) nếu chưa có tên sản phẩm thực tế
            def check_is_invalid_product_name(name: str) -> bool:
                if not name or not name.strip():
                    return True
                name_clean = name.strip()
                if any(name_clean.lower().endswith(ext) for ext in [".mp4", ".mov", ".mkv", ".webm", ".avi", ".flv"]):
                    return True
                if len(name_clean) > 12 and (" " not in name_clean or "_" in name_clean):
                    return True
                if name_clean.isdigit():
                    return True
                if any(kw in name_clean.lower() for kw in [
                    "unduhtiktok", "tiktok", "download", "snaptik", "douyin",
                    "video", "clip", "d11", "d22", "720p", "1080p", "h264"
                ]):
                    return True
                if " " not in name_clean and len(name_clean) > 8:
                    return True
                return False

            # Trích xuất âm thanh và nhận diện lời thoại gốc (Whisper STT) để phục vụ Việt hoá kịch bản chuẩn xác
            stt_segs = []
            orig_transcript = ""
            try:
                wav_temp = os.path.join(video_dir, f"temp_stt_{job_id}.wav")
                await asyncio.to_thread(extract_audio_wav, str(video.file_path), wav_temp)
                if os.path.exists(wav_temp):
                    from app.services.stt_service import transcribe_chinese_audio
                    stt_segs = await asyncio.to_thread(transcribe_chinese_audio, wav_temp)
                    orig_transcript = " ".join(s.get("text", "") for s in stt_segs)
                    if os.path.exists(wav_temp):
                        os.remove(wav_temp)
            except Exception as stt_err:
                logger.warning(f"Không thể trích xuất STT âm thanh gốc: {stt_err}")

            is_generic_name = check_is_invalid_product_name(prod_name)
            if is_generic_name and not prod_url:
                await broadcast_progress(job_id, {
                    "step": "scrape",
                    "percent": 32,
                    "message": "AI Gemini đang quan sát video và phân tích để nhận diện sản phẩm...",
                })

                product_analysis = await analyze_video_product_multimodal(
                    db=db,
                    video_path=str(video.file_path),
                    original_transcript=orig_transcript,
                    model_name=config.get("ai_model", "gemini-3.8-flash"),
                )
                if product_analysis and product_analysis.get("product_name"):
                    prod_name = product_analysis["product_name"]
                    config["product_name"] = prod_name
                    if product_analysis.get("category"):
                        config["category"] = product_analysis["category"]
                    config["product_analysis"] = product_analysis
                    await broadcast_progress(job_id, {
                        "step": "scrape",
                        "percent": 34,
                        "message": f"Đã nhận diện sản phẩm: {prod_name}",
                    })

            # Lưu vào bảng products trong DB
            try:
                prod_row = Product(
                    video_id=video_id,
                    shopee_url=config.get("shopee_url"),
                    tiktok_shop_url=config.get("tiktok_shop_url"),
                    product_name=prod_name or video.title,
                    price=prod_price,
                    note_script=config.get("note_script"),
                )
                db.add(prod_row)
                await db.commit()
            except Exception as pe:
                logger.warning(f"Lỗi lưu Product record: {pe}")

            # ─────────────────────────────────────────────────────────────
            # BƯỚC 3: TẠO CÁC PHIÊN BẢN CẢNH (MULTI-VERSION SCENES)
            # ─────────────────────────────────────────────────────────────
            num_versions = max(1, min(5, int(config.get("num_versions", 1))))
            shuffle_order = bool(config.get("shuffle_order", False))
            variations = generate_scene_variations(
                scenes=scenes,
                num_versions=num_versions,
                shuffle=shuffle_order,
                target_max_duration=config.get("target_duration"),
            )

            # Cấu hình phụ đề & giọng đọc
            voice_conf = config.get("voice_id", "random")
            # Pool giọng "random" cho đa phiên bản: lấy động từ danh sách giọng thật đang khả dụng
            # (Edge-TTS + VieNeu-TTS — miễn phí, không tốn phí API) thay vì hard-code id cố định,
            # tránh lặp lại lỗi id "mồ côi" khi một engine bị gỡ khỏi hệ thống (vd Kokoro trước đây).
            try:
                AFFILIATE_VOICE_POOL = [
                    v["id"] for v in get_available_voices() if v.get("engine") in ("edge-tts", "vieneu")
                ] or ["vi-VN-HoaiMyNeural", "vi-VN-NamMinhNeural"]
            except Exception:
                AFFILIATE_VOICE_POOL = ["vi-VN-HoaiMyNeural", "vi-VN-NamMinhNeural"]
            voice_speed = float(config.get("voice_speed", 1.05))
            bgm_volume = float(config.get("bgm_volume", 0.12))
            voice_volume = float(config.get("voice_volume", 1.0))
            keep_original_audio = bool(config.get("keep_original_audio", True))
            original_volume = float(config.get("original_volume", 0.1))
            ducking = bool(config.get("ducking", True))
            cover_old_sub = bool(config.get("cover_old_sub", False))
            blur_amount = int(config.get("blur_amount", 25))
            show_subtitles = bool(config.get("show_subtitles", True))

            sub_conf = config.get("subtitle_config", {})
            sub_font = sub_conf.get("font", "Arial")
            sub_font_size = int(sub_conf.get("size", 24))
            sub_color = sub_conf.get("color", "#FFE600")
            sub_bg_color = sub_conf.get("background", "#000000")
            sub_bg_opacity = float(sub_conf.get("opacity", 0.75))
            sub_style_type = sub_conf.get("style_type", "full_box")
            sub_bold = bool(sub_conf.get("bold", True))
            sub_italic = bool(sub_conf.get("italic", False))
            sub_pos_percent = int(sub_conf.get("position_percent", 80))

            output_versions_info = []

            # Danh sách phong cách AI kịch bản
            STYLE_KEYS = ["kich_tinh", "hai_huoc", "chuyen_gia", "doi_thuong", "boc_phot", "meo_vat"]
            req_style = config.get("ai_style", "random")

            # Video không có lời thoại gốc -> mọi phiên bản kịch bản sẽ dùng Gemini Vision xem khung hình.
            # Trích xuất khung hình MỘT LẦN DUY NHẤT ở đây và tái sử dụng cho tất cả num_versions,
            # thay vì để mỗi phiên bản tự đọc lại toàn bộ video bằng OpenCV (tốn CPU/IO và làm chậm pipeline).
            has_original_speech = bool(stt_segs) and any(
                (s.get("text") or s.get("text_zh") or "").strip() for s in stt_segs
            )
            shared_keyframes = None
            if not has_original_speech and os.path.exists(str(video.file_path)):
                shared_num_frames = calculate_optimal_keyframes_count(float(video.duration or 20.0))
                shared_keyframes = await asyncio.to_thread(
                    extract_video_keyframes, str(video.file_path), shared_num_frames
                )

            # Xử lý từng phiên bản (v=0 là bản chính, v>0 là các bản biến thể)
            for v_idx, cur_scenes in enumerate(variations):
                ver_num = v_idx + 1
                prog_base = 35.0 + (v_idx / num_versions) * 60.0

                # Lựa chọn giọng đọc & phong cách riêng biệt cho từng phiên bản
                if not voice_conf or voice_conf == "random":
                    cur_voice = AFFILIATE_VOICE_POOL[(job_id + v_idx) % len(AFFILIATE_VOICE_POOL)]
                else:
                    cur_voice = voice_conf

                if not req_style or req_style == "random":
                    cur_style = STYLE_KEYS[(job_id + v_idx) % len(STYLE_KEYS)]
                else:
                    cur_style = req_style

                # ─────────────────────────────────────────────────────────
                # BƯỚC 4: GEMINI SCRIPT (KỊCH BẢN REVIEW & CAPTION)
                # ─────────────────────────────────────────────────────────
                job.current_step = JobStep.script
                job.progress_percent = prog_base + 5.0
                await db.commit()
                await broadcast_progress(job_id, {
                    "step": "script",
                    "percent": int(prog_base + 5),
                    "message": f"[Bản {ver_num}/{num_versions}] AI đang viết kịch bản phong cách '{cur_style}'...",
                })

                script_res = await generate_affiliate_script(
                    db=db,
                    scenes=cur_scenes,
                    product_name=prod_name or video.title,
                    price=prod_price,
                    description=prod_desc,
                    note_script=config.get("note_script", ""),
                    category=config.get("category", "Đồ gia dụng & Tiện ích"),
                    style=cur_style,
                    version_index=ver_num,
                    model_name=config.get("ai_model", "gemini-3.8-flash"),
                    product_analysis=product_analysis,
                    stt_segments=stt_segs,
                    video_path=str(video.file_path),
                    precomputed_keyframes=shared_keyframes,
                    dubbing_mode=config.get("dubbing_mode", "auto"),
                )

                segments = script_res["segments"]
                title = script_res.get("title", f"Review {prod_name or 'sản phẩm'}")
                caption = script_res.get("caption", "")
                hashtags = script_res.get("hashtags", [])

                # ─────────────────────────────────────────────────────────
                # BƯỚC 5: TTS (LỒNG TIẾNG THEO TIMELINE CẢNH QUAY)
                # ─────────────────────────────────────────────────────────
                job.current_step = JobStep.tts
                job.progress_percent = prog_base + 12.0
                await db.commit()
                await broadcast_progress(job_id, {
                    "step": "tts",
                    "percent": int(prog_base + 12),
                    "message": f"[Bản {ver_num}/{num_versions}] Đang tạo giọng đọc bán hàng ({cur_voice})...",
                })

                ver_suffix = f"_v{ver_num}" if num_versions > 1 else ""
                voiceover_path = os.path.join(video_dir, f"voiceover_affiliate{ver_suffix}.mp3")
                srt_path = os.path.join(video_dir, f"subtitles_affiliate{ver_suffix}.srt")

                tot_dur = sum(s.get("duration", 2.0) for s in cur_scenes)
                await synthesize_timeline_voiceover(
                    segments=segments,
                    output_path=voiceover_path,
                    voice=cur_voice,
                    speed=voice_speed,
                    total_duration=tot_dur,
                )

                await asyncio.to_thread(generate_srt_file, segments, srt_path)

                # ─────────────────────────────────────────────────────────
                # BƯỚC 6: COMPOSE & RENDER VIDEO AFFILIATE
                # ─────────────────────────────────────────────────────────
                job.current_step = JobStep.compose
                job.progress_percent = prog_base + 18.0
                await db.commit()
                await broadcast_progress(job_id, {
                    "step": "compose",
                    "percent": int(prog_base + 18),
                    "message": f"[Bản {ver_num}/{num_versions}] Đang ghép cảnh, chèn phụ đề & mix âm thanh hoàn chỉnh...",
                })

                output_ver_path = os.path.join(video_dir, f"affiliate_output{ver_suffix}.mp4")
                await asyncio.to_thread(
                    compose_affiliate_video,
                    source_video_path=str(video.file_path),
                    scenes=cur_scenes,
                    output_path=output_ver_path,
                    srt_path=srt_path,
                    voiceover_path=voiceover_path,
                    bgm_volume=bgm_volume,
                    voice_volume=voice_volume,
                    keep_original_audio=keep_original_audio,
                    original_volume=original_volume,
                    ducking=ducking,
                    cover_old_sub=cover_old_sub,
                    blur_amount=blur_amount,
                    show_subtitles=show_subtitles,
                    sub_position_percent=sub_pos_percent,
                    sub_font=sub_font,
                    sub_font_size=sub_font_size,
                    sub_color=sub_color,
                    sub_bg_color=sub_bg_color,
                    sub_bg_opacity=sub_bg_opacity,
                    sub_style_type=sub_style_type,
                    sub_bold=sub_bold,
                    sub_italic=sub_italic,
                )

                rel_ver_path = os.path.relpath(output_ver_path, settings.STORAGE_DIR).replace("\\", "/")
                output_ver_url = f"/api/storage/{rel_ver_path}?t={int(datetime.utcnow().timestamp())}"

                output_versions_info.append({
                    "version": ver_num,
                    "title": title,
                    "caption": caption,
                    "hashtags": hashtags,
                    "output_path": output_ver_path,
                    "output_url": output_ver_url,
                    "duration": tot_dur,
                    "scenes_count": len(cur_scenes),
                    "segments": segments,
                })

            # Hoàn tất toàn bộ pipeline
            job.status = JobStatus.done
            job.progress_percent = 100.0
            job.finished_at = datetime.utcnow()
            video.status = VideoStatus.done

            # Cập nhật kết quả vào video và job
            primary_ver = output_versions_info[0]
            video.output_path = primary_ver["output_path"]
            config["output_video_path"] = primary_ver["output_path"]
            config["output_url"] = primary_ver["output_url"]
            config["caption"] = primary_ver["caption"]
            config["hashtags"] = primary_ver["hashtags"]
            config["title"] = primary_ver["title"]
            config["versions"] = output_versions_info
            job.config_json = dict(config)
            flag_modified(job, "config_json")
            await db.commit()

            await broadcast_progress(job_id, {
                "status": "done",
                "percent": 100,
                "message": f"Dựng thành công {num_versions} video Affiliate sẵn sàng đăng TikTok!",
                "output_url": primary_ver["output_url"],
                "versions": output_versions_info,
            })

        except Exception as e:
            logger.exception(f"Lỗi pipeline Affiliate Studio: {e}")
            job.status = JobStatus.error
            job.error_log = str(e)
            video.status = VideoStatus.error
            await db.commit()
            await broadcast_progress(job_id, {
                "status": "error",
                "message": f"Lỗi trong quá trình dựng video affiliate: {str(e)}",
            })


def start_affiliate_job_background(job_id: int):
    """Khởi chạy job Affiliate Studio trong background task của asyncio (giới hạn số job chạy song song)."""
    task = asyncio.create_task(_run_with_concurrency_limit(run_affiliate_pipeline(job_id)))
    _running_tasks[job_id] = task
    return task

