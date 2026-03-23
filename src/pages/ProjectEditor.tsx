import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useEditorStore } from '@/stores/editorStore';
import type { AiFill } from '@/stores/editorStore';
import VideoPlayer from '@/components/editor/VideoPlayer';
import WaveformTimeline from '@/components/editor/WaveformTimeline';
import CutsPanel from '@/components/editor/CutsPanel';
import FillPreviewPanel from '@/components/editor/FillPreviewPanel';
import ExportProgress from '@/components/ExportProgress';
import EditorSkeleton from '@/components/editor/EditorSkeleton';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, AlertTriangle } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

const ProjectEditor = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { project, video, setProject, setVideo, setCutMap, setAiFills, reset } = useEditorStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [showExportProgress, setShowExportProgress] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [waveformUrl, setWaveformUrl] = useState<string | null>(null);
  const [thumbnailSpriteUrl, setThumbnailSpriteUrl] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  useDocumentTitle(title || 'Editor');

  const extractSignedUrl = (response: unknown) => {
    if (!response || typeof response !== 'object') return null;

    const payload = response as {
      data?: {
        url?: string;
        data?: {
          url?: string;
        };
      };
    };

    return payload.data?.url || payload.data?.data?.url || null;
  };

  useEffect(() => {
    return () => reset();
  }, [reset]);

  useEffect(() => {
    if (!projectId) return;

    const load = async () => {
      setLoading(true);
      setError(null);

      // Fetch project
      const { data: proj, error: projErr } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();

      if (projErr || !proj) {
        setError('Project not found');
        setLoading(false);
        return;
      }

      setProject(proj);
      setTitle(proj.title);

      // If status is generating/exporting, show export progress
      if (['generating', 'exporting'].includes(proj.status)) {
        setShowExportProgress(true);
        setLoading(false);
        return;
      }

      // Check status
      if (proj.status === 'failed') {
        setError(proj.error_message || 'Processing failed');
        setLoading(false);
        return;
      }

      if (['uploading', 'transcoding', 'detecting'].includes(proj.status)) {
        setProcessingStatus(proj.status);
        setLoading(false);
        return;
      }

      // Fetch video
      const { data: vid } = await supabase
        .from('videos')
        .select('*')
        .eq('project_id', projectId)
        .single();

      if (vid) {
        setVideo(vid);

        // Get signed URLs for video, waveform, and thumbnail sprite
        const videoKey = vid.proxy_s3_key || vid.s3_key;
        const videoResult = await supabase.functions.invoke('get-signed-url', {
          body: { s3_key: videoKey },
        });
        const nextVideoUrl = videoResult.data?.url || videoResult.data?.data?.url || null;
        if (nextVideoUrl) setVideoUrl(nextVideoUrl);

        if (vid.waveform_s3_key) {
          const waveformResult = await supabase.functions.invoke('get-signed-url', {
            body: { s3_key: vid.waveform_s3_key },
          });
          const nextWaveformUrl = waveformResult.data?.url || waveformResult.data?.data?.url || null;
          if (nextWaveformUrl) setWaveformUrl(nextWaveformUrl);
        }

        if (vid.thumbnail_sprite_s3_key) {
          const thumbnailResult = await supabase.functions.invoke('get-signed-url', {
            body: { s3_key: vid.thumbnail_sprite_s3_key },
          });
          const nextThumbnailSpriteUrl = thumbnailResult.data?.url || thumbnailResult.data?.data?.url || null;
          if (nextThumbnailSpriteUrl) setThumbnailSpriteUrl(nextThumbnailSpriteUrl);
        }

        // Fetch cut map
        const { data: cm } = await supabase
          .from('cut_maps')
          .select('*')
          .eq('video_id', vid.id)
          .order('version', { ascending: false })
          .limit(1)
          .single();

        if (cm) setCutMap(cm);

        // Fetch completed edit decisions and their AI fills
        const { data: editDecisions } = await supabase
          .from('edit_decisions')
          .select('id, edl_json, status')
          .eq('project_id', projectId)
          .eq('status', 'complete')
          .order('created_at', { ascending: false })
          .limit(1);

        if (editDecisions && editDecisions.length > 0) {
          const latestEd = editDecisions[0];
          const { data: fills } = await supabase
            .from('ai_fills')
            .select('*')
            .eq('edit_decision_id', latestEd.id);

          if (fills && fills.length > 0) {
            const edlJson = latestEd.edl_json as Array<{ start: number; end: number; fill_duration: number }>;
            const mappedFills: AiFill[] = fills.map((f) => {
              const gapEntry = edlJson[f.gap_index];
              return {
                id: f.id,
                editDecisionId: f.edit_decision_id,
                gapIndex: f.gap_index,
                startTime: gapEntry?.end ?? 0,
                duration: f.duration ?? gapEntry?.fill_duration ?? 0,
                s3Key: f.s3_key,
                provider: f.provider,
                qualityScore: f.quality_score,
                method: f.method,
              };
            });
            setAiFills(mappedFills);
          }
        }
      }

      setLoading(false);
    };

    load();
  }, [projectId, setProject, setVideo, setCutMap, setAiFills]);

  // Realtime subscription for project status changes (processing, generating, etc.)
  useEffect(() => {
    if (!projectId) return;

    const channel = supabase
      .channel(`project-${projectId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` },
        (payload) => {
          const updated = payload.new as any;
          setProject(updated);
          if (updated.status === 'ready' || updated.status === 'complete') {
            if (processingStatus || showExportProgress) {
              setProcessingStatus(null);
              setShowExportProgress(false);
              window.location.reload();
            }
          } else if (updated.status === 'failed') {
            setProcessingStatus(null);
            setError(updated.error_message || 'Processing failed');
          } else if (['generating', 'exporting'].includes(updated.status)) {
            // Don't switch to export progress if we're just doing a preview generation
            if (!useEditorStore.getState().previewGeneratingCutId) {
              setShowExportProgress(true);
            }
            setProcessingStatus(null);
          } else if (['uploading', 'transcoding', 'detecting'].includes(updated.status)) {
            setProcessingStatus(updated.status);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [projectId, processingStatus, showExportProgress, setProject]);

  const saveTitle = async () => {
    if (!projectId || !title.trim()) return;
    setEditingTitle(false);
    await supabase.from('projects').update({ title: title.trim() }).eq('id', projectId);
  };

  // Also show export progress if ?exporting=true query param
  useEffect(() => {
    if (searchParams.get('exporting') === 'true' && projectId) {
      setShowExportProgress(true);
    }
  }, [searchParams, projectId]);

  const handleExportComplete = (exportId: string) => {
    if (projectId) {
      navigate(`/project/${projectId}/export/${exportId}`);
    }
  };

  const handleExportRetry = () => {
    setShowExportProgress(false);
    setError(null);
  };

  const statusMessages: Record<string, { text: string; sub: string }> = {
    uploading: { text: 'Uploading...', sub: 'Your video is being uploaded' },
    transcoding: { text: 'Processing your video...', sub: 'Creating proxy and waveform' },
    detecting: { text: 'Analyzing audio...', sub: 'Detecting silences and pauses' },
  };

  if (loading) {
    return <EditorSkeleton />;
  }

  if (showExportProgress && projectId) {
    return (
      <ExportProgress
        projectId={projectId}
        onComplete={handleExportComplete}
        onRetry={handleExportRetry}
      />
    );
  }

  if (processingStatus) {
    const msg = statusMessages[processingStatus] || { text: 'Processing...', sub: '' };
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <h2 className="text-xl font-semibold text-foreground">{msg.text}</h2>
        <p className="text-sm text-muted-foreground">{msg.sub}</p>
        <Button variant="ghost" onClick={() => navigate('/dashboard')} className="mt-4">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
        </Button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background gap-4">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <h2 className="text-xl font-semibold text-foreground">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">{error}</p>
        <div className="flex gap-3">
          <Button variant="ghost" onClick={() => navigate('/dashboard')}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
          </Button>
          <Button onClick={() => window.location.reload()}>Try Again</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {editingTitle ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === 'Enter' && saveTitle()}
            className="bg-transparent border-b border-primary text-foreground text-sm font-medium outline-none px-1"
          />
        ) : (
          <button
            onClick={() => setEditingTitle(true)}
            className="text-sm font-medium text-foreground hover:text-primary transition-colors"
          >
            {title || 'Untitled Project'}
          </button>
        )}
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: video + timeline */}
        <div className="flex flex-1 flex-col">
          {/* Video preview — 60% */}
          <div className="h-[60%] p-2">
            <VideoPlayer videoUrl={videoUrl} />
          </div>

          {/* Waveform timeline — 40% (relative for fill preview popover) */}
          <div className="h-[40%] relative">
            <WaveformTimeline
              waveformUrl={waveformUrl}
              videoUrl={videoUrl}
              thumbnailSpriteUrl={thumbnailSpriteUrl}
              duration={video?.duration || 0}
            />
            <FillPreviewPanel />
          </div>
        </div>

        {/* Right sidebar — cuts panel */}
        <div className="w-[320px] shrink-0">
          <CutsPanel thumbnailSpriteUrl={thumbnailSpriteUrl} videoUrl={videoUrl} duration={video?.duration || 0} />
        </div>
      </div>
    </div>
  );
};

export default ProjectEditor;
