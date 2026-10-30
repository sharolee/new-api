package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// GetChannelTestResults returns the latest successful manual test time per model,
// so the channel test dialog can restore results after it is reopened.
func GetChannelTestResults(c *gin.Context) {
	channelId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	results, err := model.GetChannelTestResults(channelId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, results)
}
