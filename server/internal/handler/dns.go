package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgconn"
	"hl6-server/internal/ctxutil"
	"hl6-server/internal/helpers"
	"hl6-server/internal/model"
	"hl6-server/internal/repository"
	"hl6-server/internal/service"
	"hl6-server/pkg/response"
	"hl6-server/pkg/validator"

	"gorm.io/gorm"
)

type DNSHandler struct {
	repo    *repository.Repository
	broker  *SSEBroker
	ops     *service.DNSOperationService
	enqueue *service.AuditEnqueueService
}

var (
	errDNSDuplicateRecord        = errors.New("duplicate dns record")
	errDNSCNAMEConflictWithOther = errors.New("cname conflicts with existing non-cname records")
	errDNSOtherConflictWithCNAME = errors.New("non-cname conflicts with existing cname record")
	errDNSCNAMEAlreadyExists     = errors.New("cname already exists")
	errDNSRecordLimitExceeded    = errors.New("dns record limit exceeded")
)

func NewDNSHandler(repo *repository.Repository, broker *SSEBroker, ops *service.DNSOperationService, enqueue *service.AuditEnqueueService) *DNSHandler {
	return &DNSHandler{repo: repo, broker: broker, ops: ops, enqueue: enqueue}
}

func (h *DNSHandler) checkSubdomainSuspended(c *gin.Context, sub *model.Subdomain) bool {
	if sub == nil {
		return false
	}
	if sub.Status == model.SubdomainStatusSuspended {
		response.ErrorWithKey(c, http.StatusForbidden, "subdomain suspended", "error.subdomainSuspended")
		return true
	}
	return false
}

func (h *DNSHandler) ListRecords(c *gin.Context) {
	sub := h.getSubdomain(c)
	if sub == nil {
		return
	}
	records, err := h.repo.ListDNSRecords(sub.ID)
	if err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to list records", "error.failedToListRecords")
		return
	}
	response.OK(c, records)
}

// checkMigrationReadOnly returns true (and writes the 409 response) if the domain
// associated with the subdomain is currently in read-only migration state.
func (h *DNSHandler) checkMigrationReadOnly(c *gin.Context, sub *model.Subdomain) bool {
	if sub == nil {
		return false
	}
	if sub.Domain.MigrationReadOnly {
		c.JSON(http.StatusConflict, response.Response{
			Code:    -1,
			Message: "domain is in read-only state during DNS migration",
			Data: map[string]string{
				"error_category":   "domain_migration_read_only",
				"migration_state":  sub.Domain.MigrationState,
			},
		})
		return true
	}
	return false
}

