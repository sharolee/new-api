package controller

import (
	"errors"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// --- Available Models ---

// GetAvailableModelsMeta returns all enabled models from the abilities table
// with channel/group/category metadata. This mirrors what /playground shows.
func GetAvailableModelsMeta(c *gin.Context) {
	keyword := c.Query("keyword")
	chTypeStr := c.Query("ch_type")
	channelIDStr := c.Query("channel_id")
	group := c.Query("group")
	catStr := c.Query("category_id")
	search := c.Query("search_enabled")

	filter := &model.AvailableModelsFilter{}

	if keyword != "" {
		filter.Keyword = keyword
	}

	if chTypeStr != "" {
		if chType, err := strconv.Atoi(chTypeStr); err == nil {
			filter.ChannelType = &chType
		}
	}

	if channelIDStr != "" {
		if channelID, err := strconv.Atoi(channelIDStr); err == nil {
			filter.ChannelID = &channelID
		}
	}

	if group != "" {
		filter.Group = group
	}

	if catStr != "" {
		if catID, err := strconv.Atoi(catStr); err == nil {
			filter.CategoryID = &catID
		}
	}

	filter.Page, _ = strconv.Atoi(c.DefaultQuery("p", "1"))
	filter.PageSize, _ = strconv.Atoi(c.DefaultQuery("page_size", "50"))
	filter.SearchEnabled = search == "true"

	models, total, err := model.GetAvailableModels(filter)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, gin.H{
		"items":     models,
		"total":     total,
		"page":      filter.Page,
		"page_size": filter.PageSize,
	})
}

// GetAvailableChannelsMeta returns channels with at least one enabled ability,
// used to populate the channel filter on the available models page.
func GetAvailableChannelsMeta(c *gin.Context) {
	channels, err := model.GetAvailableChannels()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, channels)
}

// GetAvailableModelMeta returns the metadata (vendor, description, etc.)
// for a specific model name that exists in abilities.
func GetAvailableModelMeta(c *gin.Context) {
	modelName := c.Param("model")
	if modelName == "" {
		common.ApiError(c, errors.New("缺少模型名称"))
		return
	}

	exists, err := model.HasAvailableModel(modelName)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !exists {
		common.ApiError(c, errors.New("模型不存在"))
		return
	}

	models, total, err := model.GetAvailableModels(&model.AvailableModelsFilter{
		Keyword:    modelName,
		Page:       1,
		PageSize:   1,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}

	if total == 0 || len(models) == 0 {
		common.ApiError(c, errors.New("模型不存在"))
		return
	}

	common.ApiSuccess(c, models[0])
}

// --- Category CRUD ---

type CreateCategoryRequest struct {
	Name        string `json:"name" binding:"required,max=64"`
	Description string `json:"description" binding:"max=255"`
	Color       string `json:"color" binding:"max=7"`
	SortOrder   int    `json:"sort_order"`
}

type UpdateCategoryRequest struct {
	Name        *string `json:"name" binding:"omitempty,max=64"`
	Description *string `json:"description" binding:"omitempty,max=255"`
	Color       *string `json:"color" binding:"omitempty,max=7"`
	SortOrder   *int    `json:"sort_order"`
}

type AssignCategoriesRequest struct {
	CategoryIDs []int `json:"category_ids"`
}

// GetAllModelCategories lists all model categories.
func GetAllModelCategories(c *gin.Context) {
	categories, err := model.GetModelCategories()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, categories)
}

// GetModelCategory gets a single category by ID.
func GetModelCategory(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiError(c, errors.New("无效的分类 ID"))
		return
	}
	cat, err := model.GetModelCategory(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, cat)
}

// CreateModelCategory creates a new category.
func CreateModelCategory(c *gin.Context) {
	var req CreateCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.Name == "" {
		common.ApiErrorMsg(c, "分类名称不能为空")
		return
	}
	if err := model.ValidateCategoryName(0, req.Name); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}

	cat := &model.ModelCategory{
		Name:        req.Name,
		Description: req.Description,
		Color:       req.Color,
		SortOrder:   req.SortOrder,
	}
	if cat.Color == "" {
		cat.Color = "#6366F1"
	}
	if err := model.InsertModelCategory(cat); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, cat)
}

