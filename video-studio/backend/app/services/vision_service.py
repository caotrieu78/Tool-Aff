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
    HAS_NEW_GENAI,
    genai,
    types,
    legacy_genai,
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


def extract_video_keyframes(
    video_path: str,
    num_frames: int = 10,
    start_sec: float = 0.0,
    end_sec: Optional[float] = None,
) -> List[Tuple[bytes, float]]:
    """
    Trích xuất danh sách keyframes JPEG đại diện kèm mốc thời gian (giây) của từng khung hình.
    Có thể giới hạn trong 1 khung thời gian [start_sec, end_sec) thay vì toàn bộ video — dùng để
    lấy mẫu khung hình cho từng "cửa sổ" thời gian khi xử lý video dài (xem generate_script_from_video_vision).
    Trả về danh sách (jpg_bytes, timestamp_sec) với timestamp luôn là mốc thời gian TUYỆT ĐỐI trên video gốc.
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

    start_frame = max(0, int(start_sec * fps))
    end_frame = total_frames if end_sec is None else min(total_frames, int(end_sec * fps))
    if end_frame <= start_frame:
        end_frame = min(total_frames, start_frame + 1)
    window_frames = end_frame - start_frame

    num_frames = max(1, min(num_frames, window_frames))
    frame_indices = [
        start_frame + int(window_frames * (i + 0.5) / num_frames)
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

    _STYLE_REVIEW_PHIM = (
        "Top-tier Movie-Review / Dramatic-Recap style: tense, fast-paced narration that builds suspense and curiosity "
        "('Watch this person...', 'No one expected that...', 'At this very moment...'), closely following each character's "
        "expressions and dramatic actions on screen, with sharp, decisive, highly engaging phrasing."
    )
    _STYLE_HOAT_HINH = (
        "Top-tier AI-Movie / 3D-Animation style: imaginative, engaging narration describing the quirky, surprising actions "
        "and expressions of the animated/AI characters on screen ('This sleepy little frog is plotting something...', "
        "'Watch this brilliant twist...'), witty and captivating like narrating an animated feature film."
    )
    _STYLE_BAN_HANG = (
        "Viral Sales / Affiliate / TikTok Shop Closing style: open with a hook that targets the viewer's mindset and urgent "
        "need, closely observe the unboxing and real functionality of the product to highlight its superior convenience, "
        "spark the urge to buy immediately, and close with a well-placed call to action to tap the cart in the bottom-left corner."
    )
    _STYLE_NHAN_VAT = (
        "Direct In-Scene Character Voiceover / Roleplay: You are NOT a third-person narrator. "
        "Speak directly AS the on-screen character in the first person ('tôi', 'mình', 'tớ'). "
        "Express the character's direct spoken lines, reactions, or inner monologue matching their actions on screen. "
        "NEVER use third-person narrator phrasing like 'cô ấy', 'anh ấy', 'hãy nhìn xem...'. Speak as the character themselves."
    )
    style_prompts = {
        "casual": "Natural, friendly, everyday tone — like a friend sharing a useful tip.",
        "đời thường": "Natural, friendly, everyday tone — like a friend sharing a useful tip.",
        "funny": "Humorous, witty, TikTok-trend-aware, engaging, and full of delightful surprises for the viewer.",
        "hài hước": "Humorous, witty, TikTok-trend-aware, engaging, and full of delightful surprises for the viewer.",
        "storytelling": "Expressive, warm, narrative-driven and captivating, highlighting skill and creativity.",
        "kể chuyện": "Expressive, warm, narrative-driven and captivating, highlighting skill and creativity.",
        "technical": "Concise, precise, objective, with detailed step-by-step analysis of what's being done.",
        "chuyên gia": "Concise, precise, objective, with detailed step-by-step analysis of what's being done.",
        "review_phim": _STYLE_REVIEW_PHIM,
        "review phim": _STYLE_REVIEW_PHIM,
        # id thực tế frontend gửi cho thẻ "Phim AI / Hoạt hình" là "hoạt hình" — trước đây dict chỉ có
        # "hoat_hinh_ai"/"phim_ai" nên chọn thẻ này bị rơi về style "casual" mặc định, không đúng ý.
        "hoạt hình": _STYLE_HOAT_HINH,
        "hoat_hinh_ai": _STYLE_HOAT_HINH,
        "phim_ai": _STYLE_HOAT_HINH,
        "ban_hang": _STYLE_BAN_HANG,
        "bán hàng": _STYLE_BAN_HANG,
        "affiliate": _STYLE_BAN_HANG,
        "nhân vật": _STYLE_NHAN_VAT,
        "nhan_vat": _STYLE_NHAN_VAT,
        "lồng tiếng nhân vật": _STYLE_NHAN_VAT,
    }
    if style in style_prompts:
        style_desc = style_prompts[style]
    elif style.startswith("custom_"):
        style_desc = style_prompts["casual"]
    else:
        style_desc = (
            f"MANDATORY CUSTOM STYLE INSTRUCTION FROM USER:\n"
            f"\"\"\"{style}\"\"\"\n"
            f"You MUST strictly follow this custom style, perspective, emotional tone, and phrasing rules."
        )

    keys = await GeminiKeyPool.get_active_keys(db)
    if not keys:
        raise RuntimeError(
            "[Vision AI] Không tìm thấy Gemini/Kie.ai API key nào đang hoạt động trong hệ thống. "
            "Vui lòng vào mục Cài Đặt để thêm hoặc kích hoạt API Key!"
        )

    # Video dài -> chia thành nhiều "cửa sổ" thời gian ~WINDOW_SECONDS, mỗi cửa sổ tự trích keyframe
    # + gọi Gemini riêng, thay vì luôn nhồi TOÀN BỘ video vào đúng 20 keyframe + 1 lần gọi duy nhất.
    # Trước đây video càng dài thì mật độ hình ảnh grounding càng thưa (20 khung cho cả 30-60 phút)
    # trong khi số câu yêu cầu AI viết lại tăng vô hạn theo thời lượng -> AI dễ "bịa" nội dung.
    WINDOW_SECONDS = 120.0
    if total_dur <= 300.0:
        windows = [(0.0, total_dur)]
    else:
        windows = []
        t = 0.0
        while t < total_dur:
            w_end = min(total_dur, t + WINDOW_SECONDS)
            windows.append((t, w_end))
            t = w_end

    semaphore = asyncio.Semaphore(3)

    async def _generate_window_script(w_start: float, w_end: float) -> List[Dict[str, Any]]:
        w_dur = w_end - w_start
        num_frames = calculate_optimal_keyframes_count(w_dur)
        keyframes_with_time = await asyncio.to_thread(
            extract_video_keyframes, video_path, num_frames, w_start, w_end
        )
        target_sentences = max(1, int(w_dur / 8.0))
        min_sentences = max(1, target_sentences - 1)
        max_sentences = target_sentences + 2

        time_labels = ", ".join(f"Frame #{i+1} ({t:.1f}s)" for i, (_, t) in enumerate(keyframes_with_time))
        context_note = (
            "This is the FULL video." if len(windows) == 1 else
            f"This is one segment (from {w_start:.1f}s to {w_end:.1f}s) of a longer video whose total duration is "
            f"{total_dur:.1f}s. Only write narration for THIS segment's time range — do not summarize or conclude "
            "the whole video here."
        )

        prompt = f"""You are a content-creation expert and voiceover scriptwriter for viral short TikTok/Reels videos.