func (h *DNSHandler) CreateRecord(c *gin.Context) {
	sub := h.getSubdomain(c)
	if sub == nil {
		return
	}
	if h.checkMigrationReadOnly(c, sub) {
		return
	}
	if h.checkSubdomainSuspended(c, sub) {
		return
	}
	var body struct {
		Type    string `json:"type" binding:"required"`
		Content string `json:"content" binding:"required"`
		Proxied bool   `json:"proxied"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid request body", "error.invalidRequestBody")
		return
	}
	body.Type = strings.ToUpper(body.Type)
	if err := validator.ValidateDNSRecord(body.Type, body.Content); err != nil {
		if ve, ok := err.(*validator.ValidationError); ok {
			response.ErrorWithKey(c, http.StatusBadRequest, ve.Message, ve.Key)
		} else {
			response.Error(c, http.StatusBadRequest, err.Error())
		}
		return
	}

	// 检查域名+用户组的 DNS 记录数上限
	user := ctxutil.GetUser(c)
	var maxDNSRecords *int
	if user != nil && user.GroupID != nil {
		access, err := h.repo.FindDomainGroupAccess(sub.DomainID, *user.GroupID)
		if err == nil && access.MaxDNSRecords != nil {
			limit := *access.MaxDNSRecords
			maxDNSRecords = &limit
		}
	}

	if body.Type == "TXT" || body.Type == "NS" || body.Type == "MX" {
		body.Proxied = false
	}
	if sub.Domain.Provider != model.DNSProviderCloudflare {
		body.Proxied = false
	}

	ttl := normalizeDNSRecordTTL(sub.Domain.Provider, 0, 0)

	if _, err := h.repo.FindDNSProviderAccount(sub.Domain.ProviderAccountID); err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "provider account not found", "error.cloudflareAccountNotFound")
		return
	}

	key, ok := idempotencyKeyFromHeader(c)
	if !ok {
		return
	}
	record := &model.DNSRecord{
		SubdomainID: sub.ID,
		Type:        body.Type,
		Name:        sub.FQDN,
		Content:     body.Content,
		TTL:         ttl,
		Proxied:     body.Proxied,
	}
	scopeUserID := uint(0)
	if user != nil {
		scopeUserID = user.ID
	}
	scope := fmt.Sprintf("dns:create:user:%d:sub:%d", scopeUserID, sub.ID)
	result := h.ops.ExecuteIdempotent(c.Request.Context(), scope, key, func(ctx context.Context) (service.OperationResult, error) {
		err := h.ops.CreateRecordAtomic(ctx, service.CreateRecordInput{
			Subdomain: sub,
			Record:    record,
		}, func(tx *gorm.DB) error {
			if _, err := h.repo.LockSubdomainForUpdate(tx, sub.ID); err != nil {
				return err
			}

			var cnameCount int64
			if err := tx.Model(&model.DNSRecord{}).
				Where("subdomain_id = ? AND type = ?", sub.ID, "CNAME").
				Count(&cnameCount).Error; err != nil {
				return err
			}
			if body.Type == "CNAME" {
				var otherCount int64
				if err := tx.Model(&model.DNSRecord{}).
					Where("subdomain_id = ? AND type <> ?", sub.ID, "CNAME").
					Count(&otherCount).Error; err != nil {
					return err
				}
				if otherCount > 0 {
					return errDNSCNAMEConflictWithOther
				}
				if cnameCount > 0 {
					return errDNSCNAMEAlreadyExists
				}
			} else if cnameCount > 0 {
				return errDNSOtherConflictWithCNAME
			}

			var dupCount int64
			if err := tx.Model(&model.DNSRecord{}).
				Where("subdomain_id = ? AND type = ? AND content = ?", sub.ID, body.Type, body.Content).
				Count(&dupCount).Error; err != nil {
				return err
			}
			if dupCount > 0 {
				return errDNSDuplicateRecord
			}
			if maxDNSRecords != nil {
				var currentCount int64
				if err := tx.Model(&model.DNSRecord{}).Where("subdomain_id = ?", sub.ID).Count(&currentCount).Error; err != nil {
					return err
				}
				if int(currentCount) >= *maxDNSRecords {
					return errDNSRecordLimitExceeded
				}
			}
			return nil
		})
		if err == nil {
			if user != nil {
				details, _ := json.Marshal(map[string]interface{}{
					"type": body.Type, "content": body.Content, "fqdn": sub.FQDN,
				})
				h.repo.CreateAuditLog(&model.AuditLog{
					UserID:     user.ID,
					Action:     "create_dns_record",
					Resource:   "dns_record",
					ResourceID: record.ID,
					Details:    details,
				})
			}
			return service.OperationResult{
				HTTPStatus: http.StatusCreated,
				Message:    "created",
				Data:       record,
				Retryable:  false,
			}, nil
		}

		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			return service.OperationResult{HTTPStatus: http.StatusNotFound, Message: "subdomain not found", MessageKey: "error.subdomainNotFound"}, nil
		case errors.Is(err, errDNSCNAMEConflictWithOther):
			return service.OperationResult{HTTPStatus: http.StatusConflict, Message: "CNAME record cannot coexist with other records", MessageKey: "error.cnameConflictWithOther"}, nil
		case errors.Is(err, errDNSCNAMEAlreadyExists):
			return service.OperationResult{HTTPStatus: http.StatusConflict, Message: "CNAME record already exists", MessageKey: "error.cnameAlreadyExists"}, nil
		case errors.Is(err, errDNSOtherConflictWithCNAME):
			return service.OperationResult{HTTPStatus: http.StatusConflict, Message: "CNAME record cannot coexist with other records", MessageKey: "error.otherConflictWithCname"}, nil
		case errors.Is(err, errDNSDuplicateRecord):
			return service.OperationResult{HTTPStatus: http.StatusConflict, Message: "duplicate record", MessageKey: "error.duplicateRecord"}, nil
		case errors.Is(err, errDNSRecordLimitExceeded):
			return service.OperationResult{HTTPStatus: http.StatusUnprocessableEntity, Message: "dns record limit exceeded", MessageKey: "error.dnsRecordLimitExceeded"}, nil
		}

		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			if strings.EqualFold(pgErr.ConstraintName, "idx_dns_records_subdomain_cname_unique") {
				if body.Type == "CNAME" {
					return service.OperationResult{HTTPStatus: http.StatusConflict, Message: "CNAME record already exists", MessageKey: "error.cnameAlreadyExists"}, nil
				}
				return service.OperationResult{HTTPStatus: http.StatusConflict, Message: "CNAME record cannot coexist with other records", MessageKey: "error.otherConflictWithCname"}, nil
			}
			return service.OperationResult{HTTPStatus: http.StatusConflict, Message: "duplicate record", MessageKey: "error.duplicateRecord"}, nil
		}
		return service.OperationResult{
			HTTPStatus: http.StatusInternalServerError,
			Message:    "failed to save record",
			MessageKey: "error.failedToSaveRecord",
			Retryable:  true,
		}, nil
	})
	if result.HTTPStatus == http.StatusCreated && h.enqueue != nil {
		switch body.Type {
		case "A", "AAAA", "CNAME":
			_ = h.enqueue.EnqueueScan(c.Request.Context(), sub.ID, sub.FQDN, "dns_create", service.EnqueueOpts{})
		}
	}
	writeOperationResult(c, result)
}

func (h *DNSHandler) UpdateRecord(c *gin.Context) {
	sub := h.getSubdomain(c)
	if sub == nil {
		return
	}
	if h.checkMigrationReadOnly(c, sub) {
		return
	}
	if h.checkSubdomainSuspended(c, sub) {
		return
	}
	recordID, ok := helpers.ParseUintParam(c, "recordId")
	if !ok {
		return
	}
	record, err := h.repo.FindDNSRecord(recordID)
	if err != nil || record.SubdomainID != sub.ID {
		response.ErrorWithKey(c, http.StatusNotFound, "record not found", "error.recordNotFound")
		return
	}

	var body struct {
		Content string `json:"content" binding:"required"`
		Proxied bool   `json:"proxied"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid request body", "error.invalidRequestBody")
		return
	}
	if err := validator.ValidateDNSRecord(record.Type, body.Content); err != nil {
		if ve, ok := err.(*validator.ValidationError); ok {
			response.ErrorWithKey(c, http.StatusBadRequest, ve.Message, ve.Key)
		} else {
			response.Error(c, http.StatusBadRequest, err.Error())
		}
		return
	}

	dup, err := h.repo.HasDuplicateRecordExcluding(sub.ID, record.Type, body.Content, record.ID)
	if err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "database error", "error.databaseError")
		return
	}
	if dup {
		response.ErrorWithKey(c, http.StatusConflict, "duplicate record", "error.duplicateRecord")
		return
	}

	if record.Type == "TXT" {
		body.Proxied = false
	}
	if sub.Domain.Provider != model.DNSProviderCloudflare {
		body.Proxied = false
	}

	ttl := normalizeDNSRecordTTL(sub.Domain.Provider, 0, 0)
	key, ok := idempotencyKeyFromHeader(c)
	if !ok {
		return
	}
	scope := fmt.Sprintf("dns:update:user:%d:record:%d", sub.UserID, record.ID)
	result := h.ops.ExecuteIdempotent(c.Request.Context(), scope, key, func(ctx context.Context) (service.OperationResult, error) {
		err := h.ops.UpdateRecordAtomic(ctx, service.UpdateRecordInput{
			Subdomain:  sub,
			Record:     record,
			NewContent: body.Content,
			NewTTL:     ttl,
			NewProxied: body.Proxied,
		})
		if err == nil {
			return service.OperationResult{
				HTTPStatus: http.StatusOK,
				Message:    "ok",
				Data:       record,
				Retryable:  false,
			}, nil
		}
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return service.OperationResult{
				HTTPStatus: http.StatusConflict,
				Message:    "duplicate record",
				MessageKey: "error.duplicateRecord",
				Retryable:  false,
			}, nil
		}
		return service.OperationResult{
			HTTPStatus: http.StatusInternalServerError,
			Message:    "database error",
			MessageKey: "error.databaseError",
			Retryable:  true,
		}, nil
	})
	writeOperationResult(c, result)
}

