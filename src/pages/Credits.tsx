import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useCreditsBalance, useCreditsHistory, useCreditsTopup } from "@/hooks/useCredits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Coins, AlertTriangle, Loader2, ArrowDownCircle, ArrowUpCircle, RefreshCw, ArrowRight } from "lucide-react";
import { format, differenceInDays, parseISO } from "date-fns";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

const TOPUP_PACKS = [
  { id: "nocut_credits_10", credits: 10, price: "$4.99", perCredit: "$0.50", name: "Starter" },
  { id: "nocut_credits_40", credits: 40, price: "$14.99", perCredit: "$0.37", name: "Standard", badge: "Most Popular" },
  { id: "nocut_credits_100", credits: 100, price: "$34.99", perCredit: "$0.35", name: "Pro", badge: "Best Value" },
  { id: "nocut_credits_250", credits: 250, price: "$79.99", perCredit: "$0.32", name: "Studio" },
];

const Credits = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { balance, loading: balanceLoading, refetch: refetchBalance } = useCreditsBalance();
  const { transactions, loading: historyLoading, loadMore, hasMore } = useCreditsHistory();
  const { purchase, loading: topupLoading } = useCreditsTopup();
  useDocumentTitle("Credits");

  useEffect(() => {
    if (searchParams.get("success") === "true") {
      toast({ title: "Credits added!", description: "Your top-up credits are now available." });
      refetchBalance();
      setSearchParams({}, { replace: true });
    } else if (searchParams.get("cancelled") === "true") {
      toast({ title: "Purchase cancelled", description: "No credits were added.", variant: "default" });
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, refetchBalance]);

  // Find credits expiring within 7 days
  const expiringSoon = balance?.breakdown?.filter((entry) => {
    const daysLeft = differenceInDays(parseISO(entry.expires_at), new Date());
    return daysLeft >= 0 && daysLeft <= 7 && entry.credits_remaining > 0;
  }) ?? [];
  const expiringCredits = expiringSoon.reduce((sum, e) => sum + e.credits_remaining, 0);
  const earliestExpiry = expiringSoon.length > 0
    ? expiringSoon.reduce((earliest, e) => (e.expires_at < earliest ? e.expires_at : earliest), expiringSoon[0].expires_at)
    : null;

  const monthlyPct = balance && balance.total > 0 ? (balance.monthly / balance.total) * 100 : 0;

  return (
    <div className="p-6 lg:p-8 space-y-8 max-w-4xl">
      <h1 className="text-2xl font-bold text-foreground">Credits</h1>

      {/* Balance Section */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Coins className="h-4 w-4 text-primary" />
            Credit Balance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {balanceLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <>
              <div className="text-5xl font-bold text-foreground tabular-nums">
                {balance?.total ?? 0}
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>Monthly: <span className="font-medium text-foreground">{balance?.monthly ?? 0}</span></span>
                <span className="text-border">|</span>
                <span>Top-up: <span className="font-medium text-foreground">{balance?.topup ?? 0}</span></span>
              </div>
              {balance && balance.total > 0 && (
                <div className="space-y-1">
                  <Progress value={monthlyPct} className="h-2" />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Monthly</span>
                    <span>Top-up</span>
                  </div>
                </div>
              )}
              {balance && balance.total === 0 && !expiringCredits && (
                <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
                  <span className="text-foreground font-medium">No credits remaining</span>
                  <Button size="sm" variant="default" className="gap-1.5" onClick={() => {
                    const el = document.getElementById('topup-section');
                    el?.scrollIntoView({ behavior: 'smooth' });
                  }}>
                    Top Up <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
                <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {expiringCredits} credit{expiringCredits > 1 ? "s" : ""} expiring on {format(parseISO(earliestExpiry), "MMM d, yyyy")}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Top-Up Packs */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Top Up Credits</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {TOPUP_PACKS.map((pack) => (
            <Card key={pack.id} className="border-border relative overflow-hidden">
              {pack.badge && (
                <Badge className="absolute top-3 right-3 bg-primary text-primary-foreground text-[10px]">
                  {pack.badge}
                </Badge>
              )}
              <CardContent className="pt-5 pb-4 space-y-3">
                <div>
                  <p className="text-lg font-bold text-foreground">{pack.credits} credits</p>
                  <p className="text-sm text-muted-foreground">{pack.name}</p>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-bold text-foreground">{pack.price}</span>
                  <span className="text-xs text-muted-foreground">{pack.perCredit}/credit</span>
                </div>
                <Button
                  className="w-full"
                  size="sm"
                  disabled={topupLoading}
                  onClick={() => purchase(pack.id)}
                >
                  {topupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buy"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Transaction History */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Credit History</h2>
        <Card className="border-border">
          <CardContent className="p-0">
            {historyLoading && transactions.length === 0 ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : transactions.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">No transactions yet</p>
            ) : (
              <div className="divide-y divide-border">
                {transactions.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div className="flex items-center gap-3 min-w-0">
                      {tx.type === "deduction" ? (
                        <ArrowDownCircle className="h-4 w-4 shrink-0 text-destructive" />
                      ) : tx.type === "refund" ? (
                        <RefreshCw className="h-4 w-4 shrink-0 text-primary" />
                      ) : (
                        <ArrowUpCircle className="h-4 w-4 shrink-0 text-green-500" />
                      )}
                      <div className="min-w-0">
                        <p className="text-foreground truncate">
                          {tx.reason ?? tx.type}
                          {tx.project_title && <span className="text-muted-foreground"> · {tx.project_title}</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(parseISO(tx.created_at), "MMM d, yyyy h:mm a")}
                        </p>
                      </div>
                    </div>
                    <span className={`font-mono font-medium tabular-nums ${tx.type === "deduction" ? "text-destructive" : "text-green-500"}`}>
                      {tx.type === "deduction" ? "-" : "+"}{tx.credits}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {hasMore && (
              <div className="border-t border-border p-3">
                <Button variant="ghost" size="sm" className="w-full" onClick={loadMore} disabled={historyLoading}>
                  {historyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Load more"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Credits;
