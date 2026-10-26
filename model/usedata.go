package model

import (
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// TokenQuotaData is a per-token aggregate row returned by the token analytics
// endpoint. Unlike QuotaData it groups by token_id and carries the resolved
// token name (empty string for deleted tokens).
type TokenQuotaData struct {
	TokenID   int    `json:"token_id"`
	TokenName string `json:"token_name"`
	CreatedAt int64  `json:"created_at"`
	Count     int    `json:"count"`
	Quota     int    `json:"quota"`
	TokenUsed int    `json:"token_used"`
}

// QuotaData 柱状图数据
type QuotaData struct {
	Id        int    `json:"id"`
	UserID    int    `json:"user_id" gorm:"index"`
	Username  string `json:"username" gorm:"index:idx_qdt_model_user_name,priority:2;size:64;default:''"`
	ModelName string `json:"model_name" gorm:"index:idx_qdt_model_user_name,priority:1;size:64;default:''"`
	// UpstreamModelName 渠道模型映射后的模型名（未映射时等于 ModelName）
	UpstreamModelName string `json:"upstream_model_name" gorm:"size:64;default:''"`
	CreatedAt         int64  `json:"created_at" gorm:"bigint;index:idx_qdt_created_at,priority:2"`
	UseGroup          string `json:"use_group" gorm:"index;size:64;default:''"`
	TokenID           int    `json:"token_id" gorm:"index;default:0"`
	ChannelID         int    `json:"channel_id" gorm:"index;default:0"`
	NodeName          string `json:"node_name" gorm:"index;size:64;default:''"`
	TokenUsed         int    `json:"token_used" gorm:"default:0"`
	Count             int    `json:"count" gorm:"default:0"`
	Quota             int    `json:"quota" gorm:"default:0"`
}

type QuotaDataLogParams struct {
	UserID            int
	Username          string
	ModelName         string
	UpstreamModelName string
	Quota             int
	CreatedAt         int64
	TokenUsed         int
	UseGroup          string
	TokenID           int
	ChannelID         int
	NodeName          string
}

func UpdateQuotaData() {
	for {
		if common.DataExportEnabled {
			common.SysLog("正在更新数据看板数据...")
			SaveQuotaDataCache()
		}
		time.Sleep(time.Duration(common.DataExportInterval) * time.Minute)
	}
}

var CacheQuotaData = make(map[string]*QuotaData)
var CacheQuotaDataLock = sync.Mutex{}

func logQuotaDataCache(quotaData *QuotaData) {
	key := fmt.Sprintf("%d\x00%s\x00%s\x00%s\x00%d\x00%s\x00%d\x00%d\x00%s",
		quotaData.UserID,
		quotaData.Username,
		quotaData.ModelName,
		quotaData.UpstreamModelName,
		quotaData.CreatedAt,
		quotaData.UseGroup,
		quotaData.TokenID,
		quotaData.ChannelID,
		quotaData.NodeName,
	)
	count := quotaData.Count
	quota := quotaData.Quota
	tokenUsed := quotaData.TokenUsed
	cachedQuotaData, ok := CacheQuotaData[key]
	if ok {
		cachedQuotaData.Count += count
		cachedQuotaData.Quota += quota
		cachedQuotaData.TokenUsed += tokenUsed
		quotaData = cachedQuotaData
	}
	CacheQuotaData[key] = quotaData
}

func LogQuotaData(params QuotaDataLogParams) {
	// 只精确到小时
	createdAt := params.CreatedAt - (params.CreatedAt % 3600)
	upstreamModelName := params.UpstreamModelName
	if upstreamModelName == "" {
		upstreamModelName = params.ModelName
	}
	quotaData := &QuotaData{
		UserID:            params.UserID,
		Username:          params.Username,
		ModelName:         params.ModelName,
		UpstreamModelName: upstreamModelName,
		CreatedAt:         createdAt,
		UseGroup:          params.UseGroup,
		TokenID:           params.TokenID,
		ChannelID:         params.ChannelID,
		NodeName:          params.NodeName,
		Count:             1,
		Quota:             params.Quota,
		TokenUsed:         params.TokenUsed,
	}

	CacheQuotaDataLock.Lock()
	defer CacheQuotaDataLock.Unlock()
	logQuotaDataCache(quotaData)
}

func SaveQuotaDataCache() {
	CacheQuotaDataLock.Lock()
	defer CacheQuotaDataLock.Unlock()
	size := len(CacheQuotaData)
	// 如果缓存中有数据，就保存到数据库中
	// 1. 先查询数据库中是否有数据
	// 2. 如果有数据，就更新数据
	// 3. 如果没有数据，就插入数据
	for _, quotaData := range CacheQuotaData {
		quotaDataDB := &QuotaData{}
		DB.Table("quota_data").
			Where("user_id = ? and username = ? and model_name = ? and upstream_model_name = ? and created_at = ? and use_group = ? and token_id = ? and channel_id = ? and node_name = ?",
				quotaData.UserID, quotaData.Username, quotaData.ModelName, quotaData.UpstreamModelName, quotaData.CreatedAt, quotaData.UseGroup, quotaData.TokenID, quotaData.ChannelID, quotaData.NodeName).
			First(quotaDataDB)
		if quotaDataDB.Id > 0 {
			//quotaDataDB.Count += quotaData.Count
			//quotaDataDB.Quota += quotaData.Quota
			//DB.Table("quota_data").Save(quotaDataDB)
			increaseQuotaData(quotaData)
		} else {
			DB.Table("quota_data").Create(quotaData)
		}
	}
	CacheQuotaData = make(map[string]*QuotaData)
	common.SysLog(fmt.Sprintf("保存数据看板数据成功，共保存%d条数据", size))
}

func increaseQuotaData(quotaData *QuotaData) {
	err := DB.Table("quota_data").
		Where("user_id = ? and username = ? and model_name = ? and upstream_model_name = ? and created_at = ? and use_group = ? and token_id = ? and channel_id = ? and node_name = ?",
			quotaData.UserID, quotaData.Username, quotaData.ModelName, quotaData.UpstreamModelName, quotaData.CreatedAt, quotaData.UseGroup, quotaData.TokenID, quotaData.ChannelID, quotaData.NodeName).
		Updates(map[string]any{
			"count":      gorm.Expr("count + ?", quotaData.Count),
			"quota":      gorm.Expr("quota + ?", quotaData.Quota),
			"token_used": gorm.Expr("token_used + ?", quotaData.TokenUsed),
		}).Error
	if err != nil {
		common.SysLog(fmt.Sprintf("increaseQuotaData error: %s", err))
	}
}

func GetQuotaDataByUsername(username string, startTime int64, endTime int64, aggregateBy string) (quotaData []*QuotaData, err error) {
	var quotaDatas []*QuotaData
	// 从quota_data表中查询数据
	modelSel := modelAggregateColumn(aggregateBy)
	modelGroup := modelAggregateGroupColumn(aggregateBy)
	err = DB.Table("quota_data").
		Select("user_id, username, "+modelSel+", created_at, sum(count) as count, sum(quota) as quota, sum(token_used) as token_used").
		Where("username = ? and created_at >= ? and created_at <= ?", username, startTime, endTime).
		Group("user_id, username, " + modelGroup + ", created_at").
		Find(&quotaDatas).Error
	return quotaDatas, err
}

func GetQuotaDataByUserId(userId int, startTime int64, endTime int64, aggregateBy string) (quotaData []*QuotaData, err error) {
	var quotaDatas []*QuotaData
	// 从quota_data表中查询数据
	modelSel := modelAggregateColumn(aggregateBy)
	modelGroup := modelAggregateGroupColumn(aggregateBy)
	err = DB.Table("quota_data").
		Select("user_id, username, "+modelSel+", created_at, sum(count) as count, sum(quota) as quota, sum(token_used) as token_used").
		Where("user_id = ? and created_at >= ? and created_at <= ?", userId, startTime, endTime).
		Group("user_id, username, " + modelGroup + ", created_at").
		Find(&quotaDatas).Error
	return quotaDatas, err
}

func GetQuotaDataGroupByUser(startTime int64, endTime int64) (quotaData []*QuotaData, err error) {
	var quotaDatas []*QuotaData
	err = DB.Table("quota_data").
		Select("username, created_at, sum(count) as count, sum(quota) as quota, sum(token_used) as token_used").
		Where("created_at >= ? and created_at <= ?", startTime, endTime).
		Group("username, created_at").
		Find(&quotaDatas).Error
	return quotaDatas, err
}

// modelAggregateColumn 返回 SELECT 中模型列的表达式。
// default（model_name）：使用请求模型列；upstream_model_name：把上游模型列
// 别名成 model_name 返回，前端无需感知维度切换，图表标签直接显示所选维度模型名。
func modelAggregateColumn(aggregateBy string) string {
	if aggregateBy == "upstream_model_name" {
		return "upstream_model_name as model_name"
	}
	return "model_name"
}

// modelAggregateGroupColumn 返回 GROUP BY 中模型列名（不使用别名，避免依赖数据库别名分组的兼容性差异）。
func modelAggregateGroupColumn(aggregateBy string) string {
	if aggregateBy == "upstream_model_name" {
		return "upstream_model_name"
	}
	return "model_name"
}

func GetAllQuotaDates(startTime int64, endTime int64, username string, aggregateBy string) (quotaData []*QuotaData, err error) {
	if username != "" {
		return GetQuotaDataByUsername(username, startTime, endTime, aggregateBy)
	}
	var quotaDatas []*QuotaData
	// 从quota_data表中查询数据
	// only select model_name, sum(count) as count, sum(quota) as quota, model_name, created_at from quota_data group by model_name, created_at;
	//err = DB.Table("quota_data").Where("created_at >= ? and created_at <= ?", startTime, endTime).Find(&quotaDatas).Error
	modelSel := modelAggregateColumn(aggregateBy)
	modelGroup := modelAggregateGroupColumn(aggregateBy)
	err = DB.Table("quota_data").Select(modelSel+", sum(count) as count, sum(quota) as quota, sum(token_used) as token_used, created_at").Where("created_at >= ? and created_at <= ?", startTime, endTime).Group(modelGroup + ", created_at").Find(&quotaDatas).Error
	return quotaDatas, err
}

// tokenNameByID resolves token_id to token name from the tokens table.
// IDs with no matching token (deleted) are returned as empty string.
// To avoid N+1 queries we batch-fetch all needed names in one query.
func tokenNamesByID(tokenIDs []int) (map[int]string, error) {
	if len(tokenIDs) == 0 {
		return nil, nil
	}
	type tokenNameRow struct {
		Id   int
		Name string
	}
	var rows []tokenNameRow
	err := DB.Table("tokens").Select("id, name").Where("id IN ?", tokenIDs).Find(&rows).Error
	if err != nil {
		return nil, err
	}
	names := make(map[int]string, len(rows))
	for _, row := range rows {
		names[row.Id] = row.Name
	}
	return names, nil
}

// GetQuotaDataGroupByToken aggregates quota_data by token_id, enriching each
// row with the token name from the tokens table. Deleted tokens show an empty
// name. The returned QuotaData items use TokenID and the Name field on the
// Username column is left empty — the token name is carried via a separate
// field to avoid overloading username semantics.
func GetQuotaDataGroupByToken(startTime int64, endTime int64, username string) ([]*TokenQuotaData, error) {
	type rawTokenAgg struct {
		TokenID   int
		CreatedAt int64
		Count     int
		Quota     int
		TokenUsed int
	}
	var rows []rawTokenAgg
	query := DB.Table("quota_data").
		Select("token_id, created_at, sum(count) as count, sum(quota) as quota, sum(token_used) as token_used").
		Where("created_at >= ? and created_at <= ? and token_id > 0", startTime, endTime).
		Group("token_id, created_at").
		Order("created_at ASC")
	if username != "" {
		query = query.Where("username = ?", username)
	}
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}

	// Collect unique token IDs for batch name lookup
	idSet := make(map[int]struct{})
	for _, r := range rows {
		idSet[r.TokenID] = struct{}{}
	}
	tokenIDs := make([]int, 0, len(idSet))
	for id := range idSet {
		tokenIDs = append(tokenIDs, id)
	}
	names, err := tokenNamesByID(tokenIDs)
	if err != nil {
		return nil, err
	}

	result := make([]*TokenQuotaData, 0, len(rows))
	for _, r := range rows {
		result = append(result, &TokenQuotaData{
			TokenID:   r.TokenID,
			TokenName: names[r.TokenID],
			CreatedAt: r.CreatedAt,
			Count:     r.Count,
			Quota:     r.Quota,
			TokenUsed: r.TokenUsed,
		})
	}
	return result, nil
}

