"""
VieNeu-TTS Engine Manager — Vietnamese Open-Source TTS (Preset Voices Only)
Repo: https://github.com/pnnbao97/VieNeu-TTS (Apache 2.0), SDK: pip install vieneu

Cung cấp 25 giọng đọc preset tiếng Việt (Bắc/Trung/Nam) — lấy động từ SDK (không hard-code
tên giọng để tránh sai lệch khi thư viện cập nhật danh sách) và hỗ trợ emotion cues ngay
trong văn bản: [cười], [thở dài], [hắng giọng].
"""

import json
import logging
import os
import re
import subprocess
import tempfile
import threading
import unicodedata
from pathlib import Path
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)

try:
    from vieneu import Vieneu  # type: ignore
except Exception:  # noqa: BLE001
    Vieneu = None  # type: ignore


def _slugify(text: str) -> str:
    """Chuyển tên giọng (có dấu tiếng Việt) thành id an toàn, vd 'Minh Quân Pro' -> 'minh_quan_pro'."""
    # Đ/đ không tách được dấu qua NFKD (là ký tự gốc riêng, không phải D + dấu kết hợp) nên xử lý thủ công
    # trước, tránh bị rớt hẳn khỏi id (vd 'Đức Trí' phải ra 'duc_tri', không phải 'uc_tri').
    text = text.replace("Đ", "D").replace("đ", "d")
    normalized = unicodedata.normalize("NFKD", text)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", ascii_only).strip("_").lower()
    return slug or "voice"


def _parse_preset_label(label: str) -> tuple[str, str, str]:
    """
    Phân tích label preset của VieNeu-TTS, dạng: '⭐ Adam bựa — Nam · Bắc · Phong cách tự nhiên'
    Trả về (gender, region, style) theo đúng quy ước Male/Female và 'Miền Bắc/Trung/Nam' đang dùng
    trong hệ thống. Nếu không khớp định dạng (SDK đổi format sau này), trả về giá trị mặc định an toàn.
    """
    match = re.search(r"—\s*(Nam|Nữ)\s*·\s*(Bắc|Trung|Nam)\s*·\s*(.+)$", label)
    if not match:
        return "Male", "Việt Nam", ""

    gender_raw, region_raw, style_raw = match.groups()
    gender = "Female" if gender_raw == "Nữ" else "Male"
    region = f"Miền {region_raw}"
    return gender, region, style_raw.strip()


def _presets_cache_path() -> Path:
    p = Path(settings.STORAGE_DIR).parent / "vieneu_presets_cache.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


