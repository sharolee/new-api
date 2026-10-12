package model

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	modelparametersource "github.com/QuantumNous/new-api/service/model_parameter_source"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	syncFetchTimeout = 90 * time.Second
	syncSourceLimit  = 16
)

// SourceSyncResult is one source's part of a sync summary. Unmatched counts
// alias candidates this sync could not claim because the normalized name is
// already mapped to another canonical model.
type SourceSyncResult struct {
	Source    string `json:"source"`
	Success   bool   `json:"success"`
	Error     string `json:"error,omitempty"`
	Created   int    `json:"created"`
	Updated   int    `json:"updated"`
	Skipped   int    `json:"skipped"`
	Aliases   int    `json:"aliases"`
	Unmatched int    `json:"unmatched"`
}

// ModelParameterSyncResult is the summary of one sync run.
type ModelParameterSyncResult struct {
	DryRun  bool               `json:"dryRun"`
	Results []SourceSyncResult `json:"results"`
}

// SyncModelParameters fetches every selected source and upserts the catalog.
// Fetch and database errors are isolated per source so one failing endpoint
// never aborts the others. Rows marked as manually overridden are skipped
// entirely, so admin edits always survive a sync.
func SyncModelParameters(sources []string, dryRun bool) (*ModelParameterSyncResult, error) {
	return syncModelParameters(sources, dryRun, modelparametersource.Get)
}

func syncModelParameters(sources []string, dryRun bool, lookup func(string) (modelparametersource.Source, error)) (*ModelParameterSyncResult, error) {
	selected := make([]string, 0, len(sources))
	seen := make(map[string]struct{}, len(sources))
	for _, name := range sources {
		key := strings.ToLower(strings.TrimSpace(name))
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		selected = append(selected, key)
	}
	if len(selected) == 0 {
		return nil, errors.New("select at least one model parameter source")
	}
	if len(selected) > syncSourceLimit {
		return nil, fmt.Errorf("too many model parameter sources, maximum %d", syncSourceLimit)
	}
	result := &ModelParameterSyncResult{DryRun: dryRun, Results: make([]SourceSyncResult, 0, len(selected))}
	for _, name := range selected {
		result.Results = append(result.Results, syncModelParameterSource(name, dryRun, lookup))
	}
	return result, nil
}

func syncModelParameterSource(name string, dryRun bool, lookup func(string) (modelparametersource.Source, error)) SourceSyncResult {
	result := SourceSyncResult{Source: name}
	source, err := lookup(name)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	ctx, cancel := context.WithTimeout(context.Background(), syncFetchTimeout)
	defer cancel()
	models, err := source.Fetch(ctx)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	if err := applySourceModels(models, source.Name(), dryRun, &result); err != nil {
		result.Error = err.Error()
		return result
	}
	result.Success = true
	return result
}

func applySourceModels(models []*modelparametersource.SourceModel, source string, dryRun bool, result *SourceSyncResult) error {
	if dryRun {
		return computeSourceModels(DB, models, source, result, false)
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		return computeSourceModels(tx, models, source, result, true)
	})
}

// computeSourceModels upserts one source's models. persist=false computes the
// same summary without writing, which is how a dry run is reported. Values a
// source omits never clear an existing value.
func computeSourceModels(tx *gorm.DB, models []*modelparametersource.SourceModel, source string, result *SourceSyncResult, persist bool) error {
	var existing []*CanonicalModelParameter
	if err := tx.Order("id").Find(&existing).Error; err != nil {
		return err
	}
	byKey := make(map[string]*CanonicalModelParameter, len(existing))
	for _, row := range existing {
		byKey[strings.ToLower(strings.TrimSpace(row.CanonicalKey))] = row
	}
	var existingAliases []*ModelParameterAlias
	if err := tx.Order("id").Find(&existingAliases).Error; err != nil {
		return err
	}
	owners := make(map[string]*ModelParameterAlias, len(existingAliases))
	for _, alias := range existingAliases {
		name := strings.ToLower(strings.TrimSpace(alias.NormalizedName))
		if name == "" {
			continue
		}
		current, taken := owners[name]
		if !taken || aliasBeats(alias, current) {
			owners[name] = alias
		}
	}
	now := common.GetTimestamp()
	for _, sourceModel := range models {
		canonicalKey := strings.ToLower(strings.TrimSpace(sourceModel.CanonicalKey))
		if canonicalKey == "" {
			continue
		}
		current, exists := byKey[canonicalKey]
		if exists && current.IsManual() {
			result.Skipped++
			continue
		}
		row := canonicalRowFromSource(sourceModel, source, current, now)
		if exists {
			result.Updated++
			if persist {
				if err := tx.Model(&CanonicalModelParameter{}).Where("id = ?", current.Id).Updates(canonicalParameterFields(row)).Error; err != nil {
					return err
				}
			}
		} else {
			result.Created++
			if persist {
				if err := tx.Create(row).Error; err != nil {
					return err
				}
			}
		}
		byKey[canonicalKey] = row
		counts, err := applySourceAliases(tx, row, sourceModel, owners, persist, now)
		if err != nil {
			return err
		}
		result.Aliases += counts.created
		result.Unmatched += counts.unmatched
	}
	return nil
}

