from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_db
import asyncio
import json

router = APIRouter()

# Active WebSocket connections for job progress
_connections: dict[int, list[WebSocket]] = {}


@router.websocket("/ws/{job_id}")
async def job_progress_ws(websocket: WebSocket, job_id: int):
    """WebSocket endpoint để push job progress realtime về frontend."""
    await websocket.accept()
    if job_id not in _connections:
        _connections[job_id] = []
    _connections[job_id].append(websocket)
    try:
        while True:
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        _connections[job_id].remove(websocket)


async def broadcast_progress(job_id: int, data: dict):
    """Gọi từ job runner để push progress tới tất cả client đang xem job này."""
    if job_id in _connections:
        dead = []
        for ws in _connections[job_id]:
            try:
                await ws.send_text(json.dumps(data))
            except Exception:
                dead.append(ws)
        for ws in dead:
            _connections[job_id].remove(ws)


@router.get("/")
async def list_jobs(
    status: str | None = None,
    video_id: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    return {"jobs": []}


@router.get("/{job_id}")
async def get_job(job_id: int, db: AsyncSession = Depends(get_db)):
    return {"job_id": job_id}


@router.delete("/{job_id}/cancel")
async def cancel_job(job_id: int, db: AsyncSession = Depends(get_db)):
    return {"status": "cancelled"}
