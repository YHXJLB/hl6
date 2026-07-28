package validator

import (
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"
)

type ValidationError struct {
	Message string
	Key     string
	Params  map[string]string
}

func (e *ValidationError) Error() string { return e.Message }

func ValidateSubdomainName(name string, minLength, maxLength int) error {
	name = strings.ToLower(strings.TrimSpace(name))
	if len(name) < minLength || len(name) > maxLength {
		return &ValidationError{
			Message: fmt.Sprintf("invalid subdomain length: must be between %d and %d characters", minLength, maxLength),
			Key:     "error.invalidSubdomainLength",
		}
	}
	// 不允许首尾为点号或连字符，避免 ".x" / "x." / "-x" / "x-" 以及空标签 ".."
	if name[0] == '.' || name[0] == '-' || name[len(name)-1] == '.' || name[len(name)-1] == '-' {
		return &ValidationError{
			Message: "invalid subdomain name: must not start or end with dot or hyphen",
			Key:     "error.invalidSubdomainName",
		}
	}
	for i := 0; i < len(name); i++ {
		ch := name[i]
		switch {
		case ch >= 'a' && ch <= 'z':
			// 合法
		case ch >= '0' && ch <= '9':
			// 合法
		case ch == '-':
			// 连字符（首尾已在前一步排除）
		case ch == '_':
			// 下划线：SRV/TLSA 等服务记录名允许（如 _sip._tcp），Cloudflare 亦支持
		case ch == '.':
			// 允许多级子域（如 _sip._tcp），但禁止连续点产生空标签
			if i > 0 && name[i-1] == '.' {
				return &ValidationError{
					Message: "invalid subdomain name: empty label (consecutive dots) not allowed",
					Key:     "error.invalidSubdomainName",
				}
			}
		default:
			return &ValidationError{
				Message: "invalid subdomain name: must contain only lowercase letters, numbers, hyphens, underscores and dots",
				Key:     "error.invalidSubdomainName",
			}
		}
	}
	return nil
}

func ValidateDNSRecord(recordType, content string) error {
	switch strings.ToUpper(recordType) {
	case "A":
		ip := net.ParseIP(content)
		if ip == nil || ip.To4() == nil {
			return &ValidationError{
				Message: fmt.Sprintf("invalid IPv4 address: %s", content),
				Key:     "error.invalidIPv4",
				Params:  map[string]string{"value": content},
			}
		}
	case "AAAA":
		ip := net.ParseIP(content)
		if ip == nil || ip.To4() != nil {
			return &ValidationError{
				Message: fmt.Sprintf("invalid IPv6 address: %s", content),
				Key:     "error.invalidIPv6",
				Params:  map[string]string{"value": content},
			}
		}
	case "CNAME":
		if !isValidHostname(content) {
			return &ValidationError{
				Message: fmt.Sprintf("invalid CNAME target: %s", content),
				Key:     "error.invalidCNAME",
				Params:  map[string]string{"value": content},
			}
		}
	case "TXT":
		if strings.TrimSpace(content) == "" {
			return &ValidationError{
				Message: "TXT record content cannot be empty",
				Key:     "error.invalidTXT",
			}
		}
		if len(content) > 2048 {
			return &ValidationError{
				Message: fmt.Sprintf("TXT record content too long: %d characters (max 2048)", len(content)),
				Key:     "error.txtTooLong",
			}
		}
	case "NS":
		if !isValidHostname(content) {
			return &ValidationError{
				Message: fmt.Sprintf("invalid NS target: %s", content),
				Key:     "error.invalidNS",
				Params:  map[string]string{"value": content},
			}
		}
	case "MX":
		// MX 格式：优先级(数字) + 空格 + 主机名，例如 "10 mail.example.com"
		parts := strings.SplitN(strings.TrimSpace(content), " ", 2)
		if len(parts) != 2 {
			return &ValidationError{
				Message: fmt.Sprintf("invalid MX record format, expected 'priority host' (e.g. '10 mail.example.com'): %s", content),
				Key:     "error.invalidMXFormat",
				Params:  map[string]string{"value": content},
			}
		}
		priority := parts[0]
		host := strings.TrimSpace(parts[1])
		if _, err := strconv.Atoi(priority); err != nil || priority == "" {
			return &ValidationError{
				Message: fmt.Sprintf("invalid MX priority (must be 0-65535): %s", priority),
				Key:     "error.invalidMXPriority",
				Params:  map[string]string{"value": priority},
			}
		}
		if !isValidHostname(host) {
			return &ValidationError{
				Message: fmt.Sprintf("invalid MX host: %s", host),
				Key:     "error.invalidMXHost",
				Params:  map[string]string{"value": host},
			}
		}
	case "SRV":
		// SRV 格式：优先级 权重 端口 目标主机，例如 "10 5 5060 sip.example.com"
		fields := strings.Fields(strings.TrimSpace(content))
		if len(fields) != 4 {
			return &ValidationError{
				Message: fmt.Sprintf("invalid SRV record format, expected 'priority weight port target' (e.g. '10 5 5060 sip.example.com'): %s", content),
				Key:     "error.invalidSRVFormat",
				Params:  map[string]string{"value": content},
			}
		}
		for _, num := range fields[:3] {
			n, err := strconv.Atoi(num)
			if err != nil || n < 0 || n > 65535 {
				return &ValidationError{
					Message: fmt.Sprintf("invalid SRV priority/weight/port (must be 0-65535): %s", num),
					Key:     "error.invalidSRVPriority",
					Params:  map[string]string{"value": num},
				}
			}
		}
		if !isValidHostname(fields[3]) {
			return &ValidationError{
				Message: fmt.Sprintf("invalid SRV target: %s", fields[3]),
				Key:     "error.invalidSRVTarget",
				Params:  map[string]string{"value": fields[3]},
			}
		}
	default:
		return &ValidationError{
			Message: fmt.Sprintf("unsupported record type: %s", recordType),
			Key:     "error.unsupportedRecordType",
			Params:  map[string]string{"type": recordType},
		}
	}
	return nil
}

var hostnameRegex = regexp.MustCompile(`^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\.?$`)

func isValidHostname(host string) bool {
	if len(host) > 253 {
		return false
	}
	return hostnameRegex.MatchString(host)
}
