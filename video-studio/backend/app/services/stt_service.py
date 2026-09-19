import os
from typing import List, Dict, Any, Optional
from faster_whisper import WhisperModel

_cached_model: Optional[WhisperModel] = None
_cached_model_size: str = ""


def get_whisper_model(model_size: str = "large-v3-turbo") -> WhisperModel:
    """Singleton helper để cache model Whisper trên RAM."""
    global _cached_model, _cached_model_size
    if _cached_model is None or _cached_model_size != model_size:
        # device='cpu', compute_type='int8' chạy nhẹ và mượt trên mọi máy Mac/Windows
        _cached_model = WhisperModel(model_size, device="cpu", compute_type="int8")
        _cached_model_size = model_size
    return _cached_model


def transcribe_chinese_audio(
    audio_path: str,
    model_size: str = "large-v3-turbo",
    language: str = "zh",
    prompt_hint: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Nhận diện giọng nói tiếng Trung và trích xuất danh sách các câu kèm mốc thời gian.
    Hỗ trợ linh hoạt mọi thể loại video: Bán hàng Affiliate, phim ảnh, hoạt hình, mẹo vặt đời thường.
    Dùng model large-v3-turbo (chính xác nhất, tốc độ hợp lý trên CPU).
    Tự động fallback: large-v3-turbo → medium → small nếu model nặng hơn gặp lỗi.
    """
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    # Fallback chain: thử từ model tốt nhất xuống dần nếu lỗi OOM hoặc không tải được
    FALLBACK_CHAIN = ["large-v3-turbo", "medium", "small"]
    start_idx = FALLBACK_CHAIN.index(model_size) if model_size in FALLBACK_CHAIN else 0

    last_err = None
    for attempt_model in FALLBACK_CHAIN[start_idx:]:
        try:
            model = get_whisper_model(attempt_model)
            break
        except Exception as e:
            last_err = e
            import logging
            logging.getLogger(__name__).warning(f"[STT] Không tải được model {attempt_model}: {e}. Thử model nhỏ hơn...")
    else:
        raise RuntimeError(f"Không thể tải bất kỳ Whisper model nào: {last_err}")

    # Không ép khuôn "普通话" (tiếng Phổ Thông chuẩn) để Whisper tự nhiên nhận diện được cả
    # tiếng địa phương, khẩu âm Đông Bắc, Tây Bắc, tiếng lóng Douyin và thoại trong nền nhạc lớn.
    eff_prompt = prompt_hint.strip() if prompt_hint and prompt_hint.strip() else None

    # Cấu hình VAD nhạy bén (min_silence_duration_ms=400ms, speech_pad_ms=180ms)
    # Giữ trọn âm đầu/cuối của từ khi nhạc nền to, ngắt câu chuẩn theo phân cảnh video
    segments, info = model.transcribe(
        audio_path,
        language=language,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=400, speech_pad_ms=180),
        word_timestamps=True,
        beam_size=5,
        best_of=3,
        temperature=0.0,
        condition_on_previous_text=False,
        initial_prompt=eff_prompt,
    )

    raw_splits = []
    for segment in segments:
        if not segment.words:
            t = segment.text.strip()
            if t:
                raw_splits.append({
                    "start": round(float(segment.start), 2),
                    "end": round(float(segment.end), 2),
                    "text": t,
                })
            continue

        # Tách nhỏ phân đoạn theo micro-timestamp từng từ nếu có khoảng lặng >= 0.75s giữa 2 từ
        # Điều này đảm bảo khi cảnh quay đổi (như ăn cơm -> tắm), câu thoại sẽ tách riêng biệt
        curr_words = []
        for w in segment.words:
            if not curr_words:
                curr_words.append(w)
                continue

            gap = float(w.start) - float(curr_words[-1].end)
            if gap >= 0.75:
                part_txt = "".join([cw.word for cw in curr_words]).strip()
                part_dur = float(curr_words[-1].end) - float(curr_words[0].start)
                # Lọc bỏ từ rác đơn lẻ siêu ngắn (<0.35s)
                if part_txt and not (len(part_txt) == 1 and part_dur < 0.35):
                    raw_splits.append({
                        "start": round(float(curr_words[0].start), 2),
                        "end": round(float(curr_words[-1].end), 2),
                        "text": part_txt,
                    })
                curr_words = [w]
            else:
                curr_words.append(w)

        if curr_words:
            part_txt = "".join([cw.word for cw in curr_words]).strip()
            part_dur = float(curr_words[-1].end) - float(curr_words[0].start)
            if part_txt and not (len(part_txt) == 1 and part_dur < 0.35):
                raw_splits.append({
                    "start": round(float(curr_words[0].start), 2),
                    "end": round(float(curr_words[-1].end), 2),
                    "text": part_txt,
                })

    # Ghép nối các từ đơn lẻ bị tách rời hoặc loại bỏ tạp âm cô lập
    merged_results: List[Dict[str, Any]] = []
    n_splits = len(raw_splits)
    for idx, item in enumerate(raw_splits):
        txt = item["text"].strip()
        dur = item["end"] - item["start"]

        # Lọc bỏ ký tự đơn lẻ cực ngắn (<0.38s) bị cô lập 2 đầu (>1.2s không có âm thanh)
        prev_gap = (item["start"] - raw_splits[idx - 1]["end"]) if idx > 0 else 999.0
        next_gap = (raw_splits[idx + 1]["start"] - item["end"]) if idx < n_splits - 1 else 999.0
        if len(txt) == 1 and dur < 0.38 and prev_gap > 1.2 and next_gap > 1.2:
            continue

        # Ghép nối từ ngắn (<= 2 chữ) đứng liền trước hoặc liền sau (gap <= 0.65s)
        if merged_results:
            prev = merged_results[-1]
            gap = item["start"] - prev["end"]
            if 0 <= gap <= 0.65 and (len(item["text"]) <= 2 or len(prev["text"]) <= 2):
                prev["end"] = item["end"]
                prev["duration"] = round(prev["end"] - prev["start"], 2)
                prev["text"] = prev["text"] + item["text"]
                continue

        item["duration"] = round(max(0.2, item["end"] - item["start"]), 2)
        item["id"] = len(merged_results)
        merged_results.append(item)

    return merged_results

