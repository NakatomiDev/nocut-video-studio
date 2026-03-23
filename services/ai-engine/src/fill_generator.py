"""Abstract fill generator and crossfade MVP implementation.

The FillGenerator ABC allows swapping in real AI providers (D-ID, Veo, etc.)
in Phase 2 while keeping the same pipeline interface.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass

import cv2
import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class GenerationResult:
    """Result of a fill generation operation."""

    frames: np.ndarray        # (N, H, W, 3) uint8
    method: str               # 'crossfade', 'ai_fill', 'hard_cut'
    confidence: float         # 0.0 - 1.0, how confident the generator is in the result
    metadata: dict | None = None


class FillGenerator(ABC):
    """Abstract base class for fill generation strategies."""

    @abstractmethod
    def generate(
        self,
        pre_frames: np.ndarray,
        post_frames: np.ndarray,
        speaker_embedding: np.ndarray | None,
        target_frame_count: int,
    ) -> GenerationResult:
        """Generate fill frames to bridge a gap.

        Args:
            pre_frames: (N, H, W, 3) frames before the cut.
            post_frames: (N, H, W, 3) frames after the cut.
            speaker_embedding: Optional face/speaker embedding for AI generation.
            target_frame_count: Number of frames to generate.

        Returns:
            GenerationResult with generated frames and metadata.
        """
        pass


class CrossfadeFillGenerator(FillGenerator):
    """MVP fill generator using linear alpha crossfade.

    Produces a smooth morph from the last pre-cut frame to the first
    post-cut frame. Simple but sufficient to test the full pipeline.
    """

    def generate(
        self,
        pre_frames: np.ndarray,
        post_frames: np.ndarray,
        speaker_embedding: np.ndarray | None,
        target_frame_count: int,
    ) -> GenerationResult:
        if target_frame_count < 1:
            target_frame_count = 1

        # Use the last pre-cut frame and first post-cut frame as endpoints
        frame_a = pre_frames[-1].astype(np.float32)
        frame_b = post_frames[0].astype(np.float32)

        frames = np.empty(
            (target_frame_count, frame_a.shape[0], frame_a.shape[1], 3),
            dtype=np.uint8,
        )

        for i in range(target_frame_count):
            # Linear alpha from 0.0 (frame_a) to 1.0 (frame_b)
            alpha = (i + 1) / (target_frame_count + 1)
            blended = (1.0 - alpha) * frame_a + alpha * frame_b
            frames[i] = np.clip(blended, 0, 255).astype(np.uint8)

        logger.info(
            "Generated %d crossfade frames (%dx%d)",
            target_frame_count, frame_a.shape[1], frame_a.shape[0],
        )

        return GenerationResult(
            frames=frames,
            method="crossfade",
            confidence=0.8,
            metadata={"alpha_range": [0.0, 1.0], "interpolation": "linear"},
        )


# Future Phase 2 providers:
# class DIDFillGenerator(FillGenerator): ...
# class VeoFillGenerator(FillGenerator): ...
