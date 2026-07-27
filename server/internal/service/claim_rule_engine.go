package service

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"sync"

	"hl6-server/internal/model"
	"hl6-server/internal/repository"
)

// ClaimRuleMatchResult 单条规则的匹配结果
type ClaimRuleMatchResult struct {
	RuleID   uint   `json:"rule_id"`
	RuleName string `json:"rule_name"`
	Action   string `json:"action"`
	Message  string `json:"message"` // 替换后的拒绝消息
}

// ClaimRuleEngine 子域创建规则匹配引擎——直接对用户输入的子域名字符串进行检测
type ClaimRuleEngine struct {
	repo        *repository.Repository
	regexCache  sync.Map // map[uint]*regexp.Regexp
}

func NewClaimRuleEngine(repo *repository.Repository) *ClaimRuleEngine {
	return &ClaimRuleEngine{repo: repo}
}

// CheckSubdomainName 对用户输入的子域名执行规则检测，返回首个命中的规则（按优先级排序）
func (e *ClaimRuleEngine) CheckSubdomainName(ctx context.Context, domainID uint, subdomainName string, domainName string) (*ClaimRuleMatchResult, error) {
	rules, err := e.repo.ListEnabledSubdomainClaimRules()
	if err != nil {
		return nil, fmt.Errorf("failed to load claim rules: %w", err)
	}

	fqdn := subdomainName + "." + domainName

	for _, rule := range rules {
		// 检查作用域
		if !claimRuleInScope(rule.ScopeDomainIDs, domainID) {
			continue
		}
		matched := e.matchRule(&rule, subdomainName)
		if matched {
			// 构建拒绝消息（支持模板变量）
			message := e.buildRejectMessage(rule.RejectMessage, rule.Name, fqdn, subdomainName)
			return &ClaimRuleMatchResult{
				RuleID:   rule.ID,
				RuleName: rule.Name,
				Action:   rule.Action,
				Message:  message,
			}, nil
		}
	}
	return nil, nil
}

// matchRule 判断单条规则是否命中
func (e *ClaimRuleEngine) matchRule(rule *model.SubdomainClaimRule, input string) bool {
	switch rule.MatchType {
	case model.ClaimRuleMatchKeyword:
		return e.matchKeyword(rule, input)
	case model.ClaimRuleMatchRegex:
		return e.matchRegex(rule, input)
	default:
		return false
	}
}

// matchKeyword 关键词匹配
func (e *ClaimRuleEngine) matchKeyword(rule *model.SubdomainClaimRule, input string) bool {
	searchStr := input
	if !rule.CaseSensitive {
		searchStr = strings.ToLower(input)
	}

	switch rule.KeywordLogic {
	case model.ClaimRuleKeywordLogicAny:
		// 任一关键词命中即触发
		for _, kw := range rule.Keywords {
			target := kw
			if !rule.CaseSensitive {
				target = strings.ToLower(kw)
			}
			if strings.Contains(searchStr, target) {
				return true
			}
		}
		return false
	case model.ClaimRuleKeywordLogicAll:
		// 所有关键词都必须命中
		for _, kw := range rule.Keywords {
			target := kw
			if !rule.CaseSensitive {
				target = strings.ToLower(kw)
			}
			if !strings.Contains(searchStr, target) {
				return false
			}
		}
		return true
	default:
		return false
	}
}

// matchRegex 正则匹配
func (e *ClaimRuleEngine) matchRegex(rule *model.SubdomainClaimRule, input string) bool {
	re, err := e.getCompiledRegex(rule.ID, rule.Pattern, rule.CaseSensitive)
	if err != nil {
		return false
	}
	return re.MatchString(input)
}

// getCompiledRegex 获取/缓存编译后的正则表达式
func (e *ClaimRuleEngine) getCompiledRegex(ruleID uint, pattern string, caseSensitive bool) (*regexp.Regexp, error) {
	cacheKey := ruleID
	if cached, ok := e.regexCache.Load(cacheKey); ok {
		return cached.(*regexp.Regexp), nil
	}

	flags := ""
	if !caseSensitive {
		flags = "(?i)"
	}
	fullPattern := flags + pattern
	re, err := regexp.Compile(fullPattern)
	if err != nil {
		return nil, err
	}
	e.regexCache.Store(cacheKey, re)
	return re, nil
}

