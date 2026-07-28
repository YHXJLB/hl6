package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	alidns "github.com/alibabacloud-go/alidns-20150109/v5/client"
	openapiutil "github.com/alibabacloud-go/darabonba-openapi/v2/utils"
)

var ErrAliDNSRecordNotFound = errors.New("aliyun dns record not found")

type AliDNSService struct {
	client *alidns.Client
}

func NewAliDNSService(accessKeyID, accessKeySecret, regionID, endpoint string) (*AliDNSService, error) {
	accessKeyID = strings.TrimSpace(accessKeyID)
	accessKeySecret = strings.TrimSpace(accessKeySecret)
	if accessKeyID == "" || accessKeySecret == "" {
		return nil, errors.New("aliyun dns access_key_id and access_key_secret are required")
	}

	regionID = strings.TrimSpace(regionID)
	if regionID == "" {
		regionID = "cn-hangzhou"
	}
	endpoint = normalizeAliDNSEndpoint(endpoint, regionID)

	config := &openapiutil.Config{
		AccessKeyId:     strPtr(accessKeyID),
		AccessKeySecret: strPtr(accessKeySecret),
		RegionId:        strPtr(regionID),
		Endpoint:        strPtr(endpoint),
	}
	client, err := alidns.NewClient(config)
	if err != nil {
		return nil, fmt.Errorf("create aliyun dns client: %w", err)
	}
	return &AliDNSService{client: client}, nil
}

