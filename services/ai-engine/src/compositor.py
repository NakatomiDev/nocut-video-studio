"""Temporal compositing: boundary crossfade ramps and color matching."""

from __future__ import annotations

import logging

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Default ramp frames; overridden by config at runtime.
_DEFAULT_RAMP_FRAMES = 5


def match_color_histogram(source: np.ndarray, reference: np.ndarray) -> np.ndarray:
    """Match the color histogram of source to reference using histogram equalization.

    Converts to LAB color space, matches the L channel histogram,
    and adjusts A/B channels to match the reference mean/std.

    Args:
        source: (H, W, 3) uint8 BGR frame.
        reference: (H, W, 3) uint8 BGR frame.

    Returns:
        Color-matched frame (H, W, 3) uint8 BGR.
    """
    src_lab = cv2.cvtColor(source, cv2.COLOR_BGR2LAB).astype(np.float32)
    ref_lab = cv2.cvtColor(reference, cv2.COLOR_BGR2LAB).astype(np.float32)

    for ch in range(3):
        src_mean, src_std = src_lab[:, :, ch].mean(), src_lab[:, :, ch].std()
        ref_mean, ref_std = ref_lab[:, :, ch].mean(), ref_lab[:, :, ch].std()

        if src_std < 1e-6:
            continue

        src_lab[:, :, ch] = (src_lab[:, :, ch] - src_mean) * (ref_std / src_std) + ref_mean

    result = np.clip(src_lab, 0, 255).astype(np.uint8)
    return cv2.cvtColor(result, cv2.COLOR_LAB2BGR)


def apply_boundary_crossfade(
    fill_frames: np.ndarray,
    pre_frames: np.ndarray,
    post_frames: np.ndarray,
    ramp_frames: int | None = None,
) -> np.ndarray:
    """Apply crossfade ramps at the boundaries of fill frames.

    Blends the first `ramp_frames` of the fill with the last pre-cut frames,
    and the last `ramp_frames` of the fill with the first post-cut frames.
    Also applies color matching to smooth luminance transitions.

    Args:
        fill_frames: (N, H, W, 3) uint8 generated fill frames (RGB).
        pre_frames: (M, H, W, 3) uint8 frames before the cut (RGB).
        post_frames: (M, H, W, 3) uint8 frames after the cut (RGB).
        ramp_frames: Number of frames for the crossfade ramp (default from config).

    Returns:
        Composited frames (N, H, W, 3) uint8 RGB.
    """
    if ramp_frames is None:
        try:
            from . import config
            ramp_frames = config.CROSSFADE_RAMP_FRAMES
        except (ImportError, RuntimeError):
            ramp_frames = _DEFAULT_RAMP_FRAMES

    n_fill = len(fill_frames)
    if n_fill == 0:
        return fill_frames

    ramp = min(ramp_frames, n_fill // 2, len(pre_frames), len(post_frames))
    if ramp < 1:
        return fill_frames

    result = fill_frames.copy().astype(np.float32)

    # Color-match the fill endpoints to the boundary frames
    # Convert to BGR for OpenCV color matching, then back to RGB
    pre_last_bgr = cv2.cvtColor(pre_frames[-1], cv2.COLOR_RGB2BGR)
    post_first_bgr = cv2.cvtColor(post_frames[0], cv2.COLOR_RGB2BGR)

    # Entry ramp: blend pre-cut tail into fill start
    for i in range(ramp):
        alpha = (i + 1) / (ramp + 1)
        pre_frame = pre_frames[-(ramp - i)].astype(np.float32)
        result[i] = (1.0 - alpha) * pre_frame + alpha * result[i]

    # Exit ramp: blend fill end into post-cut head
    for i in range(ramp):
        alpha = (i + 1) / (ramp + 1)
        post_frame = post_frames[i].astype(np.float32)
        idx = n_fill - ramp + i
        result[idx] = (1.0 - alpha) * result[idx] + alpha * post_frame

    # Apply color matching across all fill frames to smooth transitions
    mid_idx = n_fill // 2
    for i in range(n_fill):
        frame_bgr = cv2.cvtColor(np.clip(result[i], 0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR)
        if i <= mid_idx:
            matched = match_color_histogram(frame_bgr, pre_last_bgr)
        else:
            matched = match_color_histogram(frame_bgr, post_first_bgr)
        result[i] = cv2.cvtColor(matched, cv2.COLOR_BGR2RGB).astype(np.float32)

    composited = np.clip(result, 0, 255).astype(np.uint8)
    logger.info("Applied boundary crossfade (ramp=%d frames) to %d fill frames", ramp, n_fill)
    return composited
