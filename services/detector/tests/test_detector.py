"""Tests for the silence detection logic.

Generates synthetic audio with known silence regions and verifies detection.
Uses soundfile for WAV generation (no FFmpeg needed for test setup).
The detect_silence function still needs FFmpeg to extract audio from video,
so these tests write WAV files directly and call the internal analysis functions.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import soundfile as sf


def _generate_test_audio(
    duration: float = 10.0,
    sample_rate: int = 16000,
    silence_ranges: list[tuple[float, float]] | None = None,
) -> np.ndarray:
    """Generate a synthetic audio signal with silence regions."""
    total_samples = int(duration * sample_rate)
    t = np.linspace(0, duration, total_samples, dtype=np.float32)
    audio = 0.5 * np.sin(2 * np.pi * 440 * t).astype(np.float32)

    if silence_ranges:
        for start, end in silence_ranges:
            s = int(start * sample_rate)
            e = min(int(end * sample_rate), total_samples)
            audio[s:e] = 0.0

    return audio


def _write_wav(audio: np.ndarray, sample_rate: int, path: str) -> None:
    """Write audio to WAV file using soundfile."""
    sf.write(path, audio, sample_rate, subtype="FLOAT")


class TestRMSComputation:
    """Test the internal RMS computation."""

    def test_rms_silent_audio_is_low(self) -> None:
        from src.detector import _compute_rms_db

        silent = np.zeros(16000, dtype=np.float32)
        rms_db, _ = _compute_rms_db(silent)
        assert np.all(rms_db <= -70), "Silent audio should have very low dB"

    def test_rms_loud_audio_is_high(self) -> None:
        from src.detector import _compute_rms_db

        t = np.linspace(0, 1.0, 16000, dtype=np.float32)
        loud = 0.5 * np.sin(2 * np.pi * 440 * t).astype(np.float32)
        rms_db, _ = _compute_rms_db(loud)
        assert np.mean(rms_db) > -20, "Loud sine wave should have high dB"


class TestFindSilenceRegions:
    """Test the silence region finder on pre-computed RMS arrays."""

    def test_finds_silence_in_middle(self) -> None:
        from src.detector import _compute_rms_db, _find_silence_regions

        audio = _generate_test_audio(duration=10.0, silence_ranges=[(3.0, 6.0)])
        rms_db, hop_length = _compute_rms_db(audio)

        regions = _find_silence_regions(
            rms_db,
            hop_length=hop_length,
            sample_rate=16000,
            threshold_db=-40.0,
            min_duration=1.5,
        )

        assert len(regions) >= 1, f"Expected at least 1 region, got {len(regions)}"
        start, end, avg_db = regions[0]
        assert start < 3.5, f"Start {start} should be near 3.0"
        assert end > 5.5, f"End {end} should be near 6.0"
        assert avg_db < -40.0

    def test_no_silence_in_continuous_audio(self) -> None:
        from src.detector import _compute_rms_db, _find_silence_regions

        audio = _generate_test_audio(duration=5.0, silence_ranges=[])
        rms_db, hop_length = _compute_rms_db(audio)

        regions = _find_silence_regions(
            rms_db,
            hop_length=hop_length,
            sample_rate=16000,
            threshold_db=-40.0,
            min_duration=1.5,
        )
        assert len(regions) == 0

    def test_short_silence_ignored(self) -> None:
        from src.detector import _compute_rms_db, _find_silence_regions

        audio = _generate_test_audio(duration=5.0, silence_ranges=[(2.0, 2.5)])
        rms_db, hop_length = _compute_rms_db(audio)

        regions = _find_silence_regions(
            rms_db,
            hop_length=hop_length,
            sample_rate=16000,
            threshold_db=-40.0,
            min_duration=1.5,
        )
        assert len(regions) == 0

    def test_multiple_regions(self) -> None:
        from src.detector import _compute_rms_db, _find_silence_regions

        audio = _generate_test_audio(
            duration=20.0,
            silence_ranges=[(2.0, 4.0), (8.0, 11.0), (15.0, 18.0)],
        )
        rms_db, hop_length = _compute_rms_db(audio)

        regions = _find_silence_regions(
            rms_db,
            hop_length=hop_length,
            sample_rate=16000,
            threshold_db=-40.0,
            min_duration=1.5,
        )
        assert len(regions) == 3, f"Expected 3 regions, got {len(regions)}"
        for i in range(len(regions) - 1):
            assert regions[i][0] < regions[i + 1][0], "Regions should be ordered"


class TestConfidenceScore:
    """Test the confidence scoring function."""

    def test_long_deep_silence_high_confidence(self) -> None:
        from src.detector import _compute_confidence

        score = _compute_confidence(duration=5.0, avg_db=-70.0, threshold_db=-40.0)
        assert score > 0.85, f"Long deep silence should have high confidence, got {score}"

    def test_short_shallow_silence_lower_confidence(self) -> None:
        from src.detector import _compute_confidence

        score = _compute_confidence(duration=1.5, avg_db=-42.0, threshold_db=-40.0)
        assert score < 0.8, f"Short shallow silence should have lower confidence, got {score}"

    def test_confidence_bounded(self) -> None:
        from src.detector import _compute_confidence

        score = _compute_confidence(duration=100.0, avg_db=-80.0, threshold_db=-40.0)
        assert 0.0 <= score <= 1.0


def _ffmpeg_available() -> bool:
    import subprocess
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=5)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


class TestDetectSilenceEndToEnd:
    """End-to-end test using detect_silence with WAV files (requires FFmpeg)."""

    @pytest.fixture
    def wav_with_silence(self, tmp_path: Path) -> str:
        audio = _generate_test_audio(duration=10.0, silence_ranges=[(3.0, 6.0)])
        path = str(tmp_path / "test.wav")
        _write_wav(audio, 16000, path)
        return path

    @pytest.mark.skipif(
        not _ffmpeg_available(),
        reason="FFmpeg not installed",
    )
    def test_detect_silence_wav(self, wav_with_silence: str) -> None:
        from src.detector import detect_silence

        cuts = detect_silence(
            wav_with_silence,
            threshold_db=-40.0,
            min_duration=1.5,
            auto_accept_duration=2.0,
            auto_accept_confidence=0.85,
        )

        assert len(cuts) >= 1
        cut = cuts[0]
        assert cut["type"] == "silence"
        assert cut["id"] == "cut_001"
        assert cut["duration"] > 2.0
        assert cut["auto_accept"] is True
        assert "avg_rms_db" in cut["metadata"]
