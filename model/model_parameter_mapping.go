package model

import (
	"errors"
	"regexp"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	settingreasoning "github.com/QuantumNous/new-api/setting/reasoning"

	"gorm.io/gorm"
)

// ModelParameterAlias maps one normalized upstream model name to a canonical
// model. The mapping is global by name: channels do not own aliases, so a name
// keeps one parameter set no matter which channel declares it.
type ModelParameterAlias struct {
	Id             uint   `json:"id" gorm:"primaryKey"`
	NormalizedName string `json:"normalizedName" gorm:"size:255;not null;uniqueIndex:uk_model_parameter_alias_name"`
	RawName        string `json:"rawName" gorm:"size:255"`
	CanonicalId    uint   `json:"canonicalId" gorm:"index:idx_model_parameter_alias_canonical"`
	Origin         string `json:"origin" gorm:"size:16;not null"`
	Confidence     int    `json:"confidence"`
	CreatedTime    int64  `json:"createdAt"`
	UpdatedTime    int64  `json:"updatedAt"`
}

func (ModelParameterAlias) TableName() string {
	return "model_parameter_aliases"
}

const (
	// resolutionOriginAuto marks exact canonical-key/display-name hits.
	resolutionOriginAuto = "auto"
	// resolutionOriginManual marks hits served by an admin-set alias.
	resolutionOriginManual = "manual"
	// resolutionOriginFuzzy marks prefix/suffix/contains hits.
	resolutionOriginFuzzy = "fuzzy"

	resolutionConfidenceExact    = 100
	resolutionConfidencePrefix   = 75
	resolutionConfidenceContains = 50
)

// CanonicalResolution is the outcome of the name resolution pipeline.
type CanonicalResolution struct {
	Canonical  *CanonicalModelParameter
	Origin     string
	Confidence int
}

func (r *CanonicalResolution) IsMatched() bool {
	return r != nil && r.Canonical != nil
}

// modelNameDecorations are conservative decorations that do not change a
// model's identity. Only exact, known affixes are stripped.
var modelNameDecorations = []string{
	"-thinking",
	"-nothinking",
	"-non-thinking",
	"-latest",
	"-preview",
	"-chat",
}

var modelNameDateStamps = []*regexp.Regexp{
	regexp.MustCompile(`-\d{4}-\d{2}-\d{2}$`),
	regexp.MustCompile(`(?:-|\.)\d{8}$`),
}

// NormalizeModelName folds raw upstream names into a single comparable form:
// trimmed and lowercased, with the provider prefix, the reasoning/effort
// modifiers, and common decorations removed.
func NormalizeModelName(raw string) string {
	name := strings.ToLower(strings.TrimSpace(raw))
	if name == "" {
		return ""
	}
	name = stripProviderPrefix(name)
	// The shared modifier parser owns the reasoning/effort grammar; anything it
	// leaves behind is handled by the decoration pass below.
	name = strings.ToLower(strings.TrimSpace(settingreasoning.BaseModelName(name)))
	if at := strings.IndexByte(name, '@'); at >= 0 {
		name = strings.TrimSpace(name[:at])
	}
	name = stripProviderPrefix(name)
	return stripModelDecorations(name)
}

func stripProviderPrefix(name string) string {
	if index := strings.LastIndexByte(name, '/'); index >= 0 {
		return strings.TrimSpace(name[index+1:])
	}
	return strings.TrimSpace(name)
}

func stripModelDecorations(name string) string {
	limit := len(modelNameDecorations)
	if len(modelNameDateStamps) > limit {
		limit = len(modelNameDateStamps)
	}
	for range limit {
		previous := name
		name = strings.TrimSpace(name)
		for _, decoration := range modelNameDecorations {
			if strings.HasSuffix(name, decoration) {
				name = strings.TrimSpace(strings.TrimSuffix(name, decoration))
			}
		}
		for _, stamp := range modelNameDateStamps {
			if stamp.MatchString(name) {
				name = strings.TrimSpace(stamp.ReplaceAllString(name, ""))
			}
		}
		if name == "" {
			return ""
		}
		if name == previous {
			return name
		}
	}
	return name
}

