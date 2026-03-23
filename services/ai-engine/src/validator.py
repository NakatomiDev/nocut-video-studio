"""Quality validation for generated fill segments.

Computes SSIM and other metrics to score the quality of generated fills.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import cv2
import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class QualityResult:
    """Quality assessment of a generated fill."""

    score: float              # Composite quality score 0.0 - 1.0
    ssim_entry: float         # SSIM at entry boundary
    ssim_exit: float          # SSIM at exit boundary
    temporal_smoothness: float  # Frame-to-frame consistency


def compute_ssim(img1: np.ndarray, img2: np.ndarray) -> float:
    """Compute SSIM between two images.

    Uses a simplified SSIM implementation with 8x8 windows.

    Args:
        img1: (H, W, 3) uint8 image.
        img2: (H, W, 3) uint8 image.

    Returns:
        SSIM value between 0.0 and 1.0.
    """
    # Convert to grayscale for SSIM
    if len(img1.shape) == 3:
        gray1 = cv2.cvtColor(img1, cv2.COLOR_RGB2GRAY).astype(np.float64)
    else:
        gray1 = img1.astype(np.float64)

    if len(img2.shape) == 3:
        gray2 = cv2.cvtColor(img2, cv2.COLOR_RGB2GRAY).astype(np.float64)
    else:
        gray2 = img2.astype(np.float64)

    C1 = (0.01 * 255) ** 2
    C2 = (0.03 * 255) ** 2

    mu1 = cv2.GaussianBlur(gray1, (11, 11), 1.5)
    mu2 = cv2.GaussianBlur(gray2, (11, 11), 1.5)

    mu1_sq = mu1 ** 2
    mu2_sq = mu2 ** 2
    mu1_mu2 = mu1 * mu2

    sigma1_sq = cv2.GaussianBlur(gray1 ** 2, (11, 11), 1.5) - mu1_sq
    sigma2_sq = cv2.GaussianBlur(gray2 ** 2, (11, 11), 1.5) - mu2_sq
    sigma12 = cv2.GaussianBlur(gray1 * gray2, (11, 11), 1.5) - mu1_mu2

    numerator = (2 * mu1_mu2 + C1) * (2 * sigma12 + C2)
    denominator = (mu1_sq + mu2_sq + C1) * (sigma1_sq + sigma2_sq + C2)

    ssim_map = numerator / denominator
    return float(np.mean(ssim_map))


def compute_temporal_smoothness(frames: np.ndarray) -> float:
    """Measure frame-to-frame consistency.

    Computes average SSIM between consecutive frames. Higher values
    indicate smoother transitions.

    Args:
        frames: (N, H, W, 3) uint8 frames.

    Returns:
        Average inter-frame SSIM (0.0 - 1.0).
    """
    if len(frames) < 2:
        return 1.0

    ssim_sum = 0.0
    count = 0
    # Sample up to 10 consecutive pairs to keep computation fast
    step = max(1, len(frames) // 10)
    for i in range(0, len(frames) - 1, step):
        ssim_sum += compute_ssim(frames[i], frames[i + 1])
        count += 1

    return ssim_sum / count if count > 0 else 1.0


def validate_fill(
    fill_frames: np.ndarray,
    pre_frames: np.ndarray,
    post_frames: np.ndarray,
) -> QualityResult:
    """Validate the quality of generated fill frames.

    Args:
        fill_frames: (N, H, W, 3) uint8 generated fill frames.
        pre_frames: (M, H, W, 3) uint8 boundary frames before the cut.
        post_frames: (M, H, W, 3) uint8 boundary frames after the cut.

    Returns:
        QualityResult with composite score and individual metrics.
    """
    # SSIM at entry boundary: first fill frame vs last pre-cut frame
    ssim_entry = compute_ssim(fill_frames[0], pre_frames[-1])

    # SSIM at exit boundary: last fill frame vs first post-cut frame
    ssim_exit = compute_ssim(fill_frames[-1], post_frames[0])

    # Temporal smoothness within the fill
    temporal = compute_temporal_smoothness(fill_frames)

    # Composite score: weighted average
    # Entry/exit boundaries matter most (40% each), temporal smoothness 20%
    score = 0.4 * ssim_entry + 0.4 * ssim_exit + 0.2 * temporal

    result = QualityResult(
        score=score,
        ssim_entry=ssim_entry,
        ssim_exit=ssim_exit,
        temporal_smoothness=temporal,
    )

    logger.info(
        "Quality validation: score=%.3f (entry_ssim=%.3f, exit_ssim=%.3f, temporal=%.3f)",
        result.score, result.ssim_entry, result.ssim_exit, result.temporal_smoothness,
    )

    return result
