package model

import (
	"encoding/json"
	"strings"
	"time"
)

type User struct {
	ID           uint       `json:"id" gorm:"primaryKey"`
	ExternalID   string     `json:"external_id" gorm:"column:external_id;uniqueIndex;not null"`
	Email        string     `json:"email"`
	Name         string     `json:"name"`
	AvatarURL    string     `json:"avatar_url"`
	Role         string     `json:"role" gorm:"default:user"`
	IsBanned     bool       `json:"is_banned" gorm:"not null;default:false;index"`
	BannedReason string     `json:"banned_reason"`
	BannedAt     *time.Time `json:"banned_at"`
	BannedBy     *uint      `json:"banned_by" gorm:"index"`
	ReferralCode string     `json:"referral_code" gorm:"uniqueIndex;size:16"`
	GroupID      *uint      `json:"group_id" gorm:"index"`
	Group        *UserGroup `json:"group,omitempty" gorm:"foreignKey:GroupID"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type UserGroup struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	Name      string    `json:"name" gorm:"uniqueIndex;not null"`
	IsDefault bool      `json:"is_default" gorm:"default:false"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type DomainGroupAccess struct {
	ID            uint      `json:"id" gorm:"primaryKey"`
	DomainID      uint      `json:"domain_id" gorm:"uniqueIndex:idx_domain_group;not null"`
	GroupID       uint      `json:"group_id" gorm:"uniqueIndex:idx_domain_group;not null"`
	CreditCost    Credit    `json:"credit_cost" gorm:"type:bigint;not null;default:10"`
	MaxDNSRecords *int      `json:"max_dns_records" gorm:"default:null"` // nil = 无限制
	Group         UserGroup `json:"group,omitempty" gorm:"foreignKey:GroupID"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type SystemConfig struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	Key       string    `json:"key" gorm:"uniqueIndex;not null"`
	Value     string    `json:"value" gorm:"not null"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Domain struct {
	ID                    uint      `json:"id" gorm:"primaryKey"`
	Name                  string    `json:"name" gorm:"uniqueIndex;not null"`
	Provider              string    `json:"provider" gorm:"type:varchar(32);not null;default:cloudflare;index"`
	ProviderZoneID        string    `json:"provider_zone_id" gorm:"not null"`
	ProviderAccountID     uint      `json:"provider_account_id" gorm:"not null;default:0"`
	CreditCost            Credit    `json:"credit_cost" gorm:"type:bigint;default:10"`
	IsActive              bool      `json:"is_active" gorm:"default:true"`
	Description           string    `json:"description"`
	MigrationState        string    `json:"migration_state" gorm:"type:varchar(24);not null;default:idle;index"`
	MigrationReadOnly     bool      `json:"migration_read_only" gorm:"not null;default:false"`
	LastMigrationTaskID   *uint     `json:"last_migration_task_id" gorm:"index"`
	CreatedAt             time.Time `json:"created_at"`
	UpdatedAt             time.Time `json:"updated_at"`
}

// Subdomain 状态常量
const (
	SubdomainStatusActive    = "active"
	SubdomainStatusSuspended = "suspended"
)

type Subdomain struct {
	ID              uint        `json:"id" gorm:"primaryKey"`
	DomainID        uint        `json:"domain_id" gorm:"uniqueIndex:idx_domain_name;not null"`
	UserID          uint        `json:"user_id" gorm:"index;not null"`
	Name            string      `json:"name" gorm:"uniqueIndex:idx_domain_name;not null"`
	FQDN            string      `json:"fqdn" gorm:"uniqueIndex;not null"`
	ClaimCost       Credit      `json:"claim_cost" gorm:"type:bigint;default:0"`
	Status          string      `json:"status" gorm:"type:varchar(16);not null;default:active;index"`
	SuspendedReason string      `json:"suspended_reason,omitempty"`
	SuspendedAt     *time.Time  `json:"suspended_at,omitempty"`
	Domain          Domain      `json:"domain" gorm:"foreignKey:DomainID"`
	User            User        `json:"-" gorm:"foreignKey:UserID"`
	DNSRecords      []DNSRecord `json:"dns_records,omitempty" gorm:"foreignKey:SubdomainID"`
	CreatedAt       time.Time   `json:"created_at"`
	UpdatedAt       time.Time   `json:"updated_at"`
}

// DNSRecord 状态常量
const (
	DNSRecordStatusActive    = "active"
	DNSRecordStatusSuspended = "suspended"
)

type DNSRecord struct {
	ID               uint      `json:"id" gorm:"primaryKey"`
	SubdomainID      uint      `json:"subdomain_id" gorm:"index;not null"`
	Type             string    `json:"type" gorm:"not null"`
	Name             string    `json:"name" gorm:"not null"`
	Content          string    `json:"content" gorm:"not null"`
	TTL              int       `json:"ttl" gorm:"default:1"`
	Proxied          bool      `json:"proxied" gorm:"default:false"`
	ProviderRecordID string    `json:"provider_record_id"`
	Status           string    `json:"status" gorm:"type:varchar(16);not null;default:active"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// AuditRule 管理员可配置的内容合规审核规则。
type AuditRule struct {
	ID             uint        `json:"id" gorm:"primaryKey"`
	Name           string      `json:"name" gorm:"not null"`
	Enabled        bool        `json:"enabled" gorm:"default:true;index"`
	ScenarioID     string      `json:"scenario_id" gorm:"type:varchar(32);not null;default:''"`
	Description    string      `json:"description" gorm:"type:text"`
	Targets        StringSlice `json:"targets" gorm:"type:jsonb;not null;default:'[]'"`
	MatchType      string      `json:"match_type" gorm:"type:varchar(16);not null"`
	Keywords       StringSlice `json:"keywords" gorm:"type:jsonb;not null;default:'[]'"`
	KeywordLogic   string      `json:"keyword_logic" gorm:"type:varchar(8);not null;default:any"`
	Pattern        string      `json:"pattern" gorm:"type:text"`
	CaseSensitive  bool        `json:"case_sensitive" gorm:"default:false"`
	Action               string `json:"action" gorm:"type:varchar(16);not null;default:site"`
	ScopeDomainIDs       UintSlice `json:"scope_domain_ids" gorm:"type:jsonb;not null;default:'[]'"`
	BanNotifyContent     string `json:"ban_notify_content" gorm:"type:text;not null;default:''"`
	ExemptEnabled        bool   `json:"exempt_enabled" gorm:"not null;default:false"`
	ExemptRecheckMinutes int    `json:"exempt_recheck_minutes" gorm:"not null;default:0"`
	ExemptNotifyContent  string `json:"exempt_notify_content" gorm:"type:text;not null;default:''"`
	CreatedBy            uint   `json:"created_by" gorm:"not null"`
	UpdatedBy      uint        `json:"updated_by"`
	CreatedAt      time.Time   `json:"created_at"`
	UpdatedAt      time.Time   `json:"updated_at"`
}

// AuditRule 目标常量
const (
	AuditTargetBody       = "body"
	AuditTargetTitle      = "title"
	AuditTargetFinalURL   = "final_url"
	AuditTargetStatusCode = "status_code"
)

// AuditRule 匹配类型常量
const (
	AuditMatchKeyword  = "keyword"
	AuditMatchRegex    = "regex"
	AuditMatchStatusEq    = "status_eq"
	AuditMatchUnreachable = "unreachable"
)

// AuditRule 处置档位常量
const (
	AuditActionObserve   = "observe"
	AuditActionDeleteDNS = "delete_dns"
	AuditActionSite      = "site"
	AuditActionUser      = "user"
)

// AuditRule 关键词逻辑常量
const (
	AuditKeywordLogicAny = "any"
	AuditKeywordLogicAll = "all"
)

// AuditActionAuditRestoreSubdomain 管理员恢复被封禁子域名的审计动作。
const AuditActionAuditRestoreSubdomain = "audit_restore_subdomain"

// AuditExemptionPending 子域+规则维度的豁免等待记录。
type AuditExemptionPending struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	SubdomainID uint      `json:"subdomain_id" gorm:"uniqueIndex:idx_audit_exempt_sub_rule,priority:1;not null"`
	RuleID      uint      `json:"rule_id" gorm:"uniqueIndex:idx_audit_exempt_sub_rule,priority:2;not null"`
	RecheckAt   time.Time `json:"recheck_at" gorm:"index;not null"`
	Status      string    `json:"status" gorm:"type:varchar(16);not null;default:pending;index"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

const (
	AuditExemptionStatusPending    = "pending"
	AuditExemptionStatusRechecking = "rechecking"
	AuditExemptionStatusCompleted  = "completed"
)

// AuditScanTarget 待巡检的子域名（调度/worker 传递用）。
type AuditScanTarget struct {
	ID     uint   `json:"id"`
	FQDN   string `json:"fqdn"`
	Source string `json:"source,omitempty"`
	RuleID uint   `json:"rule_id,omitempty"`
}

// SubdomainScan 每次巡检的扫描记录与违规证据。
type SubdomainScan struct {
	ID             uint              `json:"id" gorm:"primaryKey"`
	SubdomainID    uint              `json:"subdomain_id" gorm:"index;not null"`
	FQDN           string            `json:"fqdn" gorm:"not null"`
	URL            string            `json:"url"`
	Status         string            `json:"status" gorm:"type:varchar(16);not null;index"`
	HTTPStatusCode int               `json:"http_status_code"`
	FinalURL       string            `json:"final_url"`
	MatchedRules   MatchedRulesSlice `json:"matched_rules" gorm:"type:jsonb;not null;default:'[]'"`
	MatchedRuleID  *uint             `json:"matched_rule_id"`
	MatchedSnippet string                `json:"matched_snippet" gorm:"type:text"`
	ContentHash    string                `json:"content_hash"`
	FetchDetails   *DualFetchDetailsJSON `json:"fetch_details,omitempty" gorm:"type:jsonb"`
	CreatedAt      time.Time             `json:"created_at"`
	UpdatedAt      time.Time         `json:"updated_at"`
}

// SubdomainScan 状态常量
const (
	ScanStatusClean       = "clean"
	ScanStatusViolation   = "violation"
	ScanStatusUnreachable = "unreachable"
	ScanStatusError       = "error"
)

type CreditBalance struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	UserID    uint      `json:"user_id" gorm:"uniqueIndex;not null"`
	Balance   Credit    `json:"balance" gorm:"type:bigint;default:0"`
	UpdatedAt time.Time `json:"updated_at"`
}

type CreditTransaction struct {
	ID                uint            `json:"id" gorm:"primaryKey"`
	UserID            uint            `json:"user_id" gorm:"index;not null"`
	Amount            Credit          `json:"amount" gorm:"type:bigint;not null"`
	Type              string          `json:"type" gorm:"not null"`
	DescriptionKey    string          `json:"description_key"`
	DescriptionParams json.RawMessage `json:"description_params,omitempty" gorm:"type:jsonb"`
	BalanceAfter      Credit          `json:"balance_after" gorm:"type:bigint"`
	CreatedAt         time.Time       `json:"created_at"`
}

type DailyCheckinClaim struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	UserID      uint      `json:"user_id" gorm:"uniqueIndex:idx_daily_checkin_user_date;not null"`
	CheckinDate string    `json:"checkin_date" gorm:"type:date;uniqueIndex:idx_daily_checkin_user_date;not null"`
	Reward      Credit    `json:"reward" gorm:"type:bigint;not null"`
	CreatedAt   time.Time `json:"created_at"`
}

type AuditLog struct {
	ID         uint            `json:"id" gorm:"primaryKey"`
	UserID     uint            `json:"user_id" gorm:"index;not null"`
	Action     string          `json:"action" gorm:"not null"`
	Resource   string          `json:"resource"`
	ResourceID uint            `json:"resource_id"`
	Details    json.RawMessage `json:"details" gorm:"type:jsonb"`
	User       User            `json:"user,omitempty" gorm:"foreignKey:UserID"`
	CreatedAt  time.Time       `json:"created_at"`
}

// DNSProviderAccount status values
const (
	DNSProviderAccountStatusActive   = "active"
	DNSProviderAccountStatusDegraded = "degraded"
	DNSProviderAccountStatusDisabled = "disabled"
)

type DNSProviderAccount struct {
	ID                uint       `json:"id" gorm:"primaryKey"`
	Provider          string     `json:"provider" gorm:"type:varchar(32);not null;default:cloudflare;index"`
	Name              string     `json:"name" gorm:"not null"`
	Credentials       string     `json:"-" gorm:"type:text"`
	Status            string     `json:"status" gorm:"type:varchar(16);not null;default:active;index"`
	LastVerifiedAt    *time.Time `json:"last_verified_at"`
	LastErrorCategory string     `json:"last_error_category" gorm:"type:varchar(32)"`
	LastErrorMessage  string     `json:"last_error_message" gorm:"type:text"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type DNSProviderAccountView struct {
	ID                uint       `json:"id"`
	Provider          string     `json:"provider"`
	Name              string     `json:"name"`
	CredentialHint    string     `json:"credential_hint"`
	Status            string     `json:"status"`
	LastVerifiedAt    *time.Time `json:"last_verified_at"`
	LastErrorCategory string     `json:"last_error_category,omitempty"`
	LastErrorMessage  string     `json:"last_error_message,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

func (a *DNSProviderAccount) ToView() DNSProviderAccountView {
	hint := ""
	trimmed := strings.TrimSpace(a.Credentials)
	if trimmed != "" && strings.HasPrefix(trimmed, "{") {
		var m map[string]string
		if err := json.Unmarshal([]byte(trimmed), &m); err == nil {
			for _, k := range []string{
				"api_token",
				"ak",
				"access_key_id",
				"secret_id",
				"api_user",
				"username",
				"project_id",
				"api_id",
			} {
				if v := strings.TrimSpace(m[k]); v != "" {
					if len(v) > 4 {
						hint = "..." + v[len(v)-4:]
					} else {
						hint = v
					}
					break
				}
			}
		}
	}
	if hint == "" && len(trimmed) >= 4 {
		hint = "..." + trimmed[len(trimmed)-4:]
	}
	status := a.Status
	if status == "" {
		status = DNSProviderAccountStatusActive
	}
	return DNSProviderAccountView{
		ID:                a.ID,
		Provider:          a.Provider,
		Name:              a.Name,
		CredentialHint:    hint,
		Status:            status,
		LastVerifiedAt:    a.LastVerifiedAt,
		LastErrorCategory: a.LastErrorCategory,
		LastErrorMessage:  a.LastErrorMessage,
		CreatedAt:         a.CreatedAt,
		UpdatedAt:         a.UpdatedAt,
	}
}

// SubdomainClaimRule 子域创建规则——在用户申请/认领子域时对输入名称进行检测。
type SubdomainClaimRule struct {
	ID             uint        `json:"id" gorm:"primaryKey"`
	Name           string      `json:"name" gorm:"not null"`
	Enabled        bool        `json:"enabled" gorm:"default:true;index"`
	Description    string      `json:"description" gorm:"type:text"`
	MatchType      string      `json:"match_type" gorm:"type:varchar(16);not null"` // keyword / regex
	Keywords       StringSlice `json:"keywords" gorm:"type:jsonb;not null;default:'[]'"`
	KeywordLogic   string      `json:"keyword_logic" gorm:"type:varchar(8);not null;default:any"` // any / all
	Pattern        string      `json:"pattern" gorm:"type:text"` // 正则表达式
	CaseSensitive  bool        `json:"case_sensitive" gorm:"default:false"`
	Action         string      `json:"action" gorm:"type:varchar(16);not null;default:reject"` // reject / reject_notify
	RejectMessage  string      `json:"reject_message" gorm:"type:text;not null;default:''"` // 拒绝时向用户展示的消息模板
	ScopeDomainIDs UintSlice   `json:"scope_domain_ids" gorm:"type:jsonb;not null;default:'[]'"` // 空数组=全局生效
	HitCount       int         `json:"hit_count" gorm:"not null;default:0"` // 命中计数
	LastHitAt      *time.Time  `json:"last_hit_at,omitempty"`
	LastHitFQDN    string      `json:"last_hit_fqdn,omitempty"`
	CreatedBy      uint        `json:"created_by" gorm:"not null"`
	UpdatedBy      uint        `json:"updated_by"`
	CreatedAt      time.Time   `json:"created_at"`
	UpdatedAt      time.Time   `json:"updated_at"`
}

// SubdomainClaimRule 常量
const (
	ClaimRuleMatchKeyword = "keyword"
	ClaimRuleMatchRegex   = "regex"

	ClaimRuleActionReject       = "reject"
	ClaimRuleActionRejectNotify = "reject_notify"

	ClaimRuleKeywordLogicAny = "any"
	ClaimRuleKeywordLogicAll = "all"
)

func (SubdomainClaimRule) TableName() string { return "subdomain_claim_rules" }

func (DNSProviderAccount) TableName() string {
	return "dns_provider_accounts"
}

type UserReferral struct {
	ID             uint      `json:"id" gorm:"primaryKey"`
	InviterID      uint      `json:"inviter_id" gorm:"index;not null"`
	InviteeID      uint      `json:"invitee_id" gorm:"uniqueIndex;not null"`
	InviterCredits Credit    `json:"inviter_credits" gorm:"type:bigint;not null"`
	InviteeCredits Credit    `json:"invitee_credits" gorm:"type:bigint;not null"`
	Inviter        User      `json:"-" gorm:"foreignKey:InviterID"`
	Invitee        User      `json:"-" gorm:"foreignKey:InviteeID"`
	CreatedAt      time.Time `json:"created_at"`
}
