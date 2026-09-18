import os
import cv2
import json
import base64
import logging
import re
import asyncio
from typing import List, Dict, Any, Optional, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from app.services.gemini_service import (
    GeminiKeyPool,
    call_kie_ai_gemini,
)
from app.core.crypto import decrypt_value

logger = logging.getLogger(__name__)


def calculate_optimal_keyframes_count(duration: float) -> int:
    """Tính số lượng khung hình tối ưu cần trích xuất dựa theo thời lượng video."""
    dur = float(duration)
    if dur <= 20.0:
        return 6
    elif dur <= 45.0:
        return 8
    elif dur <= 90.0:
        return 12
    elif dur <= 150.0:
        return 16
    else:
        return 20


def extract_video_keyframes(video_path: str, num_frames: int = 10) -> List[Tuple[bytes, float]]:
    """
    Trích xuất danh sách keyframes JPEG đại diện kèm mốc thời gian (giây) của từng khung hình.
    Trả về danh sách (jpg_bytes, timestamp_sec).
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return []

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        fps = 30.0

    if total_frames <= 0:
        cap.release()
        return []

    num_frames = max(3, min(num_frames, total_frames))
    frame_indices = [
        int(total_frames * (i + 0.5) / num_frames)
        for i in range(num_frames)
    ]

    keyframes: List[Tuple[bytes, float]] = []
    for idx in frame_indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()
        if ret and frame is not None:
            timestamp_sec = round(idx / fps, 1)
            # Resize nhẹ 480px để gửi API nhanh và tiết kiệm token
            h, w = frame.shape[:2]
            target_w = 480
            target_h = int(h * (target_w / w))
            resized = cv2.resize(frame, (target_w, target_h), interpolation=cv2.INTER_AREA)
            success, buffer = cv2.imencode(".jpg", resized, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
            if success:
                keyframes.append((buffer.tobytes(), timestamp_sec))

    cap.release()
    return keyframes


async def generate_script_from_video_vision(
    db: AsyncSession,
    video_path: str,
    duration: float = 15.0,
    style: str = "casual",
) -> List[Dict[str, Any]]:
    """
    Sử dụng Gemini Multimodal Vision qua Kie.ai để phân tích các khung hình video:
    1. Trích xuất các keyframes tiêu biểu kèm mốc giây tương ứng.
    2. Gửi sang Kie.ai (Gemini 3.8 Flash) để AI hiểu hành động/thao tác.
    3. Tự động biên kịch câu chuyện thuyết minh tiếng Việt phân bổ đều toàn bộ video.
    """
    total_dur = max(3.0, float(duration))
    num_frames = calculate_optimal_keyframes_count(total_dur)
    keyframes_with_time = await asyncio.to_thread(extract_video_keyframes, video_path, num_frames)

    # Tính toán số câu thoại mục tiêu theo thời lượng: trung bình 1 câu ngắn mỗi 7-9 giây
    target_sentences = max(3, int(total_dur / 8.0))
    min_sentences = max(2, target_sentences - 1)
    max_sentences = target_sentences + 2

    style_prompts = {
        "casual": "Natural, friendly, everyday tone — like a friend sharing a useful tip.",
        "đời thường": "Natural, friendly, everyday tone — like a friend sharing a useful tip.",
        "funny": "Humorous, witty, TikTok-trend-aware, engaging, and full of delightful surprises for the viewer.",
        "hài hước": "Humorous, witty, TikTok-trend-aware, engaging, and full of delightful surprises for the viewer.",
        "storytelling": "Expressive, warm, narrative-driven and captivating, highlighting skill and creativity.",
        "kể chuyện": "Expressive, warm, narrative-driven and captivating, highlighting skill and creativity.",
        "technical": "Concise, precise, objective, with detailed step-by-step analysis of what's being done.",
        "chuyên gia": "Concise, precise, objective, with detailed step-by-step analysis of what's being done.",
        "review_phim": (
            "Top-tier Movie-Review / Dramatic-Recap style: tense, fast-paced narration that builds suspense and curiosity "
            "('Watch this person...', 'No one expected that...', 'At this very moment...'), closely following each character's "
            "expressions and dramatic actions on screen, with sharp, decisive, highly engaging phrasing."
        ),
        "review phim": (
            "Top-tier Movie-Review / Dramatic-Recap style: tense, fast-paced narration that builds suspense and curiosity "
            "('Watch this person...', 'No one expected that...', 'At this very moment...'), closely following each character's "
            "expressions and dramatic actions on screen, with sharp, decisive, highly engaging phrasing."
        ),
        "hoat_hinh_ai": (
            "Top-tier AI-Movie / 3D-Animation style: imaginative, engaging narration describing the quirky, surprising actions "
            "and expressions of the animated/AI characters on screen ('This sleepy little frog is plotting something...', "
            "'Watch this brilliant twist...'), witty and captivating like narrating an animated feature film."
        ),
        "phim_ai": (
            "Top-tier AI-Movie / 3D-Animation style: imaginative, engaging narration describing the quirky, surprising actions "
            "and expressions of the animated/AI characters on screen ('This sleepy little frog is plotting something...', "
            "'Watch this brilliant twist...'), witty and captivating like narrating an animated feature film."
        ),
        "ban_hang": (
            "Viral Sales / Affiliate / TikTok Shop Closing style: open with a hook that targets the viewer's mindset and urgent "
            "need, closely observe the unboxing and real functionality of the product to highlight its superior convenience, "
            "spark the urge to buy immediately, and close with a well-placed call to action to tap the cart in the bottom-left corner."
        ),
        "bán hàng": (
            "Viral Sales / Affiliate / TikTok Shop Closing style: open with a hook that targets the viewer's mindset and urgent "
            "need, closely observe the unboxing and real functionality of the product to highlight its superior convenience, "
            "spark the urge to buy immediately, and close with a well-placed call to action to tap the cart in the bottom-left corner."
        ),
        "affiliate": (
            "Viral Sales / Affiliate / TikTok Shop Closing style: open with a hook that targets the viewer's mindset and urgent "
            "need, closely observe the unboxing and real functionality of the product to highlight its superior convenience, "
            "spark the urge to buy immediately, and close with a well-placed call to action to tap the cart in the bottom-left corner."
        ),
        "nhân vật": (
            "Direct In-Scene Character Voiceover / Roleplay: You are NOT a third-person narrator. "
            "Speak directly AS the on-screen character in the first person ('tôi', 'mình', 'tớ'). "
            "Express the character's direct spoken lines, reactions, or inner monologue matching their actions on screen. "
            "NEVER use third-person narrator phrasing like 'cô ấy', 'anh ấy', 'hãy nhìn xem...'. Speak as the character themselves."
        ),
        "nhan_vat": (
            "Direct In-Scene Character Voiceover / Roleplay: You are NOT a third-person narrator. "
            "Speak directly AS the on-screen character in the first person ('tôi', 'mình', 'tớ'). "
            "Express the character's direct spoken lines, reactions, or inner monologue matching their actions on screen. "
            "NEVER use third-person narrator phrasing like 'cô ấy', 'anh ấy', 'hãy nhìn xem...'. Speak as the character themselves."
        ),
        "lồng tiếng nhân vật": (
            "Direct In-Scene Character Voiceover / Roleplay: You are NOT a third-person narrator. "
            "Speak directly AS the on-screen character in the first person ('tôi', 'mình', 'tớ'). "
            "Express the character's direct spoken lines, reactions, or inner monologue matching their actions on screen. "
            "NEVER use third-person narrator phrasing like 'cô ấy', 'anh ấy', 'hãy nhìn xem...'. Speak as the character themselves."
        ),
    }
    style_desc = style_prompts.get(style, style_prompts["casual"])

    time_labels = ", ".join(f"Frame #{i+1} ({t:.1f}s)" for i, (_, t) in enumerate(keyframes_with_time))

    prompt = f"""You are a content-creation expert and voiceover scriptwriter for viral short TikTok/Reels videos.
