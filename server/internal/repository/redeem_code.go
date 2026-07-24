package repository

import (
	"crypto/rand"
	"errors"
	"hash/fnv"
	"math/big"
	"time"

	"hl6-server/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrRedeemUnavailable  = errors.New("redeem code unavailable")
	ErrRedeemCodeConflict = errors.New("redeem code conflict")
	ErrRedeemBatchFailed  = errors.New("redeem code batch generation failed")
)

// RedeemResult 用户兑换成功结果（供 handler 组装响应）。
type RedeemResult struct {
	RewardType      string
	CreditAmount    *model.Credit
	Balance         *model.Credit
	TargetGroupID   *uint
	TargetGroupName string
	GroupChanged    bool
}

func (r *Repository) CreateRedeemCode(code *model.RedeemCode) error {
	return r.DB.Create(code).Error
}

// CreateRedeemCodeIfNoConflict 在事务内用 advisory lock 串行化同串创建，检查生效唯一性后插入。
func (r *Repository) CreateRedeemCodeIfNoConflict(code *model.RedeemCode) error {
	return r.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", redeemCodeLockKey(code.CodeNormalized)).Error; err != nil {
			return err
		}
		conflict, err := countActiveConflict(tx, code.CodeNormalized, 0)
		if err != nil {
			return err
		}
		if conflict > 0 {
			return ErrRedeemCodeConflict
		}
		return tx.Create(code).Error
	})
}

func (r *Repository) CreateRedeemCodes(codes []model.RedeemCode) error {
	if len(codes) == 0 {
		return nil
	}
	return r.DB.Create(&codes).Error
}

func (r *Repository) FindRedeemCodeByNormalized(normalized string) (*model.RedeemCode, error) {
	var code model.RedeemCode
	err := r.DB.Where("code_normalized = ?", normalized).First(&code).Error
	return &code, err
}

func (r *Repository) FindRedeemCodeByID(id uint) (*model.RedeemCode, error) {
	var code model.RedeemCode
	err := r.DB.Preload("TargetGroup").First(&code, id).Error
	return &code, err
}

// CountActiveConflict 统计「生效中」且归一化码相同的记录数；excludeID>0 时排除自身。
func (r *Repository) CountActiveConflict(normalized string, excludeID uint) (int64, error) {
	return countActiveConflict(r.DB, normalized, excludeID)
}

func countActiveConflict(db *gorm.DB, normalized string, excludeID uint) (int64, error) {
	now := time.Now()
	q := db.Model(&model.RedeemCode{}).
		Where("code_normalized = ?", normalized).
		Where("listed = ?", true).
		Where("(expires_at IS NULL OR expires_at > ?)", now).
		Where("(max_total IS NULL OR redeemed_count < max_total)")
	if excludeID > 0 {
		q = q.Where("id <> ?", excludeID)
	}
	var count int64
	err := q.Count(&count).Error
	return count, err
}

func redeemCodeLockKey(normalized string) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte("redeem_code:"))
	_, _ = h.Write([]byte(normalized))
	return int64(h.Sum64())
}

// RelistRedeemCode 重新上架；若上架后会进入「生效中」集合则校验唯一性（排除自身）。
func (r *Repository) RelistRedeemCode(id uint) (*model.RedeemCode, error) {
	err := r.Transaction(func(tx *gorm.DB) error {
		code, err := r.LockRedeemCodeByID(tx, id)
		if err != nil {
			return err
		}

		now := time.Now()
		clearExpires := code.ExpiresAt != nil && !code.ExpiresAt.After(now)
		exhausted := code.MaxTotal != nil && code.RedeemedCount >= *code.MaxTotal

		// 上架后若会进入生效集合，需保证归一化串唯一
		if !exhausted {
			if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", redeemCodeLockKey(code.CodeNormalized)).Error; err != nil {
				return err
			}
			conflict, err := countActiveConflict(tx, code.CodeNormalized, code.ID)
			if err != nil {
				return err
			}
			if conflict > 0 {
				return ErrRedeemCodeConflict
			}
		}

		updates := map[string]interface{}{
			"listed": true,
		}
		if clearExpires {
			updates["expires_at"] = nil
		}
		return tx.Model(&model.RedeemCode{}).Where("id = ?", id).Updates(updates).Error
	})
	if err != nil {
		return nil, err
	}
	return r.FindRedeemCodeByID(id)
}

func (r *Repository) LockRedeemCodeByID(tx *gorm.DB, id uint) (*model.RedeemCode, error) {
	var code model.RedeemCode
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&code, id).Error
	return &code, err
}

func (r *Repository) CountUserRedemptions(tx *gorm.DB, redeemCodeID, userID uint) (int64, error) {
	var count int64
	err := tx.Model(&model.RedeemCodeRedemption{}).
		Where("redeem_code_id = ? AND user_id = ?", redeemCodeID, userID).
		Count(&count).Error
	return count, err
}

