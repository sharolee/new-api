package model

import (
	"context"
	"testing"

	"github.com/QuantumNous/new-api/common"
	modelparametersource "github.com/QuantumNous/new-api/service/model_parameter_source"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupModelParameterTest(t *testing.T) {
	t.Helper()
	originalDB := DB
	t.Cleanup(func() { DB = originalDB })
	var err error
	DB, err = gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, DB.AutoMigrate(&CanonicalModelParameter{}, &ModelParameterAlias{}))
}

func TestNormalizeModelName(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "provider prefix stripped",
			input:    "openai/gpt-4o",
			expected: "gpt-4o",
		},
		{
			name:     "provider prefix with multiple slashes",
			input:    "github/owner/repo/model",
			expected: "model",
		},
		{
			name:     "reasoning modifier stripped via BaseModelName",
			input:    "gpt-4o-high",
			expected: "gpt-4o",
		},
		{
			name:     "deepseek reasoning modifier stripped",
			input:    "deepseek-v4-thinking",
			expected: "deepseek-v4",
		},
		{
			name:     "gemini thinking modifier stripped",
			input:    "gemini-2.5-flash-thinking",
			expected: "gemini-2.5-flash",
		},
		{
			name:     "decorations stripped - nothinking",
			input:    "my-model-nothinking",
			expected: "my-model",
		},
		{
			name:     "decorations stripped - non-thinking (order-dependent: -thinking strips first)",
			input:    "my-model-non-thinking",
			expected: "my-model-non",
		},
		{
			name:     "decorations stripped - latest",
			input:    "my-model-latest",
			expected: "my-model",
		},
		{
			name:     "decorations stripped - preview",
			input:    "my-model-preview",
			expected: "my-model",
		},
		{
			name:     "decorations stripped - chat",
			input:    "my-model-chat",
			expected: "my-model",
		},
		{
			name:     "date stamp YYYY-MM-DD stripped",
			input:    "my-model-2024-01-15",
			expected: "my-model",
		},
		{
			name:     "date stamp YYYYMMDD stripped",
			input:    "my-model-20240115",
			expected: "my-model",
		},
		{
			name:     "version suffix @ stripped",
			input:    "my-model@v1.2.3",
			expected: "my-model",
		},
		{
			name:     "case insensitive normalization",
			input:    "OPENAI/GPT-4O-HIGH",
			expected: "gpt-4o",
		},
		{
			name:     "whitespace trimmed",
			input:    "  gpt-4o  ",
			expected: "gpt-4o",
		},
		{
			name:     "empty string returns empty",
			input:    "",
			expected: "",
		},
		{
			name:     "only whitespace returns empty",
			input:    "   ",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := NormalizeModelName(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestResolutionPrecedence(t *testing.T) {
	setupModelParameterTest(t)

	c1 := &CanonicalModelParameter{
		CanonicalKey: "gpt-4o",
		DisplayName:  "GPT-4o",
		Vendor:       "openai",
	}
	require.NoError(t, CreateCanonicalModel(c1))

	c2 := &CanonicalModelParameter{
		CanonicalKey: "claude-3-5-sonnet",
		DisplayName:  "Claude 3.5 Sonnet",
		Vendor:       "anthropic",
	}
	require.NoError(t, CreateCanonicalModel(c2))

	// Manual alias for "gpt-4-turbo" -> c1
	_, err := UpsertManualAlias("gpt-4-turbo", c1.Id)
	require.NoError(t, err)

	// Auto alias: "claude-3-opus" -> c2
	autoAlias := &ModelParameterAlias{
		NormalizedName: "claude-3-opus",
		RawName:        "claude-3-opus",
		CanonicalId:    c2.Id,
		Origin:         aliasOriginAuto,
		Confidence:     resolutionConfidenceExact,
		CreatedTime:    common.GetTimestamp(),
		UpdatedTime:    common.GetTimestamp(),
	}
	require.NoError(t, DB.Create(autoAlias).Error)

	tests := []struct {
		name           string
		rawName        string
		expectedKey    string
		expectedOrigin string
		matched        bool
	}{
		{
			name:           "manual alias beats everything",
			rawName:        "gpt-4-turbo",
			expectedKey:    "gpt-4o",
			expectedOrigin: resolutionOriginManual,
			matched:        true,
		},
		{
			name:           "exact canonical key match",
			rawName:        "gpt-4o",
			expectedKey:    "gpt-4o",
			expectedOrigin: resolutionOriginAuto,
			matched:        true,
		},
		{
			name:           "auto alias exact match",
			rawName:        "claude-3-opus",
			expectedKey:    "claude-3-5-sonnet",
			expectedOrigin: resolutionOriginAuto,
			matched:        true,
		},
		{
			name:           "display name match after normalization",
			rawName:        "Claude 3.5 Sonnet",
			expectedKey:    "claude-3-5-sonnet",
			expectedOrigin: resolutionOriginAuto,
			matched:        true,
		},
		{
			name:    "unmatched when nothing matches",
			rawName: "unknown-model-xyz",
			matched: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res, err := ResolveCanonical(tt.rawName)
			require.NoError(t, err)
			if tt.matched {
				require.NotNil(t, res)
				assert.True(t, res.IsMatched())
				assert.Equal(t, tt.expectedKey, res.Canonical.CanonicalKey)
				assert.Equal(t, tt.expectedOrigin, res.Origin)
			} else {
				if res == nil || !res.IsMatched() {
					return
				}
				assert.Fail(t, "expected unmatched but got match", "got: %s", res.Canonical.CanonicalKey)
			}
		})
	}
}

func TestCreateCanonicalModelDuplicateKeyRejection(t *testing.T) {
	setupModelParameterTest(t)

	c1 := &CanonicalModelParameter{
		CanonicalKey: "gpt-4o",
		DisplayName:  "GPT-4o",
		Vendor:       "openai",
	}
	require.NoError(t, CreateCanonicalModel(c1))

	c2 := &CanonicalModelParameter{
		CanonicalKey: "gpt-4o",
		DisplayName:  "GPT-4o Duplicate",
		Vendor:       "openai",
	}
	err := CreateCanonicalModel(c2)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "canonical key already exists")

	assert.True(t, c1.IsManual())
	assert.NotNil(t, c1.ManualOverride)
	assert.True(t, *c1.ManualOverride)
}

