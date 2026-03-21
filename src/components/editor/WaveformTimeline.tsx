import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { ZoomIn, ZoomOut, Scissors } from 'lucide-react';
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
  duration: number;
}

const WaveformTimeline = ({ waveformUrl, videoUrl, duration }: WaveformTimelineProps) => {
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
  } = useEditorStore();

  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [hoveredCut, setHoveredCut] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [razorPreview, setRazorPreview] = useState<number | null>(null);
  const [thumbnails, setThumbnails] = useState<{ time: number; img: HTMLImageElement }[]>([]);

  // Generate video thumbnails
  useEffect(() => {
    if (!videoUrl || !duration) return;
    let cancelled = false;
    const generate = async () => {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.preload = 'auto';
      video.muted = true;
      video.src = videoUrl;
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject();
      });

      const thumbCanvas = document.createElement('canvas');
      const thumbH = 60;
      const thumbW = Math.round((video.videoWidth / video.videoHeight) * thumbH) || 80;
      thumbCanvas.width = thumbW;
      thumbCanvas.height = thumbH;
      const tCtx = thumbCanvas.getContext('2d');
      if (!tCtx) return;

      const count = Math.min(Math.max(Math.ceil(duration / 2), 5), 60);
      const interval = duration / count;
      const results: { time: number; img: HTMLImageElement }[] = [];

      for (let i = 0; i < count; i++) {
        if (cancelled) return;
        const t = i * interval;
        video.currentTime = t;
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
        });
        tCtx.drawImage(video, 0, 0, thumbW, thumbH);
        const img = new Image();
        img.src = thumbCanvas.toDataURL('image/jpeg', 0.6);
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
        });
        results.push({ time: t, img });
      }
      if (!cancelled) setThumbnails(results);
    };
    generate().catch(() => {});
    return () => { cancelled = true; };
  }, [videoUrl, duration]);

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

  const timeToX = useCallback(
    (time: number) => (duration > 0 ? (time / duration) * totalWidth : 0),
    [duration, totalWidth]
  );

  const xToTime = useCallback(
    (x: number) => (totalWidth > 0 ? ((x + scrollLeft) / totalWidth) * duration : 0),
    [totalWidth, scrollLeft, duration]
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

    ctx.fillStyle = 'hsl(230, 50%, 10%)';
    ctx.fillRect(0, 0, w, h);

    // Video thumbnails
    if (thumbnails.length > 0 && duration > 0) {
      const thumbW = thumbnails[0].img.width;
      const thumbH = thumbnails[0].img.height;
      const scale = h / thumbH;
      const drawW = thumbW * scale;
      for (const thumb of thumbnails) {
        const x = timeToX(thumb.time) - scrollLeft;
        if (x + drawW < 0 || x > w) continue;
        ctx.globalAlpha = 0.35;
        ctx.drawImage(thumb.img, x, 0, drawW, h);
      }
      ctx.globalAlpha = 1;
    }

    const centerY = h / 2;
    const maxBarH = h * 0.42;

    // Waveform bars
    if (waveformData.length > 0 && duration > 0) {
      const samplesPerPixel = waveformData.length / totalWidth;
      const startSample = Math.floor(scrollLeft * samplesPerPixel);
      const endSample = Math.min(Math.ceil((scrollLeft + w) * samplesPerPixel), waveformData.length);
      const barWidth = Math.max(1, totalWidth / waveformData.length - 0.5);
      ctx.fillStyle = 'hsl(220, 13%, 36%)';
      for (let i = startSample; i < endSample; i++) {
        const x = (i / waveformData.length) * totalWidth - scrollLeft;
        const amp = waveformData[i] * maxBarH;
        ctx.fillRect(x, centerY - amp, barWidth, amp * 2);
      }
    }

    // Auto-detected cut overlays
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
      ctx.fillRect(x1, 0, x2 - x1, h);
      ctx.strokeStyle = isActive ? 'hsla(252, 75%, 65%, 0.6)' : 'hsla(220, 13%, 36%, 0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x1, 0, x2 - x1, h);
    }

    // Manual cut overlays (purple/violet)
    for (const cut of manualCuts) {
      const isActive = activeManualCuts.has(cut.id);
      if (!isActive) continue;
      const x1 = timeToX(cut.start) - scrollLeft;
      const x2 = timeToX(cut.end) - scrollLeft;
      if (x2 < 0 || x1 > w) continue;
      ctx.fillStyle = 'hsla(270, 70%, 60%, 0.35)';
      ctx.fillRect(x1, 0, x2 - x1, h);
      ctx.strokeStyle = 'hsla(270, 70%, 60%, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x1, 0, x2 - x1, h);
    }

    // Razor start line + preview region
    if (razorMode && razorStart !== null) {
      const sx = timeToX(razorStart) - scrollLeft;
      ctx.strokeStyle = 'hsla(270, 90%, 70%, 0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
      ctx.stroke();
      ctx.setLineDash([]);

      if (razorPreview !== null) {
        const px = timeToX(razorPreview) - scrollLeft;
        const left = Math.min(sx, px);
        const right = Math.max(sx, px);
        ctx.fillStyle = 'hsla(270, 70%, 60%, 0.2)';
        ctx.fillRect(left, 0, right - left, h);
      }
    }

    // Time markers
    const pixelsPerSecond = totalWidth / duration;
    let tickInterval = 1;
    if (pixelsPerSecond < 5) tickInterval = 30;
    else if (pixelsPerSecond < 15) tickInterval = 10;
    else if (pixelsPerSecond < 40) tickInterval = 5;
    ctx.fillStyle = 'hsl(230, 30%, 40%)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    const startT = Math.floor((scrollLeft / totalWidth) * duration / tickInterval) * tickInterval;
    const endT = Math.ceil(((scrollLeft + w) / totalWidth) * duration / tickInterval) * tickInterval;
    for (let t = startT; t <= endT; t += tickInterval) {
      const x = timeToX(t) - scrollLeft;
      if (x < 0 || x > w) continue;
      ctx.fillRect(x, 0, 1, 8);
      const m = Math.floor(t / 60);
      const s = Math.floor(t % 60);
      ctx.fillText(`${m}:${s.toString().padStart(2, '0')}`, x, 18);
    }

    // Playhead
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
    waveformData, thumbnails, containerWidth, totalWidth, scrollLeft, duration,
    cuts, activeCuts, manualCuts, activeManualCuts,
    hoveredCut, playheadPosition, timeToX,
    razorMode, razorStart, razorPreview,
  ]);

  // RAF loop
  useEffect(() => {
    const loop = () => {
      draw();
      animFrameRef.current = requestAnimationFrame(loop);
    };
    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [draw]);

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

      const cut = getCutAtX(e.clientX);
      if (cut) toggleCut(cut.id);
    },
    [razorMode, razorStart, setRazorStart, addManualCut, getCutAtX, toggleCut, xToTime, snapTime]
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
