# ScriptFrame Video Generation — Backend Wiring Explained

Reference for how a story-generation request flows from the HTTP API through the
`VGWorker` to LLM / ComfyUI and finally to a stitched MP4. All file/method names are
verified against the current source in `backend/src/`.

> **Important correction vs. earlier notes:** `VGWorker` does **not** use Node.js
> worker threads (`worker_threads`). Concurrency is achieved with concurrent async
> loops (`Promise.all`). This matters for the server-exit diagnosis: a thread that
> terminates the event loop would be one possible cause — it is not present here.

---

## 1. Route that receives the story-generation request

- **File:** `src/routes/videoRuns.ts` → line 11:
  ```ts
  router.post('/', v.initiateVideoRun.bind(v));
  ```
  Mounted at `/api/video-runs/` (POST). Body schema (`initiateSchema`, line 16) requires
  `workflowId`, `theme`, and optional `targetDurationSeconds`.

- **Handler:** `src/controllers/videoRun.ts` → `VideoRunController.initiateVideoRun()`
  (line 24): parses input, fetches the workflow via
  `scriptframeWorkflowService.getWorkflow(...)`, creates a PENDING story job with
  `jobs.createStoryJob(...)`, then calls `startWorker(job.id)` (lines 31–32). The HTTP
  response returns immediately (`workerStarted: true`) — fire-and-forget.

## 2. Where VGWorker is initialized

- **`controllers/videoRun.ts:31-32`:**
  ```ts
  const { startWorker } = await import('../workers/orchestrator.js');
  startWorker(job.id).catch((err) => console.error(`[VGWorker ${job.id}] launch failed:`, err));
  ```

- **`src/workers/orchestrator.ts:16-36`:** `startWorker(storyJobId)` constructs
  `new VGWorker(storyJobId)` (line 19), registers it in the in-memory
  `activeWorkers` Map (keyed by story job id, line 8), then calls `worker.run()`
  fire-and-forget. Returns `null` if a worker is already running for that job
  (idempotency).

## 3. How VGWorker "registers" the story-generation task

- **`VGWorker.run()`** (`vgWorker.ts:113`) reads the persisted DB status and dispatches
  via a `switch`:
  - `PENDING` / `STORY_GENERATING` → `generateStoryAndPortraits()` → WAITING_REVIEW →
    `reviewLoop()` → `planAndQueueClips()` → `generateClips()` → `stitchFinalVideo()`.

- The worker is "registered" in the orchestrator's Map (so it can be looked up via
  `getWorker(id)` for direct control calls), and removed from the Map when `run()`
  finishes or throws (`finally` block, lines 27–29).

## 4. How VGWorker sends the request to LLM for character + story generation

- **`generateStoryAndPortraits()`** (`vgWorker.ts:180`) builds a prompt (lines 193–210)
  embedding theme, duration/clip constraints, content policy, and the full ComfyUI app
  catalog.
- Calls **`llmProviderService.completeJson<StoryResult>({ appId: ctx.llmAppId, userPrompt, schema: storyResultSchema })`** (line 212). The LLM returns `{ title, logline, story, characters[] }`.
- Characters are normalized into `CharacterProfile[]` and persisted via
  `jobs.updateStoryJob(...)` (lines 229–235), then portraits are rendered.

## 5. How VGWorker sends the request for character image generation

- **`renderPortraits()`** (`vgWorker.ts:239`) runs one submission per character concurrently (line 246).
- Merges the ComfyUI app's embedded `definition` + `primaryFields` with the character's prompt / negative / primary values via `this.mergeValues(...)` (lines 253–257).
- Calls **`comfyuiService.queuePrompt(workflow, clientId)`** (line 259) → returns a `prompt_id`.
- Polls for completion and downloads the PNG via **`pollAndFetchMedia(promptId, path, 'image', timeout)`** (lines 263–268). Failures are non-fatal (reviewer can regenerate).

## 6. How VGWorker asks LLM to generate prompts for clips

