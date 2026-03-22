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

export function useCreditsBalance() {
  const { session } = useAuth();
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBalance = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("credits-balance", {
        method: "GET",
      });
      if (fnError) throw fnError;
      const result = data?.data ?? data;
      setBalance(result?.balance ?? result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch balance");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  return { balance, loading, error, refetch: fetchBalance };
}

export function useCreditsHistory() {
  const { session } = useAuth();
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const fetchHistory = useCallback(async (newOffset = 0) => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const url = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/credits-history?limit=${limit}&offset=${newOffset}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      });
      const json = await res.json();
      const result = json?.data ?? json;
      const items = result?.transactions ?? [];
      if (newOffset === 0) {
        setTransactions(items);
      } else {
        setTransactions((prev) => [...prev, ...items]);
      }
      setTotalCount(result?.total_count ?? 0);
      setOffset(newOffset);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch history");
    } finally {
      setLoading(false);
    }
  }, [session]);

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
        window.location.href = checkoutUrl;
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
