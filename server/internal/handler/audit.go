package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"hl6-server/internal/apperr"
	"hl6-server/internal/helpers"
	"hl6-server/internal/model"
	"hl6-server/internal/repository"
	"hl6-server/internal/service"
	"hl6-server/pkg/audit"
	"hl6-server/pkg/response"
)

// auditLogIfAdmin 在当前用户为管理员时写入审计行（否则无操作）。
func auditLogIfAdmin(svc *service.AuditLogService, c *gin.Context, action, resource string, resourceID uint, details map[string]any) {
	admin := currentUser(c)
	if admin == nil || svc == nil {
		return
	}
	_ = svc.RecordFromHTTP(c, admin.ID, action, resource, resourceID, details)
}

// auditLogForUser 在用户非 nil 时写入审计行（如已认证用户操作）。
func auditLogForUser(svc *service.AuditLogService, c *gin.Context, user *model.User, action, resource string, resourceID uint, details map[string]any) {
	if user == nil || svc == nil {
		return
	}
	_ = svc.RecordFromHTTP(c, user.ID, action, resource, resourceID, details)
}

// stringMapToAny 将 string map 的值复制到 map[string]any，供审计载荷使用。
func stringMapToAny(m map[string]string) map[string]any {
	if m == nil {
		return nil
	}
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// AuditHandler 管理端审查工作台与规则 API。
type AuditHandler struct {
	repo     *repository.Repository
	auditSvc *service.AuditService
	subSvc   *service.SubdomainService
	ops      *service.DNSOperationService
	enqueue  *service.AuditEnqueueService
	notif    *service.NotificationService
	auditLog *service.AuditLogService
}

func NewAuditHandler(
	repo *repository.Repository,
	auditSvc *service.AuditService,
	subSvc *service.SubdomainService,
	ops *service.DNSOperationService,
	enqueue *service.AuditEnqueueService,
	notif *service.NotificationService,
	auditLog *service.AuditLogService,
) *AuditHandler {
	return &AuditHandler{
		repo:     repo,
		auditSvc: auditSvc,
		subSvc:   subSvc,
		ops:      ops,
		enqueue:  enqueue,
		notif:    notif,
		auditLog: auditLog,
	}
}

type auditRuleListItem struct {
	model.AuditRule
	HitCount    int64      `json:"hit_count"`
	LastHitAt   *time.Time `json:"last_hit_at"`
	LastHitFQDN string     `json:"last_hit_fqdn"`
}

type auditRuleBody struct {
	Name           string   `json:"name"`
	Enabled        *bool    `json:"enabled"`
	ScenarioID     string   `json:"scenario_id"`
	Description    string   `json:"description"`
	Targets        []string `json:"targets"`
	MatchType      string   `json:"match_type"`
	Keywords       []string `json:"keywords"`
	KeywordLogic   string   `json:"keyword_logic"`
	Pattern        string   `json:"pattern"`
	CaseSensitive  bool     `json:"case_sensitive"`
	Action               string `json:"action"`
	ScopeDomainIDs       []uint `json:"scope_domain_ids"`
	BanNotifyContent     string `json:"ban_notify_content"`
	ExemptEnabled        bool   `json:"exempt_enabled"`
	ExemptRecheckMinutes int    `json:"exempt_recheck_minutes"`
	ExemptNotifyContent  string `json:"exempt_notify_content"`
}

func (b auditRuleBody) toModel() *model.AuditRule {
	return &model.AuditRule{
		Name:           strings.TrimSpace(b.Name),
		ScenarioID:     strings.TrimSpace(b.ScenarioID),
		Description:    strings.TrimSpace(b.Description),
		Targets:        model.StringSlice(b.Targets),
		MatchType:      b.MatchType,
		Keywords:       model.StringSlice(b.Keywords),
		KeywordLogic:   b.KeywordLogic,
		Pattern:        strings.TrimSpace(b.Pattern),
		CaseSensitive:  b.CaseSensitive,
		Action:               b.Action,
		ScopeDomainIDs:       model.UintSlice(b.ScopeDomainIDs),
		BanNotifyContent:     strings.TrimSpace(b.BanNotifyContent),
		ExemptEnabled:        b.ExemptEnabled,
		ExemptRecheckMinutes: b.ExemptRecheckMinutes,
		ExemptNotifyContent:  strings.TrimSpace(b.ExemptNotifyContent),
	}
}

func (h *AuditHandler) applyRuleBody(rule *model.AuditRule, body auditRuleBody, partial bool) {
	if !partial || body.Name != "" {
		rule.Name = strings.TrimSpace(body.Name)
	}
	if body.Enabled != nil {
		rule.Enabled = *body.Enabled
	}
	if !partial {
		rule.ScenarioID = strings.TrimSpace(body.ScenarioID)
	}
	if !partial {
		rule.Description = strings.TrimSpace(body.Description)
	}
	if len(body.Targets) > 0 || !partial {
		rule.Targets = model.StringSlice(body.Targets)
	}
	if body.MatchType != "" || !partial {
		rule.MatchType = body.MatchType
	}
	if len(body.Keywords) > 0 || !partial {
		rule.Keywords = model.StringSlice(body.Keywords)
	}
	if body.KeywordLogic != "" || !partial {
		rule.KeywordLogic = body.KeywordLogic
	}
	if body.Pattern != "" || !partial {
		rule.Pattern = strings.TrimSpace(body.Pattern)
	}
	if !partial {
		rule.CaseSensitive = body.CaseSensitive
	}
	if body.Action != "" || !partial {
		rule.Action = body.Action
	}
	if body.ScopeDomainIDs != nil || !partial {
		rule.ScopeDomainIDs = model.UintSlice(body.ScopeDomainIDs)
	}
	if !partial {
		rule.BanNotifyContent = strings.TrimSpace(body.BanNotifyContent)
		rule.ExemptEnabled = body.ExemptEnabled
		rule.ExemptRecheckMinutes = body.ExemptRecheckMinutes
		rule.ExemptNotifyContent = strings.TrimSpace(body.ExemptNotifyContent)
	}
}

// --- Workbench ---

func (h *AuditHandler) GetSummary(c *gin.Context) {
	summary, err := h.repo.GetAuditSummary()
	if err != nil {
		response.InternalError(c, apperr.KeyFailedToListAuditScans)
		return
	}
	response.OK(c, summary)
}

func (h *AuditHandler) ListCases(c *gin.Context) {
	page, perPage := helpers.ParsePageParams(c, 20, 100)
	filter := repository.AuditCasesFilter{
		Statuses:    queryStringSlice(c, "status"),
		ScanStatus:  strings.TrimSpace(c.Query("scan_status")),
		RuleIDs:     queryUintSlice(c, "rule_id"),
		DomainIDs:    queryUintSlice(c, "domain_id"),
		GroupID:      queryOptionalUint(c, "group_id"),
		RecordTypes:  normalizeDNSRecordTypes(queryStringSlice(c, "record_type")),
		Search:       strings.TrimSpace(c.Query("search")),
		UserEmail:    strings.TrimSpace(c.Query("user_email")),
		FQDN:         strings.TrimSpace(c.Query("fqdn")),
		Sort:         strings.TrimSpace(c.Query("sort")),
	}
	filter.SuspendedFrom = queryTimePtr(c, "suspended_from")
	filter.SuspendedTo = queryTimePtr(c, "suspended_to")
	filter.ScanFrom = queryTimePtr(c, "scan_from")
	filter.ScanTo = queryTimePtr(c, "scan_to")

	items, total, err := h.repo.ListAuditCases(page, perPage, filter)
	if err != nil {
		response.InternalError(c, apperr.KeyFailedToListAuditScans)
		return
	}
	response.Paginated(c, items, total, page, perPage)
}

func (h *AuditHandler) GetSubdomainDetail(c *gin.Context) {
	id, ok := helpers.RequireUintPathUint(c, "id")
	if !ok {
		return
	}
	bundle, err := h.repo.GetAuditSubdomainDetail(id)
	if err != nil {
		response.NotFound(c, apperr.KeySubdomainNotFound)
		return
	}
	response.OK(c, bundle)
}

func (h *AuditHandler) ListSubdomainScans(c *gin.Context) {
	id, ok := helpers.RequireUintPathUint(c, "id")
	if !ok {
		return
	}
	page, perPage := helpers.ParsePageParams(c, 20, 100)
	scans, total, err := h.repo.ListScansBySubdomain(id, page, perPage)
	if err != nil {
		response.InternalError(c, apperr.KeyFailedToListAuditScans)
		return
	}
	response.Paginated(c, scans, total, page, perPage)
}

func (h *AuditHandler) RestoreSubdomain(c *gin.Context) {
	if _, ok := requireUser(c); !ok {
		return
	}
	id, ok := helpers.RequireUintPathUint(c, "id")
	if !ok {
		return
	}
	sub, err := h.repo.FindSubdomain(id)
	if err != nil {
		response.NotFound(c, apperr.KeySubdomainNotFound)
		return
	}
	if sub.Status != model.SubdomainStatusSuspended {
		response.Conflict(c, apperr.KeySubdomainNotSuspended)
		return
	}
	if err := h.auditSvc.RestoreSubdomain(c.Request.Context(), sub); err != nil {
		response.InternalError(c, apperr.KeyFailedToRestoreSubdomain)
		return
	}
	auditLogIfAdmin(h.auditLog, c, model.AuditActionAuditRestoreSubdomain, "subdomain", sub.ID, map[string]any{"fqdn": sub.FQDN})
	response.OK(c, gin.H{"restored": true, "fqdn": sub.FQDN})
}

func (h *AuditHandler) ReleaseSubdomain(c *gin.Context) {
	admin, ok := requireUser(c)
	if !ok {
		return
	}
	id, ok := helpers.RequireUintPathUint(c, "id")
	if !ok {
		return
	}
	body, ok := response.BindJSONOrEmpty[struct {
		Notify bool   `json:"notify"`
		Reason string `json:"reason"`
	}](c)
	if !ok {
		return
	}
	reason := strings.TrimSpace(body.Reason)

	sub, err := h.repo.FindSubdomain(id)
	if err != nil {
		response.NotFound(c, apperr.KeySubdomainNotFound)
		return
	}

	key, ok := idempotencyKeyFromHeader(c)
	if !ok {
		return
	}
	scope := fmt.Sprintf("admin:audit:release:%d", sub.ID)
	result := h.ops.ExecuteIdempotent(c.Request.Context(), scope, key, func(ctx context.Context) (service.OperationResult, error) {
		res := h.subSvc.ReleaseSubdomain(ctx, sub, service.ReleaseOpts{
			ActorID:     admin.ID,
			AuditAction: "admin_release_subdomain",
			AuditExtra: map[string]interface{}{
				"user_id": sub.UserID,
				"notify":  body.Notify,
			},
		})
		if res.HTTPStatus == http.StatusOK && body.Notify {
			h.notifySubdomainReleased(sub, admin.ID, reason)
		}
		return res, nil
	})
	writeOperationResult(c, result)
}

func (h *AuditHandler) notifySubdomainReleased(sub *model.Subdomain, adminID uint, reason string) {
	title := sub.FQDN
	args, _ := json.Marshal(map[string]any{"fqdn": sub.FQDN, "reason": reason})
	_, _ = h.notif.NotifyUsers([]uint{sub.UserID}, adminID, "urgent", title, " ", "notification.subdomainReleasedByAdmin", args)
}

const auditBulkRescanMax = 100

func (h *AuditHandler) RescanSubdomain(c *gin.Context) {
	if _, ok := requireUser(c); !ok {
		return
	}
	id, ok := helpers.RequireUintPathUint(c, "id")
	if !ok {
		return
	}
	sub, err := h.repo.FindSubdomain(id)
	if err != nil {
		response.NotFound(c, apperr.KeySubdomainNotFound)
		return
	}
	if sub.Status != model.SubdomainStatusActive {
		response.Conflict(c, apperr.KeySubdomainSuspended)
		return
	}
	if !audit.SubdomainHasScannableActiveDNS(sub.DNSRecords) {
		response.Conflict(c, apperr.KeyAuditSubdomainNotScannable)
		return
	}
	if err := h.enqueue.EnqueueScan(c.Request.Context(), sub.ID, sub.FQDN, "manual", service.EnqueueOpts{BypassDedup: true}); err != nil {
		response.InternalError(c, apperr.KeyFailedToListAuditScans)
		return
	}
	response.OK(c, gin.H{"queued": true, "fqdn": sub.FQDN})
}

type bulkRescanSkipDetail struct {
	ID     uint   `json:"id"`
	Reason string `json:"reason"`
}

func (h *AuditHandler) BulkRescan(c *gin.Context) {
	body, ok := response.BindJSON[struct {
		SubdomainIDs []uint `json:"subdomain_ids" binding:"required"`
	}](c)
	if !ok {
		return
	}
	if len(body.SubdomainIDs) == 0 {
		response.BadRequest(c, apperr.KeyInvalidRequestBody)
		return
	}
	if len(body.SubdomainIDs) > auditBulkRescanMax {
		response.BadRequest(c, apperr.KeyAuditBulkRescanTooMany)
		return
	}

	subs, err := h.repo.ListSubdomainsByIDs(body.SubdomainIDs)
	if err != nil {
		response.InternalError(c, apperr.KeyFailedToListAuditScans)
		return
	}

	found := make(map[uint]model.Subdomain, len(subs))
	for _, sub := range subs {
		found[sub.ID] = sub
	}

	var skipped []bulkRescanSkipDetail
	var enqueueErrors []bulkRescanSkipDetail
	queued := 0
	ctx := c.Request.Context()

	for _, id := range body.SubdomainIDs {
		sub, ok := found[id]
		if !ok {
			skipped = append(skipped, bulkRescanSkipDetail{ID: id, Reason: "not_found"})
			continue
		}
		if sub.Status != model.SubdomainStatusActive {
			skipped = append(skipped, bulkRescanSkipDetail{ID: id, Reason: "suspended"})
			continue
		}
		if !audit.SubdomainHasScannableActiveDNS(sub.DNSRecords) {
			skipped = append(skipped, bulkRescanSkipDetail{ID: id, Reason: "not_scannable"})
			continue
		}
		if err := h.enqueue.EnqueueScan(ctx, sub.ID, sub.FQDN, "bulk", service.EnqueueOpts{BypassDedup: true}); err != nil {
			enqueueErrors = append(enqueueErrors, bulkRescanSkipDetail{ID: id, Reason: err.Error()})
			continue
		}
		queued++
	}

	payload := gin.H{
		"queued":          queued,
		"skipped":         len(skipped),
		"skipped_details": skipped,
	}
	if len(enqueueErrors) > 0 {
		payload["errors"] = enqueueErrors
	}
	if queued == 0 {
		response.ErrorWithKeyData(c, http.StatusConflict, "no subdomains queued for rescan", apperr.KeyAuditBulkRescanNoneQueued, payload)
		return
	}
	response.OK(c, payload)
}

// --- Rules ---

func (h *AuditHandler) ListRules(c *gin.Context) {
	rules, err := h.repo.ListAuditRules()
	if err != nil {
		response.InternalError(c, apperr.KeyFailedToListAuditRules)
		return
	}
	if rules == nil {
		rules = []model.AuditRule{}
	}
	ids := make([]uint, len(rules))
	for i := range rules {
		ids[i] = rules[i].ID
	}
	stats, err := h.repo.ListAuditRuleHitStats(ids)
	if err != nil {
		response.InternalError(c, apperr.KeyFailedToListAuditRules)
		return
	}
	out := make([]auditRuleListItem, len(rules))
	for i, rule := range rules {
		s := stats[rule.ID]
		out[i] = auditRuleListItem{
			AuditRule:   rule,
			HitCount:    s.HitCount,
			LastHitAt:   s.LastHitAt,
			LastHitFQDN: s.LastHitFQDN,
		}
	}
	response.OK(c, out)
}

func (h *AuditHandler) ListScenarios(c *gin.Context) {
	response.OK(c, service.ListAuditScenarios())
}

func (h *AuditHandler) CreateRule(c *gin.Context) {
	admin, ok := requireUser(c)
	if !ok {
		return
	}
	bi, ok := response.BindJSON[auditRuleBody](c)
	if !ok {
		return
	}
	body := *bi
	enabled := true
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	rule := body.toModel()
	rule.Enabled = enabled
	rule.CreatedBy = admin.ID

	if err := service.ValidateAuditRuleScope(rule, h.repo.DomainExists); err != nil {
		if key, ok := auditValidationKey(err); ok {
			response.BadRequest(c, key)
			return
		}
		response.BadRequest(c, apperr.KeyInvalidRequestBody)
		return
	}
	if err := h.repo.CreateAuditRule(rule); err != nil {
		response.InternalError(c, apperr.KeyFailedToCreateAuditRule)
		return
	}
	auditLogIfAdmin(h.auditLog, c, "admin_create_audit_rule", "audit_rule", rule.ID, map[string]any{
		"name": rule.Name, "targets": rule.Targets, "action": rule.Action,
	})
	response.Created(c, rule)
}

func (h *AuditHandler) UpdateRule(c *gin.Context) {
	admin, ok := requireUser(c)
	if !ok {
		return
	}
	id, ok := helpers.RequireUintPathUint(c, "id")
	if !ok {
		return
	}
	rule, err := h.repo.FindAuditRule(id)
	if err != nil {
		response.NotFound(c, apperr.KeyAuditRuleNotFound)
		return
	}
	bi, ok := response.BindJSON[auditRuleBody](c)
	if !ok {
		return
	}
	// partial=false 全量覆盖；前端始终发完整对象，暂无局部更新需求
	h.applyRuleBody(rule, *bi, false)
	rule.UpdatedBy = admin.ID

	if err := service.ValidateAuditRuleScope(rule, h.repo.DomainExists); err != nil {
		if key, ok := auditValidationKey(err); ok {
			response.BadRequest(c, key)
			return
		}
		response.BadRequest(c, apperr.KeyInvalidRequestBody)
		return
	}
	if err := h.repo.UpdateAuditRule(rule); err != nil {
		response.InternalError(c, apperr.KeyFailedToUpdateAuditRule)
		return
	}
	auditLogIfAdmin(h.auditLog, c, "admin_update_audit_rule", "audit_rule", rule.ID, map[string]any{
		"name": rule.Name, "enabled": rule.Enabled, "action": rule.Action,
	})
	response.OK(c, rule)
}

func (h *AuditHandler) DeleteRule(c *gin.Context) {
	id, ok := helpers.RequireUintPathUint(c, "id")
	if !ok {
		return
	}
	rule, err := h.repo.FindAuditRule(id)
	if err != nil {
		response.NotFound(c, apperr.KeyAuditRuleNotFound)
		return
	}
	if err := h.repo.DeleteAuditRule(id); err != nil {
		response.InternalError(c, apperr.KeyFailedToDeleteAuditRule)
		return
	}
	auditLogIfAdmin(h.auditLog, c, "admin_delete_audit_rule", "audit_rule", id, map[string]any{"name": rule.Name})
	response.OK(c, gin.H{"deleted": true})
}

func (h *AuditHandler) ToggleRule(c *gin.Context) {
	id, ok := helpers.RequireUintPathUint(c, "id")
	if !ok {
		return
	}
	rule, err := h.repo.FindAuditRule(id)
	if err != nil {
		response.NotFound(c, apperr.KeyAuditRuleNotFound)
		return
	}
	rule.Enabled = !rule.Enabled
	if err := h.repo.UpdateAuditRule(rule); err != nil {
		response.InternalError(c, apperr.KeyFailedToUpdateAuditRule)
		return
	}
	auditLogIfAdmin(h.auditLog, c, "admin_toggle_audit_rule", "audit_rule", rule.ID, map[string]any{
		"name": rule.Name, "enabled": rule.Enabled,
	})
	response.OK(c, rule)
}

func (h *AuditHandler) TestRule(c *gin.Context) {
	body, ok := response.BindJSON[struct {
		FQDN   string         `json:"fqdn" binding:"required"`
		Rule   *auditRuleBody `json:"rule"`
		RuleID *uint          `json:"rule_id"`
	}](c)
	if !ok {
		return
	}
	fqdn := strings.TrimSpace(body.FQDN)
	if fqdn == "" {
		response.BadRequest(c, apperr.KeyInvalidRequestBody)
		return
	}

	var domainID uint
	var rules []model.AuditRule

	if body.Rule != nil {
		draft := body.Rule.toModel()
		draft.Enabled = true
		if err := service.ValidateAuditRule(draft); err != nil {
			if key, ok := auditValidationKey(err); ok {
				response.BadRequest(c, key)
				return
			}
			response.BadRequest(c, apperr.KeyInvalidRequestBody)
			return
		}
		if err := service.ValidateAuditRuleScope(draft, h.repo.DomainExists); err != nil {
			if key, ok := auditValidationKey(err); ok {
				response.BadRequest(c, key)
				return
			}
			response.BadRequest(c, apperr.KeyInvalidRequestBody)
			return
		}
		rules = []model.AuditRule{*draft}
	} else if body.RuleID != nil {
		rule, err := h.repo.FindAuditRule(*body.RuleID)
		if err != nil {
			response.NotFound(c, apperr.KeyAuditRuleNotFound)
			return
		}
		rules = []model.AuditRule{*rule}
	} else {
		response.BadRequest(c, apperr.KeyInvalidRequestBody)
		return
	}

	if len(rules) > 0 && len(rules[0].ScopeDomainIDs) == 1 {
		domainID = rules[0].ScopeDomainIDs[0]
	} else {
		parts := strings.SplitN(fqdn, ".", 2)
		if len(parts) == 2 {
			if sub, err := h.repo.FindSubdomainByFQDN(fqdn); err == nil {
				domainID = sub.DomainID
			}
		}
	}

	dual, matches, primary := h.auditSvc.TestRuleMatch(c.Request.Context(), fqdn, domainID, rules)
	primaryAction := ""
	wouldSuspend := false
	wouldRelease := false
	wouldDeleteDNS := false
	wouldExempt := false
	wouldSendBanNotify := false
	wouldSendExemptNotify := false
	if primary != nil {
		primaryAction = primary.Rule.Action
		if primary.Rule.ExemptEnabled {
			wouldExempt = true
			if strings.TrimSpace(primary.Rule.ExemptNotifyContent) != "" {
				wouldSendExemptNotify = true
			}
		} else {
			wouldRelease = primaryAction == model.AuditActionSite
			wouldSuspend = primaryAction == model.AuditActionUser
			wouldDeleteDNS = primaryAction == model.AuditActionDeleteDNS
			if strings.TrimSpace(primary.Rule.BanNotifyContent) != "" &&
				(wouldSuspend || wouldDeleteDNS || wouldRelease || primaryAction == model.AuditActionObserve) {
				wouldSendBanNotify = true
			}
		}
	}

	channelPayload := func(ch audit.ChannelResult) gin.H {
		title := ch.Title
		if len(title) > 120 {
			title = title[:120]
		}
		return gin.H{
			"status":           ch.Status,
			"http_status_code": ch.StatusCode,
			"final_url":        ch.FinalURL,
			"title_preview":    title,
			"error_message":    ch.ErrorMessage,
		}
	}

	response.OK(c, gin.H{
		"fetch": gin.H{
			"https": channelPayload(dual.HTTPS),
			"http":  channelPayload(dual.HTTP),
		},
		"matched_rules":    service.ToMatchedRuleHits(matches),
		"primary_action":        primaryAction,
		"would_suspend":         wouldSuspend,
		"would_release":         wouldRelease,
		"would_delete_dns":      wouldDeleteDNS,
		"would_exempt":          wouldExempt,
		"would_send_ban_notify": wouldSendBanNotify,
		"would_send_exempt_notify": wouldSendExemptNotify,
	})
}

// --- Scan history ---

func (h *AuditHandler) ListScans(c *gin.Context) {
	page, perPage := helpers.ParsePageParams(c, 20, 100)
	filter := repository.AuditScanListFilter{
		Statuses:  queryStringSlice(c, "status"),
		RuleIDs:   queryUintSlice(c, "rule_id"),
		FQDN:      strings.TrimSpace(c.Query("fqdn")),
		UserEmail: strings.TrimSpace(c.Query("user_email")),
		From:      queryTimePtr(c, "from"),
		To:        queryTimePtr(c, "to"),
	}
	if raw := c.Query("subdomain_id"); raw != "" {
		id, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			response.BadRequest(c, apperr.KeyInvalidID)
			return
		}
		uid := uint(id)
		filter.SubdomainID = &uid
	}
	scans, total, err := h.repo.AdminListScans(page, perPage, filter)
	if err != nil {
		response.InternalError(c, apperr.KeyFailedToListAuditScans)
		return
	}
	response.Paginated(c, scans, total, page, perPage)
}