// UpdateModelCategory updates an existing category.
func UpdateModelCategory(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiError(c, errors.New("无效的分类 ID"))
		return
	}
	_, err = model.GetModelCategory(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	var req UpdateCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}

	updates := make(map[string]interface{})
	if req.Name != nil && *req.Name != "" {
		if err := model.ValidateCategoryName(id, *req.Name); err != nil {
			common.ApiErrorMsg(c, err.Error())
			return
		}
		updates["name"] = *req.Name
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.Color != nil {
		updates["color"] = *req.Color
	}
	if req.SortOrder != nil {
		updates["sort_order"] = *req.SortOrder
	}

	if len(updates) == 0 {
		common.ApiErrorMsg(c, "没有需要更新的字段")
		return
	}

	if err := model.UpdateModelCategory(id, updates); err != nil {
		common.ApiError(c, err)
		return
	}

	cat, err := model.GetModelCategory(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, cat)
}

// DeleteModelCategory deletes a category and all its assignments.
func DeleteModelCategory(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiError(c, errors.New("无效的分类 ID"))
		return
	}
	if err := model.DeleteModelCategory(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// AssignModelCategories assigns categories to a model.
func AssignModelCategories(c *gin.Context) {
	modelName := c.Param("model")
	if modelName == "" {
		common.ApiError(c, errors.New("缺少模型名称"))
		return
	}

	exists, err := model.HasAvailableModel(modelName)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !exists {
		common.ApiError(c, errors.New("模型不存在"))
		return
	}

	var req AssignCategoriesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}

	// Validate that all category IDs exist
	if len(req.CategoryIDs) > 0 {
		cats, err := model.GetModelCategories()
		if err != nil {
			common.ApiError(c, err)
			return
		}
		validIDs := make(map[int]struct{})
		for _, cat := range cats {
			validIDs[cat.Id] = struct{}{}
		}
		for _, cid := range req.CategoryIDs {
			if _, ok := validIDs[cid]; !ok {
				common.ApiError(c, errors.New("分类 ID 不存在"))
				return
			}
		}
	}

	// look up the model's primary key in the models table (0 if not yet registered)
	metaID := 0
	var m model.Model
	if err := model.DB.Where("model_name = ?", modelName).First(&m).Error; err == nil {
		metaID = m.Id
	}

	if err := model.AssignModelCategories(metaID, modelName, req.CategoryIDs); err != nil {
		common.ApiError(c, err)
		return
	}

	ids, _ := model.GetCategoryIDsByModelName(modelName)
	common.ApiSuccess(c, gin.H{"model_name": modelName, "category_ids": ids})
}

// GetModelCategoriesByModel returns the categories assigned to a model.
func GetModelCategoriesByModel(c *gin.Context) {
	modelName := c.Param("model")
	if modelName == "" {
		common.ApiError(c, errors.New("缺少模型名称"))
		return
	}

	ids, err := model.GetCategoryIDsByModelName(modelName)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	if len(ids) == 0 {
		common.ApiSuccess(c, []model.ModelCategory{})
		return
	}

	cats, err := model.GetModelCategories()
	if err != nil {
		common.ApiError(c, err)
		return
	}

	catMap := make(map[int]model.ModelCategory)
	for _, cat := range cats {
		catMap[cat.Id] = cat
	}

	result := make([]model.ModelCategory, 0, len(ids))
	for _, id := range ids {
		if cat, ok := catMap[id]; ok {
			result = append(result, cat)
		}
	}

	common.ApiSuccess(c, result)
}

// GetModelCategoryNames returns the model names assigned to a category.
func GetModelCategoryNames(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiError(c, errors.New("无效的分类 ID"))
		return
	}
	_, err = model.GetModelCategory(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	names, err := model.GetModelNamesByCategoryID(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"category_id": id, "model_names": names})
}