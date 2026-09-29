// ModelScope API-Inference image generation.
// https://www.modelscope.cn/docs/model-service/API-Inference/intro
// Only the image endpoints are implemented: ModelScope API-Inference exposes no
// video generation surface, so video requests keep using the Alibaba plugin.
const SUBMIT_PATH = "/v1/images/generations";
// Another New API gateway serves the ModelScope wire format only on this
// plugin's /modelscope native routes; ModelScope itself serves the raw paths.
const GATEWAY_PREFIX = "/modelscope";
// ModelScope reports task_status as PENDING/RUNNING/SUCCEED/FAILED. SUCCEEDED
// is accepted as well because the terminal spelling is easy to get wrong.
const TASK_STATUS = {
  PENDING: "QUEUED",
  QUEUED: "QUEUED",
  RUNNING: "IN_PROGRESS",
  PROCESSING: "IN_PROGRESS",
  SUCCEED: "SUCCESS",
  SUCCEEDED: "SUCCESS",
  FAILED: "FAILURE",
  CANCELED: "FAILURE",
  CANCELLED: "FAILURE",
};
// Poll routing header. Verified against the live API: the header is mandatory
// (omitting it returns "task not found") and only image_generation, video_generation
// and audio_generation exist. Text-to-image and image-to-image tasks both poll
// with image_generation, so this never varies with the request action.
const TASK_TYPE_IMAGE = "image_generation";
// ModelScope accepts at most four output images per image request.
const MAX_IMAGES_PER_REQUEST = 4;
// ModelScope rejects input images larger than 10 MB.
const MAX_INPUT_IMAGE_BYTES = 10485760;
const MIN_DIMENSION = 64;
const MAX_DIMENSION = 8192;

const IMAGE_UNIT_LABEL = { en: "image", zh: "张", "zh-TW": "張", fr: "image", ja: "枚", ru: "изображение", vi: "ảnh" };

export const meta = {
  apiVersion: 1,
  key: "modelscope",
  name: "ModelScope",
  icon: "text:ModelScope",
  description: {
    en: "ModelScope API-Inference image generation and editing (Qwen-Image)",
    zh: "魔搭 API-Inference 图片生成与编辑（Qwen-Image）",
  },
  version: "1.0.0",
  author: { name: "QuantumNous" },
  baseUrl: "https://api-inference.modelscope.cn",
  models: ["Qwen/Qwen-Image", "Qwen/Qwen-Image-Edit-2509"],
  fetchMode: "per_task",
  upstreams: ["vendor", "new_api"],
  usageSchema: {
    image_count: {
      type: "number",
      unit: "count",
      unitLabel: IMAGE_UNIT_LABEL,
      description: { en: "Image generation unit price", zh: "图片生成单价" },
    },
  },
  usageExamples: [
    { label: "1 image", facts: { image_count: 1 } },
    { label: "4 images", facts: { image_count: 4 } },
  ],
  routes: [
    { method: "POST", path: "/modelscope/v1/images/generations", type: "submit", decode: "createImageTask", render: "taskCreated" },
    { method: "GET", path: "/modelscope/v1/tasks/:task_id", type: "query", render: "taskStatus" },
  ],
  protocols: [
    { name: "openai_responses", supports: ["stream", "sync", "background"] },
    { name: "openai_image" },
  ],
};

function trimmed(value) {
  return String(value || "").trim();
}

function viaNewAPI(ctx) {
  return !!(ctx.upstream && ctx.upstream.kind === "new_api");
}

function apiRoot(ctx) {
  return ctx.baseUrl + (viaNewAPI(ctx) ? GATEWAY_PREFIX : "");
}

// output_images is a flat array of image URLs once the task reaches a terminal
// success state. Older snapshots may nest it under data.
function outputImages(body) {
  const data = (body && body.data) || {};
  const raw = data.output_images || (body && body.output_images);
  if (!Array.isArray(raw)) return [];
  return raw
    .map(function (value) {
      return trimmed(value);
    })
    .filter(Boolean);
}

// Verified against the live API: ModelScope rejects "W*H" with "size format
// should be WxH", so "x" is the only accepted separator. Normalizing "*" to "x"
// repairs invalid client sizes instead of rejecting them. An explicit size is
// validated rather than silently dropped, and a width/height pair is composed
// the same way when no size was sent.
function normalizedSize(value) {
  const match = /^(\d{2,5})\s*[x*]\s*(\d{2,5})$/i.exec(trimmed(value));
  if (!match) return "";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < MIN_DIMENSION || width > MAX_DIMENSION) return "";
  if (height < MIN_DIMENSION || height > MAX_DIMENSION) return "";
  return width + "x" + height;
}