This video is a movie clip / dramatic moment / daily-life scene / life-hack clip with NO DIALOGUE AND NO SUBTITLES AT ALL.
{context_note}
The attached frames were extracted in chronological order, with ABSOLUTE video timestamps: {time_labels}.

YOUR TASK:
1. Carefully observe every frame: identify the actions, objects, emotions, and key events happening at each timestamp.
2. Write an extremely engaging Vietnamese voiceover script that keeps viewers watching, in this style: {style_desc}
   GROUNDING RULE: only narrate the characters, objects, and actions actually visible in the frames above. Never invent a
   character, object, or event that is not shown.
3. SPREAD THE TIMING EVENLY:
   - Split the script into roughly {min_sentences} to {max_sentences} short lines.
   - Lines must be spread evenly across the segment, from {w_start:.1f}s to {max(w_start + 1.0, w_end - 1.0):.1f}s
     (roughly one line every 7-9 seconds, matching the action happening then).
   - NEVER leave a silent gap longer than 10 seconds.
   - Each line should be a moderate length (about 8 to 16 words), natural, easy to listen to, and not overly sentimental.
4. Each line's 'start' and 'end' timestamps are ABSOLUTE video time and must stay within [{w_start:.1f}, {w_end:.1f}].

You MUST return EXACTLY this JSON array-of-objects format (no extra explanation):
[
  {{
    "id": 1,
    "start": {w_start:.1f},
    "end": {min(w_end, w_start + 3.5):.1f},
    "text": "Short action summary",
    "text_vi": "Engaging Vietnamese narration line matching the frame"
  }}
]

