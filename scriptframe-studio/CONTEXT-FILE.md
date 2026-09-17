# ScriptFrame Studio — Context File (Prompt Processing) [CONTEXT-FILE]

Reference for understanding any component to process a given prompt → final video.
Covers the three projects and how a user's theme/prompt becomes a stitched MP4.


## 2. The Prompt Processing Pipeline (end-to-end) [PIPELINE]

A user's theme/prompt is processed through a staged, LLM-driven pipeline:

    [1] Client: create-run form  --POST /api/runs/new--> [2] Controller creates PENDING story job + spawns VGWorker
                                                                          |
                                                                          v
[3] STORY_GENERATING: LLM writes story JSON (title/logline/story) + renders character portraits via ComfyUI image apps
                                                                          |  --> WAITING_REVIEW (human gate)
                                                                          v
        [6] Reviewer approves / requests change (LLM revises, re-renders only changed characters)
                                                                          |
[4] CLIP_PLANNING: LLM breaks approved story into ordered clips (comfyuiAppId + primaryValues per clip) --> rows in video_generation_jobs (priority = index)
                                                                          |
[5] GENERATING_CLIPS: submitter threads poll ComfyUI apps; 20s priority-ordered poller waits for each clip's output image
                                                                          |
[7] STITCHING: ffmpeg concat clips in priority order --> COMPLETED + final.mp4 asset row

Key design decisions:
- HUMAN REVIEW GATE (step 5): story must be approved before any video generation. Reviewer can approve or request a change; on change the LLM revises and only stale character portraits re-render.
- PRIORITY = chronological order: each clip's DB priority equals its index in the plan; stitch order == priority order.
- AUTO-RETRY (step 7): up to config.videoGeneration.maxJobAttempts attempts per clip before it is FAILED permanently; other clips continue independently.
- CRASH RECOVERY: one active VGWorker per story job kept in memory (orchestrator.ts); orphaned non-terminal runs re-attach on backend restart via recoverWorkers().


## 3. How a ScriptFrame Workflow Configures Prompt Processing [WORKFLOW]

The Studio workflow is the PRESET that tells the worker how to process prompts. It is a node graph.

