import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  Download,
  Plus,
  Scissors,
  Sparkles,
  RefreshCw,
  Film,
  Loader2,
} from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

interface ExportData {
  id: string;
  project_id: string;
  format: string;
  resolution: string | null;
  duration: number | null;
  file_size_bytes: number | null;
  watermarked: boolean;
  c2pa_signed: boolean;
  fill_summary_json: Record<string, unknown> | null;
  download_url: string | null;
  s3_key: string;
  created_at: string | null;
}

const formatBytes = (bytes: number | null) => {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const formatDuration = (s: number | null) => {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

const ExportComplete = () => {
  const { projectId, exportId } = useParams<{ projectId: string; exportId: string }>();
  const navigate = useNavigate();
  const [exportData, setExportData] = useState<ExportData | null>(null);
  const [projectTitle, setProjectTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [allExports, setAllExports] = useState<ExportData[]>([]);
  useDocumentTitle(projectTitle ? `${projectTitle} — Export` : 'Export');

  useEffect(() => {
    if (!projectId || !exportId) return;

    const load = async () => {
      setLoading(true);

      const [{ data: exp }, { data: proj }, { data: exports }] = await Promise.all([
        supabase
          .from('exports')
          .select('*')
          .eq('id', exportId)
          .eq('project_id', projectId)
          .single(),
        supabase
          .from('projects')
          .select('title')
          .eq('id', projectId)
          .single(),
        supabase
          .from('exports')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false }),
      ]);

      if (exp) {
        setExportData(exp as unknown as ExportData);

        const result = await supabase.functions.invoke('get-signed-url', {
          body: { s3_key: exp.s3_key },
        });
        const url = result.data?.url || result.data?.data?.url || null;
        if (url) setVideoUrl(url);
      }

      if (proj) setProjectTitle(proj.title);
      if (exports) setAllExports(exports as unknown as ExportData[]);
      setLoading(false);
    };

    load();
  }, [projectId, exportId]);

  const handleDownload = async () => {
    if (!videoUrl) return;
    setDownloading(true);
    try {
      const response = await fetch(videoUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectTitle || 'export'}.${exportData?.format || 'mp4'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(videoUrl, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  const summary = exportData?.fill_summary_json as {
    total_gaps?: number;
    ai_fills?: number;
    crossfades?: number;
    hard_cuts?: number;
    credits_used?: number;
    credits_refunded?: number;
  } | null;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!exportData) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background gap-4">
        <h2 className="text-xl font-semibold text-foreground">Export not found</h2>
        <Button variant="ghost" onClick={() => navigate('/dashboard')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/project/${projectId}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-sm font-medium text-foreground truncate">{projectTitle}</h1>
        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px]">
          Complete
        </Badge>
      </div>

      <div className="mx-auto max-w-4xl p-6 space-y-6">
        <div className="rounded-lg overflow-hidden bg-black aspect-video">
          {videoUrl ? (
            <video src={videoUrl} controls className="w-full h-full" preload="auto" />
          ) : (
            <div className="flex items-center justify-center h-full">
              <Film className="h-12 w-12 text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <Button size="lg" className="gap-2" onClick={handleDownload} disabled={!videoUrl || downloading}>
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download
          </Button>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="uppercase font-medium">{exportData.format}</span>
            {exportData.resolution && <span>{exportData.resolution}</span>}
            <span>{formatDuration(exportData.duration)}</span>
            <span>{formatBytes(exportData.file_size_bytes)}</span>
            {exportData.watermarked && (
              <Badge variant="outline" className="text-[10px] border-border">Watermarked</Badge>
            )}
            {exportData.c2pa_signed && (
              <Badge variant="outline" className="text-[10px] border-border">C2PA Signed</Badge>
            )}
          </div>
        </div>

        {summary && (
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Export Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                {summary.total_gaps != null && (
                  <div className="space-y-1">
                    <p className="text-muted-foreground flex items-center gap-1.5">
                      <Scissors className="h-3.5 w-3.5" /> Total cuts
                    </p>
                    <p className="text-lg font-semibold text-foreground tabular-nums">{summary.total_gaps}</p>
                  </div>
                )}
                {summary.ai_fills != null && (
                  <div className="space-y-1">
                    <p className="text-muted-foreground flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5" /> AI fills
                    </p>
                    <p className="text-lg font-semibold text-foreground tabular-nums">
                      {summary.ai_fills}
                      {summary.credits_used != null && (
                        <span className="text-xs text-muted-foreground ml-1">({summary.credits_used} credits)</span>
                      )}
                    </p>
                  </div>
                )}
                {summary.crossfades != null && (
                  <div className="space-y-1">
                    <p className="text-muted-foreground flex items-center gap-1.5">
                      <RefreshCw className="h-3.5 w-3.5" /> Crossfades
                    </p>
                    <p className="text-lg font-semibold text-foreground tabular-nums">
                      {summary.crossfades}
                      {(summary.credits_refunded ?? 0) > 0 && (
                        <span className="text-xs text-green-500 ml-1">(+{summary.credits_refunded} refunded)</span>
                      )}
                    </p>
                  </div>
                )}
                {summary.hard_cuts != null && (
                  <div className="space-y-1">
                    <p className="text-muted-foreground">Hard cuts</p>
                    <p className="text-lg font-semibold text-foreground tabular-nums">{summary.hard_cuts}</p>
                  </div>
                )}
                {summary.credits_used != null && (
                  <div className="space-y-1">
                    <p className="text-muted-foreground">Net credits used</p>
                    <p className="text-lg font-semibold text-foreground tabular-nums">
                      {(summary.credits_used ?? 0) - (summary.credits_refunded ?? 0)}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Export history */}
        {allExports.length > 1 && (
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Export History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {allExports.map((exp) => {
                const isActive = exp.id === exportId;
                const date = exp.created_at ? new Date(exp.created_at) : null;
                return (
                  <button
                    key={exp.id}
                    onClick={() => {
                      if (!isActive) navigate(`/project/${projectId}/export/${exp.id}`);
                    }}
                    className={`w-full flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                      isActive
                        ? 'bg-primary/10 border border-primary/30 text-foreground'
                        : 'bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Film className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : exp.id.slice(0, 8)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      {exp.resolution && <span>{exp.resolution}</span>}
                      <span>{formatBytes(exp.file_size_bytes)}</span>
                      {isActive && <Badge className="bg-primary/20 text-primary border-primary/30 text-[9px]">Viewing</Badge>}
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>
        )}

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => navigate(`/project/${projectId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Editor
          </Button>
          <Button variant="outline" onClick={() => navigate('/upload')}>
            <Plus className="mr-2 h-4 w-4" /> New Project
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ExportComplete;