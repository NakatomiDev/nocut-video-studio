import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import Landing from "@/pages/Landing";
import { Loader2 } from "lucide-react";

const SignUp = lazy(() => import("@/pages/SignUp"));
const SignIn = lazy(() => import("@/pages/SignIn"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Credits = lazy(() => import("@/pages/Credits"));
const Settings = lazy(() => import("@/pages/Settings"));
const Upload = lazy(() => import("@/pages/Upload"));
const ProjectEditor = lazy(() => import("@/pages/ProjectEditor"));
const ExportComplete = lazy(() => import("@/pages/ExportComplete"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const CommercialDisclosure = lazy(() => import("@/pages/CommercialDisclosure"));

const queryClient = new QueryClient();

const LazyFallback = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

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
          <Suspense fallback={<LazyFallback />}>
            <Route path="/" element={<AuthRedirect />} />
            <Route path="/sign-up" element={<SignUp />} />
            <Route path="/sign-in" element={<SignIn />} />
            <Route path="/dashboard" element={<ProtectedWithLayout><Dashboard /></ProtectedWithLayout>} />
            <Route path="/credits" element={<ProtectedWithLayout><Credits /></ProtectedWithLayout>} />
            <Route path="/settings" element={<ProtectedWithLayout><Settings /></ProtectedWithLayout>} />
            <Route path="/upload" element={<ProtectedRoute><Upload /></ProtectedRoute>} />
            <Route path="/project/:projectId" element={<ProtectedRoute><ProjectEditor /></ProtectedRoute>} />
            <Route path="/project/:projectId/export/:exportId" element={<ProtectedRoute><ExportComplete /></ProtectedRoute>} />
            <Route path="/editor/:projectId" element={<ProtectedRoute><ProjectEditor /></ProtectedRoute>} />
            <Route path="/commercial-disclosure" element={<CommercialDisclosure />} />
            <Route path="*" element={<NotFound />} />
          </Suspense>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