// stubSyncSource implements modelparametersource.Source for testing.
type stubSyncSource struct {
	name   string
	models []*modelparametersource.SourceModel
}

func (s *stubSyncSource) Name() string        { return s.name }
func (s *stubSyncSource) Description() string { return "stub source" }
func (s *stubSyncSource) Enabled() bool       { return true }
func (s *stubSyncSource) Fetch(_ context.Context) ([]*modelparametersource.SourceModel, error) {
	return s.models, nil
}

func TestSyncModelParametersDryRunPersistsNothing(t *testing.T) {
	setupModelParameterTest(t)

	// Pre-create a manual canonical model that should be skipped by sync.
	manual := &CanonicalModelParameter{
		CanonicalKey: "manual-model",
		DisplayName:  "Manual Model",
		Vendor:       "test",
	}
	require.NoError(t, CreateCanonicalModel(manual))

	stub := &stubSyncSource{
		name: "testsource",
		models: []*modelparametersource.SourceModel{
			{
				CanonicalKey: "manual-model", // should be skipped (manual override)
				DisplayName:  "Manual Model Updated",
				Vendor:       "test",
			},
			{
				CanonicalKey: "new-model",
				DisplayName:  "New Model",
				Vendor:       "test",
			},
		},
	}

	lookup := func(name string) (modelparametersource.Source, error) {
		if name == "testsource" {
			return stub, nil
		}
		return nil, assert.AnError
	}

	result, err := syncModelParameters([]string{"testsource"}, true, lookup)
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.DryRun)
	require.Equal(t, 1, len(result.Results))

	sr := result.Results[0]
	assert.Equal(t, "testsource", sr.Source)
	assert.True(t, sr.Success)
	assert.Equal(t, 1, sr.Created, "dry run reports what would be created")
	assert.Equal(t, 0, sr.Updated, "dry run should not count updates")
	assert.Equal(t, 1, sr.Skipped, "manual model should be skipped")

	// Verify nothing was persisted.
	var count int64
	require.NoError(t, DB.Model(&CanonicalModelParameter{}).Where("canonical_key = ?", "new-model").Count(&count).Error)
	assert.Zero(t, count, "dry run must not persist new-model")

	// Verify the manual model was not overwritten.
	var stored CanonicalModelParameter
	require.NoError(t, DB.Where("canonical_key = ?", "manual-model").First(&stored).Error)
	assert.Equal(t, "Manual Model", stored.DisplayName, "manual model must not be overwritten")
	assert.True(t, stored.IsManual())
}

