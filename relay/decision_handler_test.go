package relay

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/common_handler"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newDecisionTestContext(t *testing.T, body string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/decisions", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	return c, recorder
}

func TestGetAndValidateDecisionRequest(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		wantErr     string
		wantRawBody bool
	}{
		{
			name:        "valid request keeps raw body",
			body:        `{"model":"startlux-decision-27b-autothink","state":"customer charged twice","questions":{"team":{"type":"choice"}},"future_field":1}`,
			wantRawBody: true,
		},
		{
			name:    "missing state",
			body:    `{"model":"m","questions":{"team":{"type":"choice"}}}`,
			wantErr: "state is required",
		},
		{
			name:    "empty string state",
			body:    `{"model":"m","state":"","questions":{"team":{"type":"choice"}}}`,
			wantErr: "state is required",
		},
		{
			name:    "missing questions",
			body:    `{"model":"m","state":"x"}`,
			wantErr: "questions must be a nonempty object",
		},
		{
			name:    "empty questions object",
			body:    `{"model":"m","state":"x","questions":{}}`,
			wantErr: "questions must be a nonempty object",
		},
		{
			name:    "too many images",
			body:    `{"model":"m","state":"x","questions":{"q":{"type":"noul"}},"images":["1","2","3","4","5","6","7","8","9"]}`,
			wantErr: "images must not exceed 8",
		},
		{
			name:    "stream rejected",
			body:    `{"model":"m","state":"x","questions":{"q":{"type":"noul"}},"stream":true}`,
			wantErr: "stream is not supported",
		},
		{
			name:    "think budget below minimum",
			body:    `{"model":"m","state":"x","questions":{"q":{"type":"noul"}},"think_budget":0}`,
			wantErr: "think_budget must be between 1 and 4096",
		},
		{
			name:    "think budget above maximum",
			body:    `{"model":"m","state":"x","questions":{"q":{"type":"noul"}},"think_budget":4097}`,
			wantErr: "think_budget must be between 1 and 4096",
		},
		{
			name: "think budget boundary",
			body: `{"model":"m","state":"x","questions":{"q":{"type":"noul"}},"think_budget":4096}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := newDecisionTestContext(t, tt.body)
			request, err := helper.GetAndValidateDecisionRequest(c)
			if tt.wantErr != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.wantErr)
				return
			}
			require.NoError(t, err)
			require.NotNil(t, request)
			if tt.wantRawBody {
				assert.JSONEq(t, tt.body, string(request.RawBody))
			}
		})
	}
}

func TestOpenAIConvertDecisionRequest(t *testing.T) {
	adaptor := &openai.Adaptor{}
	request := &dto.DecisionRequest{
		Model:   "startlux-decision",
		RawBody: json.RawMessage(`{"model":"startlux-decision","state":{"ticket":42},"questions":{"team":{"type":"choice"}},"think_budget":5120}`),
	}
	info := &relaycommon.RelayInfo{
		OriginModelName: "startlux-decision",
		ChannelMeta:     &relaycommon.ChannelMeta{UpstreamModelName: "startlux-decision-27b-autothink"},
	}

	converted, err := adaptor.ConvertDecisionRequest(nil, info, request)
	require.NoError(t, err)

	raw, ok := converted.(json.RawMessage)
	require.True(t, ok)
	var body map[string]any
	require.NoError(t, common.Unmarshal(raw, &body))
	assert.Equal(t, "startlux-decision-27b-autothink", body["model"])
	assert.Equal(t, map[string]any{"ticket": float64(42)}, body["state"])
	assert.Equal(t, float64(5120), body["think_budget"])
	assert.Contains(t, body, "questions")
}

func TestOpenAIGetRequestURLDecisionAlias(t *testing.T) {
	tests := []struct {
		requestPath string
		want        string
	}{
		{"/v1/systemone", "https://api.bamboonode.dev/v1/decisions"},
		{"/v1/systemone?beta=true", "https://api.bamboonode.dev/v1/decisions?beta=true"},
		{"/v1/decisions", "https://api.bamboonode.dev/v1/decisions"},
	}
	adaptor := &openai.Adaptor{}
	for _, tt := range tests {
		info := &relaycommon.RelayInfo{
			RelayFormat:    types.RelayFormatDecision,
			RelayMode:      relayconstant.RelayModeDecisions,
			RequestURLPath: tt.requestPath,
			ChannelMeta: &relaycommon.ChannelMeta{
				ChannelBaseUrl:    "https://api.bamboonode.dev",
				UpstreamModelName: "startlux-decision-27b-autothink",
			},
		}
		got, err := adaptor.GetRequestURL(info)
		require.NoError(t, err)
		assert.Equal(t, tt.want, got)
	}
}

func TestPath2RelayModeDecision(t *testing.T) {
	assert.Equal(t, relayconstant.RelayModeDecisions, relayconstant.Path2RelayMode("/v1/decisions"))
	assert.Equal(t, relayconstant.RelayModeDecisions, relayconstant.Path2RelayMode("/v1/systemone"))
}

func TestDecisionHandlerMapsUsageAndPassesBodyThrough(t *testing.T) {
	tests := []struct {
		name           string
		body           string
		wantPrompt     int
		wantCompletion int
	}{
		{
			name:           "input only",
			body:           `{"answers":{"team":{"choice":"billing","confidence":0.998}},"model":"startlux-decision-27b-autothink","usage":{"input_tokens":242,"output_tokens":0},"timing_ms":812,"legend":{}}`,
			wantPrompt:     242,
			wantCompletion: 0,
		},
		{
			name:           "thinking output tokens",
			body:           `{"answers":{"urgent":{"noul":0.013,"details":{"thought":{"text":"reasoning"}}}},"usage":{"input_tokens":242,"output_tokens":136}}`,
			wantPrompt:     242,
			wantCompletion: 136,
		},
		{
			name:           "negative upstream count is clamped",
			body:           `{"answers":{},"usage":{"input_tokens":-5,"output_tokens":10}}`,
			wantPrompt:     0,
			wantCompletion: 10,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, recorder := newDecisionTestContext(t, `{}`)
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(tt.body)),
			}

			usage, apiErr := common_handler.DecisionHandler(c, resp)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			assert.Equal(t, tt.wantPrompt, usage.PromptTokens)
			assert.Equal(t, tt.wantCompletion, usage.CompletionTokens)
			assert.Equal(t, tt.wantPrompt+tt.wantCompletion, usage.TotalTokens)
			assert.JSONEq(t, tt.body, recorder.Body.String())
			assert.Equal(t, "application/json", recorder.Header().Get("Content-Type"))
		})
	}
}
