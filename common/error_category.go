package common

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

const (
	ErrorCategoryRateLimit      = "rate_limit"
	ErrorCategoryQuota          = "quota"
	ErrorCategoryUnavailable    = "unavailable"
	ErrorCategoryNotFound       = "not_found"
	ErrorCategoryTimeout        = "timeout"
	ErrorCategoryZeroOutput     = "zero_output"
	ErrorCategoryUpstream       = "upstream"
	ErrorCategoryAuth           = "auth"
	ErrorCategoryInvalidRequest = "invalid_request"
	ErrorCategoryUnknown        = "unknown"
)

func CategorizeErrorLog(errorCode string, statusCode int, zeroOutput bool) string {
	if zeroOutput {
		return ErrorCategoryZeroOutput
	}
	lower := strings.ToLower(strings.TrimSpace(errorCode))
	if cat := categorizeErrorCode(lower); cat != "" {
		return cat
	}
	if cat := categorizeHTTPStatus(statusCode); cat != "" {
		return cat
	}
	if lower == "" || lower == "unknown" || lower == "unknown_error" {
		return ErrorCategoryUnknown
	}
	return ErrorCategoryUpstream
}

func CategorizeErrorLogFromOther(other map[string]interface{}) string {
	if other == nil {
		return ErrorCategoryUnknown
	}
	if cat := mapLookupString(other, "error_category"); cat != "" {
		return cat
	}
	status := mapLookupInt(other, "status_code")
	if status == 0 {
		status = mapLookupInt(other, "upstream_status_code")
	}
	return CategorizeErrorLog(
		mapLookupString(other, "error_code"),
		status,
		mapLookupBool(other, "zero_output"),
	)
}

func AttachErrorLogCategory(other map[string]interface{}) {
	if other == nil {
		return
	}
	code := mapLookupString(other, "error_code")
	if code == "" {
		extractedCode, extractedType := ExtractErrorFromChunkSample(mapLookupString(other, "upstream_chunk_sample"))
		if extractedCode != "" {
			other["error_code"] = extractedCode
			code = extractedCode
		}
		if extractedType != "" && mapLookupString(other, "error_type") == "" {
			other["error_type"] = extractedType
		}
	}
	status := mapLookupInt(other, "status_code")
	if status == 0 {
		status = mapLookupInt(other, "upstream_status_code")
	}
	other["error_category"] = CategorizeErrorLog(code, status, mapLookupBool(other, "zero_output"))
}

func ExtractErrorFromChunkSample(sample string) (code string, errType string) {
	sample = strings.TrimSpace(sample)
	if sample == "" {
		return "", ""
	}
	for _, line := range strings.Split(sample, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "data:") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		}
		if line == "" || line == "[DONE]" {
			continue
		}
		code, errType = extractErrorObject(line)
		if code != "" || errType != "" {
			return code, errType
		}
	}
	return extractErrorObject(sample)
}

func extractErrorObject(raw string) (string, string) {
	var payload struct {
		Error *struct {
			Code any    `json:"code"`
			Type string `json:"type"`
		} `json:"error"`
	}
	if Unmarshal([]byte(raw), &payload) != nil || payload.Error == nil {
		return "", ""
	}
	return stringifyErrorCode(payload.Error.Code), payload.Error.Type
}

func stringifyErrorCode(code any) string {
	switch v := code.(type) {
	case nil:
		return ""
	case string:
		return v
	case float64:
		if v == float64(int64(v)) {
			return strconv.FormatInt(int64(v), 10)
		}
		return strconv.FormatFloat(v, 'f', -1, 64)
	case json.Number:
		return v.String()
	default:
		return fmt.Sprint(v)
	}
}

