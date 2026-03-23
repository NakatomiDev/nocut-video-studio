// @refresh reset
import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Play, Pause, Plus, Trash2, Loader2, Sparkles, RefreshCw } from 'lucide-react';
import { usePreviewFill } from '@/hooks/usePreviewFill';
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
  const removeFill = useEditorStore((s) => s.removeFill);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const pause = useEditorStore((s) => s.pause);

  const cuts = useEditorStore((s) => s.cuts);
  const manualCuts = useEditorStore((s) => s.manualCuts);
  const previewGeneratingCutId = useEditorStore((s) => s.previewGeneratingCutId);
  const { generatePreview } = usePreviewFill();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const fill = selectedFill;

  useEffect(() => {
    if (!fill?.s3Key) {
      setVideoUrl(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setVideoUrl(null);
    setPlayProgress(0);
    setIsPlaying(false);

    supabase.functions
      .invoke('get-signed-url', { body: { s3_key: fill.s3Key } })
      .then(({ data, error: fnErr }) => {
        if (cancelled) return;
        if (fnErr) {
          setError('Could not load fill video');
          setLoading(false);
          return;
        }
        const url = data?.url || data?.data?.url;
        if (url) {
          setVideoUrl(url);
        } else {
          setError('Fill video not available yet');
        }
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [fill?.id, fill?.s3Key]);

  if (!fill) return null;

  const isInserted = insertedFills.has(fill.id);

  const matchingCut = [...cuts, ...manualCuts].find(
    (c) => Math.abs(c.end - fill.startTime) < 0.5,
  );

  const handleJumpTo = () => {
    pause();
    setPlayhead(fill.startTime);
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      if (videoRef.current.ended) {
        videoRef.current.currentTime = 0;
      }
      videoRef.current.play();
    }
  };

  return (
    <Dialog open={!!fill} onOpenChange={(open) => { if (!open) selectFill(null); }}>
      <DialogContent className="max-w-lg p-0 overflow-hidden bg-card border-border gap-0">
        <DialogHeader className="px-4 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <DialogTitle className="text-sm font-semibold">AI Fill Preview</DialogTitle>
            <Badge variant="outline" className="text-[9px]">
              {fill.duration}s
            </Badge>
          </div>
          <DialogDescription className="sr-only">Preview of generated AI fill video</DialogDescription>
        </DialogHeader>

        {/* Video preview */}
        <div className="bg-black aspect-video flex items-center justify-center relative group">
          {loading && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
          {error && <span className="text-xs text-muted-foreground px-4 text-center">{error}</span>}
          {!loading && !error && videoUrl && (
            <>
              <video
                ref={videoRef}
                key={videoUrl}
                src={videoUrl}
                className="w-full h-full object-contain"
                preload="auto"
                crossOrigin="anonymous"
                onTimeUpdate={() => {
                  if (!videoRef.current) return;
                  const dur = videoRef.current.duration || 1;
                  setPlayProgress((videoRef.current.currentTime / dur) * 100);
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => { setIsPlaying(false); setPlayProgress(100); }}
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
          {!loading && !error && !videoUrl && (
            <span className="text-xs text-muted-foreground">No video file available</span>
          )}
        </div>

        {/* Info + actions */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border">
          <div className="flex items-center gap-3">
            <button
              onClick={handleJumpTo}
              className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              <Play className="h-3 w-3 inline mr-1" />
              {formatTimestamp(fill.startTime)}
            </button>
            {fill.qualityScore !== null && (
              <span className="text-[10px] text-muted-foreground">
                Quality: {Math.round(fill.qualityScore * 100)}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {matchingCut && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                disabled={!!previewGeneratingCutId}
                onClick={() => {
                  generatePreview(matchingCut.id);
                  selectFill(null);
                }}
              >
                <RefreshCw className="h-3 w-3 mr-1" /> Regenerate
              </Button>
            )}
            {isInserted ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive hover:text-destructive"
                onClick={() => removeFill(fill.id)}
              >
                <Trash2 className="h-3 w-3 mr-1" /> Remove
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => insertFill(fill.id)}
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
