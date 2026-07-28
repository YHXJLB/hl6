export interface UserGroup {
  id: number;
  name: string;
  is_default: boolean;
  user_count?: number;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: number;
  external_id: string;
  referral_code?: string;
  email: string;
  name: string;
  avatar_url: string;
  role: "user" | "admin";
  is_banned: boolean;
  banned_reason?: string;
  banned_at?: string;
  banned_by?: number;
  group_id?: number;
  group?: UserGroup;
  created_at: string;
  updated_at: string;
}

export interface Domain {
  id: number;
  name: string;
  provider: string;
  provider_zone_id: string;
  provider_account_id: number;
  credit_cost: number;
  is_active: boolean;
  description: string;
  migration_state: "idle" | "running" | "partial_failed" | "failed" | "queued";
  migration_read_only: boolean;
  last_migration_task_id?: number | null;
  created_at: string;
  updated_at: string;
}

export interface Subdomain {
  id: number;
  domain_id: number;
  user_id: number;
  name: string;
  fqdn: string;
  status?: "active" | "suspended";
  suspended_reason?: string;
  suspended_at?: string;
  domain: Domain;
  dns_records?: DNSRecord[];
  created_at: string;
  updated_at: string;
}

export interface DNSRecord {
  id: number;
  subdomain_id: number;
  type: "A" | "CNAME" | "AAAA" | "TXT" | "NS" | "MX" | "SRV";
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  provider_record_id: string;
  status?: "active" | "suspended";
  created_at: string;
  updated_at: string;
}

export interface AuditRule {
  id: number;
  name: string;
  enabled: boolean;
  scenario_id?: string;
  description?: string;
  targets: ("body" | "title" | "final_url" | "status_code")[];
  match_type: "keyword" | "regex" | "status_eq" | "unreachable";
  keywords: string[];
  keyword_logic: "any" | "all";
  pattern: string;
  case_sensitive: boolean;
  action: "observe" | "delete_dns" | "site" | "user";
  scope_domain_ids: number[];
  ban_notify_content?: string;
  exempt_enabled?: boolean;
  exempt_recheck_minutes?: number;
  exempt_notify_content?: string;
  created_by: number;
  updated_by: number;
  created_at: string;
  updated_at: string;
  hit_count?: number;
  last_hit_at?: string | null;
  last_hit_fqdn?: string;
}

export interface MatchedRuleHit {
  rule_id: number;
  rule_name: string;
  action: "observe" | "delete_dns" | "site" | "user";
  snippet: string;
}

export interface SubdomainScan {
  id: number;
  subdomain_id: number;
  fqdn: string;
  url: string;
  status: "clean" | "violation" | "unreachable" | "error";
  http_status_code: number;
  final_url: string;
  matched_rules?: MatchedRuleHit[];
  matched_rule_id?: number | null;
  matched_snippet: string;
  content_hash: string;
  fetch_details?: {
    https: AuditFetchChannelDetail;
    http: AuditFetchChannelDetail;
  };
  created_at: string;
  updated_at: string;
}

export interface AuditSummary {
  deleted_count: number;
  current_violation: number;
  never_scanned_count: number;
  enabled_rules_count: number;
}

export interface AuditWorkbenchScanBrief {
  id: number;
  status: string;
  http_status_code: number;
  created_at: string;
}

export interface AuditWorkbenchViolationBrief {
  id: number;
  matched_rule_id?: number | null;
  matched_rule_name: string;
  matched_snippet: string;
  created_at: string;
  matched_rules?: MatchedRuleHit[];
}

export interface AuditWorkbenchItem {
  subdomain_id: number;
  fqdn: string;
  domain_id: number;
  domain_name: string;
  user_id: number;
  user_email: string;
  status: "active" | "suspended";
  suspended_reason?: string;
  suspended_at?: string;
  dns_record_count: number;
  latest_scan?: AuditWorkbenchScanBrief | null;
  latest_violation?: AuditWorkbenchViolationBrief | null;
  violation_count_7d: number;
  content_changed: boolean;
  scannable: boolean;
}

