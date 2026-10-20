package dto

import (
	"encoding/json"
	"net/http"

	"github.com/QuantumNous/new-api/relaykit/types"
)

// Decision protocol limits: StartLux (Bamboo Relay) accepts at most 8 images
// and a thinking budget between 1 and 4096 tokens.
const (
	MaxDecisionImages      = 8
	DecisionThinkBudgetMin = 1
	DecisionThinkBudgetMax = 4096
)

// DecisionRequest is the StartLux / Jev "System One" decision request.
// RawBody preserves the original JSON so unknown fields are forwarded intact;
// the typed fields only cover what the gateway validates or rewrites.
type DecisionRequest struct {
	Model         string                      `json:"model,omitempty"`
	State         json.RawMessage             `json:"state,omitempty"`
	Questions     map[string]DecisionQuestion `json:"questions,omitempty"`
	Images        []json.RawMessage           `json:"images,omitempty"`
	ThinkMode     json.RawMessage             `json:"think_mode,omitempty"`
	ThinkBudget   *int                        `json:"think_budget,omitempty"`
	Gate          json.RawMessage             `json:"gate,omitempty"`
	Mix           json.RawMessage             `json:"mix,omitempty"`
	NoneCheck     *bool                       `json:"none_check,omitempty"`
	AllowNone     *bool                       `json:"allow_none,omitempty"`
	ReturnDetails *bool                       `json:"return_details,omitempty"`
	ReturnThought *bool                       `json:"return_thought,omitempty"`
	Stream        *bool                       `json:"stream,omitempty"`
	RawBody       json.RawMessage             `json:"-"`
}

// DecisionQuestion is one entry of the questions object. Only the fields the
// gateway inspects are typed; everything else travels through RawBody.
type DecisionQuestion struct {
	Type    string            `json:"type,omitempty"`
	Options []json.RawMessage `json:"options,omitempty"`
}

// DecisionResponse is the upstream decision response. It is forwarded to the
// client verbatim; the typed view exists to read usage and answers.
type DecisionResponse struct {
	Answers  map[string]DecisionAnswer `json:"answers,omitempty"`
	Model    string                    `json:"model,omitempty"`
	Usage    DecisionUsage             `json:"usage"`
	TimingMS json.RawMessage           `json:"timing_ms,omitempty"`
	Legend   json.RawMessage           `json:"legend,omitempty"`
}

// DecisionAnswer is a single probabilistic answer. Exactly one of the answer
// fields is normally present, matching the question type.
type DecisionAnswer struct {
	Choice     string          `json:"choice,omitempty"`
	Confidence *float64        `json:"confidence,omitempty"`
	Score      *float64        `json:"score,omitempty"`
	Noul       *float64        `json:"noul,omitempty"`
	Bool       *float64        `json:"bool,omitempty"`
	Details    json.RawMessage `json:"details,omitempty"`
}

// DecisionUsage is the upstream token usage. Output tokens include thinking
// tokens when think_mode and return_thought are enabled.
type DecisionUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

func (r *DecisionRequest) GetTokenCountMeta() *types.TokenCountMeta {
	combineText := ""
	if len(r.RawBody) > 0 {
		combineText = string(r.RawBody)
	} else {
		combineText = string(r.State)
	}
	return &types.TokenCountMeta{
		CombineText: combineText,
		TokenType:   types.TokenTypeTokenizer,
	}
}

func (r *DecisionRequest) IsStream(_ *http.Request) bool {
	return false
}

func (r *DecisionRequest) SetModelName(modelName string) {
	if modelName != "" {
		r.Model = modelName
	}
}
