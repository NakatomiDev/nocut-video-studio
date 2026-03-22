"""Entry point for the AI fill engine service.

Polls the Supabase job_queue table for 'ai.fill' jobs and processes them
using the crossfade fill generator (MVP Phase 1).
"""

from __future__ import annotations

import json
import logging
import math
import os
import shutil
import signal
import subprocess
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
logger = logging.getLogger("ai-engine")

# Defer config import so logging is set up first
from . import config
from .boundary_analyzer import analyze_boundaries, BoundaryFrames
from .compositor import apply_boundary_crossfade
from .enrollment import get_speaker_embedding
from .fill_generator import CrossfadeFillGenerator, GenerationResult
from .s3_utils import download_file, upload_file
from .supabase_client import (
    claim_job,
    complete_job,
    enqueue_export_job,
    fail_job,
    increment_attempts,
    insert_ai_fill,
    poll_queued_jobs,
    refund_credits,
    update_edit_decision_status,
    update_job_progress,
    update_project_status,
)
from .validator import validate_fill

import numpy as np

_shutdown = False
_generator = CrossfadeFillGenerator()


def _handle_signal(signum: int, frame: Any) -> None:
    global _shutdown
    logger.info("Received signal %d, shutting down...", signum)
    _shutdown = True


def main() -> None:
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    logger.info(
        "AI engine service starting (poll_interval=%ds, boundary_frames=%d, ramp_frames=%d)",
        config.POLL_INTERVAL_SECONDS,
        config.BOUNDARY_FRAME_COUNT,
        config.CROSSFADE_RAMP_FRAMES,
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

    logger.info("AI engine service shut down")


def _process_job(job: dict[str, Any]) -> None:
    job_id = job["id"]
    project_id = job["project_id"]
    user_id = job["user_id"]
    payload = job["payload"]

    edit_decision_id = payload["edit_decision_id"]
    credit_transaction_id = payload.get("credit_transaction_id")
    source_s3_key = payload["source_video_s3_key"]
    gaps = payload["gaps"]
    target_fps = payload.get("target_fps", 30)

    ctx = {"job_id": job_id, "project_id": project_id, "edit_decision_id": edit_decision_id}
    logger.info("Processing ai.fill job: %s (%d gaps)", json.dumps(ctx), len(gaps))

    # Claim the job (optimistic lock)
    if not claim_job(job_id):
        logger.info("Job %s already claimed by another worker", job_id)
        return

    increment_attempts(job_id)
    update_edit_decision_status(edit_decision_id, "processing")

    tmp_dir = tempfile.mkdtemp(prefix=f"ai-fill-{job_id}-")
    try:
        # Step 1: Download source video (10%)
        ext = Path(source_s3_key).suffix or ".mp4"
        local_video = os.path.join(tmp_dir, f"source{ext}")
        logger.info("Downloading %s", source_s3_key)
        download_file(source_s3_key, local_video)
        update_job_progress(job_id, 10)

        # Step 2: Extract boundary frames (20%)
        logger.info("Analyzing boundaries for %d gaps", len(gaps))
        boundaries = analyze_boundaries(local_video, gaps, target_fps=target_fps)
        update_job_progress(job_id, 20)

        # Step 3: Process each gap
        total_gaps = len(gaps)
        failed_gaps: list[int] = []
        progress_per_gap = 60 / max(total_gaps, 1)  # 20% - 80% range

        for i, (gap, boundary) in enumerate(zip(gaps, boundaries)):
            gap_progress = 20 + int((i + 1) * progress_per_gap)
            try:
                _process_gap(
                    gap=gap,
                    boundary=boundary,
                    edit_decision_id=edit_decision_id,
                    user_id=user_id,
                    project_id=project_id,
                    target_fps=target_fps,
                    tmp_dir=tmp_dir,
                    local_video=local_video,
                )
            except Exception as exc:
                gap_index = gap["gap_index"]
                logger.error("Gap %d failed: %s", gap_index, str(exc))
                failed_gaps.append(gap_index)

                # Insert hard_cut fallback entry
                try:
                    insert_ai_fill(
                        edit_decision_id=edit_decision_id,
                        gap_index=gap_index,
                        method="hard_cut",
                        s3_key="",
                        duration_seconds=0.0,
                        quality_score=0.0,
                        metadata={"error": str(exc)[:500]},
                    )
                except Exception:
                    logger.exception("Failed to insert hard_cut fallback for gap %d", gap_index)

                # Refund credits for failed gap
                if credit_transaction_id:
                    refund_credits(credit_transaction_id)

            update_job_progress(job_id, gap_progress)

        # Step 4: Finalize (80% - 100%)
        update_job_progress(job_id, 85)

        if failed_gaps:
            logger.warning(
                "Job %s completed with %d/%d failed gaps: %s",
                job_id, len(failed_gaps), total_gaps, failed_gaps,
            )

        # Update project status to exporting and enqueue export job
        update_project_status(project_id, "exporting")
        update_job_progress(job_id, 90)

        export_job_id = enqueue_export_job(project_id, user_id, edit_decision_id)
        logger.info("Enqueued export job %s for project %s", export_job_id, project_id)

        update_edit_decision_status(edit_decision_id, "complete")
        complete_job(job_id)

        logger.info("AI fill job complete: %s (failed_gaps=%s)", json.dumps(ctx), failed_gaps)

    except Exception as exc:
        error_msg = str(exc)[:2000]
        logger.error("AI fill job failed: %s error=%s", json.dumps(ctx), error_msg)
        fail_job(job_id, error_msg)
        try:
            update_edit_decision_status(edit_decision_id, "failed")
            update_project_status(project_id, "failed")
        except Exception:
            logger.exception("Failed to update statuses to failed")

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _process_gap(
    gap: dict,
    boundary: BoundaryFrames,
    edit_decision_id: str,
    user_id: str,
    project_id: str,
    target_fps: float,
    tmp_dir: str,
    local_video: str,
) -> None:
    """Process a single gap: generate fill, composite, validate, encode, upload."""
    gap_index = gap["gap_index"]
    fill_duration = gap["estimated_fill_duration"]
    target_frame_count = max(1, int(math.ceil(fill_duration * target_fps)))

    logger.info(
        "Processing gap %d: duration=%.2fs, frames=%d",
        gap_index, fill_duration, target_frame_count,
    )

    # Get speaker embedding (stub for MVP)
    speaker_embedding = get_speaker_embedding(
        local_video, gap["pre_cut_timestamp"]
    )

    # Generate fill frames via crossfade
    result: GenerationResult = _generator.generate(
        pre_frames=boundary.pre_frames,
        post_frames=boundary.post_frames,
        speaker_embedding=speaker_embedding,
        target_frame_count=target_frame_count,
    )

    # Apply temporal compositing (boundary crossfade ramps + color matching)
    composited = apply_boundary_crossfade(
        fill_frames=result.frames,
        pre_frames=boundary.pre_frames,
        post_frames=boundary.post_frames,
    )

    # Validate quality
    quality = validate_fill(
        fill_frames=composited,
        pre_frames=boundary.pre_frames,
        post_frames=boundary.post_frames,
    )

    # Encode to MP4
    output_path = os.path.join(tmp_dir, f"fill_{gap_index}.mp4")
    _encode_frames_to_mp4(composited, output_path, target_fps, boundary.width, boundary.height)

    # Upload to S3
    s3_key = f"ai-fills/{user_id}/{project_id}/fill_{gap_index}.mp4"
    upload_file(output_path, s3_key)

    # Insert ai_fills record
    fill_id = insert_ai_fill(
        edit_decision_id=edit_decision_id,
        gap_index=gap_index,
        method=result.method,
        s3_key=s3_key,
        duration_seconds=fill_duration,
        quality_score=quality.score,
        metadata={
            "ssim_entry": quality.ssim_entry,
            "ssim_exit": quality.ssim_exit,
            "temporal_smoothness": quality.temporal_smoothness,
            "generator_confidence": result.confidence,
            "frame_count": target_frame_count,
        },
    )

    logger.info(
        "Gap %d complete: fill_id=%s, method=%s, quality=%.3f",
        gap_index, fill_id, result.method, quality.score,
    )


def _encode_frames_to_mp4(
    frames: np.ndarray,
    output_path: str,
    fps: float,
    width: int,
    height: int,
) -> None:
    """Encode numpy frames to an MP4 file using FFmpeg.

    Args:
        frames: (N, H, W, 3) uint8 RGB frames.
        output_path: Path to write the output MP4.
        fps: Frame rate.
        width: Output width.
        height: Output height.
    """
    cmd = [
        "ffmpeg", "-v", "error", "-y",
        "-f", "rawvideo",
        "-pix_fmt", "rgb24",
        "-s", f"{width}x{height}",
        "-r", str(fps),
        "-i", "-",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_path,
    ]

    proc = subprocess.run(
        cmd,
        input=frames.tobytes(),
        capture_output=True,
        check=True,
    )

    logger.info("Encoded %d frames to %s", len(frames), output_path)


if __name__ == "__main__":
    main()
