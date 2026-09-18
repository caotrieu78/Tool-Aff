import asyncio
import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update
from pydantic import BaseModel
from typing import Optional, Any
from pathlib import Path

from app.core.db import get_db
from app.core.crypto import encrypt_value, decrypt_value
from app.models.gemini_key import GeminiApiKey, GeminiKeyStatus
from app.services.gemini_service import test_gemini_key, GeminiKeyPool
from app.services.tts_service import get_available_voices, get_or_create_voice_preview
from app.services.omnivoice_service import (
    load_registry,
    add_custom_voice,
    delete_custom_voice,
    get_custom_voices_dir,
    _omnivoice_manager,
)

router = APIRouter()


class GeminiKeyCreate(BaseModel):
    api_key: str
    label: str
    provider: Optional[str] = "auto"  # "google" | "kie" | "auto"


class GeminiKeyTest(BaseModel):
    api_key: str
    provider: Optional[str] = None


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
    test_res = test_gemini_key(clean_key, provider=None if req_provider == "auto" else req_provider)
    if not test_res["valid"]:
        raise HTTPException(
            status_code=400,
            detail=f"API Key không hợp lệ: {test_res.get('message', '')}",
        )

    resolved_provider = test_res.get("provider") or (req_provider if req_provider != "auto" else "google")

    default_label = "Kie.ai Gemini 3.8 Flash" if resolved_provider == "kie" else "Google Gemini Key"
    new_key = GeminiApiKey(
        api_key_encrypted=encrypt_value(clean_key),
        label=body.label.strip() or default_label,
        provider=resolved_provider,
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
            "masked_key": masked,
            "status": new_key.status.value,
        },
        "latency_ms": test_res["latency_ms"],
    }


@router.post("/gemini-keys/test-raw")
async def test_raw_key(body: GeminiKeyTest):
    """Kiểm tra trực tiếp một API key chưa lưu (Google hoặc Kie.ai)."""
    res = test_gemini_key(body.api_key.strip(), provider=body.provider)
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
    test_res = await asyncio.to_thread(
        test_gemini_key,
        decrypt_value(str(key_rec.api_key_encrypted)),
        key_provider,
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
    - Edge-TTS (Microsoft Cloud)
    - Kokoro-Vietnamese (Offline Open Source)
    - OmniVoice Presets (AI Studio)
    - Custom Voices (Giọng do người dùng tạo)
    """
    voices = get_available_voices()
    return {"voices": voices}


@router.get("/tts-preview/{voice_id:path}")
async def get_tts_preview(voice_id: str):
    """Lấy URL audio nghe thử mẫu của giọng đọc."""
    # Custom voice: trả về file trực tiếp
    if voice_id.startswith("custom_"):
        sample_path = get_custom_voices_dir() / voice_id / "sample.mp3"
        if sample_path.exists():
            return {"voice_id": voice_id, "audio_url": f"/api/settings/custom-voices/{voice_id}/sample"}
        raise HTTPException(status_code=404, detail="Sample chưa sẵn sàng cho giọng này")

    preview_url = await get_or_create_voice_preview(voice_id)
    return {"voice_id": voice_id, "audio_url": preview_url}


# ─────────────────────────────────────────────────────────────────
# Custom Voice (Voice Cloning) API
# ─────────────────────────────────────────────────────────────────

@router.get("/custom-voices")
async def list_custom_voices():
    """Lấy danh sách giọng custom do người dùng tạo."""
    return {"voices": load_registry()}


@router.post("/custom-voices")
async def create_custom_voice(
    name: str = Form(...),
    gender: str = Form("Female"),
    ref_text: Optional[str] = Form(None),
    ref_audio: UploadFile = File(...),
):
    """
    Tạo giọng tùy ý mới từ file audio mẫu.
    - name: Tên giọng hiển thị
    - gender: Male / Female
    - ref_text: Nội dung audio mẫu (tuỳ chọn — sẽ tự nhận diện nếu không cung cấp)
    - ref_audio: File âm thanh mẫu (mp3/wav/m4a, 3s-20s)
    """
    allowed_types = {"audio/mpeg", "audio/wav", "audio/mp4", "audio/x-m4a", "audio/ogg"}
    if ref_audio.content_type and ref_audio.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Định dạng file không hợp lệ: {ref_audio.content_type}. Chấp nhận: mp3, wav, m4a",
        )

    audio_bytes = await ref_audio.read()
    if len(audio_bytes) < 10_000:  # < 10KB
        raise HTTPException(status_code=400, detail="File audio quá nhỏ (tối thiểu 3 giây)")

    try:
        import asyncio
        voice_item = await asyncio.to_thread(
            add_custom_voice,
            name=name.strip(),
            gender=gender,
            ref_audio_bytes=audio_bytes,
            ref_audio_filename=ref_audio.filename or "upload.wav",
            ref_text=ref_text.strip() if ref_text else None,
        )
        return {"success": True, "voice": voice_item}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi tạo giọng: {str(e)}")


@router.delete("/custom-voices/{voice_id}")
async def remove_custom_voice(voice_id: str):
    """Xóa giọng tùy ý đã tạo."""
    if not voice_id.startswith("custom_"):
        raise HTTPException(status_code=400, detail="Chỉ có thể xóa giọng tùy ý (custom_*)")
    ok = delete_custom_voice(voice_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Không tìm thấy giọng này")
    return {"success": True, "message": f"Đã xóa giọng {voice_id}"}


@router.get("/custom-voices/{voice_id}/sample")
async def stream_custom_voice_sample(voice_id: str):
    """Phát audio nghe thử của giọng custom."""
    sample_path = get_custom_voices_dir() / voice_id / "sample.mp3"
    if not sample_path.exists():
        raise HTTPException(status_code=404, detail="File sample chưa tồn tại")
    return FileResponse(str(sample_path), media_type="audio/mpeg")


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

