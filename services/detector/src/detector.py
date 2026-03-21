"""Core silence detection logic.

Analyzes audio extracted from video to identify silence regions.
Uses librosa for RMS energy computation in sliding windows.
"""

from __future__ import annotations

import logging
import subprocess
import tempfile
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

# Audio extraction parameters
SAMPLE_RATE = 16000
MONO_CHANNELS = 1

# RMS analysis parameters
WINDOW_MS = 50
HOP_MS = 25


@dataclass
class SilenceRegion:
    id: str
    type: str
    start: float
    end: float
    duration: float
    confidence: float
    auto_accept: bool
    metadata: dict[str, Any]


def detect_silence(
    video_path: str,
    *,
    threshold_db: float = -40.0,
    min_duration: float = 1.5,
    auto_accept_duration: float = 2.0,
    auto_accept_confidence: float = 0.85,
) -> list[dict[str, Any]]:
    """Detect silence regions in a video file.

    Args:
        video_path: Path to the input video file.
        threshold_db: RMS dB level below which audio is considered silence.
        min_duration: Minimum silence duration in seconds to report.
        auto_accept_duration: Silences longer than this are auto-accepted.
        auto_accept_confidence: Minimum confidence for auto-accept.

    Returns:
        List of silence region dicts matching the cut_map cuts format.
    """
    logger.info("Extracting audio from %s", video_path)
    audio = _extract_audio(video_path)

    if audio.size == 0:
        logger.warning("No audio data extracted from %s", video_path)
        return []

    logger.info("Computing RMS energy (samples=%d, sr=%d)", len(audio), SAMPLE_RATE)
    rms_db, hop_length = _compute_rms_db(audio)

    logger.info("Identifying silence regions (threshold=%.1f dB, min_duration=%.1f s)", threshold_db, min_duration)
    regions = _find_silence_regions(
        rms_db,
        hop_length=hop_length,
        sample_rate=SAMPLE_RATE,
        threshold_db=threshold_db,
        min_duration=min_duration,
    )

    # Build cut map entries
    cuts: list[dict[str, Any]] = []
    for i, (start, end, avg_db) in enumerate(regions):
        duration = end - start
        confidence = _compute_confidence(duration, avg_db, threshold_db)
        auto_accept = duration > auto_accept_duration and confidence > auto_accept_confidence

        region = SilenceRegion(
            id=f"cut_{i + 1:03d}",
            type="silence",
            start=round(start, 3),
            end=round(end, 3),
            duration=round(duration, 3),
            confidence=round(confidence, 3),
            auto_accept=auto_accept,
            metadata={"avg_rms_db": round(avg_db, 1)},
        )
        cuts.append(asdict(region))

    logger.info("Detected %d silence regions", len(cuts))
    return cuts


def _extract_audio(video_path: str) -> np.ndarray:
    """Extract mono 16kHz audio from video using FFmpeg, return as float32 numpy array."""
    cmd = [
        "ffmpeg",
        "-i", video_path,
        "-ac", str(MONO_CHANNELS),
        "-ar", str(SAMPLE_RATE),
        "-f", "f32le",
        "-v", "quiet",
        "pipe:1",
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        timeout=300,  # 5 minutes max
    )

    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"FFmpeg audio extraction failed (code {result.returncode}): {stderr}")

    if len(result.stdout) == 0:
        return np.array([], dtype=np.float32)

    return np.frombuffer(result.stdout, dtype=np.float32)


def _compute_rms_db(
    audio: np.ndarray,
) -> tuple[np.ndarray, int]:
    """Compute RMS energy in dB using sliding windows.

    Returns:
        Tuple of (rms_db_array, hop_length_in_samples).
    """
    import librosa

    window_length = int(SAMPLE_RATE * WINDOW_MS / 1000)
    hop_length = int(SAMPLE_RATE * HOP_MS / 1000)

    # librosa.feature.rms returns shape (1, n_frames)
    rms = librosa.feature.rms(
        y=audio,
        frame_length=window_length,
        hop_length=hop_length,
    )[0]

    # Convert to dB, clamp floor at -80 dB to avoid -inf
    with np.errstate(divide="ignore"):
        rms_db = np.where(rms > 0, 20 * np.log10(np.maximum(rms, 1e-10)), -80.0)

    return rms_db, hop_length


def _find_silence_regions(
    rms_db: np.ndarray,
    *,
    hop_length: int,
    sample_rate: int,
    threshold_db: float,
    min_duration: float,
) -> list[tuple[float, float, float]]:
    """Find contiguous silence regions.

    Returns:
        List of (start_seconds, end_seconds, avg_db) tuples.
    """
    is_silent = rms_db < threshold_db
    regions: list[tuple[float, float, float]] = []

    hop_duration = hop_length / sample_rate
    in_silence = False
    silence_start_idx = 0

    for i, silent in enumerate(is_silent):
        if silent and not in_silence:
            # Start of silence region
            in_silence = True
            silence_start_idx = i
        elif not silent and in_silence:
            # End of silence region
            in_silence = False
            start_time = silence_start_idx * hop_duration
            end_time = i * hop_duration
            duration = end_time - start_time

            if duration >= min_duration:
                avg_db = float(np.mean(rms_db[silence_start_idx:i]))
                regions.append((start_time, end_time, avg_db))

    # Handle silence extending to end of audio
    if in_silence:
        start_time = silence_start_idx * hop_duration
        end_time = len(rms_db) * hop_duration
        duration = end_time - start_time
        if duration >= min_duration:
            avg_db = float(np.mean(rms_db[silence_start_idx:]))
            regions.append((start_time, end_time, avg_db))

    return regions


def _compute_confidence(duration: float, avg_db: float, threshold_db: float) -> float:
    """Compute a confidence score for a silence region.

    Longer silence and deeper silence (lower dB) yield higher confidence.
    Returns a value between 0.0 and 1.0.
    """
    # Duration component: ramps from 0.5 at min_duration to 1.0 at 5+ seconds
    duration_score = min(1.0, 0.5 + (duration / 10.0))

    # Depth component: how far below threshold (0.5 at threshold, 1.0 at -80dB)
    depth_range = 80.0 + threshold_db  # e.g., 40 dB range from threshold to -80
    if depth_range > 0:
        depth_below = min(abs(avg_db - threshold_db), depth_range)
        depth_score = 0.5 + 0.5 * (depth_below / depth_range)
    else:
        depth_score = 0.75

    # Weighted average
    confidence = 0.6 * duration_score + 0.4 * depth_score
    return min(1.0, max(0.0, confidence))
