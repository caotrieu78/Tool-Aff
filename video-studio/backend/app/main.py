import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.core.db import init_db
from app.api import routes_library, routes_localize, routes_affiliate
from app.api import routes_jobs, routes_publish, routes_settings, routes_editor, routes_license
from app.workers.job_runner import start_job_runner
from app.workers.publish_worker import start_publish_worker

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_publish_worker_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup & shutdown events."""
    global _publish_worker_task
    logger.info("🚀 Video Studio backend starting...")
    await init_db()
    logger.info("✅ Database initialized")

    # Khởi chạy background publish worker quét lịch đăng tự động
    _publish_worker_task = asyncio.create_task(start_publish_worker())

    yield

    if _publish_worker_task and not _publish_worker_task.done():
        _publish_worker_task.cancel()
        try:
            await _publish_worker_task
        except asyncio.CancelledError:
            pass

    logger.info("👋 Video Studio backend shutting down")


app = FastAPI(
    title="Video Studio API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow Electron renderer (file:// or localhost).
# allow_credentials=False vì app không dùng cookie/session; giữ allow_origins=["*"]
# + allow_credentials=True là cấu hình không hợp lệ theo chuẩn CORS và bị nhiều
# trình duyệt/công cụ bảo mật cảnh báo.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_storage_cache_control_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/storage/"):
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
    return response

# Static files for video thumbnails and outputs
settings.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
custom_voices_dir = settings.STORAGE_DIR.parent / "custom_voices"
custom_voices_dir.mkdir(parents=True, exist_ok=True)
app.mount("/api/storage/custom_voices", StaticFiles(directory=str(custom_voices_dir)), name="custom_voices")
app.mount("/api/storage", StaticFiles(directory=str(settings.STORAGE_DIR)), name="storage")

app.include_router(routes_library.router, prefix="/api/library", tags=["Library"])
app.include_router(routes_localize.router, prefix="/api/localize", tags=["Module 1: Localize"])
app.include_router(routes_affiliate.router, prefix="/api/affiliate", tags=["Module 2: Affiliate"])
app.include_router(routes_jobs.router, prefix="/api/jobs", tags=["Jobs"])
app.include_router(routes_publish.router, prefix="/api/publish", tags=["Publish"])
app.include_router(routes_settings.router, prefix="/api/settings", tags=["Settings"])
app.include_router(routes_editor.router, prefix="/api/editor", tags=["Editor & Scheduler"])
app.include_router(routes_license.router, prefix="/api/license", tags=["License"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "app": settings.APP_NAME}
