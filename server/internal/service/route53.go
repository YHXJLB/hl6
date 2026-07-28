package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/route53"
	"github.com/aws/aws-sdk-go-v2/service/route53/types"
)

var ErrRoute53RecordNotFound = errors.New("route53 record not found")

type Route53Service struct {
	client *route53.Client
}

func NewRoute53Service(accessKeyID, accessKeySecret, region string) (*Route53Service, error) {
	accessKeyID = strings.TrimSpace(accessKeyID)
	accessKeySecret = strings.TrimSpace(accessKeySecret)
	if accessKeyID == "" || accessKeySecret == "" {
		return nil, errors.New("aws_route53 access_key_id and access_key_secret are required")
	}
	if region == "" {
		region = "us-east-1"
	}

	cfg, err := awsconfig.LoadDefaultConfig(context.Background(),
		awsconfig.WithRegion(region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKeyID, accessKeySecret, "")),
	)
	if err != nil {
		return nil, fmt.Errorf("create route53 config: %w", err)
	}
	client := route53.NewFromConfig(cfg)
	return &Route53Service{client: client}, nil
}

func (s *Route53Service) ListZones(ctx context.Context) ([]ZoneInfo, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	result := make([]ZoneInfo, 0)
	var marker *string
	for {
		input := &route53.ListHostedZonesInput{Marker: marker}
		resp, err := s.client.ListHostedZones(ctx, input)
		if err != nil {
			return nil, fmt.Errorf("route53 list zones: %w", err)
		}
		for _, z := range resp.HostedZones {
			id := strings.TrimPrefix(aws.ToString(z.Id), "/hostedzone/")
			name := strings.TrimSuffix(aws.ToString(z.Name), ".")
			result = append(result, ZoneInfo{
				ID:     id,
				Name:   name,
				Status: "ACTIVE",
			})
		}
		if !resp.IsTruncated {
			break
		}
		marker = resp.NextMarker
	}
	return result, nil
}

func (s *Route53Service) CreateRecord(ctx context.Context, zoneID, recordType, name, content string, ttl int, _ bool) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	fqdn := ensureFQDN(name)
	rtype := types.RRType(strings.ToUpper(strings.TrimSpace(recordType)))

	// Check for existing record first
	if existingID, err := s.FindRecord(ctx, zoneID, recordType, name, content); err == nil {
		return existingID, nil
	}

	change := &route53.ChangeResourceRecordSetsInput{
		HostedZoneId: aws.String(zoneID),
		ChangeBatch: &types.ChangeBatch{
			Changes: []types.Change{
				{
					Action: types.ChangeActionCreate,
					ResourceRecordSet: &types.ResourceRecordSet{
						Name: aws.String(fqdn),
						Type: rtype,
						TTL:  aws.Int64(int64(ttl)),
						ResourceRecords: []types.ResourceRecord{
							{Value: aws.String(strings.TrimSpace(content))},
						},
					},
				},
			},
		},
	}
	resp, err := s.client.ChangeResourceRecordSets(ctx, change)
	if err != nil {
		// Try upsert if already exists
		if strings.Contains(err.Error(), "already exists") {
			change.ChangeBatch.Changes[0].Action = types.ChangeActionUpsert
			resp, err = s.client.ChangeResourceRecordSets(ctx, change)
			if err != nil {
				return "", fmt.Errorf("route53 create record: %w", err)
			}
		} else {
			return "", fmt.Errorf("route53 create record: %w", err)
		}
	}
	changeID := ""
	if resp != nil && resp.ChangeInfo != nil {
		changeID = strings.TrimPrefix(aws.ToString(resp.ChangeInfo.Id), "/change/")
	}
	// Route53 identifies records by name+type+value; synthesise a stable ID
	syntheticID := fmt.Sprintf("%s:%s:%s", fqdn, strings.ToUpper(recordType), changeID)
	return syntheticID, nil
}

