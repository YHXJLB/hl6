package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/baidubce/bce-sdk-go/services/dns"
)

var ErrBaiduDNSRecordNotFound = errors.New("baidu cloud dns record not found")

type BaiduCloudDNSService struct {
	client *dns.Client
}

func NewBaiduCloudDNSService(accessKey, secretKey string) (*BaiduCloudDNSService, error) {
	accessKey = strings.TrimSpace(accessKey)
	secretKey = strings.TrimSpace(secretKey)
	if accessKey == "" || secretKey == "" {
		return nil, errors.New("baidu_cloud_dns access_key and secret_key are required")
	}

	client, err := dns.NewClient(accessKey, secretKey, "")
	if err != nil {
		return nil, fmt.Errorf("create baidu cloud dns client: %w", err)
	}
	return &BaiduCloudDNSService{client: client}, nil
}

func (s *BaiduCloudDNSService) ListZones(ctx context.Context) ([]ZoneInfo, error) {
	_, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	result := make([]ZoneInfo, 0)
	marker := ""
	maxKeys := 1000
	for {
		args := &dns.ListZoneRequest{
			Marker:  marker,
			MaxKeys: maxKeys,
		}
		resp, err := s.client.ListZone(args)
		if err != nil {
			return nil, fmt.Errorf("baidu cloud dns list zones: %w", err)
		}
		if resp == nil {
			break
		}
		for _, z := range resp.Zones {
			result = append(result, ZoneInfo{
				ID:     z.Name,
				Name:   z.Name,
				Status: strings.ToUpper(z.Status),
			})
		}
		if !resp.IsTruncated {
			break
		}
		marker = resp.NextMarker
	}
	return result, nil
}

func (s *BaiduCloudDNSService) CreateRecord(ctx context.Context, zoneID, recordType, name, content string, ttl int, _ bool) (string, error) {
	_, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	zoneName := zoneID
	relName, err := relativeRecordName(name, zoneName)
	if err != nil {
		return "", err
	}

	if existingID, findErr := s.FindRecord(ctx, zoneID, recordType, name, content); findErr == nil {
		return existingID, nil
	}

	// 百度云 DNS 的 MX 记录 Value 只接受邮件服务器主机名，优先级通过独立的 Priority 字段下发；
	// 把 HL6 内部 "优先级 主机名" 形式的 content 拆开后再提交。
	recordValue := strings.TrimSpace(content)
	var recordPriority *int32
	if strings.EqualFold(recordType, "MX") {
		if pri, host := splitMXContent(content); host != "" {
			recordValue = host
			p := int32(pri)
			recordPriority = &p
		}
	}
	ttlVal := int32(ttl)
	args := &dns.CreateRecordRequest{
		Rr:       relName,
		Type:     strings.ToUpper(strings.TrimSpace(recordType)),
		Value:    recordValue,
		Priority: recordPriority,
		Ttl:      &ttlVal,
	}
	// CreateRecord does not return an ID; find the record after creation
	if err := s.client.CreateRecord(zoneName, args, ""); err != nil {
		if id, findErr := s.FindRecord(ctx, zoneID, recordType, name, content); findErr == nil {
			return id, nil
		}
		return "", fmt.Errorf("baidu cloud dns create record: %w", err)
	}

	// Fetch the record ID after creation
	id, findErr := s.FindRecord(ctx, zoneID, recordType, name, content)
	if findErr != nil {
		// Return synthetic ID if find fails
		return fmt.Sprintf("%s:%s:%s:%s", zoneName, relName, strings.ToUpper(recordType), strings.TrimSpace(content)), nil
	}
	return id, nil
}

func (s *BaiduCloudDNSService) UpdateRecord(ctx context.Context, zoneID, recordID, recordType, name, content string, ttl int, _ bool) error {
	_, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	zoneName := zoneID
	relName, err := relativeRecordName(name, zoneName)
	if err != nil {
		return err
	}

	recordValue := strings.TrimSpace(content)
	var recordPriority *int32
	if strings.EqualFold(recordType, "MX") {
		if pri, host := splitMXContent(content); host != "" {
			recordValue = host
			p := int32(pri)
			recordPriority = &p
		}
	}
	ttlVal := int32(ttl)
	args := &dns.UpdateRecordRequest{
		Rr:       relName,
		Type:     strings.ToUpper(strings.TrimSpace(recordType)),
		Value:    recordValue,
		Priority: recordPriority,
		Ttl:      &ttlVal,
	}
	if err := s.client.UpdateRecord(zoneName, recordID, args, ""); err != nil {
		if isBaiduDNSNotFound(err) {
			return ErrBaiduDNSRecordNotFound
		}
		return fmt.Errorf("baidu cloud dns update record: %w", err)
	}
	return nil
}

func (s *BaiduCloudDNSService) DeleteRecord(ctx context.Context, zoneID, recordID string) error {
	_, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	zoneName := zoneID
	// recordID may be a synthetic ID for records without a real ID from the API
	if strings.Contains(recordID, ":") {
		// Synthetic ID: "zoneName:rr:type:content" - find the real record ID first
		if parts := strings.SplitN(recordID, ":", 4); len(parts) == 4 {
			relName := parts[1]
			rtype := parts[2]
			content := parts[3]
			fqdn := relName + "." + zoneName
			realID, findErr := s.FindRecord(ctx, zoneID, rtype, fqdn, content)
			if findErr == nil {
				recordID = realID
			}
		}
	}

	if err := s.client.DeleteRecord(zoneName, recordID, ""); err != nil {
		if isBaiduDNSNotFound(err) {
			return nil
		}
		return fmt.Errorf("baidu cloud dns delete record: %w", err)
	}
	return nil
}

func (s *BaiduCloudDNSService) FindRecord(ctx context.Context, zoneID, recordType, name, content string) (string, error) {
	_, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	zoneName := zoneID
	relName, err := relativeRecordName(name, zoneName)
	if err != nil {
		return "", err
	}

	rtype := strings.ToUpper(strings.TrimSpace(recordType))
	content = strings.TrimSpace(content)

	marker := ""
	maxKeys := 1000
	for {
		args := &dns.ListRecordRequest{
			Rr:      relName,
			Marker:  marker,
			MaxKeys: maxKeys,
		}
		resp, err := s.client.ListRecord(zoneName, args)
		if err != nil {
			return "", fmt.Errorf("baidu cloud dns find record: %w", err)
		}
		if resp == nil {
			break
		}
		for _, r := range resp.Records {
			if !strings.EqualFold(r.Rr, relName) {
				continue
			}
			if !strings.EqualFold(strings.ToUpper(r.Type), rtype) {
				continue
			}
			itemValue := strings.TrimSpace(r.Value)
			if strings.EqualFold(rtype, "MX") {
				// 百度云只存储主机名，用 content 拆出的主机名进行比对
				_, host := splitMXContent(content)
				if host == "" {
					host = content
				}
				if !strings.EqualFold(itemValue, host) {
					continue
				}
			} else if !strings.EqualFold(itemValue, content) {
				continue
			}
			return r.Id, nil
		}
		if !resp.IsTruncated {
			break
		}
		marker = resp.NextMarker
	}
	return "", ErrBaiduDNSRecordNotFound
}

func isBaiduDNSNotFound(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "not found") || strings.Contains(msg, "norecord") || strings.Contains(msg, "404")
}
