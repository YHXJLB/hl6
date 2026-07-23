package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"hl6-server/internal/ctxutil"
	"hl6-server/internal/helpers"
	"hl6-server/internal/model"
	"hl6-server/internal/repository"
	"hl6-server/pkg/response"
)

type RedeemCodeHandler struct {
	repo *repository.Repository
}

func NewRedeemCodeHandler(repo *repository.Repository) *RedeemCodeHandler {
	return &RedeemCodeHandler{repo: repo}
}

// Redeem POST /credits/redeem — 用户兑换；业务失败一律笼统错误。
func (h *RedeemCodeHandler) Redeem(c *gin.Context) {
	user := ctxutil.GetUser(c)
	if user == nil {
		response.ErrorWithKey(c, http.StatusUnauthorized, "unauthorized", "error.unauthorized")
		return
	}

	var body struct {
		Code string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "redeem code unavailable", "error.redeemCodeUnavailable")
		return
	}

	normalized, ok := helpers.NormalizeRedeemCode(body.Code)
	if !ok {
		response.ErrorWithKey(c, http.StatusBadRequest, "redeem code unavailable", "error.redeemCodeUnavailable")
		return
	}

	result, err := h.repo.RedeemCodeForUser(user.ID, normalized)
	if err != nil {
		if errors.Is(err, repository.ErrRedeemUnavailable) {
			response.ErrorWithKey(c, http.StatusBadRequest, "redeem code unavailable", "error.redeemCodeUnavailable")
			return
		}
		response.ErrorWithKey(c, http.StatusBadRequest, "redeem code unavailable", "error.redeemCodeUnavailable")
		return
	}

	if result.RewardType == model.RedeemRewardCredits {
		response.OK(c, gin.H{
			"reward_type":   "credits",
			"credit_amount": result.CreditAmount,
			"balance":       result.Balance,
		})
		return
	}
	response.OK(c, gin.H{
		"reward_type":       "group",
		"target_group_id":   result.TargetGroupID,
		"target_group_name": result.TargetGroupName,
		"group_changed":     result.GroupChanged,
	})
}

type createRedeemBody struct {
	Code          string   `json:"code" binding:"required"`
	RewardType    string   `json:"reward_type" binding:"required"`
	CreditAmount  *float64 `json:"credit_amount"`
	TargetGroupID *uint    `json:"target_group_id"`
	AudienceType  string   `json:"audience_type" binding:"required"`
	AudienceIDs   []uint   `json:"audience_ids"`
	MaxPerUser    *int     `json:"max_per_user"`
	MaxTotal      *int     `json:"max_total"`
	ExpiresAt     *string  `json:"expires_at"`
}

type batchRedeemBody struct {
	Count         *int     `json:"count"`
	RewardType    string   `json:"reward_type" binding:"required"`
	CreditAmount  *float64 `json:"credit_amount"`
	TargetGroupID *uint    `json:"target_group_id"`
	AudienceType  string   `json:"audience_type" binding:"required"`
	AudienceIDs   []uint   `json:"audience_ids"`
	MaxPerUser    *int     `json:"max_per_user"`
	ExpiresAt     *string  `json:"expires_at"`
}

func parseOptionalExpires(raw *string) (*time.Time, error) {
	if raw == nil || *raw == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, *raw)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func validateMaxCount(v *int) error {
	if v == nil {
		return nil
	}
	if *v < 1 {
		return errors.New("invalid max")
	}
	return nil
}

func (h *RedeemCodeHandler) buildRewardFields(rewardType string, creditAmount *float64, targetGroupID *uint) (*model.Credit, *uint, error) {
	switch rewardType {
	case model.RedeemRewardCredits:
		if creditAmount == nil || targetGroupID != nil {
			return nil, nil, errors.New("invalid reward")
		}
		amt, err := model.ParseDisplayCredit(*creditAmount, false, true)
		if err != nil || amt <= 0 {
			return nil, nil, errors.New("invalid credit")
		}
		return &amt, nil, nil
	case model.RedeemRewardGroup:
		if targetGroupID == nil || creditAmount != nil {
			return nil, nil, errors.New("invalid reward")
		}
		if _, err := h.repo.FindUserGroup(*targetGroupID); err != nil {
			return nil, nil, errors.New("group not found")
		}
		return nil, targetGroupID, nil
	default:
		return nil, nil, errors.New("invalid reward type")
	}
}

func (h *RedeemCodeHandler) validateAudience(audienceType string, ids []uint) (model.UintSlice, error) {
	ids = uniqueIDs(ids)
	switch audienceType {
	case model.RedeemAudienceAll:
		return model.UintSlice{}, nil
	case model.RedeemAudienceUsers, model.RedeemAudienceGroups:
		if len(ids) == 0 {
			return nil, errors.New("audience required")
		}
		if err := h.repo.EnsureAudienceIDsExist(audienceType, ids); err != nil {
			return nil, err
		}
		return model.UintSlice(ids), nil
	default:
		return nil, errors.New("invalid audience")
	}
}

