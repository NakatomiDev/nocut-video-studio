import { useState, useEffect, useCallback } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, AlertTriangle } from 'lucide-react';
import CutThumbnail from './CutThumbnail';
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
    creditEstimate,
    creditBalance,
    setCreditBalance,
    setPlayhead,
    project,
  } = useEditorStore();

  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const fetchBalance = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
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

  const hasActiveCuts = activeCuts.size > 0 || activeManualCuts.size > 0;
  const insufficientCredits = creditEstimate > creditBalance.total;
  const creditsAfterExport = creditBalance.total - creditEstimate;

  const handleExport = useCallback(async () => {
    if (!project) return;
    setExporting(true);
    try {
      const activeCutsList = cuts.filter((c) => activeCuts.has(c.id));
      const activeManualList = manualCuts.filter((c) => activeManualCuts.has(c.id));
      const allCuts = [
        ...activeCutsList.map((c) => ({ start: c.start, end: c.end, type: c.type })),
        ...activeManualList.map((c) => ({ start: c.start, end: c.end, type: 'manual' })),
      ].sort((a, b) => a.start - b.start);

      const { error } = await supabase.from('edit_decisions').insert({
        project_id: project.id,
        edl_json: allCuts,
        total_fill_seconds: allCuts.reduce((s, c) => s + (c.end - c.start), 0),
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
  }, [project, cuts, activeCuts, manualCuts, activeManualCuts, creditEstimate]);

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
                  onCheckedChange={(e) => {
                    e;
                    toggleCut(cut.id);
                  }}
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
              {activeCuts.has(cut.id) && thumbnailSpriteUrl && renderPreview(cut.start, cut.end)}
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
              {activeManualCuts.has(cut.id) && thumbnailSpriteUrl && renderPreview(cut.start, cut.end)}
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="space-y-3 border-t border-border p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Estimated credits</span>
          <span className="text-sm font-semibold text-foreground">{creditEstimate}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Your balance</span>
          <span className="text-sm font-semibold text-foreground">{creditBalance.total} credits</span>
        </div>
        {insufficientCredits && (
          <div className="flex items-center gap-1.5 text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">Insufficient credits</span>
          </div>
        )}
        <Button className="w-full" disabled={!hasActiveCuts || insufficientCredits} onClick={() => setShowExportDialog(true)}>
          Export ({creditEstimate} credits)
        </Button>
      </div>

      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Export</DialogTitle>
            <DialogDescription>
              This will use {creditEstimate} credits to generate AI fills for your cuts.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Credits remaining after export</span>
              <span className="font-semibold">{creditsAfterExport}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Format</span>
              <span className="font-semibold">MP4, 1080p</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowExportDialog(false)}>Cancel</Button>
            <Button onClick={handleExport} disabled={exporting}>
              {exporting ? 'Exporting...' : 'Confirm & Export'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CutsPanel;
