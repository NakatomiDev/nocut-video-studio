"""Entry point for the silence detection service.

Polls the Supabase job_queue table for 'video.detect' jobs and processes them.
"""

from __future__ import annotations

import json
import logging
import os
import signal
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

# Configure logging before other imports
logging.basicConfig(
    level=logging.INFO,
    format='{"level":"%(levelname)s","msg":"%(message)s","ts":"%(asctime)s","logger":"%(name)s"}',
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("detector")

# Defer config import so logging is set up first
from . import config
from .s3_utils import download_file
from .supabase_client import (
    poll_queued_jobs,
    claim_job,
    increment_attempts,
    update_job_progress,
    complete_job,
    fail_job,
    insert_cut_map,
    update_project_status,
)
from .detector import detect_silence

_shutdown = False


def _handle_signal(signum: int, frame: Any) -> None:
    global _shutdown
    logger.info("Received signal %d, shutting down...", signum)
    _shutdown = True


def main() -> None:
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    logger.info(
        "Detector service starting (poll_interval=%ds, threshold=%.0f dB, min_silence=%.1fs)",
        config.POLL_INTERVAL_SECONDS,
        config.SILENCE_THRESHOLD_DB,
        config.MIN_SILENCE_DURATION,
    )

    while not _shutdown:
        try:
            jobs = poll_queued_jobs(limit=1)
            if jobs:
                _process_job(jobs[0])
            else:
                time.sleep(config.POLL_INTERVAL_SECONDS)
        except Exception:
            logger.exception("Unhandled error in poll loop")
            time.sleep(config.POLL_INTERVAL_SECONDS)

    logger.info("Detector service shut down")


def _process_job(job: dict[str, Any]) -> None:
    job_id = job["id"]
    project_id = job["project_id"]
    user_id = job["user_id"]
    payload = job["payload"]
    video_id = payload["video_id"]
    s3_key = payload["s3_key"]

    ctx = {"job_id": job_id, "project_id": project_id, "video_id": video_id}
    logger.info("Processing detect job: %s", json.dumps(ctx))

    # Claim the job (optimistic lock)
    if not claim_job(job_id):
        logger.info("Job %s already claimed by another worker", job_id)
        return

    increment_attempts(job_id)

    tmp_dir = tempfile.mkdtemp(prefix=f"detect-{job_id}-")
    try:
        # Step 1: Download video (10%)
        ext = Path(s3_key).suffix or ".mp4"
        local_path = os.path.join(tmp_dir, f"source{ext}")
        logger.info("Downloading %s", s3_key)
        download_file(s3_key, local_path)
        update_job_progress(job_id, 10)

        # Step 2: Run silence detection (80%)
        logger.info("Running silence detection on %s", local_path)
        cuts = detect_silence(
            local_path,
            threshold_db=config.SILENCE_THRESHOLD_DB,
            min_duration=config.MIN_SILENCE_DURATION,
            auto_accept_duration=config.AUTO_ACCEPT_DURATION,
            auto_accept_confidence=config.AUTO_ACCEPT_CONFIDENCE,
        )
        update_job_progress(job_id, 80)

        # Step 3: Write cut map to DB (90%)
        logger.info("Inserting cut_map with %d cuts for video %s", len(cuts), video_id)
        cut_map_id = insert_cut_map(video_id, cuts)
        logger.info("Created cut_map %s", cut_map_id)
        update_job_progress(job_id, 90)

        # Step 4: Update project status and complete job (100%)
        update_project_status(project_id, "ready")
        complete_job(job_id)

        logger.info("Detect job complete: %s (cuts=%d)", json.dumps(ctx), len(cuts))

    except Exception as exc:
        error_msg = str(exc)[:2000]
        logger.error("Detect job failed: %s error=%s", json.dumps(ctx), error_msg)
        fail_job(job_id, error_msg)
        try:
            update_project_status(project_id, "failed")
        except Exception:
            logger.exception("Failed to update project status to failed")

    finally:
        # Cleanup temp directory
        import shutil
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
