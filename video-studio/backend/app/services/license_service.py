import csv
import datetime
import hashlib
import hmac
import io
import json
import logging
import os
import platform
import re
import subprocess
import uuid
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# Cache in-memory HWID so we don't re-query OS commands repeatedly
_CACHED_HWID: Optional[str] = None


def get_machine_id() -> str:
    """
    Sinh mã Hardware ID (HWID) duy nhất cho từng máy tính.
    Hỗ trợ:
      - macOS: IOPlatformUUID qua ioreg
      - Windows: UUID qua wmic / powershell
      - Linux: /etc/machine-id hoặc /var/lib/dbus/machine-id
      - Fallback: CPU + Node + MAC hash
    Format: VS-HWID-XXXX-XXXX-XXXX-XXXX
    """
    global _CACHED_HWID
    if _CACHED_HWID:
        return _CACHED_HWID

    raw_id = ""
    system_os = platform.system()

    try:
        if system_os == "Darwin":
            # macOS: IOPlatformUUID
            cmd = ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=3)
            match = re.search(r'"IOPlatformUUID"\s*=\s*"([^"]+)"', result.stdout)
            if match:
                raw_id = match.group(1).strip()

        elif system_os == "Windows":
            # Windows: wmic csproduct get uuid
            try:
                result = subprocess.run(
                    ["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystemProduct).UUID"],
                    capture_output=True,
                    text=True,
                    timeout=3,
                )
                output = result.stdout.strip()
                if output and len(output) > 10:
                    raw_id = output
            except Exception:
                pass

            if not raw_id:
                try:
                    result = subprocess.run(
                        ["wmic", "csproduct", "get", "uuid"],
                        capture_output=True,
                        text=True,
                        timeout=3,
                    )
                    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
                    if len(lines) > 1:
                        raw_id = lines[1]
                except Exception:
                    pass

        elif system_os == "Linux":
            # Linux: /etc/machine-id
            for p in ["/etc/machine-id", "/var/lib/dbus/machine-id"]:
                if os.path.exists(p):
                    with open(p, "r", encoding="utf-8") as f:
                        raw_id = f.read().strip()
                        if raw_id:
                            break

    except Exception as e:
        logger.warning(f"[License] Lỗi truy vấn hardware ID gốc: {e}")

    if not raw_id:
        # Fallback an toàn: kết hợp thông số phần cứng
        mac_num = uuid.getnode()
        mac_hex = f"{mac_num:012x}"
        node_name = platform.node()
        proc = platform.processor()
        raw_id = f"{node_name}:{proc}:{mac_hex}"

    # Băm SHA-256 để tạo mã HWID chuẩn hoá 16 ký tự hexa viết hoa
    h = hashlib.sha256(raw_id.encode("utf-8")).hexdigest().upper()
    part1, part2, part3, part4 = h[0:4], h[4:8], h[8:12], h[12:16]
    _CACHED_HWID = f"VS-HWID-{part1}-{part2}-{part3}-{part4}"
    return _CACHED_HWID


