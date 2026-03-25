import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Search, Coins } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface UserRow {
  id: string;
  email: string;
  tier: string;
  created_at: string | null;
}

interface LedgerRow {
  id: string;
  type: string;
  credits_granted: number;
  credits_remaining: number;
  expires_at: string;
  granted_at: string;
}

const CreditManager = () => {
  const [searchEmail, setSearchEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [totalBalance, setTotalBalance] = useState<number | null>(null);

  const searchUsers = async () => {
    if (!searchEmail.trim()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("users")
        .select("id, email, tier, created_at")
        .ilike("email", `%${searchEmail.trim()}%`)
        .limit(10);
      if (error) throw error;
      setUsers(data ?? []);
      if (data?.length === 0) toast.info("No users found");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const selectUser = async (user: UserRow) => {
    setSelectedUser(user);
    try {
      const { data, error } = await supabase
        .from("credit_ledger")
        .select("id, type, credits_granted, credits_remaining, expires_at, granted_at")
        .eq("user_id", user.id)
        .order("granted_at", { ascending: false });
      if (error) throw error;
      setLedger(data ?? []);
      const total = (data ?? [])
        .filter((r) => new Date(r.expires_at) > new Date())
        .reduce((sum, r) => sum + r.credits_remaining, 0);
      setTotalBalance(total);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader className="pb-3"><CardTitle className="text-base">Look Up User</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              value={searchEmail}
              onChange={(e) => setSearchEmail(e.target.value)}
              placeholder="Search by email..."
              onKeyDown={(e) => e.key === "Enter" && searchUsers()}
            />
            <Button onClick={searchUsers} disabled={loading} className="gap-2 shrink-0">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </Button>
          </div>

          {users.length > 0 && (
            <div className="mt-4 space-y-2">
              {users.map((u) => (
                <div
                  key={u.id}
                  onClick={() => selectUser(u)}
                  className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors hover:bg-secondary ${selectedUser?.id === u.id ? "border-primary bg-secondary" : "border-border"}`}
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{u.email}</p>
                    <p className="text-xs text-muted-foreground">ID: {u.id}</p>
                  </div>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{u.tier}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedUser && (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2"><Coins className="h-4 w-4" />Credit Ledger — {selectedUser.email}</span>
              {totalBalance !== null && (
                <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-bold text-primary">{totalBalance} credits</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ledger.length === 0 ? (
              <p className="text-sm text-muted-foreground">No ledger entries found.</p>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="pb-2 pr-4">Type</th>
                      <th className="pb-2 pr-4">Granted</th>
                      <th className="pb-2 pr-4">Remaining</th>
                      <th className="pb-2 pr-4">Expires</th>
                      <th className="pb-2">Granted At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((entry) => {
                      const expired = new Date(entry.expires_at) < new Date();
                      return (
                        <tr key={entry.id} className={`border-b border-border/50 ${expired ? "opacity-40" : ""}`}>
                          <td className="py-2 pr-4 font-mono text-xs">{entry.type}</td>
                          <td className="py-2 pr-4">{entry.credits_granted}</td>
                          <td className="py-2 pr-4 font-medium">{entry.credits_remaining}</td>
                          <td className="py-2 pr-4 text-xs">{new Date(entry.expires_at).toLocaleDateString()}</td>
                          <td className="py-2 text-xs">{new Date(entry.granted_at).toLocaleDateString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default CreditManager;
