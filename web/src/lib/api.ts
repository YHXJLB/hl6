import type {
  ApiResponse,
  PaginatedResponse,
  User,
  Domain,
  Subdomain,
  DNSRecord,
  CreditBalance,
  CreditTransaction,
  DailyCheckinStatus,
  DailyCheckinClaimResult,
  RedeemCode,
  RedeemCodeRedemption,
  RedeemCodeResult,
  CreateRedeemCodePayload,
  BatchRedeemCodePayload,
  DomainGroupAccess,
  DomainWithGroupAccess,
  DNSProviderZone,
  Stats,
  AuditLog,
  UserGroup,
  DNSProviderAccount,
  Notification,
  OffsetPaginatedResponse,
  BrandingResponse,
  ReferralInfo,
  UserWithInviter,
  AdminDNSRecord,
  AdminClaimedSubdomain,
  DNSBulkJob,
  DNSBulkJobItem,
  ReservedSubdomainPrefixSettings,
  SubdomainLengthSettings,
  AdminConfigPayload,
  DomainDNSMigrationTask,
  DomainDNSMigrationItem,
  CreateMigrationResult,
  RetryFailuresResult,
  CleanupSourceResult,
  DNSProviderStatusEntry,
  OIDCStatusPayload,
  AuditSummary,
  AuditWorkbenchItem,
  AuditSubdomainDetail,
  AuditRule,
  AuditScenario,
  AuditRuleTestResult,
  SubdomainScan,
  SubdomainClaimRule,
  SubdomainClaimRuleTestResult,
} from "@/types";
import { buildPaginatedQuery } from "@/lib/api-query";

