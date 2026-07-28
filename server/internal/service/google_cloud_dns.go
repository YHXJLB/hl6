package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	gdns "google.golang.org/api/dns/v1"
	"google.golang.org/api/option"
)

var ErrGoogleDNSRecordNotFound = errors.New("google cloud dns record not found")

type GoogleCloudDNSService struct {
	svc       *gdns.Service
	projectID string
}

func NewGoogleCloudDNSService(serviceAccountJSON string) (*GoogleCloudDNSService, error) {
	serviceAccountJSON = strings.TrimSpace(serviceAccountJSON)
	if serviceAccountJSON == "" {
		return nil, errors.New("google_cloud_dns service_account_json is required")
	}

	ctx := context.Background()
	creds, err := google.CredentialsFromJSON(ctx, []byte(serviceAccountJSON),
		gdns.NdevClouddnsReadwriteScope,
	)
	if err != nil {
		return nil, fmt.Errorf("parse google service account json: %w", err)
	}

	svc, err := gdns.NewService(ctx, option.WithTokenSource(oauth2.ReuseTokenSource(nil, creds.TokenSource)))
	if err != nil {
		return nil, fmt.Errorf("create google cloud dns service: %w", err)
	}

	projectID := creds.ProjectID
	if projectID == "" {
		var sa struct {
			ProjectID string `json:"project_id"`
		}
		if jsonErr := json.Unmarshal([]byte(serviceAccountJSON), &sa); jsonErr == nil {
			projectID = sa.ProjectID
		}
	}

	return &GoogleCloudDNSService{svc: svc, projectID: projectID}, nil
}

func (s *GoogleCloudDNSService) ListZones(ctx context.Context) ([]ZoneInfo, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	result := make([]ZoneInfo, 0)
	pageToken := ""
	for {
		req := s.svc.ManagedZones.List(s.projectID).Context(ctx)
		if pageToken != "" {
			req = req.PageToken(pageToken)
		}
		resp, err := req.Do()
		if err != nil {
			return nil, fmt.Errorf("google cloud dns list zones: %w", err)
		}
		for _, z := range resp.ManagedZones {
			name := strings.TrimSuffix(z.DnsName, ".")
			result = append(result, ZoneInfo{
				ID:     z.Name,
				Name:   name,
				Status: strings.ToUpper(z.Visibility),
			})
		}
		if resp.NextPageToken == "" {
			break
		}
		pageToken = resp.NextPageToken
	}
	return result, nil
}

func (s *GoogleCloudDNSService) CreateRecord(ctx context.Context, zoneID, recordType, name, content string, ttl int, _ bool) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	fqdn := ensureFQDN(name)
	rtype := strings.ToUpper(strings.TrimSpace(recordType))

	if existingID, err := s.FindRecord(ctx, zoneID, recordType, name, content); err == nil {
		return existingID, nil
	}

	existingRRSet, getErr := s.svc.ResourceRecordSets.Get(s.projectID, zoneID, fqdn, rtype).Context(ctx).Do()
	var rrdatas []string
	if getErr == nil && existingRRSet != nil {
		rrdatas = existingRRSet.Rrdatas
	}
	rrdatas = append(rrdatas, strings.TrimSpace(content))

	rrset := &gdns.ResourceRecordSet{
		Name:    fqdn,
		Type:    rtype,
		Ttl:     int64(ttl),
		Rrdatas: rrdatas,
	}

	change := &gdns.Change{
		Additions: []*gdns.ResourceRecordSet{rrset},
	}
	if getErr == nil && existingRRSet != nil {
		change.Deletions = []*gdns.ResourceRecordSet{existingRRSet}
	}

	if _, err := s.svc.Changes.Create(s.projectID, zoneID, change).Context(ctx).Do(); err != nil {
		if strings.Contains(err.Error(), "already exists") {
			if id, findErr := s.FindRecord(ctx, zoneID, recordType, name, content); findErr == nil {
				return id, nil
			}
		}
		return "", fmt.Errorf("google cloud dns create record: %w", err)
	}

	return fmt.Sprintf("%s:%s:%s:%s", zoneID, fqdn, rtype, strings.TrimSpace(content)), nil
}

