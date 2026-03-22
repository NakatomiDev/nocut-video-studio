import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface UpgradePaywallProps {
  open: boolean;
  onClose: () => void;
  currentTier?: string;
}

const PLANS = [
  {
    id: "free",
    name: "Free",
    monthlyPrice: 0,
    annualPrice: 0,
    features: ["5 credits/mo", "720p export", "5 min max input", "1s AI fills"],
  },
  {
    id: "pro",
    name: "Pro",
    monthlyPrice: 14.99,
    annualPrice: 9.99,
    features: ["40 credits/mo", "1080p export", "30 min max input", "5s AI fills", "Transcript editing", "No watermark"],
    highlight: true,
  },
  {
    id: "business",
    name: "Business",
    monthlyPrice: 39.99,
    annualPrice: 29.99,
    features: ["120 credits/mo", "4K export", "2 hour max input", "5s AI fills", "Multi-speaker", "Batch processing", "Priority processing"],
  },
];

export const UpgradePaywall = ({ open, onClose, currentTier = "free" }: UpgradePaywallProps) => {
  const [annual, setAnnual] = useState(true);

  const handleUpgrade = (planId: string) => {
    // RevenueCat integration placeholder
    console.log(`Upgrade to ${planId}, annual: ${annual}`);
    // TODO: Purchases.getSharedInstance().purchase({ rcPackage })
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-center text-xl">Upgrade Your Plan</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-center gap-3 py-2">
          <span className={cn("text-sm", !annual && "text-foreground font-medium", annual && "text-muted-foreground")}>Monthly</span>
          <Switch checked={annual} onCheckedChange={setAnnual} />
          <span className={cn("text-sm", annual && "text-foreground font-medium", !annual && "text-muted-foreground")}>
            Annual
          </span>
          {annual && <Badge className="bg-primary/20 text-primary text-[10px]">Save 33%</Badge>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {PLANS.map((plan) => {
            const isCurrent = plan.id === currentTier;
            const price = annual ? plan.annualPrice : plan.monthlyPrice;
            return (
              <Card
                key={plan.id}
                className={cn(
                  "border-border relative",
                  plan.highlight && "border-primary ring-1 ring-primary"
                )}
              >
                {plan.highlight && (
                  <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[10px]">
                    Recommended
                  </Badge>
                )}
                <CardContent className="pt-5 pb-4 space-y-4">
                  <div>
                    <p className="font-bold text-foreground">{plan.name}</p>
                    <div className="mt-1">
                      {price === 0 ? (
                        <span className="text-2xl font-bold text-foreground">Free</span>
                      ) : (
                        <>
                          <span className="text-2xl font-bold text-foreground">${price.toFixed(2)}</span>
                          <span className="text-xs text-muted-foreground">/mo</span>
                        </>
                      )}
                    </div>
                  </div>
                  <ul className="space-y-1.5 text-xs">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-muted-foreground">
                        <Check className="h-3 w-3 text-primary shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    size="sm"
                    className="w-full"
                    variant={plan.highlight ? "default" : "outline"}
                    disabled={isCurrent || plan.id === "free"}
                    onClick={() => handleUpgrade(plan.id)}
                  >
                    {isCurrent ? "Current Plan" : plan.id === "free" ? "Free" : `Upgrade to ${plan.name}`}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};
