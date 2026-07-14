import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

const routeQueries: Record<string, { queryKey: unknown[]; queryFn: () => Promise<unknown> }[]> = {
  "/dashboard": [
    { queryKey: ["subdomains"], queryFn: () => api.listSubdomains().then((r) => r.data) },
    { queryKey: ["credits"], queryFn: () => api.getCredits().then((r) => r.data) },
  ],
  "/domains": [
    { queryKey: ["domains"], queryFn: () => api.listDomains().then((r) => r.data) },
  ],
  "/subdomains": [
    { queryKey: ["subdomains"], queryFn: () => api.listSubdomains().then((r) => r.data) },
  ],
  "/credits": [
    { queryKey: ["credits"], queryFn: () => api.getCredits().then((r) => r.data) },
    {
      queryKey: ["transactions", 1, 20],
      queryFn: () =>
        api.listTransactions(1, 20).then((r) => ({ data: r.data, total: r.total, page: r.page, perPage: r.per_page })),
    },
  ],
  "/admin/audit": [
    { queryKey: ["admin-audit-summary"], queryFn: () => api.adminGetAuditSummary().then((r) => r.data) },
    {
      queryKey: ["admin-audit-cases", 1, "", "", "", "", "all"],
      queryFn: () =>
        api.adminListAuditCases(1, 20, { status: "active,suspended" }).then((r) => ({
          items: r.data,
          total: r.total,
        })),
    },
  ],
};

export function prefetchRouteData(queryClient: QueryClient, href: string) {
  const queries = routeQueries[href];
  if (!queries) return;
  for (const q of queries) {
    queryClient.prefetchQuery({ queryKey: q.queryKey, queryFn: q.queryFn, staleTime: 30_000 });
  }
}
