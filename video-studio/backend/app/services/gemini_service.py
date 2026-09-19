import os
import asyncio
import json
import logging
import time
import re
import random
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from datetime import datetime

logger = logging.getLogger(__name__)

from app.core.crypto import decrypt_value
from app.core.config import settings
from app.models.gemini_key import GeminiApiKey, GeminiKeyStatus

# Primary modern SDK
genai: Any = None
types: Any = None
legacy_genai: Any = None

try:
    from google import genai  # type: ignore
    from google.genai import types  # type: ignore
    HAS_NEW_GENAI = True
except ImportError:
    HAS_NEW_GENAI = False
    try:
        import google.generativeai as legacy_genai  # type: ignore
    except ImportError:
        pass


CANDIDATE_MODELS = [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
]


import base64
import httpx

KIE_BASE_URL = "https://api.kie.ai"
KIE_GEMINI_MODEL = "gemini-3-5-flash"
KIE_CANDIDATE_MODELS = ["gemini-3-5-flash", "gemini-3-8-flash", "gemini-3-7-flash"]


def test_kie_key(api_key: str, model_name: str = "auto") -> Dict[str, Any]:
    """
    Kiểm tra nhanh tính hợp lệ và độ trễ của API key Kie.ai.
    Hỗ trợ cả OpenAI Chat Completions (gpt-5-2, ...) và Gemini native.
    Nếu model_name="auto", ưu tiên test gpt-5-2 (đang ổn định nhất trên Kie.ai),
    sau đó fallback thử gemini nếu cần.
    """
    clean_model = (model_name or "auto").strip().lower()

    # Helper: Test OpenAI format (gpt-5-2, etc.)
    def _test_openai(target_model: str) -> Dict[str, Any]:
        start_time = time.time()
        headers = {
            "Authorization": f"Bearer {api_key.strip()}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": target_model,
            "messages": [{"role": "user", "content": "Xin chào, hãy trả lời đúng 1 chữ: OK"}],
            "stream": False,
        }
        url = f"{KIE_BASE_URL}/v1/chat/completions"
        try:
            with httpx.Client(timeout=25.0) as client:
                resp = client.post(url, headers=headers, json=payload)
                latency_ms = int((time.time() - start_time) * 1000)
                if resp.status_code == 401:
                    return {
                        "valid": False,
                        "provider": "kie",
                        "is_invalid": True,
                        "latency_ms": latency_ms,
                        "message": "API Key Kie.ai không hợp lệ hoặc đã hết hạn (401)",
                        "error": resp.text[:120],
                    }
                elif resp.status_code in (402, 429):
                    return {
                        "valid": False,
                        "provider": "kie",
                        "is_rate_limited": True,
                        "latency_ms": latency_ms,
                        "message": "Tài khoản Kie.ai đã hết credit hoặc bị giới hạn tốc độ (402/429)",
                        "error": resp.text[:120],
                    }
                elif resp.status_code != 200:
                    return {
                        "valid": False,
                        "provider": "kie",
                        "latency_ms": latency_ms,
                        "message": f"Kie.ai ({target_model}) lỗi HTTP {resp.status_code}: {resp.text[:100]}",
                        "error": resp.text[:120],
                    }
                try:
                    data = resp.json()
                except Exception:
                    data = {}

                if "error" in data:
                    err_msg = str(data["error"])
                    return {
                        "valid": False,
                        "provider": "kie",
                        "latency_ms": latency_ms,
                        "message": f"Kie.ai lỗi: {err_msg[:80]}",
                        "error": err_msg,
                    }

                choices = data.get("choices", [])
                if choices:
                    reply_text = choices[0].get("message", {}).get("content", "").strip()
                    credits = data.get("usage", {}).get("total_tokens", 0)
                    return {
                        "valid": True,
                        "provider": "kie",
                        "latency_ms": latency_ms,
                        "model_used": target_model,
                        "message": f"Key Kie.ai ({target_model}) hoạt động rất tốt",
                        "reply": reply_text,
                        "credits_consumed": credits,
                    }
                return {
                    "valid": False,
                    "provider": "kie",
                    "latency_ms": latency_ms,
                    "message": f"Kie.ai ({target_model}) trả về rỗng",
                    "error": resp.text[:100],
                }
        except Exception as e:
            latency_ms = int((time.time() - start_time) * 1000)
            return {
                "valid": False,
                "provider": "kie",
                "latency_ms": latency_ms,
                "message": f"Lỗi kết nối Kie.ai ({target_model}): {str(e)[:80]}",
                "error": str(e),
            }

    # Helper: Test Gemini native endpoint
    def _test_gemini(target_model: str) -> Dict[str, Any]:
        start_time = time.time()
        headers = {
            "Authorization": f"Bearer {api_key.strip()}",
            "Content-Type": "application/json",
        }
        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": "Xin chào, hãy trả lời đúng 1 chữ: OK"}],
                }
            ]
        }
        url = f"{KIE_BASE_URL}/gemini/v1/models/{target_model}:generateContent"
        try:
            with httpx.Client(timeout=8.0) as client:
                resp = client.post(url, headers=headers, json=payload)
                latency_ms = int((time.time() - start_time) * 1000)
                try:
                    data = resp.json()
                except Exception:
                    data = {}

                code = data.get("code")
                if code is not None and code != 200:
                    msg = data.get("msg") or data.get("message") or f"Lỗi Kie.ai (mã {code})"
                    is_invalid = code == 401 or "unauthorized" in msg.lower() or "auth" in msg.lower()
                    is_quota = code in (402, 429) or "quota" in msg.lower() or "credit" in msg.lower()
                    return {
                        "valid": False,
                        "provider": "kie",
                        "is_invalid": is_invalid,
                        "is_rate_limited": is_quota,
                        "latency_ms": latency_ms,
                        "message": f"Kie.ai ({target_model}): {msg}",
                        "error": msg,
                    }

                candidates = data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    text = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and "text" in p)
                    credits_consumed = data.get("credits_consumed", 0)
                    return {
                        "valid": True,
                        "provider": "kie",
                        "latency_ms": latency_ms,
                        "model_used": target_model,
                        "message": f"Key Kie.ai ({target_model}) hoạt động tốt",
                        "reply": text.strip(),
                        "credits_consumed": credits_consumed,
                    }

                if resp.status_code == 401:
                    return {
                        "valid": False,
                        "provider": "kie",
                        "is_invalid": True,
                        "latency_ms": latency_ms,
                        "message": "API Key Kie.ai không hợp lệ hoặc đã hết hạn",
                        "error": resp.text[:120],
                    }
                elif resp.status_code in (402, 429):
                    return {
                        "valid": False,
                        "provider": "kie",
                        "is_rate_limited": True,
                        "latency_ms": latency_ms,
                        "message": "Tài khoản Kie.ai đã hết credit hoặc bị rate limit",
                        "error": resp.text[:120],
                    }

                err_txt = resp.text[:120]
                if resp.status_code == 500 or "server exception" in err_txt.lower():
                    msg = f"Kie.ai model {target_model} đang bảo trì (500 Server Exception)"
                else:
                    msg = f"Kie.ai ({target_model}) HTTP {resp.status_code}: {err_txt}"
                return {
                    "valid": False,
                    "provider": "kie",
                    "latency_ms": latency_ms,
                    "message": msg,
                    "error": err_txt,
                }
        except Exception as e:
            latency_ms = int((time.time() - start_time) * 1000)
            return {
                "valid": False,
                "provider": "kie",
                "latency_ms": latency_ms,
                "message": f"Lỗi kết nối Kie.ai ({target_model}): {str(e)[:80]}",
                "error": str(e),
            }

    # Điều phối theo clean_model:
    if clean_model == "auto":
        # Thử GPT-5.2 trước vì hiện tại là model mượt và ổn định nhất của Kie.ai
        res = _test_openai("gpt-5-2")
        if res["valid"]:
            return res
        if res.get("is_invalid") or res.get("is_rate_limited"):
            return res
        # Nếu GPT-5.2 gặp lỗi mạng/server, thử các model Gemini
        for g_model in ["gemini-3-5-flash", "gemini-3-8-flash"]:
            g_res = _test_gemini(g_model)
            if g_res["valid"]:
                return g_res
        return res

    if clean_model.startswith("gpt-"):
        return _test_openai(clean_model)
    else:
        return _test_gemini(clean_model)


def test_google_key(api_key: str) -> Dict[str, Any]:
    """
    Kiểm tra tính hợp lệ và độ trễ của Google AI Studio Gemini API key.
    """
    start_time = time.time()
    last_err = ""
    is_invalid_key = False
    is_quota_or_rate_limit = False
    is_overloaded = False

    for model_name in CANDIDATE_MODELS:
        try:
            if HAS_NEW_GENAI and genai is not None:
                client = genai.Client(api_key=api_key, http_options={"timeout": 15000})
                response = client.models.generate_content(
                    model=model_name,
                    contents="Xin chào, hãy trả lời đúng 1 chữ: OK",
                )
                text = response.text or ""
            elif legacy_genai is not None:
                legacy_genai.configure(api_key=api_key)
                model = legacy_genai.GenerativeModel(model_name)
                response = model.generate_content("Xin chào, hãy trả lời đúng 1 chữ: OK")
                text = response.text or ""
            else:
                raise RuntimeError("Google GenAI SDK chưa được cài đặt")

            latency_ms = int((time.time() - start_time) * 1000)
            return {
                "valid": True,
                "provider": "google",
                "latency_ms": latency_ms,
                "model_used": model_name,
                "message": f"Key Google Gemini hoạt động hoàn hảo ({model_name})",
                "reply": text.strip(),
            }
        except Exception as e:
            last_err = str(e)
            err_lower = last_err.lower()

            if (
                "api_key_invalid" in err_lower
                or "api key not valid" in err_lower
                or "permission_denied" in err_lower
                or ("api_key" in err_lower and "invalid" in err_lower)
            ):
                is_invalid_key = True
                break
            if "429" in last_err or "quota" in err_lower or "resourceexhausted" in err_lower:
                is_quota_or_rate_limit = True
                continue
            if "503" in last_err or "unavailable" in err_lower:
                is_overloaded = True
                continue
            if "404" in last_err or "not found" in err_lower or "no longer available" in err_lower:
                continue

    latency_ms = int((time.time() - start_time) * 1000)

    if is_invalid_key:
        msg = "API Key không hợp lệ hoặc đã bị tắt trên Google AI Studio"
    elif is_quota_or_rate_limit:
        msg = "Key bị chạm giới hạn tốc độ (Rate Limit) tạm thời, hệ thống sẽ tự dùng lại sau ít phút"
    elif is_overloaded:
        msg = "Máy chủ Google tạm thời quá tải (503), key vẫn hợp lệ"
    else:
        msg = f"Lỗi kết nối tới Google Gemini: {last_err[:120]}"

    return {
        "valid": False,
        "provider": "google",
        "is_invalid": is_invalid_key,
        "is_rate_limited": is_quota_or_rate_limit,
        "is_overloaded": is_overloaded,
        "latency_ms": latency_ms,
        "message": msg,
        "error": last_err,
    }


