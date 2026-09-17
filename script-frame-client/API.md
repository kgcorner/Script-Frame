# Video Generator Backend API

This reference describes the HTTP API implemented under `backend/src`.

## Conventions

- API base path: `/api`.
- JSON requests use `Content-Type: application/json`.
- JSON body limit is 25 MB because I2V requests may contain base64 images.
- Unless marked **Public**, endpoints require `Authorization: Bearer <JWT>`.
- JWT claims contain `sub` (user id), `email`, `username`, and `role` (`admin` or `user`). The default lifetime is 24 hours (`JWT_EXPIRES_IN` configures it).
- Password hashes are never returned by the user endpoints.
- Array endpoints usually return `{ "success": true, "data": [] }`; user and project lists also return `pagination`.

## Shared errors

```json
{
  "success": false,
  "error": "Validation Error",
  "code": "VALIDATION_ERROR",
  "details": [{ "field": "name", "message": "..." }]
}
```

The shared middleware uses these statuses/codes: `400 VALIDATION_ERROR` or `BAD_REQUEST` for invalid input/preconditions; `401 UNAUTHORIZED` for missing, invalid, or expired authentication; `403 FORBIDDEN` for RBAC/ownership failures; `404 NOT_FOUND` for missing routes/resources; `409 CONFLICT` for duplicate/state conflicts; `500 INTERNAL_ERROR` for unexpected failures; and `503 SERVICE_UNAVAILABLE` for unavailable dependencies.

## Authorization model

- `GET /health`, `GET /api/health/connection`, `POST /api/auth/register`, and `POST /api/auth/login` are public.
- `GET /api/auth/me` is authenticated explicitly. The remaining `/api` routes are behind the global JWT middleware, including the other `/api/health/*` probes.
- User creation/listing/deletion are admin-only. User reads/updates are self-or-admin.
- Projects are owned by the JWT subject. Generic jobs are owner-only; legacy jobs with `userId: null` are admin-only.
- ScriptFrame video runs require authentication but currently have no controller-level owner check.

---

# Health and discovery

## `GET /health`

**Auth:** Public process liveness probe.

**Success:** `200`

```json
{ "status": "ok", "timestamp": "2026-09-16T12:00:00.000Z" }
```

This does not probe external services.

## `GET /api/`

**Auth:** Bearer token.

**Success:** `200` with `{ name: "Video Generator API", version: "1.0.0", endpoints: { ... } }`. The index lists the principal auth, user, project, job, workflow, health, service, ComfyUI, LLM, ScriptFrame, generator, artifact, and export paths.

## `GET /api/health`

Runs OmniRoute and ComfyUI checks and records them.

**Success:** `200` for overall `healthy` or `degraded`; `503` for overall `unhealthy`.

```json
{
  "success": true,
  "status": "healthy | degraded | unhealthy",
  "checks": [{ "service": "omniroute | comfyui", "status": "healthy | unhealthy", "latency": 42, "error": "optional", "timestamp": 1726488000000 }],
  "timestamp": 1726488000000
}
```

## `GET /api/health/omniroute`

Checks and records OmniRoute. **Success:** `200` if healthy, otherwise `503`; body is `{ success: true, data: { service, status, latency, error?, timestamp } }`.

## `GET /api/health/comfyui`

Checks and records ComfyUI. **Success:** `200` if healthy, otherwise `503`; body has the same health-check shape with `service: "comfyui"`.

## `GET /api/health/connection`

**Auth:** Public (no `Authorization` header required). Live, non-recording reachability probe for the LLM and ComfyUI services. **Success:** always `200` when the endpoint can build a response; dependency failures are in the payload.

```json
{
  "success": true,
  "data": {
    "llm": { "service": "omniroute", "label": "LLM", "endpoint": "http://localhost:8000", "connected": true, "status": "healthy", "latency": 20, "error": null },
    "comfyui": { "service": "comfyui", "label": "ComfyUI", "endpoint": "http://localhost:8188", "connected": true, "status": "healthy", "latency": 25, "error": null, "version": "0.x" },
    "allConnected": true,
    "checkedAt": "2026-09-16T12:00:00.000Z"
  }
}
```

## `GET /api/health/history`

**Query:** required `service` (`omniroute` or `comfyui`); optional integer `limit` (default `100`). **Success:** `200`, `{ success: true, data: [healthCheck, ...] }`. **Errors:** `400` with `Invalid service parameter` when `service` is absent/invalid.

