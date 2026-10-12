package model_parameter_source

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const modelsDevURLEnv = "MODEL_PARAMETER_SOURCE_MODELS_DEV_URL"

type modelsDevSource struct{}

func (modelsDevSource) Name() string        { return NameModelsDev }
func (modelsDevSource) Description() string { return "models.dev model capability catalog" }
func (modelsDevSource) Enabled() bool       { return true }

func (modelsDevSource) baseURL() string {
	return common.GetEnvOrDefaultString(modelsDevURLEnv, defaultModelsDevURL)
}

func (modelsDevSource) Fetch(ctx context.Context) ([]*SourceModel, error) {
	var envelope map[string]any
	if err := fetchJSON(ctx, modelsDevSource{}.baseURL(), &envelope); err != nil {
		return nil, err
	}
	vendors := parseObject(envelope["models"])
	if vendors == nil {
		vendors = envelope
	}
	byCanonical := make(map[string]*modelsDevGroup)
	for vendor, vendorValue := range vendors {
		vendorObject := parseObject(vendorValue)
		entries := parseObject(vendorObject["models"])
		if entries == nil {
			entries = vendorObject
		}
		for entryID, entryValue := range entries {
			entry := parseObject(entryValue)
			if entry == nil {
				continue
			}
			group := groupModelsDevEntry(byCanonical, strings.ToLower(strings.TrimSpace(vendor)), entryID, entry)
			group.entries = append(group.entries, modelsDevEntry{modelID: entryID, entry: entry})
		}
	}
	return collectModelsDevSources(byCanonical), nil
}

type modelsDevEntry struct {
	modelID string
	entry   map[string]any
}

type modelsDevGroup struct {
	canonicalKey string
	sourceID     string
	models       []*SourceModel
	entries      []modelsDevEntry
}

func groupModelsDevEntry(byCanonical map[string]*modelsDevGroup, vendor, entryID string, entry map[string]any) *modelsDevGroup {
	id := parseString(entry["id"])
	if id == "" {
		id = entryID
	}
	canonicalKey := strings.ToLower(strings.TrimSpace(parseString(entry["canonical_model_id"])))
	if canonicalKey == "" {
		canonicalKey = strings.ToLower(strings.TrimSpace(id))
	}
	if canonicalKey == "" {
		canonicalKey = strings.ToLower(fmt.Sprintf("%s/%s", vendor, entryID))
	}
	group, ok := byCanonical[canonicalKey]
	if ok {
		return group
	}
	group = &modelsDevGroup{canonicalKey: canonicalKey, sourceID: id}
	byCanonical[canonicalKey] = group
	return group
}

func collectModelsDevSources(byCanonical map[string]*modelsDevGroup) []*SourceModel {
	sources := make([]*SourceModel, 0, len(byCanonical))
	for _, group := range byCanonical {
		for _, entry := range group.entries {
			group.addEntry(entry)
		}
		sources = append(sources, group.build(group.canonicalKey, group.sourceID))
	}
	sort.Slice(sources, func(i, j int) bool { return sources[i].CanonicalKey < sources[j].CanonicalKey })
	return sources
}