func categorizeErrorCode(lower string) string {
	if lower == "" || lower == "unknown" || lower == "unknown_error" {
		return ""
	}
	if lower == "upstream_empty_completion" || strings.Contains(lower, "zero_output") {
		return ErrorCategoryZeroOutput
	}
	if isRateLimitCode(lower) {
		return ErrorCategoryRateLimit
	}
	if isQuotaCode(lower) {
		return ErrorCategoryQuota
	}
	if isAuthCode(lower) {
		return ErrorCategoryAuth
	}
	if isInvalidRequestCode(lower) {
		return ErrorCategoryInvalidRequest
	}
	if isNotFoundCode(lower) {
		return ErrorCategoryNotFound
	}
	if isTimeoutCode(lower) {
		return ErrorCategoryTimeout
	}
	if isUnavailableCode(lower) {
		return ErrorCategoryUnavailable
	}
	if n, err := strconv.Atoi(lower); err == nil {
		return categorizeHTTPStatus(n)
	}
	return ""
}

func isRateLimitCode(lower string) bool {
	if strings.Contains(lower, "rate") || strings.Contains(lower, "too_many") || strings.Contains(lower, "too many") {
		return true
	}
	return lower == "429" || strings.HasPrefix(lower, "429")
}

func isQuotaCode(lower string) bool {
	return strings.Contains(lower, "quota") ||
		strings.Contains(lower, "billing") ||
		strings.Contains(lower, "credit") ||
		strings.Contains(lower, "balance") ||
		strings.Contains(lower, "freetier") ||
		strings.Contains(lower, "insufficient")
}

func isAuthCode(lower string) bool {
	return strings.Contains(lower, "invalid_api_key") ||
		strings.Contains(lower, "authentication") ||
		strings.Contains(lower, "unauthorized") ||
		strings.Contains(lower, "access_denied") ||
		strings.Contains(lower, "permission") ||
		lower == "401"
}

func isInvalidRequestCode(lower string) bool {
	return strings.Contains(lower, "invalid_request") ||
		strings.Contains(lower, "bad_request") ||
		lower == "400"
}

func isNotFoundCode(lower string) bool {
	return strings.Contains(lower, "not_found") || lower == "404"
}

func isTimeoutCode(lower string) bool {
	return strings.Contains(lower, "timeout") || lower == "504" || lower == "408"
}

func isUnavailableCode(lower string) bool {
	return strings.Contains(lower, "unavailable") ||
		strings.Contains(lower, "overloaded") ||
		strings.Contains(lower, "over_loaded") ||
		lower == "500" || lower == "502" || lower == "503"
}

func categorizeHTTPStatus(statusCode int) string {
	switch statusCode {
	case 400:
		return ErrorCategoryInvalidRequest
	case 401, 403:
		return ErrorCategoryAuth
	case 404:
		return ErrorCategoryNotFound
	case 408, 504:
		return ErrorCategoryTimeout
	case 429:
		return ErrorCategoryRateLimit
	case 500, 502, 503:
		return ErrorCategoryUnavailable
	default:
		return ""
	}
}

func mapLookupString(m map[string]interface{}, key string) string {
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	switch x := v.(type) {
	case string:
		return x
	case int:
		return strconv.Itoa(x)
	case int64:
		return strconv.FormatInt(x, 10)
	case float64:
		if x == float64(int64(x)) {
			return strconv.FormatInt(int64(x), 10)
		}
		return strconv.FormatFloat(x, 'f', -1, 64)
	case json.Number:
		return x.String()
	default:
		return fmt.Sprint(x)
	}
}

func mapLookupInt(m map[string]interface{}, key string) int {
	v, ok := m[key]
	if !ok || v == nil {
		return 0
	}
	switch x := v.(type) {
	case int:
		return x
	case int64:
		return int(x)
	case float64:
		return int(x)
	case json.Number:
		n, err := x.Int64()
		if err != nil {
			return 0
		}
		return int(n)
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(x))
		if err != nil {
			return 0
		}
		return n
	default:
		return 0
	}
}

func mapLookupBool(m map[string]interface{}, key string) bool {
	v, ok := m[key]
	if !ok || v == nil {
		return false
	}
	switch x := v.(type) {
	case bool:
		return x
	case string:
		return x == "true" || x == "1"
	default:
		return false
	}
}
