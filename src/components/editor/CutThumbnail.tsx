import { useRef, useEffect, useState } from 'react';

interface CutThumbnailProps {
  videoUrl: string;
  time: number;
  width?: number;
  height?: number;
  className?: string;
}

const CutThumbnail = ({ videoUrl, time, width = 80, height = 45, className = '' }: CutThumbnailProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [captured, setCaptured] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!videoUrl || time < 0) return;
    let cancelled = false;

    const capture = async () => {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      video.src = videoUrl;

      // Wait for enough data to seek
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('load timeout')), 10000);
        video.oncanplay = () => { clearTimeout(timeout); resolve(); };
        video.onerror = () => { clearTimeout(timeout); reject(new Error('video load error')); };
        video.load();
      });

      if (cancelled) return;

      // Seek to the target time
      video.currentTime = Math.max(0, time);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('seek timeout')), 5000);
        video.onseeked = () => { clearTimeout(timeout); resolve(); };
        video.onerror = () => { clearTimeout(timeout); reject(new Error('seek error')); };
      });

      if (cancelled) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setCaptured(true);

      // Cleanup
      video.src = '';
      video.load();
    };

    setCaptured(false);
    setError(false);
    capture().catch((err) => {
      console.warn('CutThumbnail capture failed:', err?.message, 'time:', time);
      if (!cancelled) setError(true);
    });

    return () => { cancelled = true; };
  }, [videoUrl, time, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className={`rounded border border-border ${!captured ? 'bg-muted' : ''} ${className}`}
      style={{ width, height, display: 'block' }}
    />
  );
};

export default CutThumbnail;
