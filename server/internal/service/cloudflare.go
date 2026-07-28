package service

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/cloudflare/cloudflare-go/v4"
	"github.com/cloudflare/cloudflare-go/v4/dns"
	"github.com/cloudflare/cloudflare-go/v4/option"
	"github.com/cloudflare/cloudflare-go/v4/zones"
)

type ZoneInfo struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

type CloudflareService struct {
	client *cloudflare.Client
}

var ErrCloudflareTokenEmpty = errors.New("cloudflare api token is empty")
var ErrCloudflareRecordNotFound = errors.New("cloudflare record not found")

func NewCloudflareService(apiToken string) (*CloudflareService, error) {
	if apiToken == "" {
		return nil, ErrCloudflareTokenEmpty
	}
	client := cloudflare.NewClient(option.WithAPIToken(apiToken))
	return &CloudflareService{client: client}, nil
}

func (s *CloudflareService) buildNewBody(recordType, name, content string, ttl int, proxied bool) dns.RecordNewParamsBodyUnion {
	switch recordType {
	case "AAAA":
		return dns.AAAARecordParam{
			Name:    cloudflare.F(name),
			Type:    cloudflare.F(dns.AAAARecordTypeAAAA),
			Content: cloudflare.F(content),
			TTL:     cloudflare.F(dns.TTL(ttl)),
			Proxied: cloudflare.F(proxied),
		}
	case "CNAME":
		return dns.CNAMERecordParam{
			Name:    cloudflare.F(name),
			Type:    cloudflare.F(dns.CNAMERecordTypeCNAME),
			Content: cloudflare.F(content),
			TTL:     cloudflare.F(dns.TTL(ttl)),
			Proxied: cloudflare.F(proxied),
		}
	case "TXT":
		return dns.TXTRecordParam{
			Name:    cloudflare.F(name),
			Type:    cloudflare.F(dns.TXTRecordTypeTXT),
			Content: cloudflare.F(content),
			TTL:     cloudflare.F(dns.TTL(ttl)),
		}
	case "NS":
		return dns.NSRecordParam{
			Name:    cloudflare.F(name),
			Type:    cloudflare.F(dns.NSRecordTypeNS),
			Content: cloudflare.F(content),
			TTL:     cloudflare.F(dns.TTL(ttl)),
		}
	case "MX":
		mxPriority, mxHost := splitMXContent(content)
		return dns.MXRecordParam{
			Name:     cloudflare.F(name),
			Type:     cloudflare.F(dns.MXRecordTypeMX),
			Content:  cloudflare.F(mxHost),
			Priority: cloudflare.F(float64(mxPriority)),
			TTL:      cloudflare.F(dns.TTL(ttl)),
		}
	case "SRV":
		pri, weight, port, target := splitSRVContent(content)
		return dns.SRVRecordParam{
			Name: cloudflare.F(name),
			Type: cloudflare.F(dns.SRVRecordTypeSRV),
			Data: cloudflare.F(dns.SRVRecordDataParam{
				Priority: cloudflare.F(float64(pri)),
				Weight:   cloudflare.F(float64(weight)),
				Port:     cloudflare.F(float64(port)),
				Target:   cloudflare.F(target),
			}),
			TTL: cloudflare.F(dns.TTL(ttl)),
		}
	default: // A
		return dns.ARecordParam{
			Name:    cloudflare.F(name),
			Type:    cloudflare.F(dns.ARecordTypeA),
			Content: cloudflare.F(content),
			TTL:     cloudflare.F(dns.TTL(ttl)),
			Proxied: cloudflare.F(proxied),
		}
	}
}

