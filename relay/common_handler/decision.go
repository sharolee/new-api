package common_handler

import (
	"fmt"
	"io"
	"math"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// maxDecisionTokenCount bounds token counts taken from the upstream decision
// response before they reach quota arithmetic. Single-request saturation stays
// at the int32 boundary used by the other billing helpers.
const maxDecisionTokenCount = math.MaxInt32 / 2

func DecisionHandler(c *gin.Context, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}
	service.CloseResponseBodyGracefully(resp)
	logger.LogDebug(c, "decision response body: %s", responseBody)

	var decisionResp dto.DecisionResponse
	if err := common.Unmarshal(responseBody, &decisionResp); err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	usage := &dto.Usage{
		PromptTokens:     normalizeDecisionTokens("input_tokens", decisionResp.Usage.InputTokens),
		CompletionTokens: normalizeDecisionTokens("output_tokens", decisionResp.Usage.OutputTokens),
	}
	usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens

	c.Writer.Header().Set("Content-Type", "application/json")
	c.Writer.WriteHeader(http.StatusOK)
	if _, err := c.Writer.Write(responseBody); err != nil {
		return nil, types.NewError(err, types.ErrorCodeDoRequestFailed, types.ErrOptionWithSkipRetry())
	}
	return usage, nil
}

func normalizeDecisionTokens(field string, tokens int) int {
	if tokens >= 0 && tokens <= maxDecisionTokenCount {
		return tokens
	}
	common.SysError(fmt.Sprintf("decision usage %s out of range: %d", field, tokens))
	return min(max(tokens, 0), maxDecisionTokenCount)
}