func isModelBoundary(r byte) bool {
	switch r {
	case '-', '/', '.':
		return true
	}
	return false
}

func hasPrefixAtBoundary(name, candidate string) bool {
	if !strings.HasPrefix(name, candidate) {
		return false
	}
	if len(name) == len(candidate) {
		return true
	}
	return isModelBoundary(name[len(candidate)])
}

func containsAtBoundary(name, candidate string) bool {
	if candidate == "" || !strings.Contains(name, candidate) {
		return false
	}
	for from := 0; from <= len(name)-len(candidate); from++ {
		if name[from:from+len(candidate)] != candidate {
			continue
		}
		left := from == 0 || isModelBoundary(name[from-1])
		right := from+len(candidate) == len(name) || isModelBoundary(name[from+len(candidate)])
		if left && right {
			return true
		}
	}
	return false
}

// UpsertManualAlias assigns an upstream name to a canonical model. Manual
// aliases always win: writing one replaces an auto alias with the same
// normalized name.
func UpsertManualAlias(rawName string, canonicalId uint) (*ModelParameterAlias, error) {
	name := NormalizeModelName(rawName)
	if name == "" {
		return nil, errors.New("model name is required")
	}
	if len(name) > 255 {
		return nil, errors.New("model name is too long")
	}
	if canonicalId == 0 {
		return nil, errors.New("canonical model id is required")
	}
	var canonical CanonicalModelParameter
	if err := DB.First(&canonical, canonicalId).Error; err != nil {
		return nil, err
	}
	now := common.GetTimestamp()
	alias := &ModelParameterAlias{
		NormalizedName: name,
		RawName:        strings.TrimSpace(rawName),
		CanonicalId:    canonicalId,
		Origin:         aliasOriginManual,
		Confidence:     resolutionConfidenceExact,
		CreatedTime:    now,
		UpdatedTime:    now,
	}
	if err := DB.Transaction(func(tx *gorm.DB) error {
		return upsertParameterAliasRow(tx, alias)
	}); err != nil {
		return nil, err
	}
	stored := &ModelParameterAlias{}
	if err := DB.Where("normalized_name = ?", name).First(stored).Error; err != nil {
		return nil, err
	}
	return stored, nil
}

// DeleteAliasByNormalizedName clears the mapping for one upstream name. Either
// the raw name or the already normalized form is accepted.
func DeleteAliasByNormalizedName(rawName string) (bool, error) {
	name := NormalizeModelName(rawName)
	if name == "" {
		return false, errors.New("model name is required")
	}
	result := DB.Where("normalized_name = ?", name).Delete(&ModelParameterAlias{})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected > 0, nil
}

// ModelParameterAliasPageResult is the envelope body of the alias list.
type ModelParameterAliasPageResult struct {
	Items []*ModelParameterAlias `json:"items"`
	Total int64                  `json:"total"`
}

func ListAliases(keyword string, page, pageSize int) (*ModelParameterAliasPageResult, error) {
	db := DB.Model(&ModelParameterAlias{})
	if keyword := strings.TrimSpace(keyword); keyword != "" {
		like := "%" + strings.ToLower(keyword) + "%"
		db = db.Where("LOWER(normalized_name) LIKE ? OR LOWER(raw_name) LIKE ?", like, like)
	}
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, err
	}
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 50
	}
	if pageSize > 500 {
		pageSize = 500
	}
	var items []*ModelParameterAlias
	if err := db.Order("normalized_name ASC, id ASC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&items).Error; err != nil {
		return nil, err
	}
	return &ModelParameterAliasPageResult{Items: items, Total: total}, nil
}

// canonicalResolutionIndex is the in-memory view used to resolve names. It is
// rebuilt per request: the library is an informational admin surface, and the
// channel mapping view needs every row at once anyway.
type canonicalResolutionIndex struct {
	rows    map[uint]*CanonicalModelParameter
	byAlias map[string]*ModelParameterAlias
	byKey   map[string]*CanonicalModelParameter
	byName  map[string]*CanonicalModelParameter
	order   []canonicalKeyCandidate
}