func (s *CloudflareService) buildUpdateBody(recordType, name, content string, ttl int, proxied bool) dns.RecordUpdateParamsBodyUnion {
	switch recordType {
	case "AAAA":
		return dns.AAAARecordParam{
			Name:    cloudflare.F(name),
			Type:    cloudflare.F(dns.AAAARecordTypeAAAA),
			Content: cloudflare.F(content),
			TTL:     cloudflare.F(dns.TTL(ttl)),
			Proxied: cloudflare.F(proxied),
		}
	case "CNAME":
		return dns.CNAMERecordParam{
			Name:    cloudflare.F(name),
			Type:    cloudflare.F(dns.CNAMERecordTypeCNAME),
			Content: cloudflare.F(content),
			TTL:     cloudflare.F(dns.TTL(ttl)),
			Proxied: cloudflare.F(proxied),
		}
	case "TXT":
		return dns.TXTRecordParam{
			Name:    cloudflare.F(name),
			Type:    cloudflare.F(dns.TXTRecordTypeTXT),
			Content: cloudflare.F(content),
			TTL:     cloudflare.F(dns.TTL(ttl)),
		}
	case "NS":
		return dns.NSRecordParam{
			Name:    cloudflare.F(name),
			Type:    cloudflare.F(dns.NSRecordTypeNS),
			Content: cloudflare.F(content),
			TTL:     cloudflare.F(dns.TTL(ttl)),
		}
	case "MX":
		mxPriority, mxHost := splitMXContent(content)
		return dns.MXRecordParam{
			Name:     cloudflare.F(name),
			Type:     cloudflare.F(dns.MXRecordTypeMX),
			Content:  cloudflare.F(mxHost),
			Priority: cloudflare.F(float64(mxPriority)),
			TTL:      cloudflare.F(dns.TTL(ttl)),
		}
	case "SRV":
		pri, weight, port, target := splitSRVContent(content)
		return dns.SRVRecordParam{
			Name: cloudflare.F(name),
			Type: cloudflare.F(dns.SRVRecordTypeSRV),
			Data: cloudflare.F(dns.SRVRecordDataParam{
				Priority: cloudflare.F(float64(pri)),
				Weight:   cloudflare.F(float64(weight)),
				Port:     cloudflare.F(float64(port)),
				Target:   cloudflare.F(target),
			}),
			TTL: cloudflare.F(dns.TTL(ttl)),
		}
	default: // A
		return dns.ARecordParam{
			Name:    cloudflare.F(name),
			Type:    cloudflare.F(dns.ARecordTypeA),
			Content: cloudflare.F(content),
			TTL:     cloudflare.F(dns.TTL(ttl)),
			Proxied: cloudflare.F(proxied),
		}
	}
}

// splitMXContent 将 "10 mail.example.com" 拆分为优先级与邮件服务器主机名。
// 与 pkg/validator 的 MX 校验逻辑保持一致；校验已在调用前通过，此处仅做兜底解析。
func splitMXContent(content string) (int, string) {
	parts := strings.SplitN(strings.TrimSpace(content), " ", 2)
	if len(parts) != 2 {
		return 0, strings.TrimSpace(content)
	}
	priority := strings.TrimSpace(parts[0])
	host := strings.TrimSpace(parts[1])
	if pri, err := strconv.Atoi(priority); err == nil {
		return pri, host
	}
	return 0, host
}

// splitSRVContent 将 "10 5 5060 sip.example.com" 拆分为优先级、权重、端口与目标主机名。
// 与 pkg/validator 的 SRV 校验逻辑保持一致；校验已在调用前通过，此处仅做兜底解析。
func splitSRVContent(content string) (int, int, int, string) {
	parts := strings.Fields(strings.TrimSpace(content))
	if len(parts) != 4 {
		return 0, 0, 0, strings.TrimSpace(content)
	}
	priority, _ := strconv.Atoi(parts[0])
	weight, _ := strconv.Atoi(parts[1])
	port, _ := strconv.Atoi(parts[2])
	return priority, weight, port, parts[3]
}

// srvContentMatch 比较两个 SRV RDATA 字符串是否等价：
// 优先级/权重/端口相等，且目标主机忽略大小写与尾点（Cloudflare 可能规范化 FQDN）。
// 若 got 为空（上游未回填 content），返回 false 以避免误判命中。
func srvContentMatch(want, got string) bool {
	if strings.TrimSpace(got) == "" {
		return false
	}
	wp, ww, wport, wt := splitSRVContent(want)
	gp, gw, gport, gt := splitSRVContent(got)
	if wp != gp || ww != gw || wport != gport {
		return false
	}
	wtNorm := strings.TrimSuffix(strings.TrimSpace(strings.ToLower(wt)), ".")
	gtNorm := strings.TrimSuffix(strings.TrimSpace(strings.ToLower(gt)), ".")
	return wtNorm == gtNorm
}