class VieNeuEngineManager:
    """
    Singleton quản lý model VieNeu-TTS.
    Lazy-loading: chỉ nạp model (Vieneu()) khi lần đầu tiên cần sinh audio hoặc liệt kê preset.
    Thread-safe với Lock.
    """

    _instance: Any = None
    _class_lock: threading.Lock = threading.Lock()
    _engine: Any = None
    _inference_lock: threading.Lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._class_lock:
                if cls._instance is None:
                    inst = super().__new__(cls)
                    inst._engine = None
                    inst._inference_lock = threading.Lock()
                    cls._instance = inst
        return cls._instance

    def _get_engine(self) -> Any:
        """Lazy-load engine VieNeu-TTS (mặc định v3 Turbo, 48kHz). Thread-safe."""
        if self._engine is None:
            if Vieneu is None:
                raise RuntimeError(
                    "Thư viện 'vieneu' chưa được cài đặt. Cài bằng lệnh: pip install vieneu"
                )
            logger.info("[VieNeu-TTS] Đang nạp model VieNeu-TTS (lần đầu có thể mất vài chục giây)...")
            try:
                self._engine = Vieneu()
                logger.info("[VieNeu-TTS] Model đã sẵn sàng.")
            except Exception as e:  # noqa: BLE001
                logger.error(f"[VieNeu-TTS] Lỗi nạp model: {e}")
                raise RuntimeError(f"[VieNeu-TTS] Không thể khởi tạo model: {e}")
        return self._engine

    def list_preset_voices(self, force_refresh: bool = False) -> list[dict[str, Any]]:
        """
        Trả về danh sách giọng preset dạng chuẩn của hệ thống:
        [{"id": "vieneu_minh_quan_pro", "name": "Minh Quân Pro (VieNeu-TTS)",
          "voice_name": "Minh Quân Pro", "engine": "vieneu", ...}, ...]
        Kết quả được cache ra file JSON để tránh phải nạp lại model chỉ để liệt kê tên giọng.
        """
        cache_path = _presets_cache_path()
        if not force_refresh and cache_path.exists():
            try:
                cached = json.loads(cache_path.read_text(encoding="utf-8"))
                if isinstance(cached, list) and cached:
                    return cached
            except Exception as e:  # noqa: BLE001
                logger.warning(f"[VieNeu-TTS] Cache preset lỗi, sẽ nạp lại: {e}")

        try:
            engine = self._get_engine()
            raw_voices = engine.list_preset_voices()
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[VieNeu-TTS] Không thể lấy danh sách giọng preset: {e}")
            return []

        items: list[dict[str, Any]] = []
        for entry in raw_voices:
            try:
                label, voice_id = entry
            except Exception:  # noqa: BLE001
                label, voice_id = str(entry), str(entry)

            gender, region, style = _parse_preset_label(str(label))
            description = "Giọng preset VieNeu-TTS — mã nguồn mở, chạy offline, hỗ trợ emotion cues."
            if style:
                description = f"{style}. {description}"

            items.append({
                "id": f"vieneu_{_slugify(str(voice_id))}",
                "name": f"{voice_id} (VieNeu-TTS)",
                "voice_name": str(voice_id),
                "gender": gender,
                "region": region,
                "description": description,
                "engine": "vieneu",
                "is_default": False,
            })

        try:
            cache_path.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[VieNeu-TTS] Không thể ghi cache preset: {e}")

        return items

    def synthesize_to_file(
        self,
        text: str,
        output_path: str,
        voice: str,
        speed: float = 1.0,
    ) -> str:
        """Tổng hợp giọng nói VieNeu-TTS (giọng preset) và lưu ra file."""
        if not text.strip():
            raise ValueError("[VieNeu-TTS] text không được để trống")
        if not voice:
            raise ValueError("[VieNeu-TTS] Cần truyền 'voice' (tên giọng preset)")

        output_path = str(output_path)
        out_dir = os.path.dirname(output_path)
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)

        with self._inference_lock:
            engine = self._get_engine()

            try:
                logger.info(f"[VieNeu-TTS] Đang sinh audio giọng '{voice}' cho: '{text[:60]}...'")
                audio = engine.infer(text, voice=voice)
            except Exception as e:  # noqa: BLE001
                logger.error(f"[VieNeu-TTS] Lỗi sinh audio: {e}")
                raise RuntimeError(f"[VieNeu-TTS] Lỗi sinh audio: {e}")

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp_wav = tmp.name
            try:
                engine.save(audio, tmp_wav)
            except Exception as e:  # noqa: BLE001
                logger.error(f"[VieNeu-TTS] Lỗi lưu audio tạm: {e}")
                raise RuntimeError(f"[VieNeu-TTS] Lỗi lưu audio tạm: {e}")

            try:
                cmd = ["ffmpeg", "-y", "-i", tmp_wav]
                if abs(speed - 1.0) > 0.03:
                    clamped_speed = max(0.5, min(2.0, speed))
                    cmd.extend(["-filter:a", f"atempo={clamped_speed:.3f}"])
                    logger.info(f"[VieNeu-TTS] Time-stretch atempo={clamped_speed:.3f}")

                if output_path.lower().endswith(".mp3"):
                    cmd.extend(["-codec:a", "libmp3lame", "-b:a", "192k"])
                cmd.extend(["-ar", "44100", "-ac", "2", output_path])

                res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=False)
                if res.returncode != 0:
                    raise RuntimeError(f"FFmpeg lỗi: {res.stderr.decode(errors='replace')[:300]}")
            except Exception as e:  # noqa: BLE001
                logger.error(f"[VieNeu-TTS] Lỗi chuyển đổi/time-stretch FFmpeg: {e}")
                raise RuntimeError(f"[VieNeu-TTS] Lỗi FFmpeg: {e}")
            finally:
                if os.path.exists(tmp_wav):
                    os.remove(tmp_wav)

        return output_path


# Global singleton — tái sử dụng model đã nạp giữa các lần gọi
_vieneu_manager = VieNeuEngineManager()


def is_vieneu_available() -> bool:
    """Kiểm tra nhanh (không tốn chi phí) xem thư viện vieneu đã được cài chưa."""
    return Vieneu is not None


def get_vieneu_preset_voices() -> list[dict[str, Any]]:
    """
    Entry point an toàn dùng cho get_available_voices(): trả về [] ngay lập tức nếu
    thư viện 'vieneu' chưa được cài, không kích hoạt nạp model.
    """
    if not is_vieneu_available():
        return []
    try:
        return _vieneu_manager.list_preset_voices()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[VieNeu-TTS] Không thể liệt kê giọng preset: {e}")
        return []


def get_preset_voice_name_map() -> dict[str, str]:
    """Map id nội bộ (vieneu_xxx) -> voice_name gốc dùng để gọi engine.infer(voice=...)."""
    return {v["id"]: v["voice_name"] for v in get_vieneu_preset_voices()}