## `GET /api/health/latest`

**Success:** `200`, `{ success: true, data: { omniroute: healthCheck, comfyui: healthCheck } }`. A service with no history gets an unhealthy placeholder (`error: "No health check recorded"`, `timestamp: 0`).

---

# Authentication

## `POST /api/auth/register`

**Auth:** Public.

**Body:** `{ "email": "person@example.com", "username": "person_1", "password": "passw0rd123" }`.

Email must be valid. Username is 3–32 characters and only `[A-Za-z0-9_-]`. Password is 8–128 characters with at least one letter and one digit.

**Success:** `201`, `{ success: true, data: { user: SafeUser, token: "<jwt>" } }`. The first account on an empty database becomes `admin`; later public registrations are `user` accounts.

**Errors:** `400` validation error; `409 CONFLICT` with `Email is already registered` or `Username is already taken`.

## `POST /api/auth/login`

**Auth:** Public.

**Body:** `password` plus one of `identifier`, `email`, or `username`, for example `{ "identifier": "person@example.com", "password": "passw0rd123" }`.

**Success:** `200`, `{ success: true, data: { user: SafeUser, token: "<jwt>" } }`.

**Errors:** `400` validation error; `401` with the non-enumerating message `Invalid credentials` for unknown, inactive, or incorrect credentials.

## `GET /api/auth/me`

**Success:** `200`, `{ success: true, data: SafeUser }`.

**Errors:** `401` for missing/invalid token or when the token subject no longer exists.

---

# Users

All user routes require authentication. Create/list/delete additionally require `admin`.

## `POST /api/users`

**Body:** `{ email, username, password, role?, isActive? }`. Role is `admin|user` and defaults to `user`; `isActive` defaults to `true`. Credential constraints match registration.

**Success:** `201`, `{ success: true, data: SafeUser }`.

**Errors:** `400`, `401`, `403`, or `409` for duplicate email/username.

## `GET /api/users`

**Query:** `search`; `role=admin|user`; `isActive=true|false`; `limit` 1–200 (default 50); `offset` (default 0).

**Success:** `200`, `{ success: true, data: [SafeUser, ...], pagination: { total, limit, offset } }`.

**Errors:** `400` for invalid query values; `401`/`403` for authentication/RBAC failures.

## `GET /api/users/:id`

Caller must be the target user or an admin. **Success:** `200`, `{ success: true, data: SafeUser }`. **Errors:** `403` with `You can only view your own profile`; `404` with `User not found`.

## `PATCH /api/users/:id`

**Body:** At least one of `email`, `username`, `password`, `currentPassword`, `role`, `isActive`. Non-admins can change only their own username/password; changing a password requires the matching `currentPassword`. Email/role/active status are admin-only. Admins cannot change their own role or deactivate themselves.

**Success:** `200`, `{ success: true, data: SafeUser }`.

**Errors:** `400` for empty patch, missing current password, or self-lockout; `401` for incorrect current password; `403` for foreign/admin-only operations; `404` missing user; `409` duplicate email/username.

## `DELETE /api/users/:id`

Admin only; admins cannot delete themselves. **Success:** `200`, `{ success: true, message: "User deleted" }`. **Errors:** `400` self-delete; `404` `User not found`; `401`/`403` authentication/RBAC.

---

# Projects

Projects are scoped to the authenticated user. A project belonging to another user is treated as not found.

## `POST /api/projects`

**Body:** `{ name, description?, aspectRatio?, modelPreset?, status? }`.

`name` is required (1–120 chars). `description` may be null and is limited to 2,000 chars. `aspectRatio` defaults to `16:9`; `modelPreset` defaults to `default`; `status` is `active|draft|completed` and defaults to `active`.

**Success:** `201`, `{ success: true, data: SafeProject }`.

**Errors:** `400` validation error; `401`; account/persistence failures may be `500`.

## `GET /api/projects`

**Query:** `search` (name substring), `limit` 1–200 (default 50), `offset` (default 0).

**Success:** `200`, `{ success: true, data: [SafeProject, ...], pagination: { total, limit, offset } }`; only the caller's projects are returned.

## `GET /api/projects/:id`

**Success:** `200`, `{ success: true, data: SafeProject }`.

