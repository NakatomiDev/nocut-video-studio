import { useEffect, useState } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Play, Plus, Trash2, Loader2, Sparkles } from 'lucide-react';

const formatTimestamp = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${parseFloat(sec) < 10 ? '0' : ''}${sec}`;
};

const FillPreviewPanel = () => {
  const {
    selectedFill,
    selectFill,
    insertedFills,
    insertFill,
    removeFill,
    fillVideoUrls,
    setFillVideoUrl,
    setPlayhead,
    pause,
  } = useEditorStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fill = selectedFill;

  useEffect(() => {
    if (!fill?.s3Key || fillVideoUrls.has(fill.id)) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

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
          setFillVideoUrl(fill.id, url);
        } else {
          setError('Fill video not available yet');
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fill?.id, fill?.s3Key]);

  if (!fill) return null;

  const isInserted = insertedFills.has(fill.id);
  const videoUrl = fillVideoUrls.get(fill.id) || null;

  const handleJumpTo = () => {
    pause();
    setPlayhead(fill.startTime);
  };

  return (
    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-50 w-[420px] rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold text-foreground">AI Fill Preview</span>
          <Badge variant="outline" className="text-[9px]">
            {fill.provider || 'mock'} · {fill.duration}s
          </Badge>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => selectFill(null)}>
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Video preview */}
      <div className="bg-black aspect-video flex items-center justify-center">
        {loading && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
        {error && <span className="text-xs text-muted-foreground px-4 text-center">{error}</span>}
        {!loading && !error && videoUrl && (
          <video
            src={videoUrl}
            className="w-full h-full object-contain"
            controls
            preload="metadata"
            muted
          />
        )}
        {!loading && !error && !videoUrl && (
          <span className="text-xs text-muted-foreground">No video file generated yet (mock provider)</span>
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
    </div>
  );
};

export default FillPreviewPanel;