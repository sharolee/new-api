package openai

import (
	"fmt"
	"io"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

func OaiResponsesHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)

	// read response body
	var responsesResponse dto.OpenAIResponsesResponse
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}
	err = common.Unmarshal(responseBody, &responsesResponse)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if oaiError := responsesResponse.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, types.WithOpenAIError(*oaiError, resp.StatusCode)
	}

	info.ObserveResponseModel(responsesResponse.Model)
	responseBody = rewriteSGLangResponsesCreatedAt(info, responseBody, "created_at", responsesResponse.CreatedAt)

	// 写入新的 response body
	service.IOCopyBytesGracefully(c, resp, responseBody)

	// compute usage
	usage := &dto.Usage{}
	service.ApplyResponsesUsage(usage, responsesResponse.Usage)
	// Count actual tool invocations from Output (not tool declarations).
	for _, output := range responsesResponse.Output {
		switch output.Type {
		case dto.BuildInCallWebSearchCall:
			info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
		case dto.BuildInCallFileSearchCall:
			info.CountBillableToolCall(dto.BuildInCallFileSearchCall, "")
		case dto.BuildInCallFunctionCall:
			info.CountBillableToolCall(dto.BuildInCallFunctionCall, output.Name)
		}
	}

	imageCounter := &relaycommon.ImageGenerationCallCounter{}
	if !relaycommon.IsNonBillableResponsesStatus(responsesResponse.Status) {
		for i := range responsesResponse.Output {
			idx := i
			imageCounter.Observe(&responsesResponse.Output[i], &idx)
		}
	}
	imageCounter.Commit(info)

// Zero-output diagnostic for OpenAI Responses non-stream handler
	if usage.PromptTokens > 0 && usage.CompletionTokens == 0 && responsesResponse.Usage != nil {
		common.SetContextKey(c, constant.ContextKeyZeroOutputReason, service.ZeroOutputUpstreamUsageZero)
		common.SetContextKey(c, constant.ContextKeyZeroOutputHasText, false)
	}

	return usage, nil
}

func OaiResponsesStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		logger.LogError(c, "invalid response or response body")
		return nil, types.NewError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse)
	}

	defer service.CloseResponseBodyGracefully(resp)

	accumulator := service.NewResponsesUsageAccumulator(info)

	// Upstream diagnostic information for zero-output cases
	var upstreamStatusCode int
	var upstreamChunkSamples []string
	const maxChunkSamples = 5 // Keep only first few samples to avoid excessive memory usage

	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {
		// Collect upstream diagnostic information for zero-output cases
		if upstreamStatusCode == 0 {
			upstreamStatusCode = resp.StatusCode
		}
		if len(upstreamChunkSamples) < maxChunkSamples && len(data) > 0 {
			// Store a preview of the chunk (first 100 chars) to avoid excessive logging
			preview := data
			if len(preview) > 100 {
				preview = preview[:100] + "..."
			}
			upstreamChunkSamples = append(upstreamChunkSamples, preview)
		}

		// 检查当前数据是否包含 completed 状态和 usage 信息
		var streamResponse dto.ResponsesStreamResponse
		if err := common.UnmarshalJsonStr(data, &streamResponse); err != nil {
			logger.LogError(c, "failed to unmarshal stream response: "+err.Error())
			sr.Error(err)
			return
		}
		if streamResponse.Response != nil {
			data = string(rewriteSGLangResponsesCreatedAt(info, []byte(data), "response.created_at", streamResponse.Response.CreatedAt))
		}
		sendResponsesStreamData(c, streamResponse, data)
		accumulator.Observe(&streamResponse)
	})

	// Set upstream diagnostic context keys for zero-output cases
	if upstreamStatusCode > 0 {
		common.SetContextKey(c, constant.ContextKeyUpstreamStatusCode, upstreamStatusCode)
	}
	if len(upstreamChunkSamples) > 0 {
		chunkSamplesJSON, _ := common.Marshal(upstreamChunkSamples)
		common.SetContextKey(c, constant.ContextKeyUpstreamChunkSample, string(chunkSamplesJSON))
	}

	common.SetContextKey(c, constant.ContextKeyResponseStreamStatus, info.StreamStatus)
	info.StreamStatus.RequireTerminal()
	usage := accumulator.Finish()

	// Zero-output diagnostic for OpenAI Responses stream handler
	if usage.PromptTokens > 0 && usage.CompletionTokens == 0 {
		if accumulator.OutputText() == "" {
			// Stream accumulated zero non-empty content chunks
			common.SetContextKey(c, constant.ContextKeyZeroOutputReason, service.ZeroOutputStreamEmpty)
			common.SetContextKey(c, constant.ContextKeyZeroOutputHasText, false)
		} else {
			// Has text but upstream didn't provide usage and local recount also failed
			common.SetContextKey(c, constant.ContextKeyZeroOutputReason, service.ZeroOutputUpstreamNoUsage)
			common.SetContextKey(c, constant.ContextKeyZeroOutputHasText, true)
		}
	} else if usage.CompletionTokens > 0 && usage.PromptTokens > 0 {
		// Local recount produced non-zero (healed from upstream zero)
		// Check if upstream originally had zero completion tokens
		// This is a diagnostic marker for the healed case
		common.SetContextKey(c, constant.ContextKeyZeroOutputReason, service.ZeroOutputLocalRecountNonzero)
		common.SetContextKey(c, constant.ContextKeyZeroOutputHasText, true)
	}

	return usage, nil
}

func rewriteSGLangResponsesCreatedAt(info *relaycommon.RelayInfo, payload []byte, path string, createdAt dto.IntValue) []byte {
	if info.GetChannelType() != constant.ChannelTypeSGLang {
		return payload
	}
	if !gjson.GetBytes(payload, path).Exists() {
		return payload
	}
	patched, err := sjson.SetBytes(payload, path, int(createdAt))
	if err != nil {
		return payload
	}
	return patched
}
