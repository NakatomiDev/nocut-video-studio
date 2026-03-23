import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Pre-extracts video frames at specified timestamps into data-URL images.
 * Prioritises `priorityTimes` (active cuts) then processes the rest.
 * Returns a Map<number, string> keyed by rounded time (1 decimal).
 */
export function useFrameCache(
  videoUrl: string | null | undefined,
  allTimes: number[],
  priorityTimes: number[],
) {
  const [cache, setCache] = useState<Map<number, string>>(new Map());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const abortRef = useRef(false);
  const prevUrlRef = useRef<string | null>(null);

  // Round to 1 decimal for stable keys
  const roundTime = (t: number) => Math.round(t * 10) / 10;

  const extractFrame = useCallback(
    (video: HTMLVideoElement, time: number): Promise<string | null> => {
      return new Promise((resolve) => {
        if (abortRef.current) { resolve(null); return; }

        const target = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.04));

        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          video.removeEventListener('error', onError);
          try {
            const canvas = document.createElement('canvas');
            // Use a reasonable size — sharp enough for lightbox too
            const scale = Math.min(1, 640 / (video.videoWidth || 640));
            canvas.width = Math.round((video.videoWidth || 640) * scale);
            canvas.height = Math.round((video.videoHeight || 360) * scale);
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              resolve(canvas.toDataURL('image/jpeg', 0.85));
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        };
        const onError = () => {
          video.removeEventListener('seeked', onSeeked);
          video.removeEventListener('error', onError);
          resolve(null);
        };

        video.addEventListener('seeked', onSeeked, { once: true });
        video.addEventListener('error', onError, { once: true });

        try {
          video.currentTime = target;
        } catch {
          resolve(null);
        }
      });
    },
    [],
  );

  useEffect(() => {
    if (!videoUrl) return;
    // If URL changed, reset
    if (prevUrlRef.current !== videoUrl) {
      setCache(new Map());
      prevUrlRef.current = videoUrl;
    }

    abortRef.current = false;

    // Dedupe & order: priority first, then remaining
    const prioritySet = new Set(priorityTimes.map(roundTime));
    const allSet = new Set(allTimes.map(roundTime));
    const ordered = [
      ...Array.from(prioritySet),
      ...Array.from(allSet).filter((t) => !prioritySet.has(t)),
    ];

    if (ordered.length === 0) return;

    // Create a dedicated video element for extraction
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    videoRef.current = video;

    const run = async () => {
      // Wait for metadata
      await new Promise<void>((resolve, reject) => {
        if (video.readyState >= 1) { resolve(); return; }
        const onMeta = () => { video.removeEventListener('loadedmetadata', onMeta); resolve(); };
        const onErr = () => { video.removeEventListener('error', onErr); reject(); };
        video.addEventListener('loadedmetadata', onMeta, { once: true });
        video.addEventListener('error', onErr, { once: true });
        video.src = videoUrl;
        video.load();
      });

      for (const time of ordered) {
        if (abortRef.current) break;
        // Skip if already cached
        if (cache.has(time)) continue;

        const dataUrl = await extractFrame(video, time);
        if (dataUrl && !abortRef.current) {
          setCache((prev) => {
            const next = new Map(prev);
            next.set(time, dataUrl);
            return next;
          });
        }
        // Small yield to keep UI responsive
        await new Promise((r) => setTimeout(r, 30));
      }
    };

    run().catch(() => {});

    return () => {
      abortRef.current = true;
      if (videoRef.current) {
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
        videoRef.current = null;
      }
    };
    // Re-run when times change (stringified for stable dep)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, JSON.stringify(allTimes.map(roundTime).sort()), JSON.stringify(priorityTimes.map(roundTime).sort())]);

  /** Get a cached frame data URL for a timestamp, or undefined if not yet extracted */
  const getFrame = useCallback(
    (time: number): string | undefined => cache.get(roundTime(time)),
    [cache],
  );

  return { getFrame, cacheSize: cache.size };
}