func (s *AliDNSService) ListZones(ctx context.Context) ([]ZoneInfo, error) {
	if s.client == nil {
		return nil, errors.New("aliyun dns client is nil")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	_ = ctx

	pageNumber := int64(1)
	pageSize := int64(100)
	result := make([]ZoneInfo, 0)
	for {
		req := &alidns.DescribeDomainsRequest{
			PageNumber: &pageNumber,
			PageSize:   &pageSize,
		}

		resp, err := s.client.DescribeDomains(req)
		if err != nil {
			return nil, fmt.Errorf("aliyun dns list zones: %w", err)
		}
		if resp == nil || resp.Body == nil || resp.Body.Domains == nil || len(resp.Body.Domains.Domain) == 0 {
			break
		}

		for _, domain := range resp.Body.Domains.Domain {
			if domain == nil || domain.DomainId == nil || domain.DomainName == nil {
				continue
			}
			result = append(result, ZoneInfo{
				ID:     strings.TrimSpace(*domain.DomainId),
				Name:   strings.TrimSpace(*domain.DomainName),
				Status: "ENABLE",
			})
		}

		totalCount := int64(0)
		if resp.Body.TotalCount != nil {
			totalCount = *resp.Body.TotalCount
		}
		if pageNumber*pageSize >= totalCount {
			break
		}
		pageNumber++
	}
	return result, nil
}

func (s *AliDNSService) CreateRecord(ctx context.Context, zoneID, recordType, name, content string, ttl int, _ bool) (string, error) {
	if s.client == nil {
		return "", errors.New("aliyun dns client is nil")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	zoneName, err := s.zoneNameByID(ctx, zoneID)
	if err != nil {
		return "", err
	}
	rr, err := relativeRecordName(name, zoneName)
	if err != nil {
		return "", err
	}
	recordType = strings.ToUpper(strings.TrimSpace(recordType))
	content = strings.TrimSpace(content)

	if existingID, findErr := s.FindRecord(ctx, zoneID, recordType, name, content); findErr == nil {
		return existingID, nil
	} else if !errors.Is(findErr, ErrAliDNSRecordNotFound) {
		return "", fmt.Errorf("aliyun dns pre-check record: %w", findErr)
	}

	// 阿里云 MX 记录的 Value 仅接受邮件服务器主机名，优先级需通过独立的 Priority 字段下发；
	// 这里把 HL6 内部 "优先级 主机名" 形式的 content 拆开后再提交。
	recordValue := content
	var recordPriority *int64
	if recordType == "MX" {
		if pri, host := splitMXContent(content); host != "" {
			recordValue = host
			p := int64(pri)
			recordPriority = &p
		}
	} else if recordType == "SRV" {
		// 阿里云 SRV: Value 只接受 "权重 端口 目标"，优先级通过独立的 Priority 字段下发
		if fields := strings.Fields(strings.TrimSpace(content)); len(fields) == 4 {
			pri, weight, port, target := splitSRVContent(content)
			recordValue = fmt.Sprintf("%d %d %s", weight, port, target)
			p := int64(pri)
			recordPriority = &p
		}
	}
	req := &alidns.AddDomainRecordRequest{
		DomainName: &zoneName,
		RR:         &rr,
		Type:       &recordType,
		Value:      &recordValue,
		Priority:   recordPriority,
		Line:       strPtr("default"),
	}
	_ = ttl
	resp, err := s.client.AddDomainRecord(req)
	if err != nil {
		if existingID, findErr := s.FindRecord(ctx, zoneID, recordType, name, content); findErr == nil {
			return existingID, nil
		}
		return "", fmt.Errorf("aliyun dns create record: %w", err)
	}
	if resp == nil || resp.Body == nil || resp.Body.RecordId == nil {
		return "", errors.New("aliyun dns create record returned empty record id")
	}
	return strings.TrimSpace(*resp.Body.RecordId), nil
}

func (s *AliDNSService) UpdateRecord(ctx context.Context, zoneID, recordID, recordType, name, content string, ttl int, _ bool) error {
	if s.client == nil {
		return errors.New("aliyun dns client is nil")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	zoneName, err := s.zoneNameByID(ctx, zoneID)
	if err != nil {
		return err
	}
	rr, err := relativeRecordName(name, zoneName)
	if err != nil {
		return err
	}

	recordType = strings.ToUpper(strings.TrimSpace(recordType))
	content = strings.TrimSpace(content)
	recordID = strings.TrimSpace(recordID)

	recordValue := content
	var recordPriority *int64
	if recordType == "MX" {
		if pri, host := splitMXContent(content); host != "" {
			recordValue = host
			p := int64(pri)
			recordPriority = &p
		}
	} else if recordType == "SRV" {
		// 阿里云 SRV: Value 只接受 "权重 端口 目标"，优先级通过独立的 Priority 字段下发
		if fields := strings.Fields(strings.TrimSpace(content)); len(fields) == 4 {
			pri, weight, port, target := splitSRVContent(content)
			recordValue = fmt.Sprintf("%d %d %s", weight, port, target)
			p := int64(pri)
			recordPriority = &p
		}
	}
	req := &alidns.UpdateDomainRecordRequest{
		RecordId: &recordID,
		RR:       &rr,
		Type:     &recordType,
		Value:    &recordValue,
		Priority: recordPriority,
		Line:     strPtr("default"),
	}
	_ = ttl
	if _, err := s.client.UpdateDomainRecord(req); err != nil {
		if isAliDNSNotFoundError(err) {
			return ErrAliDNSRecordNotFound
		}
		return fmt.Errorf("aliyun dns update record: %w", err)
	}
	return nil
}

func (s *AliDNSService) DeleteRecord(ctx context.Context, _ string, recordID string) error {
	if s.client == nil {
		return errors.New("aliyun dns client is nil")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	recordID = strings.TrimSpace(recordID)
	req := &alidns.DeleteDomainRecordRequest{RecordId: &recordID}
	if _, err := s.client.DeleteDomainRecord(req); err != nil {
		if isAliDNSNotFoundError(err) {
			return nil
		}
		return fmt.Errorf("aliyun dns delete record: %w", err)
	}
	return nil
}

func (s *AliDNSService) FindRecord(ctx context.Context, zoneID, recordType, name, content string) (string, error) {
	if s.client == nil {
		return "", errors.New("aliyun dns client is nil")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	zoneName, err := s.zoneNameByID(ctx, zoneID)
	if err != nil {
		return "", err
	}
	rr, err := relativeRecordName(name, zoneName)
	if err != nil {
		return "", err
	}

	recordType = strings.ToUpper(strings.TrimSpace(recordType))
	content = strings.TrimSpace(content)
	pageNumber := int64(1)
	pageSize := int64(500)
	for {
		req := &alidns.DescribeDomainRecordsRequest{
			DomainName: &zoneName,
			RRKeyWord:  &rr,
			Type:       &recordType,
			SearchMode: strPtr("ADVANCED"),
			PageNumber: &pageNumber,
			PageSize:   &pageSize,
		}
		resp, err := s.client.DescribeDomainRecords(req)
		if err != nil {
			if isAliDNSNotFoundError(err) {
				return "", ErrAliDNSRecordNotFound
			}
			return "", fmt.Errorf("aliyun dns find record: %w", err)
		}
		if resp == nil || resp.Body == nil || resp.Body.DomainRecords == nil || len(resp.Body.DomainRecords.Record) == 0 {
			break
		}

		for _, item := range resp.Body.DomainRecords.Record {
			if item == nil || item.RecordId == nil {
				continue
			}
			if !strings.EqualFold(strings.TrimSpace(ptrString(item.RR)), rr) {
				continue
			}
			if !strings.EqualFold(strings.TrimSpace(ptrString(item.Type)), recordType) {
				continue
			}
		itemValue := strings.TrimSpace(ptrString(item.Value))
		if recordType == "MX" {
			// 阿里云只存储主机名，用 content 拆出的主机名进行比对
			_, host := splitMXContent(content)
			if host == "" {
				host = content
			}
			if !strings.EqualFold(itemValue, host) {
				continue
			}
		} else if recordType == "SRV" {
			// 阿里云 SRV: Value 为 "权重 端口 目标"，与 content 的后三段比对
			fields := strings.Fields(strings.TrimSpace(content))
			if len(fields) != 4 || !strings.EqualFold(itemValue, strings.Join(fields[1:], " ")) {
				continue
			}
		} else if !strings.EqualFold(itemValue, content) {
			continue
		}
			return strings.TrimSpace(*item.RecordId), nil
		}

		totalCount := int64(0)
		if resp.Body.TotalCount != nil {
			totalCount = *resp.Body.TotalCount
		}
		if pageNumber*pageSize >= totalCount {
			break
		}
		pageNumber++
	}
	return "", ErrAliDNSRecordNotFound
}

func (s *AliDNSService) zoneNameByID(ctx context.Context, zoneID string) (string, error) {
	zoneID = strings.TrimSpace(zoneID)
	if zoneID == "" {
		return "", errors.New("aliyun dns zone id is required")
	}
	_ = ctx
	pageNumber := int64(1)
	pageSize := int64(100)
	for {
		req := &alidns.DescribeDomainsRequest{
			PageNumber: &pageNumber,
			PageSize:   &pageSize,
		}
		resp, err := s.client.DescribeDomains(req)
		if err != nil {
			return "", fmt.Errorf("aliyun dns describe domains: %w", err)
		}
		if resp == nil || resp.Body == nil || resp.Body.Domains == nil || len(resp.Body.Domains.Domain) == 0 {
			break
		}
		for _, domain := range resp.Body.Domains.Domain {
			if domain == nil || domain.DomainId == nil || domain.DomainName == nil {
				continue
			}
			if strings.TrimSpace(*domain.DomainId) == zoneID {
				return strings.TrimSpace(*domain.DomainName), nil
			}
		}
		totalCount := int64(0)
		if resp.Body.TotalCount != nil {
			totalCount = *resp.Body.TotalCount
		}
		if pageNumber*pageSize >= totalCount {
			break
		}
		pageNumber++
	}
	return "", fmt.Errorf("aliyun dns zone %q not found", zoneID)
}

func normalizeAliDNSEndpoint(endpoint, regionID string) string {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return fmt.Sprintf("alidns.%s.aliyuncs.com", regionID)
	}
	endpoint = strings.TrimPrefix(endpoint, "https://")
	endpoint = strings.TrimPrefix(endpoint, "http://")
	endpoint = strings.TrimSuffix(endpoint, "/")
	return endpoint
}

func isAliDNSNotFoundError(err error) bool {
	if err == nil {
		return false
	}
	raw := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(raw, "notfound") ||
		strings.Contains(raw, "recordid") && strings.Contains(raw, "invalid") ||
		strings.Contains(raw, "record does not exist")
}
