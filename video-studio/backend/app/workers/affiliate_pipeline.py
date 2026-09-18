"""Pipeline stubs — full implementation in Phase 4."""
import logging

logger = logging.getLogger(__name__)


async def run_affiliate_pipeline(job_id: int):
    """
    Module 2: Affiliate Studio pipeline.
    Steps: highlight → scrape → script → TTS → compose
    Full implementation in Phase 4.
    """
    logger.info(f"[Affiliate] Job {job_id} — pipeline stub")
    raise NotImplementedError("Affiliate pipeline not implemented yet")
