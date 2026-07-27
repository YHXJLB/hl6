package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"hl6-server/internal/helpers"
	"hl6-server/internal/model"
	"hl6-server/internal/repository"
	"hl6-server/internal/service"
	"hl6-server/pkg/response"
	"hl6-server/pkg/validator"
)

// ClaimRuleHandler 子域创建规则管理
type ClaimRuleHandler struct {
	repo   *repository.Repository
	engine *service.ClaimRuleEngine
}

func NewClaimRuleHandler(repo *repository.Repository, engine *service.ClaimRuleEngine) *ClaimRuleHandler {
	return &ClaimRuleHandler{repo: repo, engine: engine}
}

// claimRuleBody 规则创建/编辑请求体
type claimRuleBody struct {
	Name           *string   `json:"name"`
	Enabled        *bool     `json:"enabled"`
	Description    *string   `json:"description"`
	MatchType      *string   `json:"match_type"`
	Keywords       []string  `json:"keywords"`
	KeywordLogic   *string   `json:"keyword_logic"`
	Pattern        *string   `json:"pattern"`
	CaseSensitive  *bool     `json:"case_sensitive"`
	Action         *string   `json:"action"`
	RejectMessage  *string   `json:"reject_message"`
	ScopeDomainIDs []uint    `json:"scope_domain_ids"`
}

// toModel 将请求体转换为模型（用于创建）
func (b *claimRuleBody) toModel() model.SubdomainClaimRule {
	rule := model.SubdomainClaimRule{}
	if b.Name != nil {
		rule.Name = *b.Name
	}
	if b.Enabled != nil {
		rule.Enabled = *b.Enabled
	} else {
		rule.Enabled = true
	}
	if b.Description != nil {
		rule.Description = *b.Description
	}
	if b.MatchType != nil {
		rule.MatchType = *b.MatchType
	}
	if b.Keywords != nil {
		rule.Keywords = b.Keywords
	}
	if b.KeywordLogic != nil {
		rule.KeywordLogic = *b.KeywordLogic
	} else {
		rule.KeywordLogic = model.ClaimRuleKeywordLogicAny
	}
	if b.Pattern != nil {
		rule.Pattern = *b.Pattern
	}
	if b.CaseSensitive != nil {
		rule.CaseSensitive = *b.CaseSensitive
	}
	if b.Action != nil {
		rule.Action = *b.Action
	} else {
		rule.Action = model.ClaimRuleActionReject
	}
	if b.RejectMessage != nil {
		rule.RejectMessage = *b.RejectMessage
	}
	if b.ScopeDomainIDs != nil {
		rule.ScopeDomainIDs = b.ScopeDomainIDs
	} else {
		rule.ScopeDomainIDs = []uint{}
	}
	return rule
}

// applyRuleBody 将请求体字段应用到已有模型（用于更新）
func (b *claimRuleBody) applyRuleBody(rule *model.SubdomainClaimRule, partial bool) {
	if b.Name != nil {
		rule.Name = *b.Name
	}
	if b.Enabled != nil {
		rule.Enabled = *b.Enabled
	}
	if !partial || b.Description != nil {
		if b.Description != nil {
			rule.Description = *b.Description
		} else if !partial {
			rule.Description = ""
		}
	}
	if b.MatchType != nil {
		rule.MatchType = *b.MatchType
	}
	if b.Keywords != nil {
		rule.Keywords = b.Keywords
	}
	if b.KeywordLogic != nil {
		rule.KeywordLogic = *b.KeywordLogic
	}
	if b.Pattern != nil {
		rule.Pattern = *b.Pattern
	}
	if b.CaseSensitive != nil {
		rule.CaseSensitive = *b.CaseSensitive
	}
	if b.Action != nil {
		rule.Action = *b.Action
	}
	if b.RejectMessage != nil {
		rule.RejectMessage = *b.RejectMessage
	}
	if b.ScopeDomainIDs != nil {
		rule.ScopeDomainIDs = b.ScopeDomainIDs
	}
}

// ListRules GET /admin/subdomain-claim-rules
func (h *ClaimRuleHandler) ListRules(c *gin.Context) {
	rules, err := h.repo.ListSubdomainClaimRules()
	if err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to list claim rules", "error.databaseError")
		return
	}
	response.OK(c, rules)
}