func (h *DNSHandler) DeleteRecord(c *gin.Context) {
	sub := h.getSubdomain(c)
	if sub == nil {
		return
	}
	if h.checkMigrationReadOnly(c, sub) {
		return
	}
	if h.checkSubdomainSuspended(c, sub) {
		return
	}
	recordID, ok := helpers.ParseUintParam(c, "recordId")
	if !ok {
		return
	}
	record, err := h.repo.FindDNSRecord(recordID)
	if err != nil || record.SubdomainID != sub.ID {
		response.ErrorWithKey(c, http.StatusNotFound, "record not found", "error.recordNotFound")
		return
	}

	key, ok := idempotencyKeyFromHeader(c)
	if !ok {
		return
	}
	scope := fmt.Sprintf("dns:delete:user:%d:record:%d", sub.UserID, record.ID)
	result := h.ops.ExecuteIdempotent(c.Request.Context(), scope, key, func(ctx context.Context) (service.OperationResult, error) {
		if err := h.ops.DeleteRecordAtomic(ctx, service.DeleteRecordInput{
			Subdomain: sub,
			Record:    record,
		}); err != nil {
			return service.OperationResult{
				HTTPStatus: http.StatusInternalServerError,
				Message:    "database error",
				MessageKey: "error.databaseError",
				Retryable:  true,
			}, nil
		}
		return service.OperationResult{
			HTTPStatus: http.StatusOK,
			Message:    "ok",
			Data:       gin.H{"message": "record deleted"},
		}, nil
	})
	writeOperationResult(c, result)
}