function requestSize(req) {
  if (req.size !== undefined && req.size !== null && trimmed(req.size)) {
    const size = normalizedSize(req.size);
    if (!size) throw new Error("size must be WIDTHxHEIGHT, for example 1024x1024");
    return size;
  }
  if (req.width !== undefined || req.height !== undefined) {
    const width = Number(req.width);
    const height = Number(req.height);
    if (!Number.isInteger(width) || width < MIN_DIMENSION || width > MAX_DIMENSION)
      throw new Error("width must be an integer between " + MIN_DIMENSION + " and " + MAX_DIMENSION);
    if (!Number.isInteger(height) || height < MIN_DIMENSION || height > MAX_DIMENSION)
      throw new Error("height must be an integer between " + MIN_DIMENSION + " and " + MAX_DIMENSION);
    return width + "x" + height;
  }
  return "";
}

// An entry is either an opaque multipart placeholder object or a plain URL or
// data-URL string. Placeholders are resolved by the host before the request is
// sent, so they must survive the mapping untouched.
function imageReferences(value) {
  const images = [];
  for (const image of [].concat(value === undefined || value === null ? [] : value)) {
    if (image && typeof image === "object") {
      images.push(image);
      continue;
    }
    if (trimmed(image)) images.push(trimmed(image));
  }
  return images;
}

function reservedImageCount(req) {
  const count = Number(req.n);
  if (!Number.isFinite(count) || count < 1) return 1;
  return Math.min(Math.floor(count), MAX_IMAGES_PER_REQUEST);
}

// ModelScope answers HTTP 200 with {"error": {...}} or {"errors": [...]}.
function vendorError(body) {
  const error = (body && body.error) || {};
  const errors = body && Array.isArray(body.errors)
    ? (body.errors[0] || {})
    : (body && typeof body.errors === "object" && body.errors) || {};
  const code = trimmed(error.code) || trimmed(errors.code) || trimmed(body && body.code);
  const message = trimmed(error.message) || trimmed(errors.message) || trimmed(body && body.message);
  if (message) return code ? code + ": " + message : message;
  return code || "ModelScope request failed";
}

export function buildSubmitRequest(ctx) {
  const req = ctx.requestBody || {};
  const headers = { Authorization: "Bearer " + ctx.apiKey, "Content-Type": "application/json" };
  if (viaNewAPI(ctx)) {
    // A gateway rebinds the plugin to its own native route and remaps the model,
    // so it owns the vendor wire format and the async header from there.
    return { url: apiRoot(ctx) + SUBMIT_PATH, method: "POST", headers: headers, body: req };
  }
  headers["X-ModelScope-Async-Mode"] = "true";
  const body = { model: ctx.upstreamModel || ctx.model, prompt: trimmed(req.prompt) };
  for (const key of ["negative_prompt", "size", "seed", "steps", "guidance", "n"]) {
    if (Object.prototype.hasOwnProperty.call(req, key) && req[key] !== undefined) body[key] = req[key];
  }
  const images = imageReferences(req.image_urls);
  // Single-image edits send a bare URL; multi-image edits send the documented
  // list form.
  if (images.length) body.image_url = images.length === 1 ? images[0] : images;
  return { url: apiRoot(ctx) + SUBMIT_PATH, method: "POST", headers: headers, body: body };
}

export function parseSubmitResponse(ctx, resp) {
  const body = resp.body || {};
  // ModelScope answers HTTP 200 with an error envelope on rejected requests.
  if (body.error || body.errors) throw new Error(vendorError(body));
  const taskId = trimmed(body.task_id) || trimmed(body.data && body.data.task_id) || trimmed(body.id);
  if (!taskId) throw new Error("ModelScope did not return a task_id");
  return { taskId: taskId, taskData: body };
}

export function extractUsage(ctx) {
  return { image_count: reservedImageCount(ctx.requestBody || {}) };
}

export function buildQueryRequest(ctx) {
  const headers = { Authorization: "Bearer " + ctx.apiKey };
  if (!viaNewAPI(ctx)) headers["X-ModelScope-Task-Type"] = TASK_TYPE_IMAGE;
  return { url: apiRoot(ctx) + "/v1/tasks/" + encodeURIComponent(ctx.taskId), method: "GET", headers: headers };
}

