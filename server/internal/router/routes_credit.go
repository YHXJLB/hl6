package router

import (
	"github.com/gin-gonic/gin"
	"hl6-server/internal/middleware"
)

func registerCreditRoutes(api *gin.RouterGroup, auth *middleware.AuthMiddleware, h *Handlers) {
	authed := api.Group("", auth.Required())
	authed.GET("/credits", h.Credit.GetBalance)
	authed.GET("/credits/transactions", h.Credit.ListTransactions)
	authed.GET("/credits/checkin/status", h.Credit.GetDailyCheckinStatus)
	authed.POST("/credits/checkin", h.Credit.DailyCheckin)
	authed.POST("/credits/redeem", h.RedeemCode.Redeem)

	authed.GET("/referrals", h.Referral.GetReferralInfo)
}
