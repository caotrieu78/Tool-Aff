import os
import json
import shutil
import asyncio
import hashlib
import subprocess
from pathlib import Path
from typing import Optional, Dict, Any
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)


def get_video_metadata(file_path: str) -> Dict[str, Any]:
    """
    Sử dụng ffprobe để đọc thông tin video:
    - duration (giây)
    - resolution (width x height)
    - file_size (bytes)
    - fps
    """
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration,size:stream=width,height,r_frame_rate,codec_type",
        "-of", "json",
        file_path
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = json.loads(res.stdout)
        
        duration = float(data.get("format", {}).get("duration", 0.0))
        file_size = int(data.get("format", {}).get("size", os.path.getsize(file_path)))
        
        # Tìm video stream
        video_streams = [s for s in data.get("streams", []) if s.get("codec_type") == "video"]
        width, height = 0, 0
        fps = "30"
        if video_streams:
            v = video_streams[0]
            width = v.get("width", 0)
            height = v.get("height", 0)
            fps = v.get("r_frame_rate", "30")

        resolution = f"{width}x{height}" if width and height else "unknown"

        return {
            "duration": round(duration, 2),
            "resolution": resolution,
            "width": width,
            "height": height,
            "file_size": file_size,
            "fps": fps
        }
    except Exception as e:
        logger.error(f"FFprobe error on {file_path}: {e}")
        # Fallback basic file info
        return {
            "duration": 0.0,
            "resolution": "unknown",
            "width": 0,
            "height": 0,
            "file_size": os.path.getsize(file_path) if os.path.exists(file_path) else 0,
            "fps": "30"
        }


def generate_thumbnail(video_path: str, thumbnail_path: str, time_offset: float = 1.0) -> bool:
    """
    Tạo thumbnail ảnh JPG từ video bằng FFmpeg tại timestamp offset.
    """
    Path(thumbnail_path).parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-ss", str(time_offset),
        "-i", video_path,
        "-vframes", "1",
        "-q:v", "2",
        thumbnail_path
    ]
    try:
        subprocess.run(cmd, capture_output=True, check=True)
        return os.path.exists(thumbnail_path)
    except Exception as e:
        logger.error(f"FFmpeg thumbnail error: {e}")
        return False


def calculate_quick_hash(file_path: str) -> str:
    """
    Tính hash sha256 trên 5MB đầu của file để nhận diện trùng lặp nhanh.
    """
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        buf = f.read(5 * 1024 * 1024)
        hasher.update(buf)
    return hasher.hexdigest()
