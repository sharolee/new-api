package model

import (
	"database/sql/driver"
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

const (
	// aliasOriginAuto marks aliases created by a source sync.
	aliasOriginAuto = "auto"
	// aliasOriginManual marks aliases set by an admin; these always win.
	aliasOriginManual = "manual"
)

// modelParameterStringList persists a JSON string array in a TEXT column and
// serializes as a JSON array over the API. TEXT keeps the column readable on
// SQLite, MySQL >= 5.7.8, and PostgreSQL >= 9.6.
type modelParameterStringList []string

func (l modelParameterStringList) Value() (driver.Value, error) {
	if len(l) == 0 {
		return "[]", nil
	}
	data, err := common.Marshal([]string(l))
	if err != nil {
		return nil, err
	}
	return string(data), nil
}

func (l *modelParameterStringList) Scan(value any) error {
	var data string
	switch typed := value.(type) {
	case nil:
		*l = nil
		return nil
	case []byte:
		data = string(typed)
	case string:
		data = typed
	default:
		return fmt.Errorf("model parameter list: unsupported column value %T", value)
	}
	data = strings.TrimSpace(data)
	if data == "" || data == "null" {
		*l = nil
		return nil
	}
	var list []string
	if err := common.UnmarshalJsonStr(data, &list); err != nil {
		return err
	}
	*l = list
	return nil
}

func (l modelParameterStringList) MarshalJSON() ([]byte, error) {
	if len(l) == 0 {
		return []byte("[]"), nil
	}
	return common.Marshal([]string(l))
}

// CanonicalModelParameter stores one normalized (canonical) model with the
// parameters an admin wants to compare across upstream name variants. It is
// informational only: routing, abilities, and billing never read it.
type CanonicalModelParameter struct {
	Id               uint                     `json:"id" gorm:"primaryKey"`
	CanonicalKey     string                   `json:"canonicalKey" gorm:"size:255;not null;uniqueIndex:uk_model_parameter_canonical_key"`
	DisplayName      string                   `json:"displayName" gorm:"size:255"`
	Vendor           string                   `json:"vendor" gorm:"size:128"`
	ContextLength    int                      `json:"contextLength"`
	MaxOutputTokens  int                      `json:"maxOutputTokens"`
	InputModalities  modelParameterStringList `json:"inputModalities" gorm:"type:text"`
	OutputModalities modelParameterStringList `json:"outputModalities" gorm:"type:text"`
	Reasoning        *bool                    `json:"reasoning"`
	ReasoningEfforts modelParameterStringList `json:"reasoningEfforts" gorm:"type:text"`
	ToolCall         *bool                    `json:"toolCall"`
	StructuredOutput *bool                    `json:"structuredOutput"`
	Attachment       *bool                    `json:"attachment"`
	KnowledgeCutoff  string                   `json:"knowledgeCutoff" gorm:"size:32"`
	ReleaseDate      string                   `json:"releaseDate" gorm:"size:32"`
	ParameterCount   string                   `json:"parameterCount" gorm:"size:64"`
	Category         string                   `json:"category" gorm:"size:128"`
	Tags             modelParameterStringList `json:"tags" gorm:"type:text"`
	PriceInput       *float64                 `json:"priceInput"`
	PriceOutput      *float64                 `json:"priceOutput"`
	Source           string                   `json:"source" gorm:"size:32"`
	SourceId         string                   `json:"sourceId" gorm:"size:255"`
	// Extra keeps the raw source record for traceability. It is storage-only:
	// the console API does not expose it.
	Extra          string `json:"-" gorm:"type:text"`
	ManualOverride *bool  `json:"manualOverride"`
	SyncTime       int64  `json:"syncTime"`
	CreatedTime    int64  `json:"createdAt"`
	UpdatedTime    int64  `json:"updatedAt"`
}

func (CanonicalModelParameter) TableName() string {
	return "model_parameter_catalog"
}

func (m *CanonicalModelParameter) IsManual() bool {
	return m != nil && m.ManualOverride != nil && *m.ManualOverride
}

func (m *CanonicalModelParameter) SetManualOverride(enabled bool) {
	value := enabled
	m.ManualOverride = &value
}

func (m *CanonicalModelParameter) HasCapability(capability string) bool {
	switch strings.ToLower(strings.TrimSpace(capability)) {
	case "reasoning":
		return m.Reasoning != nil && *m.Reasoning
	case "vision":
		return containsFold(m.InputModalities, "image")
	case "tool_call":
		return m.ToolCall != nil && *m.ToolCall
	case "structured_output":
		return m.StructuredOutput != nil && *m.StructuredOutput
	default:
		return false
	}
}

func containsFold(values []string, want string) bool {
	want = strings.ToLower(want)
	for _, value := range values {
		if strings.ToLower(value) == want {
			return true
		}
	}
	return false
}

// CanonicalModelFilter holds the console list filters. An empty value means
// "no filter for this field".
type CanonicalModelFilter struct {
	Keyword    string
	Vendor     string
	Capability string
	Category   string
	Source     string
	Page       int
	PageSize   int
}

func canonicalModelFilterQuery(db *gorm.DB, filter CanonicalModelFilter) *gorm.DB {
	if keyword := strings.TrimSpace(filter.Keyword); keyword != "" {
		like := "%" + strings.ToLower(keyword) + "%"
		db = db.Where("LOWER(canonical_key) LIKE ? OR LOWER(display_name) LIKE ?", like, like)
	}
	if vendor := strings.TrimSpace(filter.Vendor); vendor != "" {
		db = db.Where("LOWER(vendor) = ?", strings.ToLower(vendor))
	}
	switch strings.ToLower(strings.TrimSpace(filter.Capability)) {
	case "reasoning":
		db = db.Where("reasoning = ?", commonTrueVal)
	case "vision":
		db = db.Where("LOWER(input_modalities) LIKE ?", "%\"image\"%")
	case "tool_call":
		db = db.Where("tool_call = ?", commonTrueVal)
	case "structured_output":
		db = db.Where("structured_output = ?", commonTrueVal)
	}
	if category := strings.TrimSpace(filter.Category); category != "" {
		db = db.Where("LOWER(category) = ?", strings.ToLower(category))
	}
	if source := strings.TrimSpace(filter.Source); source != "" {
		db = db.Where("LOWER(source) = ?", strings.ToLower(source))
	}
	return db
}

func SearchCanonicalModels(filter CanonicalModelFilter) ([]*CanonicalModelParameter, int64, error) {
	db := canonicalModelFilterQuery(DB.Model(&CanonicalModelParameter{}), filter)
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []*CanonicalModelParameter{}, total, nil
	}
	page := filter.Page
	if page < 1 {
		page = 1
	}
	pageSize := filter.PageSize
	if pageSize <= 0 {
		pageSize = 50
	}
	if pageSize > 500 {
		pageSize = 500
	}
	offset := (page - 1) * pageSize
	var records []*CanonicalModelParameter
	if err := db.Order("LOWER(canonical_key) ASC, id ASC").Offset(offset).Limit(pageSize).Find(&records).Error; err != nil {
		return nil, 0, err
	}
	return records, total, nil
}

