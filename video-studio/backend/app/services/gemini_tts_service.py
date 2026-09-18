import asyncio
import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import httpx
from app.core.config import settings

logger = logging.getLogger(__name__)

KIE_CREATE_TASK_URL = "https://api.kie.ai/api/v1/jobs/createTask"
KIE_RECORD_INFO_URL = "https://api.kie.ai/api/v1/jobs/recordInfo"

# Danh sách 30 giọng chuẩn của Gemini 2.5 Pro TTS
GEMINI_VOICE_NAMES: dict[str, str] = {
    # Nữ (14)
    "achernar": "Achernar",
    "aoede": "Aoede",
    "autonoe": "Autonoe",
    "callirrhoe": "Callirrhoe",
    "despina": "Despina",
    "erinome": "Erinome",
    "gacrux": "Gacrux",
    "kore": "Kore",
    "laomedeia": "Laomedeia",
    "leda": "Leda",
    "pulcherrima": "Pulcherrima",
    "sulafat": "Sulafat",
    "vindemiatrix": "Vindemiatrix",
    "zephyr": "Zephyr",
    # Nam (16)
    "achird": "Achird",
    "algenib": "Algenib",
    "algieba": "Algieba",
    "alnilam": "Alnilam",
    "charon": "Charon",
    "enceladus": "Enceladus",
    "fenrir": "Fenrir",
    "iapetus": "Iapetus",
    "orus": "Orus",
    "puck": "Puck",
    "rasalgethi": "Rasalgethi",
    "sadachbia": "Sadachbia",
    "sadaltager": "Sadaltager",
    "schedar": "Schedar",
    "umbriel": "Umbriel",
    "zubenelgenubi": "Zubenelgenubi",
}


def normalize_gemini_voice_name(voice_id: str) -> str:
    """Chuẩn hóa ID giọng (vd: 'gemini_zephyr', 'gemini-Zephyr', 'Zephyr') sang tên chuẩn của API Kie.ai."""
    clean = voice_id.strip()
    if clean.lower().startswith("gemini_"):
        clean = clean[7:]
    elif clean.lower().startswith("gemini-"):
        clean = clean[7:]

    clean_lower = clean.lower()
    if clean_lower in GEMINI_VOICE_NAMES:
        return GEMINI_VOICE_NAMES[clean_lower]

    # Mặc định fallback
    return clean.capitalize() if clean else "Zephyr"


async def get_active_kie_api_key() -> str:
    """Lấy API Key Kie.ai hợp lệ từ settings hoặc GeminiKeyPool trong Database."""
    # 1. Kiểm tra settings/môi trường trước
    if getattr(settings, "KIE_API_KEY", None) and str(settings.KIE_API_KEY).strip():
        return str(settings.KIE_API_KEY).strip()

    # 2. Truy vấn từ bảng gemini_api_keys trong SQLite
    try:
        from app.core.crypto import decrypt_value
        from app.core.db import AsyncSessionLocal
        from app.models.gemini_key import GeminiApiKey, GeminiKeyStatus
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            # Ưu tiên key có provider là kie và đang active
            stmt = (
                select(GeminiApiKey)
                .where(GeminiApiKey.is_active == True)
                .where(GeminiApiKey.status != GeminiKeyStatus.error)
                .order_by(
                    (GeminiApiKey.provider == "kie").desc(),
                    GeminiApiKey.is_default.desc(),
                    GeminiApiKey.id.desc(),
                )
            )
            res = await db.execute(stmt)
            keys = res.scalars().all()
            for k in keys:
                decrypted = decrypt_value(str(k.api_key_encrypted)).strip()
                if decrypted:
                    return decrypted
    except Exception as e:
        logger.warning(f"[Gemini TTS] Không thể lấy key từ DB: {e}")

    raise RuntimeError(
        "Chưa cấu hình API Key Kie.ai nào trong hệ thống! "
        "Vui lòng vào Cài Đặt Hệ Thống -> Gemini Key Pool để thêm Key Kie.ai."
    )


