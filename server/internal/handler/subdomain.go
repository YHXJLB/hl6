package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
	"hl6-server/internal/helpers"
	"hl6-server/internal/model"
	"hl6-server/internal/repository"
	"hl6-server/internal/service"
	"hl6-server/pkg/response"
	"hl6-server/pkg/validator"
)

type SubdomainHandler struct {
	repo      *repository.Repository
	broker    *SSEBroker
	ops       *service.DNSOperationService
	enqueue   *service.AuditEnqueueService
	notif     *service.NotificationService
	subSvc    *service.SubdomainService
	auditLog  *service.AuditLogService
	ruleEngine *service.ClaimRuleEngine
}

func NewSubdomainHandler(repo *repository.Repository, broker *SSEBroker, ops *service.DNSOperationService, enqueue *service.AuditEnqueueService, notif *service.NotificationService, subSvc *service.SubdomainService, auditLog *service.AuditLogService, ruleEngine *service.ClaimRuleEngine) *SubdomainHandler {
	return &SubdomainHandler{repo: repo, broker: broker, ops: ops, enqueue: enqueue, notif: notif, subSvc: subSvc, auditLog: auditLog, ruleEngine: ruleEngine}
}

func (h *SubdomainHandler) List(c *gin.Context) {
	user := mustGetUser(c)
	if user == nil {
		return
	}
	subs, err := h.repo.ListSubdomainsByUser(user.ID)
	if err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to list subdomains", "error.failedToListSubdomains")
		return
	}
	response.OK(c, subs)
}

func (h *SubdomainHandler) Settings(c *gin.Context) {
	settings, err := loadSubdomainLengthSettings(h.repo)
	if err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to load subdomain length settings", "error.failedToGetConfig")
		return
	}
	response.OK(c, gin.H{
		"min_length": settings.MinLength,
		"max_length": settings.MaxLength,
	})
}

func (h *SubdomainHandler) Get(c *gin.Context) {
	user := mustGetUser(c)
	if user == nil {
		return
	}
	id, ok := helpers.ParseUintParam(c, "id")
	if !ok {
		return
	}
	sub, err := h.repo.FindSubdomain(id)
	if err != nil {
		response.ErrorWithKey(c, http.StatusNotFound, "subdomain not found", "error.subdomainNotFound")
		return
	}
	if sub.UserID != user.ID {
		response.ErrorWithKey(c, http.StatusForbidden, "not your subdomain", "error.notYourSubdomain")
		return
	}
	response.OK(c, sub)
}

