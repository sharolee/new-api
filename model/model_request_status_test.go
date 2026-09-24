package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetModelRequestStatuses(t *testing.T) {
	truncateTables(t)

	now := int64(3600 * 1000)

	// 1) consume log → success
	require.NoError(t, LOG_DB.Create(&Log{
		Type:      LogTypeConsume,
		UserId:    1,
		Username:  "alice",
		ModelName: "gpt-4",
		CreatedAt: now,
		Content:   "success response",
		ChannelId: 11,
		Other:     common.MapToJsonStr(map[string]any{"is_model_mapped": false}),
	}).Error)

	// 2) error_category=rate_limit → rate_limit
	require.NoError(t, LOG_DB.Create(&Log{
		Type:      LogTypeError,
		UserId:    1,
		Username:  "alice",
		ModelName: "gpt-4",
		CreatedAt: now + 1,
		Content:   "rate limit exceeded",
		ChannelId: 11,
		Other: common.MapToJsonStr(map[string]any{
			"error_category": "rate_limit",
			"error_code":     "429",
		}),
	}).Error)

	// 3) error_category=quota → quota
	require.NoError(t, LOG_DB.Create(&Log{
		Type:      LogTypeError,
		UserId:    1,
		Username:  "alice",
		ModelName: "gpt-3.5",
		CreatedAt: now + 2,
		Content:   "quota exhausted",
		ChannelId: 22,
		Other: common.MapToJsonStr(map[string]any{
			"error_category": "quota",
			"error_code":     "insufficient_quota",
		}),
	}).Error)

	// 4) error_category=not_found → unavailable
	require.NoError(t, LOG_DB.Create(&Log{
		Type:      LogTypeError,
		UserId:    1,
		Username:  "alice",
		ModelName: "gpt-4",
		CreatedAt: now + 3,
		Content:   "model not found",
		ChannelId: 33,
		Other: common.MapToJsonStr(map[string]any{
			"error_category": "not_found",
			"error_code":     "model_not_found",
		}),
	}).Error)

	// 5) other category (auth) → other_error
	require.NoError(t, LOG_DB.Create(&Log{
		Type:      LogTypeError,
		UserId:    1,
		Username:  "alice",
		ModelName: "gpt-4",
		CreatedAt: now + 4,
		Content:   "invalid api key",
		ChannelId: 44,
		Other: common.MapToJsonStr(map[string]any{
			"error_category": "auth",
			"error_code":     "invalid_api_key",
		}),
	}).Error)

	// 6) limit truncation: 3 logs same model, limit=2 → keep 2 newest
	require.NoError(t, LOG_DB.Create(&Log{
		Type:      LogTypeConsume,
		UserId:    1,
		Username:  "alice",
		ModelName: "claude-3",
		CreatedAt: now + 10,
		Content:   "first",
		ChannelId: 55,
		Other:     common.MapToJsonStr(map[string]any{"is_model_mapped": false}),
	}).Error)
	require.NoError(t, LOG_DB.Create(&Log{
		Type:      LogTypeConsume,
		UserId:    1,
		Username:  "alice",
		ModelName: "claude-3",
		CreatedAt: now + 11,
		Content:   "second",
		ChannelId: 55,
		Other:     common.MapToJsonStr(map[string]any{"is_model_mapped": false}),
	}).Error)
	require.NoError(t, LOG_DB.Create(&Log{
		Type:      LogTypeConsume,
		UserId:    1,
		Username:  "alice",
		ModelName: "claude-3",
		CreatedAt: now + 12,
		Content:   "third",
		ChannelId: 55,
		Other:     common.MapToJsonStr(map[string]any{"is_model_mapped": false}),
	}).Error)

	// 7) aggregate_by=upstream_model_name with is_model_mapped=true uses upstream name
	require.NoError(t, LOG_DB.Create(&Log{
		Type:      LogTypeConsume,
		UserId:    1,
		Username:  "alice",
		ModelName: "local-model",
		CreatedAt: now + 20,
		Content:   "mapped to upstream",
		ChannelId: 66,
		Other: common.MapToJsonStr(map[string]any{
			"is_model_mapped":      true,
			"upstream_model_name":  "upstream-gpt-4",
		}),
	}).Error)

	// 7b) aggregate_by=upstream_model_name with is_model_mapped=false falls back to model_name
	require.NoError(t, LOG_DB.Create(&Log{
		Type:      LogTypeConsume,
		UserId:    1,
		Username:  "alice",
		ModelName: "local-model",
		CreatedAt: now + 21,
		Content:   "not mapped",
		ChannelId: 66,
		Other: common.MapToJsonStr(map[string]any{
			"is_model_mapped":      false,
			"upstream_model_name":  "upstream-gpt-4",
		}),
	}).Error)

	data, err := GetModelRequestStatuses(now, now+30, "", "model_name", 2, 1)
	require.NoError(t, err)
	require.NotNil(t, data)

	// Verify each test case
	modelMap := make(map[string]*ModelRequestStatus)
	for i := range data {
		modelMap[data[i].Model] = &data[i]
	}

	// 1) gpt-4: 1 consume (success) + 3 errors (rate_limit, not_found, other_error) = 4 total, limit=2 keeps 2 newest
	require.Contains(t, modelMap, "gpt-4")
	gpt4 := modelMap["gpt-4"]
	assert.Equal(t, 4, gpt4.Total)
	assert.Len(t, gpt4.Requests, 2)
	// newest first (created_at desc) → other_error (now+4) then not_found (now+3)
	assert.Equal(t, "other_error", gpt4.Requests[0].Status)
	assert.Equal(t, "unavailable", gpt4.Requests[1].Status)

	// 2) gpt-3.5: 1 error (quota)
	require.Contains(t, modelMap, "gpt-3.5")
	gpt35 := modelMap["gpt-3.5"]
	assert.Equal(t, 1, gpt35.Total)
	assert.Len(t, gpt35.Requests, 1)
	assert.Equal(t, "quota", gpt35.Requests[0].Status)

	// 3) claude-3: 3 consumes, limit=2 keeps 2 newest
	require.Contains(t, modelMap, "claude-3")
	claude := modelMap["claude-3"]
	assert.Equal(t, 3, claude.Total)
	assert.Len(t, claude.Requests, 2)
	// newest first → third (now+12) then second (now+11)
	assert.Equal(t, "success", claude.Requests[0].Status)
	assert.Equal(t, "success", claude.Requests[1].Status)

	// 4) local-model: 2 entries but aggregate_by=model_name so they group together
	require.Contains(t, modelMap, "local-model")
	local := modelMap["local-model"]
	assert.Equal(t, 2, local.Total)
	assert.Len(t, local.Requests, 2)

	// Verify deterministic sort order (alphabetical) by checking the result slice directly
	for i := 1; i < len(data); i++ {
		assert.True(t, data[i-1].Model <= data[i].Model, "data slice should be sorted: %v", data)
	}

	// Test upstream_model_name aggregation
	dataUpstream, err := GetModelRequestStatuses(now, now+30, "", "upstream_model_name", 10, 1)
	require.NoError(t, err)
	upstreamMap := make(map[string]*ModelRequestStatus)
	for i := range dataUpstream {
		upstreamMap[dataUpstream[i].Model] = &dataUpstream[i]
	}
	// local-model with is_model_mapped=true should appear as upstream-gpt-4
	require.Contains(t, upstreamMap, "upstream-gpt-4")
	assert.Equal(t, 1, upstreamMap["upstream-gpt-4"].Total)
	// local-model with is_model_mapped=false should appear as local-model
	require.Contains(t, upstreamMap, "local-model")
	assert.Equal(t, 1, upstreamMap["local-model"].Total)

	// Test user filter (userId)
	dataUser, err := GetModelRequestStatuses(now, now+30, "", "model_name", 10, 999)
	require.NoError(t, err)
	assert.Empty(t, dataUser)
}

func TestGetModelRequestStatusesContentTruncation(t *testing.T) {
	truncateTables(t)

	now := int64(3600 * 1000)
	longContent := "这是一段很长的内容"
	for len([]rune(longContent)) < 250 {
		longContent += "测试"
	}

	require.NoError(t, LOG_DB.Create(&Log{
		Type:      LogTypeConsume,
		UserId:    1,
		Username:  "alice",
		ModelName: "gpt-4",
		CreatedAt: now,
		Content:   longContent,
		ChannelId: 11,
	}).Error)

	data, err := GetModelRequestStatuses(now, now+10, "", "model_name", 10, 1)
	require.NoError(t, err)
	require.Len(t, data, 1)
	require.Len(t, data[0].Requests, 1)
	// Content truncated to 200 runes
	assert.LessOrEqual(t, len([]rune(data[0].Requests[0].Content)), modelStatusContentLimit)
}