func TestSyncModelParametersPerSourceErrorIsolation(t *testing.T) {
	setupModelParameterTest(t)

	goodSource := &stubSyncSource{
		name: "good",
		models: []*modelparametersource.SourceModel{
			{CanonicalKey: "model-a", DisplayName: "Model A", Vendor: "test", SourceId: "src-a"},
		},
	}

	lookup := func(name string) (modelparametersource.Source, error) {
		switch name {
		case "good":
			return goodSource, nil
		case "bad":
			return nil, assert.AnError
		}
		return nil, assert.AnError
	}

	result, err := syncModelParameters([]string{"good", "bad"}, false, lookup)
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.False(t, result.DryRun)
	require.Equal(t, 2, len(result.Results))

	var goodResult, badResult SourceSyncResult
	for _, sr := range result.Results {
		switch sr.Source {
		case "good":
			goodResult = sr
		case "bad":
			badResult = sr
		}
	}
	assert.True(t, goodResult.Success, "good source should succeed")
	assert.Equal(t, 1, goodResult.Created)
	assert.False(t, badResult.Success, "bad source should fail")
	assert.NotEmpty(t, badResult.Error)

	// The synced row must record the source it came from, and both the
	// source-id lookup and the source filter must be able to find it.
	var stored CanonicalModelParameter
	require.NoError(t, DB.Where("canonical_key = ?", "model-a").First(&stored).Error)
	assert.Equal(t, "good", stored.Source, "synced row must record its source")
	assert.Equal(t, "src-a", stored.SourceId, "synced row must record its source id")
	bySource, err := GetCanonicalModelBySourceId("good", "src-a")
	require.NoError(t, err)
	assert.Equal(t, stored.Id, bySource.Id)
	rows, total, err := SearchCanonicalModels(CanonicalModelFilter{Source: "good"})
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, rows, 1)
	assert.Equal(t, "model-a", rows[0].CanonicalKey)
}

func setupChannelModelMappingTest(t *testing.T) {
	t.Helper()
	originalDB := DB
	t.Cleanup(func() { DB = originalDB })
	var err error
	DB, err = gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, DB.AutoMigrate(&CanonicalModelParameter{}, &ModelParameterAlias{}, &Channel{}))
}

func TestResolveUpstreamModelName(t *testing.T) {
	tests := []struct {
		name       string
		modelMap   map[string]string
		origin     string
		wantUp     string
		wantMapped bool
	}{
		{
			name:       "nil map returns origin unmapped",
			modelMap:   nil,
			origin:     "gpt-4o",
			wantUp:     "gpt-4o",
			wantMapped: false,
		},
		{
			name:       "empty map returns origin unmapped",
			modelMap:   map[string]string{},
			origin:     "gpt-4o",
			wantUp:     "gpt-4o",
			wantMapped: false,
		},
		{
			name:       "no mapping entry returns origin unmapped",
			modelMap:   map[string]string{"other": "gpt-4o"},
			origin:     "gpt-4o",
			wantUp:     "gpt-4o",
			wantMapped: false,
		},
		{
			name:       "simple alias resolves to upstream",
			modelMap:   map[string]string{"freespeed": "gpt-5"},
			origin:     "freespeed",
			wantUp:     "gpt-5",
			wantMapped: true,
		},
		{
			name:       "self-loop at origin returns unmapped",
			modelMap:   map[string]string{"gpt-4o": "gpt-4o"},
			origin:     "gpt-4o",
			wantUp:     "gpt-4o",
			wantMapped: false,
		},
		{
			name:       "self-loop mid-chain returns mapped",
			modelMap:   map[string]string{"a": "b", "b": "b"},
			origin:     "a",
			wantUp:     "b",
			wantMapped: true,
		},
		{
			name:       "longer cycle returns origin unmapped",
			modelMap:   map[string]string{"a": "b", "b": "c", "c": "a"},
			origin:     "a",
			wantUp:     "a",
			wantMapped: false,
		},
		{
			name:       "chain resolves to tail",
			modelMap:   map[string]string{"a": "b", "b": "c"},
			origin:     "a",
			wantUp:     "c",
			wantMapped: true,
		},
		{
			name:       "base name fallback resolves",
			modelMap:   map[string]string{"gpt-4o": "gpt-4o-preview"},
			origin:     "gpt-4o-high",
			wantUp:     "gpt-4o-preview",
			wantMapped: true,
		},
		{
			name:       "base name fallback not found returns origin unmapped",
			modelMap:   map[string]string{"other": "gpt-4o"},
			origin:     "gpt-4o-high",
			wantUp:     "gpt-4o-high",
			wantMapped: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			up, mapped := resolveUpstreamModelName(tt.modelMap, tt.origin)
			assert.Equal(t, tt.wantUp, up)
			assert.Equal(t, tt.wantMapped, mapped)
		})
	}
}