**Errors:** `404` with `Project not found` for a missing or foreign project.

## `PATCH /api/projects/:id`

**Body:** At least one of `name`, `description`, `aspectRatio`, `modelPreset`, `status`, `thumbnailUrl`, or `sceneCount`. Field constraints match creation; `sceneCount` is an integer from 0 to 1,000,000 and `description` may be null.

**Success:** `200`, `{ success: true, data: SafeProject }`.

**Errors:** `400` empty/invalid patch; `404` with `Project not found` for missing/foreign project.

## `DELETE /api/projects/:id`

**Success:** `200`, `{ success: true, message: "Project deleted" }`.

**Errors:** `404` with `Project not found` for missing/foreign project.

`SafeProject` fields are `id`, `userId`, `name`, `description`, `aspectRatio`, `modelPreset`, `status`, `thumbnailUrl`, `sceneCount`, `createdAt`, and `updatedAt`.

---

# Generator

These endpoints are mounted at the API root. Workflow-specific input fields are intentionally open-ended: the selected configuration defines their names, types, defaults, and accepted values.

## `GET /api/generator-config`

**Success:** `200`, `{ success: true, data: [{ name, description, inputs: { field: { name, type, default?, acceptedValues? } } }] }`.

## `POST /api/generate-i2v`

## `POST /api/generate-t2v`

## `POST /api/generate-t2i`

The three routes share a contract. I2V/T2V create video jobs; T2I creates an image job.

**Body:** Required `workflow` (configured workflow name) and `projectId` (caller-owned project), plus the selected workflow's input fields:

```json
{ "workflow": "my-workflow", "projectId": "project-uuid", "prompt": "A cinematic ocean sunrise", "image": "data:image/png;base64,..." }
```

Inputs are validated against the selected workflow. File inputs accept a supported image data URI or the name of a stored image artifact; defaults are filled from the workflow.

**Success:** `201`, `{ success: true, data: { jobId, projectId, status: "processing", workflow } }`.

**Errors:** `400` missing/invalid workflow input or image data/artifact; `401`; `404` workflow or caller-owned project not found; `503` ComfyUI image upload unavailable; other generation failures may be `500`.

---

# Artifacts

Artifacts are immutable stored media. Both mounts are public and serve the same controller.

## `GET /api/artifact/:name`

## `GET /artifact/:name`

**Auth:** No authorization is required. The root mount is the URL returned by job status responses; the API mount is also available.

**Success:** `200` with media bytes, stored `Content-Type`, `Content-Disposition: inline`, `Accept-Ranges: bytes`, immutable cache headers, and `Content-Length`. A valid `Range: bytes=start-end` (including suffix `bytes=-N`) returns `206` with `Content-Range` and the requested bytes.

**Errors:** `404` `{ success: false, error: "Artifact not found" }`; `416` with `Content-Range: bytes */<size>` for malformed/unsatisfiable ranges.

---

# Jobs and export

## `POST /api/jobs`

**Body:** `{ prompt, model?, duration?, fps?, resolution?, workflowId?, parameters? }`. `prompt` is required. `duration` and `fps` are positive integers up to 60; `resolution` must match `widthxheight`; `workflowId` must be a UUID; `parameters` is an open-ended object.

**Success:** `201`, `{ success: true, data: Job }` with status initially `pending` and ownership set to the caller.

**Errors:** `400` validation error; `401`.

## `GET /api/jobs`

**Query:** `status` (`not_started|pending|processing|completed|failed|cancelled`), `limit` (default 50), `offset` (default 0).

**Success:** `200`, `{ success: true, data: [Job, ...] }`. Users see their own jobs; admins also see legacy jobs whose `userId` is null.

## `GET /api/jobs/:id`

**Success:** `200`, `{ success: true, data: { ...Job, assets: [Asset, ...] } }`.

**Errors:** `404` with `Job not found` for missing or unauthorized foreign ids. Legacy jobs are accessible only to admins.

## `GET /api/jobs/:id/status`

Reconciles non-terminal ComfyUI jobs before responding.

**Success:** `200`,

```json
{
  "success": true,
  "data": {
    "jobId": "job-uuid",
    "userId": "user-uuid",
    "projectId": "project-uuid",
    "status": "not_started | pending | processing | completed | failed | cancelled",
    "comfyuiPromptId": "prompt-uuid",
    "error": null,
    "artifact": { "name": "job-uuid.mp4", "type": "video", "mimeType": "video/mp4", "url": "/artifact/job-uuid.mp4" }
  }
}
```

