import { useState, useEffect, useCallback } from "react";
import {
  Purchases,
  type CustomerInfo,
  type Offerings,
  type Package,
  type PurchaseResult,
  PurchasesError,
  ErrorCode,
} from "@revenuecat/purchases-js";
import { useAuth } from "@/hooks/useAuth";
import { configureRevenueCat, resetRevenueCat } from "@/lib/revenuecat";

// ---------------------------------------------------------------------------
// Product / entitlement constants
// ---------------------------------------------------------------------------

/** RevenueCat entitlement identifier for Pro access */
export const ENTITLEMENT_PRO = "NoCut Pro";

/** Product identifiers used across offerings */
export const PRODUCTS = {
  PRO_MONTHLY: "nocut_pro_monthly",
  PRO_ANNUAL: "nocut_pro_annual",
  BUSINESS_MONTHLY: "nocut_business_monthly",
  BUSINESS_ANNUAL: "nocut_business_annual",
} as const;

/** Stripe price IDs mapped to product identifiers */
export const STRIPE_PRICES: Record<string, string> = {
  [PRODUCTS.PRO_MONTHLY]: "price_1TDehiEifp2JCI8QznuQbDcV",
  [PRODUCTS.PRO_ANNUAL]: "price_1TDehkEifp2JCI8QDIJUE9r0",
  [PRODUCTS.BUSINESS_MONTHLY]: "price_1TDehlEifp2JCI8Qk0Gv8OP9",
  [PRODUCTS.BUSINESS_ANNUAL]: "price_1TDehnEifp2JCI8QnBrWBurb",
};

// ---------------------------------------------------------------------------
// Hook: useRevenueCatCustomer
// ---------------------------------------------------------------------------

/**
 * Configures the SDK on mount (when a user session exists) and exposes
 * customer info + entitlement helpers.
 */
export function useRevenueCatCustomer() {
  const { user } = useAuth();
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCustomerInfo = useCallback(async () => {
    if (!user) {
      setCustomerInfo(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      configureRevenueCat(user.id);
      const info = await Purchases.getSharedInstance().getCustomerInfo();
      setCustomerInfo(info);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch customer info";
      setError(message);
      console.error("RevenueCat customer info error:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchCustomerInfo();
  }, [fetchCustomerInfo]);

  // Reset SDK state when user signs out
  useEffect(() => {
    if (!user) {
      resetRevenueCat();
    }
  }, [user]);

  const isEntitledTo = useCallback(
    (entitlementId: string) => {
      if (!customerInfo) return false;
      return entitlementId in customerInfo.entitlements.active;
    },
    [customerInfo],
  );

  const hasProAccess = isEntitledTo(ENTITLEMENT_PRO);

  const activeEntitlements = customerInfo
    ? Object.keys(customerInfo.entitlements.active)
    : [];

  return {
    customerInfo,
    loading,
    error,
    refetch: fetchCustomerInfo,
    isEntitledTo,
    hasProAccess,
    activeEntitlements,
  };
}

// ---------------------------------------------------------------------------
// Hook: useRevenueCatOfferings
// ---------------------------------------------------------------------------

/**
 * Fetches RevenueCat offerings/packages for display in a paywall.
 */
export function useRevenueCatOfferings() {
  const { user } = useAuth();
  const [offerings, setOfferings] = useState<Offerings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOfferings = useCallback(async () => {
    if (!user) {
      setOfferings(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      configureRevenueCat(user.id);
      const result = await Purchases.getSharedInstance().getOfferings();
      setOfferings(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch offerings";
      setError(message);
      console.error("RevenueCat offerings error:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchOfferings();
  }, [fetchOfferings]);

  return { offerings, loading, error, refetch: fetchOfferings };
}

// ---------------------------------------------------------------------------
// Hook: useRevenueCatPurchase
// ---------------------------------------------------------------------------

export interface PurchaseState {
  purchasing: boolean;
  error: string | null;
  cancelled: boolean;
}

/**
 * Provides a `purchase` function that drives the RevenueCat purchase flow.
 */
export function useRevenueCatPurchase() {
  const [state, setState] = useState<PurchaseState>({
    purchasing: false,
    error: null,
    cancelled: false,
  });

  const purchase = useCallback(
    async (
      rcPackage: Package,
      options?: { htmlTarget?: HTMLElement; customerEmail?: string },
    ): Promise<PurchaseResult | null> => {
      setState({ purchasing: true, error: null, cancelled: false });

      try {
        const result = await Purchases.getSharedInstance().purchase({
          rcPackage,
          ...(options?.htmlTarget ? { htmlTarget: options.htmlTarget } : {}),
          ...(options?.customerEmail ? { customerEmail: options.customerEmail } : {}),
        });

        setState({ purchasing: false, error: null, cancelled: false });
        return result;
      } catch (err) {
        if (err instanceof PurchasesError && err.errorCode === ErrorCode.UserCancelledError) {
          setState({ purchasing: false, error: null, cancelled: true });
          return null;
        }

        const message = err instanceof Error ? err.message : "Purchase failed";
        setState({ purchasing: false, error: message, cancelled: false });
        console.error("RevenueCat purchase error:", err);
        return null;
      }
    },
    [],
  );

  return { ...state, purchase };
}

// ---------------------------------------------------------------------------
// Hook: useRevenueCatPaywall
// ---------------------------------------------------------------------------

/**
 * Presents the RevenueCat-hosted paywall inside a DOM element.
 */
export function useRevenueCatPaywall() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presentPaywall = useCallback(
    async (
      htmlTarget: HTMLElement,
      offering?: Offerings["current"],
    ): Promise<PurchaseResult | null> => {
      if (!user) return null;

      setLoading(true);
      setError(null);

      try {
        configureRevenueCat(user.id);
        const purchases = Purchases.getSharedInstance();
        const result = await purchases.presentPaywall({
          htmlTarget,
          ...(offering ? { offering } : {}),
        });

        setLoading(false);
        return result;
      } catch (err) {
        if (err instanceof PurchasesError && err.errorCode === ErrorCode.UserCancelledError) {
          setLoading(false);
          return null;
        }

        const message = err instanceof Error ? err.message : "Paywall error";
        setError(message);
        setLoading(false);
        console.error("RevenueCat paywall error:", err);
        return null;
      }
    },
    [user],
  );

  return { presentPaywall, loading, error };
}
