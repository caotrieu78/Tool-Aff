import asyncio
import httpx
import os
import logging
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update
from pydantic import BaseModel
from typing import Optional, Any
from pathlib import Path

from app.core.config import settings
from app.core.db import get_db
from app.core.crypto import encrypt_value, decrypt_value
from app.models.gemini_key import GeminiApiKey, GeminiKeyStatus
from app.services.gemini_service import test_gemini_key, GeminiKeyPool
from app.services.tts_service import get_available_voices, get_or_create_voice_preview

logger = logging.getLogger(__name__)

router = APIRouter()


class GeminiKeyCreate(BaseModel):
    api_key: str
    label: str
    provider: Optional[str] = "auto"  # "google" | "kie" | "auto"
    preferred_model: Optional[str] = "auto"


class GeminiKeyTest(BaseModel):
    model_config = {"protected_namespaces": ()}
    api_key: str
    provider: Optional[str] = None
    model_name: Optional[str] = None


class GeminiKeyModelUpdate(BaseModel):
    preferred_model: str


@router.get("/gemini-keys")
async def list_gemini_keys(db: AsyncSession = Depends(get_db)):
    """Danh sách Gemini API keys (che bớt key thật để bảo mật)."""
    stmt = select(GeminiApiKey).order_by(GeminiApiKey.is_default.desc(), GeminiApiKey.id.desc())
    res = await db.execute(stmt)
    keys = res.scalars().all()

    items = []
    for k in keys:
        k_any: Any = k
        raw = decrypt_value(str(getattr(k_any, "api_key_encrypted", "") or ""))
        masked = f"{raw[:6]}...{raw[-4:]}" if len(raw) > 10 else "******"
        items.append({
            "id": k_any.id,
            "label": k_any.label,
            "provider": getattr(k_any, "provider", "google") or "google",
            "preferred_model": getattr(k_any, "preferred_model", "auto") or "auto",
            "is_default": bool(getattr(k_any, "is_default", False)),
            "masked_key": masked,
            "daily_quota_used": getattr(k_any, "daily_quota_used", 0) or 0,
            "daily_quota_limit": getattr(k_any, "daily_quota_limit", 1500) or 1500,
            "status": k_any.status.value if hasattr(getattr(k_any, "status", None), "value") else str(getattr(k_any, "status", "")),
            "is_active": getattr(k_any, "is_active", True),
            "last_used_at": k_any.last_used_at.isoformat() if getattr(k_any, "last_used_at", None) else None,
            "created_at": k_any.created_at.isoformat() if getattr(k_any, "created_at", None) else None,
        })
    return {"keys": items}


@router.post("/gemini-keys")
async def add_gemini_key(body: GeminiKeyCreate, db: AsyncSession = Depends(get_db)):
    """Thêm Gemini API key mới vào pool (Google AI Studio hoặc Kie.ai). Tự động test tính hợp lệ trước khi lưu."""
    clean_key = body.api_key.strip()
    if not clean_key:
        raise HTTPException(status_code=400, detail="API Key không được để trống")

    req_provider = (body.provider or "auto").strip().lower()
    req_model = (body.preferred_model or "auto").strip()
    test_res = test_gemini_key(
        clean_key,
        provider=None if req_provider == "auto" else req_provider,
        model_name=req_model,
    )
    if not test_res["valid"]:
        raise HTTPException(
            status_code=400,
            detail=f"API Key không hợp lệ: {test_res.get('message', '')}",
        )

    resolved_provider = test_res.get("provider") or (req_provider if req_provider != "auto" else "google")

    default_label = f"Kie.ai ({req_model})" if resolved_provider == "kie" else "Google Gemini Key"
    new_key = GeminiApiKey(
        api_key_encrypted=encrypt_value(clean_key),
        label=body.label.strip() or default_label,
        provider=resolved_provider,
        preferred_model=req_model,
        status=GeminiKeyStatus.active,
        daily_quota_limit=5000 if resolved_provider == "kie" else 1500,
        daily_quota_used=0,
    )
    db.add(new_key)
    await db.commit()
    await db.refresh(new_key)

    raw = clean_key
    masked = f"{raw[:6]}...{raw[-4:]}" if len(raw) > 10 else "******"

    return {
        "success": True,
        "key": {
            "id": new_key.id,
            "label": new_key.label,
            "provider": new_key.provider,
            "preferred_model": new_key.preferred_model,
            "masked_key": masked,
            "status": new_key.status.value,
        },
        "latency_ms": test_res["latency_ms"],
    }