func (s *Route53Service) UpdateRecord(ctx context.Context, zoneID, recordID, recordType, name, content string, ttl int, _ bool) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	fqdn := ensureFQDN(name)
	rtype := types.RRType(strings.ToUpper(strings.TrimSpace(recordType)))

	change := &route53.ChangeResourceRecordSetsInput{
		HostedZoneId: aws.String(zoneID),
		ChangeBatch: &types.ChangeBatch{
			Changes: []types.Change{
				{
					Action: types.ChangeActionUpsert,
					ResourceRecordSet: &types.ResourceRecordSet{
						Name: aws.String(fqdn),
						Type: rtype,
						TTL:  aws.Int64(int64(ttl)),
						ResourceRecords: []types.ResourceRecord{
							{Value: aws.String(strings.TrimSpace(content))},
						},
					},
				},
			},
		},
	}
	if _, err := s.client.ChangeResourceRecordSets(ctx, change); err != nil {
		return fmt.Errorf("route53 update record: %w", err)
	}
	return nil
}

func (s *Route53Service) DeleteRecord(ctx context.Context, zoneID, recordID string) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// recordID format: "fqdn:TYPE:changeID" or "fqdn:TYPE"
	parts := strings.SplitN(recordID, ":", 3)
	if len(parts) < 2 {
		return fmt.Errorf("invalid route53 record id %q", recordID)
	}
	fqdn := ensureFQDN(parts[0])
	rtype := types.RRType(strings.ToUpper(parts[1]))

	// List records to get current value
	listInput := &route53.ListResourceRecordSetsInput{
		HostedZoneId:    aws.String(zoneID),
		StartRecordName: aws.String(fqdn),
		StartRecordType: rtype,
		MaxItems:        aws.Int32(1),
	}
	listResp, err := s.client.ListResourceRecordSets(ctx, listInput)
	if err != nil {
		return fmt.Errorf("route53 find record for delete: %w", err)
	}
	if len(listResp.ResourceRecordSets) == 0 {
		return nil // already deleted
	}
	rrset := listResp.ResourceRecordSets[0]
	if !strings.EqualFold(normalizeFQDN(aws.ToString(rrset.Name)), normalizeFQDN(fqdn)) {
		return nil
	}

	change := &route53.ChangeResourceRecordSetsInput{
		HostedZoneId: aws.String(zoneID),
		ChangeBatch: &types.ChangeBatch{
			Changes: []types.Change{
				{
					Action:            types.ChangeActionDelete,
					ResourceRecordSet: &rrset,
				},
			},
		},
	}
	if _, err := s.client.ChangeResourceRecordSets(ctx, change); err != nil {
		if strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "does not exist") {
			return nil
		}
		return fmt.Errorf("route53 delete record: %w", err)
	}
	return nil
}

func (s *Route53Service) FindRecord(ctx context.Context, zoneID, recordType, name, content string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	fqdn := ensureFQDN(name)
	rtype := types.RRType(strings.ToUpper(strings.TrimSpace(recordType)))
	content = strings.TrimSpace(content)

	listInput := &route53.ListResourceRecordSetsInput{
		HostedZoneId:    aws.String(zoneID),
		StartRecordName: aws.String(fqdn),
		StartRecordType: rtype,
		MaxItems:        aws.Int32(100),
	}
	resp, err := s.client.ListResourceRecordSets(ctx, listInput)
	if err != nil {
		return "", fmt.Errorf("route53 find record: %w", err)
	}

	for _, rrset := range resp.ResourceRecordSets {
		if !strings.EqualFold(normalizeFQDN(aws.ToString(rrset.Name)), normalizeFQDN(fqdn)) {
			continue
		}
		if rrset.Type != rtype {
			continue
		}
		for _, rr := range rrset.ResourceRecords {
			val := strings.Trim(aws.ToString(rr.Value), "\"")
			if strings.EqualFold(recordType, "SRV") {
				if srvContentMatch(content, val) {
					return fmt.Sprintf("%s:%s", fqdn, strings.ToUpper(recordType)), nil
				}
				continue
			}
			if strings.EqualFold(strings.TrimSpace(val), content) {
				return fmt.Sprintf("%s:%s", fqdn, strings.ToUpper(recordType)), nil
			}
		}
	}
	return "", ErrRoute53RecordNotFound
}
