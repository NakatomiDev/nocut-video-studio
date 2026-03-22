import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogOut } from "lucide-react";
import { UpgradePaywall } from "@/components/UpgradePaywall";
import { CustomerCenter } from "@/components/CustomerCenter";
import { useRevenueCatCustomer } from "@/hooks/useRevenueCat";

const SettingsPage = () => {
  const { user, signOut } = useAuth();
  const [paywallOpen, setPaywallOpen] = useState(false);
  const { hasProAccess, customerInfo } = useRevenueCatCustomer();

  // Derive current tier from entitlements
  const productId = customerInfo?.entitlements.active["NoCut Pro"]?.productIdentifier;
  const currentTier = productId?.includes("business")
    ? "business"
    : hasProAccess
      ? "pro"
      : "free";

  return (
    <div className="p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-foreground">Settings</h1>

      <div className="mt-6 max-w-lg space-y-6">
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Email</p>
              <p className="text-sm font-medium text-foreground">{user?.email}</p>
            </div>
          </CardContent>
        </Card>

        <CustomerCenter onManageSubscription={
          hasProAccess ? undefined : () => setPaywallOpen(true)
        } />

        {!hasProAccess && (
          <Button variant="outline" className="w-full" onClick={() => setPaywallOpen(true)}>
            Upgrade Plan
          </Button>
        )}

        <Card className="border-border">
          <CardContent className="pt-6">
            <Button
              variant="destructive"
              className="w-full gap-2"
              onClick={signOut}
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>

      <UpgradePaywall open={paywallOpen} onClose={() => setPaywallOpen(false)} currentTier={currentTier} />
    </div>
  );
};

export default SettingsPage;