class LicenseService:
    def __init__(self):
        self.cache_file: Path = settings.LICENSE_CACHE_FILE
        self.secret_key: str = settings.SECRET_KEY
        self.server_url: str = settings.LICENSE_SERVER_URL
        self.sheet_id: str = settings.GOOGLE_SHEET_ID
        self.grace_hours: int = settings.LICENSE_GRACE_HOURS

    def _calc_signature(self, data: Dict[str, Any], hwid: str) -> str:
        """Tạo chữ ký HMAC-SHA256 để chống can thiệp file cache cục bộ."""
        sign_string = (
            f"{data.get('key', '')}|{data.get('customer_name', '')}|"
            f"{data.get('expires_at', '')}|{data.get('status', '')}|"
            f"{data.get('last_verified_at', '')}|{hwid}|{self.secret_key}"
        )
        return hmac.new(self.secret_key.encode("utf-8"), sign_string.encode("utf-8"), hashlib.sha256).hexdigest()

    def _read_cache(self) -> Optional[Dict[str, Any]]:
        """Đọc và kiểm tra tính toàn vẹn của cache bản quyền cục bộ."""
        if not self.cache_file.exists():
            return None
        try:
            with open(self.cache_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            hwid = get_machine_id()
            expected_sig = self._calc_signature(data, hwid)
            if not hmac.compare_digest(str(data.get("signature", "")), expected_sig):
                logger.warning("[License] Chữ ký cache bản quyền không khớp (nghi vấn bị sửa đổi)!")
                return None

            return data
        except Exception as e:
            logger.warning(f"[License] Lỗi đọc cache bản quyền: {e}")
            return None

    def _save_cache(self, data: Dict[str, Any]):
        """Lưu cache bản quyền có ký HMAC."""
        try:
            self.cache_file.parent.mkdir(parents=True, exist_ok=True)
            hwid = get_machine_id()
            data["signature"] = self._calc_signature(data, hwid)
            with open(self.cache_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"[License] Không thể lưu cache bản quyền: {e}")

    def _mask_key(self, key: str) -> str:
        if not key:
            return ""
        if len(key) <= 6:
            return "****"
        return key[:4] + "-****-" + key[-4:]

    def _clean_date_str(self, date_val: Any) -> str:
        """Chuẩn hóa chuỗi ngày về dạng YYYY-MM-DD gọn gàng."""
        if not date_val:
            return ""
        val = str(date_val).strip()
        m = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})", val)
        if m:
            return f"{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}"
        months = {
            "Jan": "01", "Feb": "02", "Mar": "03", "Apr": "04",
            "May": "05", "Jun": "06", "Jul": "07", "Aug": "08",
            "Sep": "09", "Oct": "10", "Nov": "11", "Dec": "12"
        }
        m_month = re.search(r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{4})", val, re.IGNORECASE)
        if m_month:
            m_str, d_str, y_str = m_month.groups()
            m_num = months.get(m_str.capitalize(), "01")
            return f"{y_str}-{m_num}-{d_str.zfill(2)}"
        return val

    async def _verify_via_apps_script(self, key: str, hwid: str) -> Tuple[bool, Dict[str, Any]]:
        """Xác thực qua Google Apps Script Web App (hỗ trợ cả ghi HWID lần đầu)."""
        logger.info(f"[License] Gửi yêu cầu xác thực tới Apps Script: {self.server_url}")
        async with httpx.AsyncClient(follow_redirects=True, timeout=12.0) as client:
            resp = await client.post(
                self.server_url,
                json={"key": key, "machine_id": hwid},
            )
            if resp.status_code != 200:
                logger.warning(f"[License] Google Apps Script trả về HTTP {resp.status_code}, coi như lỗi mạng tạm thời")
                return False, {
                    "success": False,
                    "server_responded": False,   # Lỗi hạ tầng HTTP Google -> không coi là từ chối bản quyền, áp dụng cache offline
                    "message": f"Máy chủ Google Apps Script trả về lỗi HTTP {resp.status_code}",
                }
            res_data = resp.json()
            res_data["server_responded"] = True   # server trả JSON thành công
            if "expires_at" in res_data:
                res_data["expires_at"] = self._clean_date_str(res_data["expires_at"])
            return res_data.get("success", False), res_data

    async def _verify_via_sheet_csv(self, key: str, hwid: str) -> Tuple[bool, Dict[str, Any]]:
        """
        Fallback: Đọc trực tiếp Google Sheets công khai qua link CSV
        khi người dùng chưa cấu hình link Apps Script Web App.
        Tất cả kết quả từ hàm này đều được đánh dấu server_responded=True.
        """
        csv_url = f"https://docs.google.com/spreadsheets/d/{self.sheet_id}/export?format=csv&gid=0"
        logger.info(f"[License] Đang đọc dự phòng qua Google Sheet CSV: {csv_url}")
        async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
            resp = await client.get(csv_url)
            if resp.status_code != 200:
                return False, {
                    "success": False,
                    "server_responded": False,
                    "message": f"Không thể kết nối Google Sheets (HTTP {resp.status_code})",
                }

            reader = csv.reader(io.StringIO(resp.text))
            rows = list(reader)
            if len(rows) < 2:
                return False, {"success": False, "server_responded": True, "message": "File Google Sheets chưa có dữ liệu"}

            norm_key = key.strip().upper()
            target_row = None
            for row in rows[1:]:
                if len(row) > 0 and row[0].strip().upper() == norm_key:
                    target_row = row
                    break

            if not target_row:
                return False, {
                    "success": False,
                    "is_revoked": True,   # key bị xóa/đổi bởi admin — block ngay, không grace
                    "server_responded": True,
                    "message": f"Mã bản quyền '{key}' không tồn tại trên hệ thống! Admin có thể đã thu hồi hoặc đổi key.",
                }

            customer_name = target_row[1] if len(target_row) > 1 else "Khách hàng"
            reg_machine_id = target_row[2].strip() if len(target_row) > 2 else ""
            raw_expire = target_row[3].strip() if len(target_row) > 3 else ""
            status = target_row[4].strip().lower() if len(target_row) > 4 else "active"

            # 1. Check blocked
            if status == "blocked":
                return False, {
                    "success": False,
                    "is_blocked": True,
                    "server_responded": True,
                    "message": "Bản quyền này đã bị khóa bởi Admin. Vui lòng liên hệ hỗ trợ!",
                }

            # 2. Check HWID
            if reg_machine_id and reg_machine_id != hwid:
                return False, {
                    "success": False,
                    "is_mismatch": True,
                    "server_responded": True,
                    "message": f"Bản quyền này đã được kích hoạt trên một máy tính khác ({reg_machine_id})!",
                }

            if not reg_machine_id:
                logger.info(f"[License] Key chưa ghim HWID. Khuyên dùng Apps Script để tự động ghim: {hwid}")

            # 3. Check expiration
            now = datetime.datetime.now()
            try:
                expire_dt = datetime.datetime.strptime(raw_expire, "%Y-%m-%d")
                expire_dt = expire_dt.replace(hour=23, minute=59, second=59)
            except Exception:
                return False, {"success": False, "server_responded": True, "message": f"Định dạng ngày hết hạn '{raw_expire}' không hợp lệ (cần YYYY-MM-DD)"}

            if now > expire_dt:
                return False, {
                    "success": False,
                    "is_expired": True,
                    "server_responded": True,
                    "expires_at": raw_expire,
                    "message": f"Bản quyền của bạn đã hết hạn vào ngày {raw_expire}. Vui lòng gia hạn!",
                }

            days_left = max(0, (expire_dt.date() - now.date()).days)

            return True, {
                "success": True,
                "server_responded": True,
                "customer_name": customer_name,
                "expires_at": raw_expire,
                "days_left": days_left,
                "message": f"Kích hoạt thành công! Hạn dùng còn {days_left} ngày.",
            }

    async def verify_online(self, key: str) -> Tuple[bool, Dict[str, Any]]:
        """Kiểm tra bản quyền online qua Apps Script hoặc Sheet CSV fallback.
        
        server_responded=True  → server đã phản hồi (dù thành công hay lỗi) → block ngay khi fail
        server_responded=False → lỗi mạng thực sự (timeout, DNS fail...) → áp dụng grace period
        """
        hwid = get_machine_id()
        key = key.strip().upper()

        if not key:
            return False, {"success": False, "server_responded": False, "message": "Chưa nhập mã bản quyền!"}

        # Ưu tiên 1: Apps Script Web App (nếu đã cấu hình URL)
        if self.server_url and self.server_url.startswith("http"):
            try:
                ok, res = await self._verify_via_apps_script(key, hwid)
                return ok, res
            except Exception as e:
                logger.warning(f"[License] Gọi Apps Script thất bại ({e}), thử fallback Sheet CSV...")

        # Ưu tiên 2: Fallback Google Sheet CSV đọc trực tiếp
        try:
            return await self._verify_via_sheet_csv(key, hwid)
        except Exception as e:
            logger.error(f"[License] Không thể kết nối kiểm tra online: {e}")
            # Exception = lỗi mạng thực sự, không phải server từ chối key
            return False, {"success": False, "server_responded": False, "message": f"Không thể kết nối máy chủ bản quyền: {e}"}

    async def get_status(self, force_online: bool = False) -> Dict[str, Any]:
        """
        Lấy trạng thái bản quyền hiện tại.
        Hỗ trợ cache offline 72h và chống lùi đồng hồ máy tính.
        """
        hwid = get_machine_id()
        now = datetime.datetime.now()
        cached = self._read_cache()

        # Nếu chưa từng có cache hoặc không có key
        if not cached or not cached.get("key"):
            return {
                "is_valid": False,
                "status": "not_activated",
                "customer_name": "",
                "expires_at": "",
                "days_left": 0,
                "machine_id": hwid,
                "license_key_masked": "",
                "license_key_raw": "",
                "message": "Chưa kích hoạt bản quyền. Vui lòng nhập License Key để sử dụng!",
                "contact": settings.LICENSE_ADMIN_CONTACT,
                "license_server_url": self.server_url,
                "google_sheet_id": self.sheet_id,
            }

        key = cached.get("key", "").strip().upper()

        # Kiểm tra chống lùi giờ (Anti-clock tampering)
        last_seen_str = cached.get("last_seen_time")
        if last_seen_str:
            try:
                last_seen_dt = datetime.datetime.fromisoformat(last_seen_str)
                if now < (last_seen_dt - datetime.timedelta(minutes=5)):
                    logger.critical("[License] PHÁT HIỆN LÙI ĐỒNG HỒ HỆ THỐNG!")
                    return {
                        "is_valid": False,
                        "status": "tampered",
                        "customer_name": cached.get("customer_name", ""),
                        "expires_at": cached.get("expires_at", ""),
                        "days_left": 0,
                        "machine_id": hwid,
                        "license_key_masked": self._mask_key(key),
                        "license_key_raw": key,
                        "message": "Phát hiện ngày giờ hệ thống bị điều chỉnh lùi! Vui lòng chỉnh lại đúng giờ mạng.",
                        "contact": settings.LICENSE_ADMIN_CONTACT,
                        "license_server_url": self.server_url,
                        "google_sheet_id": self.sheet_id,
                    }
            except Exception:
                pass

        # Cập nhật mốc thời gian nhìn thấy gần nhất
        cached["last_seen_time"] = now.isoformat()
        self._save_cache(cached)

        # Cần kiểm tra online khi:
        # 1. force_online = True
        # 2. Hoặc cache đã quá 10 phút (600 giây) kể từ lần verify online trước (tránh gọi Google liên tục làm gián đoạn người dùng)
        last_verified_str = cached.get("last_verified_at")
        need_online_check = force_online
        if last_verified_str:
            try:
                last_verified_dt = datetime.datetime.fromisoformat(last_verified_str)
                if (now - last_verified_dt).total_seconds() > 600:
                    need_online_check = True
            except Exception:
                need_online_check = True
        else:
            need_online_check = True

        if need_online_check:
            ok, online_res = await self.verify_online(key)
            if ok:
                expires_at = self._clean_date_str(online_res.get("expires_at", cached.get("expires_at", "")))
                try:
                    exp_dt = datetime.datetime.strptime(expires_at, "%Y-%m-%d")
                    days_left = max(0, (exp_dt.date() - now.date()).days)
                except Exception:
                    days_left = int(online_res.get("days_left", 0))

                cached.update(
                    {
                        "key": key,
                        "customer_name": online_res.get("customer_name", cached.get("customer_name", "")),
                        "expires_at": expires_at,
                        "days_left": days_left,
                        "status": "active",
                        "is_valid": True,
                        "last_verified_at": now.isoformat(),
                        "last_seen_time": now.isoformat(),
                        "message": online_res.get("message", "Bản quyền hợp lệ."),
                    }
                )
                self._save_cache(cached)
                return {
                    "is_valid": True,
                    "status": "active",
                    "customer_name": cached["customer_name"],
                    "expires_at": cached["expires_at"],
                    "days_left": days_left,
                    "machine_id": hwid,
                    "license_key_masked": self._mask_key(key),
                    "license_key_raw": key,
                    "message": cached["message"],
                    "contact": settings.LICENSE_ADMIN_CONTACT,
                    "license_server_url": self.server_url,
                    "google_sheet_id": self.sheet_id,
                }
            else:
                # ── Nhóm 1: Server phản hồi OK — block ngay, KHÔNG grace period ──────────

                # Key bị Admin thu hồi / đổi sang key khác
                if online_res.get("is_revoked"):
                    logger.warning(f"[License] Key '{key}' đã bị thu hồi/đổi bởi Admin — xóa cache ngay.")
                    cached.update({"status": "revoked", "is_valid": False, "message": online_res.get("message")})
                    self._save_cache(cached)
                    return {
                        "is_valid": False,
                        "status": "revoked",
                        "customer_name": cached.get("customer_name", ""),
                        "expires_at": cached.get("expires_at", ""),
                        "days_left": 0,
                        "machine_id": hwid,
                        "license_key_masked": self._mask_key(key),
                        "license_key_raw": key,
                        "message": online_res.get("message", "Bản quyền đã bị Admin thu hồi!"),
                        "contact": settings.LICENSE_ADMIN_CONTACT,
                        "license_server_url": self.server_url,
                        "google_sheet_id": self.sheet_id,
                    }

                if online_res.get("is_blocked"):
                    cached.update({"status": "blocked", "is_valid": False, "message": online_res.get("message")})
                    self._save_cache(cached)
                    return {
                        "is_valid": False,
                        "status": "blocked",
                        "customer_name": cached.get("customer_name", ""),
                        "expires_at": cached.get("expires_at", ""),
                        "days_left": 0,
                        "machine_id": hwid,
                        "license_key_masked": self._mask_key(key),
                        "license_key_raw": key,
                        "message": online_res.get("message", "Bản quyền đã bị khóa!"),
                        "contact": settings.LICENSE_ADMIN_CONTACT,
                        "license_server_url": self.server_url,
                        "google_sheet_id": self.sheet_id,
                    }

                if online_res.get("is_expired"):
                    cached.update({"status": "expired", "is_valid": False, "message": online_res.get("message")})
                    self._save_cache(cached)
                    return {
                        "is_valid": False,
                        "status": "expired",
                        "customer_name": cached.get("customer_name", ""),
                        "expires_at": cached.get("expires_at", ""),
                        "days_left": 0,
                        "machine_id": hwid,
                        "license_key_masked": self._mask_key(key),
                        "license_key_raw": key,
                        "message": online_res.get("message", "Bản quyền đã hết hạn!"),
                        "contact": settings.LICENSE_ADMIN_CONTACT,
                        "license_server_url": self.server_url,
                        "google_sheet_id": self.sheet_id,
                    }

                if online_res.get("is_mismatch"):
                    cached.update({"status": "mismatch", "is_valid": False, "message": online_res.get("message")})
                    self._save_cache(cached)
                    return {
                        "is_valid": False,
                        "status": "mismatch",
                        "customer_name": cached.get("customer_name", ""),
                        "expires_at": cached.get("expires_at", ""),
                        "days_left": 0,
                        "machine_id": hwid,
                        "license_key_masked": self._mask_key(key),
                        "license_key_raw": key,
                        "message": online_res.get("message", "Key kích hoạt trên máy khác!"),
                        "contact": settings.LICENSE_ADMIN_CONTACT,
                        "license_server_url": self.server_url,
                        "google_sheet_id": self.sheet_id,
                    }

                # ── Nhóm 2: Lỗi mạng thực sự — áp dụng grace period 72h ─────────────────
                # Chỉ áp dụng offline grace khi KHÔNG có phản hồi từ server (timeout, DNS fail...)
                # Khi server TRẢ LỜI và nói key không hợp lệ → không được grace
                is_server_responded = online_res.get("server_responded", False)
                if not is_server_responded and last_verified_str:
                    try:
                        last_verified_dt = datetime.datetime.fromisoformat(last_verified_str)
                        diff_hours = (now - last_verified_dt).total_seconds() / 3600.0
                        if diff_hours <= self.grace_hours and cached.get("is_valid", False):
                            logger.info(f"[License] Mất mạng: Sử dụng chế độ offline ({diff_hours:.1f}h / {self.grace_hours}h)")
                            return {
                                "is_valid": True,
                                "status": "offline_grace",
                                "customer_name": cached.get("customer_name", ""),
                                "expires_at": cached.get("expires_at", ""),
                                "days_left": cached.get("days_left", 0),
                                "machine_id": hwid,
                                "license_key_masked": self._mask_key(key),
                                "license_key_raw": key,
                                "message": f"Chế độ ngoại tuyến: Bản quyền hợp lệ (còn {int(self.grace_hours - diff_hours)} giờ offline).",
                                "contact": settings.LICENSE_ADMIN_CONTACT,
                                "license_server_url": self.server_url,
                                "google_sheet_id": self.sheet_id,
                            }
                    except Exception:
                        pass

                return {
                    "is_valid": False,
                    "status": "network_error",
                    "customer_name": cached.get("customer_name", ""),
                    "expires_at": cached.get("expires_at", ""),
                    "days_left": 0,
                    "machine_id": hwid,
                    "license_key_masked": self._mask_key(key),
                    "license_key_raw": key,
                    "message": online_res.get("message", "Không thể xác thực bản quyền trực tuyến!"),
                    "contact": settings.LICENSE_ADMIN_CONTACT,
                    "license_server_url": self.server_url,
                    "google_sheet_id": self.sheet_id,
                }

        expires_at = cached.get("expires_at", "")
        days_left = cached.get("days_left", 0)
        if expires_at:
            try:
                exp_dt = datetime.datetime.strptime(expires_at, "%Y-%m-%d")
                days_left = max(0, (exp_dt.date() - now.date()).days)
            except Exception:
                pass

        is_valid = cached.get("is_valid", False) and days_left >= 0
        return {
            "is_valid": is_valid,
            "status": cached.get("status", "active"),
            "customer_name": cached.get("customer_name", ""),
            "expires_at": expires_at,
            "days_left": days_left,
            "machine_id": hwid,
            "license_key_masked": self._mask_key(key),
            "license_key_raw": key,
            "message": cached.get("message", "Bản quyền hợp lệ."),
            "contact": settings.LICENSE_ADMIN_CONTACT,
            "license_server_url": self.server_url,
            "google_sheet_id": self.sheet_id,
        }

    async def activate(self, key: str) -> Dict[str, Any]:
        """Kích hoạt bản quyền với key mới."""
        key = key.strip().upper()
        if not key:
            return {"success": False, "message": "Vui lòng nhập mã bản quyền!"}

        hwid = get_machine_id()
        ok, res = await self.verify_online(key)
        if not ok:
            return {"success": False, "message": res.get("message", "Kích hoạt thất bại!")}

        now = datetime.datetime.now()
        expires_at = self._clean_date_str(res.get("expires_at", ""))
        days_left = res.get("days_left", 0)

        data = {
            "key": key,
            "customer_name": res.get("customer_name", "Khách hàng"),
            "expires_at": expires_at,
            "days_left": days_left,
            "status": "active",
            "is_valid": True,
            "last_verified_at": now.isoformat(),
            "last_seen_time": now.isoformat(),
            "message": res.get("message", "Kích hoạt thành công!"),
        }
        self._save_cache(data)

        return {
            "success": True,
            "message": data["message"],
            "customer_name": data["customer_name"],
            "expires_at": expires_at,
            "days_left": days_left,
            "machine_id": hwid,
        }

    def deactivate(self) -> Dict[str, Any]:
        """Hủy kích hoạt trên máy này (xóa cache)."""
        if self.cache_file.exists():
            try:
                self.cache_file.unlink()
            except Exception as e:
                logger.error(f"[License] Lỗi xóa file cache: {e}")
        return {"success": True, "message": "Đã hủy kích hoạt bản quyền trên thiết bị này."}

    def update_server_url(self, new_url: str) -> Dict[str, Any]:
        """Cập nhật URL máy chủ Google Apps Script."""
        self.server_url = new_url.strip()
        settings.LICENSE_SERVER_URL = self.server_url
        return {"success": True, "server_url": self.server_url}


# Singleton instance
license_service = LicenseService()
