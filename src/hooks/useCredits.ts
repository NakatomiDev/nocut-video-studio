import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface CreditBalance {
  monthly: number;
  topup: number;
  total: number;
  breakdown: Array<{
    id: string;
    type: string;
    credits_remaining: number;
    credits_granted: number;
    granted_at: string;
    expires_at: string;
  }>;
}

export interface CreditTransaction {
  id: string;
  type: string;
  credits: number;
  reason: string | null;
  project_title: string | null;
  project_id: string | null;
  ledger_entries: unknown;
  created_at: string;
}

type CreditsFunctionError = Error & {
  status?: number;
  code?: string;
};

const creditsFunctionsBaseUrl = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;

function isUnauthorizedError(err: unknown) {
  return err instanceof Error && ((err as CreditsFunctionError).status === 401 || (err as CreditsFunctionError).code === "unauthorized");
}

async function invokeCreditsFunction<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${creditsFunctionsBaseUrl}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const error = new Error(
      json?.error?.message ?? `Failed to call ${path}`,
    ) as CreditsFunctionError;
    error.status = res.status;
    error.code = json?.error?.code;
    throw error;
  }

  return (json?.data ?? json) as T;
}

export function useCreditsBalance() {
  const { session, signOut } = useAuth();
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBalance = useCallback(async () => {
    if (!session) {
      setBalance(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await invokeCreditsFunction<{ balance: CreditBalance }>(
        "credits-balance",
        session.access_token,
        { method: "GET" },
      );
      setBalance(result.balance ?? (result as CreditBalance));
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        await signOut();
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to fetch balance");
    } finally {
      setLoading(false);
    }
  }, [session, signOut]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  return { balance, loading, error, refetch: fetchBalance };
}

export function useCreditsHistory() {
  const { session, signOut } = useAuth();
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const fetchHistory = useCallback(async (newOffset = 0) => {
    if (!session) {
      setTransactions([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await invokeCreditsFunction<{
        transactions: CreditTransaction[];
        total_count: number;
      }>(`credits-history?limit=${limit}&offset=${newOffset}`, session.access_token, {
        method: "GET",
      });

      const items = result.transactions ?? [];
      if (newOffset === 0) {
        setTransactions(items);
      } else {
        setTransactions((prev) => [...prev, ...items]);
      }
      setTotalCount(result.total_count ?? 0);
      setOffset(newOffset);
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        await signOut();
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to fetch history");
    } finally {
      setLoading(false);
    }
  }, [session, signOut]);

  useEffect(() => {
    fetchHistory(0);
  }, [fetchHistory]);

  const loadMore = () => fetchHistory(offset + limit);
  const hasMore = transactions.length < totalCount;

  return { transactions, totalCount, loading, error, loadMore, hasMore, refetch: () => fetchHistory(0) };
}

export function useCreditsTopup() {
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);

  const purchase = async (productId: string) => {
    if (!session) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("credits-topup", {
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
      console.error("Top-up error:", err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { purchase, loading };
}