func TestBuildChannelModelMappingsWithModelMapping(t *testing.T) {
	setupChannelModelMappingTest(t)

	// Canonical model that the upstream name should match.
	canon := &CanonicalModelParameter{
		CanonicalKey: "gpt-5",
		DisplayName:  "GPT-5",
		Vendor:       "openai",
	}
	require.NoError(t, CreateCanonicalModel(canon))

	// Channel with a model_mapping: "freespeed" -> "gpt-5".
	mappingJSON := `{"freespeed":"gpt-5"}`
	ch := &Channel{
		Id:           1,
		Name:         "test-channel",
		Type:         1,
		Models:       "freespeed,gpt-5",
		ModelMapping: &mappingJSON,
	}
	require.NoError(t, DB.Create(ch).Error)

	result, err := BuildChannelModelMappings("", "", 1, 50)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, int64(2), result.Total)

	// Find the freespeed row.
	var freespeedRow *ChannelModelMapping
	for _, item := range result.Items {
		if item.DeclaredModel == "freespeed" {
			freespeedRow = item
		}
	}
	require.NotNil(t, freespeedRow, "freespeed row should exist")
	assert.Equal(t, "gpt-5", freespeedRow.Model, "upstream model must be gpt-5")
	assert.Equal(t, "freespeed", freespeedRow.DeclaredModel, "declared model must be freespeed")
	assert.True(t, freespeedRow.Matched, "freespeed -> gpt-5 must match canonical")
	assert.Equal(t, "gpt-5", freespeedRow.CanonicalKey)

	// Find the gpt-5 row (no mapping, upstream == declared).
	var gpt5Row *ChannelModelMapping
	for _, item := range result.Items {
		if item.DeclaredModel == "gpt-5" {
			gpt5Row = item
		}
	}
	require.NotNil(t, gpt5Row, "gpt-5 row should exist")
	assert.Equal(t, "gpt-5", gpt5Row.Model)
	assert.Equal(t, "gpt-5", gpt5Row.DeclaredModel)
	assert.True(t, gpt5Row.Matched)
}

func TestBuildChannelModelMappingsKeywordFilter(t *testing.T) {
	setupChannelModelMappingTest(t)

	mappingJSON := `{"freespeed":"gpt-5"}`
	ch := &Channel{
		Id:           1,
		Name:         "provider-a",
		Type:         1,
		Models:       "freespeed,unknown-model",
		ModelMapping: &mappingJSON,
	}
	require.NoError(t, DB.Create(ch).Error)

	// Keyword "gpt" matches the upstream name of freespeed.
	result, err := BuildChannelModelMappings("gpt", "", 1, 50)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, int64(1), result.Total)
	assert.Equal(t, "freespeed", result.Items[0].DeclaredModel)
	assert.Equal(t, "gpt-5", result.Items[0].Model)

	// Keyword "freespeed" matches the declared name.
	result, err = BuildChannelModelMappings("freespeed", "", 1, 50)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, int64(1), result.Total)
	assert.Equal(t, "freespeed", result.Items[0].DeclaredModel)

	// Keyword "provider" matches the channel name.
	result, err = BuildChannelModelMappings("provider", "", 1, 50)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, int64(2), result.Total)
}

