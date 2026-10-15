// Agnes Video 2.5 and 2.5 Flash video generation.
// https://www.agnes-ai.com/zh-Hans/docs/agnes-video-25
// Agnes serves an OpenAI Videos compatible submit endpoint but a vendor
// specific poll endpoint (/agnesapi?video_id=&model_name=), so retrieval
// cannot reuse the host's standard video task route.
const SUBMIT_PATH = "/v1/videos";
const POLL_PATH = "/agnesapi";
// A New API gateway rebinds the plugin to its own /agnes video routes and
// remaps the model, so it owns the vendor wire format from there.
const GATEWAY_PREFIX = "/agnes";

// Agnes reports task status as queued, in_progress, completed, failed.
const TASK_STATUS = {
  QUEUED: "QUEUED",
  PENDING: "QUEUED",
  IN_PROGRESS: "IN_PROGRESS",
  PROCESSING: "IN_PROGRESS",
  COMPLETED: "SUCCESS",
  SUCCEEDED: "SUCCESS",
  FAILED: "FAILURE",
  CANCELED: "FAILURE",
  CANCELLED: "FAILURE",
};

// Agnes accepts at most 8 reference images on Agnes Video 2.5.
const AGNES_VIDEO_2_5 = "agnes-video-2.5";
const AGNES_VIDEO_2_5_FLASH = "agnes-video-2.5-flash";
const MODELS = [AGNES_VIDEO_2_5, AGNES_VIDEO_2_5_FLASH];
// Flash is fixed at 720P. 2.5 supports 720P/1080P/1K/2K.
const SIZE_TIERS = {
  [AGNES_VIDEO_2_5]: ["720P", "1080P", "1K", "2K"],
  [AGNES_VIDEO_2_5_FLASH]: ["720P"],
};
const FLASH_MAX_IMAGES = 5;
const FLASH_MAX_AUDIOS = 3;
const MAX_IMAGES = 8;
const MAX_AUDIOS = 3;

function isFlash(model) {
  return model === AGNES_VIDEO_2_5_FLASH;
}

function trimmed(value) {
  return String(value || "").trim();
}

function viaNewAPI(ctx) {
  return !!(ctx.upstream && ctx.upstream.kind === "new_api");
}

function apiRoot(ctx) {
  return ctx.baseUrl + (viaNewAPI(ctx) ? GATEWAY_PREFIX : "");
}

function modelKey(model) {
  const key = trimmed(model).toLowerCase();
  if (MODELS.includes(key)) return key;
  // A channel mapping may rename a declared model to a vendor model id.
  if (key.endsWith("-flash")) return AGNES_VIDEO_2_5_FLASH;
  return AGNES_VIDEO_2_5;
}

function sizeTiers(model) {
  return SIZE_TIERS[modelKey(model)] || SIZE_TIERS[AGNES_VIDEO_2_5];
}

function mediaList(value, limit) {
  const items = [];
  for (const entry of [].concat(value === undefined || value === null ? [] : value)) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      // Reference video objects carry a url plus optional start/require_audio.
      const url = trimmed(entry.url);
      if (url) items.push(url);
      continue;
    }
    if (trimmed(entry)) items.push(trimmed(entry));
  }
  const unique = items.filter(function (item, index) {
    return index === items.indexOf(item);
  });
  if (unique.length > limit) throw new Error("reference media exceeds the " + limit + " item limit");
  return unique;
}

function imageReferences(value) {
  return mediaList(value, MAX_IMAGES);
}

// Agnes rejects out-of-range or unsupported values before creating a task.
// Normalizing them here keeps the reserved billing facts in range.
function normalizedSeconds(model, value) {
  let seconds = Number(value);
  if (!Number.isFinite(seconds)) seconds = 5;
  seconds = Math.round(seconds);
  const minimum = 4;
  const maximum = 12;
  if (seconds < minimum) seconds = minimum;
  if (seconds > maximum) seconds = maximum;
  return seconds;
}

