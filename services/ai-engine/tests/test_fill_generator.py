"""Tests for the crossfade fill generator."""

import numpy as np
import pytest


def _make_frames(n: int, h: int = 64, w: int = 64, value: int = 0) -> np.ndarray:
    """Create a batch of solid-color test frames."""
    return np.full((n, h, w, 3), value, dtype=np.uint8)


class TestCrossfadeFillGenerator:
    def setup_method(self):
        from src.fill_generator import CrossfadeFillGenerator
        self.gen = CrossfadeFillGenerator()

    def test_output_shape(self):
        pre = _make_frames(5, value=0)
        post = _make_frames(5, value=255)
        result = self.gen.generate(pre, post, None, 10)
        assert result.frames.shape == (10, 64, 64, 3)
        assert result.method == "crossfade"

    def test_single_frame(self):
        pre = _make_frames(5, value=0)
        post = _make_frames(5, value=200)
        result = self.gen.generate(pre, post, None, 1)
        assert result.frames.shape == (1, 64, 64, 3)
        # Single frame should be approximately midpoint
        mid = result.frames[0].mean()
        assert 80 < mid < 120

    def test_monotonic_alpha(self):
        """Frames should smoothly transition from dark to bright."""
        pre = _make_frames(5, value=0)
        post = _make_frames(5, value=255)
        result = self.gen.generate(pre, post, None, 20)

        means = [result.frames[i].mean() for i in range(20)]
        # Each frame should be brighter than the previous
        for i in range(1, len(means)):
            assert means[i] > means[i - 1], f"Frame {i} not brighter than {i-1}"

    def test_zero_target_becomes_one(self):
        """Target frame count of 0 should produce at least 1 frame."""
        pre = _make_frames(5, value=0)
        post = _make_frames(5, value=255)
        result = self.gen.generate(pre, post, None, 0)
        assert len(result.frames) >= 1

    def test_confidence(self):
        pre = _make_frames(5, value=0)
        post = _make_frames(5, value=255)
        result = self.gen.generate(pre, post, None, 10)
        assert 0.0 <= result.confidence <= 1.0

    def test_speaker_embedding_ignored(self):
        """Crossfade generator should work the same regardless of embedding."""
        pre = _make_frames(5, value=50)
        post = _make_frames(5, value=200)
        result_none = self.gen.generate(pre, post, None, 10)
        fake_embedding = np.random.randn(128).astype(np.float32)
        result_emb = self.gen.generate(pre, post, fake_embedding, 10)
        np.testing.assert_array_equal(result_none.frames, result_emb.frames)


class TestCompositor:
    def test_boundary_crossfade_shape(self):
        from src.compositor import apply_boundary_crossfade
        fill = _make_frames(20, value=128)
        pre = _make_frames(15, value=0)
        post = _make_frames(15, value=255)
        result = apply_boundary_crossfade(fill, pre, post, ramp_frames=5)
        assert result.shape == fill.shape

    def test_short_fill_no_crash(self):
        """Very short fills should not crash."""
        from src.compositor import apply_boundary_crossfade
        fill = _make_frames(2, value=128)
        pre = _make_frames(15, value=0)
        post = _make_frames(15, value=255)
        result = apply_boundary_crossfade(fill, pre, post, ramp_frames=5)
        assert result.shape == fill.shape

    def test_empty_fill(self):
        from src.compositor import apply_boundary_crossfade
        fill = np.empty((0, 64, 64, 3), dtype=np.uint8)
        pre = _make_frames(15, value=0)
        post = _make_frames(15, value=255)
        result = apply_boundary_crossfade(fill, pre, post)
        assert len(result) == 0


class TestValidator:
    def test_identical_frames_high_ssim(self):
        from src.validator import compute_ssim
        frame = _make_frames(1, value=128)[0]
        ssim = compute_ssim(frame, frame)
        assert ssim > 0.95

    def test_different_frames_low_ssim(self):
        from src.validator import compute_ssim
        frame_a = _make_frames(1, value=0)[0]
        frame_b = _make_frames(1, value=255)[0]
        ssim = compute_ssim(frame_a, frame_b)
        assert ssim < 0.5

    def test_validate_fill_returns_score(self):
        from src.validator import validate_fill
        fill = _make_frames(10, value=128)
        pre = _make_frames(5, value=100)
        post = _make_frames(5, value=150)
        result = validate_fill(fill, pre, post)
        assert 0.0 <= result.score <= 1.0
        assert 0.0 <= result.ssim_entry <= 1.0
        assert 0.0 <= result.ssim_exit <= 1.0
        assert 0.0 <= result.temporal_smoothness <= 1.0

    def test_temporal_smoothness_constant_frames(self):
        from src.validator import compute_temporal_smoothness
        frames = _make_frames(10, value=128)
        smoothness = compute_temporal_smoothness(frames)
        assert smoothness > 0.95

    def test_temporal_smoothness_single_frame(self):
        from src.validator import compute_temporal_smoothness
        frames = _make_frames(1, value=128)
        assert compute_temporal_smoothness(frames) == 1.0
