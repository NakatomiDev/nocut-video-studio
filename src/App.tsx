import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import Landing from "@/pages/Landing";
import SignUp from "@/pages/SignUp";
import SignIn from "@/pages/SignIn";
import Dashboard from "@/pages/Dashboard";
import Credits from "@/pages/Credits";
import Settings from "@/pages/Settings";
import Upload from "@/pages/Upload";
import ProjectEditor from "@/pages/ProjectEditor";
import NotFound from "@/pages/NotFound";
import CommercialDisclosure from "@/pages/CommercialDisclosure";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

const AuthRedirect = () => {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  return session ? <Navigate to="/dashboard" replace /> : <Landing />;
};

const ProtectedWithLayout = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>
    <AppLayout>{children}</AppLayout>
  </ProtectedRoute>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<AuthRedirect />} />
            <Route path="/sign-up" element={<SignUp />} />
            <Route path="/sign-in" element={<SignIn />} />
            <Route path="/dashboard" element={<ProtectedWithLayout><Dashboard /></ProtectedWithLayout>} />
            <Route path="/credits" element={<ProtectedWithLayout><Credits /></ProtectedWithLayout>} />
            <Route path="/settings" element={<ProtectedWithLayout><Settings /></ProtectedWithLayout>} />
            <Route path="/upload" element={<ProtectedRoute><Upload /></ProtectedRoute>} />
            <Route path="/project/:projectId" element={<ProtectedRoute><ProjectEditor /></ProtectedRoute>} />
            <Route path="/editor/:projectId" element={<ProtectedRoute><ProjectEditor /></ProtectedRoute>} />
            <Route path="/commercial-disclosure" element={<CommercialDisclosure />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
