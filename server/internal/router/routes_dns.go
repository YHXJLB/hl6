package router

import (
	"github.com/gin-gonic/gin"
	"hl6-server/internal/middleware"
)

func registerDNSRoutes(api *gin.RouterGroup, auth *middleware.AuthMiddleware, h *Handlers) {
	// Public endpoints (no auth required)
	api.GET("/public/domains", h.Domain.PublicList)
	api.GET("/public/subdomains/check", h.Domain.PublicCheckSubdomain)

	// Authenticated endpoints
	authed := api.Group("", auth.Required())

	authed.GET("/domains", h.Domain.List)

	authed.GET("/subdomains", h.Subdomain.List)
	authed.GET("/subdomains/settings", h.Subdomain.Settings)
	authed.POST("/subdomains", h.Subdomain.Claim)
	authed.GET("/subdomains/:id", h.Subdomain.Get)
	authed.DELETE("/subdomains/:id", h.Subdomain.Release)

	// 子域创建规则实时检测（已登录用户可用）
	authed.GET("/subdomains/check-rules", h.ClaimRule.CheckForClaim)

	authed.GET("/subdomains/:id/records", h.DNS.ListRecords)
	authed.POST("/subdomains/:id/records", h.DNS.CreateRecord)
	authed.PUT("/subdomains/:id/records/:recordId", h.DNS.UpdateRecord)
	authed.DELETE("/subdomains/:id/records/:recordId", h.DNS.DeleteRecord)
}