export interface AuditSubdomainDetail {
  subdomain: Subdomain;
  user_email: string;
  scannable: boolean;
  latest_violation?: AuditWorkbenchViolationBrief | null;
  sibling_subdomains: {
    id: number;
    fqdn: string;
    status: string;
    suspended_reason?: string;
    suspended_at?: string;
  }[];
  dns_records: DNSRecord[];
}

export interface AuditScenario {
  id: string;
  name_key: string;
  desc_key: string;
  targets: string[];
  match_type: string;
  keywords?: string[];
  pattern?: string;
  keyword_logic?: string;
}

export interface AuditFetchChannelDetail {
  scheme: string;
  request_url: string;
  status: string;
  http_status_code: number;
  final_url: string;
  error_message?: string;
  title_preview?: string;
}

export interface AuditRuleTestResult {
  fetch: {
    https: AuditFetchChannelDetail;
    http: AuditFetchChannelDetail;
  };
  matched_rules: MatchedRuleHit[];
  primary_action: string;
  would_suspend: boolean;
  would_release?: boolean;
  would_delete_dns: boolean;
  would_exempt?: boolean;
  would_send_ban_notify?: boolean;
  would_send_exempt_notify?: boolean;
}

export interface CreditBalance {
  balance: number;
  transactions: CreditTransaction[];
}

export interface DailyCheckinStatus {
  enabled: boolean;
  reward: number;
  claimed_today: boolean;
  checkin_date: string;
}

export interface DailyCheckinClaimResult {
  granted: number;
  balance: number;
  claimed_today: boolean;
  checkin_date: string;
}

export interface CreditTransaction {
  id: number;
  user_id: number;
  amount: number;
  type: "grant" | "deduct" | "refund";
  description_key: string;
  description_params?: Record<string, string>;
  balance_after: number;
  created_at: string;
}

export type RedeemRewardType = "credits" | "group";
export type RedeemAudienceType = "all" | "users" | "groups";

