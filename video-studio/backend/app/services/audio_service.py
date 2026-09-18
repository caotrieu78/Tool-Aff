import os
import subprocess
from pathlib import Path


def extract_audio_wav(video_path: str, output_wav_path: str) -> str:
    """
    Trích xuất audio từ video thành định dạng 16kHz mono WAV (tối ưu cho Whisper STT).
    """
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")

    os.makedirs(os.path.dirname(output_wav_path), exist_ok=True)

    cmd = [
        "ffmpeg",
        "-y",
        "-i", video_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        output_wav_path,
    ]

    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg extract audio failed: {result.stderr.decode('utf-8', errors='ignore')}")

    return output_wav_path