// GetQuotaDataGroupByTokenByUser is the per-user variant, scoped to userId.
func GetQuotaDataGroupByTokenByUser(userId int, startTime int64, endTime int64) ([]*TokenQuotaData, error) {
	type rawTokenAgg struct {
		TokenID   int
		CreatedAt int64
		Count     int
		Quota     int
		TokenUsed int
	}
	var rows []rawTokenAgg
	err := DB.Table("quota_data").
		Select("token_id, created_at, sum(count) as count, sum(quota) as quota, sum(token_used) as token_used").
		Where("user_id = ? and created_at >= ? and created_at <= ? and token_id > 0", userId, startTime, endTime).
		Group("token_id, created_at").
		Order("created_at ASC").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}

	idSet := make(map[int]struct{})
	for _, r := range rows {
		idSet[r.TokenID] = struct{}{}
	}
	tokenIDs := make([]int, 0, len(idSet))
	for id := range idSet {
		tokenIDs = append(tokenIDs, id)
	}
	names, err := tokenNamesByID(tokenIDs)
	if err != nil {
		return nil, err
	}

	result := make([]*TokenQuotaData, 0, len(rows))
	for _, r := range rows {
		result = append(result, &TokenQuotaData{
			TokenID:   r.TokenID,
			TokenName: names[r.TokenID],
			CreatedAt: r.CreatedAt,
			Count:     r.Count,
			Quota:     r.Quota,
			TokenUsed: r.TokenUsed,
		})
	}
	return result, nil
}