export function parseTaskResult(ctx, body) {
  const data = (body && body.data) || {};
  const status = trimmed(data.task_status || (body && body.task_status)).toUpperCase();
  if (!status) return { status: "UNKNOWN", reason: "task response has no task_status" };
  // Success is matched first because it also has to resolve the result image.
  if (status === "SUCCEED" || status === "SUCCEEDED") {
    const images = outputImages(body);
    if (!images.length) return { status: "FAILURE", reason: "image task succeeded without any images" };
    return { status: "SUCCESS", url: images[0] };
  }
  if (Object.prototype.hasOwnProperty.call(TASK_STATUS, status)) {
    const result = { status: TASK_STATUS[status] };
    if (result.status === "FAILURE") {
      const reason = vendorError(body);
      if (reason !== "ModelScope request failed") result.reason = reason;
    }
    return result;
  }
  return { status: "UNKNOWN", reason: "unrecognized task_status: " + status };
}

export function extractUsageOnComplete(task, taskResult, body) {
  const images = outputImages(body);
  // The host settles on the produced count; a task without images keeps the
  // submitted reservation.
  return images.length ? { image_count: images.length } : {};
}

export function listArtifacts(task) {
  if (task.status !== "SUCCESS") return [];
  return outputImages(task.data).map(function (_, index) {
    return { key: "image-" + (index + 1), type: "image" };
  });
}

export function buildContentRequest(ctx) {
  const images = outputImages(ctx.data);
  const index = images.findIndex(function (_, position) {
    return ctx.artifactKey === "image-" + (position + 1);
  });
  if (index < 0) throw new Error("artifact_not_found");
  // ModelScope returns public CDN links, so the host serves them credentialless
  // under its own SSRF checks instead of forwarding the channel credential.
  return { url: images[index], method: ctx.clientRequest.method, credentialless: true };
}

function markdownImage(url) {
  return "![](" + url.replace(/ /g, "%20").replace(/\)/g, "%29") + ")";
}

function responsesText(ctx, task) {
  const status = String((task && task.status) || "UNKNOWN").toUpperCase();
  if (status !== "SUCCESS") return "";
  // Prefer the host-signed capability URLs injected on a successful
  // observation; fall back to the persisted vendor snapshot for retrieval.
  const artifacts = (ctx && ctx.artifacts) || {};
  const parts = [];
  for (let index = 1; ; index++) {
    const artifact = artifacts["image-" + index];
    if (!artifact || !trimmed(artifact.url)) break;
    parts.push(markdownImage(trimmed(artifact.url)));
  }
  if (parts.length) return parts.join("\n\n");
  return outputImages(task && task.data)
    .map(markdownImage)
    .join("\n\n");
}

function canonicalRequest(model, req, images) {
  if (!model) throw new Error("model is required");
  const prompt = typeof req.prompt === "string" ? req.prompt : "";
  if (!trimmed(prompt)) throw new Error("prompt is required");
  const requestBody = { model: model, prompt: prompt };
  if (images.length) requestBody.image_urls = images;
  const size = requestSize(req);
  if (size) requestBody.size = size;
  for (const key of ["negative_prompt", "n", "seed", "steps", "guidance"]) {
    if (Object.prototype.hasOwnProperty.call(req, key) && req[key] !== undefined) requestBody[key] = req[key];
  }
  return requestBody;
}

