# ScriptFrame Video Generation — Process of Understanding (VGWorker Pipeline)

> **Status:** ✅ **Agreed — v1.1** (review answers incorporated 2026-08-30; no open questions). Ready for implementation.
> **Supersedes:** the orchestration sections of `VIDEO_GENERATION_DESIGN.md` (kept for the client-app vision; this document is the canonical runtime process).
>
> End-to-end process for generating a full video from a theme/topic using a **VGWorker** orchestrator, an **LLM** for story/planning, and **ComfyUI** for rendering. Written against the current codebase (`backend/` Express 5 + SQLite/Drizzle, `scriptframe-studio/` Angular).

---

## 1. Scope

One **StoryGenerationJob** (one video request) is processed by one **VGWorker** which drives five stages:

```
Initiate ──► Story & Characters (LLM) ──► Character Images (ComfyUI) ──► WAITING_REVIEW (human)
                                                                              │ approve
                                                                              ▼
                                              Clip Planning (LLM) ──► Clip Generation (ComfyUI, priority-ordered)
                                                                              │ all clips completed
                                                                              ▼
                                                     Fetch Media ──► Stitch (ffmpeg, priority order) ──► COMPLETED
```

- The LLM decides **which ComfyUI app to use for every render** (character portraits *and* video clips). To enable this, the VGWorker passes a **catalog of the workflow's attached ComfyUI apps** (title, description, required inputs) with every LLM prompt-generation call (§6.0).
- **ComfyUI renders videos one at a time** — jobs queue on the ComfyUI side, and each job is polled for up to the workflow's `maxTimeout` (§8).
- The backend **auto-retries a failed clip up to 3 total attempts**; only then does the clip become `FAILED`, and the user may restart it manually (§7).
- The final stitched MP4 (clips include audio) is registered in `assets` **with a reference to the story job** (§5.3).

Out of scope for this document: the end-user client UI (`scriptframe-client`), workflow authoring in Studio, and LLM provider onboarding.

---

## 2. Actors & Components

