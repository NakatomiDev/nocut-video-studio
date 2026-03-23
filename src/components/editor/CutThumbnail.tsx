import { useEffect, useRef, useState } from 'react';

interface CutThumbnailProps {
  spriteUrl?: string | null;
  time: number;
  duration: number;
  width?: number;
  height?: number;
  className?: string;
}

const CutThumbnail = ({
  spriteUrl,
  time,
  duration,
  width = 80,
  height = 45,
  className = '',
}: CutThumbnailProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !spriteUrl || duration <= 0) {
      setReady(false);
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';

    image.onload = () => {
      if (cancelled) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setReady(false);
        return;
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      // The sprite is a horizontal strip of equally-spaced frames.
      // Frame count matches the generation logic: ceil(duration/2) clamped to [5, 60].
      const totalFrames = Math.min(Math.max(Math.ceil(duration / 2), 5), 60);
      const frameWidth = image.naturalWidth / totalFrames;
      const frameHeight = image.naturalHeight;

      // Find the frame index closest to the requested time
      const ratio = Math.max(0, Math.min(1, time / duration));
      const frameIndex = Math.min(totalFrames - 1, Math.round(ratio * (totalFrames - 1)));
      const sourceX = frameIndex * frameWidth;

      ctx.drawImage(image, sourceX, 0, frameWidth, frameHeight, 0, 0, width, height);
      setReady(true);
    };

    image.onerror = () => {
      if (!cancelled) setReady(false);
    };

    setReady(false);
    image.src = spriteUrl;

    return () => {
      cancelled = true;
    };
  }, [spriteUrl, time, duration, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className={`rounded border border-border ${ready ? '' : 'bg-muted'} ${className}`}
      style={{ width, height, display: 'block' }}
    />
  );
};

export default CutThumbnail;
