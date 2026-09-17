package common

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCategorizeErrorLog(t *testing.T) {
	tests := []struct {
		name       string
		errorCode  string
		statusCode int
		zeroOutput bool
		want       string
	}{
		{name: "numeric 429", errorCode: "429", statusCode: 429, want: ErrorCategoryRateLimit},
		{name: "vendor 429001", errorCode: "429001", statusCode: 429, want: ErrorCategoryRateLimit},
		{name: "vendor 429006", errorCode: "429006", statusCode: 429, want: ErrorCategoryRateLimit},
		{name: "zhipu 1305 with http 429", errorCode: "1305", statusCode: 429, want: ErrorCategoryRateLimit},
		{name: "dashscope free tier", errorCode: "AllocationQuota.FreeTierOnly", statusCode: 403, want: ErrorCategoryQuota},
		{name: "http 503 code", errorCode: "503", statusCode: 503, want: ErrorCategoryUnavailable},
		{name: "bad response 404", errorCode: "bad_response_status_code", statusCode: 404, want: ErrorCategoryNotFound},
		{name: "bad response 504", errorCode: "bad_response_status_code", statusCode: 504, want: ErrorCategoryTimeout},
		{name: "zero output wins over extracted 503", errorCode: "503", statusCode: 200, zeroOutput: true, want: ErrorCategoryZeroOutput},
		{name: "zero output without code", errorCode: "", statusCode: 200, zeroOutput: true, want: ErrorCategoryZeroOutput},
		{name: "empty unknown", errorCode: "", statusCode: 0, want: ErrorCategoryUnknown},
		{name: "unknown_error", errorCode: "unknown_error", statusCode: 0, want: ErrorCategoryUnknown},
		{name: "vendor leftover", errorCode: "some_vendor_code", statusCode: 200, want: ErrorCategoryUpstream},
		{name: "invalid request", errorCode: "invalid_request", statusCode: 400, want: ErrorCategoryInvalidRequest},
		{name: "invalid api key", errorCode: "invalid_api_key", statusCode: 401, want: ErrorCategoryAuth},
		{name: "insufficient quota code", errorCode: "insufficient_user_quota", statusCode: 403, want: ErrorCategoryQuota},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CategorizeErrorLog(tt.errorCode, tt.statusCode, tt.zeroOutput)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestExtractErrorFromChunkSample(t *testing.T) {
	code, errType := ExtractErrorFromChunkSample(`{"error":{"code":503,"type":"service_unavailable"}}`)
	assert.Equal(t, "503", code)
	assert.Equal(t, "service_unavailable", errType)

	code, errType = ExtractErrorFromChunkSample("data: {\"error\":{\"code\":\"invalid_api_key\",\"type\":\"invalid_request_error\"}}")
	assert.Equal(t, "invalid_api_key", code)
	assert.Equal(t, "invalid_request_error", errType)

	code, errType = ExtractErrorFromChunkSample("")
	assert.Equal(t, "", code)
	assert.Equal(t, "", errType)
}

func TestAttachErrorLogCategory(t *testing.T) {
	other := map[string]interface{}{
		"error_code":  "429001",
		"status_code": 429,
	}
	AttachErrorLogCategory(other)
	assert.Equal(t, ErrorCategoryRateLimit, other["error_category"])
	assert.Equal(t, "429001", other["error_code"])

	zero := map[string]interface{}{
		"zero_output":           true,
		"upstream_status_code":  200,
		"upstream_chunk_sample": `{"error":{"code":503,"type":"service_unavailable"}}`,
	}
	AttachErrorLogCategory(zero)
	assert.Equal(t, "503", zero["error_code"])
	assert.Equal(t, "service_unavailable", zero["error_type"])
	assert.Equal(t, ErrorCategoryZeroOutput, zero["error_category"])
}

func TestCategorizeErrorLogFromOtherFallsBackWithoutStoredCategory(t *testing.T) {
	got := CategorizeErrorLogFromOther(map[string]interface{}{
		"error_code":  "bad_response_status_code",
		"status_code": float64(504),
	})
	assert.Equal(t, ErrorCategoryTimeout, got)

	got = CategorizeErrorLogFromOther(map[string]interface{}{
		"error_category": ErrorCategoryRateLimit,
		"error_code":     "legacy",
	})
	assert.Equal(t, ErrorCategoryRateLimit, got)

	require.Equal(t, ErrorCategoryUnknown, CategorizeErrorLogFromOther(nil))
}
