"""
OmniVoice Engine Manager — Zero-Shot TTS & Voice Cloning Service
Hỗ trợ đa nền tảng: macOS (Apple MPS), Windows (NVIDIA CUDA), CPU fallback.
Model: k2-fsa/OmniVoice via HuggingFace
"""

import json
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any

# Global safe optional imports for type checkers / linters
try:
    import torch  # type: ignore
except Exception:  # noqa: BLE001
    torch = None  # type: ignore

try:
    import numpy as np  # type: ignore
except Exception:  # noqa: BLE001
    np = None  # type: ignore

try:
    import soundfile as sf  # type: ignore
except Exception:  # noqa: BLE001
    sf = None  # type: ignore

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────
# Hardware Detection (Cross-Platform)
# ─────────────────────────────────────────────────────────────────

def get_target_device_and_dtype() -> tuple[str, Any]:
    """
    Phát hiện thiết bị tốt nhất có sẵn:
    - Windows + NVIDIA GPU  → cuda:0 / float16
    - macOS Apple Silicon   → mps / float16
    - CPU fallback          → cpu / float32
    """
    try:
        if torch is not None:
            if torch.cuda.is_available():
                logger.info("[OmniVoice] Detected NVIDIA CUDA — using cuda:0 float16")
                return "cuda:0", getattr(torch, "float16", None)
            if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                logger.info("[OmniVoice] Detected Apple MPS — using mps float16")
                return "mps", getattr(torch, "float16", None)
            return "cpu", getattr(torch, "float32", None)
        return "cpu", None
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[OmniVoice] torch device detection fallback to cpu: {e}")
        return "cpu", None


def _clear_gpu_cache() -> None:
    """Giải phóng bộ nhớ GPU sau khi inference."""
    try:
        if torch is not None:
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                torch.mps.empty_cache()
    except Exception as e:  # noqa: BLE001
        logger.debug(f"[OmniVoice] Clear cache exception: {e}")


# ─────────────────────────────────────────────────────────────────
# Audio Pre-processing Utilities
# ─────────────────────────────────────────────────────────────────

def convert_audio_to_ref_wav(input_path: str, output_path: str, max_seconds: int = 20) -> str:
    """
    Chuyển đổi bất kỳ file audio nào sang chuẩn OmniVoice:
    - Format: WAV mono, 24000 Hz
    - Độ dài: tối đa max_seconds giây
    Trả về đường dẫn file WAV đã chuyển đổi.
    """
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        input_path,
        "-ar",
        "24000",
        "-ac",
        "1",
        "-t",
        str(max_seconds),
        output_path,
    ]
    result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=False)
    if result.returncode != 0:
        raise RuntimeError(
            f"[OmniVoice] Audio conversion failed: {result.stderr.decode(errors='replace')}"
        )
    return output_path


def auto_transcribe_audio(audio_path: str) -> str:
    """
    Dùng faster-whisper nhận diện nội dung audio làm ref_text.
    Dùng khi người dùng không cung cấp transcript.
    """
    try:
        from faster_whisper import WhisperModel  # type: ignore

        model: Any = WhisperModel("base", device="cpu", compute_type="int8")
        segments, _ = model.transcribe(audio_path, beam_size=3)
        return " ".join(seg.text.strip() for seg in segments).strip()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[OmniVoice] Whisper transcription skipped: {e}")
        return ""


# ─────────────────────────────────────────────────────────────────
# OmniVoice Singleton Engine Manager
# ─────────────────────────────────────────────────────────────────

