import asyncio
import os
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Any

import logging
from app.core.config import settings

logger = logging.getLogger(__name__)

# Safe optional imports for linters & type checkers
try:
    import edge_tts  # type: ignore
except ImportError:
    edge_tts = None  # type: ignore

try:
    import soundfile as sf  # type: ignore
except ImportError:
    sf = None  # type: ignore

try:
    import torch  # type: ignore
except ImportError:
    torch = None  # type: ignore

VOICES_PRESET: list[dict[str, Any]] = [
    # ── Edge-TTS Voices ──
    {
        "id": "vi-VN-HoaiMyNeural",
        "name": "Hoài My (Nữ miền Bắc)",
        "gender": "Female",
        "region": "Miền Bắc",
        "description": "Giọng nữ tự nhiên, trong trẻo, truyền cảm hứng, thích hợp review đồ gia dụng, thời trang.",
        "engine": "edge-tts",
        "is_default": True,
    },
    {
        "id": "vi-VN-NamMinhNeural",
        "name": "Nam Minh (Nam miền Bắc)",
        "gender": "Male",
        "region": "Miền Bắc",
        "description": "Giọng nam trầm ấm, rõ ràng, phong cách công nghệ, review đồ điện tử, đồ gia dụng.",
        "engine": "edge-tts",
        "is_default": False,
    },


    # ── Gemini 2.5 Pro Preview TTS (Google Studio qua Kie.ai) ──
    # Giọng Nữ (14 giọng)
    {
        "id": "gemini_achernar",
        "name": "Achernar (Nữ - Gemini 2.5 Pro)",
        "voice_name": "Achernar",
        "gender": "Female",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nữ thanh thoát, sắc sảo, truyền cảm hứng cao cấp.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_aoede",
        "name": "Aoede (Nữ - Gemini 2.5 Pro)",
        "voice_name": "Aoede",
        "gender": "Female",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nữ du dương, ngân vang, mang phong cách kể chuyện nghệ thuật.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_autonoe",
        "name": "Autonoe (Nữ - Gemini 2.5 Pro)",
        "voice_name": "Autonoe",
        "gender": "Female",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nữ đĩnh đạc, rõ ràng, phong cách thuyết trình và phóng sự.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_callirrhoe",
        "name": "Callirrhoe (Nữ - Gemini 2.5 Pro)",
        "voice_name": "Callirrhoe",
        "gender": "Female",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nữ trong sáng, dịu dàng, phù hợp phong cách sống và làm đẹp.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_despina",
        "name": "Despina (Nữ - Gemini 2.5 Pro)",
        "voice_name": "Despina",
        "gender": "Female",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nữ nhẹ nhàng, gần gũi, thích hợp review sản phẩm đời thường.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_erinome",
        "name": "Erinome (Nữ - Gemini 2.5 Pro)",
        "voice_name": "Erinome",
        "gender": "Female",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nữ trầm tĩnh, sâu lắng, phù hợp podcast và tâm sự.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_gacrux",
        "name": "Gacrux (Nữ - Gemini 2.5 Pro)",
        "voice_name": "Gacrux",
        "gender": "Female",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nữ sắc sảo, hiện đại, năng động cho video TikTok/Reels.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_kore",
        "name": "Kore (Nữ - Gemini 2.5 Pro)",
        "voice_name": "Kore",
        "gender": "Female",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nữ trẻ trung, tươi sáng, cuốn hút người nghe từ giây đầu.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_laomedeia",
        "name": "Laomedeia (Nữ - Gemini 2.5 Pro)",
        "voice_name": "Laomedeia",
        "gender": "Female",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nữ sang trọng, quý phái, thích hợp thương hiệu cao cấp.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_leda",
        "name": "Leda (Nữ - Gemini 2.5 Pro)",
        "voice_name": "Leda",
        "gender": "Female",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nữ ấm áp, thân thiện, tạo sự tin cậy cao khi tư vấn sản phẩm.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_pulcherrima",
        "name": "Pulcherrima (Nữ - Gemini 2.5 Pro)",
        "voice_name": "Pulcherrima",
        "gender": "Female",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nữ bay bổng, biểu cảm phong phú, phù hợp kịch bản sáng tạo.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_sulafat",
        "name": "Sulafat (Nữ - Gemini 2.5 Pro)",
        "voice_name": "Sulafat",
        "gender": "Female",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nữ mượt mà, truyền cảm, thích hợp đọc truyện và sách nói.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_vindemiatrix",
        "name": "Vindemiatrix (Nữ - Gemini 2.5 Pro)",
        "voice_name": "Vindemiatrix",
        "gender": "Female",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nữ chững chạc, chuyên nghiệp, thông tin chính xác uy tín.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_zephyr",
        "name": "Zephyr (Nữ - Gemini 2.5 Pro)",
        "voice_name": "Zephyr",
        "gender": "Female",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nữ tươi vui, thanh thoát, năng lượng tích cực chuẩn Gen Z.",
        "engine": "gemini",
        "is_default": False,
    },
    # Giọng Nam (16 giọng)
    {
        "id": "gemini_achird",
        "name": "Achird (Nam - Gemini 2.5 Pro)",
        "voice_name": "Achird",
        "gender": "Male",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nam trầm ấm, phong thái lịch lãm, thích hợp review công nghệ.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_algenib",
        "name": "Algenib (Nam - Gemini 2.5 Pro)",
        "voice_name": "Algenib",
        "gender": "Male",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nam dõng dạc, uy lực, phong cách tin tức tài chính và thời sự.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_algieba",
        "name": "Algieba (Nam - Gemini 2.5 Pro)",
        "voice_name": "Algieba",
        "gender": "Male",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nam đĩnh đạc, ấm áp, thích hợp thuyết minh phim tài liệu.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_alnilam",
        "name": "Alnilam (Nam - Gemini 2.5 Pro)",
        "voice_name": "Alnilam",
        "gender": "Male",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nam truyền cảm, sâu lắng, lôi cuốn cho video kể chuyện.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_charon",
        "name": "Charon (Nam - Gemini 2.5 Pro)",
        "voice_name": "Charon",
        "gender": "Male",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nam bí ẩn, nội lực, phù hợp chủ đề khám phá, kịch tính.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_enceladus",
        "name": "Enceladus (Nam - Gemini 2.5 Pro)",
        "voice_name": "Enceladus",
        "gender": "Male",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nam vang dội, hào hùng, tạo ấn tượng mạnh mẽ cho trailer.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_fenrir",
        "name": "Fenrir (Nam - Gemini 2.5 Pro)",
        "voice_name": "Fenrir",
        "gender": "Male",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nam mạnh mẽ, cá tính, phong cách review thể thao và xe hơi.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_iapetus",
        "name": "Iapetus (Nam - Gemini 2.5 Pro)",
        "voice_name": "Iapetus",
        "gender": "Male",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nam chín chắn, từng trải, phù hợp triết lý và kiến thức chuyên sâu.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_orus",
        "name": "Orus (Nam - Gemini 2.5 Pro)",
        "voice_name": "Orus",
        "gender": "Male",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nam tươi vui, năng động, phong cách bán hàng livestream thu hút.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_puck",
        "name": "Puck (Nam - Gemini 2.5 Pro)",
        "voice_name": "Puck",
        "gender": "Male",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nam trẻ trung, hóm hỉnh, bắt tai cho video ngắn viral TikTok.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_rasalgethi",
        "name": "Rasalgethi (Nam - Gemini 2.5 Pro)",
        "voice_name": "Rasalgethi",
        "gender": "Male",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nam quyền lực, trầm hùng, phong cách điện ảnh Hollywood.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_sadachbia",
        "name": "Sadachbia (Nam - Gemini 2.5 Pro)",
        "voice_name": "Sadachbia",
        "gender": "Male",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nam mộc mạc, gần gũi, chân thực cho video đời sống và du lịch.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_sadaltager",
        "name": "Sadaltager (Nam - Gemini 2.5 Pro)",
        "voice_name": "Sadaltager",
        "gender": "Male",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nam sắc nét, khúc chiết, phù hợp hướng dẫn kỹ thuật.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_schedar",
        "name": "Schedar (Nam - Gemini 2.5 Pro)",
        "voice_name": "Schedar",
        "gender": "Male",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nam tự tin, đĩnh đạc, thích hợp quảng cáo doanh nghiệp.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_umbriel",
        "name": "Umbriel (Nam - Gemini 2.5 Pro)",
        "voice_name": "Umbriel",
        "gender": "Male",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nam lắng đọng, ấm cúng, thích hợp podcast đêm khuya.",
        "engine": "gemini",
        "is_default": False,
    },
    {
        "id": "gemini_zubenelgenubi",
        "name": "Zubenelgenubi (Nam - Gemini 2.5 Pro)",
        "voice_name": "Zubenelgenubi",
        "gender": "Male",
        "region": "Toàn Cầu / Studio",
        "description": "Giọng nam cuốn hút, âm sắc đặc biệt, dễ tạo dấu ấn riêng.",
        "engine": "gemini",
        "is_default": False,
    },
]