func TestBuildChannelModelOverviewDedup(t *testing.T) {
	setupChannelModelMappingTest(t)

	reasoningTrue := true
	toolCallTrue := true
	canon := &CanonicalModelParameter{
		CanonicalKey:    "gpt-5",
		DisplayName:     "GPT-5",
		Vendor:          "openai",
		ContextLength:   128000,
		MaxOutputTokens: 16384,
		Reasoning:       &reasoningTrue,
		ToolCall:        &toolCallTrue,
	}
	require.NoError(t, CreateCanonicalModel(canon))

	// Channel 1: freespeed -> gpt-5, plus gpt-5 directly.
	mappingJSON1 := `{"freespeed":"gpt-5"}`
	ch1 := &Channel{
		Id:           1,
		Name:         "ch1",
		Type:         1,
		Models:       "freespeed,gpt-5",
		ModelMapping: &mappingJSON1,
	}
	require.NoError(t, DB.Create(ch1).Error)

	// Channel 2: fastspeed -> gpt-5 (same upstream, different declared).
	mappingJSON2 := `{"fastspeed":"gpt-5"}`
	ch2 := &Channel{
		Id:           2,
		Name:         "ch2",
		Type:         1,
		Models:       "fastspeed,unknown-model",
		ModelMapping: &mappingJSON2,
	}
	require.NoError(t, DB.Create(ch2).Error)

	result, err := BuildChannelModelOverview("", "", "", "", 1, 50)
	require.NoError(t, err)
	require.NotNil(t, result)

	// gpt-5 (matched, from ch1 freespeed + ch1 gpt-5 + ch2 fastspeed)
	// unknown-model (unmatched, from ch2)
	require.Equal(t, 2, result.Total)

	// Find the matched gpt-5 row.
	var gpt5Item *ModelOverviewItem
	for i := range result.Items {
		if result.Items[i].Model == "gpt-5" {
			gpt5Item = &result.Items[i]
		}
	}
	require.NotNil(t, gpt5Item)
	assert.True(t, gpt5Item.Matched)
	assert.Equal(t, "gpt-5", gpt5Item.CanonicalKey)
	assert.Equal(t, 128000, gpt5Item.ContextLength)
	assert.Equal(t, 16384, gpt5Item.MaxOutputTokens)
	// Declared models sorted: fastspeed, freespeed, gpt-5
	assert.Equal(t, []string{"fastspeed", "freespeed", "gpt-5"}, gpt5Item.DeclaredModels)
	// Capabilities: reasoning + tool_call
	assert.Contains(t, gpt5Item.Capabilities, "reasoning")
	assert.Contains(t, gpt5Item.Capabilities, "tool_call")

	// Unknown model row is unmatched.
	var unknownItem *ModelOverviewItem
	for i := range result.Items {
		if result.Items[i].Model == "unknown-model" {
			unknownItem = &result.Items[i]
		}
	}
	require.NotNil(t, unknownItem)
	assert.False(t, unknownItem.Matched)
	assert.Empty(t, unknownItem.CanonicalKey)
}

func TestBuildChannelModelOverviewCapabilityFilter(t *testing.T) {
	setupChannelModelMappingTest(t)

	reasoningTrue := true
	canon := &CanonicalModelParameter{
		CanonicalKey: "gpt-5",
		DisplayName:  "GPT-5",
		Vendor:       "openai",
		Reasoning:    &reasoningTrue,
	}
	require.NoError(t, CreateCanonicalModel(canon))

	ch := &Channel{
		Id:     1,
		Name:   "ch1",
		Type:   1,
		Models: "gpt-5,unknown-model",
	}
	require.NoError(t, DB.Create(ch).Error)

	// Capability filter "reasoning" excludes unmatched rows.
	result, err := BuildChannelModelOverview("", "reasoning", "", "", 1, 50)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, 1, result.Total)
	assert.Equal(t, "gpt-5", result.Items[0].Model)
	assert.True(t, result.Items[0].Matched)

	// Capability filter "vision" excludes the matched gpt-5 (no vision) and unmatched.
	result, err = BuildChannelModelOverview("", "vision", "", "", 1, 50)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, 0, result.Total)
}

