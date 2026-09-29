package plugins_test

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	builtinplugins "github.com/QuantumNous/new-api/plugins"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestModelScopeImage(t *testing.T) {
	source, err := builtinplugins.Source("modelscope")
	require.NoError(t, err)
	registry := jsplugin.NewRegistry()
	plugin, err := registry.RegisterFactory(source, jsplugin.Options{Key: "modelscope"})
	require.NoError(t, err)

	const baseURL = "https://api-inference.modelscope.cn"
	roundTripAny := func(t *testing.T, value any) any {
		encoded, marshalErr := common.Marshal(value)
		require.NoError(t, marshalErr)
		var decoded any
		require.NoError(t, common.Unmarshal(encoded, &decoded))
		return decoded
	}
	roundTrip := func(t *testing.T, value any) map[string]any {
		decoded, ok := roundTripAny(t, value).(map[string]any)
		require.True(t, ok, "expected a JSON object")
		return decoded
	}
	queryCtx := func(action string) map[string]any {
		return map[string]any{
			"taskId":        "task-1",
			"publicTaskId":  "task_public",
			"action":        action,
			"model":         "Qwen/Qwen-Image",
			"upstreamModel": "Qwen/Qwen-Image",
			"baseUrl":       baseURL,
			"apiKey":        "ms-token",
			"authHeader":    "Bearer ms-token",
			"upstream":      map[string]any{"kind": "vendor"},
			"data":          map[string]any{},
			"state":         map[string]any{},
		}
	}
	successBody := map[string]any{
		"task_id":     "task-1",
		"task_status": "SUCCEED",
		"output_images": []any{
			"https://modelscope.oss-cn-beijing.aliyuncs.com/out/a.png",
			"https://modelscope.oss-cn-beijing.aliyuncs.com/out/b.png",
		},
	}

	t.Run("vendor submit builds the async generation request", func(t *testing.T) {
		value, callErr := plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{
			"model": "Qwen/Qwen-Image", "upstreamModel": "Qwen/Qwen-Image", "baseUrl": baseURL,
			"apiKey": "ms-token", "authHeader": "Bearer ms-token",
			"upstream": map[string]any{"kind": "vendor"},
			"requestBody": map[string]any{
				"prompt": " a cat ", "negative_prompt": "blurry", "size": "1024x1024",
				"seed": 7, "steps": 30, "guidance": 3.5, "n": 2,
			},
		})
		require.NoError(t, callErr)
		descriptor := roundTrip(t, value)
		assert.Equal(t, baseURL+"/v1/images/generations", descriptor["url"])
		assert.Equal(t, "POST", descriptor["method"])
		headers := descriptor["headers"].(map[string]any)
		assert.Equal(t, "Bearer ms-token", headers["Authorization"])
		assert.Equal(t, "true", headers["X-ModelScope-Async-Mode"])
		body := descriptor["body"].(map[string]any)
		assert.Equal(t, "Qwen/Qwen-Image", body["model"])
		assert.Equal(t, "a cat", body["prompt"]) // trimmed at the vendor boundary
		assert.Equal(t, "1024x1024", body["size"])
		assert.Equal(t, "blurry", body["negative_prompt"])
		assert.Equal(t, float64(7), body["seed"])
		assert.Equal(t, float64(30), body["steps"])
		assert.Equal(t, 3.5, body["guidance"])
		assert.Equal(t, float64(2), body["n"])
	})

	t.Run("vendor submits single and multiple image edits", func(t *testing.T) {
		value, callErr := plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{
			"model": "Qwen/Qwen-Image-Edit-2509", "upstreamModel": "Qwen/Qwen-Image-Edit-2509",
			"baseUrl": baseURL, "apiKey": "ms-token", "authHeader": "Bearer ms-token",
			"upstream":    map[string]any{"kind": "vendor"},
			"requestBody": map[string]any{"model": "Qwen/Qwen-Image-Edit-2509", "prompt": "make it snow", "image_urls": []any{"https://example.com/a.png"}},
		})
		require.NoError(t, callErr)
		body := roundTrip(t, value)["body"].(map[string]any)
		assert.Equal(t, "https://example.com/a.png", body["image_url"])

		value, callErr = plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{
			"model": "Qwen/Qwen-Image-Edit-2509", "upstreamModel": "Qwen/Qwen-Image-Edit-2509",
			"baseUrl": baseURL, "apiKey": "ms-token", "authHeader": "Bearer ms-token",
			"upstream":    map[string]any{"kind": "vendor"},
			"requestBody": map[string]any{"model": "Qwen/Qwen-Image-Edit-2509", "prompt": "add text", "image_urls": []any{"https://example.com/a.png", "https://example.com/b.png"}},
		})
		require.NoError(t, callErr)
		body = roundTrip(t, value)["body"].(map[string]any)
		assert.Equal(t, []any{"https://example.com/a.png", "https://example.com/b.png"}, body["image_url"])
	})

	t.Run("new_api submit maps to the gateway native route", func(t *testing.T) {
		value, callErr := plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{
			"model": "Qwen/Qwen-Image", "upstreamModel": "Qwen/Qwen-Image",
			"baseUrl": "https://gateway.example", "apiKey": "ms-token", "authHeader": "Bearer ms-token",
			"upstream":    map[string]any{"kind": "new_api"},
			"requestBody": map[string]any{"model": "Qwen/Qwen-Image", "prompt": "a cat"},
		})
		require.NoError(t, callErr)
		descriptor := roundTrip(t, value)
		assert.Equal(t, "https://gateway.example/modelscope/v1/images/generations", descriptor["url"])
		assert.NotContains(t, descriptor["headers"].(map[string]any), "X-ModelScope-Async-Mode")
	})

	t.Run("submit reads the async task id and rejects error envelopes", func(t *testing.T) {
		value, callErr := plugin.Engine.Call(t.Context(), "parseSubmitResponse", queryCtx("text_to_image"), map[string]any{"body": map[string]any{"task_id": "task-1"}})
		require.NoError(t, callErr)
		parsed := roundTrip(t, value)
		assert.Equal(t, "task-1", parsed["taskId"])

		_, callErr = plugin.Engine.Call(t.Context(), "parseSubmitResponse", queryCtx("text_to_image"), map[string]any{"body": map[string]any{
			"error": map[string]any{"code": "InvalidParameter", "message": "prompt is required"},
		}})
		require.ErrorContains(t, callErr, "InvalidParameter: prompt is required")

		_, callErr = plugin.Engine.Call(t.Context(), "parseSubmitResponse", queryCtx("text_to_image"), map[string]any{"body": map[string]any{
			"errors": []any{map[string]any{"code": "ModelNotFound", "message": "model is not served"}},
		}})
		require.ErrorContains(t, callErr, "ModelNotFound: model is not served")

		// The live API answers with an object-form {"errors": {...}} envelope, not
		// only the array form.
		_, callErr = plugin.Engine.Call(t.Context(), "parseSubmitResponse", queryCtx("text_to_image"), map[string]any{"body": map[string]any{
			"errors": map[string]any{"message": "size format should be WxH"},
		}})
		require.ErrorContains(t, callErr, "size format should be WxH")

		_, callErr = plugin.Engine.Call(t.Context(), "parseSubmitResponse", queryCtx("text_to_image"), map[string]any{"body": map[string]any{}})
		require.ErrorContains(t, callErr, "did not return a task_id")
	})

	t.Run("polling always carries the single verified task type", func(t *testing.T) {
		for _, action := range []string{"text_to_image", "image_to_image"} {
			value, callErr := plugin.Engine.Call(t.Context(), "buildQueryRequest", queryCtx(action))
			require.NoError(t, callErr)
			descriptor := roundTrip(t, value)
			assert.Equal(t, baseURL+"/v1/tasks/task-1", descriptor["url"])
			assert.Equal(t, "GET", descriptor["method"])
			assert.Equal(t, "image_generation", descriptor["headers"].(map[string]any)["X-ModelScope-Task-Type"], "action "+action)
		}
	})

	t.Run("task statuses map to the host states and unknown values stay unknown", func(t *testing.T) {
		for status, want := range map[string]string{
			"PENDING":     "QUEUED",
			"RUNNING":     "IN_PROGRESS",
			"SUCCEED":     "SUCCESS",
			"SUCCEEDED":   "SUCCESS",
			"FAILED":      "FAILURE",
			"CANCELED":    "FAILURE",
			"NOT_STARTED": "UNKNOWN",
		} {
			body := map[string]any{"task_id": "task-1", "task_status": status}
			if want == "SUCCESS" {
				body["output_images"] = []any{"https://example.com/a.png"}
			}
			value, callErr := plugin.Engine.Call(t.Context(), "parseTaskResult", queryCtx("text_to_image"), body)
			require.NoError(t, callErr)
			parsed := roundTrip(t, value)
			assert.Equal(t, want, parsed["status"], "status "+status)
			if want == "SUCCESS" {
				assert.Equal(t, "https://example.com/a.png", parsed["url"])
			}
		}

		value, callErr := plugin.Engine.Call(t.Context(), "parseTaskResult", queryCtx("text_to_image"), map[string]any{"task_status": "SUCCEED"})
		require.NoError(t, callErr)
		parsed := roundTrip(t, value)
		assert.Equal(t, "FAILURE", parsed["status"])
		assert.Equal(t, "image task succeeded without any images", parsed["reason"])

		// The live poll endpoint reports task-not-found via an object-form
		// {"errors": {...}} envelope; the reason must surface it.
		value, callErr = plugin.Engine.Call(t.Context(), "parseTaskResult", queryCtx("text_to_image"), map[string]any{
			"task_status": "FAILED", "errors": map[string]any{"code": 500, "message": "task not found"},
		})
		require.NoError(t, callErr)
		parsed = roundTrip(t, value)
		assert.Equal(t, "FAILURE", parsed["status"])
		assert.Equal(t, "500: task not found", parsed["reason"])
	})

	t.Run("billing reserves the requested count and settles the produced count", func(t *testing.T) {
		value, callErr := plugin.Engine.Call(t.Context(), "extractUsage", map[string]any{
			"model": "Qwen/Qwen-Image", "upstreamModel": "Qwen/Qwen-Image", "usagePurpose": "facts",
			"requestBody": map[string]any{"prompt": "a cat"},
		})
		require.NoError(t, callErr)
		assert.Equal(t, map[string]any{"image_count": float64(1)}, roundTrip(t, value))

		value, callErr = plugin.Engine.Call(t.Context(), "extractUsage", map[string]any{
			"model": "Qwen/Qwen-Image", "upstreamModel": "Qwen/Qwen-Image", "usagePurpose": "facts",
			"requestBody": map[string]any{"prompt": "a cat", "n": 9},
		})
		require.NoError(t, callErr)
		assert.Equal(t, map[string]any{"image_count": float64(4)}, roundTrip(t, value))

		value, callErr = plugin.Engine.Call(t.Context(), "extractUsageOnComplete", queryCtx("text_to_image"), map[string]any{"status": "SUCCESS"}, successBody)
		require.NoError(t, callErr)
		assert.Equal(t, map[string]any{"image_count": float64(2)}, roundTrip(t, value))

		value, callErr = plugin.Engine.Call(t.Context(), "extractUsageOnComplete", queryCtx("text_to_image"), map[string]any{"status": "SUCCESS"}, map[string]any{"task_status": "FAILED"})
		require.NoError(t, callErr)
		assert.Equal(t, map[string]any{}, roundTrip(t, value))
	})

	t.Run("artifacts expose every produced image as a credentialless CDN read", func(t *testing.T) {
		value, callErr := plugin.Engine.Call(t.Context(), "listArtifacts", map[string]any{"taskId": "task-1", "status": "SUCCESS", "data": successBody})
		require.NoError(t, callErr)
		assert.Equal(t, []any{
			map[string]any{"key": "image-1", "type": "image"},
			map[string]any{"key": "image-2", "type": "image"},
		}, roundTripAny(t, value))

		value, callErr = plugin.Engine.Call(t.Context(), "listArtifacts", map[string]any{"taskId": "task-1", "status": "IN_PROGRESS", "data": successBody})
		require.NoError(t, callErr)
		assert.Empty(t, roundTripAny(t, value))

		value, callErr = plugin.Engine.Call(t.Context(), "buildContentRequest", map[string]any{
			"artifactKey": "image-2", "data": successBody, "clientRequest": map[string]any{"method": "GET"},
		})
		require.NoError(t, callErr)
		content := roundTrip(t, value)
		assert.Equal(t, "https://modelscope.oss-cn-beijing.aliyuncs.com/out/b.png", content["url"])
		assert.Equal(t, "GET", content["method"])
		assert.Equal(t, true, content["credentialless"])

		_, callErr = plugin.Engine.Call(t.Context(), "buildContentRequest", map[string]any{
			"artifactKey": "image-9", "data": successBody, "clientRequest": map[string]any{"method": "GET"},
		})
		require.ErrorContains(t, callErr, "artifact_not_found")
	})

	t.Run("openai_image decodes generations and multipart edits", func(t *testing.T) {
		value, callErr := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_image", "decodeRequest"}, map[string]any{
			"model": "Qwen/Qwen-Image", "operation": "generate",
			"body": map[string]any{"kind": "json", "value": map[string]any{"model": "Qwen/Qwen-Image", "prompt": "a cat", "width": 1280, "height": 768, "n": 2}},
		})
		require.NoError(t, callErr)
		decoded := roundTrip(t, value)
		assert.Equal(t, "submit", decoded["kind"])
		assert.Equal(t, "Qwen/Qwen-Image", decoded["model"])
		assert.Equal(t, "text_to_image", decoded["action"])
		requestBody := decoded["requestBody"].(map[string]any)
		assert.Equal(t, "1280x768", requestBody["size"])
		assert.Equal(t, float64(2), requestBody["n"])
		assert.NotContains(t, requestBody, "image_urls")

		value, callErr = plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_image", "decodeRequest"}, map[string]any{
			"model": "Qwen/Qwen-Image-Edit-2509", "operation": "edit",
			"body": map[string]any{"kind": "multipart", "fields": map[string]any{"prompt": []any{"make it snow"}, "n": []any{"1"}}, "files": []any{
				map[string]any{"field": "image", "ref": "file-1", "mimeType": "image/png"},
			}},
		})
		require.NoError(t, callErr)
		decoded = roundTrip(t, value)
		assert.Equal(t, "image_to_image", decoded["action"])
		requestBody = decoded["requestBody"].(map[string]any)
		assert.Equal(t, "make it snow", requestBody["prompt"])
		images := requestBody["image_urls"].([]any)
		require.Len(t, images, 1)
		assert.Equal(t, "file-1", images[0].(map[string]any)["__fileRef"])
		assert.Equal(t, "dataUrl", images[0].(map[string]any)["encoding"])

		_, callErr = plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_image", "decodeRequest"}, map[string]any{
			"model": "Qwen/Qwen-Image-Edit-2509", "operation": "edit",
			"body": map[string]any{"kind": "json", "value": map[string]any{"prompt": "make it snow"}},
		})
		require.ErrorContains(t, callErr, "image is required")

		_, callErr = plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_image", "decodeRequest"}, map[string]any{
			"model": "Qwen/Qwen-Image", "operation": "generate",
			"body": map[string]any{"kind": "json", "value": map[string]any{"prompt": "a cat", "size": "1024"}},
		})
		require.ErrorContains(t, callErr, "size must be WIDTHxHEIGHT")

		value, callErr = plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_image", "render"}, map[string]any{}, map[string]any{"status": "SUCCESS", "created_at": 1700000000, "data": successBody})
		require.NoError(t, callErr)
		rendered := roundTrip(t, value)
		assert.Equal(t, []any{
			map[string]any{"url": "https://modelscope.oss-cn-beijing.aliyuncs.com/out/a.png"},
			map[string]any{"url": "https://modelscope.oss-cn-beijing.aliyuncs.com/out/b.png"},
		}, rendered["data"])
	})

	t.Run("openai_responses echoes the alias and renders the capability artifacts", func(t *testing.T) {
		value, callErr := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_responses", "decodeRequest"}, map[string]any{
			"model": "alias-under-test", "body": map[string]any{"kind": "json", "value": map[string]any{
				"model": "alias-under-test",
				"input": []any{
					map[string]any{"type": "input_text", "text": "a cat"},
					map[string]any{"type": "input_image", "image_url": "https://example.com/a.png"},
				},
			}},
		})
		require.NoError(t, callErr)
		decoded := roundTrip(t, value)
		assert.Equal(t, "submit", decoded["kind"])
		assert.Equal(t, "alias-under-test", decoded["model"])
		assert.Equal(t, "image_to_image", decoded["action"])
		requestBody := decoded["requestBody"].(map[string]any)
		assert.Equal(t, "a cat", requestBody["prompt"])
		assert.Equal(t, []any{"https://example.com/a.png"}, requestBody["image_urls"])

		value, callErr = plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_responses", "renderFinal"},
			map[string]any{"artifacts": map[string]any{"image-1": map[string]any{"key": "image-1", "type": "image", "url": "https://host.example/artifact?access=a b"}}},
			map[string]any{"status": "SUCCESS", "data": successBody})
		require.NoError(t, callErr)
		final := roundTrip(t, value)
		content := final["output"].([]any)[0].(map[string]any)["content"].([]any)[0].(map[string]any)
		assert.Equal(t, "output_text", content["type"])
		assert.Equal(t, "![](https://host.example/artifact?access=a%20b)", content["text"])
	})

	t.Run("native routes keep the ModelScope task envelope", func(t *testing.T) {
		value, callErr := plugin.Engine.CallPath(t.Context(), "native", []string{"createImageTask"}, map[string]any{
			"body": map[string]any{"kind": "json", "value": map[string]any{"model": "Qwen/Qwen-Image", "prompt": " a cat ", "size": "512*512"}},
		})
		require.NoError(t, callErr)
		decoded := roundTrip(t, value)
		assert.Equal(t, "Qwen/Qwen-Image", decoded["model"])
		// The canonical body keeps the client's prompt verbatim; buildSubmitRequest trims it.
		assert.Equal(t, " a cat ", decoded["requestBody"].(map[string]any)["prompt"])
		assert.Equal(t, "512x512", decoded["requestBody"].(map[string]any)["size"])

		value, callErr = plugin.Engine.CallPath(t.Context(), "native", []string{"taskCreated"}, map[string]any{}, map[string]any{"task_id": "task_public"})
		require.NoError(t, callErr)
		assert.Equal(t, map[string]any{"task_id": "task_public", "task_status": "PENDING"}, roundTrip(t, value))

		value, callErr = plugin.Engine.CallPath(t.Context(), "native", []string{"taskStatus"}, map[string]any{}, map[string]any{"data": successBody})
		require.NoError(t, callErr)
		assert.Equal(t, "SUCCEED", roundTrip(t, value)["task_status"])
	})
}
