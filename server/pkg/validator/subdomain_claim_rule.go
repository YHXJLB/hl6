package validator

import (
	"fmt"
	"regexp"
	"strings"

	"hl6-server/internal/model"
)

// ClaimRuleValidationError 子域创建规则校验错误
type ClaimRuleValidationError struct {
	Key string
}

func (e *ClaimRuleValidationError) Error() string { return e.Key }

// ValidateSubdomainClaimRule 校验子域创建规则的字段合法性
func ValidateSubdomainClaimRule(rule *model.SubdomainClaimRule) error {
	if strings.TrimSpace(rule.Name) == "" {
		return &ClaimRuleValidationError{Key: "error.claimRuleNameRequired"}
	}
	if len(rule.Name) > 128 {
		return &ClaimRuleValidationError{Key: "error.claimRuleNameTooLong"}
	}

	// 匹配类型
	switch rule.MatchType {
	case model.ClaimRuleMatchKeyword, model.ClaimRuleMatchRegex:
	default:
		return &ClaimRuleValidationError{Key: "error.claimRuleInvalidMatchType"}
	}

	// 关键词模式校验
	if rule.MatchType == model.ClaimRuleMatchKeyword {
		if len(rule.Keywords) == 0 {
			return &ClaimRuleValidationError{Key: "error.claimRuleKeywordsRequired"}
		}
		if len(rule.Keywords) > 50 {
			return &ClaimRuleValidationError{Key: "error.claimRuleTooManyKeywords"}
		}
		for _, kw := range rule.Keywords {
			kw = strings.TrimSpace(kw)
			if kw == "" {
				return &ClaimRuleValidationError{Key: "error.claimRuleEmptyKeyword"}
			}
			if len(kw) > 128 {
				return &ClaimRuleValidationError{Key: "error.claimRuleKeywordTooLong"}
			}
		}
		switch rule.KeywordLogic {
		case model.ClaimRuleKeywordLogicAny, model.ClaimRuleKeywordLogicAll:
		default:
			return &ClaimRuleValidationError{Key: "error.claimRuleInvalidKeywordLogic"}
		}
	}

	// 正则模式校验
	if rule.MatchType == model.ClaimRuleMatchRegex {
		pattern := strings.TrimSpace(rule.Pattern)
		if pattern == "" {
			return &ClaimRuleValidationError{Key: "error.claimRulePatternRequired"}
		}
		if len(pattern) > 512 {
			return &ClaimRuleValidationError{Key: "error.claimRulePatternTooLong"}
		}
		if _, err := regexp.Compile(pattern); err != nil {
			return &ClaimRuleValidationError{Key: "error.claimRuleInvalidRegex"}
		}
	}

	// 动作校验
	switch rule.Action {
	case model.ClaimRuleActionReject, model.ClaimRuleActionRejectNotify:
	default:
		return &ClaimRuleValidationError{Key: "error.claimRuleInvalidAction"}
	}

	// 拒绝消息长度
	if len(rule.RejectMessage) > 1024 {
		return &ClaimRuleValidationError{Key: "error.claimRuleRejectMsgTooLong"}
	}

	return nil
}

// ValidateSubdomainClaimRuleScope 校验规则作用域中的域名是否都存在
func ValidateSubdomainClaimRuleScope(rule *model.SubdomainClaimRule, domainExists func(uint) bool) error {
	for _, did := range rule.ScopeDomainIDs {
		if !domainExists(did) {
			return fmt.Errorf("scope domain %d not found", did)
		}
	}
	return nil
}