async def synthesize_gemini_tts_file(
    text: str,
    output_path: str,
    voice: str = "gemini_zephyr",
    speed: float = 1.0,
    api_key: str | None = None,
) -> str:
    """
    Tạo file audio MP3 từ văn bản bằng Google Gemini 2.5 Pro Preview TTS qua Kie.ai.
    Endpoint: https://api.kie.ai/api/v1/jobs/createTask
    Model: google/gemini-2-5-pro-tts
    """
    if not text.strip():
        raise ValueError("Văn bản chuyển đổi giọng nói không được để trống")

    if not api_key:
        api_key = await get_active_kie_api_key()

    voice_name = normalize_gemini_voice_name(voice)
    logger.info(f"🎙️ [Gemini TTS] Đang tạo giọng đọc '{voice_name}' cho: {text[:60]}...")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": "google/gemini-2-5-pro-tts",
        "input": {
            "speakers": [
                {
                    "speaker_id": "Speaker 1",
                    "voice_name": voice_name,
                    "audio_profile": "",
                    "style": "",
                    "pace": "Natural",
                    "accent": "Neutral",
                }
            ],
            "dialogue_turns": [
                {
                    "speaker_id": "Speaker 1",
                    "text": text.strip(),
                }
            ],
            "temperature": 1,
            "scene": "",
            "sample_context": "",
        },
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        # 1. Gửi tác vụ tạo audio
        res = await client.post(KIE_CREATE_TASK_URL, headers=headers, json=payload)
        if res.status_code != 200:
            raise RuntimeError(f"Kie.ai createTask lỗi HTTP {res.status_code}: {res.text[:200]}")

        create_data = res.json()
        if create_data.get("code") not in (200, 0):
            err_msg = create_data.get("msg") or create_data.get("message") or "Unknown error"
            raise RuntimeError(f"Kie.ai createTask trả về lỗi: {err_msg}")

        task_id = create_data.get("data", {}).get("taskId")
        if not task_id:
            raise RuntimeError(f"Kie.ai không trả về taskId: {res.text[:200]}")

        # 2. Polling kiểm tra kết quả qua recordInfo (tối ưu độ trễ nhận diện kết quả nhanh nhất)
        audio_url: str | None = None
        max_attempts = 50
        for attempt in range(max_attempts):
            poll_interval = 0.8 if attempt < 4 else (1.2 if attempt < 10 else 1.5)
            await asyncio.sleep(poll_interval)
            poll_res = await client.get(
                f"{KIE_RECORD_INFO_URL}?taskId={task_id}",
                headers=headers,
            )
            if poll_res.status_code != 200:
                continue

            poll_data = poll_res.json()
            task_info = poll_data.get("data", {})
            state = str(task_info.get("state", "")).lower()

            if state == "success":
                # Trích xuất URL audio
                resp_obj = task_info.get("response") or {}
                urls = resp_obj.get("resultUrls") or []
                if not urls and task_info.get("resultJson"):
                    try:
                        r_json = json.loads(task_info["resultJson"])
                        urls = r_json.get("resultUrls", [])
                    except Exception:
                        pass
                if urls and isinstance(urls, list) and len(urls) > 0:
                    audio_url = urls[0]
                    break
            elif state in ("failed", "fail", "error"):
                fail_msg = task_info.get("failMsg") or task_info.get("failCode") or "Tạo âm thanh thất bại"
                raise RuntimeError(f"Kie.ai TTS task {task_id} thất bại: {fail_msg}")

        if not audio_url:
            raise TimeoutError(f"Kie.ai TTS task {task_id} quá thời gian chờ (hơn 60s)")

        # 3. Tải file âm thanh về và chuẩn hóa MP3 192k (kèm điều tốc nếu speed != 1.0)
        audio_resp = await client.get(audio_url)
        if audio_resp.status_code != 200 or len(audio_resp.content) < 500:
            raise RuntimeError(f"Không thể tải file âm thanh từ URL {audio_url} (HTTP {audio_resp.status_code})")

        output_dir = os.path.dirname(os.path.abspath(output_path))
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file:
            tmp_wav_path = tmp_file.name
            tmp_file.write(audio_resp.content)

        try:
            # Xây dựng lệnh FFmpeg chuyển đổi chuẩn MP3 192k stereo
            cmd = ["ffmpeg", "-y", "-i", tmp_wav_path]
            filters = []
            if abs(speed - 1.0) > 0.03:
                # Giới hạn atempo hợp lệ của FFmpeg từ 0.5 đến 2.0
                clamped_speed = max(0.5, min(2.0, speed))
                filters.append(f"atempo={clamped_speed:.3f}")

            if filters:
                cmd.extend(["-filter:a", ",".join(filters)])

            cmd.extend([
                "-codec:a", "libmp3lame",
                "-b:a", "192k",
                "-ar", "44100",
                "-ac", "2",
                output_path,
            ])

            res_ffmpeg = await asyncio.to_thread(
                subprocess.run,
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                check=False,
            )
            if res_ffmpeg.returncode != 0:
                logger.warning(f"FFmpeg conversion warning: {res_ffmpeg.stderr.decode()[:150]}")
                with open(output_path, "wb") as f_out:
                    f_out.write(audio_resp.content)
        finally:
            if os.path.exists(tmp_wav_path):
                os.remove(tmp_wav_path)

        logger.info(f"✅ [Gemini TTS] Đã xuất file thành công: {output_path}")
        return output_path
