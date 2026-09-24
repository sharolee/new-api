package controller

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

func parseFlowQuotaTimeRange(c *gin.Context) (int64, int64, bool) {
	startTimestamp, err := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	if err != nil || startTimestamp <= 0 {
		common.ApiErrorMsg(c, "invalid start_timestamp")
		return 0, 0, false
	}
	endTimestamp, err := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	if err != nil || endTimestamp <= 0 {
		common.ApiErrorMsg(c, "invalid end_timestamp")
		return 0, 0, false
	}
	if endTimestamp < startTimestamp {
		common.ApiErrorMsg(c, "invalid time range")
		return 0, 0, false
	}
	return startTimestamp, endTimestamp, true
}

// aggregateByQuery 解析模型聚合维度查询参数，默认按请求模型（model_name）聚合。
// 可选值：model_name（默认，请求模型）、upstream_model_name（渠道映射后的上游模型）。
func aggregateByQuery(c *gin.Context) string {
	aggregateBy := c.Query("aggregate_by")
	if aggregateBy != "upstream_model_name" && aggregateBy != "model_name" {
		return "model_name"
	}
	return aggregateBy
}

func GetAllQuotaDates(c *gin.Context) {
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	username := c.Query("username")
	aggregateBy := aggregateByQuery(c)
	dates, err := model.GetAllQuotaDates(startTimestamp, endTimestamp, username, aggregateBy)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    dates,
	})
	return
}

func GetQuotaDatesByUser(c *gin.Context) {
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	dates, err := model.GetQuotaDataGroupByUser(startTimestamp, endTimestamp)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    dates,
	})
}

func GetUserQuotaDates(c *gin.Context) {
	userId := c.GetInt("id")
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	// 判断时间跨度是否超过 1 个月
	if endTimestamp-startTimestamp > 2592000 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "时间跨度不能超过 1 个月",
		})
		return
	}
	aggregateBy := aggregateByQuery(c)
	dates, err := model.GetQuotaDataByUserId(userId, startTimestamp, endTimestamp, aggregateBy)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    dates,
	})
	return
}

func GetAllFlowQuotaDates(c *gin.Context) {
	startTimestamp, endTimestamp, ok := parseFlowQuotaTimeRange(c)
	if !ok {
		return
	}
	username := c.Query("username")
	dates, err := model.GetFlowQuotaData(startTimestamp, endTimestamp, username, 0, c.GetInt("role"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    dates,
	})
	return
}

func GetUserFlowQuotaDates(c *gin.Context) {
	userId := c.GetInt("id")
	startTimestamp, endTimestamp, ok := parseFlowQuotaTimeRange(c)
	if !ok {
		return
	}
	if endTimestamp-startTimestamp > 2592000 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "时间跨度不能超过 1 个月",
		})
		return
	}
	dates, err := model.GetFlowQuotaData(startTimestamp, endTimestamp, "", userId, common.RoleCommonUser)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    dates,
	})
	return
}

func GetAllErrorLogStats(c *gin.Context) {
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	username := c.Query("username")
	modelName := c.Query("model_name")
	group := c.Query("group")
	channel, _ := strconv.Atoi(c.Query("channel"))
	granularity := c.Query("granularity")
	if granularity == "" {
		granularity = "hour"
	}
	stats, err := model.GetErrorLogStats(startTimestamp, endTimestamp, username, modelName, group, channel, granularity)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": stats})
	return
}

func GetUserErrorLogStats(c *gin.Context) {
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	granularity := c.Query("granularity")
	if granularity == "" {
		granularity = "hour"
	}
	if endTimestamp-startTimestamp > 2592000 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "time range too large"})
		return
	}
	stats, err := model.GetErrorLogStats(startTimestamp, endTimestamp, "", "", "", 0, granularity)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": stats})
	return
}

func parseModelStatusParams(c *gin.Context) (startTimestamp int64, endTimestamp int64, limit int, aggregateBy string, username string) {
	startTimestamp, _ = strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ = strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	limit, _ = strconv.Atoi(c.Query("limit"))
	// model-status 端点默认按上游模型聚合（与用户需求一致），
	// 区别于其它 data 端点默认按请求模型聚合。
	aggregateBy = c.Query("aggregate_by")
	if aggregateBy != "model_name" && aggregateBy != "upstream_model_name" {
		aggregateBy = "upstream_model_name"
	}
	username = c.Query("username")
	return
}

func GetAllModelRequestStatuses(c *gin.Context) {
	startTimestamp, endTimestamp, limit, aggregateBy, username := parseModelStatusParams(c)
	data, err := model.GetModelRequestStatuses(startTimestamp, endTimestamp, username, aggregateBy, limit, 0)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, data)
}

func GetUserModelRequestStatuses(c *gin.Context) {
	userId := c.GetInt("id")
	startTimestamp, endTimestamp, limit, aggregateBy, _ := parseModelStatusParams(c)
	if endTimestamp-startTimestamp > 2592000 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "时间跨度不能超过 1 个月"})
		return
	}
	data, err := model.GetModelRequestStatuses(startTimestamp, endTimestamp, "", aggregateBy, limit, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, data)
}