func (s *CloudflareService) CreateRecord(ctx context.Context, zoneID, recordType, name, content string, ttl int, proxied bool) (string, error) {
	if s.client == nil {
		return "", ErrCloudflareTokenEmpty
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	// Prefer read-before-write to keep retries idempotent when DB update failed after a successful create.
	if existingID, err := s.FindRecord(ctx, zoneID, recordType, name, content); err == nil {
		return existingID, nil
	} else if err != nil && !errors.Is(err, ErrCloudflareRecordNotFound) {
		return "", fmt.Errorf("cloudflare pre-check record: %w", err)
	}

	record, err := s.client.DNS.Records.New(ctx, dns.RecordNewParams{
		ZoneID: cloudflare.F(zoneID),
		Body:   s.buildNewBody(recordType, name, content, ttl, proxied),
	})
	if err != nil {
		// Idempotent: check if same record already exists
		if existingID, findErr := s.FindRecord(ctx, zoneID, recordType, name, content); findErr == nil {
			return existingID, nil
		}
		return "", fmt.Errorf("cloudflare create record: %w", err)
	}
	return record.ID, nil
}

func (s *CloudflareService) UpdateRecord(ctx context.Context, zoneID, recordID, recordType, name, content string, ttl int, proxied bool) error {
	if s.client == nil {
		return ErrCloudflareTokenEmpty
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	_, err := s.client.DNS.Records.Update(ctx, recordID, dns.RecordUpdateParams{
		ZoneID: cloudflare.F(zoneID),
		Body:   s.buildUpdateBody(recordType, name, content, ttl, proxied),
	})
	if err != nil {
		return fmt.Errorf("cloudflare update record: %w", err)
	}
	return nil
}

func (s *CloudflareService) ListZones(ctx context.Context) ([]ZoneInfo, error) {
	if s.client == nil {
		return nil, ErrCloudflareTokenEmpty
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	var result []ZoneInfo
	pager := s.client.Zones.ListAutoPaging(ctx, zones.ZoneListParams{})
	for pager.Next() {
		zone := pager.Current()
		result = append(result, ZoneInfo{
			ID:     zone.ID,
			Name:   zone.Name,
			Status: string(zone.Status),
		})
	}
	if err := pager.Err(); err != nil {
		return nil, fmt.Errorf("cloudflare list zones: %w", err)
	}
	return result, nil
}

func (s *CloudflareService) DeleteRecord(ctx context.Context, zoneID, recordID string) error {
	if s.client == nil {
		return ErrCloudflareTokenEmpty
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	_, err := s.client.DNS.Records.Delete(ctx, recordID, dns.RecordDeleteParams{
		ZoneID: cloudflare.F(zoneID),
	})
	if err != nil {
		// Idempotent: if record no longer exists, treat as success
		existsCtx, existsCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer existsCancel()
		if !s.RecordExists(existsCtx, zoneID, recordID) {
			return nil
		}
		return fmt.Errorf("cloudflare delete record: %w", err)
	}
	return nil
}

// FindRecord searches for an existing record by type, name, and content.
func (s *CloudflareService) FindRecord(ctx context.Context, zoneID, recordType, name, content string) (string, error) {
	if s.client == nil {
		return "", ErrCloudflareTokenEmpty
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	pager := s.client.DNS.Records.ListAutoPaging(ctx, dns.RecordListParams{
		ZoneID: cloudflare.F(zoneID),
		Type:   cloudflare.F(dns.RecordListParamsType(recordType)),
		Name:   cloudflare.F(dns.RecordListParamsName{Exact: cloudflare.F(name)}),
	})
	for pager.Next() {
		rec := pager.Current()
		if recordType == "MX" {
			// Cloudflare 存储的 MX content 仅为邮件服务器主机名，而 HL6 内部以
			// "优先级 主机名" 形式保存，这里用拆出的主机名进行比对，避免幂等查重失败。
			if _, host := splitMXContent(content); rec.Content == host {
				return rec.ID, nil
			}
			continue
		}
		if recordType == "SRV" {
			// Cloudflare 返回的 SRV content 为完整 RDATA 整串 "优先级 权重 端口 目标"，
			// 这里用拆出的 4 段进行比对（目标主机忽略尾点），避免幂等查重失败。
			if srvContentMatch(content, rec.Content) {
				return rec.ID, nil
			}
			continue
		}
		if rec.Content == content {
			return rec.ID, nil
		}
	}
	if err := pager.Err(); err != nil {
		return "", fmt.Errorf("cloudflare search: %w", err)
	}
	return "", ErrCloudflareRecordNotFound
}

// RecordExists checks if a specific record still exists in Cloudflare.
func (s *CloudflareService) RecordExists(ctx context.Context, zoneID, recordID string) bool {
	if s.client == nil {
		return false
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	_, err := s.client.DNS.Records.Get(ctx, recordID, dns.RecordGetParams{
		ZoneID: cloudflare.F(zoneID),
	})
	return err == nil
}
