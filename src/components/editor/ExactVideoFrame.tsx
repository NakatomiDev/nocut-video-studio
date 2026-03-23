import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface ExactVideoFrameProps {
  videoUrl?: string | null;
  time: number;
  label: string;
  className?: string;
  videoClassName?: string;
  /** Pre-extracted frame data URL — if provided, skip video seeking entirely */
  cachedFrame?: string;
}

const FRAME_EPSILON = 0.04;

const ExactVideoFrame = ({
  videoUrl,
  time,
  label,
  className,
  videoClassName,
  cachedFrame,
}: ExactVideoFrameProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(!!cachedFrame);
  const [failed, setFailed] = useState(false);

  // If we have a cached frame, render it directly as an image
  if (cachedFrame) {
    return (
      <div className={cn('relative overflow-hidden rounded border border-border bg-muted/40', className)}>
        <img
          src={cachedFrame}
          alt={label}
          className={cn('h-full w-full object-contain', videoClassName)}
        />
      </div>
    );
  }

  const normalizedTime = useMemo(() => Math.max(0, time), [time]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) {
      setReady(false);
      setFailed(true);
      return;
    }

    let cancelled = false;
    setReady(false);
    setFailed(false);

    const seekToFrame = () => {
      if (cancelled) return;

      const duration = Number.isFinite(video.duration) ? video.duration : normalizedTime;
      const maxTime = Math.max(0, duration - FRAME_EPSILON);
      const targetTime = Math.min(normalizedTime, maxTime);

      if (Math.abs(video.currentTime - targetTime) <= FRAME_EPSILON) {
        video.pause();
        setReady(true);
        return;
      }

      try {
        video.currentTime = targetTime;
      } catch {
        setFailed(true);
      }
    };

    const handleLoadedMetadata = () => seekToFrame();
    const handleSeeked = () => {
      if (cancelled) return;
      video.pause();
      setReady(true);
    };
    const handleError = () => {
      if (cancelled) return;
      setReady(false);
      setFailed(true);
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('error', handleError);

    if (video.src !== videoUrl) {
      video.src = videoUrl;
      video.load();
    } else if (video.readyState >= 1) {
      seekToFrame();
    }

    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
    };
  }, [normalizedTime, videoUrl]);

  return (
    <div className={cn('relative overflow-hidden rounded border border-border bg-muted/40', className)}>
      <video
        ref={videoRef}
        aria-label={label}
        className={cn(
          'h-full w-full object-contain transition-opacity duration-200',
          ready ? 'opacity-100' : 'opacity-0',
          videoClassName,
        )}
        muted
        playsInline
        preload="metadata"
        disablePictureInPicture
        controlsList="nodownload noplaybackrate nofullscreen noremoteplayback"
      />

      {!ready && !failed && (
        <div className="absolute inset-0 animate-pulse bg-muted/70" aria-hidden="true" />
      )}

      {failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/80 px-3 text-center text-[11px] text-muted-foreground">
          Exact frame preview unavailable
        </div>
      )}
    </div>
  );
};

export default ExactVideoFrame;