function normalizedSize(model, value) {
  const raw = trimmed(value || (isFlash(model) ? "720P" : "720P"));
  const upper = raw.toUpperCase();
  const tiers = sizeTiers(model);
  if (!upper) return tiers[0];
  if (tiers.includes(upper)) return upper;
  // Repair common misspellings rather than silently dropping the request.
  if (upper === "1080") return tiers.includes("1080P") ? "1080P" : tiers[tiers.length - 1];
  if (upper === "720") return tiers.includes("720P") ? "720P" : tiers[0];
  if (upper === "2160" || upper === "4K") return tiers.includes("2K") ? "2K" : tiers[tiers.length - 1];
  return tiers[0];
}

function canonicalRequest(model, req, media) {
  const key = modelKey(model);
  if (!key) throw new Error("model is required");
  const prompt = trimmed(req.prompt);
  if (!prompt) throw new Error("prompt is required");
  const mode = trimmed(req.mode || (media.image ? "reference" : "text"));
  const requestBody = {
    model: model,
    prompt: prompt,
    mode: mode,
    seconds: String(normalizedSeconds(model, req.seconds !== undefined ? req.seconds : req.duration)),
    size: normalizedSize(model, req.size),
  };
  if (trimmed(req.aspect_ratio)) requestBody.aspect_ratio = trimmed(req.aspect_ratio);
  if (req.seed !== undefined && req.seed !== null) {
    const seed = Number(req.seed);
    if (Number.isFinite(seed)) requestBody.seed = seed;
  }
  if (req.n !== undefined && req.n !== null) {
    const n = Number(req.n);
    if (!Number.isFinite(n) || n < 1) requestBody.n = 1;
    else if (n > 1) throw new Error("n must be 1");
    else requestBody.n = 1;
  }
  if (mode === "keyframe") {
    const first = trimmed(req.first_frame);
    const last = trimmed(req.last_frame);
    if (!first && !last) throw new Error("keyframe mode requires first_frame or last_frame");
    if (first) requestBody.first_frame = first;
    if (last) requestBody.last_frame = last;
    return requestBody;
  }
  if (mode !== "reference" || !media.image.length && !media.audio.length) {
    // text mode rejects reference media fields.
    return requestBody;
  }
  const flash = isFlash(model);
  const imageLimit = flash ? FLASH_MAX_IMAGES : MAX_IMAGES;
  const audioLimit = flash ? FLASH_MAX_AUDIOS : MAX_AUDIOS;
  // The vendor rejects over-limit media with HTTP 400 before creating a
  // task; mirror that here instead of silently dropping inputs.
  if (media.image.length > imageLimit)
    throw new Error("images length must not exceed " + imageLimit + (flash ? " for " + AGNES_VIDEO_2_5_FLASH : ""));
  if (media.audio.length > audioLimit)
    throw new Error("audios length must not exceed " + audioLimit + (flash ? " for " + AGNES_VIDEO_2_5_FLASH : ""));
  requestBody.images = media.image;
  if (media.audio.length) requestBody.audios = media.audio;
  if (flash) {
    // Flash rejects reference videos outright; drop the field to avoid a 400.
    return requestBody;
  }
  if (media.video.length) requestBody.videos = req.videos;
  return requestBody;
}

function collectMedia(req) {
  const image = imageReferences(req.images);
  const audio = mediaList(req.audios, MAX_AUDIOS);
  const video = mediaList(req.videos, 1);
  return { image: image, audio: audio, video: video };
}

export function buildSubmitRequest(ctx) {
  const req = ctx.requestBody || {};
  const headers = { Authorization: "Bearer " + ctx.apiKey, "Content-Type": "application/json" };
  const model = ctx.upstreamModel || ctx.model;
  if (viaNewAPI(ctx)) {
    // A gateway owns the vendor wire format on its own native route.
    return { url: apiRoot(ctx) + SUBMIT_PATH, method: "POST", headers: headers, body: Object.assign({}, req, { model: model }) };
  }
  const media = collectMedia(req);
  const body = canonicalRequest(model, req, media);
  return { url: apiRoot(ctx) + SUBMIT_PATH, method: "POST", headers: headers, body: body };
}