`artifact` is null until completed output is fetched; legacy jobs may have null `userId`/`projectId`.

**Errors:** `404` with `Job not found` for missing/foreign jobs; reconciliation failures may be `500`/`503`.

## `PATCH /api/jobs/:id`

**Body:** Any subset of `status` (`pending|processing|completed|failed|cancelled`), `progress` (0–100), `message`, and `error`.

**Success:** `200`, `{ success: true, data: Job }`.

**Errors:** `400` validation error; `404` with `Job not found` for missing/foreign jobs.

## `POST /api/jobs/:id/process`

Starts processing for an authorized job. **Success:** `200`, `{ success: true, message: "Job processing started" }`. **Errors:** `404` with `Job not found`; dependency failures may be `500`/`503`.

## `POST /api/jobs/:id/cancel`

Cancels an authorized job; a processing job also asks ComfyUI to interrupt. **Success:** `200`, `{ success: true, message: "Job cancelled" }`. **Errors:** `404` with `Job not found`.

## `DELETE /api/jobs/:id`

Deletes the job row; stored artifacts are retained. **Success:** `200`, `{ success: true, message: "Job deleted" }`. **Errors:** `404` with `Job not found`.

## `POST /api/export/video`

Creates a background export job that stitches stored video artifacts in the supplied order.

**Body:** `{ "videos": ["clip-a.mp4", "clip-b.mp4"], "projectId": "project-uuid" }`. `projectId` is optional; when provided, it must belong to the caller and is saved on the export job. At least one non-empty name is required. Every name must resolve to a stored video artifact; duplicates are allowed and order is preserved.

**Success:** `201`, `{ success: true, data: { jobId, status: "not_started", videos: ["clip-a.mp4", "clip-b.mp4"], projectId? } }`. Poll `/api/jobs/:id/status`, then fetch its artifact URL.

**Errors:** `400` with `Invalid videos list` and per-entry `{ index, name, message }` details for unknown/non-video artifacts; `401`; `404` with `Project not found` for a missing or foreign project.

---

# Workflows

These are persisted ComfyUI workflow definitions, distinct from file-backed generator configurations.

## `POST /api/workflows`

**Body:** `{ name, description?, definition, version?, isActive? }`. `name` is required; `definition` is an open-ended object; `version` is a positive integer defaulting to 1; `isActive` defaults to true.

**Success:** `201`, `{ success: true, data: Workflow }`.

**Errors:** `400` validation error.

## `GET /api/workflows`

**Query:** `isActive=true|false`, `limit` (default 50), `offset` (default 0).

**Success:** `200`, `{ success: true, data: [Workflow, ...] }`.

## `GET /api/workflows/:id`

**Success:** `200`, `{ success: true, data: Workflow }`. **Errors:** `404` with `Workflow not found`.

## `GET /api/workflows/comfyui/saved`

**Success:** `200`, `{ success: true, data: [{ name, workflow: ComfyUIWorkflow, timestamp }, ...] }`. Reads JSON workflows from the configured ComfyUI user-workflows directory; unavailable/empty directories produce `[]`.

## `GET /api/workflows/comfyui/history`

**Success:** `200`, `{ success: true, data: [savedWorkflow, ...] }` from ComfyUI execution history. Unavailable history produces `[]`.

## `PATCH /api/workflows/:id`

**Body:** Any subset of `name`, `description`, `definition` (object), `version` (positive integer), and `isActive`.

**Success:** `200`, `{ success: true, data: Workflow }`. **Errors:** `400` validation error; `404` with `Workflow not found`.

## `POST /api/workflows/:id/activate`

**Success:** `200`, `{ success: true, data: Workflow }` with `isActive: true`. **Errors:** `404` with `Workflow not found`.

## `POST /api/workflows/:id/deactivate`

**Success:** `200`, `{ success: true, data: Workflow }` with `isActive: false`. **Errors:** `404` with `Workflow not found`.

## `DELETE /api/workflows/:id`

**Success:** `200`, `{ success: true, message: "Workflow deleted" }`. The delete service is idempotent and does not emit a controller-level 404 for a missing id.

---

# Service proxies