func uniqueIDs(ids []uint) []uint {
	seen := make(map[uint]struct{}, len(ids))
	out := make([]uint, 0, len(ids))
	for _, id := range ids {
		if id == 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func redeemCodeView(code *model.RedeemCode) gin.H {
	now := time.Now()
	isExpired := code.ExpiresAt != nil && !code.ExpiresAt.After(now)
	isExhausted := code.MaxTotal != nil && code.RedeemedCount >= *code.MaxTotal
	isRedeemable := code.Listed && !isExpired && !isExhausted

	var groupName interface{}
	if code.TargetGroup != nil {
		groupName = code.TargetGroup.Name
	}

	audienceIDs := code.AudienceIDs
	if audienceIDs == nil {
		audienceIDs = model.UintSlice{}
	}

	return gin.H{
		"id":                code.ID,
		"code_display":      code.CodeDisplay,
		"reward_type":       code.RewardType,
		"credit_amount":     code.CreditAmount,
		"target_group_id":   code.TargetGroupID,
		"target_group_name": groupName,
		"audience_type":     code.AudienceType,
		"audience_ids":      audienceIDs,
		"max_per_user":      code.MaxPerUser,
		"max_total":         code.MaxTotal,
		"redeemed_count":    code.RedeemedCount,
		"expires_at":        code.ExpiresAt,
		"listed":            code.Listed,
		"is_expired":        isExpired,
		"is_exhausted":      isExhausted,
		"is_redeemable":     isRedeemable,
		"batch_id":          code.BatchID,
		"created_by":        code.CreatedBy,
		"created_at":        code.CreatedAt,
		"updated_at":        code.UpdatedAt,
	}
}

// AdminCreate POST /admin/redeem-codes
func (h *RedeemCodeHandler) AdminCreate(c *gin.Context) {
	admin := ctxutil.GetUser(c)
	if admin == nil {
		response.ErrorWithKey(c, http.StatusUnauthorized, "unauthorized", "error.unauthorized")
		return
	}

	var body createRedeemBody
	if err := c.ShouldBindJSON(&body); err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid request body", "error.invalidRequestBody")
		return
	}

	normalized, ok := helpers.NormalizeRedeemCode(body.Code)
	if !ok {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid redeem code", "error.redeemCodeInvalidFormat")
		return
	}

	creditAmt, targetGroupID, err := h.buildRewardFields(body.RewardType, body.CreditAmount, body.TargetGroupID)
	if err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid reward", "error.redeemCodeInvalidReward")
		return
	}

	audienceIDs, err := h.validateAudience(body.AudienceType, body.AudienceIDs)
	if err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid audience", "error.redeemCodeInvalidAudience")
		return
	}

	if err := validateMaxCount(body.MaxPerUser); err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid max_per_user", "error.invalidRequestBody")
		return
	}
	if err := validateMaxCount(body.MaxTotal); err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid max_total", "error.invalidRequestBody")
		return
	}

	expiresAt, err := parseOptionalExpires(body.ExpiresAt)
	if err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid expires_at", "error.invalidRequestBody")
		return
	}

	code := model.RedeemCode{
		CodeNormalized: normalized,
		CodeDisplay:    normalized,
		RewardType:     body.RewardType,
		CreditAmount:   creditAmt,
		TargetGroupID:  targetGroupID,
		AudienceType:   body.AudienceType,
		AudienceIDs:    audienceIDs,
		MaxPerUser:     body.MaxPerUser,
		MaxTotal:       body.MaxTotal,
		RedeemedCount:  0,
		ExpiresAt:      expiresAt,
		Listed:         true,
		CreatedBy:      admin.ID,
	}
	if err := h.repo.CreateRedeemCodeIfNoConflict(&code); err != nil {
		if errors.Is(err, repository.ErrRedeemCodeConflict) {
			response.Conflict(c, "error.redeemCodeConflict")
			return
		}
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to create redeem code", "error.databaseError")
		return
	}
	if code.TargetGroupID != nil {
		if g, err := h.repo.FindUserGroup(*code.TargetGroupID); err == nil {
			code.TargetGroup = g
		}
	}
	response.Created(c, redeemCodeView(&code))
}