This video is a movie clip / dramatic moment / daily-life scene / life-hack clip with NO DIALOGUE AND NO SUBTITLES AT ALL.
Total video duration: {total_dur:.1f} seconds.
The attached frames were extracted in chronological order: {time_labels}.

YOUR TASK:
1. Carefully observe every frame: identify the actions, objects, emotions, and key events happening at each timestamp.
2. Write an extremely engaging Vietnamese voiceover script that keeps viewers watching, in this style: {style_desc}
   GROUNDING RULE: only narrate the characters, objects, and actions actually visible in the frames above. Never invent a
   character, object, or event that is not shown.
3. SPREAD THE TIMING EVENLY:
   - Split the script into roughly {min_sentences} to {max_sentences} short lines.
   - Lines must be spread evenly across the whole video, from 0.0s to {max(1.0, total_dur - 1.5):.1f}s (roughly one line every 7-9 seconds, matching the action happening then).
   - NEVER leave a silent gap longer than 10 seconds.
   - Each line should be a moderate length (about 8 to 16 words), natural, easy to listen to, and not overly sentimental.
4. Each line's 'start' and 'end' timestamps must increase in real video time and never exceed {total_dur:.1f}s.

You MUST return EXACTLY this JSON array-of-objects format (no extra explanation):
[
  {{
    "id": 1,
    "start": 0.0,
    "end": 3.5,
    "text": "Short action summary",
    "text_vi": "Engaging Vietnamese narration line matching the frame"
  }}
]

