"""Boundary frame extraction using FFmpeg.

Extracts frames around each cut point for analysis and fill generation.
"""

from __future__ import annotations

import logging
import subprocess
from dataclasses import dataclass

import numpy as np

from . import config

logger = logging.getLogger(__name__)


@dataclass
class BoundaryFrames:
    """Frames extracted around a single gap boundary."""

    gap_index: int
    pre_frames: np.ndarray   # (N, H, W, 3) uint8 — frames before the cut
    post_frames: np.ndarray  # (N, H, W, 3) uint8 — frames after the cut
    fps: float
    width: int
    height: int


def probe_video(video_path: str) -> tuple[int, int, float]:
    """Return (width, height, fps) of the video using FFprobe."""
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate",
        "-of", "csv=p=0",
        video_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    parts = result.stdout.strip().split(",")
    width = int(parts[0])
    height = int(parts[1])
    # r_frame_rate is a fraction like "30/1"
    fps_parts = parts[2].split("/")
    fps = float(fps_parts[0]) / float(fps_parts[1])
    return width, height, fps


def extract_frames(
    video_path: str,
    timestamp: float,
    count: int,
    width: int,
    height: int,
    before: bool = True,
) -> np.ndarray:
    """Extract `count` frames around a timestamp as a numpy array.

    Args:
        video_path: Path to the source video.
        timestamp: The cut point timestamp in seconds.
        count: Number of frames to extract.
        width: Video width in pixels.
        height: Video height in pixels.
        before: If True, extract frames ending at timestamp.
                If False, extract frames starting at timestamp.

    Returns:
        numpy array of shape (count, height, width, 3) dtype uint8.
    """
    if before:
        # Seek to a position that gives us `count` frames ending at timestamp.
        # We seek back by (count / fps) seconds, but fps isn't passed here,
        # so we use a generous seek window and take the last `count` frames.
        seek_start = max(0.0, timestamp - 2.0)
        cmd = [
            "ffmpeg", "-v", "error",
            "-ss", f"{seek_start:.4f}",
            "-i", video_path,
            "-t", f"{timestamp - seek_start:.4f}",
            "-vf", f"scale={width}:{height}",
            "-f", "rawvideo",
            "-pix_fmt", "rgb24",
            "-",
        ]
    else:
        cmd = [
            "ffmpeg", "-v", "error",
            "-ss", f"{timestamp:.4f}",
            "-i", video_path,
            "-frames:v", str(count),
            "-vf", f"scale={width}:{height}",
            "-f", "rawvideo",
            "-pix_fmt", "rgb24",
            "-",
        ]

    result = subprocess.run(cmd, capture_output=True, check=True)
    raw = result.stdout
    frame_size = width * height * 3
    total_frames = len(raw) // frame_size

    if total_frames == 0:
        raise RuntimeError(
            f"No frames extracted at timestamp {timestamp:.3f}s "
            f"(before={before}, expected {count})"
        )

    frames = np.frombuffer(raw[:total_frames * frame_size], dtype=np.uint8)
    frames = frames.reshape(total_frames, height, width, 3)

    if before:
        # Take the last `count` frames
        frames = frames[-count:]
    else:
        frames = frames[:count]

    return frames


def analyze_boundaries(
    video_path: str,
    gaps: list[dict],
    target_fps: float | None = None,
) -> list[BoundaryFrames]:
    """Extract boundary frames for all gaps in the video.

    Args:
        video_path: Path to the local source video.
        gaps: List of gap dicts from the job payload.
        target_fps: Override fps (uses video fps if None).

    Returns:
        List of BoundaryFrames, one per gap.
    """
    width, height, video_fps = probe_video(video_path)
    fps = target_fps or video_fps
    frame_count = config.BOUNDARY_FRAME_COUNT

    results: list[BoundaryFrames] = []
    for gap in gaps:
        gap_index = gap["gap_index"]
        pre_ts = gap["pre_cut_timestamp"]
        post_ts = gap["post_cut_timestamp"]

        logger.info(
            "Extracting boundary frames for gap %d: pre=%.3fs, post=%.3fs",
            gap_index, pre_ts, post_ts,
        )

        pre_frames = extract_frames(video_path, pre_ts, frame_count, width, height, before=True)
        post_frames = extract_frames(video_path, post_ts, frame_count, width, height, before=False)

        results.append(BoundaryFrames(
            gap_index=gap_index,
            pre_frames=pre_frames,
            post_frames=post_frames,
            fps=fps,
            width=width,
            height=height,
        ))

    return results