GEMINI_VOICE_IDS = {
    v["id"] for v in VOICES_PRESET if v.get("engine") == "gemini"
}

def get_available_voices() -> list[dict[str, Any]]:
    """Trả về danh sách tất cả giọng đọc tiếng Việt (Gemini 2.5 Pro, Edge-TTS)."""
    return list(VOICES_PRESET)


def format_rate_string(speed: float) -> str:
    """Chuyển đổi speed float (0.8 - 1.5) sang định dạng Edge-TTS rate string."""
    diff = int((speed - 1.0) * 100)
    if diff >= 0:
        return f"+{diff}%"
    else:
        return f"{diff}%"


async def text_to_speech_file(
    text: str,
    output_path: str,
    voice: str = "vi-VN-HoaiMyNeural",
    speed: float = 1.0,
) -> str:
    """Tạo file âm thanh MP3 từ văn bản tiếng Việt qua Gemini 2.5 Pro hoặc Edge-TTS."""
    if not text.strip():
        raise ValueError("Văn bản chuyển đổi giọng nói không được để trống")

    output_dir = os.path.dirname(output_path)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    # 0. Nếu là giọng Gemini 2.5 Pro TTS (Kie.ai)
    if (
        voice.startswith("gemini_")
        or voice.startswith("gemini-")
        or voice in GEMINI_VOICE_IDS
        or voice.lower().replace("gemini_", "").replace("gemini-", "") in {
            "achernar", "aoede", "autonoe", "callirrhoe", "despina", "erinome",
            "gacrux", "kore", "laomedeia", "leda", "pulcherrima", "sulafat",
            "vindemiatrix", "zephyr", "achird", "algenib", "algieba", "alnilam",
            "charon", "enceladus", "fenrir", "iapetus", "orus", "puck",
            "rasalgethi", "sadachbia", "sadaltager", "schedar", "umbriel", "zubenelgenubi"
        }
    ):
        try:
            from app.services.gemini_tts_service import synthesize_gemini_tts_file
            return await synthesize_gemini_tts_file(
                text=text,
                output_path=output_path,
                voice=voice,
                speed=speed,
            )
        except Exception as gemini_err:
            logger.warning(f"[Gemini TTS] Lỗi ({gemini_err}), chuyển sang Edge-TTS dự phòng")
            is_female = any(g in voice.lower() for g in (
                "achernar", "aoede", "autonoe", "callirrhoe", "despina", "erinome",
                "gacrux", "kore", "laomedeia", "leda", "pulcherrima", "sulafat",
                "vindemiatrix", "zephyr"
            ))
            fallback_voice = "vi-VN-HoaiMyNeural" if is_female else "vi-VN-NamMinhNeural"
            return await text_to_speech_file(text=text, output_path=output_path, voice=fallback_voice, speed=speed)

    # 1. Mặc định sử dụng Edge-TTS (Microsoft Neural Studio Voice)
    if edge_tts is not None:
        rate_str = format_rate_string(speed)
        for attempt in range(3):
            try:
                communicate = edge_tts.Communicate(
                    text=text,
                    voice=voice,
                    rate=rate_str,
                )
                await communicate.save(output_path)
                if os.path.exists(output_path) and os.path.getsize(output_path) > 100:
                    return output_path
            except Exception as edge_err:
                if attempt < 2:
                    await asyncio.sleep(0.35 * (attempt + 1))
                else:
                    logger.error(f"[Edge-TTS] Lỗi sau 3 lần thử ({edge_err})")
                    raise RuntimeError(f"Chuyển đổi âm thanh Edge-TTS thất bại: {edge_err}")

    raise RuntimeError("Không thể tổng hợp âm thanh giọng đọc.")