IMPORTANT: the "text_vi" value for every item must be written in natural, fluent Vietnamese — this is the final language shown to end users."""

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

        async with semaphore:
            for raw_k in keys:
                key_record: Any = raw_k
                key_id: int = int(key_record.id)
                api_key: str = decrypt_value(str(key_record.api_key_encrypted))
                provider: str = getattr(key_record, "provider", "google") or "google"

                try:
                    logger.info(
                        f"[Vision] Gọi AI key #{key_id} ({provider.upper()}) | cửa sổ {w_start:.1f}-{w_end:.1f}s | "
                        f"{len(keyframes_with_time)} frames"
                    )
                    if provider == "kie":
                        response_text = await call_kie_ai_gemini(
                            api_key=api_key,
                            prompt=contents,
                            model_name="gemini-3-5-flash",
                        )
                    else:
                        # Google AI Studio key
                        google_contents = []
                        for idx_f, (img_bytes, t_sec) in enumerate(keyframes_with_time):
                            google_contents.append(f"Frame #{idx_f + 1} (at {t_sec:.1f}s):")
                            if HAS_NEW_GENAI and types is not None:
                                google_contents.append(types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"))
                            else:
                                google_contents.append({"mime_type": "image/jpeg", "data": img_bytes})
                        google_contents.append(prompt)

                        if HAS_NEW_GENAI and genai is not None:
                            client = genai.Client(api_key=api_key)
                            resp = client.models.generate_content(
                                model="gemini-2.5-flash",
                                contents=google_contents,
                            )
                            response_text = resp.text or ""
                        elif legacy_genai is not None:
                            legacy_genai.configure(api_key=api_key)
                            model = legacy_genai.GenerativeModel("gemini-2.5-flash")
                            resp = model.generate_content(google_contents)
                            response_text = resp.text or ""
                        else:
                            raise RuntimeError("Google GenAI SDK chưa được cài đặt")

                    if not response_text:
                        logger.warning(f"[Vision] Key #{key_id} trả về response rỗng → thử key tiếp theo")
                        continue

                    json_str = response_text
                    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", response_text)
                    if match:
                        json_str = match.group(1)

                    data = json.loads(json_str.strip())
                    if not isinstance(data, list) or len(data) == 0:
                        logger.warning(f"[Vision] JSON hợp lệ nhưng rỗng → thử key tiếp theo")
                        continue

                    results = []
                    prev_end = w_start
                    for i, item in enumerate(data):
                        s = max(w_start, round(float(item.get("start", prev_end)), 2))
                        if s < prev_end and i > 0:
                            s = round(prev_end + 0.5, 2)

                        e = min(w_end, round(float(item.get("end", s + 3.0)), 2))
                        if e <= s:
                            e = min(w_end, round(s + 2.5, 2))

                        prev_end = e
                        t_vi = str(item.get("text_vi") or item.get("text") or "").strip()
                        t_orig = str(item.get("text") or t_vi).strip()
                        results.append({
                            "start": s,
                            "end": e,
                            "duration": round(e - s, 2),
                            "text": t_orig,
                            "text_vi": t_vi,
                        })

                    logger.info(
                        f"[Vision] ✅ Cửa sổ {w_start:.1f}-{w_end:.1f}s xong: {len(results)} câu (key #{key_id})"
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
                    continue

                except json.JSONDecodeError as e:
                    logger.warning(f"[Vision] JSON parse lỗi key #{key_id}: {e} → thử key tiếp theo")
                    continue

                except Exception as e:
                    logger.warning(f"[Vision] Lỗi không xác định key #{key_id}: {str(e)[:250]} → thử key tiếp theo")
                    continue

        # Tất cả key đều thất bại cho riêng cửa sổ này -> Báo lỗi trực tiếp
        logger.error(f"[Vision] Cửa sổ {w_start:.1f}-{w_end:.1f}s: tất cả API key đều thất bại")
        raise RuntimeError(
            f"[Vision AI] Không thể phân tích video ở đoạn {w_start:.1f}s - {w_end:.1f}s do toàn bộ API Keys đều lỗi. "
            f"Vui lòng kiểm tra lại trạng thái API Key trong Cài Đặt!"
        )

    window_results = await asyncio.gather(*[_generate_window_script(w_s, w_e) for w_s, w_e in windows])

    all_segments: List[Dict[str, Any]] = []
    for window_segs in window_results:
        all_segments.extend(window_segs)

    for i, seg in enumerate(all_segments):
        seg["id"] = i + 1

    logger.info(
        f"[Vision] ✅ Hoàn tất {len(windows)} cửa sổ, tổng {len(all_segments)} câu thuyết minh "
        f"cho video {total_dur:.1f}s"
    )
    return all_segments
