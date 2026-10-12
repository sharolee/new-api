package model_parameter_source

import (
	"context"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const litellmURLEnv = "MODEL_PARAMETER_SOURCE_LITELLM_URL"

const tokensPerMillion = 1_000_000

type litellmSource struct{}

func (litellmSource) Name() string        { return NameLiteLLM }
func (litellmSource) Description() string { return "LiteLLM model prices and context windows" }
func (litellmSource) Enabled() bool       { return true }

func (litellmSource) baseURL() string {
	return common.GetEnvOrDefaultString(litellmURLEnv, defaultLiteLLMURL)
}

func (litellmSource) Fetch(ctx context.Context) ([]*SourceModel, error) {
	var entries map[string]map[string]any
	if err := fetchJSON(ctx, litellmSource{}.baseURL(), &entries); err != nil {
		return nil, err
	}
	sources := make([]*SourceModel, 0, len(entries))
	for key, entry := range entries {
		name := strings.TrimSpace(key)
		if name == "" {
			continue
		}
		sources = append(sources, buildLiteLLMModel(name, entry))
	}
	sort.Slice(sources, func(i, j int) bool { return sources[i].CanonicalKey < sources[j].CanonicalKey })
	return sources, nil
}

func buildLiteLLMModel(key string, entry map[string]any) *SourceModel {
	model := &SourceModel{
		CanonicalKey: strings.ToLower(key),
		DisplayName:  displayFromModelKey(key),
		Vendor:       vendorOfCanonicalKey(key),
		SourceId:     strings.ToLower(key),
		Extra:        rawOf(entry),
		Aliases:      []AliasCandidate{{Name: key, Confidence: AliasConfidenceCanonical}},
	}
	if contextLength, ok := parseNumber(entry["max_input_tokens"]); ok {
		model.ContextLength = int(contextLength)
	}
	output, hasOutput := parseNumber(entry["max_output_tokens"])
	if !hasOutput {
		output, hasOutput = parseNumber(entry["max_tokens"])
	}
	if hasOutput {
		model.MaxOutputTokens = int(output)
	}
	if reasoning := parseBoolish(entry["supports_reasoning"]); reasoning != nil {
		model.Reasoning = reasoning
	}
	if toolCall := parseBoolish(entry["supports_function_calling"]); toolCall != nil {
		model.ToolCall = toolCall
	}
	if supports := parseBoolish(entry["supports_attachment"]); supports != nil {
		model.Attachment = supports
	}
	if structured := parseBoolish(entry["supports_structured_outputs"]); structured != nil {
		model.StructuredOutput = structured
	}
	vision := false
	if supports := parseBoolish(entry["supports_vision"]); supports != nil {
		vision = *supports
	}
	model.InputModalities = textModalities(vision)
	model.OutputModalities = []string{"text"}
	if input, ok := parseNumber(entry["input_cost_per_token"]); ok {
		model.PriceInput = float64Value(input * tokensPerMillion)
	}
	if output, ok := parseNumber(entry["output_cost_per_token"]); ok {
		model.PriceOutput = float64Value(output * tokensPerMillion)
	}
	if mode := parseString(entry["mode"]); mode != "" {
		model.Tags = append(model.Tags, mode)
	}
	if model.DisplayName == "" {
		model.DisplayName = model.CanonicalKey
	}
	return model
}

func displayFromModelKey(key string) string {
	_, name, _ := strings.Cut(key, "/")
	return strings.TrimSpace(name)
}

func textModalities(vision bool) []string {
	if vision {
		return []string{"text", "image"}
	}
	return []string{"text"}
}