- **`planAndQueueClips()`** (`vgWorker.ts:284`) builds a prompt (lines 296–316) with the
  approved story, duration constraints, and available video apps.
- Calls **`llmProviderService.completeJson<ClipPlan>({ appId: ctx.llmAppId, userPrompt, schema: clipPlanSchema })`** (line 318). Returns `{ clips[] }`.
- `validatePlanApps()` guards against hallucinated app IDs (one corrective retry, then fail — line 341).
## 7. How VGWorker "initializes threads" for submitting video-generation requests ⚠️ CORRECTION

There are **no Node.js worker threads** (`worker_threads`). Concurrency is via two parallel async loops:

- **`generateClips()`** (`vgWorker.ts:351`) runs `Promise.all([submitter, poller])` (line 357).
- **`submitterLoop()`** (`vgWorker.ts:366`): repeatedly fetches PENDING clips and submits them in priority order via `submitClip()`.
- **`pollerLoop()`** (`vgWorker.ts:422`): a single loop that walks completions strictly by priority.

## 8. How status is updated on the VideoGeneration Job rows

All mutations go through the service layer (`services/videoGenerationJob.ts`, imported as `jobs` in the worker):

- **Submitter:** `updateVideoJob(id, {status:'SUBMITTING'})` (line 385) → on success `{status:'JOB_SUBMITTED', comfyuiPromptId, attempts+1}` (lines 409–415). On failure → `handleClipFailure()` (auto-retry up to `maxJobAttempts`).
- **Poller:** sets `COMPLETED` + `assetPath` when ComfyUI history reports success (line 456); sets FAILED on error/timeout.

## 9. How video-generation progress is polled

- **Clip polling:** `pollerLoop()` every `config.videoGeneration.pollIntervalMs` (**20s default**) → **`comfyuiService.getHistory(promptId)`** (line 446). Waits for `entry.status.completed`, then downloads the MP4 via `fetchMedia()`. Enforces a per-job timeout measured from submission time.
- **Approval polling:** `reviewLoop()` (`vgWorker.ts:163`) wakes every 1500ms or immediately when approval/change arrives (via `Promise.race([waitForApproval(), sleep(1500)])`, line 173).

## 10. How video stitching happens

- **`stitchFinalVideo()`** (`vgWorker.ts:471`) sets status to STITCHING, fetches all clips.
- **Hard gate:** blocks unless every non-cancelled clip is `COMPLETED` with an `assetPath` (lines 476–480).
- Sorts assets by priority → calls **`videoStitcher.stitchClips(ordered, outputPath)`** producing `<storyId>/final.mp4` (line 484).
- Inserts an `assets` row and sets the story status to `COMPLETED` with `finalVideoPath`.

---

## Summary of key files / methods

| Layer | File · Method | Role |
|---|---|---|
| HTTP entry | `routes/videoRuns.ts:11`, `controllers/videoRun.ts:initiateVideoRun()` | Receives request, creates job |
| Worker registry | `workers/orchestrator.ts:startWorker()`, `recoverWorkers()` | In-memory Map + crash recovery at startup |
| Orchestration | `VGWorker.run()` (`vgWorker.ts:113`) | Status-dispatch switch |
| LLM story+chars | `generateStoryAndPortraits()` → `llmProviderService.completeJson<StoryResult>` (line 212) | Step 4 |
| Character images | `renderPortraits()` → `comfyuiService.queuePrompt` + `pollAndFetchMedia` (lines 239–275) | Step 5 |
| LLM clip plan | `planAndQueueClips()` → `completeJson<ClipPlan>` (line 318) | Step 6 |
| Submission/concurrency | `generateClips()` → `submitterLoop()` + `pollerLoop()` via `Promise.all` (lines 351–466) | Steps 7,9 |
| Status writes | service layer `jobs.updateVideoJob/setStoryStatus/...` | Step 8 |
| Stitching | `stitchFinalVideo()` → `videoStitcher.stitchClips` (line 484) | Step 10 |

| Stitching | `stitchFinalVideo()` → `videoStitcher.stitchClips` (line 484) | Step 10 |

