import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Loader2, ShieldAlert } from "lucide-react";
import AdminVeoTester from "@/components/admin/VeoTester";
import AdminEdgeFunctionTester from "@/components/admin/EdgeFunctionTester";
import AdminCreditManager from "@/components/admin/CreditManager";

const ADMIN_EMAILS = ["richorman@gmail.com"];

const AdminPage = () => {
  useDocumentTitle("Admin — NoCut");
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || !ADMIN_EMAILS.includes(user.email ?? "")) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Admin Console</h1>
            <p className="text-sm text-muted-foreground">Internal testing tools — {user.email}</p>
          </div>
        </div>

        <Tabs defaultValue="veo" className="w-full">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="veo">Veo Tester</TabsTrigger>
            <TabsTrigger value="edge">Edge Functions</TabsTrigger>
            <TabsTrigger value="credits">Credit Manager</TabsTrigger>
          </TabsList>

          <TabsContent value="veo" className="mt-6">
            <AdminVeoTester />
          </TabsContent>
          <TabsContent value="edge" className="mt-6">
            <AdminEdgeFunctionTester />
          </TabsContent>
          <TabsContent value="credits" className="mt-6">
            <AdminCreditManager />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AdminPage;
