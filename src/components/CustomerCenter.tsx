import { useRevenueCatCustomer, ENTITLEMENT_PRO, ENTITLEMENT_BUSINESS } from "@/hooks/useRevenueCat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, CreditCard, CalendarClock } from "lucide-react";
import { format, parseISO } from "date-fns";

interface CustomerCenterProps {
  onManageSubscription?: () => void;
}

/**
 * Self-service subscription management card.
 * Shows current plan, entitlements, and expiration.
 */
export const CustomerCenter = ({ onManageSubscription }: CustomerCenterProps) => {
  const { customerInfo, loading, error, hasProAccess, activeEntitlements } =
    useRevenueCatCustomer();

  if (loading) {
    return (
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Subscription</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-border">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            Unable to load subscription info
          </div>
        </CardContent>
      </Card>
    );
  }

  // Derive active subscription details — check business first, then pro
  const businessEntitlement = customerInfo?.entitlements.active[ENTITLEMENT_BUSINESS];
  const proEntitlement = customerInfo?.entitlements.active[ENTITLEMENT_PRO];
  const activeEntitlement = businessEntitlement ?? proEntitlement;
  const expiresDate = activeEntitlement?.expirationDate;
  const productId = activeEntitlement?.productIdentifier;
  const isAnnual = productId?.includes("annual");

  const planLabel = businessEntitlement
    ? "Business"
    : proEntitlement
      ? "Pro"
      : "Free";

  const periodLabel = hasProAccess
    ? isAnnual
      ? "Annual"
      : "Monthly"
    : null;

  // Management URL — RevenueCat provides this for Stripe-billed web subscribers
  const managementUrl = customerInfo?.managementURL;

  const handleManage = () => {
    if (onManageSubscription) {
      onManageSubscription();
    } else if (managementUrl) {
      window.open(managementUrl, "_blank");
    }
  };

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-primary" />
          Subscription
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={
              hasProAccess
                ? "border-primary/30 text-primary"
                : "border-border text-muted-foreground"
            }
          >
            {planLabel}
          </Badge>
          {periodLabel && (
            <span className="text-xs text-muted-foreground">{periodLabel}</span>
          )}
        </div>

        {activeEntitlements.length > 0 && (
          <div className="text-sm text-muted-foreground">
            Active entitlements:{" "}
            <span className="text-foreground font-medium">
              {activeEntitlements.join(", ")}
            </span>
          </div>
        )}

        {expiresDate && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" />
            Renews {format(parseISO(expiresDate), "MMM d, yyyy")}
          </div>
        )}

        {(managementUrl || onManageSubscription) && hasProAccess && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleManage}
          >
            Manage Subscription
          </Button>
        )}
      </CardContent>
    </Card>
  );
};