export function parseSubmitResponse(ctx, resp) {
  const body = resp.body || {};
  if (body.error || body.code) {
    const code = trimmed(body.code) || trimmed((body.error || {}).code);
    const message = trimmed((body.error || {}).message) || trimmed(body.message) || trimmed(body.detail);
    throw new Error(message ? (code ? code + ": " + message : message) : "Agnes Video request failed");
  }
  // The submit response carries id/task_id for host-side task identity and
  // video_id for the vendor poll endpoint. Polling requires video_id, so it
  // becomes the upstream task id the host persists.
  const taskId = trimmed(body.video_id) || trimmed(body.task_id) || trimmed(body.id);
  if (!taskId) throw new Error("Agnes Video did not return a video_id");
  return { taskId: taskId, taskData: body };
}

export function extractUsage(ctx) {
  const req = ctx.requestBody || {};
  const model = ctx.upstreamModel || ctx.model;
  return {
    seconds: normalizedSeconds(model, req.seconds !== undefined ? req.seconds : req.duration),
    size: normalizedSize(model, req.size),
  };
}

export function buildQueryRequest(ctx) {
  // Poll through the vendor /agnesapi endpoint. The host supplies the
  // public task id via ctx.upstreamTaskId when available; otherwise the
  // task id returned at submit is reused.
  const headers = { Authorization: "Bearer " + ctx.apiKey };
  const key = ctx.upstreamModel || ctx.model;
  const params = [];
  params.push("video_id=" + encodeURIComponent(ctx.taskId));
  const modelName = trimmed(key) || AGNES_VIDEO_2_5;
  params.push("model_name=" + encodeURIComponent(modelName));
  return { url: apiRoot(ctx) + POLL_PATH + "?" + params.join("&"), method: "GET", headers: headers };
}

export function parseTaskResult(ctx, body) {
  const data = body || {};
  const status = trimmed(data.status).toUpperCase();
  if (!status) return { status: "UNKNOWN", reason: "task response has no status" };
  if (Object.prototype.hasOwnProperty.call(TASK_STATUS, status)) {
    const result = { status: TASK_STATUS[status] };
    if (result.status === "SUCCESS") {
      const url = trimmed(data.url);
      if (!url) return { status: "FAILURE", reason: "video task succeeded without a url" };
      result.url = url;
      const progress = Number(data.progress);
      if (Number.isFinite(progress)) result.progress = Math.min(100, progress) + "%";
      return result;
    }
    if (result.status === "FAILURE") {
      const error = data.error || {};
      const reason = trimmed(error.message) || trimmed(data.message) || "video task failed";
      result.reason = reason;
      return result;
    }
    const progress = Number(data.progress);
    if (Number.isFinite(progress) && progress > 0 && progress < 100) result.progress = progress + "%";
    return result;
  }
  return { status: "UNKNOWN", reason: "unrecognized status: " + status };
}

// The settled facts confirm the vendor-reported duration and size.
export function extractUsageOnComplete(task, taskResult, body) {
  const data = (body || {}) || {};
  const facts = {};
  const seconds = Number(data.seconds);
  if (Number.isFinite(seconds) && seconds > 0) facts.seconds = Math.min(seconds, 3600);
  const size = trimmed(data.size);
  if (size && SIZE_TIERS[AGNES_VIDEO_2_5].includes(size.toUpperCase())) facts.size = size.toUpperCase();
  return facts;
}

export function listArtifacts(task) {
  if (task.status !== "SUCCESS") return [];
  const data = task.data || {};
  return trimmed(data.url) ? [{ key: "video", type: "video" }] : [];
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== "video") throw new Error("artifact_not_found");
  const data = (ctx && ctx.data) || {};
  const url = trimmed(data.url);
  if (!url) throw new Error("artifact_not_found");
  // Agnes Video returns public CDN links, so the host serves them
  // credentialless under its own SSRF checks.
  return { url: url, method: ctx.clientRequest.method, credentialless: true };
}

