import { useEffect, useRef } from 'react';
import { useEditorStore, DEFAULT_AI_FILL_MODEL, MODEL_CREDITS_PER_SEC, type AiFill } from '@/stores/editorStore';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Hook that manages single-fill preview generation.
 * Enforces one-at-a-time via `previewGeneratingCutId` in the store.
 */
export function usePreviewFill() {
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Cleanup realtime channel on unmount
  useEffect(() => {
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, []);

  const generatePreview = async (cutId: string) => {
    const state = useEditorStore.getState();

    // Guard: one at a time
    if (state.previewGeneratingCutId) {
      toast.warning('A preview is already generating — please wait');
      return;
    }

    // Read fill config
    const duration = state.fillDurations.get(cutId);
    if (!duration || duration <= 0) {
      toast.error('Set a fill duration first');
      return;
    }

    const model = state.fillModels.get(cutId) ?? DEFAULT_AI_FILL_MODEL;
    const project = state.project;
    if (!project) {
      toast.error('No project loaded');
      return;
    }

    // Find the cut
    const allCuts = [
      ...state.cuts.map((c) => ({ id: c.id, start: c.start, end: c.end, type: c.type })),
      ...state.manualCuts.map((c) => ({ id: c.id, start: c.start, end: c.end, type: 'manual' })),
    ];
    const cut = allCuts.find((c) => c.id === cutId);
    if (!cut) {
      toast.error('Cut not found');
      return;
    }

    // Check credits
    const cost = duration * MODEL_CREDITS_PER_SEC[model];
    if (cost > state.creditBalance.total) {
      toast.error('Insufficient credits for preview');
      return;
    }

    try {
      // 1. Create minimal edit decision with single-entry EDL
      const edlJson = [{
        start: cut.start,
        end: cut.end,
        type: cut.type,
        fill_duration: duration,
        model,
      }];

      const { data: editDecision, error: edError } = await supabase
        .from('edit_decisions')
        .insert({
          project_id: project.id,
          edl_json: edlJson,
          total_fill_seconds: duration,
          credits_charged: cost,
          status: 'pending',
        })
        .select('id')
        .single();

      if (edError || !editDecision) throw edError || new Error('Failed to create edit decision');

      // 2. Create job queue entry with preview flag
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: jobRow, error: jobError } = await supabase
        .from('job_queue')
        .insert({
          project_id: project.id,
          user_id: user.id,
          type: 'ai.fill',
          payload: { edit_decision_id: editDecision.id, preview: true },
          priority: 5,
        })
        .select('id')
        .single();

      if (jobError || !jobRow) throw jobError || new Error('Failed to enqueue job');

      // 3. Update store
      useEditorStore.getState().startPreviewGeneration(cutId, jobRow.id);
      toast.info('Generating fill preview...');

      // 4. Subscribe to job completion via realtime
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }

      const channel = supabase
        .channel(`preview-job-${jobRow.id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'job_queue',
            filter: `id=eq.${jobRow.id}`,
          },
          async (payload) => {
            const updated = payload.new as Record<string, unknown>;
            const status = updated.status as string;

            if (status === 'complete') {
              await handlePreviewComplete(editDecision.id, cut.end, duration, user.id);
              cleanup();
            } else if (status === 'failed') {
              const msg = (updated.error_message as string) || 'Fill generation failed';
              toast.error(msg);
              useEditorStore.getState().clearPreviewGeneration();
              cleanup();
            }
          },
        )
        .subscribe();

      channelRef.current = channel;

      // 5. Invoke edge function (fire-and-forget)
      supabase.functions.invoke('process-ai-fill', {
        body: { job_id: jobRow.id },
      }).then(({ error: invokeError }) => {
        if (invokeError) {
          console.error('Failed to invoke process-ai-fill for preview:', invokeError);
          toast.error('Preview generation failed to start');
          useEditorStore.getState().clearPreviewGeneration();
          cleanup();
        }
      });
    } catch (err: any) {
      console.error('Preview generation error:', err);
      toast.error('Failed to start preview generation');
      useEditorStore.getState().clearPreviewGeneration();
    }
  };

  function cleanup() {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }

  return { generatePreview };
}

async function handlePreviewComplete(
  editDecisionId: string,
  cutEndTime: number,
  duration: number,
  userId: string,
) {
  try {
    // Fetch the generated ai_fill
    const { data: fills } = await supabase
      .from('ai_fills')
      .select('*')
      .eq('edit_decision_id', editDecisionId);

    if (fills && fills.length > 0) {
      const f = fills[0];
      const { data: video } = await supabase
        .from('videos')
        .select('proxy_s3_key, s3_key')
        .eq('project_id', useEditorStore.getState().project?.id ?? '')
        .single();

      const fill: AiFill = {
        id: f.id,
        editDecisionId: f.edit_decision_id,
        gapIndex: f.gap_index,
        startTime: cutEndTime,
        duration: f.duration ?? duration,
        s3Key: f.provider === 'mock' ? (video?.proxy_s3_key || video?.s3_key || f.s3_key) : f.s3_key,
        provider: f.provider,
        qualityScore: f.quality_score,
        method: f.method,
      };

      const store = useEditorStore.getState();
      // Append to aiFills (replace any existing fill at same startTime)
      const existing = store.aiFills.filter(
        (existing) => Math.abs(existing.startTime - cutEndTime) >= 0.5,
      );
      useEditorStore.setState({
        aiFills: [...existing, fill],
        selectedFill: fill,
      });

      toast.success('Fill preview ready');
    }

    // Refresh credit balance
    const { data: ledger } = await supabase
      .from('credit_ledger')
      .select('credits_remaining, type')
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString());

    if (ledger) {
      let monthly = 0, topup = 0;
      for (const entry of ledger) {
        if (entry.type === 'monthly_allowance') monthly += entry.credits_remaining;
        else topup += entry.credits_remaining;
      }
      useEditorStore.getState().setCreditBalance({ total: monthly + topup, monthly, topup });
    }
  } finally {
    useEditorStore.getState().clearPreviewGeneration();
  }
}
