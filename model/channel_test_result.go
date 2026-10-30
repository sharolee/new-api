package model

import (
	"fmt"
)

// channelTestLogTokenName mirrors the token name written by controller/channel-test.go
// when a manual channel test succeeds. Real relay requests always carry a token id > 0,
// so requiring token_id = 0 keeps user tokens that happen to be named the same out.
const channelTestLogTokenName = "模型测试"

// ChannelTestResult is the latest successful manual test time of one model.
type ChannelTestResult struct {
	ModelName string `json:"model_name"`
	TestedAt  int64  `json:"tested_at"`
}

// GetChannelTestResults returns the latest successful test time per model for a channel.
// Only consume logs (type=2) can be attributed to a model: failed manual tests write an
// error log from the request context, which never carries original_model on that path.
func GetChannelTestResults(channelId int) ([]ChannelTestResult, error) {
	if channelId <= 0 || LOG_DB == nil {
		return []ChannelTestResult{}, nil
	}

	results := make([]ChannelTestResult, 0)
	err := LOG_DB.Model(&Log{}).
		Select("model_name as model_name, MAX(created_at) as tested_at").
		Where("type = ?", LogTypeConsume).
		Where("token_id = ?", 0).
		Where("token_name = ?", channelTestLogTokenName).
		Where("channel_id = ?", channelId).
		Where("model_name <> ?", "").
		Group("model_name").
		Find(&results).Error
	if err != nil {
		return nil, fmt.Errorf("查询渠道测试记录失败: %w", err)
	}
	return results, nil
}