func TestBuildChannelModelOverviewSortUnmatchedLast(t *testing.T) {
	setupChannelModelMappingTest(t)

	canon1 := &CanonicalModelParameter{
		CanonicalKey:    "gpt-5",
		DisplayName:     "GPT-5",
		Vendor:          "openai",
		ContextLength:   128000,
		MaxOutputTokens: 16384,
	}
	require.NoError(t, CreateCanonicalModel(canon1))

	canon2 := &CanonicalModelParameter{
		CanonicalKey:    "claude-4",
		DisplayName:     "Claude 4",
		Vendor:          "anthropic",
		ContextLength:   200000,
		MaxOutputTokens: 8192,
	}
	require.NoError(t, CreateCanonicalModel(canon2))

	ch := &Channel{
		Id:     1,
		Name:   "ch1",
		Type:   1,
		Models: "gpt-5,claude-4,unknown-model",
	}
	require.NoError(t, DB.Create(ch).Error)

	// Sort by context asc: matched rows (claude-4=200000 > gpt-5=128000) first, then unmatched.
	result, err := BuildChannelModelOverview("", "", "context", "asc", 1, 50)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, 3, result.Total)
	// asc: gpt-5 (128000) < claude-4 (200000), then unknown-model last.
	assert.Equal(t, "gpt-5", result.Items[0].Model)
	assert.Equal(t, "claude-4", result.Items[1].Model)
	assert.Equal(t, "unknown-model", result.Items[2].Model)

	// Sort by context desc: matched rows desc (claude-4 > gpt-5), then unmatched last.
	result, err = BuildChannelModelOverview("", "", "context", "desc", 1, 50)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, 3, result.Total)
	assert.Equal(t, "claude-4", result.Items[0].Model)
	assert.Equal(t, "gpt-5", result.Items[1].Model)
	assert.Equal(t, "unknown-model", result.Items[2].Model)
}

func TestBuildChannelModelOverviewPagination(t *testing.T) {
	setupChannelModelMappingTest(t)

	ch := &Channel{
		Id:     1,
		Name:   "ch1",
		Type:   1,
		Models: "model-a,model-b,model-c",
	}
	require.NoError(t, DB.Create(ch).Error)

	result, err := BuildChannelModelOverview("", "", "name", "asc", 1, 2)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, 3, result.Total)
	require.Len(t, result.Items, 2)
	assert.Equal(t, "model-a", result.Items[0].Model)
	assert.Equal(t, "model-b", result.Items[1].Model)

	result, err = BuildChannelModelOverview("", "", "name", "asc", 2, 2)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, 3, result.Total)
	require.Len(t, result.Items, 1)
	assert.Equal(t, "model-c", result.Items[0].Model)
}

// TestBuildChannelModelOverviewEmptyCapabilitiesJson guards against the overview
// emitting "capabilities": null for canonical rows with no capabilities. The
// frontend reads capabilities.length directly, so a null rejects with a
// rendering crash. Capabilities must always serialize as [], never null,
// for both matched rows with no capabilities and unmatched rows.
func TestBuildChannelModelOverviewEmptyCapabilitiesJson(t *testing.T) {
	setupChannelModelMappingTest(t)

	// Matched canonical row with every capability unknown/false.
	canon := &CanonicalModelParameter{
		CanonicalKey: "no-capability-model",
		DisplayName:  "No Capability Model",
		Vendor:       "acme",
	}
	require.NoError(t, CreateCanonicalModel(canon))

	ch := &Channel{
		Id:     1,
		Name:   "ch1",
		Type:   1,
		Models: "no-capability-model,unknown-model",
	}
	require.NoError(t, DB.Create(ch).Error)

	result, err := BuildChannelModelOverview("", "", "", "", 1, 50)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, 2, result.Total)

	var matchedItem, unmatchedItem *ModelOverviewItem
	for i := range result.Items {
		item := &result.Items[i]
		switch item.Model {
		case "no-capability-model":
			matchedItem = item
		case "unknown-model":
			unmatchedItem = item
		}
	}
	require.NotNil(t, matchedItem)
	assert.True(t, matchedItem.Matched)
	require.NotNil(t, unmatchedItem)
	assert.False(t, unmatchedItem.Matched)

	// Non-nil slices for both rows so JSON serializes as [] instead of null.
	assert.NotNil(t, matchedItem.Capabilities)
	assert.Empty(t, matchedItem.Capabilities)
	assert.NotNil(t, unmatchedItem.Capabilities)
	assert.Empty(t, unmatchedItem.Capabilities)

	for i, item := range []*ModelOverviewItem{matchedItem, unmatchedItem} {
		payload, err := common.Marshal(struct {
			Capabilities []string `json:"capabilities"`
		}{Capabilities: item.Capabilities})
		require.NoError(t, err)
		assert.Equalf(t, `{"capabilities":[]}`, string(payload), "row %d must not serialize capabilities as null", i)
	}

	// The full envelope also keeps [] for the whole row.
	row, err := common.Marshal(matchedItem)
	require.NoError(t, err)
	assert.Contains(t, string(row), `"capabilities":[]`)
}