async def get_or_create_voice_preview(voice_id: str) -> str:
    """Tạo hoặc lấy file audio nghe thử mẫu của giọng đọc."""
    preview_dir = Path(settings.STORAGE_DIR) / "previews"
    preview_dir.mkdir(parents=True, exist_ok=True)

    file_path = preview_dir / f"{voice_id}_sample.mp3"
    # Luôn kiểm tra file tồn tại và dung lượng hợp lệ (> 1000 bytes)
    if not file_path.exists() or file_path.stat().st_size < 1000:
        if voice_id.startswith("gemini_") or voice_id.startswith("gemini-") or voice_id in GEMINI_VOICE_IDS:
            sample_text = "Xin chào! Đây là giọng đọc trí tuệ nhân tạo Gemini 2.5 Pro của hệ thống Video Studio."
        else:
            sample_text = (
                "Xin chào! Đây là giọng đọc mẫu tiếng Việt của hệ thống Video Studio. "
                "Giọng đọc tự nhiên, rõ ràng, giúp video của bạn thu hút hơn."
            )
        await text_to_speech_file(
            text=sample_text,
            output_path=str(file_path),
            voice=voice_id,
            speed=1.0,
        )

    # Return relative URL path served by FastAPI static mount
    return f"/api/storage/previews/{voice_id}_sample.mp3"