All service proxy endpoints require a bearer token and forward requests to configured OmniRoute or ComfyUI services.

## OmniRoute

### `POST /api/services/omniroute/generate`

**Body:** `{ prompt, model?, parameters?, workflowId? }`. `prompt` is required; `parameters` is open-ended and `workflowId` must be a UUID when supplied.

**Success:** `200`, `{ success: true, data: { jobId, status: "queued|processing|completed|failed", result?, error? } }`.

**Errors:** `400` validation error; upstream failures may be `500`/`503`.

### `GET /api/services/omniroute/status/:jobId`

**Success:** `200`, `{ success: true, data: { jobId, status, progress, result?, error? } }`.

### `POST /api/services/omniroute/cancel/:jobId`

**Success:** `200`, `{ success: true, message: "Job cancelled" }`.

### `GET /api/services/omniroute/models`

**Success:** `200`, `{ success: true, data: ["model-id", ...] }`. Upstream failure is represented as an empty list.

## ComfyUI

### `POST /api/services/comfyui/prompt`

**Body:** `{ workflow: ComfyUIWorkflow, clientId? }`. The workflow is an open-ended ComfyUI node map and is passed through.

**Success:** `200`, `{ success: true, data: { prompt_id, number, node_errors } }`.

### `GET /api/services/comfyui/history/:promptId`

**Success:** `200`, `{ success: true, data: ComfyUIHistoryResponse }` keyed by prompt id; entries contain `prompt`, `outputs`, and `status`.

### `GET /api/services/comfyui/queue`

**Success:** `200`, `{ success: true, data: { queue_running: [...], queue_pending: [...] } }`.

### `GET /api/services/comfyui/stats`

**Success:** `200`, `{ success: true, data: { system: { ram_total, ram_free, comfyui_version }, devices: [...] } }`.

### `POST /api/services/comfyui/interrupt`

**Success:** `200`, `{ success: true, message: "Interrupted" }`.

### `POST /api/services/comfyui/free`

**Body:** Optional `{ "unloadModels": true }`; defaults to true and is forwarded as ComfyUI `unload_models`.

**Success:** `200`, `{ success: true, message: "Memory freed" }`.

### `GET /api/services/comfyui/models`

**Success:** `200`, `{ success: true, data: { "NodeClass": [...] } }`; upstream failure returns `{}`.

### `GET /api/services/comfyui/embeddings`

**Success:** `200`, `{ success: true, data: ["embedding-name", ...] }`; upstream failure returns `[]`.

### `GET /api/services/comfyui/object_info`

**Success:** `200`, `{ success: true, data: { ... } }`; upstream failure returns `{}`.

---

# ComfyUI apps and stacks

## ComfyUI apps

### `POST /api/comfyui-apps`

**Body:** `{ name, description?, workflowId, workflowDefinition?, primaryFields, defaultValues? }`. `workflowId` and at least one primary field are required. A primary field has `nodeId`, `inputName`, `label`, `type` (`string|number|boolean|select|file|folder`), `required`, and `order`, plus optional default/options/tooltip/min/max/step values.

**Success:** `201`, `{ success: true, data: ComfyUIApp }`.

**Errors:** `400` validation error or `Workflow not found: provide a valid workflowId or workflowDefinition`; persistence failures may be `500`.

### `GET /api/comfyui-apps`

**Query:** `isActive=true|false`, `workflowId`, `limit` (default 50), `offset` (default 0).

**Success:** `200`, `{ success: true, data: [ComfyUIApp, ...] }`.

### `GET /api/comfyui-apps/:id`

**Success:** `200`, `{ success: true, data: ComfyUIApp }`. **Errors:** `404` with `ComfyUI App not found`.

### `GET /api/comfyui-apps/:id/inputs`

**Success:** `200`, `{ success: true, data: { primaryFields: [...], allInputs: { "nodeId:inputName": { nodeId, inputName, defaultValue, isPrimary } } } }`.

**Errors:** Missing/invalid workflow definitions may produce `500`.

### `POST /api/comfyui-apps/:id/execute`

**Body:** `{ "primaryValues": { "nodeId:inputName": "value" } }`. Values are open-ended and validated against the app's primary fields.

**Success:** `200`, `{ success: true, data: { workflow: ComfyUIWorkflow, promptId } }`.

