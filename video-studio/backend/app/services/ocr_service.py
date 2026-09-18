import os
import re
import cv2
import logging
from typing import List, Dict, Any
import difflib

logger = logging.getLogger(__name__)

_cached_ocr_reader = None


def get_ocr_reader():
    """Singleton lazy-loader cho EasyOCR Reader (tiếng Trung giản thể + tiếng Anh)."""
    global _cached_ocr_reader
    if _cached_ocr_reader is None:
        import easyocr
        # Chạy CPU mượt mà với int8/float32
        _cached_ocr_reader = easyocr.Reader(["ch_sim", "en"], gpu=False)
    return _cached_ocr_reader


def text_similarity(s1: str, s2: str) -> float:
    """Đo độ tương đồng giữa 2 chuỗi text để gom cụm các frame cùng một câu phụ đề."""
    s1 = "".join(s1.split()).lower()
    s2 = "".join(s2.split()).lower()
    if not s1 or not s2:
        return 0.0
    if s1 in s2 or s2 in s1:
        return 0.85
    return difflib.SequenceMatcher(None, s1, s2).ratio()


def detect_hardcoded_subtitle_bbox_ocr(
    video_path: str,
    max_frames: int = 10,
    sub_top_ratio: float = 0.55,
    sub_bottom_ratio: float = 0.95,
) -> Dict[str, Any]:
    """
    Tự động quét và nhận diện chính xác toạ độ Y (tâm & dải bao) của phụ đề gốc bằng OCR:
    - Quét 8-10 frame phân bổ đều video.
    - Tìm bounding box các dòng phụ đề chữ cứng (tiếng Trung, tiếng Anh hoặc cụm từ dài).
    - Đo toạ độ Y thực tế để phụ đề tiếng Việt có thể đè chính xác 100% lên vị trí phụ đề gốc.
    """
    default_res = {
        "has_subtitle": False,
        "y_center_ratio": 0.8425,
        "y_center": 0,
        "blur_y": 0,
        "blur_h": 0,
    }
    if not os.path.exists(video_path):
        return default_res

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return default_res

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    video_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if total_frames <= 0 or video_h <= 0:
        cap.release()
        return default_res

    y1 = max(0, int(video_h * sub_top_ratio))
    y2 = min(video_h, int(video_h * sub_bottom_ratio))

    reader = get_ocr_reader()
    step = max(1, total_frames // (max_frames + 1))
    sample_indices = [step * i for i in range(1, max_frames + 1) if step * i < total_frames]

    detected_y_centers = []
    detected_heights = []

    for idx in sample_indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()
        if not ret or frame is None:
            continue
        crop = frame[y1:y2, :]
        try:
            results = reader.readtext(crop)
            for item in results:
                bbox, text, conf = item
                clean_t = str(text).strip()
                try:
                    conf_val = float(conf)
                except (ValueError, TypeError):
                    conf_val = 0.0

                has_chinese = bool(re.search(r"[\u4e00-\u9fff]", clean_t))
                has_phrase = len(clean_t.split()) >= 3 and len(clean_t) >= 8

                if conf_val >= 0.25 and (has_chinese or has_phrase):
                    pts_y = [int(pt[1]) for pt in bbox]
                    box_y1 = min(pts_y) + int(y1)
                    box_y2 = max(pts_y) + int(y1)
                    box_h = box_y2 - box_y1
                    box_center_y = (box_y1 + box_y2) / 2.0
                    detected_y_centers.append(box_center_y)
                    detected_heights.append(box_h)
        except Exception:
            pass

    cap.release()

    if not detected_y_centers:
        default_res["y_center"] = int(round(video_h * 0.8425))
        default_res["blur_h"] = int(round(video_h * 0.09))
        default_res["blur_y"] = max(0, int(round(default_res["y_center"] - default_res["blur_h"] / 2)))
        return default_res

    # Tính toạ độ trung bình của phụ đề gốc
    avg_y_center = sum(detected_y_centers) / len(detected_y_centers)
    avg_h = sum(detected_heights) / len(detected_heights)
    y_center_ratio = round(avg_y_center / video_h, 4)

    # Chiều cao dải mờ bao phủ phụ đề cũ kèm biên độ an toàn
    blur_h = max(int(round(video_h * 0.085)), int(round(avg_h * 1.75)))
    blur_y = max(0, int(round(avg_y_center - blur_h / 2.0)))

    return {
        "has_subtitle": True,
        "y_center_ratio": y_center_ratio,
        "y_center": int(round(avg_y_center)),
        "blur_y": blur_y,
        "blur_h": blur_h,
    }


def check_video_has_hardcoded_subtitles(
    video_path: str,
    max_frames: int = 8,
    sub_top_ratio: float = 0.65,
    sub_bottom_ratio: float = 0.95,
) -> bool:
    """
    Kiểm tra nhanh xem video có chứa phụ đề chữ cứng gốc ở vùng dưới hay không.
    Lấy mẫu 6-8 khung hình phân bổ đều toàn bộ video:
    - Nếu có phụ đề tiếng Trung hoặc câu chữ phụ đề rõ ràng -> Trả về True (< 0.5s).
    - Nếu toàn bộ các khung hình đều không có phụ đề -> Trả về False (video sạch, không sub).
    """
    detected = detect_hardcoded_subtitle_bbox_ocr(video_path, max_frames=max_frames)
    return detected.get("has_subtitle", False)


def extract_subtitles_from_video_ocr(
    video_path: str,
    sample_fps: float = 2.0,            # 2 frame/giây (mỗi 0.5s lấy mẫu 1 lần)
    sub_top_ratio: float = 0.55,        # Quét từ 55% chiều cao khung hình trở xuống
    sub_bottom_ratio: float = 0.96,     # Đến 96% chiều cao khung hình
    min_confidence: float = 0.22,       # Ngưỡng tin cậy tối thiểu
) -> List[Dict[str, Any]]:
    """
    Quét và trích xuất phụ đề chữ cứng trên khung hình video bằng EasyOCR:
    1. Trích xuất frame theo chu kỳ 0.5s.
    2. Cắt riêng dải phụ đề đáy màn hình để tối ưu tốc độ x4 lần.
    3. Nhận diện các ký tự tiếng Trung.
    4. Gom cụm các frame liên tiếp có nội dung tương đồng thành các câu [start -> end].
    """
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video file: {video_path}")

    video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    video_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    video_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_duration = total_frames / video_fps if video_fps > 0 else 0.0

    # Video dài quét cố định sample_fps=2.0 (2 khung/giây) sẽ tốn hàng nghìn lượt OCR CPU, mất rất lâu.
    # Tự động hạ sample_fps để tổng số khung cần quét luôn nằm trong ngưỡng hợp lý — video càng dài,
    # tần suất lấy mẫu càng thưa, tránh việc quét sub cứng biến thành bước nghẽn cổ chai của cả pipeline.
    MAX_SAMPLED_FRAMES = 3000
    estimated_samples = total_duration * sample_fps
    if total_duration > 0 and estimated_samples > MAX_SAMPLED_FRAMES:
        effective_sample_fps = max(0.2, MAX_SAMPLED_FRAMES / total_duration)
        logger.info(
            f"[OCR] Video dài {total_duration:.0f}s -> giảm sample_fps từ {sample_fps} "
            f"xuống {effective_sample_fps:.3f} để tránh quét quá lâu"
        )
        sample_fps = effective_sample_fps

    frame_step = max(1, int(round(video_fps / sample_fps)))
    sample_interval_sec = frame_step / video_fps

    y1 = max(0, int(video_h * sub_top_ratio))
    y2 = min(video_h, int(video_h * sub_bottom_ratio))

    reader = get_ocr_reader()

    # Thu thập raw detections tại từng mốc thời gian
    raw_detections: List[Dict[str, Any]] = []
    frame_idx = 0

    while frame_idx < total_frames:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret or frame is None:
            break

        timestamp = round(frame_idx / video_fps, 2)
        crop_sub = frame[y1:y2, :]

        try:
            results = reader.readtext(crop_sub)
            detected_texts = []
            for item in results:
                bbox, text, conf = item
                clean_t = str(text).strip()
                try:
                    conf_val = float(conf)
                except (ValueError, TypeError):
                    conf_val = 0.0
                if conf_val >= float(min_confidence) and len(clean_t) >= 1:
                    detected_texts.append(clean_t)

            if detected_texts:
                merged_line = " ".join(detected_texts)
                raw_detections.append({
                    "time": timestamp,
                    "text": merged_line,
                })
        except Exception:
            pass

        frame_idx += frame_step

    cap.release()

    if not raw_detections:
        return []

    # Gom cụm các frame liên tiếp có nội dung tương đồng
    clustered_segments: List[Dict[str, Any]] = []
    current_cluster = {
        "start": raw_detections[0]["time"],
        "end": raw_detections[0]["time"] + sample_interval_sec,
        "text": raw_detections[0]["text"],
    }

    for item in raw_detections[1:]:
        sim = text_similarity(current_cluster["text"], item["text"])
        time_gap = item["time"] - current_cluster["end"]

        # Nếu cùng text hoặc tương đồng > 55% và thời gian cách nhau <= 1.0s
        if sim >= 0.55 and time_gap <= 1.0:
            current_cluster["end"] = round(item["time"] + sample_interval_sec, 2)
            # Giữ chuỗi text dài hơn để đầy đủ nội dung
            if len(item["text"]) > len(current_cluster["text"]):
                current_cluster["text"] = item["text"]
        else:
            # Chốt segment trước
            if len(current_cluster["text"].strip()) >= 2:
                clustered_segments.append(current_cluster)
            current_cluster = {
                "start": item["time"],
                "end": round(item["time"] + sample_interval_sec, 2),
                "text": item["text"],
            }

    if current_cluster and len(current_cluster["text"].strip()) >= 2:
        clustered_segments.append(current_cluster)

    # Chuẩn hóa format segments đồng nhất với Whisper STT
    formatted_results = []
    for i, seg in enumerate(clustered_segments):
        start_t = max(0.0, round(float(seg["start"]), 2))
        end_t = min(total_duration, round(float(seg["end"]), 2))
        if end_t <= start_t:
            end_t = start_t + 1.2

        formatted_results.append({
            "id": i + 1,
            "start": start_t,
            "end": end_t,
            "duration": round(end_t - start_t, 2),
            "text": seg["text"].strip(),
            "text_vi": "",
        })

    return formatted_results
