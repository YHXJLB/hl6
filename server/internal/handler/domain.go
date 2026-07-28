package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
	"hl6-server/internal/ctxutil"
	"hl6-server/internal/helpers"
	"hl6-server/internal/model"
	"hl6-server/internal/repository"
	"hl6-server/internal/service"
	"hl6-server/pkg/response"
)

// cfFailureRecord 记录一条 CF DNS 删除失败的信息
type cfFailureRecord struct {
	SubdomainFQDN    string `json:"subdomain_fqdn"`
	RecordType       string `json:"record_type"`
	RecordContent    string `json:"record_content"`
	ProviderRecordID string `json:"provider_record_id"`
	Error            string `json:"error"`
}

type DomainHandler struct {
	repo        *repository.Repository
	ops         *service.DNSOperationService
	ruleEngine  *service.ClaimRuleEngine
}

func NewDomainHandler(repo *repository.Repository, ops *service.DNSOperationService, ruleEngine *service.ClaimRuleEngine) *DomainHandler {
	return &DomainHandler{repo: repo, ops: ops, ruleEngine: ruleEngine}
}

func (h *DomainHandler) List(c *gin.Context) {
	user := mustGetUser(c)
	if user == nil {
		return
	}

	if user.GroupID == nil {
		response.OK(c, []interface{}{})
		return
	}

	domains, err := h.repo.ListDomainsForGroup(*user.GroupID)
	if err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to list domains", "error.failedToListDomains")
		return
	}
	response.OK(c, domains)
}

// PublicList returns active domains without authentication (name + id only).
func (h *DomainHandler) PublicList(c *gin.Context) {
	domains, err := h.repo.ListDomains(true)
	if err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to list domains", "error.failedToListDomains")
		return
	}
	type publicDomain struct {
		ID          uint   `json:"id"`
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	result := make([]publicDomain, len(domains))
	for i, d := range domains {
		result[i] = publicDomain{ID: d.ID, Name: d.Name, Description: d.Description}
	}
	response.OK(c, result)
}

// PublicCheckSubdomain checks whether a subdomain name is already taken under a given domain.
// It combines DB existence check with claim rule engine validation — any failure returns available=false
// with no detail (the UI shows a generic "已被占用" message).
func (h *DomainHandler) PublicCheckSubdomain(c *gin.Context) {
	name := strings.TrimSpace(c.Query("name"))
	domainIDStr := c.Query("domain_id")
	if name == "" || domainIDStr == "" {
		response.BadRequest(c, "error.invalidRequestBody")
		return
	}
	domainID, err := strconv.ParseUint(domainIDStr, 10, 64)
	if err != nil {
		response.BadRequest(c, "error.invalidRequestBody")
		return
	}

	// 1. DB existence check
	sub, err := h.repo.FindSubdomainByName(uint(domainID), name)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		response.InternalError(c, "error.databaseError")
		return
	}
	if sub != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		response.OK(c, gin.H{"available": false})
		return
	}

	// 2. Claim rule engine check — reject if any enabled rule matches
	if h.ruleEngine != nil {
		domain, domErr := h.repo.FindDomain(uint(domainID))
		if domErr == nil && domain != nil {
			matchResult, ruleErr := h.ruleEngine.CheckSubdomainName(c.Request.Context(), uint(domainID), name, domain.Name)
			if ruleErr != nil {
				// Rule engine error treated as "not available" — fail closed
				response.OK(c, gin.H{"available": false})
				return
			}
			if matchResult != nil {
				response.OK(c, gin.H{"available": false})
				return
			}
		}
	}

	response.OK(c, gin.H{"available": true})
}

type groupAccessInput struct {
	GroupID       uint    `json:"group_id" binding:"required"`
	CreditCost    float64 `json:"credit_cost"`
	MaxDNSRecords *int    `json:"max_dns_records"`
}