**Errors:** `400` validation error or `Validation failed` with details; `404` with `ComfyUI App not found`; inactive/invalid workflow or ComfyUI failures may be `500`.

### `PATCH /api/comfyui-apps/:id`

**Body:** Any subset of `name`, `description`, `primaryFields`, `defaultValues`, and `isActive`.

**Success:** `200`, `{ success: true, data: ComfyUIApp }`. **Errors:** `400` validation error; `404` with `ComfyUI App not found`.

### `DELETE /api/comfyui-apps/:id`

**Success:** `200`, `{ success: true, message: "ComfyUI App deleted" }`. Deletion is idempotent.

## ComfyUI stacks

### `POST /api/comfyui-stacks`

**Body:** `{ name, description?, baseUrl?, port?, appIds? }`. Name is required; port must be a positive integer when supplied.

**Success:** `201`, `{ success: true, data: ComfyUIStack }`.

### `GET /api/comfyui-stacks`

**Query:** `isActive=true|false`, `limit` (default 50), `offset` (default 0).

**Success:** `200`, `{ success: true, data: [ComfyUIStack, ...] }`.

### `GET /api/comfyui-stacks/:id`

**Success:** `200`, `{ success: true, data: ComfyUIStack }`. **Errors:** `404` with `ComfyUI stack not found`.

### `GET /api/comfyui-stacks/:id/test`

**Success:** `200` with `{ success: true, data: { healthy: true, message, latency } }` when healthy, or the same HTTP `200` with `success: false` and `healthy: false` when unhealthy. Missing stacks and empty stacks are represented in the payload.

### `PATCH /api/comfyui-stacks/:id`

**Body:** Any subset of `name`, `description`, `baseUrl`, `port`, `appIds`, and `isActive`. Supplying `appIds` replaces membership order; unknown app ids are skipped.

**Success:** `200`, `{ success: true, data: ComfyUIStack }`. **Errors:** `400` validation; `404` with `ComfyUI stack not found`.

### `DELETE /api/comfyui-stacks/:id`

**Success:** `200`, `{ success: true, message: "ComfyUI stack deleted" }`.

---

# LLM providers and apps

Supported provider names are `anthropic`, `openai`, `gemini`, `opencode`, `omniroute`, `lmstudio`, and `ollama`.

## `GET /api/llm-providers/configs`

**Success:** `200`, `{ success: true, data: [LLMProviderConfig, ...] }`. Each config describes default URL, model endpoint, auth type, streaming support, and API-key requirement.

## `POST /api/llm-providers/fetch-models`

**Body:** `{ provider, baseUrl, apiKey? }`; provider must be supported and baseUrl must be a URL.

**Success:** The service result is returned without an additional wrapper: `{ success: true, data: [ { id, name, description? }, ... ] }`.

Provider failures normally return `{ success: false, error }` with HTTP `200`; malformed input is `400`.

## `POST /api/llm-providers`

**Body:** `{ name, displayName, baseUrl, apiKey?, config? }`. Name is one of the supported providers; displayName and URL are required; config is open-ended.

**Success:** `201`, `{ success: true, data: LLMProvider }`.

## `GET /api/llm-providers`

**Query:** `isActive=true|false`, `name` (supported provider), `limit` (default 50), `offset` (default 0).

**Success:** `200`, `{ success: true, data: [LLMProvider, ...] }`.

## `GET /api/llm-providers/:id`

**Success:** `200`, `{ success: true, data: LLMProvider }`. **Errors:** `404` with `LLM Provider not found`.

## `PATCH /api/llm-providers/:id`

**Body:** Any subset of `displayName`, `baseUrl`, `apiKey`, `config`, and `isActive`.

**Success:** `200`, `{ success: true, data: LLMProvider }`. **Errors:** `400` validation; `404` with `LLM Provider not found`.

## `DELETE /api/llm-providers/:id`

**Success:** `200`, `{ success: true, message: "LLM Provider deleted" }`.

## `POST /api/llm-providers/apps`

**Body:** `{ name, description?, providerId, endpoint?, apiKey?, model, temperature?, maxTokens?, systemPrompt?, config? }`. `providerId` may be a provider name or saved provider UUID. Name, providerId, and model are required; temperature is 0–2 and maxTokens is at least 1.

**Success:** `201`, `{ success: true, data: LLMApp }`.

## `GET /api/llm-providers/apps`