function normalizeApiBaseUrl(rawValue: string | undefined): string {
  const value = rawValue?.trim() ?? "";
  const baseUrl = value.length > 0 ? value : "/api/v1";

  if (baseUrl === "/") {
    return "";
  }

  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

export const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export class ApiError extends Error {
  messageKey?: string;
  data?: unknown;
  status?: number;
  constructor(message: string, messageKey?: string, data?: unknown, status?: number) {
    super(message);
    this.messageKey = messageKey;
    this.data = data;
    this.status = status;
  }
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isRetryableMutationError(err: unknown): boolean {
  if (err instanceof ApiError) {
    if (err.status === 408) return true;
    if (typeof err.status === "number" && err.status >= 500) return true;
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes("timeout") || msg.includes("network") || msg.includes("failed to fetch");
  }
  return false;
}

type RequestOptions = RequestInit & {
  timeoutMs?: number;
  idempotencyKey?: string;
};

let handlingBannedSession = false;

async function forceLogoutForBannedUser(): Promise<void> {
  try {
    await fetch(buildApiUrl("/auth/logout"), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch {
    // Best effort only.
  }
}

export function getErrorMessage(err: unknown, t?: (key: string) => string): string {
  if (err instanceof ApiError && err.messageKey && t) {
    const translated = t(err.messageKey);
    if (translated !== err.messageKey) return translated;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !headers["X-Idempotency-Key"]) {
    headers["X-Idempotency-Key"] = options.idempotencyKey || createIdempotencyKey();
  }

  const timeoutMs = options.timeoutMs ?? 0;
  const timeoutController = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const upstreamSignal = options.signal;
  const abortByUpstream = () => timeoutController.abort();
  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      timeoutController.abort();
    } else {
      upstreamSignal.addEventListener("abort", abortByUpstream, { once: true });
    }
  }
  if (timeoutMs > 0) {
    timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  }

  let res: Response;
  try {
    res = await fetch(buildApiUrl(path), {
      ...options,
      headers,
      credentials: "include",
      signal: timeoutController.signal,
    });
  } catch (err) {
    if (timer) clearTimeout(timer);
    if (upstreamSignal) {
      upstreamSignal.removeEventListener("abort", abortByUpstream);
    }
    if (err instanceof DOMException && err.name === "AbortError" && !upstreamSignal?.aborted && timeoutMs > 0) {
      throw new ApiError("Request timeout", "error.failedToFetch", undefined, 408);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    if (upstreamSignal) {
      upstreamSignal.removeEventListener("abort", abortByUpstream);
    }
  }

  if (res.status === 401) {
    if (!path.includes("/auth/me")) {
      const key = "hl6_401_count";
      const timeKey = "hl6_401_time";
      const now = Date.now();
      const lastTime = parseInt(sessionStorage.getItem(timeKey) || "0");
      let count = parseInt(sessionStorage.getItem(key) || "0");

      // Reset counter if more than 5 minutes since last 401
      if (now - lastTime > 5 * 60 * 1000) {
        count = 0;
      }

      count++;
      sessionStorage.setItem(key, String(count));
      sessionStorage.setItem(timeKey, String(now));

      if (count <= 3) {
        window.location.href = buildApiUrl("/auth/login");
      }
    }
    throw new ApiError("Not authenticated", "error.missingToken", undefined, 401);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    if (res.status === 403 && body?.message_key === "error.userBanned") {
      const reason = typeof body?.data?.reason === "string" ? body.data.reason : "";
      sessionStorage.setItem("hl6_banned_notice", "1");
      if (reason.trim()) {
        sessionStorage.setItem("hl6_ban_reason", reason.trim());
      } else {
        sessionStorage.removeItem("hl6_ban_reason");
      }
      sessionStorage.removeItem("hl6_401_count");
      sessionStorage.removeItem("hl6_401_time");

      if (!handlingBannedSession) {
        handlingBannedSession = true;
        if (!path.includes("/auth/logout")) {
          await forceLogoutForBannedUser();
        }
        if (window.location.pathname !== "/") {
          window.location.href = "/";
        }
      }
    }
    throw new ApiError(body.message || res.statusText, body.message_key, body.data, res.status);
  }

  return res.json();
}

export const api = {
  // Branding (public)
  getBranding: (options?: { signal?: AbortSignal }) =>
    request<ApiResponse<BrandingResponse>>("/branding", { signal: options?.signal }),

  // Auth
  getMe: async () => {
    const res = await request<ApiResponse<{ user: User; credits: number }>>("/auth/me");
    sessionStorage.removeItem("hl6_401_count");
    sessionStorage.removeItem("hl6_401_time");
    return res;
  },
  getOIDCStatus: () => request<ApiResponse<OIDCStatusPayload>>("/auth/oidc/status"),
  bootstrapOIDCConfig: (data: { oidc_issuer: string; oidc_client_id: string; oidc_client_secret: string }) =>
    request<ApiResponse<OIDCStatusPayload>>("/auth/oidc/bootstrap", { method: "POST", body: JSON.stringify(data) }),
  logout: () => request<ApiResponse<{ logout_url: string }>>("/auth/logout", { method: "POST" }),

  // Domains
  listDomains: () => request<ApiResponse<Domain[]>>("/domains"),

  // Public (no auth)
  listPublicDomains: () =>
    request<ApiResponse<{ id: number; name: string; description: string }[]>>("/public/domains"),
  checkSubdomainAvailable: (name: string, domainId: number) =>
    request<ApiResponse<{ available: boolean }>>(`/public/subdomains/check?name=${encodeURIComponent(name)}&domain_id=${domainId}`),

  // Subdomains
  listSubdomains: () => request<ApiResponse<Subdomain[]>>("/subdomains"),
  getSubdomainSettings: () => request<ApiResponse<SubdomainLengthSettings>>("/subdomains/settings"),
  getSubdomain: (id: number) => request<ApiResponse<Subdomain>>(`/subdomains/${id}`),
  claimSubdomain: (data: { domain_id: number; name: string }) =>
    request<ApiResponse<Subdomain>>("/subdomains", { method: "POST", body: JSON.stringify(data) }),
  releaseSubdomain: (id: number, opts?: { idempotencyKey?: string; timeoutMs?: number }) =>
    request<ApiResponse<{ message: string }>>(`/subdomains/${id}`, { method: "DELETE", idempotencyKey: opts?.idempotencyKey, timeoutMs: opts?.timeoutMs }),

  // DNS Records
  listRecords: (subdomainId: number) =>
    request<ApiResponse<DNSRecord[]>>(`/subdomains/${subdomainId}/records`),
  createRecord: (
    subdomainId: number,
    data: { type: string; content: string; ttl?: number; proxied?: boolean },
    opts?: { idempotencyKey?: string; timeoutMs?: number }
  ) =>
    request<ApiResponse<DNSRecord>>(`/subdomains/${subdomainId}/records`, {
      method: "POST",
      body: JSON.stringify(data),
      idempotencyKey: opts?.idempotencyKey,
      timeoutMs: opts?.timeoutMs,
    }),
  updateRecord: (
    subdomainId: number,
    recordId: number,
    data: { content: string; ttl?: number; proxied?: boolean },
    opts?: { idempotencyKey?: string; timeoutMs?: number }
  ) =>
    request<ApiResponse<DNSRecord>>(`/subdomains/${subdomainId}/records/${recordId}`, {
      method: "PUT",
      body: JSON.stringify(data),
      idempotencyKey: opts?.idempotencyKey,
      timeoutMs: opts?.timeoutMs,
    }),
  deleteRecord: (subdomainId: number, recordId: number, opts?: { idempotencyKey?: string; timeoutMs?: number }) =>
    request<ApiResponse<{ message: string }>>(`/subdomains/${subdomainId}/records/${recordId}`, {
      method: "DELETE",
      idempotencyKey: opts?.idempotencyKey,
      timeoutMs: opts?.timeoutMs,
    }),

  // Credits
  getCredits: () => request<ApiResponse<CreditBalance>>("/credits"),
  listTransactions: (page = 1, perPage = 20) =>
    request<PaginatedResponse<CreditTransaction[]>>(`/credits/transactions?page=${page}&per_page=${perPage}`),
  getDailyCheckinStatus: () =>
    request<ApiResponse<DailyCheckinStatus>>("/credits/checkin/status"),
  claimDailyCheckin: () =>
    request<ApiResponse<DailyCheckinClaimResult>>("/credits/checkin", { method: "POST" }),
  redeemCode: (code: string) =>
    request<ApiResponse<RedeemCodeResult>>("/credits/redeem", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  // Referrals
  getReferrals: (page = 1, perPage = 20) =>
    request<ApiResponse<ReferralInfo>>(`/referrals?page=${page}&per_page=${perPage}`),

  // Admin
  adminCreateDomain: (data: { name: string; provider_zone_id: string; provider_account_id: number; description: string; group_access: { group_id: number; credit_cost: number; max_dns_records?: number | null }[] }) =>
    request<ApiResponse<{ domain: Domain; group_access: DomainGroupAccess[] }>>("/admin/domains", { method: "POST", body: JSON.stringify(data) }),
  adminUpdateDomain: (id: number, data: { provider_zone_id?: string; provider_account_id?: number; is_active?: boolean; description?: string; group_access?: { group_id: number; credit_cost: number; max_dns_records?: number | null }[] }) =>
    request<ApiResponse<{ domain: Domain; group_access: DomainGroupAccess[] }>>(`/admin/domains/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  adminDeleteDomain: (id: number, options?: { refund?: boolean; idempotencyKey?: string; timeoutMs?: number }) =>
    request<ApiResponse<{ message: string }>>(`/admin/domains/${id}?refund=${options?.refund ?? false}`, {
      method: "DELETE",
      idempotencyKey: options?.idempotencyKey,
      timeoutMs: options?.timeoutMs,
    }),
  adminListDomainsFull: () =>
    request<ApiResponse<DomainWithGroupAccess[]>>("/admin/domains-full"),
  adminGetReservedSubdomainPrefixes: () =>
    request<ApiResponse<ReservedSubdomainPrefixSettings>>("/admin/domains/reserved-prefixes"),
  adminUpdateReservedSubdomainPrefixes: (data: { prefixes: string[]; min_length: number; max_length: number }) =>
    request<ApiResponse<ReservedSubdomainPrefixSettings>>("/admin/domains/reserved-prefixes", { method: "PUT", body: JSON.stringify(data) }),
  adminListDNSProviderZones: (accountId: number) =>
    request<ApiResponse<DNSProviderZone[]>>(`/admin/dns-accounts/${accountId}/zones`),
  adminGrantCredits: (data: { user_id: number; amount: number; description: string }) =>
    request<ApiResponse<{ user_id: number; granted: number; balance: number }>>("/admin/credits/grant", { method: "POST", body: JSON.stringify(data) }),
  adminListUsers: (
    page = 1,
    perPage = 20,
    search = "",
    banStatus: "all" | "active" | "banned" = "all",
    role: "all" | "user" | "admin" = "all",
    groupId?: number,
    inviter = ""
  ) => {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (search) params.set("search", search);
    if (banStatus !== "all") params.set("ban_status", banStatus);
    if (role !== "all") params.set("role", role);
    if (groupId !== undefined) params.set("group_id", String(groupId));
    if (inviter) params.set("inviter", inviter);
    return request<PaginatedResponse<UserWithInviter[]>>(`/admin/users?${params.toString()}`);
  },
  adminGetStats: () => request<ApiResponse<Stats>>("/admin/stats"),
  adminListAuditLogs: (page = 1, perPage = 20, operator = "", action = "") => {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (operator) params.set("operator", operator);
    if (action) params.set("action", action);
    return request<PaginatedResponse<AuditLog[]>>(`/admin/audit-logs?${params.toString()}`);
  },

  // Admin: User Groups
  adminListGroups: () =>
    request<ApiResponse<UserGroup[]>>("/admin/groups"),
  adminCreateGroup: (data: { name: string; is_default?: boolean }) =>
    request<ApiResponse<UserGroup>>("/admin/groups", { method: "POST", body: JSON.stringify(data) }),
  adminUpdateGroup: (id: number, data: { name?: string; is_default?: boolean }) =>
    request<ApiResponse<UserGroup>>(`/admin/groups/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  adminDeleteGroup: (id: number, migrateTo: number) =>
    request<ApiResponse<{ message: string }>>(`/admin/groups/${id}?migrate_to=${migrateTo}`, { method: "DELETE" }),
  adminUpdateUserGroup: (userId: number, groupId: number) =>
    request<ApiResponse<{ message: string }>>(`/admin/users/${userId}/group`, { method: "PUT", body: JSON.stringify({ group_id: groupId }) }),
  adminBanUser: (userId: number, data: { reason?: string }, opts?: { idempotencyKey?: string; timeoutMs?: number }) =>
    request<ApiResponse<{ message: string; failed_records?: Array<{ subdomain_fqdn: string; record_type: string; record_content: string; provider_record_id: string; error: string }> }>>(
      `/admin/users/${userId}/ban`,
      { method: "PUT", body: JSON.stringify(data), idempotencyKey: opts?.idempotencyKey, timeoutMs: opts?.timeoutMs }
    ),
  adminUnbanUser: (userId: number) =>
    request<ApiResponse<{ message: string }>>(`/admin/users/${userId}/unban`, { method: "PUT" }),

  // Admin: System Config
  adminGetConfig: () =>
    request<ApiResponse<AdminConfigPayload>>("/admin/config"),
  adminUpdateConfig: (data: Record<string, string>) =>
    request<ApiResponse<{ message: string }>>("/admin/config", { method: "PUT", body: JSON.stringify(data) }),
  adminConfirmUrlConfig: () =>
    request<ApiResponse<{ message: string }>>("/admin/config/url-confirm", { method: "POST" }),

  // Admin: DNS Provider Accounts
  adminListDNSProviderAccounts: () =>
    request<ApiResponse<DNSProviderAccount[]>>("/admin/dns-accounts"),
  adminCreateDNSProviderAccount: (data: { provider: string; name: string; credentials: Record<string, string> }) =>
    request<ApiResponse<DNSProviderAccount>>("/admin/dns-accounts", { method: "POST", body: JSON.stringify(data) }),
  adminUpdateDNSProviderAccount: (id: number, data: { provider?: string; name: string; credentials?: Record<string, string> }) =>
    request<ApiResponse<DNSProviderAccount>>(`/admin/dns-accounts/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  adminDeleteDNSProviderAccount: (id: number) =>
    request<ApiResponse<{ message: string }>>(`/admin/dns-accounts/${id}`, { method: "DELETE" }),

  // Admin: DNS Provider Status
  adminGetDNSProviderStatus: () =>
    request<ApiResponse<DNSProviderStatusEntry[]>>("/admin/dns-providers/status"),

  // Admin: Domain DNS Migrations
  adminCreateDomainMigration: (
    domainId: number,
    data: { target_provider_account_id: number; target_provider_zone_id: string; reason?: string }
  ) =>
    request<ApiResponse<CreateMigrationResult>>(`/admin/domains/${domainId}/migrations`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  adminListDomainMigrations: (domainId: number, params?: { status?: string; page?: number; per_page?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.page) q.set("page", String(params.page));
    if (params?.per_page) q.set("per_page", String(params.per_page));
    const qs = q.toString();
    return request<ApiResponse<{ tasks: DomainDNSMigrationTask[]; total: number; page: number; per_page: number }>>(
      `/admin/domains/${domainId}/migrations${qs ? `?${qs}` : ""}`
    );
  },
  adminGetDomainMigration: (domainId: number, taskId: number, params?: { page?: number; per_page?: number }) => {
    const q = new URLSearchParams();
    if (params?.page) q.set("page", String(params.page));
    if (params?.per_page) q.set("per_page", String(params.per_page));
    const qs = q.toString();
    return request<
      ApiResponse<{
        task: DomainDNSMigrationTask;
        items: DomainDNSMigrationItem[];
        item_total: number;
        page: number;
        per_page: number;
      }>
    >(`/admin/domains/${domainId}/migrations/${taskId}${qs ? `?${qs}` : ""}`);
  },
  adminRetryMigrationFailures: (domainId: number, taskId: number) =>
    request<ApiResponse<RetryFailuresResult>>(
      `/admin/domains/${domainId}/migrations/${taskId}/retry-failures`,
      { method: "POST" }
    ),
  adminCleanupMigrationSource: (
    domainId: number,
    taskId: number,
    data: { confirm_domain_name: string; confirm_phrase: string }
  ) =>
    request<ApiResponse<CleanupSourceResult>>(
      `/admin/domains/${domainId}/migrations/${taskId}/cleanup-source`,
      { method: "POST", body: JSON.stringify(data) }
    ),

  // Admin: DNS Records
  adminListDNSRecords: (page = 1, perPage = 20, search = "", domainId?: number, groupId?: number) => {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (search) params.set("search", search);
    if (domainId) params.set("domain_id", String(domainId));
    if (groupId) params.set("group_id", String(groupId));
    return request<PaginatedResponse<AdminDNSRecord[]>>(`/admin/dns-records?${params.toString()}`);
  },
  adminDeleteDNSRecord: (id: number, data: { notify: boolean; reason?: string; ban_user?: boolean }, opts?: { idempotencyKey?: string; timeoutMs?: number }) =>
    request<ApiResponse<{ message: string }>>(`/admin/dns-records/${id}`, {
      method: "DELETE",
      body: JSON.stringify(data),
      idempotencyKey: opts?.idempotencyKey,
      timeoutMs: opts?.timeoutMs,
    }),
  adminGetDNSBulkJob: (id: number) =>
    request<ApiResponse<DNSBulkJob>>(`/admin/dns-bulk-jobs/${id}`),
  adminListDNSBulkJobItems: (id: number, page = 1, perPage = 20, status = "") => {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (status) params.set("status", status);
    return request<PaginatedResponse<DNSBulkJobItem[]>>(`/admin/dns-bulk-jobs/${id}/items?${params.toString()}`);
  },
  adminListClaimedSubdomains: (page = 1, perPage = 20, search = "") => {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (search) params.set("search", search);
    return request<PaginatedResponse<AdminClaimedSubdomain[]>>(`/admin/claimed-subdomains?${params.toString()}`);
  },
  adminReleaseClaimedSubdomain: (id: number, data: { notify: boolean; reason?: string }, opts?: { idempotencyKey?: string; timeoutMs?: number }) =>
    request<ApiResponse<{ message: string }>>(`/admin/claimed-subdomains/${id}`, {
      method: "DELETE",
      body: JSON.stringify(data),
      idempotencyKey: opts?.idempotencyKey,
      timeoutMs: opts?.timeoutMs,
    }),
  adminUpdateBranding: (data: { name: string }) =>
    request<ApiResponse<BrandingResponse>>("/admin/branding", { method: "PUT", body: JSON.stringify(data) }),
  adminUploadBrandingLogo: async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(buildApiUrl("/admin/branding/logo"), {
      method: "POST",
      body: formData,
      credentials: "include",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new ApiError(body.message || res.statusText, body.message_key);
    }
    return res.json() as Promise<ApiResponse<BrandingResponse>>;
  },
  adminDeleteBrandingLogo: () =>
    request<ApiResponse<BrandingResponse>>("/admin/branding/logo", { method: "DELETE" }),

  // Notifications (user)
  listNotifications: (offset = 0, limit = 20) =>
    request<OffsetPaginatedResponse<Notification[]>>(`/notifications?offset=${offset}&limit=${limit}`),
  getNotification: (id: number) =>
    request<ApiResponse<Notification>>(`/notifications/${id}`),
  markNotificationRead: (id: number) =>
    request<ApiResponse<{ message: string }>>(`/notifications/${id}/read`, { method: "POST" }),
  getUnreadStatus: () =>
    request<ApiResponse<{ has_unread: boolean }>>("/notifications/unread"),

  // Admin: Notifications
  adminListNotifications: (page = 1, perPage = 15) =>
    request<PaginatedResponse<Notification[]>>(`/admin/notifications?page=${page}&per_page=${perPage}`),
  adminCreateNotification: (data: {
    title: string;
    content: string;
    type: string;
    target_type: string;
    target_ids?: number[];
    visible_to_new?: boolean;
  }) =>
    request<ApiResponse<Notification>>("/admin/notifications", { method: "POST", body: JSON.stringify(data) }),
  adminUpdateNotification: (id: number, data: { title: string; content: string; type: string }) =>
    request<ApiResponse<Notification>>(`/admin/notifications/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  adminDeleteNotification: (id: number) =>
    request<ApiResponse<{ message: string }>>(`/admin/notifications/${id}`, { method: "DELETE" }),
  adminUploadNotificationImage: async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(buildApiUrl("/admin/notifications/images"), {
      method: "POST",
      body: formData,
      credentials: "include",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new ApiError(body.message || res.statusText, body.message_key);
    }
    return res.json() as Promise<ApiResponse<{ id: number; url: string }>>;
  },

  // Admin: Redeem codes
  adminListRedeemCodes: (
    page = 1,
    perPage = 20,
    filters: { listed?: boolean; batch_id?: string; q?: string } = {}
  ) => {
    const params: Record<string, string | undefined> = {
      q: filters.q,
      batch_id: filters.batch_id,
      listed: filters.listed === undefined ? undefined : String(filters.listed),
    };
    const path = buildPaginatedQuery("/admin/redeem-codes", page, perPage, params);
    return request<PaginatedResponse<RedeemCode[]>>(path);
  },
  adminCreateRedeemCode: (data: CreateRedeemCodePayload) =>
    request<ApiResponse<RedeemCode>>("/admin/redeem-codes", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  adminBatchRedeemCodes: (data: BatchRedeemCodePayload) =>
    request<ApiResponse<{ batch_id: string; items: RedeemCode[] }>>("/admin/redeem-codes/batch", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  adminDelistRedeemCode: (id: number) =>
    request<ApiResponse<RedeemCode>>(`/admin/redeem-codes/${id}/delist`, { method: "POST" }),
  adminRelistRedeemCode: (id: number) =>
    request<ApiResponse<RedeemCode>>(`/admin/redeem-codes/${id}/relist`, { method: "POST" }),
  adminListRedeemCodeRedemptions: (id: number, page = 1, perPage = 20) =>
    request<PaginatedResponse<RedeemCodeRedemption[]>>(
      `/admin/redeem-codes/${id}/redemptions?page=${page}&per_page=${perPage}`
    ),

  // Admin: Content audit workbench
  adminGetAuditSummary: () => request<ApiResponse<AuditSummary>>("/admin/audit/summary"),
  adminListAuditCases: (page = 1, perPage = 20, filters: Record<string, string | undefined> = {}) => {
    const path = buildPaginatedQuery("/admin/audit/cases", page, perPage, filters);
    return request<PaginatedResponse<AuditWorkbenchItem[]>>(path);
  },
  adminGetAuditSubdomainDetail: (id: number) =>
    request<ApiResponse<AuditSubdomainDetail>>(`/admin/audit/subdomains/${id}`),
  adminListAuditSubdomainScans: (id: number, page = 1, perPage = 20) =>
    request<PaginatedResponse<SubdomainScan[]>>(buildPaginatedQuery(`/admin/audit/subdomains/${id}/scans`, page, perPage)),
  adminRestoreAuditSubdomain: (id: number) =>
    request<ApiResponse<{ restored: boolean; fqdn: string }>>(`/admin/audit/subdomains/${id}/restore`, { method: "POST" }),
  adminReleaseAuditSubdomain: (
    id: number,
    data: { notify: boolean; reason?: string },
    opts?: { idempotencyKey?: string; timeoutMs?: number }
  ) =>
    request<ApiResponse<{ message: string }>>(`/admin/audit/subdomains/${id}/release`, {
      method: "DELETE",
      body: JSON.stringify(data),
      idempotencyKey: opts?.idempotencyKey,
      timeoutMs: opts?.timeoutMs,
    }),
  adminRescanAuditSubdomain: (id: number) =>
    request<ApiResponse<{ queued: boolean; fqdn: string }>>(`/admin/audit/subdomains/${id}/rescan`, { method: "POST" }),
  adminBulkRescanAudit: (subdomainIds: number[]) =>
    request<ApiResponse<{ queued: number; skipped: number; skipped_details: { id: number; reason: string }[] }>>("/admin/audit/subdomains/bulk-rescan", {
      method: "POST",
      body: JSON.stringify({ subdomain_ids: subdomainIds }),
    }),
  adminListAuditRules: () => request<ApiResponse<AuditRule[]>>("/admin/audit/rules"),
  adminListAuditScenarios: () => request<ApiResponse<AuditScenario[]>>("/admin/audit/rules/scenarios"),
  adminCreateAuditRule: (data: Record<string, unknown>) =>
    request<ApiResponse<AuditRule>>("/admin/audit/rules", { method: "POST", body: JSON.stringify(data) }),
  adminUpdateAuditRule: (id: number, data: Record<string, unknown>) =>
    request<ApiResponse<AuditRule>>(`/admin/audit/rules/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  adminDeleteAuditRule: (id: number) =>
    request<ApiResponse<{ deleted: boolean }>>(`/admin/audit/rules/${id}`, { method: "DELETE" }),
  adminToggleAuditRule: (id: number) =>
    request<ApiResponse<AuditRule>>(`/admin/audit/rules/${id}/toggle`, { method: "PUT" }),
  adminTestAuditRule: (data: { fqdn: string; rule?: Record<string, unknown>; rule_id?: number }) =>
    request<ApiResponse<AuditRuleTestResult>>("/admin/audit/rules/test", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  adminListAuditScans: (page = 1, perPage = 20, filters: Record<string, string | undefined> = {}) => {
    const path = buildPaginatedQuery("/admin/audit/scans", page, perPage, filters);
    return request<PaginatedResponse<SubdomainScan[]>>(path);
  },
  adminGetAuditScan: (id: number) => request<ApiResponse<SubdomainScan>>(`/admin/audit/scans/${id}`),

  // ---- Subdomain Claim Rules (子域创建规则) ----
  adminListClaimRules: () => request<ApiResponse<SubdomainClaimRule[]>>("/admin/subdomain-claim-rules"),
  adminCreateClaimRule: (data: Record<string, unknown>) =>
    request<ApiResponse<SubdomainClaimRule>>("/admin/subdomain-claim-rules", { method: "POST", body: JSON.stringify(data) }),
  adminUpdateClaimRule: (id: number, data: Record<string, unknown>) =>
    request<ApiResponse<SubdomainClaimRule>>(`/admin/subdomain-claim-rules/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  adminDeleteClaimRule: (id: number) =>
    request<ApiResponse<{ message: string }>>(`/admin/subdomain-claim-rules/${id}`, { method: "DELETE" }),
  adminToggleClaimRule: (id: number) =>
    request<ApiResponse<{ enabled: boolean }>>(`/admin/subdomain-claim-rules/${id}/toggle`, { method: "PUT" }),
  adminTestClaimRule: (data: { subdomain_name: string; domain_id: number; domain_name: string; rule?: SubdomainClaimRule; rule_id?: number }) =>
    request<ApiResponse<{ matched: boolean; matched_rule: { rule_id: number; rule_name: string; action: string; message: string } | null }>>("/admin/subdomain-claim-rules/test", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  checkClaimRules: (name: string, domainId: number, domainName: string) =>
    request<ApiResponse<SubdomainClaimRuleTestResult>>(`/subdomains/check-rules?name=${encodeURIComponent(name)}&domain_id=${domainId}&domain_name=${encodeURIComponent(domainName)}`),
};