func (h *DomainHandler) AdminCreate(c *gin.Context) {
	var body struct {
		Name              string             `json:"name" binding:"required"`
		ProviderZoneID    string             `json:"provider_zone_id" binding:"required"`
		ProviderAccountID uint               `json:"provider_account_id" binding:"required"`
		Description       string             `json:"description"`
		CreditCost        *float64           `json:"credit_cost"`
		GroupAccess       []groupAccessInput `json:"group_access"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid request body", "error.invalidRequestBody")
		return
	}

	body.Name = strings.TrimSpace(body.Name)
	body.ProviderZoneID = strings.TrimSpace(body.ProviderZoneID)
	if body.Name == "" || body.ProviderZoneID == "" {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid request body", "error.invalidRequestBody")
		return
	}

	key, ok := idempotencyKeyFromHeader(c)
	if !ok {
		return
	}
	scope := fmt.Sprintf("admin:domain:create:%s:%s:%d", strings.ToLower(body.Name), body.ProviderZoneID, body.ProviderAccountID)
	result := h.ops.ExecuteIdempotent(c.Request.Context(), scope, key, func(ctx context.Context) (service.OperationResult, error) {
		exists, err := h.repo.DomainExistsByZoneIDOrName(body.ProviderZoneID, body.Name)
		if err != nil {
			return service.OperationResult{HTTPStatus: http.StatusInternalServerError, Message: "database error", MessageKey: "error.databaseError", Retryable: true}, nil
		}
		if exists {
			return service.OperationResult{HTTPStatus: http.StatusConflict, Message: "domain already exists", MessageKey: "error.domainAlreadyExists"}, nil
		}
		account, err := h.repo.FindDNSProviderAccount(body.ProviderAccountID)
		if err != nil {
			return service.OperationResult{HTTPStatus: http.StatusBadRequest, Message: "provider account not found", MessageKey: "error.cloudflareAccountNotFound"}, nil
		}
		if account.Status == model.DNSProviderAccountStatusDisabled {
			return service.OperationResult{HTTPStatus: http.StatusConflict, Message: "provider account is disabled", MessageKey: "error.providerAccountDisabled"}, nil
		}
		provider := model.NormalizeProvider(account.Provider)
		if provider == "" {
			provider = model.DNSProviderCloudflare
		}
		defaultCreditCost := 1.0
		if body.CreditCost != nil {
			defaultCreditCost = *body.CreditCost
		} else if len(body.GroupAccess) > 0 {
			defaultCreditCost = body.GroupAccess[0].CreditCost
		}
		domain := &model.Domain{
			Name:              body.Name,
			Provider:          provider,
			ProviderZoneID:    body.ProviderZoneID,
			ProviderAccountID: body.ProviderAccountID,
			CreditCost:        model.CreditFromFloat(defaultCreditCost),
			IsActive:          true,
			Description:       body.Description,
		}
		txErr := h.repo.Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(domain).Error; err != nil {
				return err
			}
			for _, ga := range body.GroupAccess {
				access := model.DomainGroupAccess{
					DomainID:      domain.ID,
					GroupID:       ga.GroupID,
					CreditCost:    model.CreditFromFloat(ga.CreditCost),
					MaxDNSRecords: ga.MaxDNSRecords,
				}
				if err := tx.Create(&access).Error; err != nil {
					return err
				}
			}
			return nil
		})
		if txErr != nil {
			var pgErr *pgconn.PgError
			if errors.As(txErr, &pgErr) && pgErr.Code == "23505" {
				return service.OperationResult{HTTPStatus: http.StatusConflict, Message: "domain already exists", MessageKey: "error.domainAlreadyExists"}, nil
			}
			return service.OperationResult{HTTPStatus: http.StatusInternalServerError, Message: "failed to create domain", MessageKey: "error.failedToCreateDomain", Retryable: true}, nil
		}

		if admin := ctxutil.GetUser(c); admin != nil {
			details, _ := json.Marshal(map[string]interface{}{"domain_name": body.Name, "zone_id": body.ProviderZoneID})
			h.repo.CreateAuditLog(&model.AuditLog{
				UserID:     admin.ID,
				Action:     "admin_create_domain",
				Resource:   "domain",
				ResourceID: domain.ID,
				Details:    details,
			})
		}
		accesses, err := h.repo.ListDomainGroupAccess(domain.ID)
		if err != nil {
			return service.OperationResult{HTTPStatus: http.StatusInternalServerError, Message: "failed to load group access", MessageKey: "error.failedToLoadGroupAccess", Retryable: true}, nil
		}
		return service.OperationResult{
			HTTPStatus: http.StatusCreated,
			Message:    "created",
			Data:       gin.H{"domain": domain, "group_access": accesses},
		}, nil
	})
	writeOperationResult(c, result)
}

func (h *DomainHandler) AdminUpdate(c *gin.Context) {
	id, ok := helpers.ParseUintParam(c, "id")
	if !ok {
		return
	}
	domain, err := h.repo.FindDomain(id)
	if err != nil {
		response.ErrorWithKey(c, http.StatusNotFound, "domain not found", "error.domainNotFound")
		return
	}
	var body struct {
		ProviderZoneID    *string            `json:"provider_zone_id"`
		ProviderAccountID *uint              `json:"provider_account_id"`
		IsActive          *bool              `json:"is_active"`
		Description       *string            `json:"description"`
		GroupAccess       []groupAccessInput `json:"group_access"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid request body", "error.invalidRequestBody")
		return
	}
	nextProvider := ""
	if body.ProviderAccountID != nil {
		account, findErr := h.repo.FindDNSProviderAccount(*body.ProviderAccountID)
		if findErr != nil {
			response.ErrorWithKey(c, http.StatusBadRequest, "provider account not found", "error.cloudflareAccountNotFound")
			return
		}
		if account.Status == model.DNSProviderAccountStatusDisabled {
			response.Error(c, http.StatusConflict, "provider account is disabled")
			return
		}
		nextProvider = model.NormalizeProvider(account.Provider)
		if nextProvider == "" {
			nextProvider = model.DNSProviderCloudflare
		}
	}

	key, ok := idempotencyKeyFromHeader(c)
	if !ok {
		return
	}
	scope := fmt.Sprintf("admin:domain:update:%d", domain.ID)
	result := h.ops.ExecuteIdempotent(c.Request.Context(), scope, key, func(ctx context.Context) (service.OperationResult, error) {
		if err := h.repo.Transaction(func(tx *gorm.DB) error {
			if body.ProviderZoneID != nil {
				domain.ProviderZoneID = *body.ProviderZoneID
			}
			if body.ProviderAccountID != nil {
				domain.ProviderAccountID = *body.ProviderAccountID
				domain.Provider = nextProvider
			}
			if body.IsActive != nil {
				domain.IsActive = *body.IsActive
			}
			if body.Description != nil {
				domain.Description = *body.Description
			}
			if err := tx.Save(domain).Error; err != nil {
				return err
			}
			if body.GroupAccess != nil {
				var accesses []model.DomainGroupAccess
				for _, ga := range body.GroupAccess {
					accesses = append(accesses, model.DomainGroupAccess{
						GroupID:       ga.GroupID,
						CreditCost:    model.CreditFromFloat(ga.CreditCost),
						MaxDNSRecords: ga.MaxDNSRecords,
					})
				}
				if err := h.repo.ReplaceDomainGroupAccess(tx, domain.ID, accesses); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			return service.OperationResult{HTTPStatus: http.StatusInternalServerError, Message: "failed to update domain", MessageKey: "error.failedToUpdateDomain", Retryable: true}, nil
		}

		if admin := ctxutil.GetUser(c); admin != nil {
			details, _ := json.Marshal(map[string]interface{}{"domain_name": domain.Name})
			h.repo.CreateAuditLog(&model.AuditLog{
				UserID:     admin.ID,
				Action:     "admin_update_domain",
				Resource:   "domain",
				ResourceID: domain.ID,
				Details:    details,
			})
		}
		accessList, err := h.repo.ListDomainGroupAccess(domain.ID)
		if err != nil {
			return service.OperationResult{HTTPStatus: http.StatusInternalServerError, Message: "failed to load group access", MessageKey: "error.failedToLoadGroupAccess", Retryable: true}, nil
		}
		return service.OperationResult{
			HTTPStatus: http.StatusOK,
			Message:    "ok",
			Data:       gin.H{"domain": domain, "group_access": accessList},
		}, nil
	})
	writeOperationResult(c, result)
}

func (h *DomainHandler) AdminListDomainsFull(c *gin.Context) {
	domains, err := h.repo.ListDomains(false)
	if err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to list domains", "error.failedToListDomains")
		return
	}

	accessMap, err := h.repo.ListAllDomainGroupAccess()
	if err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to list domains", "error.failedToListDomains")
		return
	}

	type domainWithAccess struct {
		model.Domain
		GroupAccess []model.DomainGroupAccess `json:"group_access"`
	}

	result := make([]domainWithAccess, len(domains))
	for i, d := range domains {
		accesses := accessMap[d.ID]
		if accesses == nil {
			accesses = []model.DomainGroupAccess{}
		}
		result[i] = domainWithAccess{Domain: d, GroupAccess: accesses}
	}
	response.OK(c, result)
}