**Query:** `isActive=true|false`, `providerId`, `limit` (default 50), `offset` (default 0).

**Success:** `200`, `{ success: true, data: [LLMApp, ...] }`.

## `GET /api/llm-providers/apps/:id`

**Success:** `200`, `{ success: true, data: LLMApp }`. **Errors:** `404` with `LLM App not found`.

## `PATCH /api/llm-providers/apps/:id`

**Body:** Any subset of `name`, `description`, `endpoint`, `apiKey`, `model`, `temperature`, `maxTokens`, `systemPrompt`, `config`, and `isActive`.

**Success:** `200`, `{ success: true, data: LLMApp }`. **Errors:** `400` validation; `404` with `LLM App not found`.

## `DELETE /api/llm-providers/apps/:id`

**Success:** `200`, `{ success: true, message: "LLM App deleted" }`.

Provider/app responses currently come directly from persistence; protect this API because stored API-key fields may be present.

---

# ScriptFrame workflows

A ScriptFrame workflow is a graph of nodes and links. Node types are `worker`, `llm`, `comfyui-stack`, `comfyui-app`, `start`, and `character-scene-creator`.

## `POST /api/scriptframe-workflows`

**Body:** `{ name, description?, nodes, links?, nsfw?, maxClipLength?, maxTimeout? }`.

At least one node is required. Each node requires `id`, supported `type`, `title`, and numeric `{ x, y }`; `inputs` and `outputs` default to empty arrays. Links default to `[]`. `maxClipLength` is a positive integer up to 86,400 seconds; `maxTimeout` is a positive integer up to 604,800 seconds.

**Success:** `201`, `{ success: true, data: ScriptFrameWorkflow }`.

**Errors:** `400` validation error.

## `GET /api/scriptframe-workflows`

**Query:** `limit` (default 50), `offset` (default 0).

**Success:** `200`, `{ success: true, data: [ScriptFrameWorkflow, ...] }`.

## `GET /api/scriptframe-workflows/:id`

**Success:** `200`, `{ success: true, data: ScriptFrameWorkflow }`. **Errors:** `404` with `ScriptFrame workflow not found`.

## `PATCH /api/scriptframe-workflows/:id`

**Body:** Any subset of `name`, `description`, `nodes`, `links`, `nsfw`, `maxClipLength`, and `maxTimeout`; the two limits may be `null` to clear them.

**Success:** `200`, `{ success: true, data: ScriptFrameWorkflow }`. **Errors:** `400` validation; `404` with `ScriptFrame workflow not found`.

## `DELETE /api/scriptframe-workflows/:id`

**Success:** `200`, `{ success: true, message: "ScriptFrame workflow deleted" }`. Deletion is idempotent.

## `POST /api/scriptframe-workflows/test-connection`

**Body:** `{ nodeId, type: "llm|comfyui-stack|comfyui-app", appId? }`. An LLM target normally needs `appId`.

**Success:** `200`, `{ success: true, data: { nodeId, type, status: "healthy|unhealthy", message, latency? } }`. Connection failures are represented as `status: "unhealthy"`; malformed input is `400`.

## `POST /api/scriptframe-workflows/test-connections`

**Body:** `{ targets: [{ nodeId, type, appId? }, ...] }`; `targets` may be empty.

**Success:** `200`, `{ success: true, data: [ScriptFrameTestConnectionResponse, ...] }`.

---

# ScriptFrame video runs

These endpoints operate the story/clip generation lifecycle. They require authentication, but the current controller does not add a per-run ownership check. Story statuses are `PENDING`, `STORY_GENERATING`, `WAITING_REVIEW`, `CLIP_PLANNING`, `GENERATING_CLIPS`, `STITCHING`, `COMPLETED`, `FAILED`, and `CANCELLED`. Clip statuses are `PENDING`, `SUBMITTING`, `JOB_SUBMITTED`, `COMPLETED`, `FAILED`, and `CANCELLED`.

## `POST /api/video-runs`

Starts a run and launches the worker asynchronously.

**Body:** `{ "workflowId": "scriptframe-workflow-id", "theme": "A mystery in space", "targetDurationSeconds": 60 }`. Workflow id and theme are required; target duration is an optional positive integer.

**Success:** `201`, `{ success: true, data: StoryGenerationJob, workerStarted: true }`.