func (h *DNSHandler) getSubdomain(c *gin.Context) *model.Subdomain {
	user := ctxutil.GetUser(c)
	if user == nil {
		response.ErrorWithKey(c, http.StatusUnauthorized, "user not found", "error.userNotFound")
		c.Abort()
		return nil
	}
	id, ok := helpers.ParseUintParam(c, "id")
	if !ok {
		c.Abort()
		return nil
	}
	sub, err := h.repo.FindSubdomain(id)
	if err != nil {
		response.ErrorWithKey(c, http.StatusNotFound, "subdomain not found", "error.subdomainNotFound")
		c.Abort()
		return nil
	}
	if sub.UserID != user.ID {
		response.ErrorWithKey(c, http.StatusForbidden, "not your subdomain", "error.notYourSubdomain")
		c.Abort()
		return nil
	}
	return sub
}

func (h *DNSHandler) AdminListRecords(c *gin.Context) {
	page, perPage := helpers.ParsePageParams(c, 20, 100)
	search := c.Query("search")

	var domainID *uint
	if v := c.Query("domain_id"); v != "" {
		if id, err := strconv.ParseUint(v, 10, 64); err == nil {
			uid := uint(id)
			domainID = &uid
		}
	}

	var groupID *uint
	if v := c.Query("group_id"); v != "" {
		if id, err := strconv.ParseUint(v, 10, 64); err == nil {
			uid := uint(id)
			groupID = &uid
		}
	}

	records, total, err := h.repo.AdminListDNSRecords(page, perPage, search, domainID, groupID)
	if err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to list records", "error.failedToListRecords")
		return
	}
	response.Paginated(c, records, total, page, perPage)
}

