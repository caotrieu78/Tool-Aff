"""
Tiện ích mã hóa đối xứng (Fernet) cho các giá trị nhạy cảm lưu trong DB
(Gemini API key, TikTok access/refresh token...).

Nếu SECRET_KEY trong .env chưa được cấu hình (vẫn là giá trị mặc định), hệ thống
tự sinh một khóa ngẫu nhiên và lưu vào storage/.secret_key để dùng ổn định
giữa các lần chạy, thay vì mã hóa bằng một chuỗi mặc định ai cũng biết.
"""
import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings, BASE_DIR

_DEFAULT_SECRET = "CHANGE_ME_IN_PRODUCTION_USE_RANDOM_32_BYTES"
_SECRET_FILE = BASE_DIR / "storage" / ".secret_key"


def _resolve_fernet_key() -> bytes:
    if settings.SECRET_KEY and settings.SECRET_KEY != _DEFAULT_SECRET:
        digest = hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()
        return base64.urlsafe_b64encode(digest)

    _SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
    if _SECRET_FILE.exists():
        return _SECRET_FILE.read_bytes().strip()

    generated = Fernet.generate_key()
    _SECRET_FILE.write_bytes(generated)
    return generated


_fernet = Fernet(_resolve_fernet_key())


def encrypt_value(raw: str) -> str:
    """Mã hóa một chuỗi (API key, token...) trước khi lưu DB."""
    if not raw:
        return raw
    return _fernet.encrypt(raw.encode("utf-8")).decode("utf-8")


def decrypt_value(token: str) -> str:
    """
    Giải mã chuỗi đã lưu trong DB.
    Nếu giá trị không phải ciphertext hợp lệ (dữ liệu cũ lưu plaintext trước khi
    bật mã hóa), trả về nguyên giá trị để không làm hỏng dữ liệu cũ.
    """
    if not token:
        return token
    try:
        return _fernet.decrypt(token.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError):
        return token
