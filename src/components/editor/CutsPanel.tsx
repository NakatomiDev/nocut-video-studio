// @refresh reset
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEditorStore, AI_FILL_MODELS, MODEL_CREDITS_PER_SEC, DEFAULT_AI_FILL_MODEL, getAvailableModels, getModelDurations, getFillsForCut, type AiFill, type AiFillModel } from '@/stores/editorStore';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, AlertTriangle, Sparkles, CheckCircle2, Eye, RefreshCw, Loader2, ChevronRight, Plus, Minus } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import CutThumbnail from './CutThumbnail';
import ExactVideoFrame from './ExactVideoFrame';
import { usePreviewFill } from '@/hooks/usePreviewFill';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const formatTimestamp = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${parseFloat(sec) < 10 ? '0' : ''}${sec}`;
};

const typeBadgeClass: Record<string, string> = {
  silence: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  filler: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  retake: 'bg-red-500/20 text-red-400 border-red-500/30',
};

interface CutsPanelProps {
  thumbnailSpriteUrl?: string | null;
  videoUrl?: string | null;
  duration: number;
}

const CutsPanel = ({ thumbnailSpriteUrl, videoUrl, duration }: CutsPanelProps) => {
  const navigate = useNavigate();
  const {
    cuts,
    activeCuts,
    toggleCut,
    manualCuts,
    activeManualCuts,
    toggleManualCut,
    removeManualCut,
    fillDurations,
    setFillDuration,
    fillModels,
    setFillModel,
    creditEstimate,
    creditBalance,
    setCreditBalance,
    setPlayhead,
    project,
    aiFills,
    selectFill,
    insertFill,
    removeFill,
    insertedFills,
    previewGeneratingCutId,
  } = useEditorStore();

  const { generatePreview } = usePreviewFill();
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [userTier, setUserTier] = useState<string>('free');
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ time: number; label: string } | null>(null);
  const [expandedFillsCuts, setExpandedFillsCuts] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchBalance = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: userData } = await supabase
        .from('users')
        .select('tier')
        .eq('id', user.id)
        .single();
      if (userData) setUserTier(userData.tier);

      const { data } = await supabase
        .from('credit_ledger')
        .select('credits_remaining, type')
        .eq('user_id', user.id)
        .gt('expires_at', new Date().toISOString());

      if (data) {
        let monthly = 0, topup = 0;
        for (const entry of data) {
          if (entry.type === 'monthly_allowance') monthly += entry.credits_remaining;
          else topup += entry.credits_remaining;
        }
        setCreditBalance({ total: monthly + topup, monthly, topup });
      }
    };
    fetchBalance();
  }, [setCreditBalance]);

  const availableModels = getAvailableModels(userTier);

  const hasActiveCuts = activeCuts.size > 0 || activeManualCuts.size > 0;
  const insufficientCredits = creditEstimate > creditBalance.total;
  const creditsAfterExport = creditBalance.total - creditEstimate;
  const cutsWithFills = fillDurations.size;

  const handleExport = useCallback(async () => {
    if (!project) return;
    setExporting(true);
    try {
      const activeCutsList = cuts.filter((c) => activeCuts.has(c.id));
      const activeManualList = manualCuts.filter((c) => activeManualCuts.has(c.id));
      const allCuts = [
        ...activeCutsList.map((c) => ({
          start: c.start,
          end: c.end,
          type: c.type,
          fill_duration: fillDurations.get(c.id) || 0,
          model: fillModels.get(c.id) ?? DEFAULT_AI_FILL_MODEL,
        })),
        ...activeManualList.map((c) => ({
          start: c.start,
          end: c.end,
          type: 'manual',
          fill_duration: fillDurations.get(c.id) || 0,
          model: fillModels.get(c.id) ?? DEFAULT_AI_FILL_MODEL,
        })),
      ].sort((a, b) => a.start - b.start);

      const totalFill = allCuts.reduce((s, c) => s + c.fill_duration, 0);

      // Build gaps array for the project-edl edge function
      const gaps = allCuts.map((c) => ({
        pre_cut_timestamp: c.start,
        post_cut_timestamp: c.end,
        fill_duration: c.fill_duration,
        model: c.model,
        type: c.type,
      }));

      // Call project-edl: handles credit deduction, edit_decisions, and job_queue server-side
      const { data: edlData, error: edlError } = await supabase.functions.invoke('project-edl', {
        body: { project_id: project.id, gaps },
      });

      if (edlError) throw edlError;

      const response = edlData?.data ?? edlData;
      if (!response?.edit_decision_id) {
        throw new Error('Invalid response from project-edl');
      }

      setShowExportDialog(false);
      navigate(`/project/${project.id}?exporting=true`);
      toast.success(
        totalFill > 0
          ? `Export submitted — generating ${totalFill}s of AI fill`
          : 'Export submitted — processing your edits'
      );

      // Invoke process-ai-fill to start generation (fire-and-forget)
      supabase.functions.invoke('process-ai-fill', {
        body: { job_id: response.job_id },
      }).then(({ error: invokeError }) => {
        if (invokeError) {
          console.error('Failed to invoke process-ai-fill:', invokeError);
          toast.error('AI fill processing failed to start');
        }
      });
    } catch (err: any) {
      console.error('Export failed:', err);
      toast.error('Export failed — please try again');
    } finally {
      setExporting(false);
    }
  }, [project, cuts, activeCuts, manualCuts, activeManualCuts, fillDurations, fillModels, creditEstimate]);

  const renderFillSelector = (cutId: string) => {
    const currentFill = fillDurations.get(cutId) || 0;
    const currentModel = fillModels.get(cutId) ?? DEFAULT_AI_FILL_MODEL;
    const creditsPerSec = MODEL_CREDITS_PER_SEC[currentModel];
    const modelDurations = getModelDurations(currentModel, userTier);
    const modelConfig = AI_FILL_MODELS.find((m) => m.id === currentModel);
    // Check if this cut already has a generated AI fill
    const allCutsArr = [...cuts, ...manualCuts.map((c) => ({ ...c, type: 'manual' }))];
    const cutObj = allCutsArr.find((c) => c.id === cutId);
    const cutFills = cutObj ? getFillsForCut(cutObj, aiFills) : [];
    const generatedFill = cutFills[0] ?? null;

    return (
      <div className="flex flex-col gap-1.5 pl-3 pr-1 mt-1 overflow-hidden">
        {/* Model selector — stacked layout to prevent overflow */}
        <div className="flex items-center gap-1.5 min-w-0">
          {generatedFill ? (
            <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
          ) : (
            <Sparkles className="h-3 w-3 text-primary shrink-0" />
          )}
          <span className="text-[10px] text-muted-foreground shrink-0">Model:</span>
          <Select
            value={currentModel}
            onValueChange={(val) => {
              const newModel = val as AiFillModel;
              setFillModel(cutId, newModel);
              const newDurations = getModelDurations(newModel, userTier);
              if (currentFill > 0 && !newDurations.includes(currentFill)) {
                setFillDuration(cutId, newDurations[0] ?? 0);
              }
            }}
          >
            <SelectTrigger
              className="h-6 min-w-0 flex-1 text-[10px] px-2 truncate"
              onClick={(e) => e.stopPropagation()}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label} ({m.creditsPerSec}cr/s){m.audio ? ' 🔊' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {generatedFill && (
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[9px] shrink-0">
              ✓
            </Badge>
          )}
        </div>
        {/* Duration selector */}
        <div className="flex items-center gap-1.5 pl-4 min-w-0">
          <span className="text-[10px] text-muted-foreground shrink-0">Duration:</span>
          <Select
            value={currentFill > 0 ? String(currentFill) : 'none'}
            onValueChange={(val) => {
              setFillDuration(cutId, val === 'none' ? 0 : Number(val));
            }}
          >
            <SelectTrigger
              className="h-6 min-w-0 flex-1 text-[10px] px-2"
              onClick={(e) => e.stopPropagation()}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None (free)</SelectItem>
              {modelDurations.map((sec) => {
                const credits = sec * creditsPerSec;
                return (
                  <SelectItem key={sec} value={String(sec)}>
                    {sec}s ({credits} credit{credits > 1 ? 's' : ''})
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {modelConfig && !modelConfig.audio && (
            <span className="text-[9px] text-muted-foreground shrink-0">Silent</span>
          )}
        </div>
        {/* Preview fill button */}
        {currentFill > 0 && (
          <div className="flex items-center gap-1.5 pl-4 flex-wrap">
            {generatedFill ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  onClick={(e) => { e.stopPropagation(); selectFill(generatedFill); }}
                >
                  <Eye className="h-3 w-3 mr-1" /> View
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  disabled={!!previewGeneratingCutId}
                  onClick={(e) => { e.stopPropagation(); generatePreview(cutId); }}
                >
                  <RefreshCw className="h-3 w-3 mr-1" /> Redo
                </Button>
              </>
            ) : previewGeneratingCutId === cutId ? (
              <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" disabled>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Generating...
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2"
                disabled={!!previewGeneratingCutId}
                onClick={(e) => { e.stopPropagation(); generatePreview(cutId); }}
              >
                <Eye className="h-3 w-3 mr-1" /> Preview
              </Button>
            )}
          </div>
        )}
      </div>
    );
  };

  const handleFrameClick = (time: number, label: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPlayhead(time);
    setLightbox({ time, label });
  };

  const renderPreview = (start: number, end: number) => (
    <div className="flex items-center gap-1 pl-2 pr-1 overflow-hidden">
      <button
        className="flex flex-col items-center gap-0.5 shrink-0 min-w-0 cursor-zoom-in hover:opacity-80 transition-opacity rounded focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 ring-offset-background"
        onClick={(e) => handleFrameClick(start, `Start frame · ${formatTimestamp(start)}`, e)}
      >
        {thumbnailSpriteUrl ? (
          <CutThumbnail spriteUrl={thumbnailSpriteUrl} time={start} duration={duration} width={48} height={28} />
        ) : videoUrl ? (
          <ExactVideoFrame
            videoUrl={videoUrl}
            time={start}
            label={`Start frame ${formatTimestamp(start)}`}
            className="h-7 w-12"
          />
        ) : null}
        <span className="text-[9px] text-muted-foreground font-mono">Start</span>
      </button>
      <div className="flex-1 border-t border-dashed border-muted-foreground/30 min-w-1" />
      <button
        className="flex flex-col items-center gap-0.5 shrink-0 min-w-0 cursor-zoom-in hover:opacity-80 transition-opacity rounded focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 ring-offset-background"
        onClick={(e) => handleFrameClick(end, `End frame · ${formatTimestamp(end)}`, e)}
      >
        {thumbnailSpriteUrl ? (
          <CutThumbnail spriteUrl={thumbnailSpriteUrl} time={end} duration={duration} width={48} height={28} />
        ) : videoUrl ? (
          <ExactVideoFrame
            videoUrl={videoUrl}
            time={end}
            label={`End frame ${formatTimestamp(end)}`}
            className="h-7 w-12"
          />
        ) : null}
        <span className="text-[9px] text-muted-foreground font-mono">End</span>
      </button>
    </div>
  );

  const renderFillsList = (cutId: string) => {
    const allCutsArr = [...cuts, ...manualCuts.map((c) => ({ ...c, type: 'manual' }))];
    const cutObj = allCutsArr.find((c) => c.id === cutId);
    if (!cutObj) return null;
    const fills = getFillsForCut(cutObj, aiFills);
    if (fills.length === 0) return null;

    const isOpen = expandedFillsCuts.has(cutId);
    const toggleOpen = () => {
      setExpandedFillsCuts((prev) => {
        const next = new Set(prev);
        if (next.has(cutId)) next.delete(cutId);
        else next.add(cutId);
        return next;
      });
    };

    return (
      <Collapsible open={isOpen} onOpenChange={toggleOpen}>
        <CollapsibleTrigger
          className="flex items-center gap-1.5 pl-5 mt-1.5 text-[10px] font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <ChevronRight className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          <Sparkles className="h-3 w-3" />
          AI Fills ({fills.length})
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-1 pl-7 mt-1">
            {fills.map((fill) => {
              const isInserted = insertedFills.has(fill.id);
              const hasVideo = !!fill.s3Key;
              return (
                <div
                  key={fill.id}
                  className={`flex items-center gap-1.5 rounded px-2 py-1 text-[10px] transition-colors ${
                    isInserted ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-secondary/50'
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[9px] shrink-0">
                    {fill.duration}s
                  </Badge>
                  <span className="text-muted-foreground truncate flex-1">
                    {fill.method || fill.provider || 'AI Fill'}
                  </span>
                  {fill.qualityScore !== null && (
                    <span className="text-[9px] text-muted-foreground shrink-0">
                      {Math.round(fill.qualityScore * 100)}%
                    </span>
                  )}
                  {hasVideo ? (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0"
                        onClick={() => selectFill(fill)}
                      >
                        <Eye className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-5 w-5 shrink-0 ${isInserted ? 'text-emerald-400' : 'text-muted-foreground'}`}
                        onClick={() => isInserted ? removeFill(fill.id) : insertFill(fill.id)}
                      >
                        {isInserted ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                      </Button>
                    </>
                  ) : (
                    <span className="text-[9px] text-muted-foreground animate-pulse">Generating...</span>
                  )}
                </div>
              );
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <div className="flex h-full flex-col border-l border-border bg-card overflow-hidden">
      <div className="border-b border-border p-4 shrink-0">
        <h3 className="text-sm font-semibold text-foreground">Cuts</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {cuts.length + manualCuts.length} total · {activeCuts.size + activeManualCuts.size} active
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          Cuts are free · AI fill cost depends on model selected
        </p>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-1 p-2">
          <div className="px-3 pb-1 pt-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Detected Pauses ({cuts.length})
            </span>
          </div>
          {cuts.length === 0 && (
            <div className="p-3 text-center text-xs text-muted-foreground space-y-1">
              <p>No pauses detected.</p>
              <p>You can still add manual cuts using the razor tool on the timeline.</p>
            </div>
          )}
          {cuts.map((cut) => (
            <div
              key={cut.id}
              className="flex flex-col gap-2 rounded-md p-3 transition-colors hover:bg-secondary/50 cursor-pointer overflow-hidden"
              onClick={() => setPlayhead(cut.start)}
            >
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                <Switch
                  checked={activeCuts.has(cut.id)}
                  onCheckedChange={() => toggleCut(cut.id)}
                  onClick={(e) => e.stopPropagation()}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={typeBadgeClass[cut.type] || 'border-border text-muted-foreground'}
                    >
                      {cut.type}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{cut.duration.toFixed(1)}s</span>
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {formatTimestamp(cut.start)} → {formatTimestamp(cut.end)}
                  </p>
                </div>
              </div>
              {activeCuts.has(cut.id) && (
                <>
                  {thumbnailSpriteUrl && renderPreview(cut.start, cut.end)}
                  {renderFillSelector(cut.id)}
                  {renderFillsList(cut.id)}
                </>
              )}
            </div>
          ))}

          <div className="px-3 pb-1 pt-4">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Manual Cuts ({manualCuts.length})
            </span>
          </div>
          {manualCuts.length === 0 && (
            <p className="p-3 text-center text-xs text-muted-foreground">Use the razor tool to add cuts</p>
          )}
          {manualCuts.map((cut) => (
            <div
              key={cut.id}
              className="flex flex-col gap-2 rounded-md p-3 transition-colors hover:bg-secondary/50 cursor-pointer overflow-hidden"
              onClick={() => setPlayhead(cut.start)}
            >
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                <Switch
                  checked={activeManualCuts.has(cut.id)}
                  onCheckedChange={() => toggleManualCut(cut.id)}
                  onClick={(e) => e.stopPropagation()}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-border text-foreground bg-secondary">
                      manual
                    </Badge>
                    <span className="text-xs text-muted-foreground">{cut.duration.toFixed(1)}s</span>
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {formatTimestamp(cut.start)} → {formatTimestamp(cut.end)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeManualCut(cut.id);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
              {activeManualCuts.has(cut.id) && (
                <>
                  {(thumbnailSpriteUrl || videoUrl) && renderPreview(cut.start, cut.end)}
                  {renderFillSelector(cut.id)}
                  {renderFillsList(cut.id)}
                </>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="space-y-3 border-t border-border p-4 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Active cuts</span>
          <span className="text-sm font-semibold text-foreground">
            {activeCuts.size + activeManualCuts.size} (free)
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">AI fills</span>
          <span className="text-sm font-semibold text-foreground">
            {cutsWithFills > 0 ? `${creditEstimate} credit${creditEstimate !== 1 ? 's' : ''}` : 'None'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Your balance</span>
          <span className="text-sm font-semibold text-foreground">{creditBalance.total} credits</span>
        </div>
        {insufficientCredits && (
          <div className="flex items-center gap-1.5 text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">Insufficient credits for AI fills</span>
          </div>
        )}
        <Button
          className="w-full"
          disabled={!hasActiveCuts || insufficientCredits || !!previewGeneratingCutId}
          onClick={() => setShowExportDialog(true)}
        >
          {creditEstimate > 0 ? `Export (${creditEstimate} credits)` : 'Export (free)'}
        </Button>
      </div>

      <Dialog open={showExportDialog} onOpenChange={(open) => { setShowExportDialog(open); if (!open) setExpandedReviewId(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Review Edits</DialogTitle>
            <DialogDescription>
              {creditEstimate > 0
                ? `${creditEstimate} credit${creditEstimate !== 1 ? 's' : ''} for AI fills · Click any edit to preview`
                : 'All cuts are free — click any edit to preview'}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 -mx-6 px-6">
            <div className="space-y-2 max-h-[45vh]">
              {(() => {
                const activeCutsList = cuts.filter((c) => activeCuts.has(c.id));
                const activeManualList = manualCuts.filter((c) => activeManualCuts.has(c.id));
                const aiFills = useEditorStore.getState().aiFills;
                const allEdits = [
                  ...activeCutsList.map((c) => {
                    const fill = fillDurations.get(c.id) || 0;
                    const model = fillModels.get(c.id) ?? DEFAULT_AI_FILL_MODEL;
                    const modelConfig = AI_FILL_MODELS.find((m) => m.id === model);
                    const existingFill = getFillsForCut(c, aiFills)[0] ?? null;
                    return { id: c.id, start: c.start, end: c.end, duration: c.duration, type: c.type, fill, model, modelLabel: modelConfig?.label ?? model, existingFill };
                  }),
                  ...activeManualList.map((c) => {
                    const fill = fillDurations.get(c.id) || 0;
                    const model = fillModels.get(c.id) ?? DEFAULT_AI_FILL_MODEL;
                    const modelConfig = AI_FILL_MODELS.find((m) => m.id === model);
                    const existingFill = getFillsForCut(c, aiFills)[0] ?? null;
                    return { id: c.id, start: c.start, end: c.end, duration: c.duration, type: 'manual' as string, fill, model, modelLabel: modelConfig?.label ?? model, existingFill };
                  }),
                ].sort((a, b) => a.start - b.start);

                return allEdits.map((edit, idx) => {
                  const isExpanded = expandedReviewId === edit.id;
                  return (
                    <div
                      key={edit.id}
                      className={`rounded-lg border transition-colors cursor-pointer ${
                        isExpanded ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'
                      }`}
                      onClick={() => setExpandedReviewId(isExpanded ? null : edit.id)}
                    >
                      <div className="flex items-center gap-3 p-3">
                        <span className="text-[10px] font-mono text-muted-foreground w-5 text-center">{idx + 1}</span>
                        <Badge
                          variant="outline"
                          className={
                            edit.type === 'manual'
                              ? 'border-border text-foreground bg-secondary'
                              : typeBadgeClass[edit.type] || 'border-border text-muted-foreground'
                          }
                        >
                          {edit.type}
                        </Badge>
                        <span className="font-mono text-xs text-muted-foreground flex-1">
                          {formatTimestamp(edit.start)} → {formatTimestamp(edit.end)}
                        </span>
                        <span className="text-xs text-muted-foreground">{edit.duration.toFixed(1)}s</span>
                        {edit.fill > 0 ? (
                          <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px]">
                            <Sparkles className="h-2.5 w-2.5 mr-1" />
                            {edit.fill}s fill
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                            cut only
                          </Badge>
                        )}
                      </div>

                      {isExpanded && (videoUrl || thumbnailSpriteUrl) && (
                        <div className="px-3 pb-3 pt-1 border-t border-border/50">
                          <div className="flex items-stretch gap-3">
                            <div className="flex flex-col items-center gap-1 flex-1">
                              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Before cut</span>
                              <button
                                className="rounded ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 hover:opacity-80 transition-opacity cursor-zoom-in"
                                onClick={(e) => { e.stopPropagation(); setLightbox({ time: edit.start, label: `Before cut · ${formatTimestamp(edit.start)}` }); }}
                              >
                                {thumbnailSpriteUrl ? (
                                  <CutThumbnail spriteUrl={thumbnailSpriteUrl} time={edit.start} duration={duration} width={180} height={100} />
                                ) : videoUrl ? (
                                  <ExactVideoFrame
                                    videoUrl={videoUrl}
                                    time={edit.start}
                                    label={`Before cut ${formatTimestamp(edit.start)}`}
                                    className="h-[100px] w-[180px]"
                                  />
                                ) : null}
                              </button>
                              <span className="text-[10px] font-mono text-muted-foreground">{formatTimestamp(edit.start)}</span>
                            </div>
                            <div className="flex flex-col items-center justify-center gap-1">
                              <div className="h-px w-8 bg-muted-foreground/30" />
                              {edit.fill > 0 && (
                                <span className="text-[9px] text-primary font-medium">{edit.fill}s AI fill</span>
                              )}
                              <div className="h-px w-8 bg-muted-foreground/30" />
                            </div>
                            <div className="flex flex-col items-center gap-1 flex-1">
                              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">After cut</span>
                              <button
                                className="rounded ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 hover:opacity-80 transition-opacity cursor-zoom-in"
                                onClick={(e) => { e.stopPropagation(); setLightbox({ time: edit.end, label: `After cut · ${formatTimestamp(edit.end)}` }); }}
                              >
                                {thumbnailSpriteUrl ? (
                                  <CutThumbnail spriteUrl={thumbnailSpriteUrl} time={edit.end} duration={duration} width={180} height={100} />
                                ) : videoUrl ? (
                                  <ExactVideoFrame
                                    videoUrl={videoUrl}
                                    time={edit.end}
                                    label={`After cut ${formatTimestamp(edit.end)}`}
                                    className="h-[100px] w-[180px]"
                                  />
                                ) : null}
                              </button>
                              <span className="text-[10px] font-mono text-muted-foreground">{formatTimestamp(edit.end)}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </ScrollArea>

          <div className="space-y-2 text-sm border-t border-border pt-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cuts (removal)</span>
              <span className="font-semibold">{activeCuts.size + activeManualCuts.size} — Free</span>
            </div>
            {creditEstimate > 0 && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">AI fill transitions</span>
                  <span className="font-semibold">{creditEstimate} credits</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Balance after export</span>
                  <span className="font-semibold">{creditsAfterExport}</span>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowExportDialog(false)}>Cancel</Button>
            <Button onClick={handleExport} disabled={exporting}>
              {exporting ? 'Exporting...' : 'Confirm & Export'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lightbox for zoomed frame */}
      <Dialog open={!!lightbox} onOpenChange={(open) => { if (!open) setLightbox(null); }}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden bg-black/95 border-border">
          <DialogHeader className="p-4 pb-2">
            <DialogTitle className="text-sm text-foreground">{lightbox?.label}</DialogTitle>
            <DialogDescription className="sr-only">Full resolution frame preview</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center p-4 pt-0">
            {lightbox && (videoUrl ? (
              <ExactVideoFrame
                videoUrl={videoUrl}
                time={lightbox.time}
                label={lightbox.label}
                className="aspect-video w-full max-w-[min(80vw,960px)]"
              />
            ) : (
              <CutThumbnail spriteUrl={thumbnailSpriteUrl} time={lightbox.time} duration={duration} width={560} height={315} />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CutsPanel;