func (h *AuditHandler) GetScan(c *gin.Context) {
	id, ok := helpers.RequireUintPathUint(c, "id")
	if !ok {
		return
	}
	scan, err := h.repo.FindSubdomainScan(id)
	if err != nil {
		response.NotFound(c, apperr.KeyAuditScanNotFound)
		return
	}
	response.OK(c, scan)
}

func auditValidationKey(err error) (string, bool) {
	var ve *service.AuditRuleValidationError
	if errors.As(err, &ve) && ve.Key != "" {
		return ve.Key, true
	}
	return "", false
}

func queryStringSlice(c *gin.Context, key string) []string {
	if vals, ok := c.GetQueryArray(key + "[]"); ok && len(vals) > 0 {
		return vals
	}
	raw := c.Query(key)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func queryUintSlice(c *gin.Context, key string) []uint {
	strs := queryStringSlice(c, key)
	if len(strs) == 0 {
		return nil
	}
	out := make([]uint, 0, len(strs))
	for _, s := range strs {
		n, err := strconv.ParseUint(s, 10, 64)
		if err == nil {
			out = append(out, uint(n))
		}
	}
	return out
}

func normalizeDNSRecordTypes(types []string) []string {
	if len(types) == 0 {
		return nil
	}
	allowed := map[string]string{
		"a": "A", "aaaa": "AAAA", "cname": "CNAME", "txt": "TXT", "ns": "NS", "mx": "MX",
		"A": "A", "AAAA": "AAAA", "CNAME": "CNAME", "TXT": "TXT", "NS": "NS", "MX": "MX",
	}
	out := make([]string, 0, len(types))
	seen := make(map[string]struct{}, len(types))
	for _, raw := range types {
		t, ok := allowed[strings.TrimSpace(raw)]
		if !ok {
			continue
		}
		if _, dup := seen[t]; dup {
			continue
		}
		seen[t] = struct{}{}
		out = append(out, t)
	}
	return out
}

func queryOptionalUint(c *gin.Context, key string) *uint {
	raw := strings.TrimSpace(c.Query(key))
	if raw == "" {
		return nil
	}
	n, err := strconv.ParseUint(raw, 10, 64)
	if err != nil {
		return nil
	}
	uid := uint(n)
	return &uid
}

func queryTimePtr(c *gin.Context, key string) *time.Time {
	raw := strings.TrimSpace(c.Query(key))
	if raw == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil
	}
	return &t
}