**Errors:** `400` with `ScriptFrame workflow not found: <id>` or a validation error.

## `GET /api/video-runs/:id`

**Success:** `200`, `{ success: true, data: { ...StoryGenerationJob, clips: [VideoGenerationJob, ...] } }`. **Errors:** `404` with `Video run not found`.

## `GET /api/video-runs/:id/review`

**Success:** `200`, `{ success: true, data: { status, story, characters, revision } }`. **Errors:** `404` with `Video run not found`.

## `PATCH /api/video-runs/:id/approve`

Approves only a `WAITING_REVIEW` run and wakes its worker.

**Success:** `200`, `{ success: true, data: StoryGenerationJob }`.

**Errors:** `404` with `Video run not found`; `409` with `Cannot approve a run in status <status>` when not awaiting review.

## `PATCH /api/video-runs/:id/request-change`

**Body:** `{ "request": "Make the villain younger" }`; request must be non-empty. The worker remains in `WAITING_REVIEW`; without a worker, the note is appended to review notes.

**Success:** `200`, `{ success: true, data: StoryGenerationJob }`. **Errors:** `400` validation; `404` with `Video run not found`.

## `PATCH /api/video-runs/:id/edit-story`

**Body:** Any subset of `story`, `title`, and `logline`. Empty bodies are accepted and make no story-field changes.

**Success:** `200`, `{ success: true, data: { ...StoryGenerationJob, story: { ... } } }`. **Errors:** `400` validation; `404` with `Video run not found`.

## `PATCH /api/video-runs/:id/restart`

Resets a run to `PENDING`, clears error/failure stage/final path, and starts a worker.

**Success:** `200`, `{ success: true, data: StoryGenerationJob, restarted: true }`.

**Errors:** `404` with `Video run not found`; `409` with `A worker is already running for this video run`.

## `GET /api/video-runs/:id/video`

Streams the final stitched MP4. **Success:** `200` with `Content-Type: video/mp4`, `Content-Length`, and `Accept-Ranges: bytes`; `206` for a range request with `Content-Range`. **Errors:** `404` with `Video run not found`, or `Final video not ready` plus current `status` when no final path exists.

## `PATCH /api/video-runs/:id/clips/:clipId`

Edits only a `PENDING` clip belonging to the specified run.

**Body:** Any subset of `comfyuiAppId`, `primaryValues` (open-ended object), and `continuesPrevious`.

**Success:** `200`, `{ success: true, data: VideoGenerationJob }`.

**Errors:** `400` validation; `404` with `Clip not found`; `409` with `Cannot edit a clip in status <status>` for submitted/terminal clips.

## `POST /api/video-runs/:id/clips/:clipId/retry`

Resets the clip to `PENDING`, clears its error and ComfyUI prompt id, and resets attempts. The clip must belong to the run.

**Success:** `200`, `{ success: true, data: VideoGenerationJob }`. **Errors:** `404` with `Clip not found`.

## `POST /api/video-runs/:id/clips/:clipId/cancel`

Soft-deletes a clip by setting it to `CANCELLED` with an audit error; cancelled clips are excluded from stitching.

**Success:** `200`, `{ success: true, data: VideoGenerationJob }`. **Errors:** `404` with `Clip not found`.

## `PATCH /api/video-runs/:id/clips/reorder`

Reorders all clips before generation; priorities are renumbered from 0 in the supplied order.

**Body:** `{ "orderedIds": ["clip-id-1", "clip-id-2"] }`. It must be a permutation of every clip id in the run; no ids may be omitted or added.

**Success:** `200`, `{ success: true, data: [VideoGenerationJob, ...] }` ordered by the new priority.

**Errors:** `400` validation or the operation error `orderedIds must be a permutation of all clip ids of the story job` (the current shared handler exposes unexpected service errors as `500 INTERNAL_ERROR`).

---

# Operational notes

- Configure `JWT_SECRET` in production; the server refuses to start without it in production. Development uses a fallback secret if none is supplied.
- External service URLs use `OMNIROUTE_BASE_URL` and `COMFYUI_BASE_URL`.
- Generator artifacts use `GENERATOR_ASSETS_PATH`; video-run media uses `VG_MEDIA_PATH`.
- The API currently describes implementation behavior, including intentional open-ended/pass-through payloads; it is not a generated OpenAPI schema.