def test_gemini_key(
    api_key: str,
    provider: Optional[str] = None,
    model_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Kiểm tra nhanh tính hợp lệ và độ trễ của API key (tự động nhận diện Google hoặc Kie.ai).
    """
    clean_key = api_key.strip()
    clean_provider = (provider or "").strip().lower()
    selected_model = (model_name or "auto").strip()

    if clean_provider == "kie":
        return test_kie_key(clean_key, model_name=selected_model)
    elif clean_provider == "google":
        return test_google_key(clean_key)

    # Tự động nhận diện
    if clean_key.startswith("AIzaSy"):
        google_res = test_google_key(clean_key)
        if google_res["valid"]:
            return google_res
        kie_res = test_kie_key(clean_key, model_name=selected_model)
        if kie_res["valid"]:
            return kie_res
        return google_res
    else:
        kie_res = test_kie_key(clean_key, model_name=selected_model)
        if kie_res["valid"]:
            return kie_res
        google_res = test_google_key(clean_key)
        if google_res["valid"]:
            return google_res
        # Nếu cả 2 đều không hợp lệ, ưu tiên thông báo Kie.ai nếu key có định dạng token thông thường
        return kie_res


async def call_kie_ai_gemini(
    api_key: str,
    prompt: Any,
    system_instruction: Optional[str] = None,
    model_name: str = "gemini-3-8-flash",
) -> str:
    """
    Gọi API Gemini 3.8 Flash thông qua Kie.ai với đầy đủ hỗ trợ text và multimodal vision (video keyframes).
    Đặc điểm Kie.ai: Tốc độ cao, $0.225 / 1M token, không bị chặn IP Việt Nam.
    """
    clean_model = model_name.strip()
    # Chuẩn hóa tên model sang đúng format của kie.ai (dấu gạch ngang, không dấu chấm)
    if clean_model in ("gemini-3.8-flash", "gemini-3-8-flash", "gemini-flash-latest", "gemini-flash-lite-latest"):
        candidate_models = ["gemini-3-5-flash", "gemini-3-8-flash", "gemini-3-7-flash"]
    elif clean_model in ("gemini-3.7-flash", "gemini-3-7-flash"):
        candidate_models = ["gemini-3-5-flash", "gemini-3-7-flash", "gemini-3-8-flash"]
    else:
        candidate_models = ["gemini-3-5-flash", clean_model.replace(".", "-"), "gemini-3-8-flash", "gemini-3-7-flash"]

    headers = {
        "Authorization": f"Bearer {api_key.strip()}",
        "Content-Type": "application/json",
    }

    parts: List[Dict[str, Any]] = []
    if isinstance(prompt, str):
        parts.append({"text": prompt})
    elif isinstance(prompt, list):
        for item in prompt:
            if isinstance(item, str):
                parts.append({"text": item})
            elif isinstance(item, dict):
                if "text" in item:
                    parts.append({"text": item["text"]})
                elif "data" in item:
                    raw_bytes = item["data"]
                    b64 = base64.b64encode(raw_bytes).decode("utf-8") if isinstance(raw_bytes, bytes) else str(raw_bytes)
                    parts.append({
                        "inline_data": {
                            "mime_type": item.get("mime_type", "image/jpeg"),
                            "data": b64,
                        }
                    })
                elif "inline_data" in item:
                    parts.append(item)
                else:
                    parts.append({"text": json.dumps(item, ensure_ascii=False)})
            elif hasattr(item, "inline_data") and getattr(item, "inline_data", None) is not None:
                inline = getattr(item, "inline_data")
                raw_bytes = getattr(inline, "data", b"")
                mime = getattr(inline, "mime_type", "image/jpeg")
                b64 = base64.b64encode(raw_bytes).decode("utf-8") if isinstance(raw_bytes, bytes) else str(raw_bytes)
                parts.append({
                    "inline_data": {
                        "mime_type": mime,
                        "data": b64,
                    }
                })
            elif hasattr(item, "text") and getattr(item, "text", None):
                parts.append({"text": str(getattr(item, "text"))})
            elif isinstance(item, bytes):
                b64 = base64.b64encode(item).decode("utf-8")
                parts.append({
                    "inline_data": {
                        "mime_type": "image/jpeg",
                        "data": b64,
                    }
                })
            else:
                parts.append({"text": str(item)})
    else:
        parts.append({"text": str(prompt)})

    contents = [{"role": "user", "parts": parts}]
    payload: Dict[str, Any] = {
        "contents": contents,
        "generationConfig": {
            "temperature": 0.7,
            # Video dài -> danh sách segment/kịch bản dài -> phản hồi JSON có thể rất lớn.
            # Không set giới hạn này dễ khiến Gemini cắt output giữa chừng, JSON bị hỏng và
            # rơi vào fallback (mất bản dịch) một cách âm thầm.
            "maxOutputTokens": 8192,
        },
        # Không thêm "stream" vào Gemini native payload — field này chỉ dùng cho OpenAI format
    }

    if system_instruction:
        payload["systemInstruction"] = {
            "parts": [{"text": system_instruction}]
        }

    last_err_msg = ""
    # Kie.ai chi ho tro :streamGenerateContent theo tai lieu chinh thuc
    payload["stream"] = True
    async with httpx.AsyncClient(timeout=120.0) as client:
        for cur_model in candidate_models:
            url = f"{KIE_BASE_URL}/gemini/v1/models/{cur_model}:streamGenerateContent"
            for attempt in range(2):
                try:
                    resp = await client.post(url, headers=headers, json=payload)

                    if resp.status_code == 401:
                        raise RuntimeError(f"Kie.ai 401 Unauthorized: API Key khong hop le")
                    elif resp.status_code in (402, 429):
                        raise RuntimeError(f"Kie.ai {resp.status_code} Quota/Credits Exceeded")
                    elif resp.status_code == 503:
                        logger.warning(f"[Kie.ai] Model {cur_model} 503 qua tai -> thu model tiep theo")
                        last_err_msg = f"Kie.ai 503 Capacity"
                        await asyncio.sleep(0.4)
                        break

                    if resp.status_code != 200:
                        last_err_msg = f"Kie.ai HTTP {resp.status_code}: {resp.text[:120]}"
                        if attempt < 1:
                            await asyncio.sleep(0.4)
                        continue

                    # Parse NDJSON/SSE streaming response
                    full_text = ""
                    for line in resp.text.splitlines():
                        line = line.strip()
                        if not line or line.startswith(":") or line == "[DONE]":
                            continue
                        if line.startswith("data:"):
                            line = line[5:].strip()
                        if not line or line == "[DONE]":
                            continue
                        try:
                            chunk = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if chunk.get("error"):
                            err_info = chunk["error"]
                            c = err_info.get("code", 0)
                            m = err_info.get("message", "")
                            if c == 401 or "unauthorized" in m.lower():
                                raise RuntimeError(f"Kie.ai 401 Unauthorized: {m}")
                            elif c in (402, 429) or "quota" in m.lower() or "credit" in m.lower():
                                raise RuntimeError(f"Kie.ai {c} Quota/Credits: {m}")
                            elif c == 503 or "capacity" in m.lower():
                                last_err_msg = f"Kie.ai 503 Capacity: {m}"
                                break
                            else:
                                last_err_msg = f"Kie.ai error {c}: {m}"
                                break
                        for cand in chunk.get("candidates", []):
                            for p in cand.get("content", {}).get("parts", []):
                                if isinstance(p, dict) and "text" in p:
                                    full_text += p["text"]

                    if full_text:
                        return full_text
                    if not last_err_msg:
                        last_err_msg = f"Kie.ai response rong (model={cur_model})"

                except RuntimeError:
                    raise
                except Exception as ex:
                    last_err_msg = str(ex)
                    if attempt < 1:
                        await asyncio.sleep(0.4)

    raise RuntimeError(f"Kie.ai khong the xu ly: {last_err_msg}")


async def call_kie_ai_openai(
    api_key: str,
    prompt: Any,
    system_instruction: Optional[str] = None,
    model_name: str = "gpt-5-2",
) -> str:
    """
    Gọi Kie.ai qua giao thức OpenAI Chat Completions (POST https://api.kie.ai/v1/chat/completions).
    Hỗ trợ đầy đủ văn bản và Multimodal Vision (hình ảnh keyframe base64).
    Tương thích với các model: gpt-5-2, gpt-4o, ...
    """
    headers = {
        "Authorization": f"Bearer {api_key.strip()}",
        "Content-Type": "application/json",
    }

    messages: List[Dict[str, Any]] = []
    if system_instruction:
        messages.append({"role": "system", "content": system_instruction})

    # Xử lý prompt: có thể là string hoặc list các part (text / base64 image)
    user_content: Any = None
    if isinstance(prompt, str):
        user_content = prompt
    elif isinstance(prompt, list):
        has_image = False
        parts_data: List[Dict[str, Any]] = []
        for item in prompt:
            if isinstance(item, str):
                parts_data.append({"type": "text", "text": item})
            elif isinstance(item, dict):
                if "text" in item:
                    parts_data.append({"type": "text", "text": item["text"]})
                elif "data" in item or "inline_data" in item:
                    has_image = True
                    raw_bytes = item.get("data") or item.get("inline_data", {}).get("data", "")
                    mime = item.get("mime_type") or item.get("inline_data", {}).get("mime_type", "image/jpeg")
                    b64 = base64.b64encode(raw_bytes).decode("utf-8") if isinstance(raw_bytes, bytes) else str(raw_bytes)
                    parts_data.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{b64}"}
                    })
                else:
                    parts_data.append({"type": "text", "text": json.dumps(item, ensure_ascii=False)})
            elif hasattr(item, "inline_data") and getattr(item, "inline_data", None) is not None:
                has_image = True
                inline = getattr(item, "inline_data")
                raw_bytes = getattr(inline, "data", b"")
                mime = getattr(inline, "mime_type", "image/jpeg")
                b64 = base64.b64encode(raw_bytes).decode("utf-8") if isinstance(raw_bytes, bytes) else str(raw_bytes)
                parts_data.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{b64}"}
                })
            elif hasattr(item, "text") and getattr(item, "text", None):
                parts_data.append({"type": "text", "text": str(getattr(item, "text"))})
            elif isinstance(item, bytes):
                has_image = True
                b64 = base64.b64encode(item).decode("utf-8")
                parts_data.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{b64}"}
                })
            else:
                parts_data.append({"type": "text", "text": str(item)})

        if has_image:
            user_content = parts_data
        else:
            user_content = "\n\n".join([p["text"] for p in parts_data if "text" in p])
    else:
        user_content = str(prompt)

    messages.append({"role": "user", "content": user_content})

    payload = {
        "model": model_name,
        "messages": messages,
        "temperature": 0.7,
        "stream": False,
    }

    url = f"{KIE_BASE_URL}/v1/chat/completions"
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(url, headers=headers, json=payload)
        if resp.status_code == 401:
            raise RuntimeError(f"Kie.ai 401 Unauthorized: API Key không hợp lệ")
        elif resp.status_code in (402, 429):
            raise RuntimeError(f"Kie.ai {resp.status_code} Quota/Credits Exceeded")
        elif resp.status_code != 200:
            raise RuntimeError(f"Kie.ai OpenAI HTTP {resp.status_code}: {resp.text[:200]}")

        data = resp.json()
        if "error" in data:
            raise RuntimeError(f"Kie.ai OpenAI error: {data['error']}")

        choices = data.get("choices", [])
        if not choices:
            raise RuntimeError(f"Kie.ai OpenAI trả về rỗng: {resp.text[:200]}")

        content = choices[0].get("message", {}).get("content", "")
        if not content:
            raise RuntimeError(f"Kie.ai OpenAI message content rỗng")
        return content.strip()


class GeminiKeyPool:
    """
    Quản lý xoay vòng (round-robin), failover tự động và Smart Cooldown cho pool Gemini API keys chuẩn production.
    """
    # Cooldown memory store: key_id -> expire_timestamp
    _cooldowns: Dict[int, float] = {}

    @classmethod
    def set_cooldown(cls, key_id: int, seconds: int = 45):
        cls._cooldowns[key_id] = time.time() + seconds
        logger.info(f"⏳ Gemini Key #{key_id} tạm thời cooldown {seconds}s (tự động phục hồi)")

    @classmethod
    def is_cooling_down(cls, key_id: int) -> bool:
        expire = cls._cooldowns.get(key_id, 0)
        return time.time() < expire

    @classmethod
    def clear_cooldown(cls, key_id: int):
        cls._cooldowns.pop(key_id, None)

    @classmethod
    def clear_all_cooldowns(cls):
        cls._cooldowns.clear()

    @staticmethod
    async def get_active_keys(db: AsyncSession) -> List[GeminiApiKey]:
        now = datetime.utcnow()
        stmt = (
            select(GeminiApiKey)
            .where(GeminiApiKey.is_active == True)
            .where(GeminiApiKey.status != GeminiKeyStatus.error)
            .order_by(
                GeminiApiKey.is_default.desc(),
                GeminiApiKey.last_used_at.asc().nullsfirst(),
                GeminiApiKey.id.asc(),
            )
        )
        res = await db.execute(stmt)
        all_keys = list(res.scalars().all())

        updated_any = False
        ready_keys: List[GeminiApiKey] = []
        cooling_keys: List[GeminiApiKey] = []

        for raw_k in all_keys:
            k: Any = raw_k
            # Tự động reset daily_quota_used sang ngày mới
            if k.last_used_at and k.last_used_at.date() < now.date():
                k.daily_quota_used = 0
                if k.status == GeminiKeyStatus.exhausted:
                    k.status = GeminiKeyStatus.active
                updated_any = True

            if k.status == GeminiKeyStatus.error:
                continue

            k_id: int = int(k.id)
            if GeminiKeyPool.is_cooling_down(k_id):
                cooling_keys.append(k)
            else:
                ready_keys.append(k)

        if updated_any:
            await db.commit()

        # Ưu tiên các key không nằm trong cooldown
        return ready_keys if ready_keys else cooling_keys

    @staticmethod
    async def call_with_failover(
        db: AsyncSession,
        prompt: Any,
        system_instruction: Optional[str] = None,
        model_name: str = "gemini-flash-latest",
    ) -> str:
        """Thực hiện gọi Gemini với cơ chế tự động chuyển key và Smart Cooldown chuẩn Production.
        Hỗ trợ cả text prompt và multimodal contents (list of parts/images)."""
        keys = await GeminiKeyPool.get_active_keys(db)
        if not keys:
            if settings.KIE_API_KEY:
                logger.info("Using fallback KIE_API_KEY from environment/settings")
                try:
                    return await call_kie_ai_openai(
                        api_key=settings.KIE_API_KEY,
                        prompt=prompt,
                        system_instruction=system_instruction,
                        model_name="gpt-5-2",
                    )
                except Exception:
                    return await call_kie_ai_gemini(
                        api_key=settings.KIE_API_KEY,
                        prompt=prompt,
                        system_instruction=system_instruction,
                        model_name=model_name,
                    )
            raise RuntimeError(
                "Chưa có Gemini / Kie.ai API Key nào khả dụng trong hệ thống! "
                "Vui lòng vào mục 'Cài Đặt' để kiểm tra hoặc thêm key."
            )

        last_error = None

        for raw_k in keys:
            key_record: Any = raw_k
            api_key: str = decrypt_value(str(key_record.api_key_encrypted))
            key_id: int = int(key_record.id)
            provider: str = getattr(key_record, "provider", "google") or "google"
            is_def: bool = bool(getattr(key_record, "is_default", False))
            preferred_model: str = (getattr(key_record, "preferred_model", "auto") or "auto").strip().lower()

            if provider == "kie":
                if preferred_model and preferred_model != "auto":
                    models_to_try = [preferred_model]
                    for fallback in ["gpt-5-2", "gemini-3-5-flash", "gemini-3-8-flash"]:
                        if fallback not in models_to_try:
                            models_to_try.append(fallback)
                else:
                    models_to_try = ["gpt-5-2", "gemini-3-5-flash", "gemini-3-8-flash"]
            else:
                if preferred_model and preferred_model != "auto":
                    models_to_try = [preferred_model] + [m for m in CANDIDATE_MODELS if m != preferred_model]
                else:
                    models_to_try = [model_name] + [m for m in CANDIDATE_MODELS if m != model_name]

            for m_name in models_to_try:
                try:
                    logger.info(
                        f"🤖 [AI Engine] Gọi AI bằng Key #{key_id} ({key_record.label}) "
                        f"[Provider: {provider.upper()}, Mặc định: {is_def}] | Model: {m_name}"
                    )
                    key_record.last_used_at = datetime.utcnow()
                    curr_quota = getattr(key_record, "daily_quota_used", 0) or 0
                    key_record.daily_quota_used = curr_quota + 1
                    await db.commit()

                    if provider == "kie":
                        if m_name.startswith("gpt-"):
                            reply = await call_kie_ai_openai(
                                api_key=api_key,
                                prompt=prompt,
                                system_instruction=system_instruction,
                                model_name=m_name,
                            )
                        else:
                            reply = await call_kie_ai_gemini(
                                api_key=api_key,
                                prompt=prompt,
                                system_instruction=system_instruction,
                                model_name=m_name,
                            )
                        GeminiKeyPool.clear_cooldown(key_id)
                        return reply

                    if HAS_NEW_GENAI and genai is not None:
                        client = genai.Client(api_key=api_key)
                        config = None
                        if system_instruction and types is not None:
                            config = types.GenerateContentConfig(
                                system_instruction=system_instruction,
                                temperature=0.7,
                                max_output_tokens=8192,
                            )
                        response = client.models.generate_content(
                            model=m_name,
                            contents=prompt,
                            config=config,
                        )
                        GeminiKeyPool.clear_cooldown(key_id)
                        return response.text or ""
                    elif legacy_genai is not None:
                        legacy_genai.configure(api_key=api_key)
                        model = legacy_genai.GenerativeModel(
                            model_name=m_name,
                            system_instruction=system_instruction,
                        )
                        response = model.generate_content(prompt)
                        GeminiKeyPool.clear_cooldown(key_id)
                        return response.text or ""
                    else:
                        raise RuntimeError("Google GenAI SDK chưa được cài đặt")

                except Exception as e:
                    err_str = str(e)
                    last_error = err_str
                    err_lower = err_str.lower()

                    # Model không khả dụng trên API version -> thử model tiếp theo
                    if "404" in err_str or "not found" in err_lower or "no longer available" in err_lower:
                        continue

                    # Server Exception 500, timeout hoặc overload -> Chuyển sang model dự phòng tiếp theo
                    if (
                        "500" in err_str
                        or "timeout" in err_lower
                        or "timed out" in err_lower
                        or "server exception" in err_lower
                        or "capacity" in err_lower
                    ):
                        logger.warning(
                            f"[AI Engine] Model {m_name} (Key #{key_id}) gặp sự cố ({err_str[:80]}). "
                            f"Đang tự động chuyển sang model tiếp theo..."
                        )
                        continue

                    # Key sai hoàn toàn / bị thu hồi
                    if (
                        "401" in err_str
                        or "unauthorized" in err_lower
                        or "api_key" in err_lower
                        or "invalid" in err_lower
                        or "400" in err_str
                        or "permission_denied" in err_lower
                    ):
                        logger.warning(f"Key #{key_id} ({key_record.label} - {provider}) không hợp lệ: {err_str[:100]}")
                        key_record.status = GeminiKeyStatus.error
                        await db.commit()
                        break

                    # 429 Quota / Rate limit hoặc 503 Server Spike -> Cooldown 45s và chuyển model/key khác
                    if (
                        "429" in err_str
                        or "402" in err_str
                        or "credit" in err_lower
                        or "503" in err_str
                        or "quota" in err_lower
                        or "resourceexhausted" in err_lower
                        or "unavailable" in err_lower
                    ):
                        logger.warning(f"Key #{key_id} chạm giới hạn tốc độ/tải trên {m_name}. Cooldown 45s và failover...")
                        GeminiKeyPool.set_cooldown(key_id, seconds=45)
                        continue

                    # Lỗi khác -> thử model hoặc key tiếp theo
                    continue

        raise RuntimeError(
            f"Tất cả {len(keys)} Gemini API keys trong pool đều đang bận hoặc quá tải tạm thời! "
            f"Chi tiết lỗi cuối: {last_error}"
        )


async def translate_chinese_segments(
    db: AsyncSession,
    segments: List[Dict[str, Any]],
    style: str = "đời thường",
) -> List[Dict[str, Any]]:
    """
    Dịch danh sách các đoạn thoại tiếng Trung (có timestamp) sang tiếng Việt
    theo phong cách đã chọn.
    """
    if not segments:
        return []

    _STYLE_CHUAN_GOC = (
        "Accurate 1:1 Dialogue Translation (GenSub/CapCut style): Translate the original spoken Chinese dialogue directly and faithfully into fluent, natural Vietnamese. "
        "CRITICAL RULES: "
        "(1) Translate ONLY what is actually spoken. DO NOT fabricate or invent new dialogue. "
        "(2) MANDATORY CONTEXT-AWARE ASR REPAIR: The Chinese text was auto-recognized by Whisper STT and may contain homophone errors (wrong characters with same Pinyin). "
        "Read ALL lines together to understand the scene (who is speaking, what situation, what emotion), then silently correct any misrecognized homophones BEFORE translating. "
        "NEVER translate garbled/nonsensical Chinese literally — always reconstruct the most logical intended meaning from context first. "
        "(3) The Vietnamese output MUST make complete logical sense and match the on-screen action. If a translation sounds absurd or disconnected, the STT made an error — fix it. "
        "(4) Preserve exact meaning, tone, emotion, and character personality. "
        "(5) Natural conversational Vietnamese only — no stiff Hán-Việt machine translation."
    )
    _STYLE_REVIEW_PHIM = (
        "Movie-Review / Dramatic-Recap style: gripping, tense, fast-paced delivery "
        "(e.g. 'Watch this man closely...', 'No one expected that...', 'In the very next moment...'). "
        "Follow the characters' events and actions closely; sharp, decisive prose that builds emotional intensity without sounding cheesy."
    )
    _STYLE_HOAT_HINH = (
        "AI-Movie / 3D-Animation / Fantasy-World style: vivid, imaginative narration. "
        "Describe the animated/AI characters' expressions and behavior in a witty, curious, or adventurous way "
        "(e.g. 'This lazy little frog...', 'The tiny robot boy...'). Smart, playful dialogue that appeals to all ages."
    )
    _STYLE_BAN_HANG = (
        "Sales / Affiliate / TikTok Shop & Shopee Closing style: "
        "Open with a hook that targets the viewer's everyday pain point or inconvenience. "
        "Emphasize the product's superior function and 'godsend' convenience to spark desire to own it. "
        "Practical, persuasive delivery, closing with a natural, well-placed call to action (CTA) "
        "(e.g. 'Great deal right now, tap the cart in the bottom-left corner to grab it!', 'This convenient — you'll regret not getting one!')."
    )
    _STYLE_NHAN_VAT = (
        "First-Person Character Dubbing / In-Scene Roleplay: Speak DIRECTLY AS the character in the video (first-person 'tôi', 'mình', 'tớ', or character dialogue). "
        "ABSOLUTELY NEVER act as a third-person narrator or storyteller (DO NOT use 'anh ấy', 'cô ấy', 'hãy nhìn người này...', 'chàng trai này...'). "
        "Translate the spoken lines, emotional reactions, or inner thoughts directly as if the character on screen is speaking to the camera or other characters."
    )
    _STYLE_HAI_HUOC = (
        "Viral Comedy & TikTok Slang style: Witty, hilarious, playful, and trend-aware. "
        "Use popular Vietnamese youth idioms, humorous conversational phrases (e.g. 'ối dồi ôi', 'u là trời', 'hết nước chấm', 'tới công chuyện', 'nhìn cái mặt kìa'), "
        "deliver funny character reactions and witty punchlines that keep viewers laughing and glued to the screen."
    )
    _STYLE_HOAT_HINH = (
        "Animated Cartoon & Fantasy Voiceover style: Vivid, imaginative, energetic, and expressive. "
        "Perfect for cute animated characters (e.g. little frog, silly cat, animals, fairy-tale creatures). "
        "Use lively, playful dialogue, mischievous reactions, and humorous storytelling that appeals to viewers of all ages."
    )
    style_guide = {
        "chuan_goc": _STYLE_CHUAN_GOC,
        "chuẩn gốc": _STYLE_CHUAN_GOC,
        "bám sát lời gốc": _STYLE_CHUAN_GOC,
        "bám sát": _STYLE_CHUAN_GOC,
        "đời thường": "Natural, warm, everyday conversational tone. Short and casual, fitting a TikTok/Douyin short-video voiceover.",
        "hài hước": _STYLE_HAI_HUOC,
        "funny": _STYLE_HAI_HUOC,
        "kể chuyện": "Warm, narrative, expressive tone, as if confiding in someone or telling a captivating story.",
        "chuyên gia": "Professional, precise, trustworthy tone with detailed analysis of the product or topic.",
        "review_phim": _STYLE_REVIEW_PHIM,
        "review phim": _STYLE_REVIEW_PHIM,
        "hoạt hình": _STYLE_HOAT_HINH,
        "hoat_hinh_ai": _STYLE_HOAT_HINH,
        "phim_ai": _STYLE_HOAT_HINH,
        "ban_hang": _STYLE_BAN_HANG,
        "bán hàng": _STYLE_BAN_HANG,
        "affiliate": _STYLE_BAN_HANG,
        "nhân vật": _STYLE_NHAN_VAT,
        "nhan_vat": _STYLE_NHAN_VAT,
        "lồng tiếng nhân vật": _STYLE_NHAN_VAT,
    }

    if style in style_guide:
        selected_style_guide = style_guide[style]
    elif style.startswith("custom_"):
        selected_style_guide = style_guide["đời thường"]
    else:
        selected_style_guide = (
            f"MANDATORY CUSTOM STYLE INSTRUCTION FROM USER:\n"
            f"\"\"\"{style}\"\"\"\n"
            f"You MUST strictly follow this custom style, perspective, emotional tone, and phrasing requirements when writing the Vietnamese lines."
        )

    system_instruction = (
        "Bạn là Chuyên gia Dịch thuật & Biên kịch Lồng tiếng Phim/Video ngắn Douyin - TikTok hàng đầu Việt Nam (chuẩn điện ảnh quốc tế tương tự GenSubAI / CapCut).\n"
        "NHIỆM VỤ: Chuyển thể các câu thoại tiếng Trung (thu được từ nhận diện giọng nói Whisper STT) sang Tiếng Việt Tự Nhiên, Sinh Động, Bắt Tai và Chuẩn Ngữ Cảnh 100%.\n\n"
        f"Yêu cầu phong cách: {selected_style_guide}\n\n"
        "BỘ NGUYÊN TẮC VÀNG DỊCH THUẬT & KHỚP KHẨU HÌNH (ÁP DỤNG CHO MỌI THỂ LOẠI VIDEO):\n\n"
        "1. CƠ CHẾ HIỆU ĐÍNH NGỮ ÂM AI (ASR PHONETIC CONTEXTUAL DECODER):\n"
        "   - Văn bản gốc được trích xuất tự động từ âm thanh bằng AI (Whisper STT). Do ảnh hưởng của nhạc nền, tiếng thở, giọng nhân vật hoạt hình hoặc khẩu âm địa phương, nhiều chữ Hán có thể bị nhận diện nhầm thành TỪ ĐỒNG ÂM (cùng âm đọc Pinyin nhưng sai mặt chữ Hán, ví dụ thành ngữ, từ lóng, danh từ xưng hô).\n"
        "   - NGUYÊN TẮC BẮT BUỘC: Đọc toàn bộ chuỗi hội thoại của phân cảnh, dựa vào âm đọc Pinyin và logic cốt truyện để KHÔI PHỤC CHÍNH XÁC Ý NGHĨA THỰC SỰ mà nhân vật đang nói. Tuyệt đối không bao giờ dịch bám chấp mù quáng vào từng mặt chữ Hán bị nghe nhầm.\n"
        "   - CÁC VÍ DỤ ĐỒNG ÂM KINH ĐIỂN CẦN TỰ ĐỘNG SỬA:\n"
        "     * 我应了/我硬了...你就放了我熊殿/兄弟 -> Âm Pinyin gốc: 'Wǒ yíng le nǐ jiù fàng le wǒ xiōngdì' (我赢了你就放了我兄弟). Dịch chuẩn: 'Nếu tao thắng thì mày phải thả anh em tao ra!' (TUYỆT ĐỐI CẤM dịch ngô nghê thành 'Tao đồng ý thì mày thả tao ra' làm ngược hoàn toàn tình huống nhân vật thách đấu cứu bạn!).\n"
        "     * 就屏你 / 就瓶你 / 就聘你 -> Âm Pinyin gốc: '就凭你？' (Chỉ dựa vào loại như mày á? / Cỡ như chú mà đòi so à?).\n"
        "     * 那就赖吧 / 那就来巴 -> Âm Pinyin gốc: '那就来吧！' (Thế thì nhào vô! / Được, tới luôn đi!).\n"
        "     * 我用这一车紧转/金转 和你换回胖毛/胖猫 -> Âm Pinyin gốc: 'Wǒ yòng zhè yī chē jīnzhuān, hé nǐ huàn huí Pàngmāo' (我用这一车金砖, 和你换回胖猫). Dịch chuẩn: 'Tao dùng cả xe gạch vàng này đổi lấy Mèo Béo!'.\n"
        "     * 小体右眼不是台山 / 小体有眼... -> Âm Pinyin gốc: '小弟有眼不识泰山' (Tiểu đệ có mắt như mù không thấy Thái Sơn!).\n"
        "     * 胖毛被黑石团火/团伙抓了 -> Gốc: '胖猫被黑石团伙抓了' (Mèo Béo bị băng nhóm Hắc Thạch bắt rồi!).\n"
        "     * 这下胖毛又救了 / 救了 -> Gốc: '这下胖猫有救了！' (Lần này Mèo Béo được cứu rồi!).\n"
        "     * 哎呀妈呀 / 吓死老子了 / 吓死绿了 -> Khẩu ngữ Đông Bắc: 'Ái da má ơi!', 'Dọa chết khiếp rồi!'.\n"
        "     * 大丝 / 大帝 / 大士 -> Gốc: '大哥 / 大师' (Đại ca! / Sư phụ!).\n"
        "   - BẢO ĐẢM TÍNH LOGIC HÀNH ĐỘNG CỦA CÂU CHUYỆN: Lời thoại phải phản ánh đúng hành vi của nhân vật (ai thách đấu, ai bị trói, ai cứu người), không bao giờ dịch ra những câu phi logic hoặc câu văn dịch máy tối nghĩa.\n\n"
        "2. TUYỆT ĐỐI XÓA BỎ DỊCH THÔ HÁN VIỆT & VĂN PHONG DỊCH MÁY:\n"
        "   - NGHIÊM CẤM dịch âm Hán Việt thô, tối nghĩa, ngô nghê hoặc câu từ sáo rỗng mà người Việt hiện đại không ai dùng trong giao tiếp đời thường.\n"
        "   - Chuyển ngữ sang KHẨU NGỮ TIẾNG VIỆT ĐỜI THƯỜNG: tự nhiên, sinh động, biểu cảm, giàu cảm xúc, dí dỏm, sử dụng linh hoạt các từ cảm thán và quán ngữ Việt Nam.\n\n"
        "3. BẢO ĐẢM TÍNH NHẤT QUÁN CỦA NHÂN VẬT & PHÂN VAI HỘI THOẠI (STRICT CHARACTER DIALOGUE CONSISTENCY - CỰC KỲ QUAN TRỌNG):\n"
        "   - ĐỌC TOÀN BỘ KỊCH BẢN ĐỂ THEO DÕI HỘI THOẠI (DIALOGUE CONTEXT & TURN-TAKING):\n"
        "     * Hãy xác định rõ ràng ai đang nói với ai (Ví dụ: Nhân vật A - Nam chính/Chú Cóc, Nhân vật B - Nữ chính/Công Chúa/Bác Gấu/Kẻ thù, hoặc 'narrator' là người dẫn chuyện).\n"
        "     * Khi hai nhân vật đối thoại qua lại, lời thoại sẽ luân phiên (A nói -> B đáp -> A nói tiếp -> B trả lời).\n"
        "   - NGUYÊN TẮC BẤT DI BẤT DỊCH - CÙNG 1 NHÂN VẬT TUYỆT ĐỐI KHÔNG ĐƯỢC ĐỔI GIỌNG GIỮA CHỪNG:\n"
        "     * Nhân vật A một khi đã được xác định là 'male' (nam) thì MỌI CÂU NÓI CỦA NHÂN VẬT A XUYÊN SUỐT CẢ VIDEO PHẢI LUÔN LÀ 'male'. Tuyệt đối cấm nhân vật A đang nói giọng nam, đến đoạn sau lại bị nhảy sang giọng nữ 'female' chỉ vì câu đó chứa từ cảm thán, la hét hay than thở!\n"
        "     * Tương tự, nếu nhân vật B là 'female' (nữ) thì MỌI CÂU CỦA NHÂN VẬT B BẮT BUỘC PHẢI LUÔN LÀ 'female' từ đầu tới cuối phim.\n"
        "   - 'narrator': Chỉ dùng cho lời thuyết minh, bình luận ngoài khung hình (không phải nhân vật trong phim đang mở miệng nói).\n"
        "   - BẮT BUỘC xuất thêm trường 'character': 'A' | 'B' | 'narrator' để hệ thống tự động khóa chặt giọng đọc cho từng nhân vật.\n\n"
        "4. ĐỒNG BỘ KHỚP NHÉP MIỆNG & THỜI LƯỢNG NÓI (LIP-SYNC CADENCE):\n"
        "   - Mỗi câu thoại có `duration_sec` và yêu cầu `target_syllables`. Tốc độ đọc tiếng Việt chuẩn là ~3.2 - 3.8 âm tiết / giây.\n"
        "   - BẮT BUỘC: Câu tiếng Việt `vi` PHẢI ĐẠT ĐỘ DÀI ÂM TIẾT nằm đúng trong khoảng `target_syllables` yêu cầu.\n"
        "   - NẾU `duration_sec` DÀI (từ 3.5s trở lên): TUYỆT ĐỐI CẤM DỊCH NGẮN CỦN CỠN 5-8 CHỮ! Dịch ngắn sẽ làm tiếng dứt quá sớm trong khi nhân vật vẫn tiếp tục nhép miệng cử động trên màn hình. Hãy diễn đạt đầy đủ, thêm từ ngữ khẩu ngữ, thán từ cảm thán để câu nói kéo dài lấp đầy vừa vặn thời lượng.\n"
        "   - NẾU `duration_sec` NGẮN (<= 2s): Dịch thật gãy gọn, súc tích, dứt khoát đúng số từ yêu cầu.\n\n"
        "5. TUYỆT ĐỐI 100% TIẾNG VIỆT THUẦN TÚY:\n"
        "   - Không để sót bất kỳ chữ Hán nào trong bản dịch 'vi'.\n\n"
        "6. ĐỊNH DẠNG ĐẦU RA:\n"
        "   Chỉ xuất kết quả dưới dạng mảng JSON thuần túy: [{\"id\": 0, \"character\": \"A\", \"vi\": \"...\", \"speaker\": \"male\"|\"female\"|\"narrator\"}], tuyệt đối không bọc markdown ```json và không kèm giải thích."
    )

    BATCH_SIZE = 80
    batches = [segments[i : i + BATCH_SIZE] for i in range(0, len(segments), BATCH_SIZE)]
    semaphore = asyncio.Semaphore(3)

    async def _translate_batch(batch: List[Dict[str, Any]]) -> Dict[Any, Dict[str, Any]]:
        batch_items = []
        for i, s in enumerate(batch):
            dur = round(float(s.get("end", 0.0)) - float(s.get("start", 0.0)), 2)
            dur = max(0.4, dur)
            min_syl = max(3, int(round(dur * 3.2)))
            max_syl = max(min_syl + 1, int(round(dur * 3.8)))
            batch_items.append({
                "id": s.get("id", i),
                "zh": s.get("text", ""),
                "duration_sec": dur,
                "target_syllables": f"{min_syl}-{max_syl} chữ",
            })

        prompt = (
            "Translate the following dialogue lines into Vietnamese with strict character tracking and speaker consistency. Return as JSON array:\n"
            '[{"id": 0, "character": "A", "vi": "Vietnamese translation", "speaker": "male|female|narrator"}, ...]\n\n'
            "Source data:\n"
            + json.dumps(batch_items, ensure_ascii=False, indent=2)
        )
        async with semaphore:
            try:
                raw_reply = await GeminiKeyPool.call_with_failover(
                    db=db,
                    prompt=prompt,
                    system_instruction=system_instruction,
                )
                return _parse_translation_reply(raw_reply)
            except Exception as e:
                logger.error(f"[Translate] Lỗi dịch lô ({len(batch)} câu): {e}")
                raise RuntimeError(f"Lỗi dịch AI Gemini: {e}")

    batch_results = await asyncio.gather(*[_translate_batch(b) for b in batches])
    trans_map: Dict[Any, Dict[str, Any]] = {}
    for m in batch_results:
        trans_map.update(m)

    # Phase 1: Xây dựng bản đồ khóa giọng đọc cho từng nhân vật (Character Voice Locking)
    char_speaker_lock: Dict[str, str] = {}
    for i, s in enumerate(segments):
        seg_id = s.get("id", i)
        val = trans_map.get(seg_id) or trans_map.get(str(seg_id)) or trans_map.get(i)
        if isinstance(val, dict):
            c_id = str(val.get("character") or "").strip().upper()
            spk = str(val.get("speaker") or "").strip().lower()
            if c_id and c_id not in ["NARRATOR", "NONE", "DAN_CHUYEN", "THUYET_MINH", ""]:
                if c_id not in char_speaker_lock and spk in ["male", "female", "narrator"]:
                    char_speaker_lock[c_id] = spk

    # Phase 2: Ráp nối bản dịch và ép buộc cố định giọng theo nhân vật đã khóa
    result = []
    for i, s in enumerate(segments):
        seg_id = s.get("id", i)
        val = (
            trans_map.get(seg_id)
            or trans_map.get(str(seg_id))
            or (trans_map.get(int(seg_id)) if isinstance(seg_id, str) and seg_id.isdigit() else None)
            or trans_map.get(i)
            or trans_map.get(str(i))
        )
        if isinstance(val, dict):
            vi_text = val.get("vi", "")
            raw_spk = str(val.get("speaker") or "narrator").strip().lower()
            c_id = str(val.get("character") or "").strip().upper()
            if c_id in char_speaker_lock:
                speaker = char_speaker_lock[c_id]
            elif raw_spk in ["male", "female", "narrator"]:
                speaker = raw_spk
            else:
                speaker = "narrator"
        else:
            vi_text = str(val or "")
            speaker = "narrator"

        if not vi_text:
            # Fallback dịch riêng dòng này nếu LLM vô tình bỏ sót
            try:
                logger.warning(f"[Translate] Câu thoại #{seg_id} bị sót trong batch, gọi AI dịch bổ sung...")
                single_reply = await GeminiKeyPool.call_with_failover(
                    db=db,
                    prompt=f"Dịch câu thoại sau sang tiếng Việt tự nhiên ngắn gọn đúng tinh thần phim: {s.get('text', '')}. CHỈ trả về đúng câu tiếng Việt dịch được, không kèm JSON, không kèm id hay bất kỳ định dạng nào.",
                    system_instruction="Bạn là chuyên gia dịch thuật phim. Nhiệm vụ: Dịch câu thoại sang tiếng Việt tự nhiên, đời thường. CHỈ TRẢ VỀ DUY NHẤT CÂU TIẾNG VIỆT THUẦN TÚY, TUYỆT ĐỐI KHÔNG TRẢ VỀ JSON, KHÔNG NGOẶC VUÔNG, KHÔNG KÈM GIẢI THÍCH.",
                )
                vi_text = _clean_vi_text(single_reply)
            except Exception as e:
                logger.error(f"[Translate] Thử dịch lại câu #{seg_id} thất bại: {e}")
                raise RuntimeError(f"Câu thoại #{seg_id} không dịch được sang tiếng Việt. Vui lòng kiểm tra lại API Key.")

        vi_text = _clean_vi_text(vi_text)
        result.append({
            **s,
            "text_vi": vi_text,
            "speaker": speaker if speaker in ["male", "female", "narrator"] else "narrator",
        })

    # Phase 3: Dialogue Blip Smoothing (Làm mịn hội thoại)
    # Khắc phục lỗi: Nhân vật A đang nói, có 1 tiếng cảm thán ngắn < 1.3s bị AI gán nhầm sang giọng B,
    # sau đó ngay lập tức vẫn là nhân vật A tiếp tục nói.
    for i in range(1, len(result) - 1):
        prev_spk = result[i - 1].get("speaker")
        curr_spk = result[i].get("speaker")
        next_spk = result[i + 1].get("speaker")
        try:
            curr_dur = float(result[i].get("end", 0.0)) - float(result[i].get("start", 0.0))
            gap_before = float(result[i].get("start", 0.0)) - float(result[i - 1].get("end", 0.0))
            if prev_spk == next_spk and curr_spk != prev_spk and curr_dur < 1.3 and gap_before < 1.0:
                logger.info(f"[Translate] Tự động sửa lỗi nhảy giọng tại câu #{i}: đổi từ '{curr_spk}' sang '{prev_spk}' để giữ vững nhất quán nhân vật.")
                result[i]["speaker"] = prev_spk
        except Exception:
            pass

    return result


def _clean_vi_text(text: str) -> str:
    """
    Xóa bỏ hoàn toàn các ký tự cú pháp JSON bị rò rỉ ([{id:0,vi:...}]),
    loại bỏ chữ Hán còn sót lại và chuẩn hóa khoảng trắng.
    """
    if not text:
        return ""
    text = text.strip()

    # 1. Bóc tách nếu văn bản vô tình bị bọc trong cú pháp JSON/regex
    m = re.search(r'["\']?vi["\']?\s*:\s*["\']?(.*?)(?:["\']?\s*\}|\]|\Z)', text, re.DOTALL | re.IGNORECASE)
    if m:
        extracted = m.group(1).strip()
        if extracted:
            text = extracted

    # Loại bỏ tiền tố JSON còn sót nếu có: [{id:0,vi: hoặc {"vi":
    text = re.sub(r'^\[?\{?\s*["\']?id["\']?\s*:\s*\w+\s*,?\s*["\']?vi["\']?\s*:\s*["\']?', '', text, flags=re.IGNORECASE)
    # Loại bỏ hậu tố JSON: }] hoặc "}
    text = re.sub(r'["\']?\s*\}?\s*\]?$', '', text)

    common_replacements = {
        "凭": "dựa",
        "大": "đại",
        "狮": "sư",
        "猫": "mao",
        "熊": "hùng",
    }
    for ch, repl in common_replacements.items():
        text = text.replace(ch, repl)
    text = re.sub(r"[\u4e00-\u9fff]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def _parse_translation_reply(raw_reply: str) -> Dict[Any, Dict[str, Any]]:
    """
    Phân tích phản hồi dịch của Gemini/GPT thành map {id: {"vi": text_vi, "speaker": speaker}}.
    Hỗ trợ linh hoạt:
    1. Mảng JSON chuẩn: [{"id": 0, "vi": "...", "speaker": "male"|"female"|"narrator"}]
    2. Object JSON đơn lẻ: {"id": 0, "vi": "..."}
    3. JSON unquoted keys hoặc regex trích xuất nếu cú pháp bị thiếu ngoặc
    """
    trans_map: Dict[Any, Dict[str, Any]] = {}
    if not raw_reply:
        return trans_map
    raw_reply = raw_reply.strip()

    # 1. Thử parse mảng JSON chuẩn [...]
    json_match = re.search(r"\[.*\]", raw_reply, re.DOTALL)
    if json_match:
        try:
            translated_list = json.loads(json_match.group(0))
            if isinstance(translated_list, list):
                for item in translated_list:
                    if isinstance(item, dict) and "id" in item:
                        spk = str(item.get("speaker") or "narrator").lower().strip()
                        if spk not in ["male", "female", "narrator"]:
                            spk = "narrator"
                        char_id = str(item.get("character") or item.get("char") or "").strip()
                        trans_map[item["id"]] = {
                            "vi": _clean_vi_text(item.get("vi", "")),
                            "speaker": spk,
                            "character": char_id,
                        }
                if trans_map:
                    return trans_map
        except (json.JSONDecodeError, TypeError, KeyError):
            pass

    # 2. Thử parse Object JSON đơn lẻ {...}
    obj_match = re.search(r"\{[^{}]*\}", raw_reply, re.DOTALL)
    if obj_match:
        try:
            item = json.loads(obj_match.group(0))
            if isinstance(item, dict) and "id" in item and "vi" in item:
                spk = str(item.get("speaker") or "narrator").lower().strip()
                if spk not in ["male", "female", "narrator"]:
                    spk = "narrator"
                char_id = str(item.get("character") or item.get("char") or "").strip()
                return {item["id"]: {"vi": _clean_vi_text(item.get("vi", "")), "speaker": spk, "character": char_id}}
        except (json.JSONDecodeError, TypeError):
            pass

    # 3. Regex linh hoạt trích xuất từng cặp id và vi
    pattern = re.compile(r'["\']?id["\']?\s*:\s*["\']?(\d+)["\']?\s*,\s*["\']?vi["\']?\s*:\s*["\']?([^}\]\n\r]+)', re.IGNORECASE)
    for m in pattern.finditer(raw_reply):
        try:
            idx = int(m.group(1))
            val = _clean_vi_text(m.group(2))
            if val:
                trans_map[idx] = {"vi": val, "speaker": "narrator"}
        except Exception:
            continue

    if trans_map:
        logger.info(f"[Translate] Khôi phục thành công {len(trans_map)} câu thoại từ phản hồi AI.")

    return trans_map


STYLE_INSTRUCTIONS = {
    "short": (
        "- STYLE: Short and to the point (AT MOST 1 sentence, under 80 characters).\n"
        "- MANDATORY CONSTRAINTS: DO NOT write anything long-winded or cheesy. DO NOT use clichéd stock phrases such as "
        "'Hey everyone...', 'You won't be able to stop laughing', 'too much of a waste not to show your loved one', 'super useful today'.\n"
        "- Write directly and naturally, focused on the single most important highlight of the product/video."
    ),
    "affiliate": (
        "- STYLE: Sales / Deal-hunting / Call-to-action (1-2 short sentences, under 100 characters).\n"
        "- Highlight the practical value, a great price, or a hot deal, and prompt viewers to check the cart in the bottom-left corner or buy now.\n"
        "- Use down-to-earth, practical wording — avoid flowery or overly sentimental language."
    ),
    "humorous": (
        "- STYLE: Humorous, witty, trend-aware (1-2 short sentences, under 100 characters).\n"
        "- Speak in a charming, upbeat, natural way as if a friend were sharing something — no exaggerated or over-the-top tone."
    ),
    "curiosity": (
        "- STYLE: Curiosity-driven, designed to spark engagement (1-2 short sentences, under 100 characters).\n"
        "- Use an open question or an unexpected opening that makes viewers want to watch to the end or leave a comment."
    ),
    "minimal": (
        "- STYLE: Minimalist, authentic review tone (1 ultra-short sentence, under 60 characters).\n"
        "- Go straight to the real-world use or benefit. No excessive emoji, keep the tone objective."
    ),
}


async def generate_tiktok_caption(
    db: AsyncSession,
    script_text: str,
    include_hashtags: bool = True,
    style: str = "short",
    custom_prompt: Optional[str] = None,
) -> dict[str, Any]:
    """
    Sinh Caption & Hashtags TikTok chuẩn viral từ nội dung kịch bản video tiếng Việt theo phong cách lựa chọn.
    Nếu include_hashtags=False: Chỉ sinh caption thuần, cấm chứa ký tự '#'.
    """
    if not script_text.strip():
        script_text = "Video chia sẻ kiến thức, mẹo vặt hữu ích đời sống và đánh giá sản phẩm."

    hashtag_rule = (
        "- Generate 5 to 8 trending Vietnamese and international hashtags closely related to the video's topic.\n"
        "- Return them as a hashtags array: [\"#meohay\", \"#xuhuong\", ...]"
        if include_hashtags
        else "- DO NOT generate any hashtags. The hashtags array must be empty []. The caption text must NOT contain the '#' character anywhere."
    )

    chosen_style_rule = STYLE_INSTRUCTIONS.get(style, STYLE_INSTRUCTIONS["short"])
    custom_rule = f"- SPECIAL USER REQUEST: {custom_prompt.strip()}\n" if custom_prompt and custom_prompt.strip() else ""

    system_instruction = (
        "You are a content-creation and SEO-optimization expert for short TikTok videos in Vietnam.\n"
        "TASK: Write an engaging caption that captures attention and drives interaction, based on the video's content.\n"
        f"{chosen_style_rule}\n"
        f"{custom_rule}"
        f"{hashtag_rule}\n"
        "CORE RULES:\n"
        "1. The caption MUST match the requested style exactly. Never write long-winded, clichéd, or overly sentimental copy.\n"
        "2. Output ONLY a JSON object in this exact shape:\n"
        '{\n  "title": "Short title",\n  "caption": "Full caption content...",\n  "hashtags": ["#tag1", "#tag2"]\n}\n'
        "3. Do not add any preamble or markdown fences outside the JSON.\n"
        "4. All generated text (title, caption, hashtags) must be written in natural, fluent Vietnamese — this is the final language shown to end users."
    )

    prompt = (
        f"Video script / dialogue content:\n\"\"\"\n{script_text[:1500]}\n\"\"\"\n\n"
        f"Write a TikTok caption in the style: '{style}'. Include hashtags: {'yes' if include_hashtags else 'no'}."
    )

    try:
        raw_reply = await GeminiKeyPool.call_with_failover(
            db=db,
            prompt=prompt,
            system_instruction=system_instruction,
        )

        json_match = re.search(r"\{.*\}", raw_reply, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group(0))
            caption = str(data.get("caption") or data.get("title") or "").strip()
            raw_hashtags = data.get("hashtags") or []
            if not include_hashtags:
                # Xóa sạch bất kỳ ký tự # nào
                caption = re.sub(r"#\S+", "", caption).strip()
                hashtags: list[str] = []
            else:
                hashtags = [
                    f"#{tag.lstrip('#').strip()}"
                    for tag in raw_hashtags
                    if tag.strip()
                ]
                if not hashtags:
                    found_tags = re.findall(r"#\w+", caption)
                    if found_tags:
                        hashtags = [f"#{t.lstrip('#').strip()}" for t in found_tags if len(t) > 1]
                    else:
                        hashtags = ["#xuhuong", "#fyp", "#review", "#videohay", "#tiktokvietnam"]
            return {
                "title": data.get("title", ""),
                "caption": caption,
                "hashtags": hashtags,
            }

        # Fallback nếu model trả về text thuần không có JSON bọc
        clean_text = raw_reply.strip() if raw_reply else ""
        return {
            "title": "Video ngắn thú vị",
            "caption": clean_text or "Video chia sẻ kiến thức và mẹo vặt hữu ích.",
            "hashtags": ["#xuhuong", "#fyp", "#videohay", "#tiktokvietnam"] if include_hashtags else [],
        }
    except Exception as e:
        logger.error(f"[Gemini] Sinh caption thất bại: {e}")
        raise RuntimeError(f"Lỗi tạo Caption AI: {e}. Vui lòng kiểm tra lại API Key trong mục Cài Đặt!")


AFFILIATE_STYLE_GUIDES = {
    "ban_hang": (
        "Phong cách Review Bán hàng / Affiliate / Chốt đơn TikTok Shop & Shopee (Chuẩn chuyển đổi cao):\n"
        "- Mở đầu (Hook 3s đầu): Đánh trúng nỗi đau, sự bất tiện hoặc nhu cầu cấp thiết thường ngày của người xem ('Bác nào đang gặp cảnh...', 'Đừng vội mua nếu chưa biết bí mật này...', 'Cứ tưởng không cần ai ngờ dùng xong mê luôn!').\n"
        "- Thân bài: Nêu bật công năng vượt trội, độ tiện lợi 'thần thánh' và tính kinh tế của sản phẩm. Lời thoại thực tế, thuyết phục, như trải nghiệm thật kích thích ham muốn sở hữu.\n"
        "- Kết thúc (CTA chốt đơn): Kêu gọi hành động khéo léo, tự nhiên ('Đang có giá ưu đãi hời, nhanh tay bấm góc trái chốt đơn nhé!', 'Tiện lợi thế này không rước về thì tiếc hùi hụi!')."
    ),
    "bán hàng": (
        "Phong cách Review Bán hàng / Affiliate / Chốt đơn TikTok Shop & Shopee (Chuẩn chuyển đổi cao):\n"
        "- Mở đầu (Hook 3s đầu): Đánh trúng nỗi đau, sự bất tiện hoặc nhu cầu cấp thiết thường ngày của người xem ('Bác nào đang gặp cảnh...', 'Đừng vội mua nếu chưa biết bí mật này...', 'Cứ tưởng không cần ai ngờ dùng xong mê luôn!').\n"
        "- Thân bài: Nêu bật công năng vượt trội, độ tiện lợi 'thần thánh' và tính kinh tế của sản phẩm. Lời thoại thực tế, thuyết phục, như trải nghiệm thật kích thích ham muốn sở hữu.\n"
        "- Kết thúc (CTA chốt đơn): Kêu gọi hành động khéo léo, tự nhiên ('Đang có giá ưu đãi hời, nhanh tay bấm góc trái chốt đơn nhé!', 'Tiện lợi thế này không rước về thì tiếc hùi hụi!')."
    ),
    "đời thường": "Văn phong tự nhiên, gần gũi, đời thường như bạn bè rỉ tai nhau, ngắn gọn, súc tích, dễ nghe trên video ngắn.",
    "hài hước": "Văn phong hài hước, dí dỏm, bắt trend giới trẻ TikTok, châm biếm nhẹ nhàng, tăng tỷ lệ giữ chân người xem.",
    "chuyên gia": "Văn phong chuyên nghiệp, chuẩn xác, phân tích chi tiết thông số và lợi ích thiết thực, tạo độ tin cậy tuyệt đối.",
    "review thẳng thắn kịch tính": "Phong cách review thẳng thắn, bộc trực, so sánh kịch tính trước và sau khi dùng, vạch trần ưu nhược điểm rõ ràng.",
    "nhân vật": "Lồng tiếng nhân vật trực tiếp (ngôi thứ nhất tôi/mình/tớ), không đóng vai người dẫn chuyện, hóa thân trọn vẹn vào nhân vật đang xuất hiện trong video.",
    "lồng tiếng nhân vật": "Lồng tiếng nhân vật trực tiếp (ngôi thứ nhất tôi/mình/tớ), không đóng vai người dẫn chuyện, hóa thân trọn vẹn vào nhân vật đang xuất hiện trong video.",
}


def resolve_spin_syntax(text: str) -> str:
    """
    Giải mã cú pháp spin syntax [lựa chọn 1|lựa chọn 2|lựa chọn 3]
    thành một lựa chọn ngẫu nhiên, giúp mỗi phiên bản video có nội dung độc nhất.
    """
    if not text or "[" not in text:
        return text

    def _replace_spin(match: Any) -> str:
        raw = match.group(1)
        options = [opt.strip() for opt in raw.split("|") if opt.strip()]
        return random.choice(options) if options else ""

    return re.sub(r"\[([^\]]+)\]", _replace_spin, text)


async def analyze_video_product_multimodal(
    db: AsyncSession,
    video_path: str,
    original_transcript: str = "",
    model_name: str = "gemini-3.8-flash",
) -> Dict[str, Any]:
    """
    Sử dụng Gemini Multimodal Vision và transcript gốc để tự động nhận diện chính xác 100%
    sản phẩm trong video: Tên món đồ, công dụng chính, nỗi đau của cách làm cũ,
    hành động cụ thể diễn ra trong video.
    """
    from app.services.vision_service import extract_video_keyframes
    keyframes = await asyncio.to_thread(extract_video_keyframes, video_path, 6)

    contents: List[Any] = []
    for idx_f, (img_bytes, t_sec) in enumerate(keyframes):
        contents.append(f"Khung hình #{idx_f + 1} (tại mốc {t_sec:.1f}s):")
        if HAS_NEW_GENAI and types is not None:
            contents.append(types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"))
        else:
            contents.append({"mime_type": "image/jpeg", "data": img_bytes})

    prompt_text = (
        "You are a product-recognition and e-commerce content expert (TikTok Shop, Shopee, Douyin).\n"
        "Carefully examine the video keyframes below together with the original audio content to analyze the product:\n\n"
        f"Original video dialogue / audio: \"{original_transcript[:500]}\"\n\n"
        "TASK:\n"
        "1. Identify the accurate, commonly used, appealing Vietnamese name of the product (e.g. 'Bình đựng dầu ăn kèm cọ quét silicone', "
        "'Nồi chiên không dầu mini', 'Máy hút bụi cầm tay').\n"
        "2. Identify the user's pain point / inconvenience before owning this product — e.g. oil spills, a brush that's hard to clean, a messy kitchen, etc.\n"
        "3. Identify the standout feature and how it is used (Key Feature & Benefit).\n"
        "4. Summarize the main actions happening in the video along a timeline.\n"
        "5. Classify the most fitting product category.\n"
        "6. GROUNDING RULE: base every answer strictly on what is actually visible in the frames or heard in the audio. "
        "Never invent a product, brand, feature, or action that is not actually shown or mentioned.\n\n"
        "You MUST return EXACTLY this plain JSON object format (no markdown fences):\n"
        "{\n"
        '  "product_name": "Accurate Vietnamese product name",\n'
        '  "category": "Best-fit category",\n'
        '  "pain_points": "Inconvenience of the old way of doing things",\n'
        '  "key_features": "Standout, convenient features",\n'
        '  "action_summary": "Summary of the actions seen in the video",\n'
        '  "call_to_action": "Tap the cart in the bottom-left corner now for the deal"\n'
        "}\n"
        "IMPORTANT: every string value in the JSON above must be written in natural, fluent Vietnamese — this is the final language shown to end users."
    )
    contents.append(prompt_text)

    try:
        raw_res = await GeminiKeyPool.call_with_failover(
            db=db,
            prompt=contents,
            model_name=model_name,
        )
        json_match = re.search(r"\{.*\}", raw_res, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group(0))
            if data.get("product_name"):
                return data
    except Exception as e:
        logger.warning(f"Lỗi phân tích sản phẩm qua Gemini Vision: {e}")

    return {
        "product_name": "Sản phẩm tiện ích thông minh",
        "category": "Đồ gia dụng & Tiện ích",
        "pain_points": "Cách làm truyền thống bất tiện và tốn thời gian",
        "key_features": "Thiết kế thông minh, tiện lợi và tiết kiệm",
        "action_summary": "Giới thiệu sản phẩm và thao tác sử dụng thực tế",
        "call_to_action": "Bấm ngay giỏ hàng góc trái nhận ưu đãi nhé",
    }


AFFILIATE_STYLES = {
    "kich_tinh": {
        "name": "Dramatic Sales Push (FOMO & Buy-Now Urgency)",
        "desc": (
            "Excited, fast-paced sales style that makes the item feel super hot with limited-time stock. "
            "Use punchy, gripping Vietnamese phrases such as: 'Trời ơi lướt thấy deal này là phải quay ngay cho mấy bà...', "
            "'Cảnh báo ai đang đau đầu vì...', 'Deal này hời dã man, chốt nhanh tay kẻo hết!'."
        ),
    },
    "hai_huoc": {
        "name": "Humorous & Gen-Z TikTok Trend-Chasing",
        "desc": (
            "Witty, playful style using fun trending Vietnamese slang (e.g. 'mấy ní ơi', 'u là trời', 'nhìn mà mê chữ ê kéo dài', "
            "'cưng xỉu', 'cứu tinh của đời tôi'). Frame it like a funny-but-honest friend recounting past frustration and the joy of finally owning the item."
        ),
    },
    "chuyen_gia": {
        "name": "Expert Analysis & Hands-On Review",
        "desc": (
            "Knowledgeable, product-savvy tone delivered in a down-to-earth, relatable voice. "
            "Clearly point out the material, smart construction, and why this item beats ordinary alternatives. "
            "Natural phrasing such as: 'Dùng em này rồi mới thấy...', 'Chất liệu cao cấp sờ cực kỳ đầm tay...', "
            "'Giặt máy vô tư không lo bai dão', 'Rất đáng để đầu tư'."
        ),
    },
    "doi_thuong": {
        "name": "Everyday Experience & Authentic Storytelling",
        "desc": (
            "Down-to-earth, relatable, authentic tone as if two friends are chatting. "
            "Tell a genuine little story, e.g.: 'Mấy hôm trước nấu ăn bực mình ghê gớm vì...', "
            "'May mà lụm được em này về dùng, ưng dã man luôn các bác ạ', 'Cuộc sống thảnh thơi hơn hẳn'."
        ),
    },
    "boc_phot": {
        "name": "Skeptical Exposé Turned Praise (Doubt-to-Delight)",
        "desc": (
            "Sensational style that starts skeptical and ends up thoroughly impressed. "
            "Open with lines like: 'Thấy rầm rộ trên mạng mua về tính bóc phốt, ai ngờ nó xịn thật sự...', "
            "'Nói thật lúc đầu tưởng đồ vô dụng phí tiền, nhưng dùng thử xong câm nín luôn'."
        ),
    },
    "meo_vat": {
        "name": "Smart Life-Hack Sharing",
        "desc": (
            "Enthusiastic, helpful tips-sharing style that solves a problem quickly. "
            "Open with lines like: 'Ai hay gặp cảnh này lưu ngay mẹo này lại nha', "
            "'Bí quyết giúp tiết kiệm 50% thời gian bếp núc là đây', 'Đơn giản mà tiện lợi không ngờ'."
        ),
    },
}


def group_stt_into_scenes(
    stt_segments: List[Dict[str, Any]],
    total_duration: float,
    min_dur: float = 3.0,
    max_dur: float = 5.5,
) -> List[Dict[str, Any]]:
    """
    Gom nhóm các câu STT ngắn thành các phân cảnh tự nhiên (3.0s - 5.5s) bám sát timeline gốc.
    Đảm bảo phân cảnh cuối cùng kéo dài đến sát hoặc bằng total_duration.
    """
    valid: List[Dict[str, Any]] = []
    for s in stt_segments:
        txt = str(s.get("text") or s.get("text_zh") or "").strip()
        if txt:
            valid.append({
                "start": float(s.get("start", 0.0)),
                "end": float(s.get("end", 0.0)),
                "text": txt,
            })
    if not valid:
        return []

    groups: List[Dict[str, Any]] = []
    curr_start: float = float(valid[0]["start"])
    curr_end: float = float(valid[0]["end"])
    curr_texts: List[str] = [str(valid[0]["text"])]

    for s in valid[1:]:
        st: float = float(s["start"])
        et: float = float(s["end"])
        txt: str = str(s["text"])

        dur_if_merged = et - curr_start
        curr_dur = curr_end - curr_start

        if curr_dur < min_dur or dur_if_merged <= max_dur:
            curr_end = et
            curr_texts.append(txt)
        else:
            groups.append({
                "start": round(curr_start, 2),
                "end": round(curr_end, 2),
                "duration": round(curr_end - curr_start, 2),
                "text_zh": " ".join(curr_texts),
            })
            curr_start = st
            curr_end = et
            curr_texts = [txt]

    if curr_texts:
        groups.append({
            "start": round(curr_start, 2),
            "end": round(curr_end, 2),
            "duration": round(curr_end - curr_start, 2),
            "text_zh": " ".join(curr_texts),
        })

    # Nếu video dài hơn phân cảnh cuối, mở rộng phân cảnh cuối tới total_duration
    if groups and total_duration > 0:
        last_end: float = float(groups[-1]["end"])
        if (total_duration - last_end) > 0.3:
            groups[-1]["end"] = round(total_duration, 2)
            last_start: float = float(groups[-1]["start"])
            groups[-1]["duration"] = round(float(groups[-1]["end"]) - last_start, 2)

    return groups


async def localize_affiliate_from_original_speech(
    db: AsyncSession,
    stt_segments: List[Dict[str, Any]],
    total_duration: float,
    product_name: str,
    price: str = "",
    description: str = "",
    note_script: str = "",
    category: str = "Đồ gia dụng & Tiện ích",
    style_key: str = "doi_thuong",
    version_index: int = 1,
    model_name: str = "gemini-3.8-flash",
) -> Dict[str, Any]:
    """
    Việt hoá trực tiếp kịch bản Affiliate bám sát từng phân cảnh video (Whisper STT):
    - Gom nhóm các câu thoại gốc thành các phân cảnh 3.0s - 5.5s tương ứng chuẩn xác với từng hành động trên màn hình.
    - Thuyết minh đúng sự việc tại thời điểm mắt người xem nhìn thấy (không đảo lộn, không bị lệch).
    - Phân cảnh cuối cùng kéo dài đến sát cuối video kèm CTA giỏ hàng góc trái săn deal.
    """
    style_info = AFFILIATE_STYLES.get(style_key, AFFILIATE_STYLES["kich_tinh"])
    scenes = group_stt_into_scenes(stt_segments, total_duration)
    if not scenes:
        return {}

    prompt_scenes = []
    for idx, sc in enumerate(scenes):
        est_words = int(sc["duration"] * 2.5)
        min_w = max(4, est_words - 2)
        max_w = est_words + 1
        prompt_scenes.append(
            f"- Scene #{idx + 1} [{sc['start']:.1f}s -> {sc['end']:.1f}s] ({sc['duration']:.1f}s, MUST be {min_w} to {max_w} words):\n"
            f"  Original dialogue: \"{sc['text_zh']}\""
        )
    scenes_text = "\n".join(prompt_scenes)

    system_instruction = (
        "You are a leading Vietnamese creative director for viral TikTok Shop & Reels voiceover scripts.\n"
        f"REQUIRED STYLE: {style_info['name']}\n"
        f"{style_info['desc']}\n\n"
        "'VISUAL-SYNCED AFFILIATE LOCALIZATION' PRINCIPLE (MUST BE FOLLOWED 100%):\n"
        "1. FOLLOW THE ACTUAL ON-SCREEN PROGRESSION (VISUAL SYNCHRONIZATION):\n"
        "   - Each scene is already aligned to a specific timestamp of what happens in the video. Never reveal or narrate the action of a later scene early!\n"
        "   - Scene 1: Freely adapt the original creator's opening line into a catchy hook that introduces the item currently on screen.\n"
        "   - Middle scenes: Narrate the exact action, feature, or old pain point happening at that specific scene.\n"
        "   - Final scene (ending at the last second of the video): Wrap up the benefits and ALWAYS INCLUDE A CALL TO ACTION TO TAP THE CART IN THE BOTTOM-LEFT CORNER FOR THE DEAL!\n"
        "2. GOLDEN LENGTH RULE (MUST BE FOLLOWED SO NO SCENE OVERRUNS):\n"
        "   - Each scene only lasts a few short seconds. EVERY LINE MUST BE SHORT AND CONCISE, MATCHING THE REQUIRED WORD COUNT (roughly 8 to 12 words per line).\n"
        "   - NEVER WRITE A LONG-WINDED LINE (never exceed 13 words)! Every extra word pushes the voiceover into the next scene and desyncs it from the visuals!\n"
        "3. NARRATE ALL THE WAY TO THE END OF THE VIDEO: The number of lines must exactly equal the number of scenes given. The voiceover should flow evenly and end at the video's final second.\n"
        "4. STRICTLY FORBIDDEN: robotic or stiff translated phrasing such as 'after the experience', 'this product', or bookish idioms. Use natural, everyday language like a real TikTok creator.\n"
        "5. GROUNDING RULE: only narrate the original dialogue and action of the exact scene assigned to it — never invent a detail, feature, or plot point that isn't in the source data.\n\n"
        "You MUST return a plain JSON object (no ```json markdown fences):\n"
        "{\n"
        '  "title": "Catchy video title (under 60 characters)",\n'
        '  "caption": "Engaging, SEO-friendly TikTok caption prompting viewers to check the cart",\n'
        '  "hashtags": ["#tag1", "#tag2", "#tag3", "#xuhuong", "#tiktokshop"],\n'
        '  "segments": [\n'
        '    {\n'
        '      "id": 1,\n'
        '      "text": "Short Vietnamese line for scene 1"\n'
        '    }\n'
        '  ]\n'
        "}\n"
        "IMPORTANT: every string value in the JSON (title, caption, hashtags, and every segment's text) must be written in natural, "
        "fluent Vietnamese — this is the final language shown to end users."
    )

    resolved_note = resolve_spin_syntax(note_script)
    resolved_desc = resolve_spin_syntax(description)

    prompt = (
        f"=== PRODUCT & ORIGINAL VIDEO INFO ===\n"
        f"- Product name: {product_name}\n"
        f"- Price: {price or 'Best price available in the cart, bottom-left corner'}\n"
        f"- Category: {category}\n"
        f"- Total video duration: {total_duration:.1f} seconds\n"
        f"- Version number: {version_index} (make this a fresh, creative, engaging angle)\n"
        f"- Additional notes: {resolved_note or 'Emphasize practicality and a great price'}\n"
        f"- Product description: {resolved_desc[:250] if resolved_desc else 'None'}\n\n"
        f"=== VIDEO SCENES (WITH TIMESTAMPS & ORIGINAL DIALOGUE) ===\n"
        f"{scenes_text}\n\n"
        f"Localize and script a short Vietnamese voiceover (8-12 words per line) for each scene above!"
    )

    try:
        raw_reply = await GeminiKeyPool.call_with_failover(
            db=db,
            prompt=prompt,
            system_instruction=system_instruction,
            model_name=model_name,
        )
        json_match = re.search(r"\{.*\}", raw_reply, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group(0))
            raw_segments = data.get("segments") or []
            formatted_segments = []

            # Ghép chuẩn xác mốc thời gian start/end của từng phân cảnh tương ứng
            for i, seg in enumerate(raw_segments):
                txt = (seg.get("text") or seg.get("text_vi") or "").strip()
                if not txt:
                    continue
                sc = scenes[i] if i < len(scenes) else scenes[-1]
                # Đảm bảo câu không bị quá dài gây tràn phân cảnh
                words = txt.split()
                max_allowed_words = int(sc["duration"] * 3.1) + 2
                if len(words) > max_allowed_words:
                    txt = " ".join(words[:max_allowed_words]).rstrip(",;") + "."

                formatted_segments.append({
                    "order_index": i,
                    "scene_id": i,
                    "start": sc["start"],
                    "end": sc["end"],
                    "duration": sc["duration"],
                    "text": txt,
                    "text_vi": txt,
                })

            if formatted_segments:
                raw_tags = data.get("hashtags") or ["#xuhuong", "#tiktokshop", "#review", "#affiliate"]
                clean_tags = [f"#{t.lstrip('#').strip()}" for t in raw_tags if t.strip()]
                return {
                    "title": data.get("title") or f"Review {product_name}",
                    "caption": data.get("caption") or f"Trải nghiệm {product_name} siêu ưng ý! Bấm giỏ hàng góc trái săn ưu đãi nhé ✨",
                    "hashtags": clean_tags,
                    "segments": formatted_segments,
                    "style_used": style_key,
                }
    except Exception as e:
        logger.warning(f"Lỗi khi Việt hoá Affiliate từ lời gốc: {e}")

    return {}


async def generate_affiliate_script_vision(
    db: AsyncSession,
    video_path: str,
    total_duration: float,
    product_name: str,
    price: str = "",
    description: str = "",
    note_script: str = "",
    category: str = "Đồ gia dụng & Tiện ích",
    style_key: str = "doi_thuong",
    version_index: int = 1,
    model_name: str = "gemini-3.8-flash",
    product_analysis: Optional[Dict[str, Any]] = None,
    precomputed_keyframes: Optional[List[Any]] = None,
    scenes: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Sáng tác kịch bản lồng tiếng Affiliate trực tiếp từ chuỗi khung hình video (Gemini Multimodal Vision):
    - Dành cho video không có lời nói (chỉ có nhạc nền/hiệu ứng) hoặc chế độ Thuyết Minh Thị Giác (Scene Sync).
    - AI quan sát toàn bộ diễn biến thị giác và thuyết minh đúng những gì mắt người xem thấy trên màn hình.
    - Bám sát từng mốc phân cảnh (Scene Timeline) của PySceneDetect, tuyệt đối không gán mốc 0.0s.
    """
    from app.services.vision_service import extract_video_keyframes, calculate_optimal_keyframes_count

    style_info = AFFILIATE_STYLES.get(style_key, AFFILIATE_STYLES["kich_tinh"])
    if precomputed_keyframes is not None:
        keyframes = precomputed_keyframes
    else:
        num_frames = calculate_optimal_keyframes_count(total_duration)
        keyframes = await asyncio.to_thread(extract_video_keyframes, video_path, num_frames)

    contents: List[Any] = []
    for idx_f, (img_bytes, t_sec) in enumerate(keyframes):
        contents.append(f"Khung hình #{idx_f + 1} (tại mốc {t_sec:.1f}s):")
        if HAS_NEW_GENAI and types is not None:
            contents.append(types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"))
        else:
            contents.append({"mime_type": "image/jpeg", "data": img_bytes})

    # Chuẩn bị danh sách phân cảnh mục tiêu (nếu có scenes từ Scene Detection)
    valid_scenes: List[Dict[str, Any]] = []
    if scenes and len(scenes) > 0:
        for idx_s, sc in enumerate(scenes):
            st = float(sc.get("start_time", sc.get("start", 0.0)))
            et = float(sc.get("end_time", sc.get("end", st + 3.0)))
            dur = max(1.5, round(et - st, 2))
            valid_scenes.append({
                "index": idx_s,
                "start": round(st, 2),
                "end": round(et, 2),
                "duration": dur,
            })
    else:
        # Tự động chia nhịp tự nhiên theo độ dài video (3.0s - 5.0s mỗi câu)
        n_segs = 2 if total_duration <= 11.0 else (3 if total_duration <= 18.0 else (4 if total_duration <= 28.0 else 5))
        step = total_duration / n_segs
        for idx_s in range(n_segs):
            st = round(idx_s * step, 2)
            et = round(min(total_duration, (idx_s + 1) * step), 2)
            valid_scenes.append({
                "index": idx_s,
                "start": st,
                "end": et,
                "duration": round(et - st, 2),
            })

    scene_prompt_lines = []
    for s in valid_scenes:
        est_words = int(s["duration"] * 2.4)
        min_w = max(4, est_words - 2)
        max_w = est_words + 2
        scene_prompt_lines.append(
            f"- Phân cảnh #{s['index'] + 1} [{s['start']:.1f}s -> {s['end']:.1f}s] (thời lượng {s['duration']:.1f}s, bắt buộc từ {min_w} đến {max_w} từ)."
        )
    scene_plan_str = "\n".join(scene_prompt_lines)

    target_words = int(max(14, (total_duration - 1.0) * 2.4))
    min_words = max(10, target_words - 5)
    max_words = target_words + 4

    resolved_note = resolve_spin_syntax(note_script)
    resolved_desc = resolve_spin_syntax(description)
    pain_point_hint = product_analysis.get("pain_points") if product_analysis else ""
    key_feat_hint = product_analysis.get("key_features") if product_analysis else ""

    prompt_text = (
        "Bạn là Giám đốc Sáng tạo Nội dung hàng đầu chuyên viết kịch bản lồng tiếng Review Bán hàng TikTok Shop & Reels.\n"
        f"PHONG CÁCH YÊU CẦU: {style_info['name']}\n"
        f"{style_info['desc']}\n\n"
        f"THÔNG TIN VIDEO & SẢN PHẨM:\n"
        f"- Tên sản phẩm: {product_name}\n"
        f"- Ngành hàng: {category}\n"
        f"- Giá bán: {price or 'Giá ưu đãi trong giỏ hàng góc trái'}\n"
        f"- Tổng thời lượng video: {total_duration:.1f} giây\n"
        f"- Nỗi đau người dùng: {pain_point_hint or 'Cách làm cũ bất tiện, tốn công'}\n"
        f"- Điểm nổi bật sản phẩm: {key_feat_hint or 'Tiện lợi, thông minh, bền đẹp'}\n"
        f"- Ghi chú thêm: {resolved_note or 'Nhấn mạnh tính tiện dụng và giá tốt'}\n"
        f"- Mô tả sản phẩm: {resolved_desc[:250] if resolved_desc else 'Không có'}\n\n"
        f"DANH SÁCH CÁC PHÂN CẢNH THỊ GIÁC BẮT BUỘC KHỚP LỜI ({len(valid_scenes)} phân cảnh):\n"
        f"{scene_plan_str}\n\n"
        "QUY TẮC VÀNG VIẾT KỊCH BẢN THUYẾT MINH THỊ GIÁC (BẮT BUỘC TUÂN THỦ 100%):\n"
        "1. THUYẾT MINH ĐÚNG HÀNH ĐỘNG ĐANG DIỄN RA Ở TỪNG GIÂY (VISUAL-SYNC):\n"
        "   - Nhìn kỹ từng khung hình: tay đang làm gì, sản phẩm đang hoạt động ra sao.\n"
        "   - Phân cảnh 1 (0s - 3s đầu): Mở đầu bằng một câu Hook giật tít, nêu bật ngay nỗi đau hoặc sự bất ngờ khi thấy món đồ xuất hiện.\n"
        "   - Các phân cảnh giữa: Thuyết minh chuẩn xác thao tác (nhấn, xoay, bóp, kéo, xịt, làm sạch...) và cảm giác sướng khi sử dụng.\n"
        "   - Phân cảnh cuối cùng (kết thúc ở giây cuối video): Kêu gọi hành động (CTA) khéo léo bấm vào giỏ hàng góc trái săn deal hôm nay!\n"
        "2. TUYỆT ĐỐI CẤM VĂN MẪU SÁO RỖNG, GIẢ TẠO:\n"
        "   - CẤM các câu: 'Mọi người đã biết đến em này chưa', 'tiện lắm luôn á', 'sau khi trải nghiệm', 'vô cùng chấn động'.\n"
        "   - Dùng văn phong nói tự nhiên, gần gũi như một người bạn thân kể chuyện thật sự.\n"
        "3. ĐÚNG ĐỘ DÀI CHO TỪNG PHÂN CẢNH: Viết đúng số lượng phân cảnh yêu cầu, mỗi câu đúng trong khoảng số từ cho phép để khi đọc khớp 100% video, không bị trôi tiếng.\n\n"
        "BẮT BUỘC TRẢ VỀ ĐÚNG ĐỊNH DẠNG JSON THUẦN (không kèm ```json):\n"
        "{\n"
        '  "title": "Tiêu đề video giật tít hấp dẫn (dưới 60 ký tự)",\n'
        '  "caption": "Mô tả video chuẩn SEO TikTok kích thích click giỏ hàng",\n'
        '  "hashtags": ["#xuhuong", "#tiktokshop", "#review", "#affiliate"],\n'
        '  "segments": [\n'
        '    {\n'
        '      "order_index": 0,\n'
        '      "text": "Câu thoại tiếng Việt tự nhiên khớp với phân cảnh 1"\n'
        '    }\n'
        '  ]\n'
        "}"
    )
    contents.append(prompt_text)

    try:
        raw_reply = await GeminiKeyPool.call_with_failover(
            db=db,
            prompt=contents,
            model_name=model_name,
        )
        json_match = re.search(r"\{.*\}", raw_reply, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group(0))
            raw_segments = data.get("segments") or []
            formatted_segments = []

            for i, sc in enumerate(valid_scenes):
                seg_text = ""
                for seg in raw_segments:
                    if seg.get("order_index") == i:
                        seg_text = (seg.get("text") or seg.get("text_vi") or "").strip()
                        break
                if not seg_text and i < len(raw_segments):
                    seg_text = (raw_segments[i].get("text") or raw_segments[i].get("text_vi") or "").strip()

                if not seg_text:
                    if i == 0:
                        seg_text = f"Bác nào hay gặp cảnh phiền phức này thì lụm ngay em {product_name} này về nha!"
                    elif i == len(valid_scenes) - 1:
                        seg_text = "Đang có giá ưu đãi siêu hời, nhanh tay bấm giỏ hàng góc trái chốt đơn nhé!"
                    else:
                        seg_text = "Thao tác cực kỳ mượt mà, tiện lợi mà tiết kiệm bao nhiêu thời gian luôn."

                # Kiểm tra độ dài từ
                words = seg_text.split()
                max_w = int(sc["duration"] * 3.1) + 2
                if len(words) > max_w:
                    seg_text = " ".join(words[:max_w]).rstrip(",;") + "."

                formatted_segments.append({
                    "order_index": i,
                    "scene_id": i,
                    "start": sc["start"],
                    "end": sc["end"],
                    "duration": sc["duration"],
                    "text": seg_text,
                    "text_vi": seg_text,
                })

            if formatted_segments:
                raw_tags = data.get("hashtags") or ["#xuhuong", "#tiktokshop", "#review", "#affiliate"]
                clean_tags = [f"#{t.lstrip('#').strip()}" for t in raw_tags if t.strip()]
                return {
                    "title": data.get("title") or f"Review {product_name}",
                    "caption": data.get("caption") or f"Trải nghiệm {product_name} siêu ưng ý! Bấm giỏ hàng góc trái săn ưu đãi nhé ✨",
                    "hashtags": clean_tags,
                    "segments": formatted_segments,
                    "style_used": style_key,
                }
    except Exception as e:
        logger.warning(f"Lỗi khi sinh kịch bản Affiliate qua Gemini Vision: {e}")

    return {}


async def generate_affiliate_script(
    db: AsyncSession,
    scenes: List[Dict[str, Any]],
    product_name: str,
    price: str = "",
    description: str = "",
    note_script: str = "",
    category: str = "Đồ gia dụng & Tiện ích",
    style: str = "ban_hang",
    version_index: int = 1,
    model_name: str = "gemini-3.8-flash",
    product_analysis: Optional[Dict[str, Any]] = None,
    stt_segments: Optional[List[Dict[str, Any]]] = None,
    video_path: Optional[str] = None,
    precomputed_keyframes: Optional[List[Any]] = None,
    dubbing_mode: str = "auto",
) -> Dict[str, Any]:
    """
    Sinh kịch bản lời thoại review bán hàng (Affiliate) chuẩn chuyển đổi cao:
    - Chế độ 1 ('speech_sync'): Việt hoá Bán Hàng Chuẩn bám sát thoại gốc (Whisper STT như Module Việt Hoá).
    - Chế độ 2 ('scene_sync'): Thuyết minh thị giác từng phân cảnh (Gemini Multimodal Vision + Scenes).
    - Chế độ 3 ('creative_remix'): Sáng tạo đa phiên bản AIDA chuyển đổi cao.
    - Chế độ 'auto': Tự động nhận diện (có lời thoại gốc -> speech_sync, không có -> scene_sync).
    """
    total_dur = sum(s.get("duration", 2.5) for s in scenes) if scenes else 20.0
    total_dur = max(6.0, float(total_dur))

    # Xác định phong cách kịch bản
    all_style_keys = list(AFFILIATE_STYLES.keys())
    if not style or style in ("random", "ban_hang"):
        if style == "ban_hang":
            chosen_key = "kich_tinh"
        else:
            chosen_key = all_style_keys[(version_index - 1) % len(all_style_keys)]
    elif style in AFFILIATE_STYLES:
        chosen_key = style
    else:
        chosen_key = "kich_tinh"

    has_stt = bool(stt_segments) and any((s.get("text") or s.get("text_zh") or "").strip() for s in stt_segments)

    # ─────────────────────────────────────────────────────────────────────────
    # 1. CHẾ ĐỘ 'speech_sync' HOẶC 'auto' (KHI VIDEO CÓ LỜI THOẠI GỐC):
    # Kế thừa công nghệ Việt hoá Bán Hàng chuẩn của Module 1 (khớp cử chỉ & nhịp nói)
    # ─────────────────────────────────────────────────────────────────────────
    if (dubbing_mode == "speech_sync" or (dubbing_mode == "auto" and has_stt)) and has_stt:
        stt_list = stt_segments or []
        logger.info(f"[Affiliate Engine] 🎙️ Kích hoạt Việt hoá Bán Hàng bám sát lời thoại gốc ({len(stt_list)} câu)")
        res_stt = await localize_affiliate_from_original_speech(
            db=db,
            stt_segments=stt_list,
            total_duration=total_dur,
            product_name=product_name,
            price=price,
            description=description,
            note_script=note_script,
            category=category,
            style_key=chosen_key,
            version_index=version_index,
            model_name=model_name,
        )
        if res_stt and res_stt.get("segments"):
            return res_stt

    # ─────────────────────────────────────────────────────────────────────────
    # 2. CHẾ ĐỘ 'scene_sync' HOẶC 'auto' (KHI VIDEO KHÔNG LỜI / THUYẾT MINH THỊ GIÁC):
    # Gemini Multimodal Vision quan sát khung hình và thuyết minh khớp từng cảnh
    # ─────────────────────────────────────────────────────────────────────────
    if video_path and os.path.exists(video_path) and dubbing_mode in ("auto", "scene_sync", "speech_sync"):
        logger.info(f"[Affiliate Engine] 👁️ Kích hoạt Thuyết minh Thị Giác phân cảnh (Visual Action Dubbing)")
        res_vis = await generate_affiliate_script_vision(
            db=db,
            video_path=video_path,
            total_duration=total_dur,
            product_name=product_name,
            price=price,
            description=description,
            note_script=note_script,
            category=category,
            style_key=chosen_key,
            version_index=version_index,
            model_name=model_name,
            product_analysis=product_analysis,
            precomputed_keyframes=precomputed_keyframes,
            scenes=scenes,
        )
        if res_vis and res_vis.get("segments"):
            return res_vis

    style_info = AFFILIATE_STYLES.get(chosen_key, AFFILIATE_STYLES["kich_tinh"])

    # Phân bổ các mốc thời gian mục tiêu thông minh thích ứng theo thời lượng video
    # Tốc độ đọc tiếng Việt tự nhiên: ~2.6 từ / giây
    target_segments_plan: List[Dict[str, Any]] = []
    if total_dur <= 11.0:
        # Video siêu ngắn (< 11s, ví dụ 8s): CHỈ 2 CÂU LIỀN MẠCH, KHÔNG CẮT VỤN
        d1 = round(total_dur * 0.52, 2)
        d2 = round(max(2.0, total_dur - d1 - 0.3), 2)
        target_segments_plan = [
            {
                "order_index": 0,
                "start": 0.0,
                "end": d1,
                "role": "Emotional hook & compelling praise of the product tied to the visuals",
                "target_words": f"{max(7, int(d1 * 2.0))}-{max(8, int(d1 * 2.5))} words",
            },
            {
                "order_index": 1,
                "start": d1,
                "end": round(total_dur - 0.3, 2),
                "role": "Standout benefit & prompt to tap the cart in the bottom-left corner",
                "target_words": f"{max(7, int(d2 * 2.0))}-{max(8, int(d2 * 2.5))} words",
            },
        ]
    elif total_dur <= 17.0:
        # Video ngắn (11s - 17s): 3 câu nhịp nhàng, liền mạch
        d1 = round(total_dur * 0.30, 2)
        d2 = round(total_dur * 0.38, 2)
        t_cta_start = round(d1 + d2, 2)
        t_cta_end = round(total_dur - 0.4, 2)
        d3 = max(2.5, round(t_cta_end - t_cta_start, 2))
        target_segments_plan = [
            {"order_index": 0, "start": 0.0, "end": d1, "role": "Curiosity hook or pain point shown on screen", "target_words": f"{max(7, int(d1 * 2.1))}-{max(9, int(d1 * 2.6))} words"},
            {"order_index": 1, "start": d1, "end": t_cta_start, "role": "Visual demonstration of use and standout feature", "target_words": f"{max(9, int(d2 * 2.1))}-{max(11, int(d2 * 2.6))} words"},
            {"order_index": 2, "start": t_cta_start, "end": t_cta_end, "role": "Call to action for the cart, bottom-left corner, great price", "target_words": f"{max(6, int(d3 * 2.0))}-{max(8, int(d3 * 2.5))} words"},
        ]
    elif total_dur <= 30.0:
        # Video tiêu chuẩn (17s - 30s): 4 câu AIDA chuẩn chuyển đổi
        d1 = min(4.2, round(total_dur * 0.22, 2))
        d2 = round(total_dur * 0.28, 2)
        d3 = round(total_dur * 0.30, 2)
        t_cta_start = round(d1 + d2 + d3, 2)
        t_cta_end = round(total_dur - 0.5, 2)
        d4 = max(2.5, round(t_cta_end - t_cta_start, 2))
        target_segments_plan = [
            {"order_index": 0, "start": 0.0, "end": d1, "role": "Hook that grabs viewers in the first 3 seconds", "target_words": f"{max(8, int(d1 * 2.1))}-{max(10, int(d1 * 2.6))} words"},
            {"order_index": 1, "start": d1, "end": round(d1 + d2, 2), "role": "The old pain point and the smart solution", "target_words": f"{max(11, int(d2 * 2.1))}-{max(14, int(d2 * 2.6))} words"},
            {"order_index": 2, "start": round(d1 + d2, 2), "end": t_cta_start, "role": "Visual demonstration of use & real-world experience", "target_words": f"{max(12, int(d3 * 2.1))}-{max(15, int(d3 * 2.6))} words"},
            {"order_index": 3, "start": t_cta_start, "end": t_cta_end, "role": "Call to action to tap the cart in the bottom-left corner for the deal", "target_words": f"{max(7, int(d4 * 2.0))}-{max(10, int(d4 * 2.5))} words"},
        ]
    else:
        step = (total_dur - 0.6) / 5.0
        roles = [
            "Strong attention-grabbing opening hook",
            "The annoying pain point of the old way",
            "Introduce the product and its standout feature",
            "Visual demonstration of use",
            "Call to action to tap the cart in the bottom-left corner for the sale",
        ]
        target_segments_plan = [
            {
                "order_index": i,
                "start": round(i * step, 2),
                "end": round((i + 1) * step if i < 4 else (total_dur - 0.4), 2),
                "role": roles[i],
                "target_words": f"{max(8, int(step * 2.1))}-{max(11, int(step * 2.6))} words",
            }
            for i in range(5)
        ]

    system_instruction = (
        "You are a leading Vietnamese creative director for viral TikTok Shop & Reels voiceover scripts.\n"
        f"REQUIRED STYLE: {style_info['name']}\n"
        f"{style_info['desc']}\n\n"
        "GOLDEN RULES FOR A TOP-TIER SMART SCRIPT (MUST BE FOLLOWED):\n"
        "1. VISUAL-SYNCED STORYTELLING (LIKE A PRO GENSUB WRITER):\n"
        "   - The voiceover must vividly narrate exactly what the viewer is seeing in each scene (based on the Action Timeline and Product Strengths given below).\n"
        "   - If the opening scene shows an inconvenience — a grimy old broom, flying cat hair, restless feet — open by naming that exact image.\n"
        "   - When hands in the video perform an action (pumping a measured dose, misting, smoothing, stretching): the narration must immediately describe the smart mechanism and the pleasant feeling of using it.\n"
        "   - Never narrate vaguely like 'this item is amazing, buy it now'. You must describe the specific action actually happening in the video!\n"
        "   - GROUNDING RULE: only reference the product, pain point, features, and actions given below. Never invent a new feature, "
        "character, or claim that isn't backed by the info provided.\n"
        "2. STRICT ANTI-REPETITION RULE:\n"
        "   - NEVER repeat words from the same root — such as 'convenient', 'handy', 'smart', 'super', 'insanely', 'love it', 'so good' — more than once in the entire script. Use rich, natural everyday Vietnamese vocabulary.\n"
        "3. NATURAL, FLOWING SPOKEN LANGUAGE OF A REAL VIETNAMESE CREATOR:\n"
        "   - Authentic, engaging tone, as if a friend is confiding or giving a heartfelt review (using natural address terms and colloquialisms).\n"
        "   - STRICTLY FORBIDDEN: robotic translated phrasing or bookish writing such as 'after the experience', 'worth every penny', 'lacks a highlight', 'extremely shocking', 'incredibly smart'.\n"
        "4. STICK TO THE LENGTH: strictly follow the 'max_words' count for each line so the voiceover flows rhythmically, is fully articulated, and never gets cut off.\n\n"
        "You MUST return a plain JSON object (no ```json markdown fences):\n"
        "{\n"
        '  "title": "Catchy video title (under 60 characters)",\n'
        '  "caption": "Engaging, SEO-friendly TikTok caption prompting viewers to check the cart",\n'
        '  "hashtags": ["#tag1", "#tag2", "#tag3", "#xuhuong", "#tiktokshop"],\n'
        '  "segments": [\n'
        '    {\n'
        '      "order_index": 0,\n'
        '      "start": 0.0,\n'
        '      "end": 3.8,\n'
        '      "text": "Natural, engaging colloquial Vietnamese line matching the video"\n'
        '    }\n'
        '  ]\n'
        "}\n"
        "IMPORTANT: every string value in the JSON (title, caption, hashtags, and every segment's text) must be written in natural, "
        "fluent Vietnamese — this is the final language shown to end users."
    )

    resolved_note = resolve_spin_syntax(note_script)
    resolved_desc = resolve_spin_syntax(description)
    pain_point_hint = product_analysis.get("pain_points") if product_analysis else ""
    key_feat_hint = product_analysis.get("key_features") if product_analysis else ""
    action_hint = product_analysis.get("action_summary") if product_analysis else ""

    prompt = (
        f"=== PRODUCT & VIDEO INFO ===\n"
        f"- Product name: {product_name}\n"
        f"- Price: {price or 'Great discounted price in the cart, bottom-left corner'}\n"
        f"- Category: {category}\n"
        f"- Script style: {style_info['name']}\n"
        f"- User pain point: {pain_point_hint or 'The old way is inconvenient and time-consuming'}\n"
        f"- Product strengths: {key_feat_hint or 'Convenient, smart, a joy to use'}\n"
        f"- Actions happening in the video: {action_hint or 'Visual demonstration of use'}\n"
        f"- Additional notes: {resolved_note or 'Emphasize practicality and a great price'}\n"
        f"- Product description: {resolved_desc[:300] if resolved_desc else 'None'}\n"
        f"- Version number: {version_index} (create a unique angle, don't repeat other versions)\n"
        f"- Total video duration: {total_dur:.1f} seconds\n\n"
        f"=== PER-LINE ALLOCATION & STRICT WORD-COUNT LIMITS ({len(target_segments_plan)} lines) ===\n"
        f"{json.dumps(target_segments_plan, ensure_ascii=False, indent=2)}\n\n"
        "NOTE: Write exactly this many lines, each one within its target_words range (not too short and not too long), "
        "so the voiceover flows naturally across the whole video!"
    )

    try:
        raw_reply = await GeminiKeyPool.call_with_failover(
            db=db,
            prompt=prompt,
            system_instruction=system_instruction,
            model_name=model_name,
        )
        json_match = re.search(r"\{.*\}", raw_reply, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group(0))
            raw_segments = data.get("segments") or []
            formatted_segments = []

            for i, plan in enumerate(target_segments_plan):
                seg_text = ""
                for seg in raw_segments:
                    if seg.get("order_index") == i:
                        seg_text = seg.get("text", "").strip()
                        break
                if not seg_text and i < len(raw_segments):
                    seg_text = raw_segments[i].get("text", "").strip()

                if not seg_text:
                    if i == 0:
                        seg_text = f"Mọi người đã biết đến em {product_name} này chưa, tiện lắm luôn á!"
                    elif i == len(target_segments_plan) - 1:
                        seg_text = "Bấm ngay vào giỏ hàng góc trái săn deal hời hôm nay nhé!"
                    else:
                        seg_text = f"Dùng thử mới thấy em {product_name} này vừa tiện lợi vừa tiết kiệm thời gian."

                s_time = float(raw_segments[i].get("start", plan["start"])) if i < len(raw_segments) else plan["start"]
                e_time = float(raw_segments[i].get("end", plan["end"])) if i < len(raw_segments) else plan["end"]

                formatted_segments.append({
                    "order_index": i,
                    "scene_id": i,
                    "start": round(s_time, 2),
                    "end": round(e_time, 2),
                    "duration": round(max(1.0, e_time - s_time), 2),
                    "text": seg_text,
                    "text_vi": seg_text,
                })

            raw_tags = data.get("hashtags") or ["#xuhuong", "#tiktokshop", "#review", "#affiliate"]
            clean_tags = [f"#{t.lstrip('#').strip()}" for t in raw_tags if t.strip()]

            return {
                "title": data.get("title") or f"Review {product_name}",
                "caption": data.get("caption") or f"Trải nghiệm {product_name} cực kỳ đỉnh! Mọi người bấm giỏ hàng xem ngay nhé ✨",
                "hashtags": clean_tags,
                "segments": formatted_segments,
                "style_used": chosen_key,
            }

        # Fallback kịch bản mặc định nếu không khớp JSON
        fallback_segs = []
        for i, plan in enumerate(target_segments_plan):
            txt = f"Sản phẩm {product_name} tiện lợi, chất lượng tuyệt vời."
            fallback_segs.append({
                "order_index": i,
                "scene_id": i,
                "start": round(plan["start"], 2),
                "end": round(plan["end"], 2),
                "duration": round(max(1.0, plan["end"] - plan["start"]), 2),
                "text": txt,
                "text_vi": txt,
            })
        return {
            "title": f"Review {product_name}",
            "caption": f"Trải nghiệm {product_name} cực kỳ đỉnh! Mọi người bấm giỏ hàng xem ngay nhé ✨",
            "hashtags": ["#xuhuong", "#tiktokshop", "#review", "#affiliate"],
            "segments": fallback_segs,
            "style_used": chosen_key,
        }
    except Exception as e:
        logger.error(f"Lỗi sinh kịch bản affiliate qua Gemini: {e}")
        raise RuntimeError(
            f"Lỗi tạo kịch bản Affiliate AI: {e}. "
            f"Vui lòng kiểm tra lại cấu hình API Key trong mục Cài Đặt!"
        )


