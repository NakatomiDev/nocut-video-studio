import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const SNAP_THRESHOLD_S = 0.1; // 100ms snap range

interface WaveformTimelineProps {
  waveformUrl: string | null;
  duration: number;
}

const WaveformTimeline = ({ waveformUrl, duration }: WaveformTimelineProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const isDraggingRef = useRef(false);

  const {
    cuts,
    activeCuts,
    toggleCut,
    playheadPosition,
    setPlayhead,
    zoomLevel,
    setZoom,
    isPlaying,
  } = useEditorStore();

  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [hoveredCut, setHoveredCut] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Load waveform data
  useEffect(() => {
    if (!waveformUrl) {
      // Generate mock waveform if no URL
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

  // Snap to nearest cut boundary
  const snapTime = useCallback(
    (time: number) => {
      let closest = time;
      let minDist = SNAP_THRESHOLD_S;
      for (const cut of cuts) {
        const ds = Math.abs(cut.start - time);
        const de = Math.abs(cut.end - time);
        if (ds < minDist) { minDist = ds; closest = cut.start; }
        if (de < minDist) { minDist = de; closest = cut.end; }
      }
      return closest;
    },
    [cuts]
  );

  // Draw waveform
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

    // Background
    ctx.fillStyle = 'hsl(230, 50%, 10%)';
    ctx.fillRect(0, 0, w, h);

    const centerY = h / 2;
    const maxBarH = h * 0.42;

    // Draw waveform bars
    if (waveformData.length > 0 && duration > 0) {
      const samplesPerPixel = waveformData.length / totalWidth;
      const startSample = Math.floor(scrollLeft * samplesPerPixel);
      const endSample = Math.min(
        Math.ceil((scrollLeft + w) * samplesPerPixel),
        waveformData.length
      );

      const barWidth = Math.max(1, totalWidth / waveformData.length - 0.5);

      ctx.fillStyle = 'hsl(220, 13%, 36%)'; // ~#4B5563

      for (let i = startSample; i < endSample; i++) {
        const x = (i / waveformData.length) * totalWidth - scrollLeft;
        const amp = waveformData[i] * maxBarH;
        ctx.fillRect(x, centerY - amp, barWidth, amp * 2);
      }
    }

    // Draw silence overlays for active cuts
    for (const cut of cuts) {
      const isActive = activeCuts.has(cut.id);
      const isHovered = hoveredCut === cut.id;

      if (!isActive && !isHovered) continue;

      const x1 = timeToX(cut.start) - scrollLeft;
      const x2 = timeToX(cut.end) - scrollLeft;

      if (x2 < 0 || x1 > w) continue;

      if (isActive) {
        ctx.fillStyle = isHovered
          ? 'hsla(252, 75%, 65%, 0.45)'
          : 'hsla(252, 75%, 65%, 0.3)';
      } else {
        ctx.fillStyle = 'hsla(220, 13%, 36%, 0.15)';
      }

      ctx.fillRect(x1, 0, x2 - x1, h);

      // Border
      ctx.strokeStyle = isActive
        ? 'hsla(252, 75%, 65%, 0.6)'
        : 'hsla(220, 13%, 36%, 0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x1, 0, x2 - x1, h);
    }

    // Draw time markers
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

      // Triangle top
      ctx.beginPath();
      ctx.moveTo(playX - 5, 0);
      ctx.lineTo(playX + 5, 0);
      ctx.lineTo(playX, 8);
      ctx.closePath();
      ctx.fill();
    }
  }, [
    waveformData,
    containerWidth,
    totalWidth,
    scrollLeft,
    duration,
    cuts,
    activeCuts,
    hoveredCut,
    playheadPosition,
    timeToX,
  ]);

  // RAF loop for playhead animation
  useEffect(() => {
    const loop = () => {
      draw();
      animFrameRef.current = requestAnimationFrame(loop);
    };
    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [draw]);

  // Auto-scroll to follow playhead during playback
  useEffect(() => {
    if (!isPlaying || !containerWidth) return;
    const playX = timeToX(playheadPosition);
    const viewEnd = scrollLeft + containerWidth;
    if (playX > viewEnd - 50) {
      setScrollLeft(Math.min(playX - 50, totalWidth - containerWidth));
    } else if (playX < scrollLeft + 50) {
      setScrollLeft(Math.max(0, playX - 50));
    }
  }, [playheadPosition, isPlaying, containerWidth, totalWidth, scrollLeft, timeToX]);

  // Mouse handlers
  const getCutAtX = useCallback(
    (clientX: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const x = clientX - rect.left;
      const time = xToTime(x);

      for (const cut of cuts) {
        if (time >= cut.start && time <= cut.end) return cut;
      }
      return null;
    },
    [cuts, xToTime]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDraggingRef.current = true;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const time = snapTime(xToTime(x));
      setPlayhead(Math.max(0, Math.min(duration, time)));
    },
    [xToTime, snapTime, setPlayhead, duration]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const cut = getCutAtX(e.clientX);
      setHoveredCut(cut?.id ?? null);

      if (isDraggingRef.current) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        const time = snapTime(xToTime(x));
        setPlayhead(Math.max(0, Math.min(duration, time)));
      }
    },
    [getCutAtX, xToTime, snapTime, setPlayhead, duration]
  );

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const cut = getCutAtX(e.clientX);
      if (cut) toggleCut(cut.id);
    },
    [getCutAtX, toggleCut]
  );

  // Zoom with mouse wheel
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.5 : 0.5;
        setZoom(zoomLevel + delta);
      } else {
        const newScroll = scrollLeft + e.deltaX + e.deltaY;
        setScrollLeft(Math.max(0, Math.min(totalWidth - containerWidth, newScroll)));
      }
    },
    [zoomLevel, setZoom, scrollLeft, totalWidth, containerWidth]
  );

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
        const dx = ev.clientX - startX;
        const ratio = totalWidth / containerWidth;
        setScrollLeft(
          Math.max(0, Math.min(totalWidth - containerWidth, startScroll + dx * ratio))
        );
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [scrollLeft, totalWidth, containerWidth]
  );

  const hoveredCutData = useMemo(
    () => cuts.find((c) => c.id === hoveredCut),
    [cuts, hoveredCut]
  );

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-card border-t border-border">
        {/* Controls bar */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setZoom(zoomLevel - 1)}
            disabled={zoomLevel <= 1}
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground font-mono min-w-[3rem] text-center">
            {zoomLevel.toFixed(1)}x
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setZoom(zoomLevel + 1)}
            disabled={zoomLevel >= 10}
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground">
            Ctrl+Scroll to zoom · Scroll to pan
          </span>
        </div>

        {/* Canvas */}
        <div
          ref={containerRef}
          className="relative flex-1 cursor-crosshair select-none overflow-hidden"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleClick}
          onWheel={handleWheel}
        >
          <canvas ref={canvasRef} className="h-full w-full" />

          {/* Cut hover tooltip */}
          {hoveredCutData && (
            <Tooltip open>
              <TooltipTrigger asChild>
                <div
                  className="absolute top-0 pointer-events-none"
                  style={{
                    left: timeToX(hoveredCutData.start + hoveredCutData.duration / 2) - scrollLeft,
                  }}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <span className="capitalize">{hoveredCutData.type}</span>{' '}
                · {hoveredCutData.duration.toFixed(1)}s
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
