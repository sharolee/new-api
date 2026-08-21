package model

import (
	"errors"
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// ModelCategory represents a user-defined category for organizing available models.
type ModelCategory struct {
	Id          int    `json:"id" gorm:"primaryKey;autoIncrement"`
	Name        string `json:"name" gorm:"size:64;not null;uniqueIndex:uk_category_name"`
	Description string `json:"description" gorm:"size:255"`
	Color       string `json:"color" gorm:"size:7;default:#6366F1"`
	SortOrder   int    `json:"sort_order" gorm:"default:0;index"`
	CreatedAt   int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

func (ModelCategory) TableName() string {
	return "model_categories"
}

// ModelModelCategory is the junction table between models (identified by name)
// and their assigned categories.
type ModelModelCategory struct {
	ModelID       int    `json:"model_id" gorm:"primaryKey;autoIncrement:false;index:idx_model_category"`
	CategoryID    int    `json:"category_id" gorm:"primaryKey;autoIncrement:false;index:idx_model_category"`
	ModelName     string `json:"model_name" gorm:"size:255;primaryKey;autoIncrement:false;index"`
	AssignedAt    int64  `json:"assigned_at" gorm:"autoCreateTime"`
}

func (ModelModelCategory) TableName() string {
	return "model_model_categories"
}

// --- CRUD for ModelCategory ---

func InsertModelCategory(category *ModelCategory) error {
	return DB.Create(category).Error
}

func UpdateModelCategory(id int, updates map[string]interface{}) error {
	return DB.Model(&ModelCategory{}).Where("id = ?", id).Updates(updates).Error
}

func DeleteModelCategory(id int) error {
	// Delete all assignments for this category first
	if err := DB.Where("category_id = ?", id).Delete(&ModelModelCategory{}).Error; err != nil {
		return err
	}
	return DB.Delete(&ModelCategory{}, id).Error
}

func GetModelCategories() ([]ModelCategory, error) {
	var categories []ModelCategory
	err := DB.Order("sort_order ASC, id ASC").Find(&categories).Error
	return categories, err
}

func GetModelCategory(id int) (*ModelCategory, error) {
	var category ModelCategory
	err := DB.First(&category, id).Error
	if err != nil {
		return nil, err
	}
	return &category, nil
}

// --- Junction table operations ---

func GetCategoryIDsByModelName(modelName string) ([]int, error) {
	var ids []int
	err := DB.Model(&ModelModelCategory{}).
		Where("model_name = ?", modelName).
		Pluck("category_id", &ids).Error
	return ids, err
}

func GetModelNamesByCategoryID(categoryID int) ([]string, error) {
	var names []string
	err := DB.Model(&ModelModelCategory{}).
		Where("category_id = ?", categoryID).
		Distinct("model_name").
		Pluck("model_name", &names).Error
	return names, err
}

// AssignCategories assigns the given category IDs to the specified model name.
// model_id is the primary key in the junction table.
func AssignModelCategories(modelID int, modelName string, categoryIDs []int) error {
	if err := DB.Where("model_name = ?", modelName).Delete(&ModelModelCategory{}).Error; err != nil {
		return err
	}
	if len(categoryIDs) == 0 {
		return nil
	}
	records := make([]ModelModelCategory, 0, len(categoryIDs))
	for _, cid := range categoryIDs {
		records = append(records, ModelModelCategory{
			ModelID:    modelID,
			CategoryID: cid,
			ModelName:  modelName,
		})
	}
	return DB.Create(&records).Error
}

// CategoryModelDTO is returned in GetAvailableModels for the categories field.
type CategoryModelDTO struct {
	Id          int    `json:"id"`
	Name        string `json:"name"`
	Color       string `json:"color"`
	Description string `json:"description"`
}

// AvailableModelDTO represents one model available across all channels (the
// /playground view), with channel/group/category metadata.
type AvailableModelDTO struct {
	ModelName      string              `json:"model_name"`
	ChannelCount   int                 `json:"channel_count"`
	ChannelNames   []string            `json:"channel_names"`
	ChannelTypes   map[int]int         `json:"channel_types"`
	EnabledGroups  []string            `json:"enabled_groups"`
	Categories     []CategoryModelDTO  `json:"categories"`
	HasModelMeta   bool                `json:"has_model_meta"`
	ModelMetaID    *int                `json:"model_meta_id,omitempty"`
	ModelRatio     float64             `json:"model_ratio"`
	ModelPrice     float64             `json:"model_price"`
	QuotaType      int                 `json:"quota_type"`
	Tags           []string            `json:"tags"`
}

// AvailableModelsFilter holds optional filters for GetAvailableModels.
type AvailableModelsFilter struct {
	Keyword       string
	ChannelType   *int
	Group         string
	CategoryID    *int
	Page          int
	PageSize      int
	SearchEnabled bool
}

// GetAvailableModels returns all enabled models with aggregated channel/group/
// category metadata. It mirrors what /playground shows.
func GetAvailableModels(filter *AvailableModelsFilter) ([]AvailableModelDTO, int64, error) {
	if filter == nil {
		filter = &AvailableModelsFilter{}
	}

	page := filter.Page
	pageSize := filter.PageSize
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 50
	}

	// Build base query for distinct enabled models
	query := DB.Table("abilities").Where("enabled = ?", true)

	if filter.Keyword != "" {
		query = query.Where("model LIKE ?", "%"+filter.Keyword+"%")
	}

	if filter.Group != "" {
		query = query.Where(commonGroupCol+" = ?", filter.Group)
	}

	if filter.ChannelType != nil {
		// Filter to models that have at least one ability on a channel of this type
		chType := *filter.ChannelType
		query = query.Where(
			"channel_id IN (SELECT id FROM channels WHERE type = ?)",
			chType,
		)
	}

	if filter.CategoryID != nil {
		catID := *filter.CategoryID
		// Only models that have this category assigned
		assignedModels := DB.Table("model_model_categories").
			Where("category_id = ?", catID).
			Distinct("model_name")
		query = query.Where("model IN (?)", assignedModels)
	}

	// First get distinct model names (for total count + to feed subqueries)
	var modelNames []string
	err := query.Distinct("model").Pluck("model", &modelNames).Error
	if err != nil {
		return nil, 0, err
	}

	// Sort case-insensitively in Go so the order is identical across
	// SQLite/MySQL/PostgreSQL regardless of their collation differences.
	sort.Slice(modelNames, func(i, j int) bool {
		li, lj := strings.ToLower(modelNames[i]), strings.ToLower(modelNames[j])
		if li != lj {
			return li < lj
		}
		return modelNames[i] < modelNames[j]
	})

	total := int64(len(modelNames))
	if total == 0 {
		return []AvailableModelDTO{}, 0, nil
	}

	if len(modelNames) > pageSize {
		startIdx := (page - 1) * pageSize
		endIdx := startIdx + pageSize
		if startIdx >= len(modelNames) {
			return []AvailableModelDTO{}, total, nil
		}
		if endIdx > len(modelNames) {
			endIdx = len(modelNames)
		}
		modelNames = modelNames[startIdx:endIdx]
	}

	// Channel info per model: count + channel names/types
	// Query all abilities for these models in one shot
	var abilities []Ability
	if err := DB.Table("abilities").
		Where("enabled = ? AND model IN ?", true, modelNames).
		Find(&abilities).Error; err != nil {
		return nil, total, err
	}

	// Collect distinct channel IDs to fetch channel names/types
	chIDSet := make(map[int]struct{})
	for _, a := range abilities {
		chIDSet[a.ChannelId] = struct{}{}
	}

	var channels []Channel
	if len(chIDSet) > 0 {
		chIDs := make([]int, 0, len(chIDSet))
		for id := range chIDSet {
			chIDs = append(chIDs, id)
		}
		if err := DB.Where("id IN ?", chIDs).Find(&channels).Error; err != nil {
			return nil, total, err
		}
	}
	chMap := make(map[int]Channel)
	for _, ch := range channels {
		chMap[ch.Id] = ch
	}

	// Group by model name
	type modelChannelInfo struct {
		channelIDs map[int]struct{}  // distinct channel IDs (for channel_count)
		names      map[string]struct{} // distinct channel names (for display)
		types      map[int]int        // channel_type -> count
	}
	modelChInfo := make(map[string]*modelChannelInfo)
	for _, a := range abilities {
		info := modelChInfo[a.Model]
		if info == nil {
			info = &modelChannelInfo{
				channelIDs: make(map[int]struct{}),
				names:      make(map[string]struct{}),
				types:      make(map[int]int),
			}
			modelChInfo[a.Model] = info
		}
		info.channelIDs[a.ChannelId] = struct{}{}
		ch := chMap[a.ChannelId]
		chName := ch.Name
		if chName == "" {
			chName = "Channel " + strconv.Itoa(a.ChannelId)
		}
		info.names[chName] = struct{}{}
		info.types[ch.Type]++
	}

	// Groups per model — deduplicate from the already-fetched abilities list.
	modelGroups := make(map[string][]string)
	seen := make(map[string]bool)
	for _, a := range abilities {
		key := a.Model + "|" + a.Group
		if !seen[key] {
			seen[key] = true
			modelGroups[a.Model] = append(modelGroups[a.Model], a.Group)
		}
	}

	// Categories per model (batch)
	var assignments []ModelModelCategory
	if err := DB.Where("model_name IN ?", modelNames).
		Find(&assignments).Error; err != nil {
		return nil, total, err
	}

	// Collect distinct category IDs
	catIDSet := make(map[int]struct{})
	for _, a := range assignments {
		catIDSet[a.CategoryID] = struct{}{}
	}
	var categories []ModelCategory
	if len(catIDSet) > 0 {
		catIDs := make([]int, 0, len(catIDSet))
		for id := range catIDSet {
			catIDs = append(catIDs, id)
		}
		if err := DB.Where("id IN ?", catIDs).Find(&categories).Error; err != nil {
			return nil, total, err
		}
	}
	catMap := make(map[int]CategoryModelDTO)
	for _, c := range categories {
		catMap[c.Id] = CategoryModelDTO{
			Id:          c.Id,
			Name:        c.Name,
			Color:       c.Color,
			Description: c.Description,
		}
	}

	modelCats := make(map[string][]CategoryModelDTO)
	for _, a := range assignments {
		if cat, ok := catMap[a.CategoryID]; ok {
			modelCats[a.ModelName] = append(modelCats[a.ModelName], cat)
		}
	}

	// Check which model names exist in the models table
	var existingModels []Model
	if err := DB.Select("id, model_name, tags").
		Where("model_name IN ?", modelNames).
		Find(&existingModels).Error; err != nil {
		// Non-fatal: degrade gracefully
	}
	metaMap := make(map[string]Model)
	for _, m := range existingModels {
		metaMap[m.ModelName] = m
	}

	// Pricing info per model (ratio/price/quota type) from the system pricing data
	pricingByModel := make(map[string]Pricing)
	for _, p := range GetPricing() {
		pricingByModel[p.ModelName] = p
	}

	// Build result
	result := make([]AvailableModelDTO, 0, len(modelNames))
	for _, modelName := range modelNames {
		dto := AvailableModelDTO{
			ModelName:    modelName,
			ChannelNames: []string{},
			ChannelTypes: map[int]int{},
			EnabledGroups: []string{},
			Categories:   []CategoryModelDTO{},
			Tags:         []string{},
		}

		info := modelChInfo[modelName]
		if info != nil {
			dto.ChannelCount = len(info.channelIDs)
			chNames := make([]string, 0, len(info.names))
			for name := range info.names {
				chNames = append(chNames, name)
			}
			sort.Strings(chNames)
			dto.ChannelNames = chNames
			dto.ChannelTypes = info.types
		}

		if groups := modelGroups[modelName]; len(groups) > 0 {
			dto.EnabledGroups = groups
		}

		if cats := modelCats[modelName]; len(cats) > 0 {
			dto.Categories = cats
		}

		if meta, ok := metaMap[modelName]; ok {
			dto.HasModelMeta = true
			metaID := meta.Id
			dto.ModelMetaID = &metaID
			if strings.TrimSpace(meta.Tags) != "" {
				for _, tag := range strings.Split(meta.Tags, ",") {
					if tag = strings.TrimSpace(tag); tag != "" {
						dto.Tags = append(dto.Tags, tag)
					}
				}
			}
		}

		if p, ok := pricingByModel[modelName]; ok {
			dto.ModelRatio = p.ModelRatio
			dto.ModelPrice = p.ModelPrice
			dto.QuotaType = p.QuotaType
		}

		result = append(result, dto)
	}

	return result, total, nil
}

// HasAvailableModel checks if the given model name exists in abilities.
func HasAvailableModel(modelName string) (bool, error) {
	var count int64
	err := DB.Table("abilities").
		Where("enabled = ? AND model = ?", true, modelName).
		Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// GetChannelTypeNamesForModel returns the distinct channel types for a model.
func GetChannelTypeNamesForModel(modelName string) ([]int, error) {
	var types []int
	err := DB.Table("abilities").
		Select("DISTINCT channels.type").
		Joins("INNER JOIN channels ON abilities.channel_id = channels.id").
		Where("abilities.enabled = ? AND abilities.model = ?", true, modelName).
		Pluck("channels.type", &types).Error
	return types, err
}

// ValidateCategoryName checks if a category name is already in use.
func ValidateCategoryName(id int, name string) error {
	var count int64
	query := DB.Model(&ModelCategory{}).Where("name = ?", name)
	if id > 0 {
		query = query.Where("id != ?", id)
	}
	err := query.Count(&count).Error
	if err != nil {
		return err
	}
	if count > 0 {
		return errors.New("category name already exists")
	}
	return nil
}

// EnsureDefaultModelCategories seeds the built-in model categories (Reasoning,
// Image Generation, Video, Vision, Free of charge, Cost-Effective) when the
// model_categories table is empty. Names are English i18n keys so the frontend
// can translate them via t().
func EnsureDefaultModelCategories() {
	var count int64
	if err := DB.Model(&ModelCategory{}).Count(&count).Error; err != nil {
		common.SysLog("failed to check model categories: " + err.Error())
		return
	}
	if count > 0 {
		return
	}
	defaults := []ModelCategory{
		{Name: "Reasoning", Description: "Reasoning-focused models", Color: "#6366F1", SortOrder: 1},
		{Name: "Image Generation", Description: "Image generation models", Color: "#22c55e", SortOrder: 2},
		{Name: "Video", Description: "Video generation models", Color: "#ef4444", SortOrder: 3},
		{Name: "Vision", Description: "Vision and multimodal understanding models", Color: "#f59e0b", SortOrder: 4},
		{Name: "Free of charge", Description: "Models available at no cost", Color: "#10b981", SortOrder: 5},
		{Name: "Cost-Effective", Description: "Affordable, budget-friendly models", Color: "#06b6d4", SortOrder: 6},
	}
	if err := DB.Create(&defaults).Error; err != nil {
		common.SysLog("failed to seed default model categories: " + err.Error())
		return
	}
	common.SysLog("seeded default model categories")
}