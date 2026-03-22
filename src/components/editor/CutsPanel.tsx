import { useState, useEffect, useCallback } from 'react';
import { useEditorStore, FILL_DURATION_OPTIONS, BUSINESS_FILL_DURATION_OPTIONS } from '@/stores/editorStore';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, AlertTriangle, Sparkles } from 'lucide-react';
import CutThumbnail from './CutThumbnail';
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
  duration: number;
}

const CutsPanel = ({ thumbnailSpriteUrl, duration }: CutsPanelProps) => {
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
    creditEstimate,
    creditBalance,
    setCreditBalance,
    setPlayhead,
    project,
  } = useEditorStore();

  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [userTier, setUserTier] = useState<string>('free');
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ time: number; label: string } | null>(null);

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

  const fillOptions = userTier === 'business'
    ? BUSINESS_FILL_DURATION_OPTIONS
    : FILL_DURATION_OPTIONS;

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
        })),
        ...activeManualList.map((c) => ({
          start: c.start,
          end: c.end,
          type: 'manual',
          fill_duration: fillDurations.get(c.id) || 0,
        })),
      ].sort((a, b) => a.start - b.start);

      const totalFill = allCuts.reduce((s, c) => s + c.fill_duration, 0);

      const { error } = await supabase.from('edit_decisions').insert({
        project_id: project.id,
        edl_json: allCuts,
        total_fill_seconds: totalFill,
        credits_charged: creditEstimate,
        status: 'pending',
      });

      if (error) throw error;
      setShowExportDialog(false);
    } catch (err: any) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [project, cuts, activeCuts, manualCuts, activeManualCuts, fillDurations, creditEstimate]);

  const renderFillSelector = (cutId: string) => {
    const currentFill = fillDurations.get(cutId) || 0;
    return (
      <div className="flex items-center gap-2 pl-5 mt-1">
        <Sparkles className="h-3 w-3 text-primary shrink-0" />
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">AI Fill:</span>
        <Select
          value={currentFill > 0 ? String(currentFill) : 'none'}
          onValueChange={(val) => {
            setFillDuration(cutId, val === 'none' ? 0 : Number(val));
          }}
        >
          <SelectTrigger
            className="h-6 w-[100px] text-[10px] px-2"
            onClick={(e) => e.stopPropagation()}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None (free)</SelectItem>
            {fillOptions.map((sec) => (
              <SelectItem key={sec} value={String(sec)}>
                {sec}s ({sec} credit{sec > 1 ? 's' : ''})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  const renderPreview = (start: number, end: number) => (
    <div className="flex items-center gap-2 pl-5">
      <div className="flex flex-col items-center gap-0.5">
        <CutThumbnail spriteUrl={thumbnailSpriteUrl} time={start} duration={duration} width={72} height={40} />
        <span className="text-[9px] text-muted-foreground font-mono">Start</span>
      </div>
      <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
      <div className="flex flex-col items-center gap-0.5">
        <CutThumbnail spriteUrl={thumbnailSpriteUrl} time={end} duration={duration} width={72} height={40} />
        <span className="text-[9px] text-muted-foreground font-mono">End</span>
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col border-l border-border bg-card">
      <div className="border-b border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">Cuts</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {cuts.length + manualCuts.length} total · {activeCuts.size + activeManualCuts.size} active
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          Cuts are free · AI fills cost 1 credit/sec
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-1 p-2">
          <div className="px-3 pb-1 pt-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Detected Pauses ({cuts.length})
            </span>
          </div>
          {cuts.length === 0 && (
            <p className="p-3 text-center text-xs text-muted-foreground">No pauses detected</p>
          )}
          {cuts.map((cut) => (
            <div
              key={cut.id}
              className="flex flex-col gap-2 rounded-md p-3 transition-colors hover:bg-secondary/50 cursor-pointer"
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
              className="flex flex-col gap-2 rounded-md p-3 transition-colors hover:bg-secondary/50 cursor-pointer"
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
                  {thumbnailSpriteUrl && renderPreview(cut.start, cut.end)}
                  {renderFillSelector(cut.id)}
                </>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="space-y-3 border-t border-border p-4">
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
          disabled={!hasActiveCuts || insufficientCredits}
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
                const allEdits = [
                  ...activeCutsList.map((c) => ({ id: c.id, start: c.start, end: c.end, duration: c.duration, type: c.type, fill: fillDurations.get(c.id) || 0 })),
                  ...activeManualList.map((c) => ({ id: c.id, start: c.start, end: c.end, duration: c.duration, type: 'manual' as string, fill: fillDurations.get(c.id) || 0 })),
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

                      {isExpanded && thumbnailSpriteUrl && (
                        <div className="px-3 pb-3 pt-1 border-t border-border/50">
                          <div className="flex items-stretch gap-3">
                            <div className="flex flex-col items-center gap-1 flex-1">
                              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Before cut</span>
                              <button
                                className="rounded ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 hover:opacity-80 transition-opacity cursor-zoom-in"
                                onClick={(e) => { e.stopPropagation(); setLightbox({ time: edit.start, label: `Before cut · ${formatTimestamp(edit.start)}` }); }}
                              >
                                <CutThumbnail spriteUrl={thumbnailSpriteUrl} time={edit.start} duration={duration} width={180} height={100} />
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
                                <CutThumbnail spriteUrl={thumbnailSpriteUrl} time={edit.end} duration={duration} width={180} height={100} />
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

      {/* Lightbox for zoomed thumbnail */}
      <Dialog open={!!lightbox} onOpenChange={(open) => { if (!open) setLightbox(null); }}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden bg-black/95 border-border">
          <DialogHeader className="p-4 pb-2">
            <DialogTitle className="text-sm text-foreground">{lightbox?.label}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center p-4 pt-0">
            {lightbox && thumbnailSpriteUrl && (
              <CutThumbnail
                spriteUrl={thumbnailSpriteUrl}
                time={lightbox.time}
                duration={duration}
                width={560}
                height={315}
                className="rounded-lg"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CutsPanel;