// CreateRule POST /admin/subdomain-claim-rules
func (h *ClaimRuleHandler) CreateRule(c *gin.Context) {
	admin := mustGetUser(c)
	if admin == nil {
		return
	}
	var body claimRuleBody
	if err := c.ShouldBindJSON(&body); err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid request body", "error.invalidRequestBody")
		return
	}
	rule := body.toModel()
	rule.CreatedBy = admin.ID
	rule.UpdatedBy = admin.ID

	if err := validator.ValidateSubdomainClaimRule(&rule); err != nil {
		if ve, ok := err.(*validator.ClaimRuleValidationError); ok {
			response.ErrorWithKey(c, http.StatusBadRequest, "validation failed", ve.Key)
			return
		}
		response.ErrorWithKey(c, http.StatusBadRequest, err.Error(), "error.validationFailed")
		return
	}
	if err := validator.ValidateSubdomainClaimRuleScope(&rule, h.repo.DomainExists); err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid scope domain", "error.claimRuleInvalidScope")
		return
	}
	if err := h.repo.CreateSubdomainClaimRule(&rule); err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to create claim rule", "error.databaseError")
		return
	}
	h.repo.CreateAuditLog(&model.AuditLog{
		UserID: admin.ID,
		Action: "admin_create_claim_rule",
		Resource: "subdomain_claim_rule",
		ResourceID: rule.ID,
	})
	response.Created(c, rule)
}

// UpdateRule PUT /admin/subdomain-claim-rules/:id
func (h *ClaimRuleHandler) UpdateRule(c *gin.Context) {
	admin := mustGetUser(c)
	if admin == nil {
		return
	}
	id, ok := helpers.ParseUintParam(c, "id")
	if !ok {
		return
	}
	rule, err := h.repo.FindSubdomainClaimRule(id)
	if err != nil {
		response.ErrorWithKey(c, http.StatusNotFound, "claim rule not found", "error.claimRuleNotFound")
		return
	}
	var body claimRuleBody
	if err := c.ShouldBindJSON(&body); err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid request body", "error.invalidRequestBody")
		return
	}
	body.applyRuleBody(rule, false)
	rule.UpdatedBy = admin.ID

	if err := validator.ValidateSubdomainClaimRule(rule); err != nil {
		if ve, ok := err.(*validator.ClaimRuleValidationError); ok {
			response.ErrorWithKey(c, http.StatusBadRequest, "validation failed", ve.Key)
			return
		}
		response.ErrorWithKey(c, http.StatusBadRequest, err.Error(), "error.validationFailed")
		return
	}
	if err := validator.ValidateSubdomainClaimRuleScope(rule, h.repo.DomainExists); err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid scope domain", "error.claimRuleInvalidScope")
		return
	}
	if err := h.repo.UpdateSubdomainClaimRule(rule); err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to update claim rule", "error.databaseError")
		return
	}
	h.repo.CreateAuditLog(&model.AuditLog{
		UserID: admin.ID,
		Action: "admin_update_claim_rule",
		Resource: "subdomain_claim_rule",
		ResourceID: rule.ID,
	})
	response.OK(c, rule)
}

// DeleteRule DELETE /admin/subdomain-claim-rules/:id
func (h *ClaimRuleHandler) DeleteRule(c *gin.Context) {
	admin := mustGetUser(c)
	if admin == nil {
		return
	}
	id, ok := helpers.ParseUintParam(c, "id")
	if !ok {
		return
	}
	if _, err := h.repo.FindSubdomainClaimRule(id); err != nil {
		response.ErrorWithKey(c, http.StatusNotFound, "claim rule not found", "error.claimRuleNotFound")
		return
	}
	if err := h.repo.DeleteSubdomainClaimRule(id); err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to delete claim rule", "error.databaseError")
		return
	}
	h.repo.CreateAuditLog(&model.AuditLog{
		UserID: admin.ID,
		Action: "admin_delete_claim_rule",
		Resource: "subdomain_claim_rule",
		ResourceID: id,
	})
	response.OK(c, gin.H{"message": "deleted"})
}

