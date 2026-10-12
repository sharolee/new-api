package controller

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	modelparametersource "github.com/QuantumNous/new-api/service/model_parameter_source"

	"github.com/gin-gonic/gin"
)

// --- Model Parameter Library ---

// ListModelParameters returns the canonical model catalog with filters.
func ListModelParameters(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))

	filter := model.CanonicalModelFilter{
		Keyword:    c.Query("keyword"),
		Vendor:     c.Query("vendor"),
		Capability: c.Query("capability"),
		Category:   c.Query("category"),
		Source:     c.Query("source"),
		Page:       page,
		PageSize:   pageSize,
	}
	items, total, err := model.SearchCanonicalModels(filter)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"items": items, "total": total})
}

// CreateModelParameter creates a manually-overridden canonical model row.
func CreateModelParameter(c *gin.Context) {
	var record model.CanonicalModelParameter
	if err := common.DecodeJson(c.Request.Body, &record); err != nil {
		common.ApiError(c, err)
		return
	}
	if strings.TrimSpace(record.CanonicalKey) == "" {
		common.ApiErrorMsg(c, "模型参数键不能为空")
		return
	}
	if err := model.CreateCanonicalModel(&record); err != nil {
		if strings.HasPrefix(err.Error(), "canonical key already exists") {
			common.ApiErrorMsg(c, "模型参数键已存在")
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"item": record})
}

// UpdateModelParameter updates a canonical model row by ID.
func UpdateModelParameter(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		common.ApiErrorMsg(c, "无效的模型参数 ID")
		return
	}
	var record model.CanonicalModelParameter
	if err := common.DecodeJson(c.Request.Body, &record); err != nil {
		common.ApiError(c, err)
		return
	}
	record.Id = uint(id)
	if err := model.UpdateCanonicalModel(&record); err != nil {
		if strings.HasPrefix(err.Error(), "canonical key already exists") {
			common.ApiErrorMsg(c, "模型参数键已存在")
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"item": record})
}

// DeleteModelParameter deletes a canonical model row by ID.
func DeleteModelParameter(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		common.ApiErrorMsg(c, "无效的模型参数 ID")
		return
	}
	if err := model.DeleteCanonicalModel(uint(id)); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"success": true, "message": "删除成功"})
}

// ListModelParameterSources returns every registered sync source.
func ListModelParameterSources(c *gin.Context) {
	common.ApiSuccess(c, modelparametersource.List())
}

// SyncModelParameters fetches and upserts the catalog from selected sources.
func SyncModelParameters(c *gin.Context) {
	var request struct {
		Sources []string `json:"sources"`
		DryRun  bool     `json:"dryRun"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiError(c, err)
		return
	}
	result, err := model.SyncModelParameters(request.Sources, request.DryRun)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

// ListModelParameterMappings returns the channel → canonical mapping view.
func ListModelParameterMappings(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	result, err := model.BuildChannelModelMappings(c.Query("keyword"), c.Query("status"), page, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"items": result.Items, "total": result.Total})
}

// ListModelParameterOverview returns the aggregated distinct upstream model
// list across all channels with match status, context/params, and capabilities.
func ListModelParameterOverview(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	channelId, _ := strconv.Atoi(c.Query("channel_id"))
	result, err := model.BuildChannelModelOverview(
		c.Query("keyword"), c.Query("capability"), channelId,
		c.Query("sort"), c.Query("order"),
		page, pageSize,
	)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"items": result.Items, "total": result.Total, "channels": result.Channels})
}

// UpdateModelParameterMapping creates or replaces a manual alias.
func UpdateModelParameterMapping(c *gin.Context) {
	var request struct {
		Model       string `json:"model"`
		CanonicalID uint   `json:"canonicalId"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiError(c, err)
		return
	}
	if strings.TrimSpace(request.Model) == "" {
		common.ApiErrorMsg(c, "模型名称不能为空")
		return
	}
	if request.CanonicalID == 0 {
		common.ApiErrorMsg(c, "缺少 canonical ID")
		return
	}
	if _, err := model.UpsertManualAlias(request.Model, request.CanonicalID); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"success": true, "message": "映射已更新"})
}

// DeleteModelParameterMapping deletes an alias by model name.
func DeleteModelParameterMapping(c *gin.Context) {
	modelName := c.Query("model")
	if strings.TrimSpace(modelName) == "" {
		common.ApiErrorMsg(c, "模型名称不能为空")
		return
	}
	deleted, err := model.DeleteAliasByNormalizedName(modelName)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !deleted {
		common.ApiSuccess(c, gin.H{"success": true, "message": "无匹配的映射"})
		return
	}
	common.ApiSuccess(c, gin.H{"success": true, "message": "映射已删除"})
}
