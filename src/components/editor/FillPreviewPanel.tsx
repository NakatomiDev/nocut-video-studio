// @refresh reset
import { useEffect, useRef, useState, useCallback } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import type { AiFill } from '@/stores/editorStore';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Play, Pause, Plus, Loader2, Sparkles } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

const formatTimestamp = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${parseFloat(sec) < 10 ? '0' : ''}${sec}`;
};

const FillPreviewPanel = () => {
  const selectedFill = useEditorStore((s) => s.selectedFill);
  const selectFill = useEditorStore((s) => s.selectFill);
  const insertedFills = useEditorStore((s) => s.insertedFills);
  const insertFill = useEditorStore((s) => s.insertFill);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const pause = useEditorStore((s) => s.pause);
  const fillNames = useEditorStore((s) => s.fillNames);

  // Normalize to array
  const fills: AiFill[] = selectedFill
    ? Array.isArray(selectedFill)
      ? selectedFill
      : [selectedFill]
    : [];

  const isOpen = fills.length > 0;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrls, setVideoUrls] = useState<Map<string, string>>(new Map());
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Fetch signed URLs for all fills
  useEffect(() => {
    if (fills.length === 0) {
      setVideoUrls(new Map());
      setLoading(false);
      setCurrentIdx(0);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setVideoUrls(new Map());
    setCurrentIdx(0);
    setPlayProgress(0);
    setIsPlaying(false);

    const fetchUrls = async () => {
      const urls = new Map<string, string>();
      for (const fill of fills) {
        if (!fill.s3Key || cancelled) continue;
        const { data } = await supabase.functions.invoke('get-signed-url', {
          body: { s3_key: fill.s3Key },
        });
        if (cancelled) return;
        const url = data?.url || data?.data?.url;
        if (url) urls.set(fill.id, url);
      }
      if (!cancelled) {
        setVideoUrls(urls);
        setLoading(false);
        if (urls.size === 0) setError('Could not load fill videos');
      }
    };
    fetchUrls();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fills.map((f) => f.id).join(',')]);

  const currentFill = fills[currentIdx] ?? null;
  const currentUrl = currentFill ? videoUrls.get(currentFill.id) ?? null : null;
  const totalDuration = fills.reduce((s, f) => s + (f.duration || 0), 0);

  // Calculate overall progress across all fills
  const updateProgress = useCallback(() => {
    if (!videoRef.current || fills.length === 0) return;
    const prevDuration = fills.slice(0, currentIdx).reduce((s, f) => s + (f.duration || 0), 0);
    const currentTime = videoRef.current.currentTime;
    const overall = totalDuration > 0 ? ((prevDuration + currentTime) / totalDuration) * 100 : 0;
    setPlayProgress(overall);
  }, [currentIdx, fills, totalDuration]);

  const handleEnded = useCallback(() => {
    // Move to next fill or finish
    if (currentIdx < fills.length - 1) {
      setCurrentIdx((prev) => prev + 1);
      // Next video will auto-play via effect
    } else {
      setIsPlaying(false);
      setPlayProgress(100);
    }
  }, [currentIdx, fills.length]);

  // Auto-play next video in chain
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentUrl) return;
    video.src = currentUrl;
    video.load();
    if (isPlaying || currentIdx > 0) {
      video.play().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUrl, currentIdx]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      if (currentIdx >= fills.length - 1 && videoRef.current.ended) {
        // Restart from beginning
        setCurrentIdx(0);
        setPlayProgress(0);
        setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.currentTime = 0;
            videoRef.current.play().catch(() => {});
          }
        }, 50);
        return;
      }
      if (videoRef.current.ended) {
        videoRef.current.currentTime = 0;
      }
      videoRef.current.play().catch(() => {});
    }
  };

  const handleJumpTo = () => {
    if (!currentFill) return;
    pause();
    setPlayhead(currentFill.startTime);
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) selectFill(null); }}>
      <DialogContent className="max-w-lg p-0 overflow-hidden bg-card border-border gap-0">
        <DialogHeader className="px-4 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <DialogTitle className="text-sm font-semibold">
              {fills.length > 1 ? 'AI Fill Sequence' : 'AI Fill Preview'}
            </DialogTitle>
            <Badge variant="outline" className="text-[9px]">
              {totalDuration}s{fills.length > 1 ? ` · ${fills.length} fills` : ''}
            </Badge>
          </div>
          <DialogDescription className="sr-only">Preview of generated AI fill video{fills.length > 1 ? 's' : ''}</DialogDescription>
        </DialogHeader>

        {/* Video preview */}
        <div className="bg-black aspect-video flex items-center justify-center relative group">
          {loading && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
          {error && <span className="text-xs text-muted-foreground px-4 text-center">{error}</span>}
          {!loading && !error && currentUrl && (
            <>
              <video
                ref={videoRef}
                className="w-full h-full object-contain"
                preload="auto"
                crossOrigin="anonymous"
                onTimeUpdate={updateProgress}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={handleEnded}
                onError={() => setError('Failed to load video file')}
              />
              <button
                className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                onClick={togglePlay}
              >
                {isPlaying ? (
                  <Pause className="h-10 w-10 text-white drop-shadow-lg" />
                ) : (
                  <Play className="h-10 w-10 text-white drop-shadow-lg" />
                )}
              </button>
              <div className="absolute bottom-0 left-0 right-0 h-1">
                <Progress value={playProgress} className="h-1 rounded-none bg-black/40 [&>div]:bg-primary" />
              </div>
            </>
          )}
          {!loading && !error && !currentUrl && (
            <span className="text-xs text-muted-foreground">No video file available</span>
          )}
        </div>

        {/* Sequence indicator for multi-fill */}
        {fills.length > 1 && (
          <div className="flex items-center gap-1 px-4 py-1.5 border-t border-border bg-muted/20">
            {fills.map((f, i) => {
              const name = fillNames.get(f.id) || `Fill ${i + 1}`;
              return (
                <button
                  key={f.id}
                  onClick={() => {
                    setCurrentIdx(i);
                    setPlayProgress(0);
                  }}
                  className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${
                    i === currentIdx
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary/60 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        )}

        {/* Info + actions */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border">
          <div className="flex items-center gap-3">
            {currentFill && (
              <button
                onClick={handleJumpTo}
                className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
              >
                <Play className="h-3 w-3 inline mr-1" />
                {formatTimestamp(currentFill.startTime)}
              </button>
            )}
            {currentFill?.qualityScore !== null && currentFill?.qualityScore !== undefined && (
              <span className="text-[10px] text-muted-foreground">
                Quality: {Math.round(currentFill.qualityScore * 100)}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {currentFill && !insertedFills.has(currentFill.id) && (
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => insertFill(currentFill.id)}
              >
                <Plus className="h-3 w-3 mr-1" /> Insert Fill
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default FillPreviewPanel;