function videoArtifactText(ctx, task) {
  const artifact = (ctx && ctx.artifacts && ctx.artifacts.video) || {};
  const url = trimmed(artifact.url) || trimmed(task && task.data && task.data.url);
  if (!url) return "";
  const escaped = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return '<video controls src="' + escaped + '"></video>';
}

function videoResponseText(ctx, task) {
  const status = String((task && task.status) || "UNKNOWN").toUpperCase();
  if (status !== "SUCCESS") return "";
  const text = videoArtifactText(ctx, task);
  return text || "video task succeeded without a url";
}

export const protocols = {
  openai_responses: {
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      const req = ctx.body.value;
      if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
      const model = trimmed(ctx.model) || trimmed(req.model);
      const media = collectMedia(req);
      const prompt =
        trimmed(req.prompt) ||
        (typeof req.input === "string" ? trimmed(req.input) : "");
      const requestBody = canonicalRequest(model, Object.assign({}, req, { prompt: prompt }), media);
      return {
        kind: "submit",
        model: model,
        action: media.image.length ? "image_to_video" : "text_to_video",
        requestBody: requestBody,
      };
    },
    renderEvents: function (ctx, task, previousState) {
      const status = String(task.status || "UNKNOWN").toUpperCase();
      const value = Number(String(task.progress || "").replace("%", ""));
      const progress = Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
      const state = { status: status, progress: progress };
      if (status === "SUCCESS") {
        const text = videoResponseText(ctx, task);
        const events = previousState && previousState.status === status ? [] : text ? [{ type: "output", data: text }] : [];
        return { events: events, state: state, done: true };
      }
      if (status === "FAILURE")
        return { events: [{ type: "error", code: "task_failed", message: task.fail_reason || "task failed" }], state: state, done: true };
      if (previousState && previousState.status === status && previousState.progress === progress)
        return { events: [], state: state, done: false };
      const event = { type: "progress", message: status.toLowerCase() };
      if (progress !== null) event.progress = progress;
      return { events: [event], state: state, done: false };
    },
    renderFinal: function (ctx, task) {
      return {
        output: [
          {
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: videoResponseText(ctx, task), annotations: [], logprobs: [] }],
          },
        ],
        metadata: { vendor: "agnes", model: (task && task.upstreamModel) || (task && task.model) || "" },
      };
    },
  },
  openai_video: {
    decodeRequest: function (ctx) {
      let req;
      if (ctx.body && ctx.body.kind === "json") {
        req = ctx.body.value;
        if (!req || Array.isArray(req)) throw new Error("JSON object required");
      } else if (ctx.body && ctx.body.kind === "multipart") {
        const fields = ctx.body.fields || {};
        req = {};
        for (const name of Object.keys(fields)) {
          const values = fields[name];
          if (values.length > 1) throw new Error(name + " must be provided once");
          req[name] = values[0];
        }
        for (const key of ["seconds", "duration", "seed"]) {
          if (req[key] !== undefined) req[key] = Number(req[key]);
        }
        if ((ctx.body.files || []).length) throw new Error("Agnes Video requires media to be URLs");
      } else throw new Error("JSON or multipart body required");
      const model = trimmed(ctx.model);
      if (!model) throw new Error("model is required");
      const media = collectMedia(req);
      if (isFlash(model) && media.video.length) throw new Error("Flash does not support reference videos");
      const requestBody = canonicalRequest(model, req, media);
      return {
        kind: "submit",
        model: model,
        action: media.image.length ? "image_to_video" : "text_to_video",
        requestBody: requestBody,
      };
    },
    render: function (ctx, task) {
      // Surface the vendor snapshot so the OpenAI Video client sees provider
      // extensions, while the host overwrites the task identity fields.
      const data = (task.data || {}) || {};
      const statuses = {
        QUEUED: "queued",
        IN_PROGRESS: "in_progress",
        SUCCESS: "completed",
        FAILURE: "failed",
      };
      const status = String(task.status || "UNKNOWN").toUpperCase();
      const progress = Number(String(task.progress || "0").replace("%", ""));
      const output = {
        id: task.task_id,
        object: "video",
        model: (task.properties && task.properties.origin_model_name) || "",
        status: statuses[status] || "unknown",
        progress: Number.isFinite(progress) ? progress : 0,
        created_at: task.created_at,
      };
      if (task.updated_at) output.completed_at = task.updated_at;
      if (trimmed(data.error && data.error.message)) output.error = { code: "video_generation_failed", message: trimmed(data.error.message) };
      if (data.url) output.url = data.url;
      return output;
    },
  },
};

