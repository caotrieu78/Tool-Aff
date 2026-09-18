import os
import cv2
import math
import random
import logging
import numpy as np
from pathlib import Path
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

try:
    from scenedetect import detect, ContentDetector
    HAS_SCENEDETECT = True
except ImportError:
    HAS_SCENEDETECT = False
    detect = None
    ContentDetector = None


def detect_video_scenes(
    video_path: str,
    threshold: float = 27.0,
    min_scene_len_sec: float = 1.2,
) -> List[Dict[str, Any]]:
    """
    Nhận diện các cảnh quay trong video sử dụng PySceneDetect (ContentDetector).
    Trả về danh sách các cảnh có start_time, end_time, duration, index.
    Nếu PySceneDetect không phát hiện được hoặc video có 1 cảnh dài,
    sẽ tự động chia đều thành các đoạn nhỏ (mỗi đoạn ~3-4s) để dựng affiliate.
    """
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video không tồn tại: {video_path}")

    # Lấy thông tin video cơ bản bằng OpenCV
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Không thể mở video bằng OpenCV: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    total_duration = total_frames / fps if fps > 0 else 0.0
    cap.release()

    scenes: List[Dict[str, Any]] = []

    if HAS_SCENEDETECT and ContentDetector is not None and detect is not None:
        try:
            min_scene_frames = max(15, int(min_scene_len_sec * fps))
            detector = ContentDetector(threshold=threshold, min_scene_len=min_scene_frames)
            raw_scenes = detect(video_path, detector)

            for idx, scene in enumerate(raw_scenes):
                # scenedetect timecode objects
                start_sec = round(scene[0].seconds, 3)
                end_sec = round(scene[1].seconds, 3)
                dur = round(end_sec - start_sec, 3)
                if dur >= 0.8:  # Bỏ qua cảnh quá ngắn dưới 0.8s
                    scenes.append({
                        "index": idx,
                        "start_time": start_sec,
                        "end_time": end_sec,
                        "duration": dur,
                        "start_frame": scene[0].get_frames(),
                        "end_frame": scene[1].get_frames(),
                    })
        except Exception as e:
            logger.warning(f"PySceneDetect error: {e}, fallback sang chunking")

    # Fallback nếu không tìm thấy cảnh nào hoặc video quay liên tục
    if not scenes and total_duration > 0:
        chunk_len = 3.5  # chia đều 3.5s mỗi cảnh
        num_chunks = max(1, math.ceil(total_duration / chunk_len))
        for i in range(num_chunks):
            start = round(i * chunk_len, 3)
            end = round(min(total_duration, (i + 1) * chunk_len), 3)
            dur = round(end - start, 3)
            if dur >= 0.8:
                scenes.append({
                    "index": i,
                    "start_time": start,
                    "end_time": end,
                    "duration": dur,
                    "start_frame": int(start * fps),
                    "end_frame": int(end * fps),
                })

    # Đánh chỉ số lại cho sạch
    for i, sc in enumerate(scenes):
        sc["index"] = i

    return scenes


