package model

import (
	"os"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/clickhouse"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

// channelTestResultLogs covers the rows the query must pick and the rows it must ignore.
func channelTestResultLogs() []Log {
	return []Log{
		// Newer test wins over the older one for the same model.
		{Type: LogTypeConsume, TokenId: 0, TokenName: channelTestLogTokenName, ModelName: "gpt-4o", ChannelId: 9, CreatedAt: 100},
		{Type: LogTypeConsume, TokenId: 0, TokenName: channelTestLogTokenName, ModelName: "gpt-4o", ChannelId: 9, CreatedAt: 300},
		{Type: LogTypeConsume, TokenId: 0, TokenName: channelTestLogTokenName, ModelName: "claude-3", ChannelId: 9, CreatedAt: 200},
		// User tokens may share the display name; only token_id = 0 marks a channel test.
		{Type: LogTypeConsume, TokenId: 5, TokenName: channelTestLogTokenName, ModelName: "user-model", ChannelId: 9, CreatedAt: 400},
		// Failed manual tests write an error log without a model name.
		{Type: LogTypeError, TokenId: 0, TokenName: channelTestLogTokenName, ModelName: "", ChannelId: 9, CreatedAt: 500},
		// Another channel must not leak into the result.
		{Type: LogTypeConsume, TokenId: 0, TokenName: channelTestLogTokenName, ModelName: "other-channel", ChannelId: 10, CreatedAt: 600},
	}
}

func assertChannelTestResults(t *testing.T, db *gorm.DB) {
	t.Helper()

	previousLogDB := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = previousLogDB })

	logs := channelTestResultLogs()
	require.NoError(t, db.Create(&logs).Error)

	results, err := GetChannelTestResults(9)
	require.NoError(t, err)
	assert.ElementsMatch(t, []ChannelTestResult{
		{ModelName: "gpt-4o", TestedAt: 300},
		{ModelName: "claude-3", TestedAt: 200},
	}, results)

	empty, err := GetChannelTestResults(0)
	require.NoError(t, err)
	assert.Empty(t, empty)
}

func TestGetChannelTestResultsDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var dialector gorm.Dialector
			switch dialect {
			case "sqlite":
				dialector = sqlite.Open(":memory:")
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
				dialector = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
				dialector = postgres.Open(dsn)
			}

			db, err := gorm.Open(dialector, &gorm.Config{
				NamingStrategy: schema.NamingStrategy{TablePrefix: "channel_test_result_"},
			})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)

			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&Log{}))
				require.NoError(t, sqlDB.Close())
			})
			require.NoError(t, db.AutoMigrate(&Log{}))

			assertChannelTestResults(t, db)
		})
	}
}

// TestGetChannelTestResultsClickHouse covers the separately configured log database,
// whose logs table is created by raw DDL instead of AutoMigrate.
func TestGetChannelTestResultsClickHouse(t *testing.T) {
	dsn := os.Getenv("TEST_CLICKHOUSE_DSN")
	if dsn == "" {
		t.Skip("TEST_CLICKHOUSE_DSN is not configured")
	}

	db, err := gorm.Open(clickhouse.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)

	t.Cleanup(func() {
		require.NoError(t, db.Exec("DROP TABLE IF EXISTS logs").Error)
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.Exec(clickHouseLogCreateTableSQL(0)).Error)

	assertChannelTestResults(t, db)
}