type canonicalKeyCandidate struct {
	row  *CanonicalModelParameter
	base string
}

func loadCanonicalResolutionIndex(db *gorm.DB) (*canonicalResolutionIndex, error) {
	var rows []*CanonicalModelParameter
	if err := db.Order("id").Find(&rows).Error; err != nil {
		return nil, err
	}
	var aliases []*ModelParameterAlias
	if err := db.Order("id").Find(&aliases).Error; err != nil {
		return nil, err
	}
	index := &canonicalResolutionIndex{
		rows:    make(map[uint]*CanonicalModelParameter, len(rows)),
		byAlias: make(map[string]*ModelParameterAlias, len(aliases)),
		byKey:   make(map[string]*CanonicalModelParameter),
		byName:  make(map[string]*CanonicalModelParameter),
	}
	for _, row := range rows {
		index.rows[row.Id] = row
	}
	for _, alias := range aliases {
		name := strings.ToLower(strings.TrimSpace(alias.NormalizedName))
		if name == "" {
			continue
		}
		if current, exists := index.byAlias[name]; exists && !aliasBeats(alias, current) {
			continue
		}
		index.byAlias[name] = alias
	}
	for _, row := range rows {
		for _, variant := range canonicalNameVariants(row.CanonicalKey) {
			if _, exists := index.byKey[variant]; !exists {
				index.byKey[variant] = row
			}
		}
		if variant := NormalizeModelName(row.DisplayName); variant != "" {
			if _, exists := index.byName[variant]; !exists {
				index.byName[variant] = row
			}
		}
		index.order = append(index.order, canonicalKeyCandidate{row: row, base: canonicalNameVariants(row.CanonicalKey)[0]})
	}
	return index, nil
}

func canonicalNameVariants(key string) []string {
	full := strings.ToLower(strings.TrimSpace(key))
	if full == "" {
		return nil
	}
	variants := make([]string, 0, 3)
	variants = append(variants, full, stripProviderPrefix(full))
	if stripped := stripModelDecorations(stripProviderPrefix(full)); stripped != "" && stripped != variants[1] {
		variants = append(variants, stripped)
	}
	seen := make(map[string]struct{}, len(variants))
	deduped := make([]string, 0, len(variants))
	for _, variant := range variants {
		if _, ok := seen[variant]; ok {
			continue
		}
		seen[variant] = struct{}{}
		deduped = append(deduped, variant)
	}
	return deduped
}

func aliasBeats(candidate, current *ModelParameterAlias) bool {
	candidateManual := candidate.Origin == aliasOriginManual
	currentManual := current.Origin == aliasOriginManual
	if candidateManual != currentManual {
		return candidateManual
	}
	return candidate.Confidence > current.Confidence
}

func (index *canonicalResolutionIndex) resolve(rawName string) *CanonicalResolution {
	name := NormalizeModelName(rawName)
	if name == "" {
		return nil
	}
	if alias, ok := index.byAlias[name]; ok {
		row := index.rows[alias.CanonicalId]
		if row == nil {
			return nil
		}
		origin := resolutionOriginAuto
		confidence := alias.Confidence
		if alias.Origin == aliasOriginManual {
			origin = resolutionOriginManual
			if confidence < resolutionConfidenceExact {
				confidence = resolutionConfidenceExact
			}
		}
		return &CanonicalResolution{Canonical: row, Origin: origin, Confidence: confidence}
	}
	if row, ok := index.byKey[name]; ok {
		return &CanonicalResolution{Canonical: row, Origin: resolutionOriginAuto, Confidence: resolutionConfidenceExact}
	}
	if row, ok := index.byName[name]; ok {
		return &CanonicalResolution{Canonical: row, Origin: resolutionOriginAuto, Confidence: resolutionConfidenceExact}
	}
	return index.fuzzy(name)
}

