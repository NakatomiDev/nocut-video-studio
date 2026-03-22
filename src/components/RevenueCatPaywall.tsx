import { useRef, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, AlertCircle } from "lucide-react";
import { useRevenueCatPaywall, useRevenueCatCustomer } from "@/hooks/useRevenueCat";
import { toast } from "@/hooks/use-toast";

interface RevenueCatPaywallProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Renders the RevenueCat-hosted paywall inside a dialog.
 * On successful purchase, shows a toast and closes.
 */
export const RevenueCatPaywall = ({ open, onClose }: RevenueCatPaywallProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { presentPaywall, loading, error } = useRevenueCatPaywall();
  const { refetch: refetchCustomer } = useRevenueCatCustomer();
  const [presented, setPresented] = useState(false);

  useEffect(() => {
    if (!open || !containerRef.current || presented) return;

    let cancelled = false;

    (async () => {
      const result = await presentPaywall(containerRef.current!);

      if (cancelled) return;

      if (result) {
        toast({
          title: "Subscription activated!",
          description: "Your plan has been upgraded.",
        });
        await refetchCustomer();
        onClose();
      }
    })();

    setPresented(true);

    return () => {
      cancelled = true;
    };
  }, [open, presented, presentPaywall, refetchCustomer, onClose]);

  // Reset presentation state when dialog closes
  useEffect(() => {
    if (!open) setPresented(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="text-center text-xl">
            Choose Your Plan
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        <div ref={containerRef} className="min-h-[200px]" />
      </DialogContent>
    </Dialog>
  );
};