export interface RedeemCode {
  id: number;
  code_display: string;
  reward_type: RedeemRewardType;
  credit_amount?: number | null;
  target_group_id?: number | null;
  target_group_name?: string | null;
  audience_type: RedeemAudienceType;
  audience_ids: number[];
  max_per_user?: number | null;
  max_total?: number | null;
  redeemed_count: number;
  expires_at?: string | null;
  listed: boolean;
  is_expired: boolean;
  is_exhausted: boolean;
  is_redeemable: boolean;
  batch_id?: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface RedeemCodeRedemption {
  id: number;
  user_id: number;
  user_email?: string;
  reward_type: RedeemRewardType;
  credit_amount?: number | null;
  target_group_id?: number | null;
  target_group_name?: string | null;
  group_changed: boolean;
  created_at: string;
}

export interface RedeemCodeResultCredits {
  reward_type: "credits";
  credit_amount: number;
  balance: number;
}

export interface RedeemCodeResultGroup {
  reward_type: "group";
  target_group_id: number;
  target_group_name: string;
  group_changed: boolean;
}

export type RedeemCodeResult = RedeemCodeResultCredits | RedeemCodeResultGroup;

export interface CreateRedeemCodePayload {
  code: string;
  reward_type: RedeemRewardType;
  credit_amount?: number;
  target_group_id?: number;
  audience_type: RedeemAudienceType;
  audience_ids?: number[];
  max_per_user?: number | null;
  max_total?: number | null;
  expires_at?: string | null;
}

export interface BatchRedeemCodePayload {
  count?: number;
  reward_type: RedeemRewardType;
  credit_amount?: number;
  target_group_id?: number;
  audience_type: RedeemAudienceType;
  audience_ids?: number[];
  expires_at?: string | null;
}

export interface ApiResponse<T> {
  code: number;
  message: string;
  message_key?: string;
  data: T;
}

export interface PaginatedResponse<T> extends ApiResponse<T> {
  total: number;
  page: number;
  per_page: number;
}

export interface Stats {
  users: number;
  domains: number;
  subdomains: number;
  dns_records: number;
  user_groups: number;
}

export interface AuditLog {
  id: number;
  user_id: number;
  action: string;
  resource: string;
  resource_id: number;
  details: Record<string, unknown>;
  user?: User;
  created_at: string;
}

export interface DNSProviderZone {
  id: string;
  name: string;
  status: string;
}

export type DNSProviderCode =
  | "cloudflare"
  | "dnspod"
  | "aliyun_dns"
  | "dns_com"
  | "dnsla"
  | "westcn_dns"
  | "huawei_cloud_dns"
  | "baidu_cloud_dns"
  | "aws_route53"
  | "google_cloud_dns";

export type DNSProviderAccountStatus = "active" | "degraded" | "disabled";

export interface DNSProviderAccount {
  id: number;
  provider: DNSProviderCode;
  name: string;
  credential_hint: string;
  status: DNSProviderAccountStatus;
  last_verified_at?: string | null;
  last_error_category?: string | null;
  last_error_message?: string | null;
  created_at: string;
  updated_at: string;
}

// ---- Migration Types ----

export type MigrationTaskStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "partial_failed"
  | "failed"
  | "cancelled";

export type MigrationItemStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export interface DomainDNSMigrationTask {
  id: number;
  domain_id: number;
  status: MigrationTaskStatus;
  queue_seq: number;
  triggered_by: number;
  source_provider: DNSProviderCode;
  source_account_id: number;
  source_zone_id: string;
  target_provider: DNSProviderCode;
  target_account_id: number;
  target_zone_id: string;
  reason?: string;
  total_items: number;
  succeeded_items: number;
  failed_items: number;
  retried_items: number;
  last_error_category?: string | null;
  last_error_message?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DomainDNSMigrationItem {
  id: number;
  task_id: number;
  dns_record_id: number;
  record_type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  source_provider_record_id?: string;
  target_provider_record_id?: string;
  status: MigrationItemStatus;
  attempts: number;
  last_error_category?: string | null;
  last_error_message?: string | null;
  conflict_overwritten: boolean;
  finished_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMigrationResult {
  task_id: number;
  status: MigrationTaskStatus;
  queue_position: number;
  domain_migration_state: string;
}

export interface RetryFailuresResult {
  retried_items: number;
  remaining_failed_items: number;
  status: MigrationTaskStatus;
}

export interface CleanupSourceResult {
  cleanup_total: number;
  cleanup_succeeded: number;
  cleanup_failed: number;
}

// ---- Provider Status ----

export interface DNSProviderStatusEntry {
  provider: DNSProviderCode;
  accounts_total: number;
  accounts_active: number;
  last_verified_at?: string | null;
  last_failure_at?: string | null;
  last_failure_category?: string | null;
  failure_count_24h: number;
  migration_queue_size: number;
  health: "healthy" | "degraded" | "unhealthy";
}

export interface DNSBulkJob {
  id: number;
  scope: string;
  status: "pending" | "running" | "succeeded" | "failed";
  total_items: number;
  succeeded_items: number;
  failed_items: number;
  max_attempts: number;
  message: string;
  started_at?: string;
  finished_at?: string;
  created_at: string;
  updated_at: string;
}

export interface DNSBulkJobItem {
  id: number;
  job_id: number;
  record_id: number;
  subdomain_fqdn: string;
  provider: string;
  provider_account_id: number;
  zone_id: string;
  provider_record_id: string;
  record_type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  attempts: number;
  status: "pending" | "running" | "succeeded" | "failed";
  last_error: string;
  finished_at?: string;
  created_at: string;
  updated_at: string;
}

export interface DomainGroupAccess {
  id: number;
  domain_id: number;
  group_id: number;
  credit_cost: number;
  max_dns_records?: number | null;
  group?: UserGroup;
  created_at: string;
  updated_at: string;
}

export interface DomainWithGroupAccess extends Domain {
  group_access: DomainGroupAccess[];
}

export interface Notification {
  id: number;
  title: string;
  content: string;
  message_key?: string;
  message_args?: Record<string, unknown> | string;
  type: "normal" | "urgent" | "pinned";
  target_type: "users" | "groups" | "all";
  target_ids?: number[];
  visible_to_new: boolean;
  created_by: number;
  creator?: User;
  is_read?: boolean;
  read_count?: number;
  created_at: string;
  updated_at?: string;
}

export interface OffsetPaginatedResponse<T> {
  code: number;
  message: string;
  data: T;
  total: number;
  offset: number;
  limit: number;
}

export interface ReferralRecord {
  id: number;
  invitee_name: string;
  invitee_created_at: string;
  inviter_credits: number;
  created_at: string;
}

export interface ReferralInfo {
  referral_code: string;
  referral_enabled: boolean;
  records: ReferralRecord[];
  total: number;
  page: number;
  per_page: number;
}

export interface UserWithInviter extends User {
  credits: number;
  invited_by?: {
    id: number;
    name: string;
    email: string;
  };
}

export interface AdminDNSRecord extends DNSRecord {
  user_id: number;
  user_email: string;
  user_name: string;
  domain_id: number;
  domain_name: string;
}

export interface AdminClaimedSubdomain {
  id: number;
  domain_id: number;
  user_id: number;
  fqdn: string;
  domain_name: string;
  user_email: string;
  dns_record_count: number;
  created_at: string;
}

export interface ReservedSubdomainPrefixSettings {
  prefixes: string[];
  min_length: number;
  max_length: number;
}

export interface SubdomainLengthSettings {
  min_length: number;
  max_length: number;
}

export interface BrandingResponse {
  name: string;
  logo_url: string | null;
  favicon_url: string | null;
  version: string;
}

export interface AdminURLRuntime {
  frontend_urls: string[];
  backend_urls: string[];
  frontend_url: string;
  backend_url: string;
  frontend_source: "env" | "db" | "auto" | "fallback";
  backend_source: "env" | "db" | "auto" | "fallback";
  frontend_env_locked: boolean;
  backend_env_locked: boolean;
  confirmed: boolean;
}

export interface AdminOIDCRuntime {
  configured: boolean;
  missing_fields: string[];
  issuer: string;
  client_id: string;
  issuer_source: "env" | "db" | "none";
  client_id_source: "env" | "db" | "none";
  client_secret_source: "env" | "db" | "none";
  issuer_env_locked: boolean;
  client_id_env_locked: boolean;
  client_secret_env_locked: boolean;
  client_secret_configured: boolean;
}

export interface AdminConfigPayload {
  values: Record<string, string>;
  url_runtime: AdminURLRuntime;
  oidc_runtime: AdminOIDCRuntime;
}

export interface OIDCStatusPayload extends AdminOIDCRuntime {
  setup_allowed: boolean;
}

// ---- Subdomain Claim Rule (子域创建规则) ----

export interface SubdomainClaimRule {
  id: number;
  name: string;
  enabled: boolean;
  description?: string;
  match_type: "keyword" | "regex";
  keywords: string[];
  keyword_logic: "any" | "all";
  pattern: string;
  case_sensitive: boolean;
  action: "reject" | "reject_notify";
  reject_message: string;
  scope_domain_ids: number[];
  hit_count: number;
  last_hit_at?: string | null;
  last_hit_fqdn?: string;
  created_by: number;
  updated_by: number;
  created_at: string;
  updated_at: string;
}

export interface SubdomainClaimRuleTestResult {
  allowed: boolean;
  rule: {
    rule_id: number;
    rule_name: string;
    action: string;
    message: string;
  } | null;
}
