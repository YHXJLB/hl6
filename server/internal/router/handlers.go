package router

import (
	"hl6-server/internal/config"
	"hl6-server/internal/handler"
	"hl6-server/internal/repository"
	"hl6-server/internal/service"
)

// Handlers 集中管理所有 handler 的初始化，作为依赖注入的单一入口。
type Handlers struct {
	Auth              *handler.AuthHandler
	OIDC              *handler.OIDCHandler
	Domain            *handler.DomainHandler
	Subdomain         *handler.SubdomainHandler
	DNS               *handler.DNSHandler
	Credit            *handler.CreditHandler
	Admin             *handler.AdminHandler
	Branding          *handler.BrandingHandler
	Referral          *handler.ReferralHandler
	DNSAccount        *handler.DNSProviderAccountHandler
	Migration         *handler.DomainMigrationHandler
	Notification      *handler.NotificationHandler
	NotificationAdmin *handler.NotificationAdminHandler
	Audit             *handler.AuditHandler
	SSEBroker         *handler.SSEBroker
	RedeemCode        *handler.RedeemCodeHandler
}

func NewHandlers(cfg *config.Config, repo *repository.Repository, dnsOps *service.DNSOperationService, migSvc *service.DomainMigrationService, sseBroker *handler.SSEBroker, audit auditStack) *Handlers {
	return &Handlers{
		Auth:              handler.NewAuthHandler(repo),
		OIDC:              handler.NewOIDCHandler(repo, cfg),
		Domain:            handler.NewDomainHandler(repo, dnsOps),
		Subdomain:         handler.NewSubdomainHandler(repo, sseBroker, dnsOps, audit.enqueue, audit.notif, audit.subSvc, audit.auditLog),
		DNS:               handler.NewDNSHandler(repo, sseBroker, dnsOps, audit.enqueue),
		Credit:            handler.NewCreditHandler(repo),
		Admin:             handler.NewAdminHandler(repo, cfg, dnsOps),
		Branding:          handler.NewBrandingHandler(repo, cfg),
		Referral:          handler.NewReferralHandler(repo),
		DNSAccount:        handler.NewDNSProviderAccountHandler(repo, cfg, dnsOps),
		Migration:         handler.NewDomainMigrationHandler(migSvc),
		Notification:      handler.NewNotificationHandler(repo, sseBroker),
		NotificationAdmin: handler.NewNotificationAdminHandler(repo, sseBroker, cfg),
		Audit:             handler.NewAuditHandler(repo, audit.auditSvc, audit.subSvc, dnsOps, audit.enqueue, audit.notif, audit.auditLog),
		SSEBroker:         sseBroker,
		RedeemCode:        handler.NewRedeemCodeHandler(repo, audit.auditLog),
	}
}