func (r *Repository) InsertRedemption(tx *gorm.DB, redemption *model.RedeemCodeRedemption) error {
	return tx.Create(redemption).Error
}

func (r *Repository) IncrementRedeemedCount(tx *gorm.DB, id uint) error {
	return tx.Model(&model.RedeemCode{}).Where("id = ?", id).
		UpdateColumn("redeemed_count", gorm.Expr("redeemed_count + 1")).Error
}

func (r *Repository) UpdateRedeemCodeListed(id uint, listed bool, clearExpires bool) error {
	updates := map[string]interface{}{
		"listed": listed,
	}
	if clearExpires {
		updates["expires_at"] = nil
	}
	return r.DB.Model(&model.RedeemCode{}).Where("id = ?", id).Updates(updates).Error
}

type RedeemCodeListFilter struct {
	Listed  *bool
	BatchID string
	Q       string
}

func (r *Repository) ListRedeemCodes(page, perPage int, filter RedeemCodeListFilter) ([]model.RedeemCode, int64, error) {
	var codes []model.RedeemCode
	var total int64
	q := r.DB.Model(&model.RedeemCode{})
	if filter.Listed != nil {
		q = q.Where("listed = ?", *filter.Listed)
	}
	if filter.BatchID != "" {
		q = q.Where("batch_id = ?", filter.BatchID)
	}
	if filter.Q != "" {
		like := "%" + escapeLike(filter.Q) + "%"
		q = q.Where("code_display ILIKE ? OR code_normalized ILIKE ?", like, like)
	}
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := q.Preload("TargetGroup").
		// 可兑在前 → 已下架 → 已兑完；同组内按创建时间新→旧
		Order(`(CASE
			WHEN listed = false THEN 1
			WHEN max_total IS NOT NULL AND redeemed_count >= max_total THEN 2
			ELSE 0
		END) ASC, created_at DESC`).
		Offset((page - 1) * perPage).
		Limit(perPage).
		Find(&codes).Error
	return codes, total, err
}

func (r *Repository) ListRedeemCodeRedemptions(codeID uint, page, perPage int) ([]model.RedeemCodeRedemption, int64, error) {
	var items []model.RedeemCodeRedemption
	var total int64
	q := r.DB.Model(&model.RedeemCodeRedemption{}).Where("redeem_code_id = ?", codeID)
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := q.Preload("User").Preload("TargetGroup").
		Order("id DESC").
		Offset((page - 1) * perPage).
		Limit(perPage).
		Find(&items).Error
	return items, total, err
}

func (r *Repository) CountUsersByIDs(ids []uint) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var count int64
	err := r.DB.Model(&model.User{}).Where("id IN ?", ids).Count(&count).Error
	return count, err
}

func (r *Repository) CountGroupsByIDs(ids []uint) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var count int64
	err := r.DB.Model(&model.UserGroup{}).Where("id IN ?", ids).Count(&count).Error
	return count, err
}

func audienceAllows(tx *gorm.DB, code *model.RedeemCode, userID uint) bool {
	switch code.AudienceType {
	case model.RedeemAudienceAll:
		return true
	case model.RedeemAudienceUsers:
		for _, id := range code.AudienceIDs {
			if id == userID {
				return true
			}
		}
		return false
	case model.RedeemAudienceGroups:
		var user model.User
		if err := tx.Select("group_id").First(&user, userID).Error; err != nil {
			return false
		}
		if user.GroupID == nil {
			return false
		}
		for _, id := range code.AudienceIDs {
			if id == *user.GroupID {
				return true
			}
		}
		return false
	default:
		return false
	}
}

