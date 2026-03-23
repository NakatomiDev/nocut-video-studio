// @refresh reset
import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useEditorStore, getFillsForCut } from '@/stores/editorStore';
import { ZoomIn, ZoomOut, Scissors, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const SNAP_THRESHOLD_S = 0.1;

interface WaveformTimelineProps {
  waveformUrl: string | null;
  videoUrl: string | null;
  thumbnailSpriteUrl?: string | null;
  duration: number;
}

const WaveformTimeline = ({ waveformUrl, videoUrl, thumbnailSpriteUrl, duration }: WaveformTimelineProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const isDraggingRef = useRef(false);

  const {
    cuts,
    activeCuts,
    toggleCut,
    manualCuts,
    activeManualCuts,
    playheadPosition,
    setPlayhead,
    zoomLevel,
    setZoom,
    isPlaying,
    razorMode,
    razorStart,
    setRazorMode,
    setRazorStart,
    addManualCut,
    aiFills,
    showFills,
    toggleShowFills,
    selectFill,
    insertedFills,
  } = useEditorStore();

  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [hoveredCut, setHoveredCut] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [razorPreview, setRazorPreview] = useState<number | null>(null);
  const [thumbnailSprite, setThumbnailSprite] = useState<HTMLImageElement | null>(null);

  // Prefer server-generated thumbnail sprite, fall back to client-side extraction
  useEffect(() => {
    let cancelled = false;

    const loadSprite = async () => {
      if (!thumbnailSpriteUrl || !duration) return false;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = thumbnailSpriteUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('sprite failed to load'));
      });

      if (!cancelled) {
        setThumbnailSprite(img);
      }

      return true;
    };

    const generateFallback = async () => {
      if (!videoUrl || !duration) return;
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.preload = 'auto';
      video.muted = true;
      video.src = videoUrl;
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error('video failed to load'));
      });

      const thumbCanvas = document.createElement('canvas');
      const thumbH = 72;
      const thumbW = Math.round((video.videoWidth / video.videoHeight) * thumbH) || 96;
      thumbCanvas.width = thumbW;
      thumbCanvas.height = thumbH;
      const tCtx = thumbCanvas.getContext('2d');
      if (!tCtx) return;

      const count = Math.min(Math.max(Math.ceil(duration / 2), 5), 60);
      const interval = duration / count;
      const stripCanvas = document.createElement('canvas');
      stripCanvas.width = thumbW * count;
      stripCanvas.height = thumbH;
      const stripCtx = stripCanvas.getContext('2d');
      if (!stripCtx) return;

      for (let i = 0; i < count; i++) {
        if (cancelled) return;
        const t = Math.min(duration, i * interval);
        video.currentTime = t;
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
        });
        tCtx.clearRect(0, 0, thumbW, thumbH);
        tCtx.drawImage(video, 0, 0, thumbW, thumbH);
        stripCtx.drawImage(thumbCanvas, i * thumbW, 0);
      }

      const stripImage = new Image();
      stripImage.src = stripCanvas.toDataURL('image/jpeg', 0.75);
      await new Promise<void>((resolve) => {
        stripImage.onload = () => resolve();
        stripImage.onerror = () => resolve();
      });

      if (!cancelled) {
        setThumbnailSprite(stripImage);
      }
    };

    setThumbnailSprite(null);
    loadSprite()
      .catch(() => generateFallback().catch(() => {}));

    return () => {
      cancelled = true;
    };
  }, [thumbnailSpriteUrl, videoUrl, duration]);

  // Escape key to cancel razor
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && razorMode) {
        setRazorMode(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [razorMode, setRazorMode]);

  // Load waveform data
  useEffect(() => {
    if (!waveformUrl) {
      const mock = Array.from({ length: 1000 }, () => Math.random() * 0.8 + 0.1);
      setWaveformData(mock);
      return;
    }
    fetch(waveformUrl)
      .then((r) => r.json())
      .then((data: number[]) => setWaveformData(data))
      .catch(() => {
        const mock = Array.from({ length: 1000 }, () => Math.random() * 0.8 + 0.1);
        setWaveformData(mock);
      });
  }, [waveformUrl]);

  // Track container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const totalWidth = useMemo(
    () => Math.max(containerWidth, containerWidth * zoomLevel),
    [containerWidth, zoomLevel]
  );

  // Build segment map for effective timeline when fills are shown
  interface TimelineSegment {
    type: 'keep' | 'fill';
    effectiveStart: number;
    effectiveEnd: number;
    sourceStart: number;
    sourceEnd: number;
    fillId?: string;
  }

  const { segments, effectiveDuration } = useMemo(() => {
    if (!showFills || aiFills.length === 0 || duration <= 0) {
      return {
        segments: [{ type: 'keep' as const, effectiveStart: 0, effectiveEnd: duration, sourceStart: 0, sourceEnd: duration }],
        effectiveDuration: duration,
      };
    }

    // Collect all active cuts sorted by start time
    const allActiveCuts = [
      ...cuts.filter((c) => activeCuts.has(c.id)).map((c) => ({ ...c, type: c.type })),
      ...manualCuts.filter((c) => activeManualCuts.has(c.id)).map((c) => ({ ...c, type: 'manual' })),
    ].sort((a, b) => a.start - b.start);

    if (allActiveCuts.length === 0) {
      return {
        segments: [{ type: 'keep' as const, effectiveStart: 0, effectiveEnd: duration, sourceStart: 0, sourceEnd: duration }],
        effectiveDuration: duration,
      };
    }

    const segs: TimelineSegment[] = [];
    let effectivePos = 0;
    let sourcePos = 0;

    for (const cut of allActiveCuts) {
      // Keep segment before this cut
      if (cut.start > sourcePos) {
        const keepLen = cut.start - sourcePos;
        segs.push({
          type: 'keep',
          effectiveStart: effectivePos,
          effectiveEnd: effectivePos + keepLen,
          sourceStart: sourcePos,
          sourceEnd: cut.start,
        });
        effectivePos += keepLen;
      }

      // Fill segment (or skip if no fill configured)
      const matchingFills = getFillsForCut(cut, aiFills);
      if (matchingFills.length > 0) {
        const fill = matchingFills[0];
        segs.push({
          type: 'fill',
          effectiveStart: effectivePos,
          effectiveEnd: effectivePos + fill.duration,
          sourceStart: cut.start,
          sourceEnd: cut.end,
          fillId: fill.id,
        });
        effectivePos += fill.duration;
      }
      // If no AI fill, the cut is simply removed (no segment added)

      sourcePos = cut.end;
    }

    // Keep segment after last cut
    if (sourcePos < duration) {
      const keepLen = duration - sourcePos;
      segs.push({
        type: 'keep',
        effectiveStart: effectivePos,
        effectiveEnd: effectivePos + keepLen,
        sourceStart: sourcePos,
        sourceEnd: duration,
      });
      effectivePos += keepLen;
    }

    return { segments: segs, effectiveDuration: effectivePos };
  }, [showFills, aiFills, duration, cuts, activeCuts, manualCuts, activeManualCuts]);

  // Use effective duration for timeline scaling when fills are shown
  const timelineDuration = showFills && aiFills.length > 0 ? effectiveDuration : duration;

  const timeToX = useCallback(
    (time: number) => (timelineDuration > 0 ? (time / timelineDuration) * totalWidth : 0),
    [timelineDuration, totalWidth]
  );

  const xToTime = useCallback(
    (x: number) => (totalWidth > 0 ? ((x + scrollLeft) / totalWidth) * timelineDuration : 0),
    [totalWidth, scrollLeft, timelineDuration]
  );

  const snapTime = useCallback(
    (time: number) => {
      let closest = time;
      let minDist = SNAP_THRESHOLD_S;
      const allBounds = [
        ...cuts.flatMap((c) => [c.start, c.end]),
        ...manualCuts.flatMap((c) => [c.start, c.end]),
      ];
      for (const b of allBounds) {
        const d = Math.abs(b - time);
        if (d < minDist) { minDist = d; closest = b; }
      }
      return closest;
    },
    [cuts, manualCuts]
  );

  // Draw
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerWidth) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const h = canvas.clientHeight;
    const w = canvas.clientWidth;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    // Layout: ruler (20px) | thumbnail track | 1px divider | waveform track
    const rulerH = 20;
    const dividerH = 1;
    const trackArea = h - rulerH - dividerH;
    const thumbH = Math.round(trackArea * 0.55);
    const waveH = trackArea - thumbH;
    const thumbY = rulerH;
    const waveY = thumbY + thumbH + dividerH;

    // Background
    ctx.fillStyle = 'hsl(230, 50%, 10%)';
    ctx.fillRect(0, 0, w, h);

    // --- Time ruler ---
    if (timelineDuration > 0) {
      ctx.fillStyle = 'hsl(230, 40%, 14%)';
      ctx.fillRect(0, 0, w, rulerH);
      const pixelsPerSecond = totalWidth / timelineDuration;
      let tickInterval = 1;
      if (pixelsPerSecond < 5) tickInterval = 30;
      else if (pixelsPerSecond < 15) tickInterval = 10;
      else if (pixelsPerSecond < 40) tickInterval = 5;
      ctx.fillStyle = 'hsl(230, 30%, 50%)';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      const startT = Math.floor((scrollLeft / totalWidth) * timelineDuration / tickInterval) * tickInterval;
      const endT = Math.ceil(((scrollLeft + w) / totalWidth) * timelineDuration / tickInterval) * tickInterval;
      for (let t = startT; t <= endT; t += tickInterval) {
        const x = timeToX(t) - scrollLeft;
        if (x < 0 || x > w) continue;
        ctx.fillRect(x, rulerH - 5, 1, 5);
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        ctx.fillText(`${m}:${s.toString().padStart(2, '0')}`, x, rulerH - 7);
      }
    }

    // --- Thumbnail filmstrip (segment-aware when fills shown) ---
    if (thumbnailSprite && duration > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, thumbY, w, thumbH);
      ctx.clip();

      const spriteNatW = thumbnailSprite.naturalWidth;
      const spriteNatH = thumbnailSprite.naturalHeight;
      const frameCount = Math.min(Math.max(Math.ceil(duration / 2), 5), 60);
      const singleFrameW = spriteNatW / frameCount;
      const secondsPerFrame = duration / frameCount;

      for (const seg of segments) {
        const segDrawStart = timeToX(seg.effectiveStart) - scrollLeft;
        const segDrawEnd = timeToX(seg.effectiveEnd) - scrollLeft;
        if (segDrawEnd < 0 || segDrawStart > w) continue;

        if (seg.type === 'fill') {
          // Draw teal placeholder for fill segments
          ctx.fillStyle = 'hsla(160, 70%, 20%, 0.8)';
          ctx.fillRect(segDrawStart, thumbY, segDrawEnd - segDrawStart, thumbH);
          ctx.strokeStyle = 'hsla(160, 70%, 45%, 0.7)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(segDrawStart, thumbY, segDrawEnd - segDrawStart, thumbH);
          const labelW = segDrawEnd - segDrawStart;
          if (labelW > 30) {
            ctx.fillStyle = 'hsla(160, 70%, 65%, 0.9)';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('AI Fill', segDrawStart + labelW / 2, thumbY + thumbH / 2 + 3);
          }
        } else {
          // Draw original video frames for keep segments
          const segPixelWidth = segDrawEnd - segDrawStart;
          const segSourceDur = seg.sourceEnd - seg.sourceStart;
          // Determine which sprite frames overlap this source range
          const firstFrame = Math.floor(seg.sourceStart / secondsPerFrame);
          const lastFrame = Math.min(frameCount - 1, Math.ceil(seg.sourceEnd / secondsPerFrame));

          for (let i = firstFrame; i <= lastFrame; i++) {
            const frameSrcStart = i * secondsPerFrame;
            const frameSrcEnd = (i + 1) * secondsPerFrame;
            // Clamp to segment source bounds
            const visStart = Math.max(frameSrcStart, seg.sourceStart);
            const visEnd = Math.min(frameSrcEnd, seg.sourceEnd);
            if (visEnd <= visStart) continue;

            // Position within the effective timeline
            const fracStart = (visStart - seg.sourceStart) / segSourceDur;
            const fracEnd = (visEnd - seg.sourceStart) / segSourceDur;
            const drawX = segDrawStart + fracStart * segPixelWidth;
            const drawW = (fracEnd - fracStart) * segPixelWidth;

            // Source crop from sprite
            const frameFracStart = (visStart - frameSrcStart) / secondsPerFrame;
            const frameFracEnd = (visEnd - frameSrcStart) / secondsPerFrame;
            const srcX = i * singleFrameW + frameFracStart * singleFrameW;
            const srcW = (frameFracEnd - frameFracStart) * singleFrameW;

            if (drawX + drawW < 0 || drawX > w) continue;
            ctx.drawImage(
              thumbnailSprite,
              srcX, 0, srcW, spriteNatH,
              drawX, thumbY, drawW, thumbH,
            );
          }
        }
      }
      ctx.restore();
    }

    // --- Divider ---
    ctx.fillStyle = 'hsl(230, 30%, 20%)';
    ctx.fillRect(0, thumbY + thumbH, w, dividerH);

    // --- Waveform (segment-aware) ---
    if (waveformData.length > 0 && duration > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, waveY, w, waveH);
      ctx.clip();

      const midY = waveY + waveH / 2;

      for (const seg of segments) {
        const segDrawStart = timeToX(seg.effectiveStart) - scrollLeft;
        const segDrawEnd = timeToX(seg.effectiveEnd) - scrollLeft;
        if (segDrawEnd < 0 || segDrawStart > w) continue;

        if (seg.type === 'fill') {
          // Draw flat low-amplitude fill waveform placeholder
          ctx.fillStyle = 'hsla(160, 60%, 45%, 0.3)';
          const fillBarH = waveH * 0.08;
          ctx.fillRect(segDrawStart, midY - fillBarH, segDrawEnd - segDrawStart, fillBarH * 2);
        } else {
          // Draw original waveform samples for keep segments
          const segPixelWidth = segDrawEnd - segDrawStart;
          const segSourceDur = seg.sourceEnd - seg.sourceStart;
          const pixelsPerSec = segPixelWidth / segSourceDur;
          const samplesPerSec = waveformData.length / duration;

          const srcStartSample = Math.floor(seg.sourceStart * samplesPerSec);
          const srcEndSample = Math.min(waveformData.length, Math.ceil(seg.sourceEnd * samplesPerSec));
          const srcSampleCount = srcEndSample - srcStartSample;
          if (srcSampleCount <= 0) continue;

          const barWidth = Math.max(1, segPixelWidth / srcSampleCount);

          for (let i = 0; i < srcSampleCount; i++) {
            const x = segDrawStart + (i / srcSampleCount) * segPixelWidth;
            if (x + barWidth < 0 || x > w) continue;
            const amplitude = waveformData[srcStartSample + i] || 0;
            const barH = amplitude * (waveH * 0.45);
            const alpha = 0.35 + amplitude * 0.65;
            ctx.fillStyle = `hsla(210, 60%, 55%, ${alpha})`;
            ctx.fillRect(x, midY - barH, barWidth, barH * 2);
          }
        }
      }
      ctx.restore();
    }

    // --- Cut overlays (span both tracks) ---
    const overlayY = thumbY;
    const overlayH = thumbH + dividerH + waveH;

    // --- Overlays: only show cut/fill overlays in original mode (fills hidden) ---
    // When fills are shown, the segment map already visualizes cuts removed + fills inserted.
    const showingEffective = showFills && aiFills.length > 0;

    if (!showingEffective) {
      for (const cut of cuts) {
        const isActive = activeCuts.has(cut.id);
        const isHovered = hoveredCut === cut.id;
        if (!isActive && !isHovered) continue;
        const x1 = timeToX(cut.start) - scrollLeft;
        const x2 = timeToX(cut.end) - scrollLeft;
        if (x2 < 0 || x1 > w) continue;
        ctx.fillStyle = isActive
          ? isHovered ? 'hsla(252, 75%, 65%, 0.45)' : 'hsla(252, 75%, 65%, 0.3)'
          : 'hsla(220, 13%, 36%, 0.15)';
        ctx.fillRect(x1, overlayY, x2 - x1, overlayH);
        ctx.strokeStyle = isActive ? 'hsla(252, 75%, 65%, 0.6)' : 'hsla(220, 13%, 36%, 0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x1, overlayY, x2 - x1, overlayH);
      }

      for (const cut of manualCuts) {
        const isActive = activeManualCuts.has(cut.id);
        if (!isActive) continue;
        const x1 = timeToX(cut.start) - scrollLeft;
        const x2 = timeToX(cut.end) - scrollLeft;
        if (x2 < 0 || x1 > w) continue;
        ctx.fillStyle = 'hsla(270, 70%, 60%, 0.35)';
        ctx.fillRect(x1, overlayY, x2 - x1, overlayH);
        ctx.strokeStyle = 'hsla(270, 70%, 60%, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x1, overlayY, x2 - x1, overlayH);
      }
    }

    // Razor
    if (razorMode && razorStart !== null) {
      const sx = timeToX(razorStart) - scrollLeft;
      ctx.strokeStyle = 'hsla(270, 90%, 70%, 0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(sx, overlayY);
      ctx.lineTo(sx, overlayY + overlayH);
      ctx.stroke();
      ctx.setLineDash([]);

      if (razorPreview !== null) {
        const px = timeToX(razorPreview) - scrollLeft;
        const left = Math.min(sx, px);
        const right = Math.max(sx, px);
        ctx.fillStyle = 'hsla(270, 70%, 60%, 0.2)';
        ctx.fillRect(left, overlayY, right - left, overlayH);
      }
    }

    // --- Inserted fill indicators (solid green bottom bar, original mode only) ---
    if (!showingEffective && aiFills.length > 0) {
      for (const fill of aiFills) {
        if (!insertedFills.has(fill.id)) continue;
        const fx1 = timeToX(fill.startTime) - scrollLeft;
        const fx2 = timeToX(fill.startTime + fill.duration) - scrollLeft;
        if (fx2 < 0 || fx1 > w) continue;
        // Semi-transparent teal overlay covering full track height
        ctx.fillStyle = 'hsla(160, 70%, 30%, 0.2)';
        ctx.fillRect(fx1, overlayY, fx2 - fx1, overlayH);
        // Border
        ctx.strokeStyle = 'hsla(160, 70%, 45%, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(fx1, overlayY, fx2 - fx1, overlayH);
        // Bottom accent bar
        ctx.fillStyle = 'hsla(160, 70%, 45%, 0.9)';
        ctx.fillRect(fx1, overlayY + overlayH - 4, fx2 - fx1, 4);
        // Label
        const fillW = fx2 - fx1;
        if (fillW > 40) {
          ctx.fillStyle = 'hsla(160, 70%, 65%, 0.85)';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('AI Fill', fx1 + fillW / 2, overlayY + overlayH / 2 + 3);
        }
      }
    }

    // --- Playhead (full height) ---
    const playX = timeToX(playheadPosition) - scrollLeft;
    if (playX >= 0 && playX <= w) {
      ctx.fillStyle = 'hsl(0, 84%, 60%)';
      ctx.fillRect(playX - 1, 0, 2, h);
      ctx.beginPath();
      ctx.moveTo(playX - 5, 0);
      ctx.lineTo(playX + 5, 0);
      ctx.lineTo(playX, 8);
      ctx.closePath();
      ctx.fill();
    }
  }, [
    thumbnailSprite, waveformData, containerWidth, totalWidth, scrollLeft, duration,
    cuts, activeCuts, manualCuts, activeManualCuts,
    hoveredCut, playheadPosition, timeToX,
    razorMode, razorStart, razorPreview,
    aiFills, showFills,
    insertedFills,
    segments, timelineDuration,
  ]);

  // Draw on demand when deps change (covers paused/idle state).
  useEffect(() => {
    draw();
  }, [draw]);

  // RAF loop only while playing — keeps playhead smooth without
  // starving video decode when paused.
  useEffect(() => {
    if (!isPlaying) return;
    const loop = () => {
      draw();
      animFrameRef.current = requestAnimationFrame(loop);
    };
    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying, draw]);

  // Auto-scroll playhead
  useEffect(() => {
    if (!isPlaying || !containerWidth) return;
    const playX = timeToX(playheadPosition);
    const viewEnd = scrollLeft + containerWidth;
    if (playX > viewEnd - 50) setScrollLeft(Math.min(playX - 50, totalWidth - containerWidth));
    else if (playX < scrollLeft + 50) setScrollLeft(Math.max(0, playX - 50));
  }, [playheadPosition, isPlaying, containerWidth, totalWidth, scrollLeft, timeToX]);

  const getCutAtX = useCallback(
    (clientX: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const time = xToTime(clientX - rect.left);
      for (const cut of cuts) {
        if (time >= cut.start && time <= cut.end) return cut;
      }
      return null;
    },
    [cuts, xToTime]
  );

  const getFillAtX = useCallback(
    (clientX: number) => {
      if (!showFills || aiFills.length === 0) return null;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const time = xToTime(clientX - rect.left);
      for (const fill of aiFills) {
        if (time >= fill.startTime && time <= fill.startTime + fill.duration) return fill;
      }
      return null;
    },
    [aiFills, showFills, xToTime]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (razorMode) return; // handled by click
      isDraggingRef.current = true;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const time = snapTime(xToTime(e.clientX - rect.left));
      setPlayhead(Math.max(0, Math.min(duration, time)));
    },
    [razorMode, xToTime, snapTime, setPlayhead, duration]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const time = snapTime(xToTime(e.clientX - rect.left));

      if (razorMode) {
        setRazorPreview(time);
      } else {
        const cut = getCutAtX(e.clientX);
        setHoveredCut(cut?.id ?? null);
        if (isDraggingRef.current) {
          setPlayhead(Math.max(0, Math.min(duration, time)));
        }
      }
    },
    [razorMode, getCutAtX, xToTime, snapTime, setPlayhead, duration]
  );

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const time = snapTime(xToTime(e.clientX - rect.left));

      if (razorMode) {
        if (razorStart === null) {
          setRazorStart(time);
        } else {
          addManualCut(razorStart, time);
          setRazorStart(null);
          setRazorPreview(null);
        }
        return;
      }

      // Check if clicking on an AI fill region (only in original mode, not effective/collapsed)
      const isEffectiveMode = showFills && aiFills.length > 0;
      if (!isEffectiveMode) {
        const fill = getFillAtX(e.clientX);
        if (fill) {
          selectFill(fill);
          return;
        }
      }

      const cut = getCutAtX(e.clientX);
      if (cut) toggleCut(cut.id);
    },
    [razorMode, razorStart, setRazorStart, addManualCut, getCutAtX, getFillAtX, selectFill, toggleCut, xToTime, snapTime]
  );

  // Attach wheel handler as non-passive so preventDefault works for Ctrl+Scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom(zoomLevel + (e.deltaY > 0 ? -0.5 : 0.5));
      } else {
        setScrollLeft(Math.max(0, Math.min(totalWidth - containerWidth, scrollLeft + e.deltaX + e.deltaY)));
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [zoomLevel, setZoom, scrollLeft, totalWidth, containerWidth]);

  // Scrollbar
  const scrollbarWidth = useMemo(
    () => (totalWidth > containerWidth ? (containerWidth / totalWidth) * containerWidth : 0),
    [totalWidth, containerWidth]
  );
  const scrollbarLeft = useMemo(
    () => (totalWidth > containerWidth ? (scrollLeft / totalWidth) * containerWidth : 0),
    [totalWidth, containerWidth, scrollLeft]
  );

  const handleScrollbarDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startScroll = scrollLeft;
      const onMove = (ev: MouseEvent) => {
        const ratio = totalWidth / containerWidth;
        setScrollLeft(Math.max(0, Math.min(totalWidth - containerWidth, startScroll + (ev.clientX - startX) * ratio)));
      };
      const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [scrollLeft, totalWidth, containerWidth]
  );

  const hoveredCutData = useMemo(() => cuts.find((c) => c.id === hoveredCut), [cuts, hoveredCut]);

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-card border-t border-border">
        {/* Controls bar */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={razorMode ? 'default' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={() => setRazorMode(!razorMode)}
              >
                <Scissors className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {razorMode ? 'Razor active (Esc to cancel)' : 'Razor tool — click twice to cut'}
            </TooltipContent>
          </Tooltip>

          <div className="w-px h-4 bg-border" />

          {aiFills.length > 0 && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={showFills ? 'default' : 'ghost'}
                    size="icon"
                    className="h-7 w-7"
                    onClick={toggleShowFills}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {showFills ? 'Showing expected output — click to show original' : 'Showing original — click to preview expected output'}
                </TooltipContent>
              </Tooltip>
              <div className="w-px h-4 bg-border" />
            </>
          )}

          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(zoomLevel - 1)} disabled={zoomLevel <= 1}>
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground font-mono min-w-[3rem] text-center">{zoomLevel.toFixed(1)}x</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(zoomLevel + 1)} disabled={zoomLevel >= 10}>
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>

          <div className="flex-1" />

          {razorMode && razorStart !== null && (
            <span className="text-xs text-violet-400 animate-pulse">Click to set end point</span>
          )}
          {razorMode && razorStart === null && (
            <span className="text-xs text-violet-400">Click to set start point</span>
          )}
          {!razorMode && (
            <span className="text-xs text-muted-foreground">Ctrl+Scroll to zoom · Scroll to pan</span>
          )}
        </div>

        {/* Canvas */}
        <div
          ref={containerRef}
          className={`relative flex-1 select-none overflow-hidden ${razorMode ? 'cursor-crosshair' : 'cursor-pointer'}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { handleMouseUp(); setRazorPreview(null); }}
          onClick={handleClick}
        >
          <canvas ref={canvasRef} className="h-full w-full" />

          {hoveredCutData && !razorMode && (
            <Tooltip open>
              <TooltipTrigger asChild>
                <div
                  className="absolute top-0 pointer-events-none"
                  style={{ left: timeToX(hoveredCutData.start + hoveredCutData.duration / 2) - scrollLeft }}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <span className="capitalize">{hoveredCutData.type}</span> · {hoveredCutData.duration.toFixed(1)}s
                <br />
                <span className="text-muted-foreground">Click to toggle</span>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Scrollbar */}
        {scrollbarWidth > 0 && scrollbarWidth < containerWidth && (
          <div className="h-2.5 bg-background border-t border-border">
            <div
              className="h-full rounded-full bg-muted hover:bg-muted-foreground/30 cursor-grab active:cursor-grabbing transition-colors"
              style={{ width: scrollbarWidth, marginLeft: scrollbarLeft }}
              onMouseDown={handleScrollbarDrag}
            />
          </div>
        )}
      </div>
    </TooltipProvider>
  );
};

export default WaveformTimeline;