class OmniVoiceEngineManager:
    """
    Singleton quản lý model OmniVoice.
    Lazy-loading: chỉ nạp model khi lần đầu tiên được gọi.
    Thread-safe với Lock.
    """

    _instance: Any = None
    _class_lock: threading.Lock = threading.Lock()
    _model: Any = None
    _inference_lock: threading.Lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._class_lock:
                if cls._instance is None:
                    inst = super().__new__(cls)
                    inst._model = None
                    inst._inference_lock = threading.Lock()
                    cls._instance = inst
        return cls._instance

    def _get_model(self) -> Any:
        """Lazy-load OmniVoice model. Thread-safe."""
        if self._model is None:
            logger.info("[OmniVoice] Loading model from k2-fsa/OmniVoice ...")
            from omnivoice import OmniVoice  # type: ignore

            device, _ = get_target_device_and_dtype()
            try:
                self._model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map=device)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"[OmniVoice] Failed to load on {device} ({e}), falling back to CPU")
                self._model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map="cpu")
            logger.info(f"[OmniVoice] Model loaded on device={device}")
        return self._model

    def synthesize_to_file(
        self,
        text: str,
        output_path: str,
        ref_audio_path: str | None = None,
        ref_text: str | None = None,
        speed: float = 1.0,
        instruct: str | None = None,
    ) -> str:
        """
        Tổng hợp giọng nói và lưu ra file.

        Có 2 chế độ:
        1. Voice Clone:  truyền ref_audio_path (+ tuỳ chọn ref_text)
        2. Instruct TTS: truyền instruct (mô tả phong cách giọng đọc)
        """
        if not text.strip():
            raise ValueError("[OmniVoice] text không được để trống")

        output_path = str(output_path)
        out_dir = os.path.dirname(output_path)
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)

        with self._inference_lock:
            model_inst: Any = self._get_model()
            if model_inst is None:
                raise RuntimeError("[OmniVoice] Không thể khởi tạo model OmniVoice")
            generate_fn: Any = getattr(model_inst, "generate")  # noqa: B009

            try:
                if ref_audio_path and os.path.exists(ref_audio_path):
                    # ── Chế độ Voice Clone ──────────────────────────────
                    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                        tmp_ref = tmp.name
                    try:
                        convert_audio_to_ref_wav(ref_audio_path, tmp_ref)
                        actual_ref_text = ref_text
                        if not actual_ref_text:
                            logger.info("[OmniVoice] Auto-transcribing reference audio ...")
                            actual_ref_text = auto_transcribe_audio(tmp_ref)

                        logger.info(f"[OmniVoice] Voice Clone: '{text[:60]}'")
                        audios = generate_fn(
                            text=text,
                            language="Vietnamese",
                            ref_audio=tmp_ref,
                            ref_text=actual_ref_text or None,
                        )
                    finally:
                        if os.path.exists(tmp_ref):
                            os.unlink(tmp_ref)

                elif instruct:
                    # ── Chế độ Instruct TTS ─────────────────────────────
                    logger.info(f"[OmniVoice] Instruct TTS: '{instruct}' for '{text[:60]}'")
                    audios = generate_fn(
                        text=text,
                        language="Vietnamese",
                        instruct=instruct,
                    )
                else:
                    logger.info(f"[OmniVoice] Auto TTS for '{text[:60]}'")
                    audios = generate_fn(
                        text=text,
                        language="Vietnamese",
                    )

                sample_rate = getattr(model_inst, "sampling_rate", 24000)
                self._save_audio(audios, output_path, sample_rate)
                return output_path

            finally:
                _clear_gpu_cache()

    def _save_audio(self, audio: Any, output_path: str, sample_rate: int = 24000) -> None:
        """Lưu numpy/tensor audio ra file WAV hoặc MP3."""
        if isinstance(audio, (list, tuple)):
            if len(audio) > 0:
                audio = audio[0]
            elif np is not None:
                audio = np.zeros(1, dtype=np.float32)
            else:
                audio = [0.0]

        try:
            audio_any: Any = audio
            if hasattr(audio_any, "cpu") and callable(getattr(audio_any, "cpu", None)):
                audio_np = audio_any.cpu().numpy()
            elif np is not None:
                audio_np = np.array(audio_any, dtype=np.float32)
            else:
                audio_np = audio_any
        except Exception:  # noqa: BLE001
            audio_np = np.array(audio, dtype=np.float32) if np is not None else audio

        if output_path.lower().endswith(".mp3"):
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp_wav = tmp.name
            try:
                if sf is not None:
                    sf.write(tmp_wav, audio_np, sample_rate)
                cmd = [
                    "ffmpeg",
                    "-y",
                    "-i",
                    tmp_wav,
                    "-codec:a",
                    "libmp3lame",
                    "-b:a",
                    "192k",
                    output_path,
                ]
                res = subprocess.run(
                    cmd,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    check=False,
                )
                if res.returncode != 0:
                    raise RuntimeError(f"FFmpeg MP3 error: {res.stderr.decode(errors='replace')}")
            finally:
                if os.path.exists(tmp_wav):
                    os.unlink(tmp_wav)
        else:
            if sf is not None:
                sf.write(output_path, audio_np, sample_rate)


# ─────────────────────────────────────────────────────────────────
# Custom Voice Registry (Persistent JSON Storage)
# ─────────────────────────────────────────────────────────────────

def get_custom_voices_dir() -> Path:
    """Trả về thư mục lưu giọng tùy ý. Portable — không dùng absolute path cứng."""
    base = Path(__file__).resolve().parent.parent.parent / "storage" / "custom_voices"
    base.mkdir(parents=True, exist_ok=True)
    return base