func (h *DomainHandler) AdminGetReservedPrefixes(c *gin.Context) {
	prefixes, err := loadReservedSubdomainPrefixes(h.repo)
	if err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to load reserved subdomain prefixes", "error.failedToGetConfig")
		return
	}
	lengthSettings, err := loadSubdomainLengthSettings(h.repo)
	if err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to load subdomain length settings", "error.failedToGetConfig")
		return
	}
	response.OK(c, gin.H{
		"prefixes":   prefixes,
		"min_length": lengthSettings.MinLength,
		"max_length": lengthSettings.MaxLength,
	})
}

func (h *DomainHandler) AdminUpdateReservedPrefixes(c *gin.Context) {
	var body struct {
		Prefixes  []string `json:"prefixes"`
		MinLength int      `json:"min_length" binding:"required"`
		MaxLength int      `json:"max_length" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid request body", "error.invalidRequestBody")
		return
	}

	normalized, err := normalizeReservedSubdomainPrefixes(body.Prefixes)
	if err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid reserved prefix", "error.invalidReservedPrefix")
		return
	}
	lengthSettings := subdomainLengthSettings{
		MinLength: body.MinLength,
		MaxLength: body.MaxLength,
	}
	if err := validateLengthSettings(lengthSettings.MinLength, lengthSettings.MaxLength); err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid subdomain length settings", "error.invalidSubdomainLengthConfig")
		return
	}

	if err := saveReservedSubdomainPrefixes(h.repo, normalized); err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to save reserved subdomain prefixes", "error.failedToUpdateConfig")
		return
	}
	if err := saveSubdomainLengthSettings(h.repo, lengthSettings); err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to save subdomain length settings", "error.failedToUpdateConfig")
		return
	}

	if admin := ctxutil.GetUser(c); admin != nil {
		details, _ := json.Marshal(map[string]interface{}{
			"prefixes":   normalized,
			"min_length": lengthSettings.MinLength,
			"max_length": lengthSettings.MaxLength,
		})
		h.repo.CreateAuditLog(&model.AuditLog{
			UserID:   admin.ID,
			Action:   "admin_update_reserved_subdomain_prefixes",
			Resource: "system_config",
			Details:  details,
		})
	}

	response.OK(c, gin.H{
		"prefixes":   normalized,
		"min_length": lengthSettings.MinLength,
		"max_length": lengthSettings.MaxLength,
	})
}

func (h *DomainHandler) AdminDelete(c *gin.Context) {
	id, ok := helpers.ParseUintParam(c, "id")
	if !ok {
		return
	}

	refund := c.Query("refund") == "true"

	domain, err := h.repo.FindDomain(id)
	if err != nil {
		response.ErrorWithKey(c, http.StatusNotFound, "domain not found", "error.domainNotFound")
		return
	}

	// 查询所有子域（含 DNS 记录）
	subdomains, err := h.repo.ListSubdomainsByDomain(domain.ID)
	if err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "database error", "error.databaseError")
		return
	}

	type deleteCandidate struct {
		sub model.Subdomain
		rec model.DNSRecord
	}
	candidates := make([]deleteCandidate, 0)
	for _, sub := range subdomains {
		for _, rec := range sub.DNSRecords {
			candidates = append(candidates, deleteCandidate{sub: sub, rec: rec})
		}
	}

	// 收集退还积分信息 — 使用 ClaimCost 而非 re-query 当前组价格
	type refundItem struct {
		userID    uint
		claimCost model.Credit
		subFQDN   string
	}
	var refundItems []refundItem
	if refund {
		for _, sub := range subdomains {
			if sub.UserID == 0 {
				continue
			}
			cost := sub.ClaimCost
			// Fallback for historical subdomains created before ClaimCost was added
			if cost == 0 {
				user, uErr := h.repo.FindUserByID(sub.UserID)
				if uErr != nil || user.GroupID == nil {
					continue
				}
				access, aErr := h.repo.FindDomainGroupAccess(domain.ID, *user.GroupID)
				if aErr != nil {
					continue
				}
				cost = access.CreditCost
			}
			if cost == 0 {
				continue
			}
			refundItems = append(refundItems, refundItem{
				userID:    sub.UserID,
				claimCost: cost,
				subFQDN:   sub.FQDN,
			})
		}
	}

	// 收集子域 ID 列表
	subdomainIDs := make([]uint, len(subdomains))
	for i, s := range subdomains {
		subdomainIDs[i] = s.ID
	}
	key, ok := idempotencyKeyFromHeader(c)
	if !ok {
		return
	}
	scope := fmt.Sprintf("admin:domain:delete:%d", domain.ID)
	result := h.ops.ExecuteIdempotent(c.Request.Context(), scope, key, func(ctx context.Context) (service.OperationResult, error) {
		items := make([]service.BatchDeleteItem, 0, len(candidates))
		for _, item := range candidates {
			items = append(items, service.BatchDeleteItem{
				RecordID:          item.rec.ID,
				SubdomainFQDN:     item.sub.FQDN,
				Provider:          domain.Provider,
				ProviderAccountID: domain.ProviderAccountID,
				ZoneID:            domain.ProviderZoneID,
				ProviderRecordID:  item.rec.ProviderRecordID,
				RecordType:        item.rec.Type,
				Name:              item.rec.Name,
				Content:           item.rec.Content,
				TTL:               item.rec.TTL,
				Proxied:           item.rec.Proxied,
			})
		}
		deleteResult := h.ops.DeleteRecordsBatch(ctx, items, 3)
		if deleteResult.Async {
			return service.OperationResult{
				HTTPStatus: http.StatusConflict,
				Message:    "dns bulk delete queued, retry parent action after job succeeds",
				MessageKey: "error.cloudflareOperationInProgress",
				Data:       gin.H{"bulk_job_id": deleteResult.JobID, "bulk_async": true},
			}, nil
		}
		if deleteResult.Failed > 0 {
			failures := make([]cfFailureRecord, 0, len(deleteResult.Failures))
			for _, f := range deleteResult.Failures {
				failures = append(failures, cfFailureRecord{
					SubdomainFQDN:    f.SubdomainFQDN,
					RecordType:       f.RecordType,
					RecordContent:    f.RecordContent,
					ProviderRecordID: f.ProviderRecordID,
					Error:            f.Error,
				})
			}
			return service.OperationResult{
				HTTPStatus: http.StatusConflict,
				Message:    "some cloudflare dns records failed to delete",
				MessageKey: "error.cloudflareDeleteFailed",
				Data:       gin.H{"failed_records": failures},
			}, nil
		}

		if err := h.repo.Transaction(func(tx *gorm.DB) error {
			if refund {
				for _, item := range refundItems {
					descParams, _ := json.Marshal(map[string]interface{}{"fqdn": item.subFQDN})
					if item.claimCost > 0 {
						if err := h.repo.RefundCredits(tx, item.userID, item.claimCost, "txn.subdomainDeletedRefund", descParams); err != nil {
							return err
						}
					} else if item.claimCost < 0 {
						if err := h.repo.DeductCredits(tx, item.userID, -item.claimCost, "txn.subdomainDeletedDeduct", descParams); err != nil {
							return err
						}
					}
				}
			}
			if len(subdomainIDs) > 0 {
				if err := tx.Where("subdomain_id IN ?", subdomainIDs).Delete(&model.DNSRecord{}).Error; err != nil {
					return err
				}
				if err := tx.Where("domain_id = ?", domain.ID).Delete(&model.Subdomain{}).Error; err != nil {
					return err
				}
			}
			if err := h.repo.DeleteDomain(tx, domain.ID); err != nil {
				return err
			}
			if admin := ctxutil.GetUser(c); admin != nil {
				details, _ := json.Marshal(map[string]interface{}{
					"domain_name":      domain.Name,
					"subdomain_count":  len(subdomains),
					"dns_record_count": deleteResult.Succeeded,
					"refunded":         refund,
				})
				if err := tx.Create(&model.AuditLog{
					UserID:     admin.ID,
					Action:     "admin_delete_domain",
					Resource:   "domain",
					ResourceID: domain.ID,
					Details:    details,
				}).Error; err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			if errors.Is(err, gorm.ErrInvalidData) {
				return service.OperationResult{HTTPStatus: http.StatusInternalServerError, Message: "failed to deduct credits", MessageKey: "error.failedToDeductCredits", Retryable: true}, nil
			}
			return service.OperationResult{HTTPStatus: http.StatusInternalServerError, Message: "failed to delete domain", MessageKey: "error.failedToDeleteDomain", Retryable: true}, nil
		}
		return service.OperationResult{
			HTTPStatus: http.StatusOK,
			Message:    "ok",
			Data:       gin.H{"message": "domain deleted", "deleted_dns_count": deleteResult.Succeeded},
		}, nil
	})
	writeOperationResult(c, result)
}