Node types (ScriptFrameNodeType):
| Type | Meaning | Key config fields (in node.data) |
|------|---------|----------------------------------|
| worker | The orchestrator node; holds LLM + ComfyUI-stack bindings | llmAppId, comfyuiStackId, nsfw, plus optional overrides (maxClipLength, maxTimeout) read from workflow-level fields |
| llm | A standalone LLM app (not directly wired into the worker) | appId / appName |
| comfyui-stack | Named collection of ComfyUI apps a Worker drives; points at a specific instance or falls back to global config | id, name, baseUrl?, port?, appIds[], isActive |
| comfyui-app | A single ComfyUI app reference (not part of the worker's stack) | appId / appName |
| start | Entry point / trigger. Has no inputs and one wildcard output port that emits no data; it only lets the first node in the workflow connect | (none) |
| character-scene-creator | Renders character + location images from a script and prompt arrays using a ComfyUI stack | script, characterPrompts[], locationPrompts[], comfyuiStackId / comfyuiStackName (outputs characterImages[] / locationImages[] are filled at runtime) |

Workflow shape: typically a chain where LLM/comfyui nodes feed into a single worker node. The worker reads its bindings from node.data:
- data.llmAppId -> which LLM writes story + clip plans (required, else error)
- data.comfyuiStackId -> which stack's apps render clips/portraits (required; must have >=1 app)
- workflow.maxClipLength / workflow.maxTimeout -> per-clip length cap and overall timeout override

Character-Scene-Creator ports: inputs `script`, `character-prompts`, `location-prompts`, `comfyui-stack`; outputs `script`, `character-images`, `location-images`. Start's wildcard output can be wired to any of these input ports.

Node data fields (ScriptFrameNodeData): appId, appName, model, prompt, temperature, maxTokens, systemPrompt, llmAppId, comfyuiStackId, comfyuiStackName, comfyuiAppId, comfyuiAppName, script, characterPrompts, locationPrompts, characterImages, locationImages, nsfw, primaryValues.

Editor palette colors (for reference): worker=amber, llm=violet, comfyui-stack=cyan, comfyui-app=teal, string=green, number=blue, boolean=amber, image=red, audio=violet, video=orange.


## 4. Key Files & Where Prompt Logic Lives [FILES]

### Backend (backend/src/)
| File | Responsibility |
|------|----------------|
| controllers/videoRun.ts | HTTP endpoints for the run lifecycle: initiateVideoRun (create+spawn), getVideoRun, getReview, approve, requestChange, retryClip, cancelClip, restart, getFinalVideo. Uses Zod schemas; spawns worker fire-and-forget. |
| workers/orchestrator.ts | In-memory registry of active VGWorkers + crash recovery (startWorker, getWorker, recoverWorkers). |
| workers/vgWorker.ts | CORE prompt-processing engine. Drives the full pipeline: story generation, portrait rendering, clip planning (LLM), submission/polling threads, revision loop, stitching. Contains all LLM prompt strings and ComfyUI workflow-building logic. |
| services/videoGenerationJob.ts | Persists story jobs + clips/assets; status transitions (setStoryStatus, updateVideoJob, etc.). |
| services/scriptframeWorkflow.ts | CRUD for ScriptFrame workflows (the Studio presets). |
| services/llmProvider.ts | LLM calls via omniroute; completeJson<T> validates structured output against Zod schemas. |
| services/comfyuiApp.ts, comfyui.ts | ComfyUI stack/app registry + prompt queueing (queuePrompt) and history polling. |
| services/videoStitcher.ts | ffmpeg concat of clip images → final MP4. |
| types/scriptframe.ts | ScriptFrame node/workflow/stack types. |
| types/videoGeneration.ts | Story/clip/job types + Zod schemas (storyResultSchema, clipPlanSchema). |
| config/index.ts | Config incl. videoGeneration.maxJobAttempts, timeouts, media path. |

### Client (script-frame-client/src/app/)
| File | Responsibility |
|------|----------------|
| features/runs/create-run.component.ts | Prompt entry form (workflow select + theme); polls review checkpoint until ready. |
| features/runs/review.component.ts | Human review gate: approve / request change; triggers revision. |
| core/api/client.service.ts (ApiClient) | HTTP client wrapper used by all features. |
| models/index.ts | Client-side models (Job, Asset, ScriptFrameWorkflow, ComfyUI*, etc.). |

### Studio (scriptframe-studio/src/app/)
| File | Responsibility |
|------|----------------|
| components/workflow-editor/* | Visual node editor: canvas pan/zoom, palette, add/edit/delete nodes & links, save dialog. Uses Angular signals (no LitGraph). |
| services/scriptframe-workflow.service.ts | Backend API calls for workflow CRUD + connection testing. |
| models/index.ts | Studio-side models (mirrors backend ScriptFrame types; also legacy Job/ComfyUIJob/Workflow). |
| components/app-menu/*, comfyui-app/*, llm-app/* | App registration UIs feeding the backend registries. |


## 5. Prompt Processing Details (from vgWorker.ts) [PROMPTS]

### Story generation prompt
Instructs LLM to write a story JSON { title, logline, story } + character profiles (name, role, description, imagePrompt, imageNegativePrompt, imageAppId, imagePrimaryValues). Includes theme, duration guidance, content policy (SFW/NSFW), and the app catalog.

### Portrait rendering
For each character: merges app.definition + primaryFields + { ...imagePrimaryValues, prompt: imagePrompt, negative_prompt } into a ComfyUI workflow; queues via comfyuiService.queuePrompt; polls until done (non-fatal failure → reviewer regenerates).

### Clip planning prompt
Instructs LLM to break the approved story into ordered clips returning JSON with per-clip { comfyuiAppId, primaryValues (incl. motion/camera), durationHintSeconds, summary, continuesPrevious }. Validates app ids against catalog (one corrective retry then fail). Rows created with priority = index.

### Revision prompt
On reviewer change request, LLM revises the draft; characters whose visual definition changed get portraitStatus=PENDING and re-render.

### Clip submission/polling
Submitter loop submits PENDING clips in priority order; a 20s poller waits for each clip's ComfyUI output image (/view?filename=...&type=output). Auto-retry up to max attempts.


## 6. Status Lifecycle (story job) [LIFECYCLE]

PENDING → STORY_GENERATING → WAITING_REVIEW → [approve] CLIP_PLANNING → GENERATING_CLIPS → STITCHING → COMPLETED
- Alternative terminal states: FAILED, CANCELLED.
- Clips have their own statuses (PENDING, SUBMITTING, JOB_SUBMITTED, COMPLETED, FAILED) plus an attempts counter.

## 7. Quick Reference: Config & Constants [CONFIG]

- config.videoGeneration.maxJobAttempts — max retry attempts per clip.
- config.videoGeneration.defaultJobTimeoutSeconds — fallback timeout when workflow has no override.
- config.videoGeneration.mediaPath — base dir for job media; final video at {mediaPath}/{storyJobId}/final.mp4.
- ComfyUI output URL pattern: {comfyui.baseUrl}/view?filename=<f>&subfolder=<s>&type=output.

## 8. To Process a Given Prompt — Mental Model [MENTAL-MODEL]

1. WHERE DOES IT ENTER? script-frame-client create-run form → POST /api/runs/new with { workflowId, theme, targetDurationSeconds }.
2. WHAT CONFIGURES PROCESSING? The selected ScriptFrame workflow (built in Studio) binds the LLM app + ComfyUI stack that will process it.
3. WHO DOES THE WORK? backend spawns a VGWorker which: writes story via LLM → human approves → plans clips via LLM → renders each clip via ComfyUI apps → stitches to MP4.
4. HUMAN GATE: review must approve before generation; changes trigger revision (only stale portraits re-render).
5. OUTPUT: final stitched video streamed from {mediaPath}/{storyJobId}/final.mp4 with HTTP range support.

---

*Generated by scanning the repo. Key logic lives in backend/src/workers/vgWorker.ts; workflow presets are authored in scriptframe-studio/; users interact via script-frame-client/*.
