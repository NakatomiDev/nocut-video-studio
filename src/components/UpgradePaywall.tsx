import { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Check, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Package } from "@revenuecat/purchases-js";
import {
  useRevenueCatOfferings,
  useRevenueCatPurchase,
  useRevenueCatCustomer,
  PRODUCTS,
} from "@/hooks/useRevenueCat";
import { useStripeSubscription } from "@/hooks/useStripeSubscription";
import { isRevenueCatAvailable } from "@/lib/revenuecat";
import { toast } from "@/hooks/use-toast";

interface UpgradePaywallProps {
  open: boolean;
  onClose: () => void;
  currentTier?: string;
}

// Static plan metadata (features, display info) — prices come from RevenueCat or fallback
const PLAN_META: Record<
  string,
  { name: string; features: string[]; highlight?: boolean }
> = {
  free: {
    name: "Free",
    features: ["5 credits/mo", "720p export", "5 min max input", "1s AI fills"],
  },
  pro: {
    name: "Pro",
    features: [
      "40 credits/mo",
      "1080p export",
      "30 min max input",
      "5s AI fills",
      "Transcript editing",
      "No watermark",
    ],
    highlight: true,
  },
  business: {
    name: "Business",
    features: [
      "120 credits/mo",
      "4K export",
      "2 hour max input",
      "5s AI fills",
      "Multi-speaker",
      "Batch processing",
      "Priority processing",
    ],
  },
};

// Map product identifiers → plan tier
const PRODUCT_TO_TIER: Record<string, string> = {
  [PRODUCTS.PRO_MONTHLY]: "pro",
  [PRODUCTS.PRO_ANNUAL]: "pro",
  [PRODUCTS.BUSINESS_MONTHLY]: "business",
  [PRODUCTS.BUSINESS_ANNUAL]: "business",
};

// Fallback static prices when RevenueCat is unavailable (must match Stripe prices)
const FALLBACK_PRICES: Record<string, { monthly: string; annual: string }> = {
  pro: { monthly: "$14.99", annual: "$9.99" },
  business: { monthly: "$39.99", annual: "$29.99" },
};

