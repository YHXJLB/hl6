package router

import (
	"github.com/gin-gonic/gin"
	"hl6-server/internal/middleware"
)

func registerAdminRoutes(api *gin.RouterGroup, auth *middleware.AuthMiddleware, h *Handlers) {
	admin := api.Group("/admin", auth.Required(), middleware.AdminRequired())

	// Domains
	admin.POST("/domains", h.Domain.AdminCreate)
	admin.GET("/domains/reserved-prefixes", h.Domain.AdminGetReservedPrefixes)
	admin.PUT("/domains/reserved-prefixes", h.Domain.AdminUpdateReservedPrefixes)
	admin.PUT("/domains/:id", h.Domain.AdminUpdate)
	admin.DELETE("/domains/:id", h.Domain.AdminDelete)
	admin.GET("/domains-full", h.Domain.AdminListDomainsFull)

	// Domain migrations
	admin.POST("/domains/:id/migrations", h.Migration.Create)
	admin.GET("/domains/:id/migrations", h.Migration.List)
	admin.GET("/domains/:id/migrations/:taskId", h.Migration.Get)
	admin.POST("/domains/:id/migrations/:taskId/retry-failures", h.Migration.RetryFailures)
	admin.POST("/domains/:id/migrations/:taskId/cleanup-source", h.Migration.CleanupSource)

	// DNS provider accounts
	admin.GET("/dns-accounts", h.DNSAccount.List)
	admin.POST("/dns-accounts", h.DNSAccount.Create)
	admin.PUT("/dns-accounts/:id", h.DNSAccount.Update)
	admin.DELETE("/dns-accounts/:id", h.DNSAccount.Delete)
	admin.GET("/dns-accounts/:id/zones", h.DNSAccount.ListZones)

	// Credits
	admin.POST("/credits/grant", h.Credit.AdminGrant)

	// Redeem codes
	admin.GET("/redeem-codes", h.RedeemCode.AdminList)
	admin.POST("/redeem-codes", h.RedeemCode.AdminCreate)
	admin.POST("/redeem-codes/batch", h.RedeemCode.AdminBatchCreate)
	admin.POST("/redeem-codes/:id/delist", h.RedeemCode.AdminDelist)
	admin.POST("/redeem-codes/:id/relist", h.RedeemCode.AdminRelist)
	admin.GET("/redeem-codes/:id/redemptions", h.RedeemCode.AdminListRedemptions)

	// DNS records
	admin.GET("/dns-records", h.DNS.AdminListRecords)
	admin.DELETE("/dns-records/:id", h.DNS.AdminDeleteRecord)
	admin.GET("/dns-bulk-jobs/:id", h.DNS.AdminGetBulkJob)
	admin.GET("/dns-bulk-jobs/:id/items", h.DNS.AdminListBulkJobItems)

	// Subdomains
	admin.GET("/claimed-subdomains", h.Subdomain.AdminListClaimed)
	admin.DELETE("/claimed-subdomains/:id", h.Subdomain.AdminRelease)

	// Users & groups
	admin.GET("/users", h.Admin.ListUsers)
	admin.PUT("/users/:id/group", h.Admin.UpdateUserGroup)
	admin.PUT("/users/:id/ban", h.Admin.BanUser)
	admin.PUT("/users/:id/unban", h.Admin.UnbanUser)
	admin.GET("/groups", h.Admin.ListGroups)
	admin.POST("/groups", h.Admin.CreateGroup)
	admin.PUT("/groups/:id", h.Admin.UpdateGroup)
	admin.DELETE("/groups/:id", h.Admin.DeleteGroup)

	// System config
	admin.GET("/config", h.Admin.GetConfig)
	admin.PUT("/config", h.Admin.UpdateConfig)
	admin.POST("/config/url-confirm", h.Admin.ConfirmURLConfig)

	// Stats & monitoring
	admin.GET("/stats", h.Admin.Stats)
	admin.GET("/dns-providers/status", h.Admin.GetDNSProviderStatus)
	admin.GET("/audit-logs", h.Admin.AuditLogs)

	// Notifications
	admin.GET("/notifications", h.NotificationAdmin.List)
	admin.POST("/notifications", h.NotificationAdmin.Create)
	admin.PUT("/notifications/:id", h.NotificationAdmin.Update)
	admin.DELETE("/notifications/:id", h.NotificationAdmin.Delete)
	admin.POST("/notifications/images", h.NotificationAdmin.UploadImage)

	registerAdminAuditRoutes(admin, h)

	// Branding
	admin.PUT("/branding", h.Branding.AdminUpdateBranding)
	admin.POST("/branding/logo", h.Branding.AdminUploadLogo)
	admin.DELETE("/branding/logo", h.Branding.AdminDeleteLogo)
}