func (s *GoogleCloudDNSService) UpdateRecord(ctx context.Context, zoneID, recordID, recordType, name, content string, ttl int, _ bool) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	fqdn := ensureFQDN(name)
	rtype := strings.ToUpper(strings.TrimSpace(recordType))

	existingRRSet, err := s.svc.ResourceRecordSets.Get(s.projectID, zoneID, fqdn, rtype).Context(ctx).Do()
	if err != nil {
		return fmt.Errorf("google cloud dns get record for update: %w", err)
	}

	// Parse old content from recordID: "zoneID:fqdn:type:oldContent"
	var oldContent string
	parts := strings.SplitN(recordID, ":", 4)
	if len(parts) == 4 {
		oldContent = parts[3]
	}

	newRrdatas := make([]string, 0, len(existingRRSet.Rrdatas))
	replaced := false
	for _, v := range existingRRSet.Rrdatas {
		trimV := strings.TrimSpace(strings.Trim(v, "\""))
		if oldContent != "" && strings.EqualFold(trimV, oldContent) && !replaced {
			newRrdatas = append(newRrdatas, strings.TrimSpace(content))
			replaced = true
		} else {
			newRrdatas = append(newRrdatas, v)
		}
	}
	if !replaced {
		newRrdatas = append(newRrdatas, strings.TrimSpace(content))
	}

	newRRSet := &gdns.ResourceRecordSet{
		Name:    fqdn,
		Type:    rtype,
		Ttl:     int64(ttl),
		Rrdatas: newRrdatas,
	}
	change := &gdns.Change{
		Deletions: []*gdns.ResourceRecordSet{existingRRSet},
		Additions: []*gdns.ResourceRecordSet{newRRSet},
	}
	if _, err := s.svc.Changes.Create(s.projectID, zoneID, change).Context(ctx).Do(); err != nil {
		return fmt.Errorf("google cloud dns update record: %w", err)
	}
	return nil
}

func (s *GoogleCloudDNSService) DeleteRecord(ctx context.Context, zoneID, recordID string) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// recordID format: "zoneID:fqdn:type:content" or "zoneID:fqdn:type"
	parts := strings.SplitN(recordID, ":", 4)
	if len(parts) < 3 {
		return fmt.Errorf("invalid google cloud dns record id %q", recordID)
	}
	fqdn := parts[1]
	rtype := strings.ToUpper(parts[2])
	var targetContent string
	if len(parts) == 4 {
		targetContent = parts[3]
	}

	existingRRSet, err := s.svc.ResourceRecordSets.Get(s.projectID, zoneID, fqdn, rtype).Context(ctx).Do()
	if err != nil {
		if strings.Contains(err.Error(), "notFound") || strings.Contains(err.Error(), "404") {
			return nil
		}
		return fmt.Errorf("google cloud dns get record for delete: %w", err)
	}

	change := &gdns.Change{
		Deletions: []*gdns.ResourceRecordSet{existingRRSet},
	}

	if targetContent != "" && len(existingRRSet.Rrdatas) > 1 {
		newRrdatas := make([]string, 0, len(existingRRSet.Rrdatas))
		for _, v := range existingRRSet.Rrdatas {
			trimV := strings.TrimSpace(strings.Trim(v, "\""))
			if !strings.EqualFold(trimV, targetContent) {
				newRrdatas = append(newRrdatas, v)
			}
		}
		if len(newRrdatas) > 0 {
			newRRSet := &gdns.ResourceRecordSet{
				Name:    fqdn,
				Type:    rtype,
				Ttl:     existingRRSet.Ttl,
				Rrdatas: newRrdatas,
			}
			change.Additions = []*gdns.ResourceRecordSet{newRRSet}
		}
	}

	if _, err := s.svc.Changes.Create(s.projectID, zoneID, change).Context(ctx).Do(); err != nil {
		if strings.Contains(err.Error(), "notFound") || strings.Contains(err.Error(), "404") {
			return nil
		}
		return fmt.Errorf("google cloud dns delete record: %w", err)
	}
	return nil
}

func (s *GoogleCloudDNSService) FindRecord(ctx context.Context, zoneID, recordType, name, content string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	fqdn := ensureFQDN(name)
	rtype := strings.ToUpper(strings.TrimSpace(recordType))
	content = strings.TrimSpace(content)

	rrset, err := s.svc.ResourceRecordSets.Get(s.projectID, zoneID, fqdn, rtype).Context(ctx).Do()
	if err != nil {
		if strings.Contains(err.Error(), "notFound") || strings.Contains(err.Error(), "404") {
			return "", ErrGoogleDNSRecordNotFound
		}
		return "", fmt.Errorf("google cloud dns find record: %w", err)
	}

	for _, v := range rrset.Rrdatas {
		trimV := strings.TrimSpace(strings.Trim(v, "\""))
		if strings.EqualFold(recordType, "SRV") {
			if srvContentMatch(content, trimV) {
				return fmt.Sprintf("%s:%s:%s:%s", zoneID, fqdn, rtype, content), nil
			}
			continue
		}
		if strings.EqualFold(trimV, content) {
			return fmt.Sprintf("%s:%s:%s:%s", zoneID, fqdn, rtype, content), nil
		}
	}
	return "", ErrGoogleDNSRecordNotFound
}
