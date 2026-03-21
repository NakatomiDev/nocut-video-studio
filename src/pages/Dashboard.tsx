import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

const Dashboard = () => {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-xl font-bold text-foreground">✂️ NoCut</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">{user?.email}</span>
          <Button variant="ghost" size="icon" onClick={signOut}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <main className="flex flex-col items-center justify-center px-6 py-24">
        <h2 className="text-2xl font-bold text-foreground">Welcome to NoCut</h2>
        <p className="mt-2 text-muted-foreground">Your projects will appear here.</p>
      </main>
    </div>
  );
};

export default Dashboard;