IMPORTANT: the "text_vi" value for every item must be written in natural, fluent Vietnamese — this is the final language shown to end users."""

    keys = await GeminiKeyPool.get_active_keys(db)
    if not keys:
        logger.warning("[Vision] Không có Gemini/Kie.ai key hoạt động → dùng kịch bản dự phòng")
        return _fallback_script(total_dur)

    # Xây dựng nội dung multimodal cho Kie.ai — base64 encode từng frame
    contents: List[Any] = []
    for idx_f, (img_bytes, t_sec) in enumerate(keyframes_with_time):
        contents.append({"text": f"Frame #{idx_f + 1} (at {t_sec:.1f}s):"})
        contents.append({
            "inline_data": {
                "mime_type": "image/jpeg",
                "data": base64.b64encode(img_bytes).decode("utf-8"),  # base64 string, không phải raw bytes
            }
        })
    contents.append({"text": prompt})

    for raw_k in keys:
        key_record: Any = raw_k
        key_id: int = int(key_record.id)
        api_key: str = decrypt_value(str(key_record.api_key_encrypted))

        try:
            logger.info(
                f"[Vision] Gọi Kie.ai key #{key_id} | "
                f"{len(keyframes_with_time)} frames | {total_dur:.1f}s"
            )
            response_text = await call_kie_ai_gemini(
                api_key=api_key,
                prompt=contents,
                model_name="gemini-3-8-flash",
            )

            if not response_text:
                logger.warning(f"[Vision] Key #{key_id} trả về response rỗng → thử key tiếp theo")
                continue

            # Trích xuất JSON từ phản hồi
            json_str = response_text
            match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", response_text)
            if match:
                json_str = match.group(1)

            data = json.loads(json_str.strip())
            if not isinstance(data, list) or len(data) == 0:
                logger.warning(f"[Vision] JSON hợp lệ nhưng rỗng → thử key tiếp theo")
                continue

            results = []
            prev_end = 0.0
            for i, item in enumerate(data):
                s = max(0.0, round(float(item.get("start", prev_end)), 2))
                if s < prev_end and i > 0:
                    s = round(prev_end + 0.5, 2)

                e = min(total_dur, round(float(item.get("end", s + 3.0)), 2))
                if e <= s:
                    e = min(total_dur, round(s + 2.5, 2))

                prev_end = e
                t_vi = str(item.get("text_vi") or item.get("text") or "").strip()
                t_orig = str(item.get("text") or t_vi).strip()
                results.append({
                    "id": i + 1,
                    "start": s,
                    "end": e,
                    "duration": round(e - s, 2),
                    "text": t_orig,
                    "text_vi": t_vi,
                })

            logger.info(
                f"[Vision] ✅ Phân tích xong: {len(results)} câu thuyết minh "
                f"cho video {total_dur:.1f}s (key #{key_id})"
            )
            GeminiKeyPool.clear_cooldown(key_id)
            return results

        except RuntimeError as e:
            err_str = str(e)
            logger.warning(f"[Vision] RuntimeError key #{key_id}: {err_str[:250]}")
            if "401" in err_str or "Unauthorized" in err_str:
                logger.error(f"[Vision] Key #{key_id} không hợp lệ → set cooldown 1h")
                GeminiKeyPool.set_cooldown(key_id, 3600)
            elif "402" in err_str or "429" in err_str or "Quota" in err_str or "Credits" in err_str:
                logger.warning(f"[Vision] Key #{key_id} hết credit → set cooldown 2 phút")
                GeminiKeyPool.set_cooldown(key_id, 120)
            elif "503" in err_str or "capacity" in err_str.lower():
                logger.warning(f"[Vision] Kie.ai 503 quá tải → set cooldown 30s")
                GeminiKeyPool.set_cooldown(key_id, 30)
            # Thử key tiếp theo
            continue

        except json.JSONDecodeError as e:
            logger.warning(f"[Vision] JSON parse lỗi key #{key_id}: {e} → thử key tiếp theo")
            continue

        except Exception as e:
            logger.warning(f"[Vision] Lỗi không xác định key #{key_id}: {str(e)[:250]} → thử key tiếp theo")
            continue

    # Kịch bản dự phòng nếu tất cả key đều thất bại
    logger.error(
        f"[Vision] Tất cả key đều thất bại. "
        f"Trả về kịch bản dự phòng cho video {total_dur:.1f}s"
    )
    return _fallback_script(total_dur)


def _fallback_script(total_dur: float) -> List[Dict[str, Any]]:
    """Tạo kịch bản dự phòng khi Vision AI không khả dụng — chia đều 3 đoạn."""
    third = round(total_dur / 3, 2)
    return [
        {
            "id": 1,
            "start": 0.0,
            "end": third,
            "duration": third,
            "text": "Opening segment",
            "text_vi": "Cùng xem nội dung thú vị trong video này nhé!",
        },
        {
            "id": 2,
            "start": third,
            "end": round(third * 2, 2),
            "duration": third,
            "text": "Middle segment",
            "text_vi": "Thật sự rất ấn tượng và đáng để thử ngay!",
        },
        {
            "id": 3,
            "start": round(third * 2, 2),
            "end": round(total_dur, 2),
            "duration": round(total_dur - third * 2, 2),
            "text": "Closing segment",
            "text_vi": "Đừng bỏ lỡ — theo dõi để xem thêm nhiều nội dung hay!",
        },
    ]