function formatPrice(pkg: Package | undefined): string {
  if (!pkg) return "—";
  const product = pkg.webBillingProduct as any;
  if (!product) return "—";

  // RevenueCat JS SDK: currentPrice has { amountMicros, currencyCode, formattedPrice }
  const price = product.currentPrice ?? product.defaultPrice ?? product.normalPurchasePrice ?? product.defaultPurchasePrice;

  // If the SDK provides a pre-formatted string, use it
  if (price?.formattedPrice) return price.formattedPrice;
  if (product.priceString) return product.priceString;

  if (!price) return "—";
  const currency = price.currencyCode ?? price.currency ?? "USD";
  const amount = price.amountMicros != null
    ? price.amountMicros / 1_000_000
    : price.amount ?? 0;
  if (amount === 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

export const UpgradePaywall = ({
  open,
  onClose,
  currentTier = "free",
}: UpgradePaywallProps) => {
  const [annual, setAnnual] = useState(true);

  // RevenueCat hooks (only used when RC is available)
  const { offerings, loading: offeringsLoading, error: offeringsError } = useRevenueCatOfferings();
  const { purchase, purchasing } = useRevenueCatPurchase();
  const { refetch: refetchCustomer } = useRevenueCatCustomer();

  // Stripe fallback hook
  const { subscribe, loading: stripeLoading } = useStripeSubscription();

  const useRC = isRevenueCatAvailable;
  const isProcessing = useRC ? purchasing : stripeLoading;

  // Resolve packages from the current offering (RC only)
  const currentOffering = offerings?.current;
  const allPackages = currentOffering?.availablePackages ?? [];

  // Debug: log available packages to help diagnose matching issues
  useEffect(() => {
    if (useRC && allPackages.length > 0) {
      console.log("RevenueCat packages:", allPackages.map(p => ({
        id: p.identifier,
        productId: p.webBillingProduct?.identifier,
        product: p.webBillingProduct,
      })));
    }
  }, [allPackages, useRC]);

  // Build a lookup: productId → Package (try both product identifier and package identifier)
  const packagesByProduct = new Map<string, Package>();
  for (const pkg of allPackages) {
    const productId = pkg.webBillingProduct?.identifier;
    if (productId) packagesByProduct.set(productId, pkg);
    // Also index by package identifier (RC sometimes uses this)
    if (pkg.identifier) packagesByProduct.set(pkg.identifier, pkg);
  }

  // Helper: get the right package for a tier + billing period
  const getPackage = (tier: string, isAnnual: boolean): Package | undefined => {
    if (tier === "free") return undefined;
    const suffix = isAnnual ? "_annual" : "_monthly";
    const productId = `nocut_${tier}${suffix}`;
    // Try exact match first, then common RC package identifiers
    return packagesByProduct.get(productId)
      ?? packagesByProduct.get(`$rc_${isAnnual ? "annual" : "monthly"}`)
      ?? undefined;
  };

  const handleUpgrade = async (tier: string) => {
    if (useRC) {
      // RevenueCat path
      const pkg = getPackage(tier, annual);
      if (!pkg) return;

      const result = await purchase(pkg);
      if (result) {
        toast({
          title: "Subscription activated!",
          description: `You're now on the ${PLAN_META[tier]?.name ?? tier} plan.`,
        });
        await refetchCustomer();
        onClose();
      }
    } else {
      // Stripe fallback path
      const suffix = annual ? "_annual" : "_monthly";
      const productId = `nocut_${tier}${suffix}`;
      try {
        await subscribe(productId);
        toast({
          title: "Redirecting to checkout…",
          description: "Complete your subscription in the new tab.",
        });
      } catch {
        toast({
          title: "Checkout failed",
          description: "Please try again.",
          variant: "destructive",
        });
      }
    }
  };

  // Price display
  const getPrice = (tier: string): string => {
    if (tier === "free") return "Free";
    if (useRC) {
      return formatPrice(getPackage(tier, annual));
    }
    const fallback = FALLBACK_PRICES[tier];
    if (!fallback) return "—";
    return annual ? fallback.annual : fallback.monthly;
  };

  // Loading / error states
  const isLoading = useRC ? offeringsLoading : false;
  const loadError = useRC ? offeringsError : null;

  const tiers = ["free", "pro", "business"] as const;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-center text-xl">
            Upgrade Your Plan
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-center gap-3 py-2">
          <span
            className={cn(
              "text-sm",
              !annual && "text-foreground font-medium",
              annual && "text-muted-foreground",
            )}
          >
            Monthly
          </span>
          <Switch checked={annual} onCheckedChange={setAnnual} />
          <span
            className={cn(
              "text-sm",
              annual && "text-foreground font-medium",
              !annual && "text-muted-foreground",
            )}
          >
            Annual
          </span>
          {annual && (
            <Badge className="bg-primary/20 text-primary text-[10px]">
              Save 33%
            </Badge>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : loadError ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            Failed to load plans. Please try again.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {tiers.map((tier) => {
              const meta = PLAN_META[tier];
              const isCurrent = tier === currentTier;
              const price = getPrice(tier);

              return (
                <Card
                  key={tier}
                  className={cn(
                    "border-border relative",
                    meta.highlight && "border-primary ring-1 ring-primary",
                  )}
                >
                  {meta.highlight && (
                    <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[10px]">
                      Recommended
                    </Badge>
                  )}
                  <CardContent className="pt-5 pb-4 space-y-4">
                    <div>
                      <p className="font-bold text-foreground">{meta.name}</p>
                      <div className="mt-1">
                        {tier === "free" ? (
                          <span className="text-2xl font-bold text-foreground">
                            Free
                          </span>
                        ) : (
                          <>
                            <span className="text-2xl font-bold text-foreground">
                              {price}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              /mo
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <ul className="space-y-1.5 text-xs">
                      {meta.features.map((f) => (
                        <li
                          key={f}
                          className="flex items-center gap-2 text-muted-foreground"
                        >
                          <Check className="h-3 w-3 text-primary shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <Button
                      size="sm"
                      className="w-full"
                      variant={meta.highlight ? "default" : "outline"}
                      disabled={isCurrent || tier === "free" || isProcessing}
                      onClick={() => handleUpgrade(tier)}
                    >
                      {isProcessing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : isCurrent ? (
                        "Current Plan"
                      ) : tier === "free" ? (
                        "Free"
                      ) : (
                        `Upgrade to ${meta.name}`
                      )}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
