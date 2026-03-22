"""Face enrollment stub for MVP.

Phase 2 will use MediaPipe for face detection and embedding extraction.
For the crossfade MVP, speaker embeddings are not used.
"""

from __future__ import annotations

import logging

import numpy as np

logger = logging.getLogger(__name__)


def get_speaker_embedding(video_path: str, timestamp: float) -> np.ndarray | None:
    """Extract a speaker face embedding from a video frame.

    MVP stub: returns None. The crossfade generator ignores embeddings.
    Phase 2 will use MediaPipe Face Mesh to extract a 128-d embedding.

    Args:
        video_path: Path to the source video.
        timestamp: Timestamp to extract the face from.

    Returns:
        None for MVP. Will return np.ndarray (128,) in Phase 2.
    """
    logger.debug("Speaker enrollment stub called (MVP — no-op)")
    return None