export const meta = {
  apiVersion: 1,
  key: "agnes",
  name: "Agnes Video",
  icon: "text:Agnes",
  description: {
    en: "Agnes Video 2.5 and 2.5 Flash video generation (text, keyframe, and reference)",
    zh: "Agnes Video 2.5 与 2.5 Flash 视频生成（文生视频、首尾帧、多模态参考）",
  },
  version: "1.0.0",
  author: { name: "QuantumNous" },
  // Base URL carries no trailing /v1: the vendor submit path is /v1/videos and
  // the poll path is /agnesapi, matching the channel's base URL convention.
  baseUrl: "https://apihub.agnes-ai.com",
  // No channelTypes: a vendor task plugin must not claim a shared channel type
  // (e.g. OpenAI = 1, already claimed by the upstream sora plugin). Bind this
  // plugin to a channel via task_extend_plugin_keys and route it by models.
  models: MODELS,
  fetchMode: "per_task",
  upstreams: ["vendor", "new_api"],
  usageSchema: {
    seconds: {
      type: "number",
      unit: "second",
      description: { en: "Video generation unit price", zh: "视频生成单价" },
    },
    size: {
      enum: ["720P", "1080P", "1K", "2K"],
      enumLabels: {
        "720P": { en: "720P", zh: "720P" },
        "1080P": { en: "1080P", zh: "1080P" },
        "1K": { en: "1K", zh: "1K" },
        "2K": { en: "2K", zh: "2K" },
      },
      description: { en: "Output video resolution tier", zh: "输出视频分辨率档位" },
    },
  },
  usageExamples: [
    { label: "5s · 720P", facts: { seconds: 5, size: "720P" } },
    { label: "12s · 1080P", facts: { seconds: 12, size: "1080P" } },
    { label: "8s · 2K", facts: { seconds: 8, size: "2K" } },
  ],
  // Only the vendor-native submit route is authenticated. The poll endpoint
  // is vendor-specific and driven by buildQueryRequest through the host's
  // per_task fetcher; the OpenAI Videos retrieve/content operations serve
  // client-side retrieval through the host protocol claim.
  routes: [
    { method: "POST", path: "/agnes" + SUBMIT_PATH, type: "submit", decode: "createVideoTask", render: "taskCreated" },
  ],
  protocols: [{ name: "openai_responses", supports: ["stream", "sync", "background"] }, "openai_video"],
};

export const native = {
  createVideoTask: function (ctx) {
    if (!ctx.body || ctx.body.kind !== "json" || !ctx.body.value || Array.isArray(ctx.body.value))
      throw new Error("JSON object required");
    const req = ctx.body.value;
    const model = trimmed(req.model);
    const media = collectMedia(req);
    const requestBody = canonicalRequest(model, req, media);
    return {
      kind: "submit",
      model: model,
      action: media.image.length ? "image_to_video" : "text_to_video",
      requestBody: requestBody,
    };
  },
  taskCreated: function (ctx, task) {
    return {
      id: task.task_id,
      video_id: task.data && task.data.video_id,
      object: "video",
      status: "queued",
      progress: 0,
    };
  },
  taskStatus: function (ctx, task) {
    return task.data || {};
  },
  error: function (ctx, error) {
    return { code: "video_generation_failed", message: error.message };
  },
};
