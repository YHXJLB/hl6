package model

import (
	"time"
)

const (
	RedeemRewardCredits = "credits"
	RedeemRewardGroup   = "group"

	RedeemAudienceAll    = "all"
	RedeemAudienceUsers  = "users"
	RedeemAudienceGroups = "groups"

	RedeemCodeMaxLen       = 64
	RedeemCodeBatchLen     = 5
	RedeemCodeBatchMax     = 200
	RedeemCodeBatchDefault = 10
)

// RedeemCode 兑换码主表。
type RedeemCode struct {
	ID             uint       `json:"id" gorm:"primaryKey"`
	CodeNormalized string     `json:"code_normalized" gorm:"type:varchar(64);not null;index"`
	CodeDisplay    string     `json:"code_display" gorm:"type:varchar(64);not null"`
	RewardType     string     `json:"reward_type" gorm:"type:varchar(16);not null"`
	CreditAmount   *Credit    `json:"credit_amount,omitempty" gorm:"type:bigint"`
	TargetGroupID  *uint      `json:"target_group_id,omitempty" gorm:"index"`
	TargetGroup    *UserGroup `json:"target_group,omitempty" gorm:"foreignKey:TargetGroupID"`
	AudienceType   string     `json:"audience_type" gorm:"type:varchar(16);not null"`
	AudienceIDs    UintSlice  `json:"audience_ids" gorm:"type:jsonb"`
	MaxPerUser     *int       `json:"max_per_user,omitempty"`
	MaxTotal       *int       `json:"max_total,omitempty"`
	RedeemedCount  int        `json:"redeemed_count" gorm:"not null;default:0"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	Listed         bool       `json:"listed" gorm:"not null;default:true;index"`
	BatchID        *string    `json:"batch_id,omitempty" gorm:"type:uuid;index"`
	CreatedBy      uint       `json:"created_by" gorm:"not null"`
	Creator        *User      `json:"creator,omitempty" gorm:"foreignKey:CreatedBy"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// RedeemCodeRedemption 成功兑换记录。
type RedeemCodeRedemption struct {
	ID            uint      `json:"id" gorm:"primaryKey"`
	RedeemCodeID  uint      `json:"redeem_code_id" gorm:"not null;index:idx_redeem_code_user"`
	UserID        uint      `json:"user_id" gorm:"not null;index:idx_redeem_code_user"`
	User          *User     `json:"user,omitempty" gorm:"foreignKey:UserID"`
	RewardType    string    `json:"reward_type" gorm:"type:varchar(16);not null"`
	CreditAmount  *Credit   `json:"credit_amount,omitempty" gorm:"type:bigint"`
	TargetGroupID *uint     `json:"target_group_id,omitempty"`
	GroupChanged  bool      `json:"group_changed" gorm:"not null;default:false"`
	CreatedAt     time.Time `json:"created_at"`
}
