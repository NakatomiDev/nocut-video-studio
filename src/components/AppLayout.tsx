import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { LayoutGrid, CreditCard, Settings, LogOut, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const ADMIN_EMAILS = ["richorman@gmail.com"];

const navItems = [
  { title: "Dashboard", path: "/dashboard", icon: LayoutGrid },
  { title: "Credits", path: "/credits", icon: CreditCard },
  { title: "Settings", path: "/settings", icon: Settings },
];

const AppLayout = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const { user, signOut } = useAuth();

  return (
    <div className="flex min-h-screen w-full">
      {/* Sidebar */}
      <aside className="flex w-60 flex-col border-r border-border bg-background">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="text-xl font-bold text-foreground">✂️ NoCut</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {navItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.title}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border px-4 py-4">
          <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
            onClick={signOut}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 bg-secondary">
        {children}
      </main>
    </div>
  );
};

export default AppLayout;
