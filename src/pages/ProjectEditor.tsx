import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useEditorStore } from '@/stores/editorStore';
import VideoPlayer from '@/components/editor/VideoPlayer';
import WaveformTimeline from '@/components/editor/WaveformTimeline';
import CutsPanel from '@/components/editor/CutsPanel';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, AlertTriangle } from 'lucide-react';

const ProjectEditor = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { project, video, setProject, setVideo, setCutMap, reset } = useEditorStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [waveformUrl, setWaveformUrl] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);

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

        // Get signed URLs for video and waveform
        const videoKey = vid.proxy_s3_key || vid.s3_key;
        const { data: videoSigned } = await supabase.functions.invoke('get-signed-url', {
          body: { s3_key: videoKey },
        });
        if (videoSigned?.url) setVideoUrl(videoSigned.url);

        if (vid.waveform_s3_key) {
          const { data: waveformSigned } = await supabase.functions.invoke('get-signed-url', {
            body: { s3_key: vid.waveform_s3_key },
          });
          if (waveformSigned?.url) setWaveformUrl(waveformSigned.url);
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
      }

      setLoading(false);
    };

    load();
  }, [projectId, setProject, setVideo, setCutMap]);

  // Realtime subscription for processing projects
  useEffect(() => {
    if (!projectId || !processingStatus) return;

    const channel = supabase
      .channel(`project-${projectId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` },
        (payload) => {
          const updated = payload.new as any;
          setProject(updated);
          if (updated.status === 'ready') {
            setProcessingStatus(null);
            // Re-trigger data load
            window.location.reload();
          } else if (updated.status === 'failed') {
            setProcessingStatus(null);
            setError(updated.error_message || 'Processing failed');
          } else {
            setProcessingStatus(updated.status);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [projectId, processingStatus, setProject]);

  const saveTitle = async () => {
    if (!projectId || !title.trim()) return;
    setEditingTitle(false);
    await supabase.from('projects').update({ title: title.trim() }).eq('id', projectId);
  };

  const statusMessages: Record<string, { text: string; sub: string }> = {
    uploading: { text: 'Uploading...', sub: 'Your video is being uploaded' },
    transcoding: { text: 'Processing your video...', sub: 'Creating proxy and waveform' },
    detecting: { text: 'Analyzing audio...', sub: 'Detecting silences and pauses' },
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
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

          {/* Waveform timeline — 40% */}
          <div className="h-[40%]">
            <WaveformTimeline
              waveformUrl={project?.status === 'ready' && video?.waveform_s3_key || null}
              duration={video?.duration || 0}
            />
          </div>
        </div>

        {/* Right sidebar — cuts panel */}
        <div className="w-[280px] shrink-0">
          <CutsPanel />
        </div>
      </div>
    </div>
  );
};

export default ProjectEditor;
