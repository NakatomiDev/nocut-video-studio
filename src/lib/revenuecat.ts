import { Purchases } from "@revenuecat/purchases-js";

const RC_API_KEY = import.meta.env.VITE_REVENUECAT_BILLING_KEY ?? "";

let configured = false;

/**
 * Configure the RevenueCat SDK for the current authenticated user.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function configureRevenueCat(appUserId: string): Purchases {
  if (configured) {
    return Purchases.getSharedInstance();
  }

  const instance = Purchases.configure(RC_API_KEY, appUserId);
  configured = true;
  return instance;
}

/**
 * Return the shared instance. Throws if not yet configured.
 */
export function getRevenueCat(): Purchases {
  return Purchases.getSharedInstance();
}

/**
 * Reset SDK state on sign-out so the next user gets a fresh instance.
 */
export function resetRevenueCat() {
  configured = false;
}
