# 零输出请求诊断打标方案

> 目标：在不改变任何现有策略的前提下，让"上游渠道 completion_tokens=0"的请求在使用日志中显示具体原因，并纳入 admin 错误统计。

## 一、现状问题

目前上游返回 `prompt_tokens > 0, completion_tokens == 0` 的请求：

1. **consume log 里只有数字**：`completion_tokens=0`，没有"为什么是 0"的说明
2. **不进错误统计**：`model/log.go` 第 790 行只从 `other["error_code"]` 读，而 handler 从不为这类请求设置 `error_code`
3. **admin 后台看不到**：`other.admin_info` 里没有零输出相关的诊断字段

## 二、方案概述

**只贴标签，不改流程**：每个 handler 在检测出"prompt>0 且 completion=0"时，往 gin context 里塞两个 key；`service/log_info_generate.go` 读取这两个 key，写入 `admin_info.zero_output`（细粒度 reason，仅 admin 可见）和 `other.error_code`（粗粒度错误码，驱动错误统计面板）。

### 2.1 新增 error code

文件：`relaykit/types/error.go`

在 `ErrorCode` const 块中新增：

```go
// upstream 返回了 HTTP 200 + 合法 usage 结构，但 completion_tokens=0 且 prompt_tokens>0
// 归一化成一个可统计的错误码，进 admin 错误分布面板
ErrorCodeUpstreamEmptyCompletion ErrorCode = "upstream_empty_completion"
```

### 2.2 新增 context keys

文件：`constant/context_key.go`

在 const 块末尾新增：

```go
// ContextKeyZeroOutputReason: 细粒度原因字符串（upstream_usage_zero / stream_empty / tool_call_only 等）
ContextKeyZeroOutputReason ContextKey = "zero_output_reason"

// ContextKeyZeroOutputHasText: 上游流/响应是否实际产生了非空文本
ContextKeyZeroOutputHasText ContextKey = "zero_output_has_text"
```

### 2.3 新增 reason 枚举

新文件：`service/zero_output_reason.go`

```go
package service

const (
    // 上游给了完整 usage 但 completion_tokens=0，且 prompt_tokens>0（最常见）
    ZeroOutputUpstreamUsageZero = "upstream_usage_zero"

    // 上游没有给 usage 块，本地重算文本后仍为 0（畸形响应 / 中途断开）
    ZeroOutputUpstreamNoUsage = "upstream_no_usage"

    // 上游 usage 缺失或为 0，本地重算也返回 0（确实没有产出）
    ZeroOutputLocalRecountZero = "local_recount_zero"

    // 上游 usage 为 0，但本地重算出了非零值（已自愈，不算错误）
    ZeroOutputLocalRecountNonzero = "local_recount_nonzero"

    // 流式 relay 累计了 0 个非空 content chunk（只有 role-only delta / usage-only 帧）
    ZeroOutputStreamEmpty = "stream_empty"

    // 上游只产出了 tool_calls，没有用户可见文本
    ZeroOutputToolCallOnly = "tool_call_only"

    // image 生成 API：completion_tokens 不适用，诊断信息，不算错误
    ZeroOutputImageOnly = "image_only"

    // TTS/audio API：completion_tokens 由音频时长推导，诊断信息，不算错误
    ZeroOutputAudioOnly = "audio_only"
)

func IsZeroOutputProblem(reason string) bool {
    switch reason {
    case ZeroOutputUpstreamUsageZero, ZeroOutputUpstreamNoUsage,
        ZeroOutputLocalRecountZero, ZeroOutputStreamEmpty, ZeroOutputToolCallOnly:
        return true
    default:
        return false
    }
}
```

### 2.4 写入 consume log

文件：`service/log_info_generate.go`

在 `GenerateTextOtherInfo` 函数中，紧跟 `isLocalCountTokens` 那段之后、`AppendChannelAffinityAdminInfo` 之前，插入：

```go
// Zero-output diagnostic
zeroOutputReason := common.GetContextKey(ctx, constant.ContextKeyZeroOutputReason)
zeroOutputHasText := common.GetContextKeyBool(ctx, constant.ContextKeyZeroOutputHasText)
if zeroOutputReason != nil {
    reasonStr := zeroOutputReason.(string)
    if reasonStr != "" {
        zeroOutputInfo := map[string]interface{}{
            "reason":   reasonStr,
            "has_text": zeroOutputHasText,
        }
        adminInfo["zero_output"] = zeroOutputInfo

        if IsZeroOutputProblem(reasonStr) {
            other["error_code"] = string(types.ErrorCodeUpstreamEmptyCompletion)
        }
    }
}
```

不需要改 `model/log.go`——它已经在第 790 行从 `other["error_code"]` 读，自动进错误统计。

## 三、各 handler 侧注入

### 3.1 OpenaiHandler（非流式）— `relay/channel/openai/relay-openai.go`