// AdminBatchCreate POST /admin/redeem-codes/batch
func (h *RedeemCodeHandler) AdminBatchCreate(c *gin.Context) {
	admin := ctxutil.GetUser(c)
	if admin == nil {
		response.ErrorWithKey(c, http.StatusUnauthorized, "unauthorized", "error.unauthorized")
		return
	}

	var body batchRedeemBody
	if err := c.ShouldBindJSON(&body); err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid request body", "error.invalidRequestBody")
		return
	}

	count := model.RedeemCodeBatchDefault
	if body.Count != nil {
		count = *body.Count
	}
	if count < 1 || count > model.RedeemCodeBatchMax {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid count", "error.invalidRequestBody")
		return
	}

	creditAmt, targetGroupID, err := h.buildRewardFields(body.RewardType, body.CreditAmount, body.TargetGroupID)
	if err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid reward", "error.redeemCodeInvalidReward")
		return
	}

	audienceIDs, err := h.validateAudience(body.AudienceType, body.AudienceIDs)
	if err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid audience", "error.redeemCodeInvalidAudience")
		return
	}

	if err := validateMaxCount(body.MaxPerUser); err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid max_per_user", "error.invalidRequestBody")
		return
	}

	expiresAt, err := parseOptionalExpires(body.ExpiresAt)
	if err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid expires_at", "error.invalidRequestBody")
		return
	}

	batchID := uuid.New().String()
	template := model.RedeemCode{
		RewardType:    body.RewardType,
		CreditAmount:  creditAmt,
		TargetGroupID: targetGroupID,
		AudienceType:  body.AudienceType,
		AudienceIDs:   audienceIDs,
		MaxPerUser:    body.MaxPerUser,
		ExpiresAt:     expiresAt,
		CreatedBy:     admin.ID,
	}

	created, err := h.repo.CreateRedeemCodeBatch(template, count, batchID)
	if err != nil {
		if errors.Is(err, repository.ErrRedeemBatchFailed) {
			response.ErrorWithKey(c, http.StatusConflict, "batch generation failed", "error.redeemCodeConflict")
			return
		}
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to create batch", "error.databaseError")
		return
	}

	items := make([]gin.H, 0, len(created))
	for i := range created {
		items = append(items, redeemCodeView(&created[i]))
	}
	response.Created(c, gin.H{
		"batch_id": batchID,
		"items":    items,
	})
}

// AdminList GET /admin/redeem-codes
func (h *RedeemCodeHandler) AdminList(c *gin.Context) {
	page, perPage := helpers.ParsePageParams(c, 20, 100)
	filter := repository.RedeemCodeListFilter{
		BatchID: c.Query("batch_id"),
		Q:       c.Query("q"),
	}
	if listedRaw := c.Query("listed"); listedRaw != "" {
		v := listedRaw == "true" || listedRaw == "1"
		if listedRaw == "false" || listedRaw == "0" {
			v = false
		}
		if listedRaw == "true" || listedRaw == "1" || listedRaw == "false" || listedRaw == "0" {
			filter.Listed = &v
		}
	}

	codes, total, err := h.repo.ListRedeemCodes(page, perPage, filter)
	if err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "failed to list redeem codes", "error.databaseError")
		return
	}
	items := make([]gin.H, 0, len(codes))
	for i := range codes {
		items = append(items, redeemCodeView(&codes[i]))
	}
	response.Paginated(c, items, total, page, perPage)
}

// AdminDelist POST /admin/redeem-codes/:id/delist
func (h *RedeemCodeHandler) AdminDelist(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid id", "error.invalidRequestBody")
		return
	}
	code, err := h.repo.FindRedeemCodeByID(uint(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.NotFound(c, "error.redeemCodeNotFound")
			return
		}
		response.ErrorWithKey(c, http.StatusInternalServerError, "database error", "error.databaseError")
		return
	}
	if !code.Listed {
		response.OK(c, redeemCodeView(code))
		return
	}
	if err := h.repo.UpdateRedeemCodeListed(code.ID, false, false); err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "database error", "error.databaseError")
		return
	}
	code.Listed = false
	response.OK(c, redeemCodeView(code))
}

// AdminRelist POST /admin/redeem-codes/:id/relist
func (h *RedeemCodeHandler) AdminRelist(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid id", "error.invalidRequestBody")
		return
	}
	code, err := h.repo.RelistRedeemCode(uint(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.NotFound(c, "error.redeemCodeNotFound")
			return
		}
		if errors.Is(err, repository.ErrRedeemCodeConflict) {
			response.Conflict(c, "error.redeemCodeConflict")
			return
		}
		response.ErrorWithKey(c, http.StatusInternalServerError, "database error", "error.databaseError")
		return
	}
	response.OK(c, redeemCodeView(code))
}

// AdminListRedemptions GET /admin/redeem-codes/:id/redemptions
func (h *RedeemCodeHandler) AdminListRedemptions(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		response.ErrorWithKey(c, http.StatusBadRequest, "invalid id", "error.invalidRequestBody")
		return
	}
	if _, err := h.repo.FindRedeemCodeByID(uint(id)); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.NotFound(c, "error.redeemCodeNotFound")
			return
		}
		response.ErrorWithKey(c, http.StatusInternalServerError, "database error", "error.databaseError")
		return
	}

	page, perPage := helpers.ParsePageParams(c, 20, 100)
	rows, total, err := h.repo.ListRedeemCodeRedemptions(uint(id), page, perPage)
	if err != nil {
		response.ErrorWithKey(c, http.StatusInternalServerError, "database error", "error.databaseError")
		return
	}

	items := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		email := ""
		if row.User != nil {
			email = row.User.Email
		}
		var groupName *string
		if row.TargetGroup != nil {
			name := row.TargetGroup.Name
			groupName = &name
		}
		items = append(items, gin.H{
			"id":                row.ID,
			"user_id":           row.UserID,
			"user_email":        email,
			"reward_type":       row.RewardType,
			"credit_amount":     row.CreditAmount,
			"target_group_id":   row.TargetGroupID,
			"target_group_name": groupName,
			"group_changed":     row.GroupChanged,
			"created_at":        row.CreatedAt,
		})
	}
	response.Paginated(c, items, total, page, perPage)
}