// ToggleRule PUT /admin/subdomain-claim-rules/:id/toggle
func (h *ClaimRuleHandler) ToggleRule(c *gin.Context) {
	admin := mustGetUser(c)
	if admin == nil {
		return
	}
	id, ok := helpers.ParseUintParam(c, "id")
	if !ok {
		return
	}
	rule, err := h.repo.FindSubdomainClaimRule(id)
	if err != nil {
		response.ErrorWithKey(c, http.StatusNotFound, "claim rule not found", "error.claimRuleNotFound")
		return
	}
	newEnabled := !rule.Enabled
	if err := h.repo.ToggleSubdomainClaimRule(id, newEnabled); err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to toggle claim rule", "error.databaseError")
		return
	}
	action := "admin_enable_claim_rule"
	if !newEnabled {
		action = "admin_disable_claim_rule"
	}
	h.repo.CreateAuditLog(&model.AuditLog{
		UserID: admin.ID,
		Action: action,
		Resource: "subdomain_claim_rule",
		ResourceID: id,
	})
	response.OK(c, gin.H{"enabled": newEnabled})
}

// TestRule POST /admin/subdomain-claim-rules/test
// 测试子域名称是否命中规则，返回命中的规则信息（不实际创建任何数据）
func (h *ClaimRuleHandler) TestRule(c *gin.Context) {
	var body struct {
		SubdomainName string                   `json:"subdomain_name" binding:"required"`
		DomainID      uint                     `json:"domain_id" binding:"required"`
		DomainName    string                   `json:"domain_name" binding:"required"`
		Rule          *model.SubdomainClaimRule `json:"rule"` // 可选：用草稿规则测试
		RuleID        *uint                    `json:"rule_id"` // 可选：用已有规则 ID 测试
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid request body", "error.invalidRequestBody")
		return
	}

	var matchResult *service.ClaimRuleMatchResult

	if body.RuleID != nil {
		// 用已有规则测试（仅测试这一条规则，不受启用状态影响）
		rule, findErr := h.repo.FindSubdomainClaimRule(*body.RuleID)
		if findErr != nil {
			response.ErrorWithKey(c, http.StatusNotFound, "claim rule not found", "error.claimRuleNotFound")
			return
		}
		matchResult = service.TestSingleRule(rule, body.SubdomainName, body.DomainName, body.DomainID)
	} else if body.Rule != nil {
		// 用草稿规则测试
		if err := validator.ValidateSubdomainClaimRule(body.Rule); err != nil {
			if ve, ok := err.(*validator.ClaimRuleValidationError); ok {
				response.ErrorWithKey(c, http.StatusBadRequest, "validation failed", ve.Key)
				return
			}
			response.ErrorWithKey(c, http.StatusBadRequest, err.Error(), "error.validationFailed")
			return
		}
		matchResult = service.TestSingleRule(body.Rule, body.SubdomainName, body.DomainName, body.DomainID)
	} else {
		// 不指定规则，检测所有启用规则
		var err error
		matchResult, err = h.engine.CheckSubdomainName(c.Request.Context(), body.DomainID, body.SubdomainName, body.DomainName)
		if err != nil {
			response.ErrorWithKey(c, http.StatusInternalServerError, "test failed", "error.testFailed")
			return
		}
	}

	response.OK(c, gin.H{
		"matched":     matchResult != nil,
		"matched_rule": matchResult,
	})
}

// CheckForClaim GET /subdomains/check-rules?name=xxx&domain_id=xxx&domain_name=xxx
// 公开接口：供前端在用户输入时实时检测子域名称是否违反规则（不要求管理员权限）
func (h *ClaimRuleHandler) CheckForClaim(c *gin.Context) {
	name := strings.TrimSpace(c.Query("name"))
	domainIDStr := c.Query("domain_id")
	domainName := c.Query("domain_name")

	if name == "" || domainIDStr == "" || domainName == "" {
		response.ErrorWithKey(c, http.StatusBadRequest, "missing required parameters", "error.missingParams")
		return
	}
	domainID, err := strconv.ParseUint(domainIDStr, 10, 64)
	if err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid domain_id", "error.invalidDomainID")
		return
	}

	matchResult, err := h.engine.CheckSubdomainName(c.Request.Context(), uint(domainID), name, domainName)
	if err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "check failed", "error.checkFailed")
		return
	}

	if matchResult != nil {
		response.OK(c, gin.H{
			"allowed": false,
			"rule":    matchResult,
		})
		return
	}
	response.OK(c, gin.H{
		"allowed": true,
		"rule":    nil,
	})
}
