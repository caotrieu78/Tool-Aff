import os
from typing import List, Dict, Any, Optional
from faster_whisper import WhisperModel

_cached_model: Optional[WhisperModel] = None
_cached_model_size: str = ""


def get_whisper_model(model_size: str = "base") -> WhisperModel:
    """Singleton helper để cache model Whisper trên RAM."""
    global _cached_model, _cached_model_size
    if _cached_model is None or _cached_model_size != model_size:
        # device='cpu', compute_type='int8' chạy rất nhẹ và mượt trên mọi máy Mac/Windows
        _cached_model = WhisperModel(model_size, device="cpu", compute_type="int8")
        _cached_model_size = model_size
    return _cached_model


def transcribe_chinese_audio(
    audio_path: str,
    model_size: str = "base",
    language: str = "zh",
) -> List[Dict[str, Any]]:
    """
    Nhận diện giọng nói tiếng Trung và trích xuất danh sách các câu kèm mốc thời gian.
    """
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    model = get_whisper_model(model_size)
    segments, info = model.transcribe(
        audio_path,
        language=language,
        vad_filter=True,  # Tự động lọc bỏ các đoạn im lặng
        beam_size=5,
    )

    results = []
    for i, segment in enumerate(segments):
        text = segment.text.strip()
        if not text:
            continue
        results.append({
            "id": i,
            "start": round(segment.start, 2),
            "end": round(segment.end, 2),
            "duration": round(segment.end - segment.start, 2),
            "text": text,
        })

    return results
