"""Pipeline stubs — full implementation in Phase 3."""
import logging

logger = logging.getLogger(__name__)


async def run_localize_pipeline(job_id: int):
    """
    Module 1: Việt hóa video pipeline.
    Steps: OCR → STT → translate → TTS → compose
    Full implementation in Phase 3.
    """
    logger.info(f"[Localize] Job {job_id} — pipeline stub")
    # TODO Phase 3: implement full pipeline
    raise NotImplementedError("Localize pipeline not implemented yet")
