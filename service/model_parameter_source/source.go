// Package model_parameter_source fetches model parameter catalogs from public
// upstreams. Sources are independent: one failing endpoint never aborts the
// sync of the others.
package model_parameter_source

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const (
	NameModelsDev  = "models.dev"
	NameLiteLLM    = "litellm"
	NameOpenRouter = "openrouter"
)

const (
	// AliasConfidenceCanonical marks names the source ties explicitly to a
	// canonical model.
	AliasConfidenceCanonical = 100
	// AliasConfidenceDerived marks names inferred from the source layout
	// instead of declared by it.
	AliasConfidenceDerived = 60
)

const (
	defaultModelsDevURL  = "https://models.dev/api.json"
	defaultLiteLLMURL    = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
	defaultOpenRouterURL = "https://openrouter.ai/api/v1/models"

	fetchTimeoutEnv = "MODEL_PARAMETER_SOURCE_TIMEOUT_SECONDS"
	maxFetchBody    = 64 << 20
)

// AliasCandidate is one upstream name that should resolve to a source model.
type AliasCandidate struct {
	Name       string `json:"name"`
	Confidence int    `json:"confidence"`
}

// SourceModel is the normalized record a source returns for one canonical
// model. Booleans stay pointers so an unknown capability is not reported as
// unsupported.
type SourceModel struct {
	CanonicalKey     string           `json:"canonicalKey"`
	DisplayName      string           `json:"displayName"`
	Vendor           string           `json:"vendor"`
	ContextLength    int              `json:"contextLength"`
	MaxOutputTokens  int              `json:"maxOutputTokens"`
	InputModalities  []string         `json:"inputModalities"`
	OutputModalities []string         `json:"outputModalities"`
	Reasoning        *bool            `json:"reasoning"`
	ReasoningEfforts []string         `json:"reasoningEfforts"`
	ToolCall         *bool            `json:"toolCall"`
	StructuredOutput *bool            `json:"structuredOutput"`
	Attachment       *bool            `json:"attachment"`
	KnowledgeCutoff  string           `json:"knowledgeCutoff"`
	ReleaseDate      string           `json:"releaseDate"`
	ParameterCount   string           `json:"parameterCount"`
	Tags             []string         `json:"tags"`
	PriceInput       *float64         `json:"priceInput"`
	PriceOutput      *float64         `json:"priceOutput"`
	SourceId         string           `json:"sourceId"`
	Extra            string           `json:"extra"`
	Aliases          []AliasCandidate `json:"aliases"`
}

// Source reads one canonical model catalog.
type Source interface {
	Name() string
	Description() string
	Enabled() bool
	Fetch(ctx context.Context) ([]*SourceModel, error)
}

// Info is the public view of a registered source.
type Info struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
}

var (
	registryMu sync.RWMutex
	registry   = make(map[string]Source)
)

func init() {
	Register(&modelsDevSource{}, &litellmSource{}, &openRouterSource{})
}

// Register adds sources to the registry. Existing names are replaced so tests
// can substitute fake sources.
func Register(sources ...Source) {
	registryMu.Lock()
	defer registryMu.Unlock()
	for _, source := range sources {
		if source == nil {
			continue
		}
		registry[strings.ToLower(source.Name())] = source
	}
}

// List returns every registered source in name order.
func List() []Info {
	registryMu.RLock()
	defer registryMu.RUnlock()
	infos := make([]Info, 0, len(registry))
	for name := range registry {
		source := registry[name]
		infos = append(infos, Info{Name: source.Name(), Description: source.Description(), Enabled: source.Enabled()})
	}
	sort.Slice(infos, func(i, j int) bool { return infos[i].Name < infos[j].Name })
	return infos
}

// Get resolves a source by name.
func Get(name string) (Source, error) {
	registryMu.RLock()
	defer registryMu.RUnlock()
	source, ok := registry[strings.ToLower(strings.TrimSpace(name))]
	if !ok {
		return nil, fmt.Errorf("unknown model parameter source: %s", name)
	}
	return source, nil
}

