import { useState, useEffect, useCallback, useRef } from 'react';
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

const STAGE_ORDER: Record<Stage, number> = {
  generating: 0,
  exporting: 1,
  finalizing: 2,
  complete: 3,
  failed: 3,
};

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
  const stageRef = useRef<Stage>('generating');
  const progressRef = useRef(0);

  // Only advance stage forward (never regress), unless it's 'failed'
  const advanceStage = useCallback((newStage: Stage, newProgress: number, error?: string) => {
    const current = stageRef.current;
    if (STAGE_ORDER[newStage] >= STAGE_ORDER[current] || newStage === 'failed') {
      // For same stage, only advance progress forward
      if (newStage === current && newProgress < progressRef.current && newStage !== 'failed') {
        return;
      }
      stageRef.current = newStage;
      progressRef.current = newProgress;
      setStage(newStage);
      setProgress(newProgress);
      if (error) setErrorMessage(error);
    }
  }, []);

  const applyJobState = useCallback((job: Record<string, unknown>) => {
    if (!job) return;
    const jobType = job.type as string;
    const status = job.status as string;
    const progressPct = (job.progress_percent as number) ?? 0;

    if (jobType === 'ai.fill') {
      if (status === 'queued') {
        advanceStage('generating', 0);
      } else if (status === 'processing') {
        advanceStage('generating', Math.min(progressPct * 0.6, 60));
      } else if (status === 'complete') {
        advanceStage('exporting', 60);
      } else if (status === 'failed') {
        advanceStage('failed', 0, (job.error_message as string) || 'AI fill generation failed');
      }
    } else if (jobType === 'video.export') {
      if (status === 'queued') {
        advanceStage('exporting', 60);
      } else if (status === 'processing') {
        const s = progressPct >= 90 ? 'finalizing' as const : 'exporting' as const;
        advanceStage(s, 60 + Math.min(progressPct * 0.4, 40));
      } else if (status === 'complete') {
        advanceStage('complete', 100);
      } else if (status === 'failed') {
        advanceStage('failed', 0, (job.error_message as string) || 'Video export failed');
      }
    }
  }, [advanceStage]);

  const applyProjectState = useCallback((proj: Record<string, unknown>) => {
    if (!proj) return;
    const status = proj.status as string;

    if (status === 'complete') {
      advanceStage('complete', 100);
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
    } else if (status === 'ready') {
      // ready means fills done but export not yet queued — treat as exporting
      advanceStage('exporting', 60);
    } else if (status === 'failed') {
      advanceStage('failed', 0, (proj.error_message as string) || 'Processing failed');
    } else if (status === 'generating') {
      advanceStage('generating', 0);
    } else if (status === 'exporting') {
      advanceStage('exporting', 60);
    }
  }, [advanceStage, projectId, onComplete]);

  const fetchCurrentState = useCallback(async () => {
    const { data: jobs } = await supabase
      .from('job_queue')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(2);

    if (jobs && jobs.length > 0) {
      // Only use the most recent job (index 0, ordered by created_at desc).
      // Older failed jobs should not override the current job's state.
      const latestJob = jobs[0];
      applyJobState(latestJob as Record<string, unknown>);
    }

    const { data: proj } = await supabase
      .from('projects')
      .select('id, status, error_message')
      .eq('id', projectId)
      .single();

    if (proj) {
      applyProjectState(proj as Record<string, unknown>);
    }
  }, [projectId, applyJobState, applyProjectState]);

  // Realtime subscriptions + initial fetch
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
          applyJobState(payload.new as Record<string, unknown>);
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
          applyProjectState(payload.new as Record<string, unknown>);
        }
      )
      .subscribe();

    // Fetch current state to catch up on anything missed before subscriptions were ready
    fetchCurrentState();

    return () => {
      supabase.removeChannel(jobChannel);
      supabase.removeChannel(projChannel);
    };
  }, [projectId, applyJobState, applyProjectState, fetchCurrentState]);

  // Polling safety net — re-fetch every 10s while still in progress
  useEffect(() => {
    if (stage === 'complete' || stage === 'failed') return;

    const interval = setInterval(() => {
      fetchCurrentState();
    }, 10_000);

    return () => clearInterval(interval);
  }, [stage, fetchCurrentState]);

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