func GetCanonicalModelById(id uint) (*CanonicalModelParameter, error) {
	var record CanonicalModelParameter
	if err := DB.First(&record, id).Error; err != nil {
		return nil, err
	}
	return &record, nil
}

func GetCanonicalModelBySourceId(source, sourceId string) (*CanonicalModelParameter, error) {
	var record CanonicalModelParameter
	if err := DB.Where("source = ? AND source_id = ?", source, sourceId).First(&record).Error; err != nil {
		return nil, err
	}
	return &record, nil
}

func CanonicalKeyExists(key string, excludeId uint) (bool, error) {
	query := DB.Model(&CanonicalModelParameter{})
	if excludeId > 0 {
		query = query.Where("id <> ?", excludeId)
	}
	var count int64
	if err := query.Where("canonical_key = ?", key).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// ValidateCanonicalModel checks the request-level invariants that the database
// cannot express for every supported engine.
func ValidateCanonicalModel(record *CanonicalModelParameter) error {
	if record == nil {
		return errors.New("canonical model is required")
	}
	key := strings.TrimSpace(record.CanonicalKey)
	if key == "" {
		return errors.New("canonical key is required")
	}
	if len(key) > 255 {
		return errors.New("canonical key is too long")
	}
	record.CanonicalKey = key
	for _, field := range []struct {
		name  string
		value string
		limit int
	}{
		{"display name", record.DisplayName, 255},
		{"vendor", record.Vendor, 128},
		{"knowledge cutoff", record.KnowledgeCutoff, 32},
		{"release date", record.ReleaseDate, 32},
		{"parameter count", record.ParameterCount, 64},
		{"category", record.Category, 128},
		{"source", record.Source, 32},
		{"source id", record.SourceId, 255},
	} {
		if len(field.value) > field.limit {
			return fmt.Errorf("%s is too long", field.name)
		}
	}
	for _, list := range []modelParameterStringList{
		record.InputModalities, record.OutputModalities, record.ReasoningEfforts, record.Tags,
	} {
		if len(list) > 64 {
			return errors.New("model parameter list is too long")
		}
		for _, value := range list {
			if len(value) > 128 {
				return errors.New("model parameter list item is too long")
			}
		}
	}
	return nil
}

// CreateCanonicalModel persists an admin-created row. Admin writes are always
// marked as manually overridden so a later sync cannot overwrite them.
func CreateCanonicalModel(record *CanonicalModelParameter) error {
	if err := ValidateCanonicalModel(record); err != nil {
		return err
	}
	exists, err := CanonicalKeyExists(record.CanonicalKey, 0)
	if err != nil {
		return err
	}
	if exists {
		return fmt.Errorf("canonical key already exists: %s", record.CanonicalKey)
	}
	now := common.GetTimestamp()
	record.Id = 0
	record.CreatedTime = now
	record.UpdatedTime = now
	if record.SyncTime == 0 {
		record.SyncTime = now
	}
	record.SetManualOverride(true)
	return DB.Create(record).Error
}

// canonicalParameterFields lists every sync- and admin-writable column. Values
// are addressed by column name so explicit unknown (NULL) booleans survive
// GORM's zero-value skip in struct-based updates.
func canonicalParameterFields(row *CanonicalModelParameter) map[string]any {
	return map[string]any{
		"canonical_key":     row.CanonicalKey,
		"display_name":      row.DisplayName,
		"vendor":            row.Vendor,
		"context_length":    row.ContextLength,
		"max_output_tokens": row.MaxOutputTokens,
		"input_modalities":  row.InputModalities,
		"output_modalities": row.OutputModalities,
		"reasoning":         row.Reasoning,
		"reasoning_efforts": row.ReasoningEfforts,
		"tool_call":         row.ToolCall,
		"structured_output": row.StructuredOutput,
		"attachment":        row.Attachment,
		"knowledge_cutoff":  row.KnowledgeCutoff,
		"release_date":      row.ReleaseDate,
		"parameter_count":   row.ParameterCount,
		"category":          row.Category,
		"tags":              row.Tags,
		"price_input":       row.PriceInput,
		"price_output":      row.PriceOutput,
		"source":            row.Source,
		"source_id":         row.SourceId,
		"extra":             row.Extra,
		"sync_time":         row.SyncTime,
		"updated_time":      row.UpdatedTime,
	}
}

// UpdateCanonicalModel rewrites every editable field, including explicit
// unknown (NULL) booleans, and marks the row as manually overridden.
func UpdateCanonicalModel(record *CanonicalModelParameter) error {
	if err := ValidateCanonicalModel(record); err != nil {
		return err
	}
	if record.Id == 0 {
		return errors.New("canonical model id is required")
	}
	exists, err := CanonicalKeyExists(record.CanonicalKey, record.Id)
	if err != nil {
		return err
	}
	if exists {
		return fmt.Errorf("canonical key already exists: %s", record.CanonicalKey)
	}
	fields := canonicalParameterFields(record)
	fields["manual_override"] = true
	return DB.Model(&CanonicalModelParameter{}).Where("id = ?", record.Id).Updates(fields).Error
}

// DeleteCanonicalModel removes a canonical model and every alias that points at
// it, since the alias table is maintained by hand rather than through a FK.
func DeleteCanonicalModel(id uint) error {
	if id == 0 {
		return errors.New("canonical model id is required")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("canonical_id = ?", id).Delete(&ModelParameterAlias{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", id).Delete(&CanonicalModelParameter{}).Error
	})
}

// CanonicalModelPageResult is the envelope body of the list endpoint.
type CanonicalModelPageResult struct {
	Items []*CanonicalModelParameter `json:"items"`
	Total int64                      `json:"total"`
}