// Names returns the registered source names in order.
func Names() []string {
	infos := List()
	names := make([]string, 0, len(infos))
	for _, info := range infos {
		names = append(names, info.Name)
	}
	return names
}

var (
	clientOnce sync.Once
	sharedHTTP *http.Client
)

func httpClient() *http.Client {
	clientOnce.Do(func() {
		timeoutSeconds := common.GetEnvOrDefault(fetchTimeoutEnv, 30)
		if timeoutSeconds <= 0 {
			timeoutSeconds = 30
		}
		timeout := time.Duration(timeoutSeconds) * time.Second
		transport := &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			DialContext:           (&net.Dialer{Timeout: timeout}).DialContext,
			TLSHandshakeTimeout:   timeout,
			ResponseHeaderTimeout: timeout,
			MaxIdleConns:          32,
			IdleConnTimeout:       90 * time.Second,
		}
		if common.TLSInsecureSkipVerify {
			transport.TLSClientConfig = common.InsecureTLSConfig
		}
		sharedHTTP = &http.Client{Transport: transport}
	})
	return sharedHTTP
}

// fetchJSON GETs a URL and unmarshals the body into out.
func fetchJSON(ctx context.Context, rawURL string, out any) error {
	if strings.TrimSpace(rawURL) == "" {
		return fmt.Errorf("source URL is empty")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "new-api-model-parameter-sync")
	response, err := httpClient().Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("upstream returned HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxFetchBody+1))
	if err != nil {
		return err
	}
	if len(body) > maxFetchBody {
		return fmt.Errorf("upstream payload exceeds %d bytes", maxFetchBody)
	}
	return common.Unmarshal(body, out)
}

// fetchJSONBytes GETs a URL and returns the raw body.
func fetchJSONBytes(ctx context.Context, rawURL string) ([]byte, error) {
	if strings.TrimSpace(rawURL) == "" {
		return nil, fmt.Errorf("source URL is empty")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "new-api-model-parameter-sync")
	response, err := httpClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("upstream returned HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxFetchBody+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxFetchBody {
		return nil, fmt.Errorf("upstream payload exceeds %d bytes", maxFetchBody)
	}
	return body, nil
}

func boolValue(value bool) *bool {
	result := value
	return &result
}

func float64Value(value float64) *float64 {
	result := value
	return &result
}

// parseBoolish accepts the shapes upstreams use for a capability flag: a bool,
// or an object with a boolean or numeric indicator.
func parseBoolish(value any) *bool {
	switch typed := value.(type) {
	case bool:
		return boolValue(typed)
	case map[string]any:
		for _, key := range []string{"enabled", "support", "supported", "value", "default"} {
			if candidate, ok := typed[key]; ok {
				if result := parseBoolish(candidate); result != nil {
					return result
				}
			}
		}
		return nil
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "true", "yes", "1":
			return boolValue(true)
		case "false", "no", "0":
			return boolValue(false)
		}
	case float64:
		if typed != 0 {
			return boolValue(true)
		}
		return boolValue(false)
	}
	return nil
}

// parseNumber accepts ints, floats, and numeric strings.
func parseNumber(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case int:
		return float64(typed), true
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return 0, false
		}
		var parsed float64
		if _, err := fmt.Sscanf(text, "%g", &parsed); err != nil {
			return 0, false
		}
		return parsed, true
	}
	return 0, false
}

func parseString(value any) string {
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return ""
}

func parseStringSlice(value any) []string {
	list, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(list))
	for _, item := range list {
		if text := parseString(item); text != "" {
			result = append(result, text)
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func parseObject(value any) map[string]any {
	if object, ok := value.(map[string]any); ok {
		return object
	}
	return nil
}

func parseNested(source map[string]any, keys ...string) map[string]any {
	current := source
	for _, key := range keys {
		current = parseObject(current[key])
		if current == nil {
			return nil
		}
	}
	return current
}

func rawOf(value any) string {
	encoded, err := common.Marshal(value)
	if err != nil {
		return ""
	}
	return string(encoded)
}