func (h *SubdomainHandler) Claim(c *gin.Context) {
	user := mustGetUser(c)
	if user == nil {
		return
	}
	var body struct {
		DomainID uint   `json:"domain_id" binding:"required"`
		Name     string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid request body", "error.invalidRequestBody")
		return
	}
	body.Name = strings.ToLower(strings.TrimSpace(body.Name))
	reservedPrefixes, err := loadReservedSubdomainPrefixes(h.repo)
	if err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to load reserved subdomain prefixes", "error.databaseError")
		return
	}
	if isReservedSubdomainPrefix(body.Name, reservedPrefixes) {
		response.ErrorWithKey(c, http.StatusForbidden, "subdomain cannot be claimed", "error.subdomainNotClaimable")
		return
	}
	lengthSettings, err := loadSubdomainLengthSettings(h.repo)
	if err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to load subdomain length settings", "error.failedToGetConfig")
		return
	}
	if err := validator.ValidateSubdomainName(body.Name, lengthSettings.MinLength, lengthSettings.MaxLength); err != nil {
		if ve, ok := err.(*validator.ValidationError); ok {
			response.ErrorWithKey(c, http.StatusBadRequest, ve.Message, ve.Key)
		} else {
			response.ErrorWithKey(c, http.StatusBadRequest, err.Error(), "error.invalidSubdomainName")
		}
		return
	}

	domain, err := h.repo.FindDomain(body.DomainID)
	if err != nil || !domain.IsActive {
		response.ErrorWithKey(c, http.StatusNotFound, "domain not found or inactive", "error.domainNotFoundOrInactive")
		return
	}

	// 子域创建规则检测（在域名确认后执行）
	if h.ruleEngine != nil {
		matchResult, ruleErr := h.ruleEngine.CheckSubdomainName(c.Request.Context(), body.DomainID, body.Name, domain.Name)
		if ruleErr != nil {
			response.ErrorWithKey(c, http.StatusInternalServerError, "failed to check claim rules", "error.claimRuleCheckFailed")
			return
		}
		if matchResult != nil {
			// 增加命中计数
			_ = h.repo.IncrementClaimRuleHit(matchResult.RuleID, body.Name+"."+domain.Name)
			// 返回拒绝信息
			c.JSON(http.StatusForbidden, response.Response{
				Code:    -1,
				Message: matchResult.Message,
				Data: gin.H{
					"error_category":   "claim_rule_violation",
					"rule_id":          matchResult.RuleID,
					"rule_name":        matchResult.RuleName,
					"action":           matchResult.Action,
					"reject_message":   matchResult.Message,
				},
			})
			return
		}
	}

	// Check group access and get group-specific cost
	if user.GroupID == nil {
		response.ErrorWithKey(c, http.StatusForbidden, "user has no group assigned", "error.noGroupAssigned")
		return
	}
	access, err := h.repo.FindDomainGroupAccess(domain.ID, *user.GroupID)
	if err != nil {
		response.ErrorWithKey(c, http.StatusForbidden, "your group does not have access to this domain", "error.groupNoAccess")
		return
	}
	creditCost := access.CreditCost

	if _, err := h.repo.FindSubdomainByName(domain.ID, body.Name); err == nil {
		response.ErrorWithKey(c, http.StatusConflict, "subdomain already taken", "error.subdomainAlreadyTaken")
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		response.ErrorWithKey(c, http.StatusInternalServerError, "database error", "error.databaseError")
		return
	}

	fqdn := fmt.Sprintf("%s.%s", body.Name, domain.Name)
	fqdnParams, _ := json.Marshal(map[string]string{"fqdn": fqdn})

	sub := &model.Subdomain{
		DomainID:  domain.ID,
		UserID:    user.ID,
		Name:      body.Name,
		FQDN:      fqdn,
		ClaimCost: creditCost,
	}

	txErr := h.repo.Transaction(func(tx *gorm.DB) error {
		if creditCost > 0 {
			if err := h.repo.DeductCredits(tx, user.ID, creditCost, "txn.claimSubdomain", fqdnParams); err != nil {
				return err
			}
		} else if creditCost < 0 {
			if err := h.repo.GrantCredits(tx, user.ID, -creditCost, "txn.rewardClaimSubdomain", fqdnParams); err != nil {
				return err
			}
		}
		if err := tx.Create(sub).Error; err != nil {
			return err
		}
		details, _ := json.Marshal(map[string]interface{}{"fqdn": fqdn, "cost": creditCost})
		return tx.Create(&model.AuditLog{
			UserID:     user.ID,
			Action:     "claim_subdomain",
			Resource:   "subdomain",
			ResourceID: sub.ID,
			Details:    details,
		}).Error
	})
	if txErr != nil {
		if errors.Is(txErr, gorm.ErrInvalidData) {
			response.ErrorWithKey(c, http.StatusPaymentRequired, "insufficient credits", "error.insufficientCredits")
			return
		}
		var pgErr *pgconn.PgError
		if errors.As(txErr, &pgErr) && pgErr.Code == "23505" {
			response.ErrorWithKey(c, http.StatusConflict, "subdomain already taken", "error.subdomainAlreadyTaken")
			return
		}
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to create subdomain", "error.failedToCreateSubdomain")
		return
	}
	if h.enqueue != nil {
		_ = h.enqueue.EnqueueScan(c.Request.Context(), sub.ID, sub.FQDN, "claim", service.EnqueueOpts{})
	}
	response.Created(c, sub)
}