async def synthesize_timeline_voiceover(
    segments: list[dict[str, Any]],
    output_path: str,
    voice: str = "vi-VN-HoaiMyNeural",
    speed: float = 1.0,
    total_duration: float = 0.0,
) -> str:
    """
    Tổng hợp file âm thanh lồng tiếng theo dòng thời gian (Audio Timeline Assembly):
    - Mỗi câu thoại được tạo âm thanh riêng và đặt chính xác vào mốc thời gian start gốc trên video.
    - Căn khớp thời lượng từng câu với khung thời gian (time-slot) của nó, tự động điều chỉnh tốc độ
      nếu câu thoại tiếng Việt dài hơn khung hình để tránh hiện tượng dồn toa (drift) gây lệch tiếng.
    - Duy trì khoảng lặng (silence) tự nhiên giữa các phân cảnh — TUYỆT ĐỐI KHÔNG ép co khoảng lặng làm lệch phân cảnh thị giác.
    - Đồng bộ mốc thời gian start/end thực tế vào segments để phụ đề SRT khớp 100% từng từ với giọng đọc.
    """
    valid_items: list[tuple[int, dict[str, Any], str]] = []
    for idx, seg in enumerate(segments):
        if not isinstance(seg, dict):
            continue
        txt = (seg.get("text_vi") or seg.get("text") or "").strip()
        if txt:
            valid_items.append((idx, seg, txt))

    from pydub import AudioSegment

    if not valid_items:
        dur_ms = max(int(total_duration * 1000), 3000)
        silent = AudioSegment.silent(duration=dur_ms, frame_rate=44100).set_channels(2)
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        await asyncio.to_thread(silent.export, output_path, format="mp3")
        return output_path

    # Sử dụng thư mục tạm để sinh từng file audio câu thoại
    with tempfile.TemporaryDirectory(prefix="tts_timeline_") as tmp_dir:
        seg_temp_files = []
        for i, (orig_idx, seg, txt) in enumerate(valid_items):
            tmp_path = os.path.join(tmp_dir, f"seg_{i}.mp3")
            seg_temp_files.append((orig_idx, seg, tmp_path, txt))

            # Tổng hợp TTS tuần tự có retry và fallback đảm bảo 100% không mất tiếng
            success = False
            for attempt in range(2):
                try:
                    await text_to_speech_file(
                        text=txt,
                        output_path=tmp_path,
                        voice=voice,
                        speed=speed,
                    )
                    if os.path.exists(tmp_path) and os.path.getsize(tmp_path) > 500:
                        success = True
                        break
                except Exception as err:
                    logger.warning(f"Lỗi TTS segment {orig_idx} (lần {attempt+1}): {err}")
                    await asyncio.sleep(0.3)

            if not success:
                # Dự phòng bằng Edge-TTS NamMinh/HoaiMy
                fb_voice = "vi-VN-NamMinhNeural" if "nam" in voice.lower() else "vi-VN-HoaiMyNeural"
                try:
                    await text_to_speech_file(
                        text=txt,
                        output_path=tmp_path,
                        voice=fb_voice,
                        speed=speed,
                    )
                except Exception as fb_err:
                    logger.error(f"Fallback TTS cũng lỗi cho segment {orig_idx}: {fb_err}")

        # Ráp timeline bằng pydub trong background thread
        def _assemble() -> str:
            calc_total_ms = int(total_duration * 1000) if total_duration > 0 else 0
            if calc_total_ms <= 0:
                max_end_s = max(float(s.get("end", 0.0)) for _, s, _ in valid_items)
                calc_total_ms = int(max(max_end_s + 2.0, 5.0) * 1000)

            # Nạp danh sách audio clip hợp lệ
            raw_clips: list[tuple[int, dict[str, Any], str, Any]] = []
            for orig_idx, seg, fpath, _ in seg_temp_files:
                if not os.path.exists(fpath) or os.path.getsize(fpath) == 0:
                    continue
                try:
                    c = AudioSegment.from_file(fpath).set_frame_rate(44100).set_channels(2)
                    raw_clips.append((orig_idx, seg, fpath, c))
                except Exception as clip_err:
                    logger.warning(f"Không thể đọc audio segment {orig_idx}: {clip_err}")

            if not raw_clips:
                silent = AudioSegment.silent(duration=calc_total_ms, frame_rate=44100).set_channels(2)
                os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
                silent.export(output_path, format="mp3", bitrate="192k")
                return output_path

            # Khung âm thanh rỗng chuẩn 44.1kHz stereo
            master: Any = AudioSegment.silent(duration=calc_total_ms, frame_rate=44100).set_channels(2)
            cursor_ms = 0
            n_clips = len(raw_clips)

            for k in range(n_clips):
                orig_idx, seg, fpath, audio_clip = raw_clips[k]
                clip_len_ms = len(audio_clip)

                orig_start_ms = max(0, int(float(seg.get("start", 0.0)) * 1000))
                orig_end_ms = max(orig_start_ms + 300, int(float(seg.get("end", 0.0)) * 1000))
                orig_dur_ms = orig_end_ms - orig_start_ms

                # Xác định khung thời gian khả dụng (slot) trước khi câu tiếp theo cất lời
                if k < n_clips - 1:
                    next_seg = raw_clips[k + 1][1]
                    next_start_ms = max(orig_start_ms + 300, int(float(next_seg.get("start", 0.0)) * 1000))
                    available_slot_ms = max(orig_dur_ms, next_start_ms - orig_start_ms - 60)
                else:
                    if calc_total_ms > orig_start_ms:
                        available_slot_ms = max(orig_dur_ms, calc_total_ms - orig_start_ms - 150)
                    else:
                        available_slot_ms = orig_dur_ms + 1500

                # 1. Kiểm tra độ lệch thời lượng giọng đọc so với khung hình start/end gốc của câu thoại.
                # Ngưỡng co giãn tự nhiên cho phép: ±15%. Vượt ngưỡng này, ffmpeg atempo sẽ làm giọng
                # nghe méo/gấp gáp bất thường -> chỉ CẢNH BÁO để sửa lại kịch bản, không ép giãn vô hạn.
                if orig_dur_ms > 300:
                    timing_deviation = (clip_len_ms / orig_dur_ms) - 1.0
                    if abs(timing_deviation) > 0.15:
                        seg["timing_warning"] = True
                        seg["timing_deviation_pct"] = round(timing_deviation * 100, 1)
                        logger.warning(
                            f"[TTS Timing] Câu #{orig_idx} lệch {timing_deviation * 100:+.1f}% so với khung hình "
                            f"gốc (giọng đọc: {clip_len_ms}ms / khung gốc: {orig_dur_ms}ms) — vượt ngưỡng ±15%. "
                            f"Khuyến nghị viết lại/rút gọn câu thoại thay vì ép giãn giọng: "
                            f"'{(seg.get('text_vi') or seg.get('text') or '')[:100]}'"
                        )

                # 2. Điều chỉnh tốc độ từng câu thoại nếu câu tiếng Việt dài hơn khung hình cho phép.
                # Ưu tiên giữ độ co giãn trong ngưỡng tự nhiên ±15% (tối đa 1.15x); chỉ ép giãn thêm
                # (tối đa 1.35x) khi thực sự cần để tránh chồng tiếng lên câu kế tiếp trên timeline.
                if clip_len_ms > available_slot_ms:
                    needed_speed_for_slot = clip_len_ms / max(300, available_slot_ms)
                    natural_cap = 1.15
                    if needed_speed_for_slot > natural_cap:
                        needed_speed = min(1.35, needed_speed_for_slot)
                        logger.warning(
                            f"[TTS Timing] Câu #{orig_idx} phải ép giãn giọng tới {needed_speed:.2f}x "
                            f"(vượt ngưỡng tự nhiên {natural_cap}x) để tránh chồng tiếng với câu kế tiếp — "
                            f"nên rút ngắn kịch bản cho câu này."
                        )
                    else:
                        needed_speed = max(1.0, needed_speed_for_slot)
                    if needed_speed > 1.05:
                        speed_tmp = fpath + ".sp.mp3"
                        cmd_speed = [
                            "ffmpeg", "-y", "-i", fpath,
                            "-filter:a", f"atempo={needed_speed:.3f}",
                            "-vn", speed_tmp,
                        ]
                        res_sp = subprocess.run(cmd_speed, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        if res_sp.returncode == 0 and os.path.exists(speed_tmp):
                            try:
                                audio_clip = AudioSegment.from_file(speed_tmp).set_frame_rate(44100).set_channels(2)
                                clip_len_ms = len(audio_clip)
                            except Exception:
                                pass
                            finally:
                                if os.path.exists(speed_tmp):
                                    os.remove(speed_tmp)

                # 2. Căn khớp mốc thời gian start trên timeline
                # Ưu tiên tuyệt đối mốc xuất hiện của thị giác (orig_start_ms)
                start_ms = orig_start_ms
                if cursor_ms > 0 and start_ms < (cursor_ms + 40):
                    # Chỉ đẩy nhẹ nếu câu trước nói quá dài tràn sang câu sau
                    start_ms = cursor_ms + 40

                clip_end_ms = start_ms + clip_len_ms

                # Nối rộng master nếu audio vượt quá độ dài tạm tính
                if clip_end_ms > len(master):
                    master += AudioSegment.silent(
                        duration=(clip_end_ms - len(master) + 500),
                        frame_rate=44100,
                    ).set_channels(2)

                master = master.overlay(audio_clip, position=start_ms)
                cursor_ms = clip_end_ms

                # Cập nhật mốc start / end / duration thực tế để phụ đề SRT khớp 100% từng mili-giây
                seg["start"] = round(start_ms / 1000.0, 2)
                seg["end"] = round(clip_end_ms / 1000.0, 2)
                seg["duration"] = round(clip_len_ms / 1000.0, 2)

            # Cân chỉnh độ dài cuối cùng của master audio
            if calc_total_ms > len(master):
                master += AudioSegment.silent(
                    duration=(calc_total_ms - len(master)),
                    frame_rate=44100,
                ).set_channels(2)

            os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
            master.export(output_path, format="mp3", bitrate="192k")

            # Chuẩn hóa âm lượng EBU R128 (-14.0 LUFS) chuẩn TikTok/Reels
            norm_tmp = output_path + ".norm.mp3"
            norm_cmd = [
                "ffmpeg", "-y", "-i", output_path,
                "-af", "loudnorm=I=-14.0:TP=-1.0:LRA=7.0",
                "-c:a", "libmp3lame",
                "-b:a", "192k",
                norm_tmp,
            ]
            try:
                res_norm = subprocess.run(norm_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if res_norm.returncode == 0 and os.path.exists(norm_tmp) and os.path.getsize(norm_tmp) > 0:
                    os.replace(norm_tmp, output_path)
                elif os.path.exists(norm_tmp):
                    os.remove(norm_tmp)
            except Exception as norm_err:
                logger.warning(f"Lỗi chuẩn hóa âm lượng loudnorm: {norm_err}")

            return output_path

        await asyncio.to_thread(_assemble)
        return output_path


