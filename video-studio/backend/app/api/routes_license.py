import logging
from typing import Any, Dict
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.license_service import get_machine_id, license_service

logger = logging.getLogger(__name__)

router = APIRouter()

# Các trường nhạy cảm chỉ dành cho admin — KHÔNG trả về frontend
_ADMIN_FIELDS = {"google_sheet_id", "license_server_url"}


def _strip_admin_fields(data: Dict[str, Any]) -> Dict[str, Any]:
    """Xóa các trường admin khỏi response trả về client."""
    return {k: v for k, v in data.items() if k not in _ADMIN_FIELDS}


class ActivateRequest(BaseModel):
    key: str


@router.get("/status")
async def get_status(force: bool = False):
    """Lấy trạng thái bản quyền hiện tại (kèm thông tin HWID, ngày hết hạn, số ngày còn lại)."""
    try:
        result = await license_service.get_status(force_online=force)
        return _strip_admin_fields(result)
    except Exception as e:
        logger.error(f"[License API] Lỗi lấy trạng thái: {e}")
        return {
            "is_valid": False,
            "status": "error",
            "machine_id": get_machine_id(),
            "message": f"Lỗi kiểm tra bản quyền: {e}",
        }


@router.get("/machine-id")
async def get_machine_hwid():
    """Lấy Hardware ID của máy trạm."""
    return {"machine_id": get_machine_id()}


@router.post("/activate")
async def activate_license(req: ActivateRequest):
    """Kích hoạt bản quyền với mã key."""
    key = req.key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="Mã bản quyền không được để trống!")

    res = await license_service.activate(key)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("message", "Kích hoạt thất bại"))
    return _strip_admin_fields(res)


@router.post("/refresh")
async def refresh_license():
    """Kiểm tra và đồng bộ lại bản quyền với Google Sheets trực tuyến."""
    result = await license_service.get_status(force_online=True)
    return _strip_admin_fields(result)


@router.post("/deactivate")
async def deactivate_license():
    """Hủy kích hoạt bản quyền trên thiết bị này."""
    return license_service.deactivate()