位置：`usageModified := false` 分支结束后、`applyUsagePostProcessing` 之前。

逻辑：

- 如果 `PromptTokens > 0 && CompletionTokens == 0`：
  - 遍历 Choices，检查是否有 tool_calls 无文本 → `tool_call_only`
  - 否则如果是上游直接给的 usage（`!usageModified`）→ `upstream_usage_zero`
  - 否则是补算后仍为 0（`usageModified`）→ `local_recount_zero`
- 如果 `usageModified` 且 `CompletionTokens > 0`（补算自愈）→ `local_recount_nonzero`（诊断，不算错）

### 3.2 OaiStreamHandler（流式）— `relay/channel/openai/relay-openai.go`

位置：`if !containStreamUsage` 分支结束后。

逻辑：

- 如果 `PromptTokens > 0 && CompletionTokens == 0`：
  - `responseTextBuilder` 为空且有 tool_calls → `tool_call_only`
  - `responseTextBuilder` 为空 → `stream_empty`
  - `responseTextBuilder` 非空 → `upstream_no_usage`（有文本但 usage 缺失）

### 3.3 ClaudeStreamHandler — `relay/channel/claude/relay-claude.go`

位置：`HandleStreamFinalResponse` 中，`if claudeInfo.Usage.CompletionTokens == 0 || !claudeInfo.Done` 分支里，在补算完成后检查。

- 补算后 `CompletionTokens` 仍为 0 → `upstream_usage_zero`

### 3.4 OpenAI Responses 流式 — `relay/channel/openai/relay_responses.go`

位置：`OaiResponsesStreamHandler` 中 `if usage.CompletionTokens == 0` 分支结束后。

- 文本非空但补算后仍为 0 → 不太可能，标记 `upstream_no_usage`
- 文本为空 → `stream_empty`

### 3.5 OpenAI Responses 非流式 — `relay/channel/openai/relay_responses.go`

位置：`OaiResponsesHandler` 的 `return &usage, nil` 之前。

- 上游给了 usage 但 `CompletionTokens == 0 && PromptTokens > 0` → `upstream_usage_zero`

### 3.6 Gemini image-only — `relay/channel/gemini/relay-gemini.go`

位置：`if imageCount != 0 && usage.CompletionTokens == 0` 分支里，`usage.CompletionTokens = imageCount * 1400` 之前。

- 标记 `image_only`（诊断，不算错）

### 3.7 OpenAI Audio — `relay/channel/openai/audio.go`

`OpenaiTTSHandler`：
- 位置：非流式分支，`return usage` 之前
- 标记 `audio_only`

`OpenaiSTTHandler`：
- 位置：`return nil, usage` 之前（`usage.CompletionTokens = 0` 的路径）
- 标记 `audio_only`

## 四、最终日志效果

### 非 admin 用户看到的 consume log（`formatUserLogs` 剥掉了 `admin_info`）：

```json
{
  "model_name": "gpt-4o",
  "prompt_tokens": 128,
  "completion_tokens": 0,
  "total_tokens": 128,
  "error_code": "upstream_empty_completion",
  "other": { ... }
}
```

### Admin 用户看到的完整 consume log：

```json
{
  "model_name": "gpt-4o",
  "prompt_tokens": 128,
  "completion_tokens": 0,
  "total_tokens": 128,
  "other": {
    "admin_info": {
      "use_channel": [42],
      "local_count_tokens": true,
      "zero_output": {
        "reason": "upstream_usage_zero",
        "has_text": false
      }
    },
    "error_code": "upstream_empty_completion"
  }
}
```

### Admin 后台错误统计面板：

`upstream_empty_completion` 自动出现在 `stats.ByError` 和 `channelErrorMap` 中，和 429、500 并列。

## 五、改动清单

| 文件 | 改动 |
|---|---|
| `relaykit/types/error.go` | +1 常量 `ErrorCodeUpstreamEmptyCompletion` |
| `constant/context_key.go` | +2 context key |
| `service/zero_output_reason.go`（新文件） | reason 枚举 + `IsZeroOutputProblem` |
| `service/log_info_generate.go` | `GenerateTextOtherInfo` +1 段读取 context 写 other |
| `relay/channel/openai/relay-openai.go` | `OpenaiHandler` + `OaiStreamHandler` 各注入 1 段 |
| `relay/channel/claude/relay-claude.go` | `HandleStreamFinalResponse` 注入 1 段 |
| `relay/channel/openai/relay_responses.go` | 注入 1-2 段 |
| `relay/channel/gemini/relay-gemini.go` | `image_only` 分支注入 1 段 |
| `relay/channel/openai/audio.go` | `audio_only` 分支注入 1 段 |
| 验证 | `cd relaykit && GOWORK=off go build ./...` |

**总行数增量约 150-180 行**。不修改任何已有控制流、重试策略、计费逻辑、响应格式。