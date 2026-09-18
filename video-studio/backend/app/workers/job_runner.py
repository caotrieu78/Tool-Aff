"""
SQLite-based background job runner.
Không dùng Redis/Celery — đủ dùng cho CPU-only local desktop app.
Cơ chế: poll DB mỗi N giây, lấy job pending, chạy tuần tự.
Không có cơ chế resume: nếu app tắt giữa chừng → job reset về pending khi mở lại.
"""
import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select, update
from app.core.db import AsyncSessionLocal
from app.models.job import ProcessingJob, JobStatus, JobStep

logger = logging.getLogger(__name__)

# Giữ reference job đang chạy để có thể cancel
_current_task: asyncio.Task | None = None


async def start_job_runner():
    """
    Main loop: poll DB → chạy job → repeat.
    Chạy như background asyncio task từ FastAPI lifespan.
    """
    # Khi khởi động, reset các job đang running (do app tắt giữa chừng) về pending
    await _reset_interrupted_jobs()

    logger.info("Job runner loop started")
    while True:
        try:
            await _process_next_job()
        except asyncio.CancelledError:
            logger.info("Job runner loop cancelled")
            break
        except Exception as e:
            logger.error(f"Job runner error: {e}", exc_info=True)
        await asyncio.sleep(5)  # poll mỗi 5 giây


async def _reset_interrupted_jobs():
    """Reset các job bị ngắt giữa chừng khi app khởi động lại."""
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(ProcessingJob)
            .where(ProcessingJob.status == JobStatus.running)
            .values(
                status=JobStatus.pending,
                error_log="Job was interrupted by app shutdown. Reset to pending.",
                current_step=JobStep.queued,
            )
        )
        await db.commit()
    logger.info("Interrupted jobs reset to pending")


async def _process_next_job():
    """Lấy 1 job pending cũ nhất và chạy."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ProcessingJob)
            .where(ProcessingJob.status == JobStatus.pending)
            .order_by(ProcessingJob.created_at.asc())
            .limit(1)
        )
        job = result.scalar_one_or_none()
        if not job:
            return

        # Mark as running
        job.status = JobStatus.running  # type: ignore[assignment]
        job.started_at = datetime.now(timezone.utc).replace(tzinfo=None)  # type: ignore[assignment]
        await db.commit()
        job_id: int = int(job.id)  # type: ignore[arg-type]
        module = job.module

    logger.info(f"Starting job {job_id} (module={module})")

    try:
        if module.value == "localize":
            from app.services.job_runner import run_localize_pipeline
            await run_localize_pipeline(job_id)
        elif module.value == "affiliate":
            from app.services.job_runner import run_affiliate_pipeline
            await run_affiliate_pipeline(job_id)
        else:
            raise ValueError(f"Unknown module: {module}")

        async with AsyncSessionLocal() as db:
            await db.execute(
                update(ProcessingJob)
                .where(ProcessingJob.id == job_id)
                .values(
                    status=JobStatus.done,
                    progress_percent=100.0,
                    finished_at=datetime.now(timezone.utc).replace(tzinfo=None),
                )
            )
            await db.commit()
        logger.info(f"Job {job_id} completed successfully")

    except Exception as e:
        logger.error(f"Job {job_id} failed: {e}", exc_info=True)
        async with AsyncSessionLocal() as db:
            await db.execute(
                update(ProcessingJob)
                .where(ProcessingJob.id == job_id)
                .values(
                    status=JobStatus.error,
                    error_log=str(e),
                    finished_at=datetime.now(timezone.utc).replace(tzinfo=None),
                )
            )
            await db.commit()
