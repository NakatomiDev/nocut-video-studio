import { useEffect, useRef } from 'react';
import { useEditorStore, DEFAULT_AI_FILL_MODEL, type AiFill } from '@/stores/editorStore';
import { resolvePrompt, resolveAudioPrompt } from '@/constants/fillPrompts';
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
    const prompt = resolvePrompt(state.fillPrompts.get(cutId));
    const audioPrompt = resolveAudioPrompt(state.audioPrompts.get(cutId));
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

    try {
      // 1. Call preview-fill edge function (handles credits, edit_decisions, job_queue server-side)
      const { data: pfData, error: pfError } = await supabase.functions.invoke('preview-fill', {
        body: {
          project_id: project.id,
          start: cut.start,
          end: cut.end,
          type: cut.type,
          fill_duration: duration,
          model,
          ...(prompt ? { prompt } : {}),
          ...(audioPrompt ? { audio_prompt: audioPrompt } : {}),
        },
      });

      if (pfError) throw pfError;

      const response = pfData?.data ?? pfData;
      if (!response?.job_id || !response?.edit_decision_id) {
        throw new Error('Invalid response from preview-fill');
      }

      const { job_id, edit_decision_id } = response as { job_id: string; edit_decision_id: string };

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // 2. Update store
      useEditorStore.getState().startPreviewGeneration(cutId, job_id);
      toast.info('Generating fill preview...');

      // 3. Subscribe to job completion via realtime
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }

      const channel = supabase
        .channel(`preview-job-${job_id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'job_queue',
            filter: `id=eq.${job_id}`,
          },
          async (payload) => {
            const updated = payload.new as Record<string, unknown>;
            const status = updated.status as string;

            if (status === 'complete') {
              await handlePreviewComplete(edit_decision_id, cut.end, duration, user.id);
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

      // 4. Invoke process-ai-fill to start generation (fire-and-forget)
      supabase.functions.invoke('process-ai-fill', {
        body: { job_id },
      }).then(async ({ data, error: invokeError }) => {
        if (invokeError) {
          // Try to extract user-friendly message from the response
          let msg = 'Preview generation failed';
          try {
            const context = invokeError?.context;
            if (context && typeof context === 'object' && 'json' in context) {
              const body = await (context as Response).json();
              msg = body?.error?.message || msg;
            }
          } catch { /* ignore parse errors */ }

          // Check if it was a safety filter issue
          if (msg.includes('returned no video URI') || msg.includes('safety filter')) {
            msg = 'AI generation was blocked by safety filters. Your credits have been refunded. Please try a different prompt or clip.';
          }

          console.error('Failed to invoke process-ai-fill for preview:', invokeError);
          toast.error(msg);
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
        s3Key: f.s3_key,
        provider: f.provider,
        qualityScore: f.quality_score,
        method: f.method,
      };

      const store = useEditorStore.getState();
      // Append new fill alongside existing fills (never remove old ones)
      useEditorStore.setState({
        aiFills: [...store.aiFills, fill],
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
