import json
import logging
from pathlib import Path
from typing import Any, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

CONFIG_FILE = Path(settings.STORAGE_DIR).parent / "tiktok_channels.json"

DEFAULT_TIKTOK_CHANNELS = [
    {
        "id": 1,
        "name": "Kênh TikTok #1",
        "username": "@kenhtiktok1",
        "platform_source": "tiktok",
        "status": "active",
        "is_active": True,
        "publish_headless": True,
        "time_slots": ["11:00", "14:00", "19:00", "21:30"],
    },
    {
        "id": 2,
        "name": "Kênh TikTok #2",
        "username": "@kenhtiktok2",
        "platform_source": "tiktok",
        "status": "active",
        "is_active": True,
        "publish_headless": True,
        "time_slots": ["11:00", "14:00", "19:00", "21:30"],
    },
    {
        "id": 3,
        "name": "Kênh TikTok #3",
        "username": "@kenhtiktok3",
        "platform_source": "tiktok",
        "status": "active",
        "is_active": True,
        "publish_headless": True,
        "time_slots": ["11:00", "14:00", "19:00", "21:30"],
    },
]


def get_configured_tiktok_channels() -> list[dict[str, Any]]:
    """Lấy danh sách kênh TikTok đã cấu hình trong hệ thống."""
    if not CONFIG_FILE.exists():
        save_configured_tiktok_channels(DEFAULT_TIKTOK_CHANNELS)
        return DEFAULT_TIKTOK_CHANNELS

    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list) and len(data) > 0:
                for ch in data:
                    if "publish_headless" not in ch:
                        ch["publish_headless"] = True
                return data
    except Exception as e:
        logger.error(f"Lỗi đọc {CONFIG_FILE}: {e}")

    save_configured_tiktok_channels(DEFAULT_TIKTOK_CHANNELS)
    return DEFAULT_TIKTOK_CHANNELS


def save_configured_tiktok_channels(channels: list[dict[str, Any]]) -> bool:
    """Lưu danh sách kênh TikTok cấu hình vào storage."""
    try:
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(channels, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.error(f"Lỗi lưu {CONFIG_FILE}: {e}")
        return False


def update_tiktok_channel(channel_id: int, update_data: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Cập nhật thông tin một kênh TikTok cấu hình."""
    channels = get_configured_tiktok_channels()
    target = None
    for ch in channels:
        if ch.get("id") == channel_id:
            ch.update(update_data)
            target = ch
            break

    if target:
        save_configured_tiktok_channels(channels)
    return target


def add_tiktok_channel(
    name: str,
    username: str = "",
    time_slots: Optional[list[str]] = None,
    publish_headless: bool = True,
) -> dict[str, Any]:
    """Thêm một kênh TikTok mới vào cấu hình."""
    channels = get_configured_tiktok_channels()
    max_id = max([ch.get("id", 0) for ch in channels], default=0)
    new_id = max_id + 1
    new_channel = {
        "id": new_id,
        "name": name.strip() or f"Kênh TikTok #{new_id}",
        "username": username.strip() or f"@kenhtiktok{new_id}",
        "platform_source": "tiktok",
        "status": "active",
        "is_active": True,
        "publish_headless": publish_headless,
        "time_slots": time_slots or ["11:00", "14:00", "19:00", "21:30"],
    }
    channels.append(new_channel)
    save_configured_tiktok_channels(channels)
    return new_channel


def delete_tiktok_channel(channel_id: int) -> bool:
    """Xóa một kênh TikTok khỏi cấu hình."""
    channels = get_configured_tiktok_channels()
    initial_len = len(channels)
    channels = [ch for ch in channels if ch.get("id") != channel_id]
    if len(channels) < initial_len:
        save_configured_tiktok_channels(channels)
        return True
    return False
