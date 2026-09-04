package middleware

import (
	"fmt"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

const (
	EmailVerificationRateLimitMark = "EV"
	EmailVerificationMaxRequests   = 2  // 30秒内最多2次
	EmailVerificationDuration      = 30 // 30秒时间窗口
)

func redisEmailVerificationRateLimiter(c *gin.Context) {
	allowed, _, ttlSeconds, err := redisFixedWindowTake(
		c.Request.Context(),
		redisIPRateLimitKey(EmailVerificationRateLimitMark, c.ClientIP()),
		EmailVerificationMaxRequests,
		EmailVerificationDuration,
	)
	if err != nil {
		memoryEmailVerificationRateLimiter(c)
		return
	}
	if allowed {
		c.Next()
		return
	}

	waitSeconds := int64(EmailVerificationDuration)
	if ttlSeconds > 0 {
		waitSeconds = ttlSeconds
	}

	requestPath := c.Request.URL.Path
	model.RecordMiddlewareErrorLog(c, 0, "", http.StatusTooManyRequests,
		fmt.Sprintf("发送过于频繁，请等待 %d 秒后再试", waitSeconds), "rate_limit_exceeded", requestPath)

	c.JSON(http.StatusTooManyRequests, gin.H{
		"success": false,
		"message": fmt.Sprintf("发送过于频繁，请等待 %d 秒后再试", waitSeconds),
	})
	c.Abort()
}

func memoryEmailVerificationRateLimiter(c *gin.Context) {
	key := EmailVerificationRateLimitMark + ":" + c.ClientIP()

	if !inMemoryRateLimiter.Request(key, EmailVerificationMaxRequests, EmailVerificationDuration) {
		requestPath := c.Request.URL.Path
		model.RecordMiddlewareErrorLog(c, 0, "", http.StatusTooManyRequests,
			"发送过于频繁，请稍后再试", "rate_limit_exceeded", requestPath)
		c.JSON(http.StatusTooManyRequests, gin.H{
			"success": false,
			"message": "发送过于频繁，请稍后再试",
		})
		c.Abort()
		return
	}

	c.Next()
}

func EmailVerificationRateLimit() gin.HandlerFunc {
	// Keep the fallback ready before requests arrive so a concurrent Redis
	// outage cannot race the in-memory limiter's first initialization.
	inMemoryRateLimiter.Init(common.RateLimitKeyExpirationDuration)
	return func(c *gin.Context) {
		if common.RedisEnabled {
			redisEmailVerificationRateLimiter(c)
		} else {
			memoryEmailVerificationRateLimiter(c)
		}
	}
}
