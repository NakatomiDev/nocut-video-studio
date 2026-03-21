import { useEditorStore } from '@/stores/editorStore';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

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

const CutsPanel = () => {
  const { cuts, activeCuts, toggleCut } = useEditorStore();

  const totalCredits = cuts
    .filter((c) => activeCuts.has(c.id))
    .reduce((sum, c) => sum + Math.ceil(c.duration), 0);

  return (
    <div className="flex h-full flex-col border-l border-border bg-card">
      <div className="border-b border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">Cuts</h3>
        <p className="text-xs text-muted-foreground mt-1">
          {cuts.length} detected · {activeCuts.size} active
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {cuts.length === 0 && (
            <p className="text-xs text-muted-foreground p-3 text-center">No cuts detected</p>
          )}
          {cuts.map((cut) => (
            <div
              key={cut.id}
              className="flex items-center gap-3 rounded-md p-3 hover:bg-secondary/50 transition-colors"
            >
              <Switch
                checked={activeCuts.has(cut.id)}
                onCheckedChange={() => toggleCut(cut.id)}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={typeBadgeClass[cut.type] || 'border-border text-muted-foreground'}
                  >
                    {cut.type}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {cut.duration.toFixed(1)}s
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 font-mono">
                  {formatTimestamp(cut.start)} → {formatTimestamp(cut.end)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="border-t border-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Estimated credits</span>
          <span className="text-sm font-semibold text-foreground">{totalCredits}</span>
        </div>
        <Button className="w-full" disabled>
          Export
        </Button>
      </div>
    </div>
  );
};

export default CutsPanel;
