package helpers

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"hl6-server/internal/model"
)

// NormalizeRedeemCode 去除首尾空白、校验字符集（字母/数字/中文）、英文大写归一化。
// 中间空白或非法字符返回 ok=false。
func NormalizeRedeemCode(raw string) (normalized string, ok bool) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", false
	}
	if utf8.RuneCountInString(s) > model.RedeemCodeMaxLen {
		return "", false
	}

	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if unicode.IsSpace(r) {
			return "", false
		}
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			return "", false
		}
		// 仅对拉丁小写做大写；中文等保持原字形
		if r >= 'a' && r <= 'z' {
			r = r - 'a' + 'A'
		}
		b.WriteRune(r)
	}
	return b.String(), true
}