func (h *SubdomainHandler) Release(c *gin.Context) {
	user := mustGetUser(c)
	if user == nil {
		return
	}
	id, ok := helpers.ParseUintParam(c, "id")
	if !ok {
		return
	}
	sub, err := h.repo.FindSubdomain(id)
	if err != nil {
		response.ErrorWithKey(c, http.StatusNotFound, "subdomain not found", "error.subdomainNotFound")
		return
	}
	if sub.UserID != user.ID {
		response.ErrorWithKey(c, http.StatusForbidden, "not your subdomain", "error.notYourSubdomain")
		return
	}

	key, ok := idempotencyKeyFromHeader(c)
	if !ok {
		return
	}
	scope := fmt.Sprintf("subdomain:release:user:%d:sub:%d", user.ID, sub.ID)
	result := h.ops.ExecuteIdempotent(c.Request.Context(), scope, key, func(ctx context.Context) (service.OperationResult, error) {
		items := make([]service.BatchDeleteItem, 0, len(sub.DNSRecords))
		for _, record := range sub.DNSRecords {
			items = append(items, service.BatchDeleteItem{
				RecordID:          record.ID,
				SubdomainFQDN:     sub.FQDN,
				Provider:          sub.Domain.Provider,
				ProviderAccountID: sub.Domain.ProviderAccountID,
				ZoneID:            sub.Domain.ProviderZoneID,
				ProviderRecordID:  record.ProviderRecordID,
				RecordType:        record.Type,
				Name:              record.Name,
				Content:           record.Content,
				TTL:               record.TTL,
				Proxied:           record.Proxied,
			})
		}
		deleteResult := h.ops.DeleteRecordsBatch(ctx, items, 3)
		if deleteResult.Async {
			return service.OperationResult{
				HTTPStatus: http.StatusConflict,
				Message:    "dns bulk delete queued, retry release after job succeeds",
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
			if err := tx.Where("subdomain_id = ?", sub.ID).Delete(&model.DNSRecord{}).Error; err != nil {
				return err
			}
			if err := tx.Delete(sub).Error; err != nil {
				return err
			}
			details, _ := json.Marshal(map[string]interface{}{"fqdn": sub.FQDN, "deleted_dns_count": deleteResult.Succeeded})
			return tx.Create(&model.AuditLog{
				UserID:     user.ID,
				Action:     "release_subdomain",
				Resource:   "subdomain",
				ResourceID: sub.ID,
				Details:    details,
			}).Error
		}); err != nil {
			return service.OperationResult{
				HTTPStatus: http.StatusInternalServerError,
				Message:    "failed to release subdomain",
				MessageKey: "error.databaseError",
				Retryable:  true,
			}, nil
		}
		return service.OperationResult{
			HTTPStatus: http.StatusOK,
			Message:    "ok",
			Data:       gin.H{"message": "subdomain released", "deleted_dns_count": deleteResult.Succeeded},
		}, nil
	})
	writeOperationResult(c, result)
}

func (h *SubdomainHandler) AdminListClaimed(c *gin.Context) {
	page, perPage := helpers.ParsePageParams(c, 20, 100)

	search := strings.TrimSpace(c.Query("search"))
	subs, total, err := h.repo.AdminListClaimedSubdomains(page, perPage, search)
	if err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to list claimed subdomains", "error.failedToListSubdomains")
		return
	}
	response.Paginated(c, subs, total, page, perPage)
}

func (h *SubdomainHandler) AdminRelease(c *gin.Context) {
	admin := mustGetUser(c)
	if admin == nil {
		return
	}

	id, ok := helpers.ParseUintParam(c, "id")
	if !ok {
		return
	}

	var body struct {
		Notify bool   `json:"notify"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		// Allow empty body.
		body.Notify = false
		body.Reason = ""
	}
	reason := strings.TrimSpace(body.Reason)

	sub, err := h.repo.FindSubdomain(id)
	if err != nil {
		response.ErrorWithKey(c, http.StatusNotFound, "subdomain not found", "error.subdomainNotFound")
		return
	}

	key, ok := idempotencyKeyFromHeader(c)
	if !ok {
		return
	}
	scope := fmt.Sprintf("admin:subdomain:release:%d", sub.ID)
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
			title := fmt.Sprintf("%s 认领已被管理员释放", sub.FQDN)
			content := fmt.Sprintf("您的认领 %s 已被管理员释放，相关解析记录已被删除。", sub.FQDN)
			if reason != "" {
				content = fmt.Sprintf("您的认领 %s 已被管理员释放，相关解析记录已被删除。\n原因：%s", sub.FQDN, reason)
			}
			targetIDs, _ := json.Marshal([]uint{sub.UserID})
			notification := &model.Notification{
				Title:      title,
				Content:    content,
				Type:       "urgent",
				TargetType: "users",
				TargetIDs:  targetIDs,
				CreatedBy:  admin.ID,
			}
			if err := h.repo.CreateNotificationWithImages(notification); err != nil {
				log.Printf("failed to create notification: %v", err)
			} else if h.broker != nil {
				event := SSEEvent{Event: "new_notification", Data: fmt.Sprintf(`{"id":%d}`, notification.ID)}
				h.broker.SendToUsers([]uint{sub.UserID}, event)
			}
		}
		return res, nil
	})
	writeOperationResult(c, result)
}