func (group *modelsDevGroup) addEntry(entry modelsDevEntry) {
	model := group.firstModel()
	if model == nil {
		model = &SourceModel{CanonicalKey: group.canonicalKey, SourceId: group.sourceID}
		group.models = append(group.models, model)
	}
	limit := parseNested(entry.entry, "limit")
	if limit != nil {
		if contextLength, ok := parseNumber(limit["context"]); ok {
			model.ContextLength = int(contextLength)
		}
		if output, ok := parseNumber(limit["output"]); ok {
			model.MaxOutputTokens = int(output)
		}
	}
	modalities := parseNested(entry.entry, "modalities")
	if modalities != nil {
		if model.InputModalities == nil {
			model.InputModalities = parseStringSlice(modalities["input"])
		}
		if model.OutputModalities == nil {
			model.OutputModalities = parseStringSlice(modalities["output"])
		}
	}
	if model.DisplayName == "" {
		model.DisplayName = parseString(entry.entry["name"])
	}
	if model.Reasoning == nil {
		model.Reasoning = parseBoolish(entry.entry["reasoning"])
	}
	model.ReasoningEfforts = mergeStrings(model.ReasoningEfforts, modelsDevReasoningEfforts(entry.entry))
	if model.ToolCall == nil {
		model.ToolCall = parseBoolish(entry.entry["tool_call"])
	}
	if model.StructuredOutput == nil {
		model.StructuredOutput = parseBoolish(entry.entry["structured_output"])
	}
	if model.Attachment == nil {
		model.Attachment = parseBoolish(entry.entry["attachment"])
	}
	if model.KnowledgeCutoff == "" {
		model.KnowledgeCutoff = parseString(entry.entry["knowledge"])
	}
	if model.ReleaseDate == "" {
		model.ReleaseDate = parseString(entry.entry["release_date"])
	}
	if model.ParameterCount == "" {
		model.ParameterCount = parseString(entry.entry["parameter_count"])
	}
	model.Tags = mergeStrings(model.Tags, parseStringSlice(entry.entry["tags"]))
	if model.Extra == "" {
		model.Extra = rawOf(entry.entry)
	}
}

func (group *modelsDevGroup) firstModel() *SourceModel {
	if len(group.models) == 0 {
		return nil
	}
	return group.models[0]
}

func (group *modelsDevGroup) build(canonicalKey, sourceID string) *SourceModel {
	model := group.firstModel()
	if model == nil {
		model = &SourceModel{}
	}
	model.CanonicalKey = canonicalKey
	if model.DisplayName == "" {
		model.DisplayName = canonicalKey
	}
	if model.SourceId == "" {
		model.SourceId = sourceID
	}
	if model.Vendor == "" {
		model.Vendor = vendorOfCanonicalKey(canonicalKey)
	}
	for _, entry := range group.entries {
		name := parseString(entry.entry["id"])
		if name == "" {
			name = entry.modelID
		}
		if name == "" {
			continue
		}
		model.Aliases = append(model.Aliases, AliasCandidate{Name: name, Confidence: AliasConfidenceCanonical})
	}
	sort.Slice(model.Aliases, func(i, j int) bool { return model.Aliases[i].Name < model.Aliases[j].Name })
	return model
}

func modelsDevReasoningEfforts(entry map[string]any) []string {
	options := parseStringSliceNil(entry["reasoning_options"])
	efforts := make([]string, 0, len(options))
	for _, option := range options {
		details := parseObject(option)
		if details == nil {
			continue
		}
		if strings.ToLower(parseString(details["type"])) != "effort" {
			continue
		}
		efforts = append(efforts, parseStringSlice(details["values"])...)
	}
	return dedupeStrings(efforts)
}

func vendorOfCanonicalKey(key string) string {
	if _, vendor, found := strings.Cut(key, "/"); found && vendor != "" {
		return vendor
	}
	return ""
}

func parseStringSliceNil(value any) []map[string]any {
	list, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]map[string]any, 0, len(list))
	for _, item := range list {
		if object := parseObject(item); object != nil {
			result = append(result, object)
		}
	}
	return result
}

func mergeStrings(base, extra []string) []string {
	if len(base) == 0 {
		return extra
	}
	if len(extra) == 0 {
		return base
	}
	seen := make(map[string]struct{}, len(base))
	for _, value := range base {
		seen[value] = struct{}{}
	}
	merged := append([]string(nil), base...)
	for _, value := range extra {
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		merged = append(merged, value)
	}
	return merged
}

func dedupeStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		key := strings.ToLower(strings.TrimSpace(value))
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, value)
	}
	if len(result) == 0 {
		return nil
	}
	return result
}
