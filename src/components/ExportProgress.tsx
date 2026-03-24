import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, AlertTriangle, CheckCircle2, RefreshCw, Package, Server, Film, Sparkles } from 'lucide-react';

interface ExportProgressProps {
  projectId: string;
  onComplete: (exportId: string) => void;
  onRetry: () => void;
}

type Stage = 'submitted' | 'queued' | 'assembling' | 'finalizing' | 'complete' | 'failed';

const STAGE_ORDER: Record<Stage, number> = {
  submitted: 0,
  queued: 1,
  assembling: 2,
  finalizing: 3,
  complete: 4,
  failed: 4,
};

const stageConfig: Record<Stage, { label: string; sub: string; icon: React.ReactNode }> = {
  submitted: {
    label: 'Export submitted',
    sub: 'Packaging your edit and sending to the server...',
    icon: <Package className="h-10 w-10 text-primary animate-pulse" />,
  },
  queued: {
    label: 'In the queue',
    sub: 'Waiting for an available server to start assembly...',
    icon: <Server className="h-10 w-10 text-primary animate-pulse" />,
  },
  assembling: {
    label: 'Assembling video...',
    sub: 'Stitching source footage and AI fills together',
    icon: <Loader2 className="h-10 w-10 animate-spin text-primary" />,
  },
  finalizing: {
    label: 'Finalizing...',
    sub: 'Encoding and preparing your download',
    icon: <Film className="h-10 w-10 text-primary animate-pulse" />,
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

const stageSteps: { stage: Stage; label: string }[] = [
  { stage: 'submitted', label: 'Submitted' },
  { stage: 'queued', label: 'Queued' },
  { stage: 'assembling', label: 'Assembling' },
  { stage: 'finalizing', label: 'Finalizing' },
  { stage: 'complete', label: 'Done' },
];

const ExportProgress = ({ projectId, onComplete, onRetry }: ExportProgressProps) => {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('submitted');
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const stageRef = useRef<Stage>('submitted');
  const progressRef = useRef(0);
  const startTimeRef = useRef(Date.now());

  // Elapsed time ticker
  useEffect(() => {
    if (stage === 'complete' || stage === 'failed') return;
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [stage]);

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  const advanceStage = useCallback((newStage: Stage, newProgress: number, error?: string) => {
    const current = stageRef.current;
    if (STAGE_ORDER[newStage] >= STAGE_ORDER[current] || newStage === 'failed') {
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

    if (jobType === 'video.export') {
      if (status === 'queued') {
        advanceStage('queued', 10);
      } else if (status === 'processing') {
        if (progressPct >= 90) {
          advanceStage('finalizing', 85 + Math.min((progressPct - 90) * 1.5, 14));
        } else if (progressPct > 0) {
          advanceStage('assembling', 15 + Math.min(progressPct * 0.75, 70));
        } else {
          advanceStage('assembling', 15);
        }
      } else if (status === 'complete') {
        advanceStage('complete', 100);
      } else if (status === 'failed') {
        advanceStage('failed', 0, (job.error_message as string) || 'Video export failed');
      }
    } else if (jobType === 'ai.fill') {
      // Legacy — shouldn't happen in new flow, but handle gracefully
      if (status === 'complete') {
        advanceStage('queued', 10);
      } else if (status === 'failed') {
        advanceStage('failed', 0, (job.error_message as string) || 'Processing failed');
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
      advanceStage('queued', 10);
    } else if (status === 'failed') {
      advanceStage('failed', 0, (proj.error_message as string) || 'Processing failed');
    } else if (status === 'exporting') {
      advanceStage('queued', 10);
    } else if (status === 'generating') {
      advanceStage('assembling', 15);
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

  // Animate initial "submitted" → "queued" transition
  useEffect(() => {
    const timer = setTimeout(() => {
      if (stageRef.current === 'submitted') {
        advanceStage('submitted', 5);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [advanceStage]);

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

    fetchCurrentState();

    return () => {
      supabase.removeChannel(jobChannel);
      supabase.removeChannel(projChannel);
    };
  }, [projectId, applyJobState, applyProjectState, fetchCurrentState]);

  // Polling safety net
  useEffect(() => {
    if (stage === 'complete' || stage === 'failed') return;
    const interval = setInterval(() => { fetchCurrentState(); }, 10_000);
    return () => clearInterval(interval);
  }, [stage, fetchCurrentState]);

  const config = stageConfig[stage];
  const currentStageIdx = stageSteps.findIndex((s) => s.stage === stage);

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
        <div className="w-full max-w-md space-y-3">
          <Progress value={progress} className="h-2" />
          <div className="flex items-center justify-between text-xs text-muted-foreground font-mono tabular-nums">
            <span>{Math.round(progress)}%</span>
            <span>{formatElapsed(elapsedSeconds)} elapsed</span>
          </div>

          {/* Step indicators */}
          <div className="flex items-center justify-between mt-4">
            {stageSteps.map((step, i) => {
              const stepIdx = i;
              const isActive = stepIdx === currentStageIdx;
              const isDone = stepIdx < currentStageIdx || stage === 'complete';
              return (
                <div key={step.stage} className="flex flex-col items-center gap-1 flex-1">
                  <div
                    className={`h-2 w-2 rounded-full transition-all duration-300 ${
                      isDone
                        ? 'bg-primary scale-100'
                        : isActive
                          ? 'bg-primary scale-125 animate-pulse'
                          : 'bg-muted'
                    }`}
                  />
                  <span
                    className={`text-[9px] transition-colors ${
                      isDone || isActive ? 'text-foreground font-medium' : 'text-muted-foreground'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
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
