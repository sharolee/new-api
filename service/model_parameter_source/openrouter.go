package model_parameter_source

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const openRouterURLEnv = "MODEL_PARAMETER_SOURCE_OPENROUTER_URL"

type openRouterSource struct{}

func (openRouterSource) Name() string        { return NameOpenRouter }
func (openRouterSource) Description() string { return "OpenRouter model catalog" }
func (openRouterSource) Enabled() bool       { return true }

func (openRouterSource) baseURL() string {
	return common.GetEnvOrDefaultString(openRouterURLEnv, defaultOpenRouterURL)
}

type openRouterResponse struct {
	Data []openRouterModel `json:"data"`
}

type openRouterModel struct {
	Id              string            `json:"id"`
	Name            string            `json:"name"`
	ContextLength   *int              `json:"context_length"`
	Architecture    openRouterArch    `json:"architecture"`
	Reasoning       openRouterReason  `json:"reasoning"`
	Pricing         openRouterPricing `json:"pricing"`
	Created         int64             `json:"created"`
	SupportedParams []string          `json:"supported_parameters"`
}

type openRouterArch struct {
	InputModalities  []string `json:"input_modalities"`
	OutputModalities []string `json:"output_modalities"`
}

type openRouterReason struct {
	SupportedEfforts []string `json:"supported_efforts"`
	DefaultEffort    string   `json:"default_effort"`
}

// OpenRouter reports pricing in USD per token.
type openRouterPricing struct {
	Prompt      *string `json:"prompt"`
	Completion  *string `json:"completion"`
	Image       *string `json:"image"`
	Request     *string `json:"request"`
	InputCache  *string `json:"input_cache_read"`
	OutputCache *string `json:"output_cache_write_1h"`
}

func (openRouterSource) Fetch(ctx context.Context) ([]*SourceModel, error) {
	var response openRouterResponse
	if err := fetchJSON(ctx, openRouterSource{}.baseURL(), &response); err != nil {
		return nil, err
	}
	sources := make([]*SourceModel, 0, len(response.Data))
	for _, entry := range response.Data {
		if strings.TrimSpace(entry.Id) == "" {
			continue
		}
		sources = append(sources, buildOpenRouterModel(entry))
	}
	sort.Slice(sources, func(i, j int) bool { return sources[i].CanonicalKey < sources[j].CanonicalKey })
	return sources, nil
}

func buildOpenRouterModel(entry openRouterModel) *SourceModel {
	model := &SourceModel{
		CanonicalKey:     strings.ToLower(strings.TrimSpace(entry.Id)),
		DisplayName:      strings.TrimSpace(entry.Name),
		Vendor:           vendorOfCanonicalKey(entry.Id),
		SourceId:         strings.ToLower(strings.TrimSpace(entry.Id)),
		InputModalities:  entry.Architecture.InputModalities,
		OutputModalities: entry.Architecture.OutputModalities,
		Reasoning:        boolValue(len(entry.Reasoning.SupportedEfforts) > 0 || entry.Reasoning.DefaultEffort != ""),
		ReasoningEfforts: dedupeStrings(entry.Reasoning.SupportedEfforts),
		Aliases:          []AliasCandidate{{Name: entry.Id, Confidence: AliasConfidenceCanonical}},
	}
	if entry.ContextLength != nil {
		model.ContextLength = *entry.ContextLength
	}
	if model.InputModalities == nil {
		model.InputModalities = []string{"text"}
	}
	if model.OutputModalities == nil {
		model.OutputModalities = []string{"text"}
	}
	model.ToolCall = boolValue(hasOpenRouterCapability(entry.SupportedParams, "tools"))
	if model.StructuredOutput == nil {
		model.StructuredOutput = boolValue(hasOpenRouterCapability(entry.SupportedParams, "response_format"))
	}
	if model.Attachment == nil {
		model.Attachment = boolValue(hasOpenRouterCapability(entry.SupportedParams, "file_search"))
	}
	if input, ok := openRouterPrice(entry.Pricing.Prompt); ok {
		model.PriceInput = float64Value(input * tokensPerMillion)
	}
	if output, ok := openRouterPrice(entry.Pricing.Completion); ok {
		model.PriceOutput = float64Value(output * tokensPerMillion)
	}
	if entry.Created > 0 {
		model.ReleaseDate = time.Unix(entry.Created, 0).UTC().Format("2006-01-02")
	}
	if model.DisplayName == "" {
		model.DisplayName = model.CanonicalKey
	}
	return model
}

func openRouterPrice(value *string) (float64, bool) {
	if value == nil {
		return 0, false
	}
	return parseNumber(*value)
}

func hasOpenRouterCapability(params []string, wanted string) bool {
	for _, param := range params {
		if strings.EqualFold(param, wanted) {
			return true
		}
	}
	return false
}