export const protocols = {
  openai_responses: {
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      const req = ctx.body.value;
      if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
      if (req.input !== undefined && typeof req.input !== "string" && !Array.isArray(req.input))
        throw new Error("input must be a string or array");
      const images = [];
      for (const part of [].concat(req.input === undefined ? [] : req.input)) {
        const reference = part && typeof part === "object" ? part.image_url || part.image : part;
        for (const image of imageReferences(reference)) if (!images.includes(image)) images.push(image);
      }
      for (const image of imageReferences(req.image_url)) if (!images.includes(image)) images.push(image);
      const model = trimmed(ctx.model);
      const requestBody = canonicalRequest(model, Object.assign({}, req, { prompt: responsesPrompt(req) }), images);
      return {
        kind: "submit",
        model: model,
        action: images.length ? "image_to_image" : "text_to_image",
        requestBody: requestBody,
      };
    },
    renderEvents: function (ctx, task, previousState) {
      const status = String(task.status || "UNKNOWN").toUpperCase();
      const state = { status: status, progress: null };
      if (status === "SUCCESS") {
        const text = responsesText(ctx, task);
        const events = previousState && previousState.status === status ? [] : text ? [{ type: "output", data: text }] : [];
        return { events: events, state: state, done: true };
      }
      if (status === "FAILURE")
        return { events: [{ type: "error", code: "task_failed", message: task.fail_reason || "task failed" }], state: state, done: true };
      if (previousState && previousState.status === status) return { events: [], state: state, done: false };
      return { events: [{ type: "progress", message: status.toLowerCase() }], state: state, done: false };
    },
    renderFinal: function (ctx, task) {
      return {
        output: [
          {
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: responsesText(ctx, task), annotations: [], logprobs: [] }],
          },
        ],
        metadata: { vendor: "modelscope" },
      };
    },
  },
  // OpenAI Images API. The host pins ctx.model, waits for the terminal task and
  // honors response_format itself; the plugin maps the request onto the
  // ModelScope image endpoint and renders data[] from the stored result.
  openai_image: {
    decodeRequest: function (ctx) {
      let req = {};
      const uploads = [];
      if (ctx.body && ctx.body.kind === "json") {
        req = ctx.body.value;
        if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
      } else if (ctx.body && ctx.body.kind === "multipart") {
        const fields = ctx.body.fields || {};
        for (const name of Object.keys(fields)) {
          if (fields[name].length > 1) throw new Error(name + " must be provided once");
          req[name] = fields[name][0];
        }
        for (const key of ["n", "width", "height", "seed", "steps", "guidance"]) {
          if (req[key] !== undefined && trimmed(req[key]) !== "") req[key] = Number(req[key]);
        }
        for (const file of ctx.body.files || []) {
          if (!/^image(\[\d*\])?$/.test(file.field)) throw new Error("unexpected file field: " + file.field);
          uploads.push({ __fileRef: file.ref, encoding: "dataUrl", mimeType: trimmed(file.mimeType) || "image/png", maxBytes: MAX_INPUT_IMAGE_BYTES });
        }
      } else throw new Error("JSON or multipart body required");
      if (req.stream !== undefined && req.stream !== false && req.stream !== "false")
        throw new Error("stream is not supported; the complete image response is returned once all images are generated");
      if (req.response_format !== undefined && req.response_format !== "url" && req.response_format !== "b64_json")
        throw new Error("response_format must be url or b64_json");
      const images = imageReferences(req.image);
      for (const image of imageReferences(req.image_url)) if (!images.includes(image)) images.push(image);
      for (const upload of uploads) images.push(upload);
      if (ctx.operation === "edit" && !images.length) throw new Error("image is required");
      const model = trimmed(ctx.model);
      const requestBody = canonicalRequest(model, req, images);
      return {
        kind: "submit",
        model: model,
        action: images.length ? "image_to_image" : "text_to_image",
        requestBody: requestBody,
      };
    },
    render: function (ctx, task) {
      return {
        created: task.created_at,
        data: outputImages(task.data).map(function (url) {
          return { url: url };
        }),
        metadata: task.data,
      };
    },
  },
};

function responsesPrompt(req) {
  if (typeof req.input === "string") return req.input;
  if (!Array.isArray(req.input)) return typeof req.prompt === "string" ? req.prompt : "";
  const parts = [];
  for (const part of req.input) {
    if (typeof part === "string") {
      parts.push(part);
      continue;
    }
    if (!part || typeof part !== "object") continue;
    if (part.type !== "input_text" && part.text === undefined) continue;
    if (typeof part.text === "string" && trimmed(part.text)) parts.push(part.text);
  }
  const prompt = parts.join("\n");
  return prompt || (typeof req.prompt === "string" ? req.prompt : "");
}

export const native = {
  createImageTask: function (ctx) {
    if (!ctx.body || ctx.body.kind !== "json" || !ctx.body.value || typeof ctx.body.value !== "object" || Array.isArray(ctx.body.value))
      throw new Error("JSON object required");
    const req = ctx.body.value;
    // Native routes carry the model in the body; protocol routes pin ctx.model.
    const model = trimmed(ctx.model) || trimmed(req.model);
    const images = imageReferences(req.image_urls);
    const requestBody = canonicalRequest(model, req, images);
    return {
      kind: "submit",
      model: model,
      action: images.length ? "image_to_image" : "text_to_image",
      requestBody: requestBody,
    };
  },
  taskCreated: function (ctx, task) {
    return { task_id: task.task_id, task_status: "PENDING" };
  },
  taskStatus: function (ctx, task) {
    return task.data || {};
  },
  error: function (ctx, error) {
    return { code: error.code, message: error.message };
  },
};
