import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { RootLayout } from "@/components/layout/root-layout";
import { ErrorBoundary } from "@/components/error-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import LandingPage from "@/pages/landing";
import CallbackPage from "@/pages/callback";
import DashboardPage from "@/pages/dashboard";
import DomainsPage from "@/pages/domains";
import SubdomainsPage from "@/pages/subdomains";
import SubdomainDetailPage from "@/pages/subdomain-detail";
import CreditsPage from "@/pages/credits";
import AdminDomainsPage from "@/pages/admin/domains";
import AdminUsersPage from "@/pages/admin/users";
import AdminAuditLogsPage from "@/pages/admin/audit-logs";
import AdminAuditPage from "@/pages/admin/audit";

import AdminSettingsPage from "@/pages/admin/settings";
import AdminClaimRulesPage from "@/pages/admin/claim-rules";
import NotFoundPage from "@/pages/not-found";

function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen">
        <aside className="hidden w-64 border-r bg-sidebar-background lg:block">
          <div className="flex h-14 items-center border-b px-4">
            <Skeleton className="h-5 w-28" />
          </div>
          <div className="space-y-2 p-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </aside>
        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center border-b bg-background px-4 lg:px-6">
            <div className="flex-1" />
            <div className="flex items-center gap-3">
              <Skeleton className="h-5 w-10" />
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
          </header>
          <main className="flex-1 p-4 lg:p-6">
            <div className="space-y-4">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <RootLayout><ErrorBoundary><Outlet /></ErrorBoundary></RootLayout>;
}

function AdminRoute() {
  const { user } = useAuth();
  if (user && user.role !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/callback" element={<CallbackPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/domains" element={<DomainsPage />} />
          <Route path="/subdomains" element={<SubdomainsPage />} />
          <Route path="/subdomains/:id" element={<SubdomainDetailPage />} />
          <Route path="/credits" element={<CreditsPage />} />
          <Route element={<AdminRoute />}>
            <Route path="/admin/domains" element={<AdminDomainsPage />} />
            <Route path="/admin/cloudflare" element={<Navigate to="/admin/domains?tab=dns-providers" replace />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/admin/audit" element={<AdminAuditPage />} />
            <Route path="/admin/audit-rules" element={<Navigate to="/admin/audit?tab=rules" replace />} />
            <Route path="/admin/audit-scans" element={<Navigate to="/admin/audit?tab=history" replace />} />
            <Route path="/admin/audit-violations" element={<Navigate to="/admin/audit?tab=domains" replace />} />
            <Route path="/admin/audit-sites" element={<Navigate to="/admin/audit?tab=domains" replace />} />
            <Route path="/admin/audit-logs" element={<AdminAuditLogsPage />} />
            <Route path="/admin/groups" element={<Navigate to="/admin/users?tab=groups" replace />} />
            <Route path="/admin/settings" element={<AdminSettingsPage />} />
            <Route path="/admin/claim-rules" element={<AdminClaimRulesPage />} />
            <Route path="/admin/notifications" element={<Navigate to="/admin/users?tab=notifications" replace />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
