package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetErrorLogStatsCountsErrorLogsAndFillsByDate(t *testing.T) {
	truncateTables(t)

	hour := int64(3600)
	firstBucket := hour * 100
	secondBucket := hour * 101

	require.NoError(t, LOG_DB.Create(&Log{
		Type:      LogTypeError,
		ChannelId: 11,
		Username:  "alice",
		ModelName: "gpt-4",
		CreatedAt: firstBucket + 10,
		Content:   "upstream 429",
		Other: common.MapToJsonStr(map[string]interface{}{
			"error_code":  "429",
			"status_code": 429,
		}),
	}).Error)
	require.NoError(t, LOG_DB.Create(&Log{
		Type:      LogTypeError,
		ChannelId: 22,
		Username:  "bob",
		ModelName: "gpt-4",
		CreatedAt: secondBucket + 10,
		Content:   "upstream 500",
		Other: common.MapToJsonStr(map[string]interface{}{
			"error_code":  "500",
			"status_code": 500,
		}),
	}).Error)
	require.NoError(t, LOG_DB.Create(&Log{
		Type:      LogTypeConsume,
		ChannelId: 11,
		Username:  "alice",
		ModelName: "gpt-4",
		CreatedAt: firstBucket + 20,
		Content:   "success",
	}).Error)

	stats, err := GetErrorLogStats(firstBucket, secondBucket+hour, "", "", "", 0, "hour")
	require.NoError(t, err)
	require.NotNil(t, stats)

	assert.Equal(t, 2, stats.Total)
	assert.Equal(t, 1, stats.ByChannel["11"])
	assert.Equal(t, 1, stats.ByChannel["22"])
	assert.Equal(t, 1, stats.ByError[common.ErrorCategoryRateLimit])
	assert.Equal(t, 1, stats.ByError[common.ErrorCategoryUnavailable])
	require.Len(t, stats.ByDate, 2)
	assert.Equal(t, "360000", stats.ByDate[0].Date)
	assert.Equal(t, 1, stats.ByDate[0].Total)
	assert.Equal(t, "363600", stats.ByDate[1].Date)
	assert.Equal(t, 1, stats.ByDate[1].Total)

	logs, total, err := GetAllLogs(LogTypeError, firstBucket, secondBucket+hour, "", "", "", 0, 10, 0, "", "", "")
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	require.Len(t, logs, 2)
	for _, log := range logs {
		assert.Equal(t, LogTypeError, log.Type)
	}
}

func TestGetErrorLogStatsGroupsByCategoryNotRawCode(t *testing.T) {
	truncateTables(t)

	now := int64(3600 * 200)
	require.NoError(t, LOG_DB.Create(&Log{
		Type:      LogTypeError,
		ChannelId: 1,
		CreatedAt: now,
		Other: common.MapToJsonStr(map[string]interface{}{
			"error_code":  "429",
			"status_code": 429,
		}),
	}).Error)
	require.NoError(t, LOG_DB.Create(&Log{
		Type:      LogTypeError,
		ChannelId: 1,
		CreatedAt: now + 1,
		Other: common.MapToJsonStr(map[string]interface{}{
			"error_code":  "429001",
			"status_code": 429,
		}),
	}).Error)
	require.NoError(t, LOG_DB.Create(&Log{
		Type:      LogTypeError,
		ChannelId: 2,
		CreatedAt: now + 2,
		Other: common.MapToJsonStr(map[string]interface{}{
			"error_code":  "bad_response_status_code",
			"status_code": 404,
		}),
	}).Error)
	require.NoError(t, LOG_DB.Create(&Log{
		Type:      LogTypeError,
		ChannelId: 2,
		CreatedAt: now + 3,
		Other: common.MapToJsonStr(map[string]interface{}{
			"zero_output": true,
		}),
	}).Error)
	require.NoError(t, LOG_DB.Create(&Log{
		Type:      LogTypeError,
		ChannelId: 3,
		CreatedAt: now + 4,
		Other: common.MapToJsonStr(map[string]interface{}{
			"error_category": "quota",
			"error_code":     "AllocationQuota.FreeTierOnly",
			"status_code":    403,
		}),
	}).Error)

	stats, err := GetErrorLogStats(now, now+10, "", "", "", 0, "hour")
	require.NoError(t, err)
	require.NotNil(t, stats)

	assert.Equal(t, 5, stats.Total)
	assert.Equal(t, 2, stats.ByError[common.ErrorCategoryRateLimit])
	assert.Equal(t, 1, stats.ByError[common.ErrorCategoryNotFound])
	assert.Equal(t, 1, stats.ByError[common.ErrorCategoryZeroOutput])
	assert.Equal(t, 1, stats.ByError[common.ErrorCategoryQuota])
	assert.Empty(t, stats.ByError["429"])
	assert.Empty(t, stats.ByError["429001"])
	assert.Empty(t, stats.ByError["bad_response_status_code"])

	var quotaDetail *ErrorLogStatsItem
	for i := range stats.Detail {
		if stats.Detail[i].ErrorCode == common.ErrorCategoryQuota {
			quotaDetail = &stats.Detail[i]
			break
		}
	}
	require.NotNil(t, quotaDetail)
	assert.Equal(t, 3, quotaDetail.ChannelId)
	assert.Equal(t, 1, quotaDetail.Count)
}
