import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Hook for subscribing via Stripe Checkout (fallback when RevenueCat is unavailable).
 * Mirrors useCreditsTopup pattern: invokes an edge function, opens Stripe Checkout in a new tab.
 */
export function useStripeSubscription() {
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);

  const subscribe = async (productId: string) => {
    if (!session) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("subscribe-checkout", {
        body: { product_id: productId },
      });
      if (error) throw error;
      const result = data?.data ?? data;
      const checkoutUrl = result?.checkout_url;
      if (checkoutUrl) {
        // Open in new tab — Stripe Checkout blocks iframe embedding
        const newWindow = window.open(checkoutUrl, "_blank");
        if (!newWindow) {
          // Fallback if popup blocked
          window.location.href = checkoutUrl;
        }
      }
    } catch (err) {
      console.error("Subscription checkout error:", err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { subscribe, loading };
}
