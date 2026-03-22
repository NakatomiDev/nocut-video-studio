import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';

interface ExportProgressProps {
  projectId: string;
  onComplete: (exportId: string) => void;
  onRetry: () => void;
}

type Stage = 'generating' | 'exporting' | 'finalizing' | 'complete' | 'failed';

const stageConfig: Record<Stage, { label: string; sub: string; icon: React.ReactNode }> = {
  generating: {
    label: 'Generating AI fills...',
    sub: 'Creating smooth transitions for your cuts',
    icon: <Loader2 className="h-10 w-10 animate-spin text-primary" />,
  },
  exporting: {
    label: 'Assembling video...',
    sub: 'Combining source footage with AI fills',
    icon: <Loader2 className="h-10 w-10 animate-spin text-primary" />,
  },
  finalizing: {
    label: 'Finalizing...',
    sub: 'Almost there — applying final touches',
    icon: <Loader2 className="h-10 w-10 animate-spin text-primary" />,
  },
  complete: {
    label: 'Export complete!',
    sub: 'Your video is ready to download',
    icon: <CheckCircle2 className="h-10 w-10 text-green-500" />,
  },
  failed: {
    label: 'Export failed',
    sub: 'Something went wrong during processing',
    icon: <AlertTriangle className="h-10 w-10 text-destructive" />,
  },
};

const ExportProgress = ({ projectId, onComplete, onRetry }: ExportProgressProps) => {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('generating');
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const jobChannel = supabase
      .channel(`export-jobs-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'job_queue',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const job = payload.new as Record<string, unknown>;
          if (!job) return;

          const jobType = job.type as string;
          const status = job.status as string;
          const progressPct = (job.progress_percent as number) ?? 0;

          if (jobType === 'ai.fill') {
            if (status === 'processing') {
              setStage('generating');
              setProgress(Math.min(progressPct * 0.6, 60));
            } else if (status === 'complete') {
              setStage('exporting');
              setProgress(60);
            } else if (status === 'failed') {
              setStage('failed');
              setErrorMessage((job.error_message as string) || 'AI fill generation failed');
            }
          } else if (jobType === 'video.export') {
            if (status === 'processing') {
              setStage(progressPct >= 90 ? 'finalizing' : 'exporting');
              setProgress(60 + Math.min(progressPct * 0.4, 40));
            } else if (status === 'complete') {
              setStage('complete');
              setProgress(100);
            } else if (status === 'failed') {
              setStage('failed');
              setErrorMessage((job.error_message as string) || 'Video export failed');
            }
          }
        }
      )
      .subscribe();

    const projChannel = supabase
      .channel(`export-project-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'projects',
          filter: `id=eq.${projectId}`,
        },
        (payload) => {
          const proj = payload.new as Record<string, unknown>;
          if (proj.status === 'complete') {
            setStage('complete');
            setProgress(100);
            supabase
              .from('exports')
              .select('id')
              .eq('project_id', projectId)
              .order('created_at', { ascending: false })
              .limit(1)
              .single()
              .then(({ data }) => {
                if (data) onComplete(data.id);
              });
          } else if (proj.status === 'failed') {
            setStage('failed');
            setErrorMessage((proj.error_message as string) || 'Processing failed');
          } else if (proj.status === 'generating') {
            setStage('generating');
          } else if (proj.status === 'exporting') {
            setStage('exporting');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(jobChannel);
      supabase.removeChannel(projChannel);
    };
  }, [projectId, onComplete]);

  const config = stageConfig[stage];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background gap-6 px-4">
      {config.icon}
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-foreground">{config.label}</h2>
        <p className="text-sm text-muted-foreground">{config.sub}</p>
        {errorMessage && stage === 'failed' && (
          <p className="text-sm text-destructive mt-2">{errorMessage}</p>
        )}
      </div>

      {stage !== 'failed' && stage !== 'complete' && (
        <div className="w-full max-w-md space-y-2">
          <Progress value={progress} className="h-2" />
          <p className="text-center text-xs text-muted-foreground font-mono tabular-nums">
            {Math.round(progress)}%
          </p>
        </div>
      )}

      <div className="flex gap-3 mt-2">
        <Button variant="ghost" onClick={() => navigate('/dashboard')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Dashboard
        </Button>
        {stage === 'failed' && (
          <Button onClick={onRetry}>
            <RefreshCw className="mr-2 h-4 w-4" /> Try Again
          </Button>
        )}
      </div>

      {stage !== 'failed' && stage !== 'complete' && (
        <p className="text-xs text-muted-foreground mt-4">
          You can leave this page — we'll keep processing in the background
        </p>
      )}
    </div>
  );
};

export default ExportProgress;