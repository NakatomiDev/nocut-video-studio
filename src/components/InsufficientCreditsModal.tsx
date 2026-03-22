import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Coins, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useCreditsTopup } from "@/hooks/useCredits";
import { Loader2 } from "lucide-react";

const TOPUP_PACKS = [
  { id: "nocut_credits_10", credits: 10, price: "$4.99", name: "Starter" },
  { id: "nocut_credits_30", credits: 30, price: "$11.99", name: "Standard" },
  { id: "nocut_credits_75", credits: 75, price: "$24.99", name: "Value" },
  { id: "nocut_credits_200", credits: 200, price: "$54.99", name: "Bulk" },
];

interface InsufficientCreditsModalProps {
  open: boolean;
  onClose: () => void;
  creditsNeeded: number;
  creditsAvailable: number;
}

export const InsufficientCreditsModal = ({
  open,
  onClose,
  creditsNeeded,
  creditsAvailable,
}: InsufficientCreditsModalProps) => {
  const navigate = useNavigate();
  const { purchase, loading } = useCreditsTopup();
  const deficit = creditsNeeded - creditsAvailable;

  // Find smallest pack that covers the deficit
  const suggestedPack = TOPUP_PACKS.find((p) => p.credits >= deficit) ?? TOPUP_PACKS[TOPUP_PACKS.length - 1];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <DialogTitle className="text-center">Insufficient Credits</DialogTitle>
          <DialogDescription className="text-center">
            You need <span className="font-semibold text-foreground">{creditsNeeded}</span> credits but only have{" "}
            <span className="font-semibold text-foreground">{creditsAvailable}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          <Button
            className="w-full gap-2"
            onClick={() => purchase(suggestedPack.id)}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Coins className="h-4 w-4" />
            )}
            Quick Top-Up: {suggestedPack.credits} credits for {suggestedPack.price}
          </Button>

          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={() => {
              onClose();
              navigate("/credits");
            }}
          >
            <ArrowRight className="h-4 w-4" />
            View All Options
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