def score_scene_quality(video_path: str, scene: Dict[str, Any]) -> float:
    """
    Chấm điểm chất lượng của 1 cảnh quay dựa trên heuristic:
    1. Độ nét (Sharpness) qua Laplacian variance
    2. Độ sáng (Brightness) - tránh cảnh quá tối hoặc quá cháy
    3. Mức độ chuyển động (Motion score) qua Frame Differencing
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return 50.0

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    start_sec = scene.get("start_time", 0.0)
    end_sec = scene.get("end_time", start_sec + 2.0)
    mid_sec = (start_sec + end_sec) / 2.0

    # Lấy 3 frame: start + 0.3s, mid, end - 0.3s
    frame_times = [
        min(end_sec, start_sec + 0.3),
        mid_sec,
        max(start_sec, end_sec - 0.3),
    ]

    frames = []
    for t in frame_times:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
        ret, frame = cap.read()
        if ret and frame is not None:
            frames.append(frame)

    cap.release()

    if not frames:
        return 50.0

    # 1. Sharpness (Laplacian variance) trên frame giữa
    mid_frame = frames[len(frames) // 2]
    gray_mid = cv2.cvtColor(mid_frame, cv2.COLOR_BGR2GRAY)
    lap_var = cv2.Laplacian(gray_mid, cv2.CV_64F).var()
    # Normalize lap_var: 100+ là khá nét, 400+ là rất nét
    sharpness_score = min(100.0, (lap_var / 350.0) * 100.0)

    # 2. Brightness: trung bình độ xám, chuẩn tối ưu là 90-180
    mean_bright = np.mean(gray_mid)
    if mean_bright < 30 or mean_bright > 230:
        bright_score = 30.0
    else:
        # Cách biệt khỏi mốc tối ưu 130
        diff = abs(mean_bright - 130.0)
        bright_score = max(40.0, 100.0 - (diff / 100.0) * 60.0)

    # 3. Motion score: chênh lệch giữa frame đầu và frame cuối
    if len(frames) >= 2:
        gray_first = cv2.cvtColor(frames[0], cv2.COLOR_BGR2GRAY)
        gray_last = cv2.cvtColor(frames[-1], cv2.COLOR_BGR2GRAY)
        diff_frame = cv2.absdiff(gray_first, gray_last)
        motion_mean = np.mean(diff_frame)
        # Normalize: motion_mean 15-40 là chuyển động mượt đẹp, quá cao là rung lắc, 0 là tĩnh lặng
        if motion_mean < 3:
            motion_score = 50.0  # ảnh tĩnh
        elif motion_mean > 70:
            motion_score = 60.0  # rung giật
        else:
            motion_score = min(100.0, 50.0 + (motion_mean / 40.0) * 50.0)
    else:
        motion_score = 60.0

    total_score = (sharpness_score * 0.45) + (bright_score * 0.25) + (motion_score * 0.30)
    return round(float(total_score), 1)


def score_and_filter_highlights(
    video_path: str,
    scenes: List[Dict[str, Any]],
    top_n: Optional[int] = None,
    min_score: float = 40.0,
) -> List[Dict[str, Any]]:
    """
    Chấm điểm cho từng cảnh quay và gắn score, chọn ra các cảnh highlight nổi bật nhất.
    """
    scored_scenes = []
    for sc in scenes:
        sc_copy = dict(sc)
        score = score_scene_quality(video_path, sc)
        sc_copy["quality_score"] = score
        scored_scenes.append(sc_copy)

    # Nếu yêu cầu chọn top N cảnh chất lượng nhất
    if top_n and top_n < len(scored_scenes):
        sorted_scenes = sorted(scored_scenes, key=lambda x: x["quality_score"], reverse=True)
        chosen = sorted_scenes[:top_n]
        # Xếp lại theo dòng thời gian tăng dần để video không bị nhảy timeline ngược trừ khi có lệnh shuffle
        chosen = sorted(chosen, key=lambda x: x["start_time"])
        for idx, sc in enumerate(chosen):
            sc["highlight_rank"] = idx + 1
        return chosen

    return scored_scenes


def generate_scene_variations(
    scenes: List[Dict[str, Any]],
    num_versions: int = 1,
    shuffle: bool = False,
    target_max_duration: Optional[float] = None,
) -> List[List[Dict[str, Any]]]:
    """
    Tạo ra N danh sách cảnh cho N phiên bản video affiliate khác nhau:
    - Phiên bản 1: Giữ nguyên thứ tự chuẩn (thường bắt đầu bằng cảnh mở đầu cuốn hút).
    - Phiên bản 2..N: Nếu shuffle=True, xáo trộn thứ tự các cảnh thân bài (giữ cảnh mở đầu hoặc xáo ngẫu nhiên).
    - Giới hạn tổng thời lượng theo target_max_duration nếu có.
    """
    variations: List[List[Dict[str, Any]]] = []

    if not scenes:
        return variations

    for v_idx in range(num_versions):
        current_scenes = [dict(s) for s in scenes]

        if v_idx == 0 or not shuffle:
            # Bản 1: Giữ nguyên thứ tự gốc
            selected = current_scenes
        else:
            # Bản 2..N: Xáo trộn có kiểm soát
            # Giữ cảnh có điểm cao nhất làm Hook đầu nếu có thông tin quality_score
            has_scores = any("quality_score" in s for s in current_scenes)
            if has_scores and len(current_scenes) > 2:
                # Chọn 1 cảnh top score làm hook
                top_scenes = sorted(current_scenes, key=lambda x: x.get("quality_score", 0), reverse=True)[:3]
                hook_scene = random.choice(top_scenes)
                rest_scenes = [s for s in current_scenes if s["index"] != hook_scene["index"]]
                random.seed(v_idx * 100 + 42)
                random.shuffle(rest_scenes)
                selected = [hook_scene] + rest_scenes
            else:
                random.seed(v_idx * 100 + 42)
                random.shuffle(current_scenes)
                selected = current_scenes

        # Cắt gọt nếu vượt target_max_duration
        if target_max_duration and target_max_duration > 0:
            accumulated = 0.0
            trimmed = []
            for s in selected:
                dur = s.get("duration", 0.0)
                if accumulated + dur <= target_max_duration:
                    trimmed.append(s)
                    accumulated += dur
                else:
                    remain = target_max_duration - accumulated
                    if remain >= 1.5:
                        s_cut = dict(s)
                        s_cut["end_time"] = s_cut["start_time"] + remain
                        s_cut["duration"] = remain
                        trimmed.append(s_cut)
                    break
            selected = trimmed or selected[:3]

        # Đánh lại index thứ tự trong bản dựng này
        for i, s in enumerate(selected):
            s["order_index"] = i

        variations.append(selected)

    return variations