func (h *DNSHandler) AdminDeleteRecord(c *gin.Context) {
	admin := ctxutil.GetUser(c)
	if admin == nil {
		response.ErrorWithKey(c, http.StatusUnauthorized, "unauthorized", "error.unauthorized")
		return
	}

	recordID, ok := helpers.ParseUintParam(c, "id")
	if !ok {
		return
	}

	var body struct {
		Notify  bool   `json:"notify"`
		Reason  string `json:"reason"`
		BanUser bool   `json:"ban_user"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		// Allow empty body
		body.Notify = false
		body.Reason = ""
		body.BanUser = false
	}
	reason := strings.TrimSpace(body.Reason)
	if body.BanUser && reason == "" {
		response.ErrorWithKey(c, http.StatusBadRequest, "reason is required when ban_user is true", "error.invalidRequestBody")
		return
	}

	record, sub, err := h.repo.FindDNSRecordWithSubdomain(recordID)
	if err != nil || sub == nil {
		response.ErrorWithKey(c, http.StatusNotFound, "record not found", "error.recordNotFound")
		return
	}
	key, ok := idempotencyKeyFromHeader(c)
	if !ok {
		return
	}
	scope := fmt.Sprintf("admin:dns:delete:%d:ban:%t", record.ID, body.BanUser)
	result := h.ops.ExecuteIdempotent(c.Request.Context(), scope, key, func(ctx context.Context) (service.OperationResult, error) {
		banResult := adminBanExecutionResult{}
		if body.BanUser {
			if admin.ID == sub.UserID {
				return service.OperationResult{HTTPStatus: http.StatusBadRequest, Message: "cannot ban yourself", MessageKey: "error.cannotBanSelf"}, nil
			}
			target, findErr := h.repo.FindUserByID(sub.UserID)
			if findErr != nil {
				return service.OperationResult{HTTPStatus: http.StatusNotFound, Message: "user not found", MessageKey: "error.userNotFound"}, nil
			}
			var failures []cfFailureRecord
			var banErr error
			var asyncJobID *uint
			banResult, failures, asyncJobID, banErr = executeAdminBanUserWithCleanup(ctx, h.repo, h.ops, admin.ID, target, reason)
			if asyncJobID != nil {
				return service.OperationResult{
					HTTPStatus: http.StatusConflict,
					Message:    "dns bulk delete queued, retry ban after job succeeds",
					MessageKey: "error.dnsOperationInProgress",
					Data:       gin.H{"bulk_job_id": *asyncJobID, "bulk_async": true},
				}, nil
			}
			if len(failures) > 0 {
				return service.OperationResult{
					HTTPStatus: http.StatusConflict,
					Message:    "some dns records failed to delete",
					MessageKey: "error.dnsDeleteFailed",
					Data:       gin.H{"failed_records": failures},
				}, nil
			}
			if banErr != nil {
				if errors.Is(banErr, errCannotBanLastActiveAdmin) {
					return service.OperationResult{HTTPStatus: http.StatusBadRequest, Message: "cannot ban last active admin", MessageKey: "error.cannotBanLastAdmin"}, nil
				}
				return service.OperationResult{HTTPStatus: http.StatusInternalServerError, Message: "failed to ban user", MessageKey: "error.failedToBanUser", Retryable: true}, nil
			}
			banDetails, _ := json.Marshal(map[string]interface{}{
				"target_user_id":     sub.UserID,
				"target_user_role":   banResult.TargetRole,
				"reason":             reason,
				"delete_resources":   true,
				"subdomains_deleted": banResult.SubdomainsDeleted,
				"deleted_dns_count":  banResult.DeletedDNSCount,
			})
			h.repo.CreateAuditLog(&model.AuditLog{
				UserID:     admin.ID,
				Action:     "admin_ban_user",
				Resource:   "user",
				ResourceID: sub.UserID,
				Details:    banDetails,
			})
		} else {
			if err := h.ops.DeleteRecordAtomic(ctx, service.DeleteRecordInput{
				Subdomain: sub,
				Record:    record,
			}); err != nil {
				return service.OperationResult{HTTPStatus: http.StatusInternalServerError, Message: "database error", MessageKey: "error.databaseError", Retryable: true}, nil
			}
		}

		if body.Notify {
			fqdn := record.Name
			title := fmt.Sprintf("%s 解析已被删除", fqdn)
			content := fmt.Sprintf("您的解析 %s 已被删除。", fqdn)
			if body.BanUser {
				content = fmt.Sprintf("您的解析 %s 已被删除，账号已被封禁。", fqdn)
			}
			if reason != "" {
				content = fmt.Sprintf("%s\n原因：%s", content, reason)
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
			} else {
				event := SSEEvent{Event: "new_notification", Data: fmt.Sprintf(`{"id":%d}`, notification.ID)}
				h.broker.SendToUsers([]uint{sub.UserID}, event)
			}
		}

		details, _ := json.Marshal(map[string]interface{}{
			"fqdn":               record.Name,
			"type":               record.Type,
			"content":            record.Content,
			"notify":             body.Notify,
			"reason":             reason,
			"ban_user":           body.BanUser,
			"target_user_id":     sub.UserID,
			"deleted_dns_count":  banResult.DeletedDNSCount,
			"subdomains_deleted": banResult.SubdomainsDeleted,
		})
		h.repo.CreateAuditLog(&model.AuditLog{
			UserID:     admin.ID,
			Action:     "admin_delete_dns_record",
			Resource:   "dns_record",
			ResourceID: record.ID,
			Details:    details,
		})
		data := gin.H{"message": "record deleted"}
		if body.BanUser {
			data["ban_user"] = true
		}
		return service.OperationResult{HTTPStatus: http.StatusOK, Message: "ok", Data: data}, nil
	})
	writeOperationResult(c, result)
}

func (h *DNSHandler) AdminGetBulkJob(c *gin.Context) {
	jobID, ok := helpers.ParseUintParam(c, "id")
	if !ok {
		return
	}
	job, err := h.repo.FindDNSBulkJob(jobID)
	if err != nil {
		response.ErrorWithKey(c, http.StatusNotFound, "bulk job not found", "error.recordNotFound")
		return
	}
	response.OK(c, job)
}

func (h *DNSHandler) AdminListBulkJobItems(c *gin.Context) {
	jobID, ok := helpers.ParseUintParam(c, "id")
	if !ok {
		return
	}
	page, perPage := helpers.ParsePageParams(c, 20, 200)
	status := strings.TrimSpace(c.Query("status"))
	items, total, err := h.repo.ListDNSBulkJobItems(jobID, page, perPage, status)
	if err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to list bulk job items", "error.failedToListRecords")
		return
	}
	response.Paginated(c, items, total, page, perPage)
}

func normalizeDNSRecordTTL(provider string, requestedTTL int, currentTTL int) int {
	_ = requestedTTL
	_ = currentTTL

	switch model.NormalizeProvider(provider) {
	case model.DNSProviderCloudflare:
		return 1
	case model.DNSProviderHuaweiDNS:
		return 300
	case model.DNSProviderDNSPod, model.DNSProviderAliDNS:
		return 600
	default:
		return 600
	}
}
