package repository

import (
	"hl6-server/internal/model"

	"gorm.io/gorm"
)

// ---- SubdomainClaimRule CRUD ----

func (r *Repository) ListSubdomainClaimRules() ([]model.SubdomainClaimRule, error) {
	var rules []model.SubdomainClaimRule
	err := r.DB.Order("created_at ASC").Find(&rules).Error
	if rules == nil {
		rules = []model.SubdomainClaimRule{}
	}
	return rules, err
}

func (r *Repository) ListEnabledSubdomainClaimRules() ([]model.SubdomainClaimRule, error) {
	var rules []model.SubdomainClaimRule
	err := r.DB.Where("enabled = ?", true).Order("created_at ASC").Find(&rules).Error
	if rules == nil {
		rules = []model.SubdomainClaimRule{}
	}
	return rules, err
}

func (r *Repository) FindSubdomainClaimRule(id uint) (*model.SubdomainClaimRule, error) {
	var rule model.SubdomainClaimRule
	err := r.DB.First(&rule, id).Error
	return &rule, err
}

func (r *Repository) CreateSubdomainClaimRule(rule *model.SubdomainClaimRule) error {
	return r.DB.Create(rule).Error
}

func (r *Repository) UpdateSubdomainClaimRule(rule *model.SubdomainClaimRule) error {
	return r.DB.Save(rule).Error
}

func (r *Repository) DeleteSubdomainClaimRule(id uint) error {
	return r.DB.Delete(&model.SubdomainClaimRule{}, id).Error
}

func (r *Repository) ToggleSubdomainClaimRule(id uint, enabled bool) error {
	return r.DB.Model(&model.SubdomainClaimRule{}).Where("id = ?", id).Update("enabled", enabled).Error
}

// IncrementClaimRuleHit 增加规则命中计数并更新最后命中信息
func (r *Repository) IncrementClaimRuleHit(id uint, fqdn string) error {
	return r.DB.Model(&model.SubdomainClaimRule{}).Where("id = ?", id).
		Updates(map[string]interface{}{
			"hit_count":   gorm.Expr("hit_count + 1"),
			"last_hit_at": gorm.Expr("NOW()"),
			"last_hit_fqdn": fqdn,
		}).Error
}
