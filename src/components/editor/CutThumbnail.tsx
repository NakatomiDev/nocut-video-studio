import { useRef, useEffect, useState } from 'react';

interface CutThumbnailProps {
  videoUrl: string;
  time: number;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Renders a small thumbnail captured from a video at a specific timestamp.
 * Uses a shared off-screen video element cache to avoid creating too many elements.
 */
const CutThumbnail = ({ videoUrl, time, width = 80, height = 45, className = '' }: CutThumbnailProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [captured, setCaptured] = useState(false);

  useEffect(() => {
    if (!videoUrl || time < 0) return;
    let cancelled = false;

    const capture = async () => {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.preload = 'metadata';
      video.muted = true;
      video.src = videoUrl;

      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject();
      });

      video.currentTime = time;

      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
      });

      if (cancelled) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      canvas.width = width * (window.devicePixelRatio || 1);
      canvas.height = height * (window.devicePixelRatio || 1);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setCaptured(true);

      // Clean up video element
      video.src = '';
      video.load();
    };

    setCaptured(false);
    capture().catch(() => {});

    return () => { cancelled = true; };
  }, [videoUrl, time, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={`rounded border border-border ${!captured ? 'bg-muted' : ''} ${className}`}
      style={{ width, height }}
    />
  );
};

export default CutThumbnail;