@router.patch("/gemini-keys/{key_id}/model")
async def update_key_model(
    key_id: int,
    body: GeminiKeyModelUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Cập nhật mô hình AI ưu tiên cho key đã lưu."""
    stmt = select(GeminiApiKey).where(GeminiApiKey.id == key_id)
    res = await db.execute(stmt)
    key_rec = res.scalar_one_or_none()
    if not key_rec:
        raise HTTPException(status_code=404, detail="Key not found")

    new_model = body.preferred_model.strip() or "auto"
    key_rec.preferred_model = new_model
    await db.commit()
    return {
        "success": True,
        "key_id": key_id,
        "preferred_model": new_model,
        "message": f"Đã cập nhật mô hình ưu tiên: {new_model}",
    }


@router.post("/gemini-keys/test-raw")
async def test_raw_key(body: GeminiKeyTest):
    """Kiểm tra trực tiếp một API key chưa lưu (Google hoặc Kie.ai)."""
    res = test_gemini_key(body.api_key.strip(), provider=body.provider, model_name=body.model_name)
    return res


@router.post("/gemini-keys/{key_id}/test")
async def test_existing_key(key_id: int, db: AsyncSession = Depends(get_db)):
    """Kiểm tra lại một key đã lưu trong pool."""
    stmt = select(GeminiApiKey).where(GeminiApiKey.id == key_id)
    res = await db.execute(stmt)
    key_rec = res.scalar_one_or_none()
    if not key_rec:
        raise HTTPException(status_code=404, detail="Key not found")

    key_provider = getattr(key_rec, "provider", "google") or "google"
    key_model = getattr(key_rec, "preferred_model", "auto") or "auto"
    test_res = await asyncio.to_thread(
        test_gemini_key,
        decrypt_value(str(key_rec.api_key_encrypted)),
        key_provider,
        key_model,
    )
    rec_id = int(key_rec.id)  # type: ignore[arg-type]
    if test_res["valid"]:
        key_rec.status = GeminiKeyStatus.active  # type: ignore[assignment]
        GeminiKeyPool.clear_cooldown(rec_id)
    else:
        if test_res.get("is_invalid"):
            key_rec.status = GeminiKeyStatus.error  # type: ignore[assignment]
        elif test_res.get("is_rate_limited"):
            key_rec.status = GeminiKeyStatus.exhausted  # type: ignore[assignment]
            GeminiKeyPool.set_cooldown(rec_id, seconds=60)
        else:
            # Lỗi mạng / quá tải tạm thời (503), key vẫn hợp lệ
            key_rec.status = GeminiKeyStatus.active  # type: ignore[assignment]
            GeminiKeyPool.set_cooldown(rec_id, seconds=30)
    await db.commit()

    return test_res


@router.post("/gemini-keys/test-all")
async def test_and_reactivate_all(db: AsyncSession = Depends(get_db)):
    """
    Kiểm tra và tự động phục hồi toàn bộ Gemini API Keys trong pool song song.
    Đưa các key còn hoạt động tốt về trạng thái 'Sẵn sàng'.
    """
    stmt = select(GeminiApiKey).order_by(GeminiApiKey.id.asc())
    res = await db.execute(stmt)
    keys = list(res.scalars().all())

    if not keys:
        return {"success": True, "total": 0, "active_count": 0, "results": []}

    tasks = [
        asyncio.to_thread(
            test_gemini_key,
            decrypt_value(str(k.api_key_encrypted)),
            getattr(k, "provider", "google") or "google",
            getattr(k, "preferred_model", "auto") or "auto",
        )
        for k in keys
    ]
    test_results = await asyncio.gather(*tasks)

    results = []
    active_count = 0

    for k, test_res in zip(keys, test_results):
        k_id = int(k.id)  # type: ignore[arg-type]
        if test_res["valid"]:
            k.status = GeminiKeyStatus.active  # type: ignore[assignment]
            GeminiKeyPool.clear_cooldown(k_id)
            active_count += 1
        else:
            if test_res.get("is_invalid"):
                k.status = GeminiKeyStatus.error  # type: ignore[assignment]
            elif test_res.get("is_rate_limited"):
                k.status = GeminiKeyStatus.exhausted  # type: ignore[assignment]
                GeminiKeyPool.set_cooldown(k_id, seconds=60)
            else:
                k.status = GeminiKeyStatus.active  # type: ignore[assignment]
                active_count += 1

        results.append({
            "id": k.id,
            "label": k.label,
            "valid": test_res["valid"],
            "status": k.status.value,
            "message": test_res.get("message", ""),
            "latency_ms": test_res.get("latency_ms", 0),
        })

    await db.commit()
    return {
        "success": True,
        "total": len(keys),
        "active_count": active_count,
        "results": results,
    }


@router.post("/gemini-keys/{key_id}/default")
async def set_default_gemini_key(key_id: int, db: AsyncSession = Depends(get_db)):
    """Đặt một key làm mặc định được ưu tiên gọi đầu tiên."""
    stmt = select(GeminiApiKey).where(GeminiApiKey.id == key_id)
    res = await db.execute(stmt)
    raw_key = res.scalar_one_or_none()
    if not raw_key:
        raise HTTPException(status_code=404, detail="Key not found")

    key_rec: Any = raw_key
    # Bỏ mặc định tất cả các key khác
    await db.execute(update(GeminiApiKey).values(is_default=False))
    key_rec.is_default = True
    key_rec.is_active = True
    await db.commit()

    return {
        "success": True,
        "message": f"Đã đặt key '{key_rec.label}' làm mặc định ưu tiên sử dụng",
        "key_id": key_id,
    }


@router.get("/gemini-keys/{key_id}/kie-credit")
async def get_kie_credit(key_id: int, db: AsyncSession = Depends(get_db)):
    """Lấy số credit còn lại từ Kie.ai cho một key cụ thể (chỉ áp dụng với Kie.ai keys)."""
    stmt = select(GeminiApiKey).where(GeminiApiKey.id == key_id)
    res = await db.execute(stmt)
    key_rec = res.scalar_one_or_none()
    if not key_rec:
        raise HTTPException(status_code=404, detail="Key not found")

    provider = getattr(key_rec, "provider", "google") or "google"
    if provider != "kie":
        raise HTTPException(status_code=400, detail="Chỉ hỗ trợ Kie.ai keys")

    raw_key = decrypt_value(str(key_rec.api_key_encrypted or ""))
    if not raw_key:
        raise HTTPException(status_code=400, detail="Không giải mã được API key")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                "https://api.kie.ai/api/v1/chat/credit",
                headers={
                    "Authorization": f"Bearer {raw_key}",
                    "Content-Type": "application/json",
                },
            )
        data = response.json()
        if response.status_code == 200 and data.get("code") == 200:
            credit = data.get("data", 0)
            return {"success": True, "credit": credit, "key_id": key_id}
        else:
            return {
                "success": False,
                "credit": None,
                "error": data.get("msg", "Không lấy được credit"),
            }
    except Exception as e:
        return {"success": False, "credit": None, "error": str(e)}


@router.delete("/gemini-keys/{key_id}")
async def delete_gemini_key(key_id: int, db: AsyncSession = Depends(get_db)):
    """Xóa Gemini API key khỏi pool."""
    stmt = delete(GeminiApiKey).where(GeminiApiKey.id == key_id)
    await db.execute(stmt)
    await db.commit()
    return {"success": True, "message": "Đã xóa API key khỏi pool"}


# ─────────────────────────────────────────────────────────────────
# TTS Voices API
# ─────────────────────────────────────────────────────────────────

@router.get("/tts-voices")
async def list_tts_voices():
    """
    Lấy danh sách tất cả giọng đọc:
    - Gemini 2.5 Pro TTS (Google Cloud)
    - Edge-TTS (Microsoft Cloud)
    - VieNeu-TTS (Offline, mã nguồn mở — chỉ nạp model 1 lần đầu để liệt kê preset)
    - Custom Voices (Giọng do người dùng tạo)
    """
    # Chạy trong thread riêng vì lần đầu có thể phải nạp model VieNeu-TTS để liệt kê preset,
    # tránh chặn event loop chính của FastAPI khi có nhiều client cùng gọi API này.
    voices = await asyncio.to_thread(get_available_voices)
    return {"voices": voices}


@router.get("/tts-preview/{voice_id:path}")
async def get_tts_preview(voice_id: str):
    """Lấy URL audio nghe thử mẫu của giọng đọc."""
    preview_url = await get_or_create_voice_preview(voice_id)
    return {"voice_id": voice_id, "audio_url": preview_url}


# ─────────────────────────────────────────────────────────────────
# Custom Voice API (Empty/Disabled)
# ─────────────────────────────────────────────────────────────────

@router.get("/custom-voices")
async def list_custom_voices():
    """Lấy danh sách giọng custom."""
    return {"voices": []}


# ── TikTok Channels (Cấu Hình Kênh TikTok Đăng Bài) ──────────────────

from app.services.tiktok_channel_service import (  # noqa: E402
    get_configured_tiktok_channels,
    update_tiktok_channel,
    add_tiktok_channel,
    delete_tiktok_channel,
)
from app.services.tiktok_browser_service import get_channel_session_info  # noqa: E402


class TikTokChannelInput(BaseModel):
    name: str
    username: Optional[str] = ""
    time_slots: Optional[list[str]] = None
    is_active: Optional[bool] = True
    publish_headless: Optional[bool] = True
    linked_channel_ids: Optional[list[int]] = None
    linked_category_ids: Optional[list[int]] = None


@router.get("/tiktok-channels")
async def list_tiktok_channels():
    """Lấy danh sách các kênh TikTok đã cấu hình trong Cài Đặt kèm trạng thái phiên đăng nhập."""
    channels = get_configured_tiktok_channels()
    enriched = []
    for ch in channels:
        ch_id = int(ch["id"])
        sess = get_channel_session_info(ch_id)
        enriched.append({
            **ch,
            "publish_headless": ch.get("publish_headless", True),
            "is_logged_in": sess.get("is_logged_in", False),
            "username": sess.get("username") or ch.get("username", ""),
            "avatar_url": sess.get("avatar_url", ""),
            "is_logging_in": sess.get("is_logging_in", False),
        })
    return {"channels": enriched}


@router.post("/tiktok-channels")
async def create_tiktok_channel(body: TikTokChannelInput):
    """Thêm một kênh TikTok cấu hình mới."""
    ch = add_tiktok_channel(
        name=body.name,
        username=body.username or "",
        time_slots=body.time_slots,
        publish_headless=True if body.publish_headless is None else body.publish_headless,
    )
    return {"success": True, "channel": ch}


@router.put("/tiktok-channels/{channel_id}")
async def edit_tiktok_channel(channel_id: int, body: TikTokChannelInput):
    """Cập nhật thông tin kênh TikTok cấu hình."""
    data = {}
    if body.name is not None:
        data["name"] = body.name.strip()
    if body.username is not None:
        data["username"] = body.username.strip()
    if body.time_slots is not None:
        data["time_slots"] = body.time_slots
    if body.is_active is not None:
        data["is_active"] = body.is_active
    if body.publish_headless is not None:
        data["publish_headless"] = body.publish_headless
    if body.linked_channel_ids is not None:
        data["linked_channel_ids"] = body.linked_channel_ids
    if body.linked_category_ids is not None:
        data["linked_category_ids"] = body.linked_category_ids

    updated = update_tiktok_channel(channel_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Không tìm thấy kênh TikTok")
    return {"success": True, "channel": updated}


@router.delete("/tiktok-channels/{channel_id}")
async def remove_tiktok_channel(channel_id: int):
    """Xóa kênh TikTok khỏi cấu hình."""
    ok = delete_tiktok_channel(channel_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Không tìm thấy kênh TikTok")
    return {"success": True, "message": f"Đã xóa kênh #{channel_id}"}


@router.get("/storage/stats")
async def get_storage_stats():
    """
    Thống kê dung lượng ổ đĩa:
    - Tổng dung lượng thư mục storage
    - Dung lượng file tạm (audio_source.wav, temp_frames, *.ass, *.tmp)
    - Dung lượng video thành phẩm (output_localized.mp4, final_*)
    - Dung lượng video gốc (original.mp4)
    - Số lượng video và file tạm
    """
    storage_path = Path(settings.STORAGE_DIR)
    total_bytes = 0
    temp_bytes = 0
    output_bytes = 0
    original_bytes = 0
    temp_files_count = 0
    video_count = 0

    if storage_path.exists():
        for root, dirs, files in os.walk(storage_path):
            rel_root = os.path.relpath(root, storage_path)
            if rel_root.startswith("tiktok_profiles") or rel_root.startswith("custom_voices"):
                continue

            for f in files:
                fp = Path(root) / f
                try:
                    size = fp.stat().st_size
                except Exception:
                    continue

                total_bytes += size
                name_lower = f.lower()

                if name_lower.startswith("original"):
                    original_bytes += size
                    video_count += 1
                elif "output" in name_lower or "final" in name_lower:
                    output_bytes += size
                elif (
                    name_lower.endswith(".tmp")
                    or name_lower.endswith(".wav")
                    or name_lower.endswith(".ass")
                    or "frame" in name_lower
                    or "temp" in name_lower
                ):
                    temp_bytes += size
                    temp_files_count += 1

    return {
        "success": True,
        "total_bytes": total_bytes,
        "total_mb": round(total_bytes / (1024 * 1024), 2),
        "total_gb": round(total_bytes / (1024 * 1024 * 1024), 2),
        "temp_bytes": temp_bytes,
        "temp_mb": round(temp_bytes / (1024 * 1024), 2),
        "temp_files_count": temp_files_count,
        "original_bytes": original_bytes,
        "original_mb": round(original_bytes / (1024 * 1024), 2),
        "output_bytes": output_bytes,
        "output_mb": round(output_bytes / (1024 * 1024), 2),
        "video_count": video_count,
    }


@router.post("/storage/clean")
async def clean_storage_cache():
    """
    Dọn dẹp file tạm, audio_source.wav và các file trung gian
    để giải phóng dung lượng ổ đĩa một cách an toàn.
    """
    storage_path = Path(settings.STORAGE_DIR)
    freed_bytes = 0
    deleted_count = 0

    if storage_path.exists():
        for root, dirs, files in os.walk(storage_path):
            rel_root = os.path.relpath(root, storage_path)
            if rel_root.startswith("tiktok_profiles") or rel_root.startswith("custom_voices"):
                continue

            for f in files:
                name_lower = f.lower()
                is_temp = (
                    name_lower == "audio_source.wav"
                    or name_lower.endswith(".tmp")
                    or name_lower.endswith(".ass")
                    or name_lower.startswith("temp_")
                    or (name_lower.endswith(".wav") and "gensub" not in name_lower)
                )

                if is_temp:
                    fp = Path(root) / f
                    try:
                        sz = fp.stat().st_size
                        fp.unlink()
                        freed_bytes += sz
                        deleted_count += 1
                    except Exception as e:
                        logger.warning(f"Không thể xóa file tạm {fp}: {e}")

    return {
        "success": True,
        "freed_bytes": freed_bytes,
        "freed_mb": round(freed_bytes / (1024 * 1024), 2),
        "deleted_count": deleted_count,
        "message": f"Đã giải phóng thành công {round(freed_bytes / (1024 * 1024), 1)} MB bộ nhớ ({deleted_count} file tạm).",
    }