// RedeemCodeForUser 事务内行锁兑换：校验 → 发奖/改组 → 写记录 → 递增次数。
// 同归一化码可能存在多条历史行；优先锁定「生效中」记录，避免落到旧行误失败（FR-021）。
func (r *Repository) RedeemCodeForUser(userID uint, normalizedCode string) (*RedeemResult, error) {
	var result RedeemResult
	err := r.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		var code model.RedeemCode
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("code_normalized = ?", normalizedCode).
			Where("listed = ?", true).
			Where("(expires_at IS NULL OR expires_at > ?)", now).
			Where("(max_total IS NULL OR redeemed_count < max_total)").
			Order("id DESC").
			First(&code).Error; err != nil {
			return ErrRedeemUnavailable
		}
		if code.MaxPerUser != nil {
			cnt, err := r.CountUserRedemptions(tx, code.ID, userID)
			if err != nil {
				return err
			}
			if int(cnt) >= *code.MaxPerUser {
				return ErrRedeemUnavailable
			}
		}
		if !audienceAllows(tx, &code, userID) {
			return ErrRedeemUnavailable
		}

		result.RewardType = code.RewardType
		groupChanged := false

		switch code.RewardType {
		case model.RedeemRewardCredits:
			if code.CreditAmount == nil || *code.CreditAmount <= 0 {
				return ErrRedeemUnavailable
			}
			if err := r.GrantCredits(tx, userID, *code.CreditAmount, "txn.redeemCode", nil); err != nil {
				return err
			}
			var bal model.CreditBalance
			if err := tx.Where("user_id = ?", userID).First(&bal).Error; err != nil {
				return err
			}
			amt := *code.CreditAmount
			result.CreditAmount = &amt
			b := bal.Balance
			result.Balance = &b

		case model.RedeemRewardGroup:
			if code.TargetGroupID == nil {
				return ErrRedeemUnavailable
			}
			var group model.UserGroup
			if err := tx.First(&group, *code.TargetGroupID).Error; err != nil {
				return ErrRedeemUnavailable
			}
			var user model.User
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, userID).Error; err != nil {
				return err
			}
			groupChanged = user.GroupID == nil || *user.GroupID != *code.TargetGroupID
			if groupChanged {
				if err := tx.Model(&model.User{}).Where("id = ?", userID).Update("group_id", *code.TargetGroupID).Error; err != nil {
					return err
				}
			}
			result.TargetGroupID = code.TargetGroupID
			result.TargetGroupName = group.Name
			result.GroupChanged = groupChanged

		default:
			return ErrRedeemUnavailable
		}

		redemption := model.RedeemCodeRedemption{
			RedeemCodeID:  code.ID,
			UserID:        userID,
			RewardType:    code.RewardType,
			CreditAmount:  code.CreditAmount,
			TargetGroupID: code.TargetGroupID,
			GroupChanged:  groupChanged,
		}
		if code.RewardType == model.RedeemRewardCredits {
			redemption.TargetGroupID = nil
			redemption.GroupChanged = false
		} else {
			redemption.CreditAmount = nil
		}
		if err := r.InsertRedemption(tx, &redemption); err != nil {
			return err
		}
		return r.IncrementRedeemedCount(tx, code.ID)
	})
	if err != nil {
		return nil, err
	}
	return &result, nil
}

const batchCodeAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

func generateBatchCode() (string, error) {
	b := make([]byte, model.RedeemCodeBatchLen)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(batchCodeAlphabet))))
		if err != nil {
			return "", err
		}
		b[i] = batchCodeAlphabet[n.Int64()]
	}
	return string(b), nil
}

// CreateRedeemCodeBatch 事务内生成一批一次性码；碰撞重试，失败整批回滚。
func (r *Repository) CreateRedeemCodeBatch(template model.RedeemCode, count int, batchID string) ([]model.RedeemCode, error) {
	once := 1
	template.MaxTotal = &once
	template.MaxPerUser = &once
	template.BatchID = &batchID
	template.Listed = true

	var created []model.RedeemCode
	err := r.Transaction(func(tx *gorm.DB) error {
		created = make([]model.RedeemCode, 0, count)
		used := make(map[string]struct{}, count)

		for i := 0; i < count; i++ {
			var codeStr string
			ok := false
			for attempt := 0; attempt < 20; attempt++ {
				s, err := generateBatchCode()
				if err != nil {
					return err
				}
				if _, exists := used[s]; exists {
					continue
				}
				var conflict int64
				now := time.Now()
				if err := tx.Model(&model.RedeemCode{}).
					Where("code_normalized = ?", s).
					Where("listed = ?", true).
					Where("(expires_at IS NULL OR expires_at > ?)", now).
					Where("(max_total IS NULL OR redeemed_count < max_total)").
					Count(&conflict).Error; err != nil {
					return err
				}
				if conflict > 0 {
					continue
				}
				codeStr = s
				used[s] = struct{}{}
				ok = true
				break
			}
			if !ok {
				return ErrRedeemBatchFailed
			}

			item := template
			item.ID = 0
			item.CodeNormalized = codeStr
			item.CodeDisplay = codeStr
			item.RedeemedCount = 0
			if err := tx.Create(&item).Error; err != nil {
				return err
			}
			created = append(created, item)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return created, nil
}

// EnsureAudienceIDsExist 校验受众 ID 是否全部存在。
func (r *Repository) EnsureAudienceIDsExist(audienceType string, ids []uint) error {
	switch audienceType {
	case model.RedeemAudienceAll:
		return nil
	case model.RedeemAudienceUsers:
		if len(ids) == 0 {
			return errors.New("audience users required")
		}
		cnt, err := r.CountUsersByIDs(ids)
		if err != nil {
			return err
		}
		if int(cnt) != len(uniqueUint(ids)) {
			return errors.New("audience users not found")
		}
	case model.RedeemAudienceGroups:
		if len(ids) == 0 {
			return errors.New("audience groups required")
		}
		cnt, err := r.CountGroupsByIDs(ids)
		if err != nil {
			return err
		}
		if int(cnt) != len(uniqueUint(ids)) {
			return errors.New("audience groups not found")
		}
	default:
		return errors.New("invalid audience type")
	}
	return nil
}

func uniqueUint(ids []uint) []uint {
	seen := make(map[uint]struct{}, len(ids))
	out := make([]uint, 0, len(ids))
	for _, id := range ids {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}