func (index *canonicalResolutionIndex) fuzzy(name string) *CanonicalResolution {
	best := (*CanonicalResolution)(nil)
	for _, candidate := range index.order {
		confidence := 0
		switch {
		case hasPrefixAtBoundary(candidate.base, name) || hasPrefixAtBoundary(name, candidate.base):
			confidence = resolutionConfidencePrefix
		case containsAtBoundary(candidate.base, name) || containsAtBoundary(name, candidate.base):
			confidence = resolutionConfidenceContains
		default:
			continue
		}
		if best == nil || resolutionIsBetter(candidate.base, confidence, best.Canonical.CanonicalKey, best.Confidence) {
			best = &CanonicalResolution{Canonical: candidate.row, Origin: resolutionOriginFuzzy, Confidence: confidence}
		}
	}
	return best
}

func resolutionIsBetter(candidateKey string, confidence int, currentKey string, currentConfidence int) bool {
	if confidence != currentConfidence {
		return confidence > currentConfidence
	}
	if len(candidateKey) != len(currentKey) {
		return len(candidateKey) < len(currentKey)
	}
	return candidateKey < currentKey
}

// ResolveCanonical applies the resolution pipeline to one upstream model name:
// explicit alias first, then an exact canonical key or display name, then a
// prefix/suffix/contains fallback with a confidence score.
func ResolveCanonical(rawName string) (*CanonicalResolution, error) {
	index, err := loadCanonicalResolutionIndex(DB)
	if err != nil {
		return nil, err
	}
	return index.resolve(rawName), nil
}

// ChannelModelMapping is one row of the console mapping view: an upstream name
// declared on a channel and the canonical model it resolves to, if any.
type ChannelModelMapping struct {
	ChannelId     int    `json:"channelId"`
	ChannelName   string `json:"channelName"`
	ChannelType   int    `json:"channelType"`
	Model         string `json:"model"`
	DeclaredModel string `json:"declaredModel"`
	Matched       bool   `json:"matched"`
	CanonicalId   uint   `json:"canonicalId"`
	CanonicalKey  string `json:"canonicalKey"`
	DisplayName   string `json:"displayName"`
	Origin        string `json:"origin"`
	Confidence    int    `json:"confidence"`
}

// resolveUpstreamModelName walks a channel's model_mapping chain to resolve a
// declared (local) model name to the final upstream model name. The chain
// semantics mirror relay/helper/model_mapped.go ModelMappedHelper exactly;
// keep that file in sync when changing this logic. The model package MUST NOT
// import relay/* (circular dependency), so the logic is replicated here.
//
// Returns (upstream, mapped). When the declared name has no mapping entry,
// returns (origin, false). On a self-loop at the origin, returns (origin,
// false). On a self-loop elsewhere in the chain, returns the current model
// and true. On a longer cycle, returns (origin, false) so the row still
// renders.
func resolveUpstreamModelName(modelMap map[string]string, origin string) (string, bool) {
	if len(modelMap) == 0 {
		return origin, false
	}
	currentModel := origin
	visitedModels := map[string]bool{currentModel: true}
	for {
		mappedModel, exists := modelMap[currentModel]
		baseModel := settingreasoning.BaseModelName(currentModel)
		if (!exists || mappedModel == "") && baseModel != currentModel {
			mappedModel, exists = modelMap[baseModel]
		}
		if exists && mappedModel != "" {
			if visitedModels[mappedModel] {
				if mappedModel == currentModel {
					if currentModel == origin {
						return origin, false
					}
					return currentModel, true
				}
				// Longer cycle: treat as not mapped for this row.
				return origin, false
			}
			visitedModels[mappedModel] = true
			currentModel = mappedModel
		} else {
			break
		}
	}
	if currentModel == origin {
		return origin, false
	}
	return currentModel, true
}

// ChannelModelMappingPageResult is the envelope body of the mapping endpoint.
type ChannelModelMappingPageResult struct {
	Items []*ChannelModelMapping `json:"items"`
	Total int64                  `json:"total"`
}