type parameterAliasCounts struct {
	created   int
	unmatched int
}

func applySourceAliases(tx *gorm.DB, row *CanonicalModelParameter, sourceModel *modelparametersource.SourceModel, owners map[string]*ModelParameterAlias, persist bool, now int64) (parameterAliasCounts, error) {
	counts := parameterAliasCounts{}
	for _, candidate := range sourceModel.Aliases {
		name := NormalizeModelName(candidate.Name)
		if name == "" {
			continue
		}
		owner, taken := owners[name]
		if taken {
			if owner.CanonicalId != row.Id {
				counts.unmatched++
				continue
			}
			if owner.Origin == aliasOriginManual || (owner.Origin == aliasOriginAuto && owner.Confidence == candidate.Confidence) {
				continue
			}
		}
		updated := &ModelParameterAlias{
			NormalizedName: name,
			RawName:        strings.TrimSpace(candidate.Name),
			CanonicalId:    row.Id,
			Origin:         aliasOriginAuto,
			Confidence:     candidate.Confidence,
			CreatedTime:    now,
			UpdatedTime:    now,
		}
		if persist {
			if err := upsertParameterAliasRow(tx, updated); err != nil {
				return counts, err
			}
		}
		counts.created++
		owners[name] = updated
	}
	return counts, nil
}

// upsertParameterAliasRow stores one alias by normalized name. The DoNothing
// insert keeps the unique index the single arbiter, then the winning row is
// updated so a sync can never fail on a duplicate write.
func upsertParameterAliasRow(tx *gorm.DB, alias *ModelParameterAlias) error {
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(alias).Error; err != nil {
		return err
	}
	current := &ModelParameterAlias{}
	if err := tx.Where("normalized_name = ?", alias.NormalizedName).First(current).Error; err != nil {
		return err
	}
	if current.Id == alias.Id {
		return nil
	}
	return tx.Model(&ModelParameterAlias{}).Where("id = ?", current.Id).Updates(map[string]any{
		"raw_name":     alias.RawName,
		"canonical_id": alias.CanonicalId,
		"origin":       alias.Origin,
		"confidence":   alias.Confidence,
		"updated_time": alias.UpdatedTime,
	}).Error
}

func canonicalRowFromSource(sourceModel *modelparametersource.SourceModel, source string, current *CanonicalModelParameter, now int64) *CanonicalModelParameter {
	row := &CanonicalModelParameter{}
	if current != nil {
		*row = *current
	}
	row.Source = strings.TrimSpace(source)
	key := strings.ToLower(strings.TrimSpace(sourceModel.CanonicalKey))
	row.CanonicalKey = key
	if displayName := strings.TrimSpace(sourceModel.DisplayName); displayName != "" {
		row.DisplayName = displayName
	} else {
		row.DisplayName = key
	}
	if vendor := strings.TrimSpace(sourceModel.Vendor); vendor != "" {
		row.Vendor = vendor
	}
	if sourceModel.ContextLength > 0 {
		row.ContextLength = sourceModel.ContextLength
	}
	if sourceModel.MaxOutputTokens > 0 {
		row.MaxOutputTokens = sourceModel.MaxOutputTokens
	}
	if sourceModel.InputModalities != nil {
		row.InputModalities = sourceModel.InputModalities
	}
	if sourceModel.OutputModalities != nil {
		row.OutputModalities = sourceModel.OutputModalities
	}
	if sourceModel.Reasoning != nil {
		row.Reasoning = sourceModel.Reasoning
	}
	if sourceModel.ReasoningEfforts != nil {
		row.ReasoningEfforts = sourceModel.ReasoningEfforts
	}
	if sourceModel.ToolCall != nil {
		row.ToolCall = sourceModel.ToolCall
	}
	if sourceModel.StructuredOutput != nil {
		row.StructuredOutput = sourceModel.StructuredOutput
	}
	if sourceModel.Attachment != nil {
		row.Attachment = sourceModel.Attachment
	}
	if knowledgeCutoff := strings.TrimSpace(sourceModel.KnowledgeCutoff); knowledgeCutoff != "" {
		row.KnowledgeCutoff = knowledgeCutoff
	}
	if releaseDate := strings.TrimSpace(sourceModel.ReleaseDate); releaseDate != "" {
		row.ReleaseDate = releaseDate
	}
	if parameterCount := strings.TrimSpace(sourceModel.ParameterCount); parameterCount != "" {
		row.ParameterCount = parameterCount
	}
	if sourceModel.Tags != nil {
		row.Tags = sourceModel.Tags
	}
	if sourceModel.PriceInput != nil {
		row.PriceInput = sourceModel.PriceInput
	}
	if sourceModel.PriceOutput != nil {
		row.PriceOutput = sourceModel.PriceOutput
	}
	if sourceModel.SourceId != "" {
		row.SourceId = sourceModel.SourceId
	}
	if sourceModel.Extra != "" {
		row.Extra = sourceModel.Extra
	}
	row.SyncTime = now
	row.UpdatedTime = now
	if row.CreatedTime == 0 {
		row.CreatedTime = now
	}
	return row
}
