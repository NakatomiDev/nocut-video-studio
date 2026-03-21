import { useRef, useEffect, useState, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useEditorStore } from '@/stores/editorStore';

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
  const internalSeekRef = useRef(false);
  const { isPlaying, playheadPosition, setPlayhead, play, pause } = useEditorStore();
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      internalSeekRef.current = true;
      setPlayhead(v.currentTime);
    };
    const onEnd = () => pause();
    const onMeta = () => setDuration(v.duration);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnd);
    v.addEventListener('loadedmetadata', onMeta);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('ended', onEnd);
      v.removeEventListener('loadedmetadata', onMeta);
    };
  }, [setPlayhead, pause]);

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
    if (!v) return;
    if (isPlaying) v.play().catch(() => {});
    else v.pause();
  }, [isPlaying]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      v.volume = volume;
      v.muted = muted;
    }
  }, [volume, muted]);

  const handleSeek = useCallback((val: number[]) => {
    const v = videoRef.current;
    if (v) {
      v.currentTime = val[0];
      setPlayhead(val[0]);
    }
  }, [setPlayhead]);

  const cycleSpeed = () => {
    const idx = SPEEDS.indexOf(speed);
    setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
  };

  if (!videoUrl) {
    return (
      <div className="flex h-full items-center justify-center bg-background rounded-lg">
        <p className="text-muted-foreground">No video available</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background rounded-lg overflow-hidden">
      <div className="flex-1 flex items-center justify-center bg-black">
        <video ref={videoRef} src={videoUrl} className="max-h-full max-w-full" preload="metadata" />
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