// BuildChannelModelMappings materializes the (channel, upstream model) ->
// canonical view by reading every channel's model list and resolving each name.
func BuildChannelModelMappings(keyword, status string, page, pageSize int) (*ChannelModelMappingPageResult, error) {
	index, err := loadCanonicalResolutionIndex(DB)
	if err != nil {
		return nil, err
	}
	var channels []Channel
	if err := DB.Select("id", "name", "type", "models", "model_mapping").Order("id").Find(&channels).Error; err != nil {
		return nil, err
	}
	items := make([]*ChannelModelMapping, 0, len(channels)*2)
	for _, channel := range channels {
		modelMap := parseChannelModelMapping(channel.GetModelMapping())
		for _, declared := range channel.GetModels() {
			declaredName := strings.TrimSpace(declared)
			if declaredName == "" {
				continue
			}
			upstreamName, _ := resolveUpstreamModelName(modelMap, declaredName)
			item := &ChannelModelMapping{
				ChannelId:     channel.Id,
				ChannelName:   channel.Name,
				ChannelType:   channel.Type,
				Model:         upstreamName,
				DeclaredModel: declaredName,
			}
			if resolution := index.resolve(upstreamName); resolution.IsMatched() {
				item.Matched = true
				item.CanonicalId = resolution.Canonical.Id
				item.CanonicalKey = resolution.Canonical.CanonicalKey
				item.DisplayName = resolution.Canonical.DisplayName
				item.Origin = resolution.Origin
				item.Confidence = resolution.Confidence
			}
			items = append(items, item)
		}
	}
	if keyword := strings.TrimSpace(keyword); keyword != "" {
		lowerKeyword := strings.ToLower(keyword)
		filtered := make([]*ChannelModelMapping, 0, len(items))
		for _, item := range items {
			if strings.Contains(strings.ToLower(item.Model), lowerKeyword) ||
				strings.Contains(strings.ToLower(item.ChannelName), lowerKeyword) ||
				strings.Contains(strings.ToLower(item.DeclaredModel), lowerKeyword) {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}
	byStatus := func(item *ChannelModelMapping) bool {
		switch strings.ToLower(strings.TrimSpace(status)) {
		case "", "all":
			return true
		case "matched":
			return item.Matched
		case "unmatched":
			return !item.Matched
		default:
			return true
		}
	}
	items = slices.DeleteFunc(items, func(item *ChannelModelMapping) bool { return !byStatus(item) })
	slices.SortFunc(items, func(a, b *ChannelModelMapping) int {
		if a.ChannelId != b.ChannelId {
			return int(a.ChannelId) - int(b.ChannelId)
		}
		if a.Model != b.Model {
			return strings.Compare(a.Model, b.Model)
		}
		return 0
	})
	total := int64(len(items))
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 50
	}
	if pageSize > 500 {
		pageSize = 500
	}
	start := (page - 1) * pageSize
	if start > len(items) {
		start = len(items)
	}
	end := start + pageSize
	if end > len(items) {
		end = len(items)
	}
	return &ChannelModelMappingPageResult{Items: items[start:end], Total: total}, nil
}

// parseChannelModelMapping unmarshals a channel's model_mapping JSON string into
// a map[string]string. Returns nil on empty or malformed input.
func parseChannelModelMapping(mappingJSON string) map[string]string {
	mappingJSON = strings.TrimSpace(mappingJSON)
	if mappingJSON == "" || mappingJSON == "{}" {
		return nil
	}
	var modelMap map[string]string
	if err := common.Unmarshal([]byte(mappingJSON), &modelMap); err != nil {
		return nil
	}
	return modelMap
}

// ModelOverviewChannel identifies a channel that declares an upstream model in
// the overview: enough to label and filter a row without exposing secrets.
type ModelOverviewChannel struct {
	Id   int    `json:"id"`
	Name string `json:"name"`
	Type int    `json:"type"`
}

// ModelOverviewItem is one row of the aggregated overview view: a distinct
// upstream model name with its canonical match (if any), the declared names
// that resolved to it, and the channels that declare it.
type ModelOverviewItem struct {
	Model           string                 `json:"model"`
	DeclaredModels  []string               `json:"declaredModels"`
	Channels        []ModelOverviewChannel `json:"channels"`
	Matched         bool                   `json:"matched"`
	CanonicalId     uint                   `json:"canonicalId"`
	CanonicalKey    string                 `json:"canonicalKey"`
	DisplayName     string                 `json:"displayName"`
	ContextLength   int                    `json:"contextLength"`
	MaxOutputTokens int                    `json:"maxOutputTokens"`
	Capabilities    []string               `json:"capabilities"`
	Origin          string                 `json:"origin"`
	Confidence      int                    `json:"confidence"`
}

// ModelOverviewResult is the envelope body of the overview endpoint. Channels
// lists every channel that declares at least one model, so the console can
// build a channel filter whose options stay stable across other filters.
type ModelOverviewResult struct {
	Items    []ModelOverviewItem    `json:"items"`
	Total    int                    `json:"total"`
	Channels []ModelOverviewChannel `json:"channels"`
}

// BuildChannelModelOverview aggregates distinct upstream model names across all
// channels, each with its canonical match status and the declared names that
// resolved to it. When channelId > 0 only models declared by that channel are
// kept; the returned channel list always covers every declaring channel.
func BuildChannelModelOverview(keyword, capability string, channelId int, sort, order string, page, pageSize int) (*ModelOverviewResult, error) {
	index, err := loadCanonicalResolutionIndex(DB)
	if err != nil {
		return nil, err
	}
	var channels []Channel
	if err := DB.Select("id", "name", "type", "models", "model_mapping").Order("id").Find(&channels).Error; err != nil {
		return nil, err
	}
	type overviewAgg struct {
		model          string
		declaredModels map[string]struct{}
		channels       map[int]ModelOverviewChannel
		resolution     *CanonicalResolution
	}
	aggMap := make(map[string]*overviewAgg)
	allChannels := make(map[int]ModelOverviewChannel)
	for _, channel := range channels {
		channelBrief := ModelOverviewChannel{Id: channel.Id, Name: channel.Name, Type: channel.Type}
		modelMap := parseChannelModelMapping(channel.GetModelMapping())
		for _, declared := range channel.GetModels() {
			declaredName := strings.TrimSpace(declared)
			if declaredName == "" {
				continue
			}
			upstreamName, _ := resolveUpstreamModelName(modelMap, declaredName)
			if upstreamName == "" {
				continue
			}
			agg, exists := aggMap[upstreamName]
			if !exists {
				agg = &overviewAgg{
					model:          upstreamName,
					declaredModels: make(map[string]struct{}),
					channels:       make(map[int]ModelOverviewChannel),
				}
				aggMap[upstreamName] = agg
			}
			agg.declaredModels[declaredName] = struct{}{}
			agg.channels[channel.Id] = channelBrief
			allChannels[channel.Id] = channelBrief
		}
	}
	overviewChannels := sortedOverviewChannels(allChannels)

	// Build items with canonical resolution.
	items := make([]ModelOverviewItem, 0, len(aggMap))
	for _, agg := range aggMap {
		declaredList := make([]string, 0, len(agg.declaredModels))
		for name := range agg.declaredModels {
			declaredList = append(declaredList, name)
		}
		slices.Sort(declaredList)

		item := ModelOverviewItem{
			Model:          agg.model,
			DeclaredModels: declaredList,
			Channels:       sortedOverviewChannels(agg.channels),
			Capabilities:   []string{},
		}
		if resolution := index.resolve(agg.model); resolution.IsMatched() {
			item.Matched = true
			item.CanonicalId = resolution.Canonical.Id
			item.CanonicalKey = resolution.Canonical.CanonicalKey
			item.DisplayName = resolution.Canonical.DisplayName
			item.ContextLength = resolution.Canonical.ContextLength
			item.MaxOutputTokens = resolution.Canonical.MaxOutputTokens
			item.Origin = resolution.Origin
			item.Confidence = resolution.Confidence
			item.Capabilities = canonicalCapabilities(resolution.Canonical)
		}
		items = append(items, item)
	}

	// Keyword filter: case-insensitive substring on upstream model or any declared model.
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		lowerKeyword := strings.ToLower(keyword)
		filtered := make([]ModelOverviewItem, 0, len(items))
		for _, item := range items {
			if strings.Contains(strings.ToLower(item.Model), lowerKeyword) {
				filtered = append(filtered, item)
				continue
			}
			for _, dm := range item.DeclaredModels {
				if strings.Contains(strings.ToLower(dm), lowerKeyword) {
					filtered = append(filtered, item)
					break
				}
			}
		}
		items = filtered
	}

	// Capability filter: keep only matched rows whose canonical row satisfies it.
	if cap := strings.TrimSpace(capability); cap != "" {
		switch strings.ToLower(cap) {
		case "reasoning", "vision", "tool_call", "structured_output":
			filtered := make([]ModelOverviewItem, 0, len(items))
			for _, item := range items {
				if item.Matched {
					row := index.rows[item.CanonicalId]
					if row != nil && row.HasCapability(cap) {
						filtered = append(filtered, item)
					}
				}
			}
			items = filtered
		}
	}

	// Channel filter: keep only rows declared by the given channel.
	if channelId > 0 {
		filtered := make([]ModelOverviewItem, 0, len(items))
		for _, item := range items {
			for _, channel := range item.Channels {
				if channel.Id == channelId {
					filtered = append(filtered, item)
					break
				}
			}
		}
		items = filtered
	}

	// Sort: unmatched rows always after matched rows, regardless of order.
	desc := strings.ToLower(strings.TrimSpace(order)) == "desc"
	sortField := strings.ToLower(strings.TrimSpace(sort))
	slices.SortFunc(items, func(a, b ModelOverviewItem) int {
		// Matched rows sort before unmatched.
		if a.Matched != b.Matched {
			if a.Matched {
				return -1
			}
			return 1
		}
		var cmp int
		switch sortField {
		case "context":
			cmp = a.ContextLength - b.ContextLength
		case "output":
			cmp = a.MaxOutputTokens - b.MaxOutputTokens
		default: // "name" or anything else
			cmp = strings.Compare(strings.ToLower(a.Model), strings.ToLower(b.Model))
		}
		if desc {
			cmp = -cmp
		}
		return cmp
	})

	total := len(items)
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 50
	}
	if pageSize > 200 {
		pageSize = 200
	}
	start := (page - 1) * pageSize
	if start > len(items) {
		start = len(items)
	}
	end := start + pageSize
	if end > len(items) {
		end = len(items)
	}
	return &ModelOverviewResult{Items: items[start:end], Total: total, Channels: overviewChannels}, nil
}

// sortedOverviewChannels orders the channel briefs of an overview aggregation by
// channel id for stable output and deterministic JSON.
func sortedOverviewChannels(channels map[int]ModelOverviewChannel) []ModelOverviewChannel {
	result := make([]ModelOverviewChannel, 0, len(channels))
	for _, channel := range channels {
		result = append(result, channel)
	}
	slices.SortFunc(result, func(a, b ModelOverviewChannel) int { return a.Id - b.Id })
	return result
}

// canonicalCapabilities returns the list of capability keys a canonical row
// satisfies. It always returns a non-nil slice so the overview JSON emits
// [] (never null) for rows with no capabilities; the frontend relies on this.
func canonicalCapabilities(row *CanonicalModelParameter) []string {
	if row == nil {
		return []string{}
	}
	caps := make([]string, 0, 4)
	for _, cap := range []string{"reasoning", "vision", "tool_call", "structured_output"} {
		if row.HasCapability(cap) {
			caps = append(caps, cap)
		}
	}
	return caps
}
