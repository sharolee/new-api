package service

// Zero-output reason constants describe WHY a request ended up with zero
// completion_tokens. These are string tags that flow through the gin context
// (constant.ContextKeyZeroOutputReason) into the consume log's admin_info.zero_output.
//
// The reasons are split into two buckets:
//   - Diagnostic/normal: image_only, audio_only, local_recount_nonzero — the zero
//     is expected or was already healed by local token re-counting; no error
//     code is written and these requests do NOT appear in the error statistics.
//   - Problematic: upstream_usage_zero, upstream_no_usage, local_recount_zero,
//     stream_empty, tool_call_only — these indicate the upstream actually failed
//     to produce output. The log_info_generate layer writes the generic error
//     code "upstream_empty_completion" so they show up in admin error stats.

const (
	// upstream_usage_zero: upstream responded with a complete usage block but
	// completion_tokens == 0 while prompt_tokens > 0. The most common case of
	// "empty output" — the LLM accepted the request and charged for input but
	// never produced any text (or only produced tool_calls / reasoning that the
	// platform counts differently).
	ZeroOutputUpstreamUsageZero = "upstream_usage_zero"

	// upstream_no_usage: upstream did not include a usage block at all, and
	// local re-count of the accumulated response text also returned 0. Typical
	// of malformed responses or mid-stream disconnects.
	ZeroOutputUpstreamNoUsage = "upstream_no_usage"

	// local_recount_zero: upstream's usage was missing or zero, we attempted to
	// re-count from the accumulated response text, and the local re-count was
	// also 0. The upstream really produced no billable output.
	ZeroOutputLocalRecountZero = "local_recount_zero"

	// local_recount_nonzero: upstream's usage was zero, but local re-count of
	// the response text produced a non-zero value. The billing numbers were
	// already healed — this is a diagnostic tag, not an error.
	ZeroOutputLocalRecountNonzero = "local_recount_nonzero"

	// stream_empty: streaming relay accumulated zero non-empty content chunks.
	// The upstream sent deltas but none carried actual text (e.g. only
	// role-only deltas or usage-only terminal frames).
	ZeroOutputStreamEmpty = "stream_empty"

	// tool_call_only: upstream produced tool_calls but no user-visible text.
	// Completion_tokens=0 may or may not be intentional; flagged for visibility
	// because downstream agents may interpret this as an empty response.
	ZeroOutputToolCallOnly = "tool_call_only"

	// image_only: image-generation API — completion_tokens is not applicable
	// and is expected to be 0. Diagnostic only, not an error.
	ZeroOutputImageOnly = "image_only"

	// audio_only: TTS/audio API — completion_tokens is derived from audio
	// duration and may legitimately be 0 when the upstream returned no
	// duration metadata. Diagnostic only, not an error.
	ZeroOutputAudioOnly = "audio_only"
)

// IsZeroOutputProblem reports whether the given reason indicates a genuine
// problem (upstream produced no output) rather than a diagnostic/normal case.
// Used by log_info_generate to decide whether to write an error_code into
// the consume log's other map (which drives the admin error statistics).
func IsZeroOutputProblem(reason string) bool {
	switch reason {
	case ZeroOutputUpstreamUsageZero, ZeroOutputUpstreamNoUsage,
		ZeroOutputLocalRecountZero, ZeroOutputStreamEmpty, ZeroOutputToolCallOnly:
		return true
	default:
		return false
	}
}