// buildRejectMessage 构建拒绝消息，支持模板变量 {{fqdn}}、{{name}}、{{rule_name}}
func (e *ClaimRuleEngine) buildRejectMessage(template, ruleName, fqdn, subdomainName string) string {
	if template == "" {
		template = "您的子域{{fqdn}}因违反规则「{{rule_name}}」无法申请"
	}
	msg := template
	msg = strings.ReplaceAll(msg, "{{fqdn}}", fqdn)
	msg = strings.ReplaceAll(msg, "{{name}}", subdomainName)
	msg = strings.ReplaceAll(msg, "{{rule_name}}", ruleName)
	return msg
}

// claimRuleInScope 检查规则是否在指定域名的作用域内（空数组=全局生效）
func claimRuleInScope(scopeDomainIDs []uint, domainID uint) bool {
	if len(scopeDomainIDs) == 0 {
		return true
	}
	for _, did := range scopeDomainIDs {
		if did == domainID {
			return true
		}
	}
	return false
}

// TestSingleRule 测试单条草稿规则是否命中（不依赖数据库，用于前端实时预览）
func TestSingleRule(rule *model.SubdomainClaimRule, subdomainName, domainName string, domainID uint) *ClaimRuleMatchResult {
	if !claimRuleInScope(rule.ScopeDomainIDs, domainID) {
		return nil
	}

	engine := &ClaimRuleRuleTester{}
	matched := engine.matchRule(rule, subdomainName)
	if !matched {
		return nil
	}

	fqdn := subdomainName + "." + domainName
	message := buildRejectMessageStatic(rule.RejectMessage, rule.Name, fqdn, subdomainName)
	return &ClaimRuleMatchResult{
		RuleID:   rule.ID,
		RuleName: rule.Name,
		Action:   rule.Action,
		Message:  message,
	}
}

// ClaimRuleRuleTester 轻量级测试器（无缓存，用于单条测试）
type ClaimRuleRuleTester struct{}

func (t *ClaimRuleRuleTester) matchRule(rule *model.SubdomainClaimRule, input string) bool {
	switch rule.MatchType {
	case model.ClaimRuleMatchKeyword:
		return t.matchKeyword(rule, input)
	case model.ClaimRuleMatchRegex:
		return t.matchRegex(rule, input)
	default:
		return false
	}
}

func (t *ClaimRuleRuleTester) matchKeyword(rule *model.SubdomainClaimRule, input string) bool {
	searchStr := input
	if !rule.CaseSensitive {
		searchStr = strings.ToLower(input)
	}
	switch rule.KeywordLogic {
	case model.ClaimRuleKeywordLogicAny:
		for _, kw := range rule.Keywords {
			target := kw
			if !rule.CaseSensitive {
				target = strings.ToLower(kw)
			}
			if strings.Contains(searchStr, target) {
				return true
			}
		}
		return false
	case model.ClaimRuleKeywordLogicAll:
		for _, kw := range rule.Keywords {
			target := kw
			if !rule.CaseSensitive {
				target = strings.ToLower(kw)
			}
			if !strings.Contains(searchStr, target) {
				return false
			}
		}
		return true
	default:
		return false
	}
}

func (t *ClaimRuleRuleTester) matchRegex(rule *model.SubdomainClaimRule, input string) bool {
	flags := ""
	if !rule.CaseSensitive {
		flags = "(?i)"
	}
	re, err := regexp.Compile(flags + rule.Pattern)
	if err != nil {
		return false
	}
	return re.MatchString(input)
}

func buildRejectMessageStatic(template, ruleName, fqdn, subdomainName string) string {
	if template == "" {
		template = "您的子域{{fqdn}}因违反规则「{{rule_name}}」无法申请"
	}
	msg := template
	msg = strings.ReplaceAll(msg, "{{fqdn}}", fqdn)
	msg = strings.ReplaceAll(msg, "{{name}}", subdomainName)
	msg = strings.ReplaceAll(msg, "{{rule_name}}", ruleName)
	return msg
}
