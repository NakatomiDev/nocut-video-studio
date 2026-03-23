// @refresh reset
import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Play, Pause, Volume2, VolumeX, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useEditorStore, getActiveCutSegments, getFillsForCut } from '@/stores/editorStore';
import { supabase } from '@/integrations/supabase/client';

interface VideoPlayerProps {
  videoUrl: string | null;
}

const SPEEDS = [0.5, 1, 1.5, 2];

const formatTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

const VideoPlayer = ({ videoUrl }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fillVideoRef = useRef<HTMLVideoElement>(null);
  const internalSeekRef = useRef(false);
  const skipLockRef = useRef(false);

  const {
    isPlaying, playheadPosition, setPlayhead, play, pause,
    showFills, aiFills, fillVideoUrls, setFillVideoUrl,
    cuts, activeCuts, manualCuts, activeManualCuts,
  } = useEditorStore();

  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [duration, setDuration] = useState(0);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [playingFillId, setPlayingFillId] = useState<string | null>(null);

  // Fetch signed URLs for AI fills that don't have them yet
  useEffect(() => {
    if (!showFills) return;
    for (const fill of aiFills) {
      if (fill.s3Key && !fillVideoUrls.has(fill.id)) {
        supabase.functions.invoke('get-signed-url', {
          body: { s3_key: fill.s3Key },
        }).then(({ data }) => {
          const url = data?.url || data?.data?.url;
          if (url) setFillVideoUrl(fill.id, url);
        });
      }
    }
  }, [showFills, aiFills, fillVideoUrls, setFillVideoUrl]);

  // Core timeupdate / ended / loadedmetadata listeners.
  // Reads state from the store INSIDE the callback to avoid stale closures
  // and prevent the effect from re-running on every state change.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTime = () => {
      if (skipLockRef.current) return;

      const state = useEditorStore.getState();

      // Skip-cut logic when showFills (Preview Final) is on
      if (state.showFills && state.isPlaying) {
        const segments = getActiveCutSegments(state);
        const cutSeg = segments.find(
          (s) => v.currentTime >= s.start && v.currentTime < s.end,
        ) ?? null;

        if (cutSeg) {
          const urls = state.fillVideoUrls;
          // If fill exists and has a video URL, play it
          if (cutSeg.fill && urls.has(cutSeg.fill.id)) {
            skipLockRef.current = true;
            v.pause();
            setPlayingFillId(cutSeg.fill.id);
            const fillVideo = fillVideoRef.current;
            if (fillVideo) {
              fillVideo.currentTime = 0;
              fillVideo.play().catch(() => {});
            }
            (v as any)._resumeAt = cutSeg.end;
            return;
          }
          // No fill — just skip past the cut
          skipLockRef.current = true;
          v.currentTime = cutSeg.end;
          setTimeout(() => { skipLockRef.current = false; }, 50);
          return;
        }
      }

      internalSeekRef.current = true;
      state.setPlayhead(v.currentTime);
    };

    const onEnd = () => useEditorStore.getState().pause();
    const onMeta = () => { setDuration(v.duration); setVideoError(null); };

    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnd);
    v.addEventListener('loadedmetadata', onMeta);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('ended', onEnd);
      v.removeEventListener('loadedmetadata', onMeta);
    };
  // Only re-attach when the video element could change (videoUrl swap)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  // Resume main video after fill ends or errors
  const resumeAfterFill = useCallback(() => {
    setPlayingFillId(null);
    skipLockRef.current = false;
    const v = videoRef.current;
    if (v) {
      const resumeAt = (v as any)._resumeAt ?? v.currentTime;
      v.currentTime = resumeAt;
      delete (v as any)._resumeAt;
      // Read current isPlaying from store to avoid stale closure
      if (useEditorStore.getState().isPlaying) v.play().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const fillVideo = fillVideoRef.current;
    if (!fillVideo) return;
    const onEnded = () => resumeAfterFill();
    const onError = () => {
      console.warn('Fill video failed to load, skipping');
      resumeAfterFill();
    };
    const onStalled = () => {
      const timeout = setTimeout(() => {
        console.warn('Fill video stalled, skipping');
        resumeAfterFill();
      }, 3000);
      fillVideo.addEventListener('playing', () => clearTimeout(timeout), { once: true });
    };
    fillVideo.addEventListener('ended', onEnded);
    fillVideo.addEventListener('error', onError);
    fillVideo.addEventListener('stalled', onStalled);
    return () => {
      fillVideo.removeEventListener('ended', onEnded);
      fillVideo.removeEventListener('error', onError);
      fillVideo.removeEventListener('stalled', onStalled);
    };
  }, [resumeAfterFill]);

  // Safety: if skipLock is stuck for >2s, force-release it
  useEffect(() => {
    const interval = setInterval(() => {
      if (skipLockRef.current) {
        console.warn('skipLock stuck, force-releasing');
        skipLockRef.current = false;
      }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Sync external playhead changes (e.g. timeline scrub) to the video element
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (internalSeekRef.current) {
      internalSeekRef.current = false;
      return;
    }
    if (Math.abs(v.currentTime - playheadPosition) > 0.15) {
      v.currentTime = playheadPosition;
    }
  }, [playheadPosition]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoUrl) return;
    if (playingFillId) return; // don't control main video while fill is playing
    if (isPlaying) {
      const playPromise = v.play();
      if (playPromise) {
        playPromise.catch((err) => {
          if (err.name !== 'AbortError') {
            console.error('Playback failed:', err);
            setVideoError('Playback failed — try clicking play again');
            pause();
          }
        });
      }
    } else {
      v.pause();
    }
  }, [isPlaying, playingFillId, videoUrl, pause]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = speed;
    const fv = fillVideoRef.current;
    if (fv) fv.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      v.volume = volume;
      v.muted = muted;
    }
    const fv = fillVideoRef.current;
    if (fv) {
      fv.volume = volume;
      fv.muted = muted;
    }
  }, [volume, muted]);

  const handleSeek = useCallback((val: number[]) => {
    // Stop any playing fill
    if (playingFillId) {
      setPlayingFillId(null);
      skipLockRef.current = false;
    }
    const v = videoRef.current;
    if (v) {
      v.currentTime = val[0];
      setPlayhead(val[0]);
    }
  }, [setPlayhead, playingFillId]);

  const cycleSpeed = () => {
    const idx = SPEEDS.indexOf(speed);
    setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
  };

  const handleRetry = useCallback(() => {
    const v = videoRef.current;
    if (v) {
      setVideoError(null);
      v.load();
    }
  }, []);

  // Current fill video URL for the secondary player
  const currentFillUrl = playingFillId ? fillVideoUrls.get(playingFillId) ?? null : null;

  if (!videoUrl) {
    return (
      <div className="flex h-full items-center justify-center bg-background rounded-lg">
        <p className="text-muted-foreground">No video available</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background rounded-lg overflow-hidden">
      <div className="relative flex-1 flex items-center justify-center bg-black">
        {/* Main video — hidden when fill is playing */}
        <video
          ref={videoRef}
          src={videoUrl}
          className={`max-h-full max-w-full ${playingFillId ? 'hidden' : ''}`}
          preload="auto"
          playsInline
          onError={() => setVideoError('Video failed to load')}
        />
        {/* AI Fill video — shown when fill is playing */}
        <video
          ref={fillVideoRef}
          key={currentFillUrl ?? 'no-fill'}
          src={currentFillUrl ?? undefined}
          className={`max-h-full max-w-full ${playingFillId ? '' : 'hidden'}`}
          preload="auto"
          playsInline
        />
        {/* Click-to-cancel overlay when fill is playing */}
        {playingFillId && (
          <button
            className="absolute inset-0 z-10 cursor-pointer bg-transparent"
            onClick={() => {
              const fv = fillVideoRef.current;
              if (fv) fv.pause();
              resumeAfterFill();
            }}
            aria-label="Cancel AI fill playback"
          />
        )}
        {playingFillId && (
          <div className="absolute top-3 left-3 bg-accent/80 text-accent-foreground text-xs px-2 py-1 rounded font-medium">
            AI Fill
          </div>
        )}
        {videoError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80">
            <p className="text-sm text-muted-foreground">{videoError}</p>
            <Button variant="secondary" size="sm" onClick={handleRetry}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry
            </Button>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 p-3 border-t border-border">
        <Slider
          value={[playheadPosition]}
          max={duration || 1}
          step={0.1}
          onValueChange={handleSeek}
          className="w-full"
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => (isPlaying ? pause() : play())}>
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <span className="text-xs text-muted-foreground font-mono">
              {formatTime(playheadPosition)} / {formatTime(duration)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setMuted(!muted)}>
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </Button>
            <Slider
              value={[muted ? 0 : volume]}
              max={1}
              step={0.05}
              onValueChange={(v) => { setVolume(v[0]); setMuted(false); }}
              className="w-20"
            />
            <Button variant="ghost" size="sm" onClick={cycleSpeed} className="text-xs font-mono min-w-[3rem]">
              {speed}x
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;