| Component | Exists today? | Role in this process |
|---|---|---|
| **Backend API** (`backend/src/routes`, Express 5) | ✅ | Entry points to initiate a run, submit review decisions, adjust the clip plan, retry failed clips, poll status. |
| **VGWorker** | ❌ new (`backend/src/workers/vgWorker.ts`) | One worker per story run. Owns the whole lifecycle: LLM calls, app-catalog building, ComfyUI submissions, polling, stitching. |
| **Submitter child threads** | ❌ new (spawned by VGWorker) | Short-lived tasks that POST `/prompt` payloads to ComfyUI and mark jobs `JOB_SUBMITTED`. |
| **Poller loop** | ❌ new (inside VGWorker) | Single 20-second interval loop; walks jobs in priority order and enforces the per-job `maxTimeout`. |
| **LLM** via `llmProviderService` | ✅ CRUD only — a `complete()`/`completeJson()` client is still to be added | Story generation, portrait job planning, clip planning. Provider/model/params/system-prompt come from the **LLM App bound to the workflow's Worker node** (`llmAppId` in `ScriptFrameNodeData`) — nothing is hard-coded. |
| **ComfyUI** via `comfyuiService` | ✅ (`queuePrompt`, `getHistory`, `getQueueStatus`, `uploadImage`, `getImage`) | Renders character images and video clips (**one video at a time** — additional jobs wait in ComfyUI's queue). |
| **ComfyUI Apps** (`comfyui_apps`) | ✅ | The render apps the LLM chooses from. VGWorker exposes each attached app's **name, description, and primary fields** to the LLM as a catalog (§6.0). Apps carry `primaryFields` + `defaultValues` + embedded `definition`. |
| **ScriptFrame workflow** (`scriptframe_workflows`) | ✅ | The preset chosen at initiation: Worker node binds the LLM App + ComfyUI stack (the attached apps form the catalog); workflow carries `maxClipLength`, `maxTimeout`, `nsfw`. |
| **VideoStitcher** (ffmpeg concat) | ❌ new (`backend/src/services/videoStitcher.ts`) | Concatenates completed clips in priority order into the final MP4, **preserving audio**. |

---

## 3. End-to-End Process (agreed)

| # | Step | Detail |
|---|---|---|
| 1 | Backend receives initiate request | `POST /api/video-runs` with `{ theme/topic, workflowId, targetDuration? }`. The target duration is optional — when omitted, the **LLM decides** the total length. Request is validated (Zod), a run id is minted, and the orchestrator spawns a **VGWorker**. |
| 2 | Backend initializes VGWorker thread | VGWorker is initialized with the resolved ScriptFrame workflow: the LLM App binding, the **catalog of ComfyUI apps attached via the workflow's stack**, and the limits (`maxClipLength`, `maxTimeout`). The HTTP request returns immediately with the job id. |
| 3 | StoryGenerationJob created (`PENDING`) | A `story_generation_jobs` row is inserted with `status = 'PENDING'` **before** any LLM work (the record exists even if the process dies early). |
| 4 | LLM: story + characters + portrait jobs | VGWorker calls the LLM App with the theme, duration target, **app catalog** (§6.0), and a strict JSON contract (§6.1). Result: story, character profiles, and a per-character **image job** (which image app to use + its primary values). |
| 5 | Character images rendered | VGWorker submits one ComfyUI image job per character using the app the LLM chose, polls/fetches the portraits, and attaches them to the story record (retry policy §7.2). |
| 6 | Status → `WAITING_REVIEW` | The story job becomes `WAITING_REVIEW` with story + characters + portraits persisted. |
| 7 | Human review loop (may repeat) | Reviewer can (a) **edit story/character text inline** (plain PATCH, no worker involvement), or (b) **request a change** ("make the villain younger") → VGWorker re-calls the LLM with the current draft + the change request and re-renders affected portraits, **staying in `WAITING_REVIEW`**. Revisions are versioned on the job. |
| 8 | Approve → clip planning (LLM) | VGWorker asks the LLM for the **clip plan** (§6.2), again supplying the app catalog so the LLM picks the right video app per clip. Clip count is the **LLM's decision**; clip lengths respect the workflow's `maxClipLength` cap; `continuesPrevious` clips start from the previous clip's last frame. |
| 9 | VideoGenerationJobs created (`PENDING`) | One `video_generation_jobs` row per clip: `storyJobId` (owner), `priority = index` (**0, 1, 2, … — lower value = earlier**), app id, prompt/primary values, continuation flag. While a clip is still `PENDING` (not yet submitted) the reviewer may **reorder, edit, or delete** clips (Q5); priorities are re-normalized to stay contiguous (0…n−1) after every change. |
| 10 | Submit child threads → `JOB_SUBMITTED` | VGWorker spawns child submitter threads that build the ComfyUI `/prompt` payload (app definition + merged `defaultValues` + primary values + optional start-frame image uploaded via `uploadImage`), queue it, and store the returned `promptId` with `status = 'JOB_SUBMITTED'`. ComfyUI renders **one video at a time**, so later jobs simply wait in ComfyUI's queue. |
| 11 | Poll every 20 s, in priority order | One poller loop checks ComfyUI `/history/{promptId}` for the lowest-priority-number incomplete job first; on completion it fetches the clip via `/view` into local storage, marks the row `COMPLETED`, and advances. **Each job must finish within the workflow's `maxTimeout`, measured from its submission** — essential because ComfyUI renders one video at a time. |
| 12 | Failure isolation & auto-retry | A failed submission, execution error, or timeout fails the **attempt**. VGWorker automatically retries the same clip up to **3 total attempts**; only then is the row marked `FAILED` (with error text). Other clips continue unaffected; the user can manually restart a `FAILED` clip later. |
| 13 | Stitch gate | **Only when every clip row of the story job is `COMPLETED`** does stitching start. If any row is `FAILED`, stitching does not run until that job is fixed and re-run to completion (§7). |
| 14 | Fetch & stitch | VGWorker resolves each completed clip's local file and builds an ffmpeg concat list **sorted by `priority` ASC**. Clips **include audio**; the concat preserves it (`-c:a copy`), with a re-encode fallback for mixed codecs/dimensions. |
| 15 | Done | Story job → `COMPLETED`. The final MP4 is registered in the **`assets` table with a reference to the story job** (Q6) and referenced by `story_generation_jobs.finalVideoPath`. Any failure at LLM/stitch stage → story job `FAILED`. |

---

## 4. State Machines

### 4.1 StoryGenerationJob

```
PENDING ──► STORY_GENERATING ──► WAITING_REVIEW ──► CLIP_PLANNING ──► GENERATING_CLIPS ──► STITCHING ──► COMPLETED
                │                     ▲    │                                                  │
                └── FAILED ◄──────────┘    └──(edit / change-request loops stay in                     ├── FAILED
                                           WAITING_REVIEW until approved)                            └── CANCELLED
```

- `PENDING` — row created; worker not yet started the story step.
- `STORY_GENERATING` — LLM story/character call + portrait rendering.
- `WAITING_REVIEW` — terminal-until-human. Edit and change-request round-trips do **not** leave this state (agreed).
- `CLIP_PLANNING` — LLM clip-plan call; jobs created at its end.
- `GENERATING_CLIPS` — clips exist with their own statuses (below); clip-plan adjustment (reorder/edit/delete) allowed while individual clips are `PENDING`.
- `STITCHING` — all clips completed, ffmpeg running.
- `COMPLETED` / `FAILED` / `CANCELLED` — final.

### 4.2 VideoGenerationJob (per clip)

```
              ┌─────────── attempt failed (attempts < 3) ───────────┐
              ▼                                                      │
PENDING ──► SUBMITTING ──► JOB_SUBMITTED ──► COMPLETED              │
    │             │               │                                 │
    │             └───────────────┴──► (attempts >= 3) FAILED       │
    │                     ▲                                         │
    └── CANCELLED         └──────── auto-retry (resubmit) ◄─────────┘
        (removed
         from plan)
```

- `PENDING` — row created after clip planning; not yet sent to ComfyUI; still editable/reorderable/deletable by the reviewer.
- `JOB_SUBMITTED` — accepted by ComfyUI `/prompt`; `comfyuiPromptId` stored.
- `COMPLETED` — media fetched to local storage; `assetPath` stored.
- `FAILED` — final after 3 failed attempts (submit error, poll timeout, or ComfyUI execution error); `error` populated; other jobs continue independently; user may restart manually.
- `CANCELLED` — clip removed from the plan by the reviewer before submission (kept for audit; D1).

---

## 5. Data Model

Reuses existing conventions: text UUIDs, epoch `created_at`/`updated_at`, JSON-in-text columns, Drizzle tables in `backend/src/db/schema.ts`.

### 5.1 `story_generation_jobs` (new)

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `workflowId` | text → `scriptframe_workflows.id` | Preset defining LLM App + ComfyUI stack (app catalog) + limits. |
| `theme` | text | User's topic/request. |
| `targetDurationSeconds` | integer | Optional; when absent the LLM decides the length. |
| `status` | text enum (§4.1) | Default `PENDING`. |
| `story` | json | Latest story document (§6.1 payload). |
| `characters` | json | Character profiles incl. image job + portrait asset path. |
| `clipPlan` | json | The LLM clip plan (§6.2), stored for auditability. |
| `reviewNotes` | json | Change requests from the review loop. |
| `finalVideoPath` | text | Set after stitching (also registered in `assets`, §5.3). |
| `error` | text | |
| `createdAt` / `updatedAt` | timestamp | |

### 5.2 `video_generation_jobs` (new)

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `storyJobId` | text → `story_generation_jobs.id` | Owner (cascade delete). |
| `priority` | integer | **0 = first clip**. Contiguous per story job; defines generation walk order **and** stitch order; re-normalized after reviewer reorder/delete. |
| `comfyuiAppId` | text → `comfyui_apps.id` | Chosen by the LLM from the app catalog. |
| `prompt` / `primaryValues` | json | Field values merged over the app's `defaultValues`. |
| `continuesPrevious` | integer(bool) | When true, the previous priority's last frame is uploaded as the start-frame input (fallback §7.5). |
| `startFrameUsed` | integer(bool) | False when continuation fell back to text-to-video. |
| `startFramePath` | text | Local path of the extracted last frame used for continuation. |
| `status` | text enum (§4.2) | Default `PENDING`. |
| `comfyuiPromptId` | text | Returned by `/prompt`; used for `/history` polling. |
| `assetPath` | text | Fetched clip file. |
| `attempts` | integer | Auto-retry counter; **max 3 total attempts** before `FAILED` (reset to 0 on manual restart). |
| `error` | text | Last attempt's error. |
| `submittedAt` / `completedAt` | timestamp | |

> The existing generic `jobs` table stays untouched; the new tables are purpose-built (the generic `jobs` enums don't cover `WAITING_REVIEW`/`JOB_SUBMITTED` semantics).

### 5.3 Reused tables

`scriptframe_workflows`, `comfyui_apps`, `llm_apps`, `llm_providers`, `comfyui_stacks` — no changes. For `assets` (Q6 = **both**):

- add nullable **`storyJobId`** column referencing `story_generation_jobs.id`;
- relax `assets.jobId` to **nullable** (story-level assets don't belong to the generic `jobs` table);
- register the final MP4 there **and** keep `story_generation_jobs.finalVideoPath`.

---

## 6. LLM Contracts

All LLM calls go through the **LLM App bound to the workflow's Worker node** (provider, model, temperature, max tokens, system instruction — per the agreed "LLM details + system instruction in the workflow"). Responses are strict JSON, validated with Zod; on validation failure the call is retried once, then the stage fails with the parse error.

### 6.0 ComfyUI App catalog (supplied with every render-related LLM call)

It is the **VGWorker's job** to build this catalog from the ComfyUI apps attached to the workflow (via its Worker node's ComfyUI stack) and to pass it to the LLM **both** in the story/portrait phase and in clip planning, so the LLM decides which app to use for image generation and for video generation:

```json
{
  "apps": [
    {
      "id": "uuid",
      "name": "T2V Wan 2.2 14B",
      "description": "Text-to-video, cinematic 720p, ~5s clips, has audio",
      "primaryFields": [ { "name": "prompt", "type": "string" }, { "name": "length", "type": "number" } ]
    },
    {
      "id": "uuid",
      "name": "SDXL Portrait",
      "description": "Text-to-image character portraits, 1024px",
      "primaryFields": [ { "name": "prompt", "type": "string" } ]
    }
  ]
}
```

`name` and `description` come straight from `comfyui_apps`; `primaryFields` gives the required inputs with types. If the LLM names an app that is not in the catalog, the call is retried once with a corrective note, then the stage fails (D3).

### 6.1 Story generation (step 4)

**Input:** theme, target duration (or "LLM decides"), `maxClipLength`, NSFW flag, **app catalog**, and (on revision) the current draft + change request.

**Output JSON:**

```json
{
  "title": "...",
  "logline": "...",
  "story": "full narrative text the reviewer will see and edit",
  "characters": [
    {
      "name": "...",
      "role": "...",
      "description": "appearance + personality shown to the reviewer",
      "imageJob": {
        "comfyuiAppId": "uuid-from-catalog",
        "primaryValues": { "prompt": "portrait prompt for this character", "width": 1024 }
      }
    }
  ]
}
```

### 6.2 Clip planning (step 8)

**Input:** approved story + characters, target duration (user-specified or LLM-decided), `maxClipLength` cap, **app catalog**.

**Output JSON (the "job format"):**

```json
{
  "totalDurationHintSeconds": 36,
  "clips": [
    {
      "index": 0,
      "comfyuiAppId": "uuid-from-catalog",
      "primaryValues": { "prompt": "...", "length": 6 },
      "continuesPrevious": false,
      "summary": "one-line description shown in the UI"
    },
    {
      "index": 1,
      "comfyuiAppId": "uuid-from-catalog",
      "primaryValues": { "prompt": "..." },
      "continuesPrevious": true,
      "summary": "..."
    }
  ]
}
```

`index` becomes `priority` verbatim (0, 1, 2, …). `continuesPrevious: true` means the clip must start from the **last frame of the clip at `index - 1`**.

---

## 7. Failure, Retry & Stitching Gate

1. **LLM failures** (network, non-JSON, schema mismatch, hallucinated app id): one immediate retry (with corrective note where applicable); then the stage fails and the story job → `FAILED` with reason. Reviewer can re-trigger from the UI.
2. **Portrait failures**: the same auto-retry policy as clips applies (up to 3 total attempts, D2). After exhaustion the failure is shown on the review screen; "regenerate" re-renders just that portrait. Not fatal for the story job.
3. **Clip attempt failure** (submit error, ComfyUI execution error, or `maxTimeout` breach): the **attempt** fails. VGWorker automatically re-queues the same clip — up to **3 total attempts** (agreed) — then marks the row `FAILED` + `error`. Other clips continue unaffected; the story job stays `GENERATING_CLIPS`.
4. **Manual restart**: a `FAILED` clip can be restarted by the user (optionally after editing prompt/values) → `attempts` reset to 0, status `PENDING`, submitter re-queues it. Failed clips **block stitching** until fixed and completed.
5. **Continuation fallback (agreed Q3)**: if last-frame extraction fails (e.g., corrupted clip), the clip proceeds **without** a start frame (text-to-video fallback); a warning is logged and `startFrameUsed = false` on the row.
6. **Timeout**: per-clip wall clock, measured from submission, capped by the workflow's `maxTimeout` (fallback: global default); breach = failed attempt → retry policy above. Required because ComfyUI renders one video at a time and a stalled head-of-line job must not hang the run.
7. **Stitching gate**: stitching is attempted **only** when `COUNT(status = 'COMPLETED') == COUNT(*)` for the story job (CANCELLED clips excluded from both counts). Any `FAILED` row blocks stitching; the UI surfaces exactly which clip is blocking.
8. **Worker crash recovery**: on backend restart, story jobs not in a final state are re-attached to a fresh VGWorker which resumes from persisted DB state (submitted clips keep polling via their `comfyuiPromptId`; `attempts` preserved).

---

## 8. ComfyUI Interaction Details

| Concern | Mechanism |
|---|---|
| **Execution model** | ComfyUI renders **one video at a time** (agreed). Submitters queue jobs; ComfyUI's own queue holds the rest; the poller enforces the per-job `maxTimeout` so a stalled job cannot hang the run. |
| Submit | `comfyuiService.queuePrompt(appDefinitionWithMergedValues, clientId)` — definition = app `definition` + `defaultValues` + job `primaryValues` (+ continuation start-frame node input override when used). |
| Continuation start frame | Extract the **last frame** of the previous clip (ffmpeg frame extraction) → `comfyuiService.uploadImage()` → inject the returned `name/subfolder` into the app's image input node. On extraction failure: text-to-video fallback (§7.5). |
| Polling | `/history/{promptId}` every **20 s** from one loop inside VGWorker, walking incomplete rows in `priority` ASC. `/queue` is used only to sanity-check queue depth on submission. |
| Fetch media | `/view` via `comfyuiService.getImage()` → stored under `backend/data/media/{storyJobId}/{priority}.mp4` (`.png` for portraits). |
| Stitching | ffmpeg concat demuxer over `assetPath`s sorted by `priority` ASC; `-c:a copy` to keep audio, re-encode fallback (`scale`/`fps` normalization) for mixed codecs/dimensions. |

---

## 9. Decision Log

### 9.1 Review answers (agreed 2026-08-30)

| Item | Decision |
|---|---|
| Portraits (A1) | ✅ Rendered by a text-to-image **ComfyUI App provided via the workflow**; chosen by the LLM from the app catalog (§6.0). |
| LLM config (A2) | ✅ The workflow carries the LLM provider + model (LLM App on the Worker node) plus system instruction. |
| Duration / clip length (A3) | ✅ User specifies duration **or** the LLM decides; clip length per demand, capped by the workflow's `maxClipLength`. Workflow also supplies `maxTimeout`; **ComfyUI renders one video at a time**, so every job is polled for that per-job timeout. |
| ffmpeg (A4) | ✅ Available on the backend host. |
| Retry (A5) | ✅ **Backend auto-retries a failed clip up to 3 total attempts**; after that the user restarts it manually. |
| Worker model (A6) | Delegated → in-process async workers via a singleton orchestrator (`better-sqlite3` handles stay on the main thread). |
| ComfyUI instance (A7) | ✅ One global instance for now (stack `baseUrl`/`port` targeting stays a future enhancement). |
| Audio (A8) | ✅ **Clips will have audio**; stitching preserves it (implementation delegated). |
| Q1 clip count | **LLM decides.** |
| Q2 statuses | User-named statuses (`PENDING`, `WAITING_REVIEW`, `JOB_SUBMITTED`, `FAILED`, `COMPLETED`) + intermediates left to implementation (§4). |
| Q3 continuation fallback | **Yes — fallback** to text-to-video without a start frame. |
| Q4 apps | **Multiple ComfyUI apps.** Each app carries enough context (title, description, required inputs); **VGWorker must provide title + description of every attached app to the LLM whenever it asks for prompt generation — for both image and video generation.** |
| Q5 plan mutation | **Yes** — reviewer may reorder/delete (and edit, D4) clips while they are `PENDING`; priorities re-normalize. |
| Q6 final asset | **Both** — register on `assets` with a reference to the story job, and keep `finalVideoPath` on the story job. |

### 9.2 Implementation-level decisions (delegated to me — flag if you disagree)

- **D1** — Deleting a planned clip marks its row `CANCELLED` (audit trail) rather than hard-deleting; priorities re-normalized across remaining rows.
- **D2** — Character portrait renders follow the same 3-attempt auto-retry policy as clips.
- **D3** — An LLM-chosen app that isn't in the catalog triggers one corrective retry, then stage failure (guards against hallucinated app ids).
- **D4** — Clip prompt/primary values are editable alongside reorder/delete while `PENDING`.
- **D5** — `assets.storyJobId` (nullable) added for story-level assets; `assets.jobId` relaxed to nullable.

**No open questions — ready for implementation.**

---

## 10. Implementation Checklist (mapped to codebase)

| Item | Where |
|---|---|
| Zod schemas for §6.0/§6.1/§6.2 JSON | `backend/src/types/videoGeneration.ts` (new) |
| `story_generation_jobs` / `video_generation_jobs` tables + migrations | `backend/src/db/schema.ts`, `backend/src/db/index.ts` |
| `assets` migration: nullable `jobId`, new nullable `storyJobId` (D5) | `backend/src/db/schema.ts` |
| `LLMProviderService.completeJson()` (provider-aware chat completion) | `backend/src/services/llmProvider.ts` |
| App-catalog builder (workflow stack → §6.0 catalog) | `backend/src/workers/vgWorker.ts` |
| VGWorker + orchestrator + submitter + 20 s poller (per-job `maxTimeout`) | `backend/src/workers/vgWorker.ts`, `backend/src/workers/orchestrator.ts` (new) |
| Continuation frame extraction + audio-preserving stitcher | `backend/src/services/videoStitcher.ts` (new, ffmpeg) |
| REST: initiate / get / review-edit / request-change / approve / clip-plan adjust (reorder/edit/delete) / retry-clip / list | `backend/src/routes/videoRuns.ts` (new; static subpaths registered before `/:id`, per project convention) |
| Media storage layout | `backend/data/media/{storyJobId}/` |