def get_registry_path() -> Path:
    return get_custom_voices_dir() / "registry.json"


def load_registry() -> list[dict[str, Any]]:
    """Nạp danh sách giọng custom từ registry.json."""
    p = get_registry_path()
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            return []
    return []


def save_registry(voices: list[dict[str, Any]]) -> None:
    """Ghi danh sách giọng custom ra registry.json."""
    p = get_registry_path()
    p.write_text(json.dumps(voices, ensure_ascii=False, indent=2), encoding="utf-8")


def add_custom_voice(
    name: str,
    gender: str,
    ref_audio_bytes: bytes,
    ref_audio_filename: str,
    ref_text: str | None = None,
    engine: str = "omnivoice",
) -> dict[str, Any]:
    """
    Tạo một giọng tùy ý mới từ audio mẫu.
    1. Lưu file audio gốc
    2. Chuyển đổi sang ref.wav chuẩn
    3. Auto-transcribe nếu thiếu ref_text (bỏ qua với engine="vieneu" — VieNeu-TTS không cần ref_text)
    4. Sinh sample.mp3 nghe thử bằng engine tương ứng (OmniVoice hoặc VieNeu-TTS)
    5. Đăng ký vào registry.json
    """
    engine = engine if engine in ("omnivoice", "vieneu") else "omnivoice"

    voice_id = f"custom_{uuid.uuid4().hex[:8]}"
    voice_dir = get_custom_voices_dir() / voice_id
    voice_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(ref_audio_filename).suffix.lower() or ".wav"
    raw_path = voice_dir / f"original{suffix}"
    raw_path.write_bytes(ref_audio_bytes)

    ref_wav_path = voice_dir / "ref.wav"
    convert_audio_to_ref_wav(str(raw_path), str(ref_wav_path))

    # VieNeu-TTS nhân bản tức thì không cần ref_text (không dùng auto-transcribe ASR)
    actual_ref_text = ref_text
    if engine == "omnivoice" and not actual_ref_text:
        actual_ref_text = auto_transcribe_audio(str(ref_wav_path))

    if actual_ref_text:
        (voice_dir / "ref_text.txt").write_text(actual_ref_text, encoding="utf-8")

    # Sinh sample audio nghe thử
    sample_path = voice_dir / "sample.mp3"
    sample_text = (
        "Xin chào! Đây là giọng đọc mẫu do bạn tạo ra với công nghệ nhân bản giọng nói AI. "
        "Giọng đọc tự nhiên, sắc sảo và đầy biểu cảm."
    )
    try:
        if engine == "vieneu":
            from app.services.vieneu_tts_service import _vieneu_manager
            _vieneu_manager.synthesize_to_file(
                text=sample_text,
                output_path=str(sample_path),
                ref_audio_path=str(ref_wav_path),
            )
            logger.info(f"[VieNeu-TTS] Sample generated: {sample_path}")
        else:
            manager = OmniVoiceEngineManager()
            manager.synthesize_to_file(
                text=sample_text,
                output_path=str(sample_path),
                ref_audio_path=str(ref_wav_path),
                ref_text=actual_ref_text or None,
            )
            logger.info(f"[OmniVoice] Sample generated: {sample_path}")
    except Exception as e:  # noqa: BLE001
        logger.error(f"[{engine}] Failed to generate sample for {voice_id}: {e}")

    voice_item = {
        "id": voice_id,
        "name": name,
        "gender": gender,
        "engine": engine,
        "is_custom": True,
        "description": f"Giọng tùy ý: {name}",
        "ref_audio": str(ref_wav_path),
        "ref_text": actual_ref_text or "",
        "sample_url": f"/api/storage/custom_voices/{voice_id}/sample.mp3",
        "region": "Tùy Chỉnh",
        "is_default": False,
    }
    registry = load_registry()
    registry.append(voice_item)
    save_registry(registry)
    return voice_item


def delete_custom_voice(voice_id: str) -> bool:
    """Xóa giọng tùy ý: xóa file và entry trong registry."""
    registry = load_registry()
    new_registry = [v for v in registry if v["id"] != voice_id]
    if len(new_registry) == len(registry):
        return False

    voice_dir = get_custom_voices_dir() / voice_id
    if voice_dir.exists():
        shutil.rmtree(voice_dir, ignore_errors=True)

    save_registry(new_registry)
    return True


def get_custom_voice_by_id(voice_id: str) -> dict[str, Any] | None:
    """Lấy thông tin giọng custom theo ID."""
    for v in load_registry():
        if v["id"] == voice_id:
            return v
    return None


# Global singleton
_omnivoice_manager = OmniVoiceEngineManager()
