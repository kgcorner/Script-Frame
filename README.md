# ScriptFrame — AI Video & Image Generator

ScriptFrame is a monorepo for generating **videos and images with ComfyUI**, managing them
inside **user-owned projects**, and (in progress) automating the whole
**topic → story → scenes → clips → final video** pipeline with LLM + ComfyUI.

The generation engine is a predefined set of **ComfyUI workflows** (MiniMax H3, LTX and Flux
models). A Node/Express backend turns those workflows into a small REST API with
registration/login, project ownership, job tracking, artifacts and video stitching. Two
Angular clients consume that API:

| App | Purpose | Status |
| --- | --- | --- |
| `script-frame-client` | End-user app: register, own projects, generate images/videos, stitch clips into a final video | **Ready to use** |
| `scriptframe-studio` | Authoring studio: visual node-graph editor + LLM-app / ComfyUI-app configuration for the automated pipeline | **Under development** |

---

## Table of contents

- [Feature status](#feature-status)
- [Generation models & workflows](#generation-models--workflows)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [API overview](#api-overview)
- [Storage layout](#storage-layout)
- [Testing](#testing)
- [Roadmap (under development)](#roadmap-under-development)
- [Documentation index](#documentation-index)
- [Repository notes (legacy paths)](#repository-notes-legacy-paths)

---

## Feature status

### Ready to use

1. **Video & image generation via predefined ComfyUI workflows.**
   The backend renders a saved ComfyUI workflow from `backend/src/assets/*.json` (a plain
   ComfyUI workflow graph) and submits it to a running ComfyUI instance, then tracks the
   resulting job and stores the produced media as an immutable artifact.

   Workflows and the models they load are declared in
   [`backend/src/assets/workflows-cfg.json`](backend/src/assets/workflows-cfg.json) — this file
   is the public contract for the UI (field names, types, defaults, accepted values), while the
   sibling `*.json` files are the actual ComfyUI graphs.

2. **`script-frame-client` — a ready-to-use Angular app with user registration.**
   - Users register / sign in (JWT) and each **owns projects**.
   - Every project has **its own generation jobs and artifacts**, shown per project.
   - Users can **generate videos or images inside a project** and **stitch** completed clips
     into one final video.
   - Users choose **length (duration)**, **dimensions (aspect ratio for video)** and
     **quality (megapixels for video)** for each generation.

### Under development

3. **`scriptframe-studio` — topic-to-video pipeline builder.**
   The studio composes **ScriptFrame workflows** (LLM nodes + ComfyUI stacks) into an
   automated pipeline that turns a topic into a finished video:
   - generation from **multiple image or video references**,
   - automated **script writing**,
   - automated **prompt creation for each scene**,
   - generation proceeds **only after the user approves** the script/prompts at a review gate.

   > Parts of this backend already exist (`/api/video-runs`, the `story_generation_jobs` table
   > and the `VGWorker` orchestrator) and `script-frame-client` already ships `runs/new`,
   > `runs/:id/review` and `runs/:id/video` screens. The studio's node-graph authoring
   > experience is the piece still being built.

---

## Generation models & workflows

The shipped generation models, resolved from the ComfyUI graphs in `backend/src/assets/`:

| Workflow (`workflow` field) | Kind | Model family | Checkpoints referenced in the workflow |
| --- | --- | --- | --- |
| `T2V-minimax` | Text → Video | MiniMax H3 | `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors`, `minimax_h3_fl2va_pruned_int8_convrot.safetensors`, `minimax_h3_video_vae_fp16.safetensors`, `minimax_h3_audio_vae_fp32.safetensors`, `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` |
| `I2V-minimax` | Image → Video | MiniMax H3 | same MiniMax H3 stack |
| `T2V-LTX` | Text → Video (with audio) | LTX (**LTX-2.5** checkpoints in the shipped graphs) | `ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors`, `ltx-2.5-video-vae-bf16.safetensors`, `ltx-2.5-audio-vae-bf16.safetensors`, `ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors`, `gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors` |
| `I2V-LTX` | Image → Video (with audio) | LTX (**LTX-2.5** checkpoints in the shipped graphs) | same LTX-2.5 stack |
| `T2I-Flux` | Text → Image | Flux.1 Dev | `flux1-dev-fp8.safetensors`, `t5xxl_fp8_e4m3fn.safetensors`, `clip_l.safetensors`, `ae.safetensors` |

> **Note:** the LTX graphs in this repo reference **LTX-2.5** weights. Update the graphs (or
> install the matching checkpoints in ComfyUI) if you intend to run a different LTX release.

**Exposed inputs per workflow** (declared in `workflows-cfg.json`):

| Input | Type | Applies to | Notes |
| --- | --- | --- | --- |
| `prompt` | string | all | Generation prompt |
| `aspect_ratio` | string | video workflows | Full labels such as `16:9 (Widescreen)`, `9:16 (Portrait Widescreen)`, `1:1 (Square)`, `21:9 (Cinemascope)`; compact ids like `9:16` are accepted and expanded |
| `mp` | float | video workflows | Megapixels — the video quality control (default `0.9`) |
| `duration` | float | video workflows | Clip length in seconds (default `5`) |
| `image` | file | I2V workflows | Base64 data URI or the name of a stored image artifact |
| `width` / `height` | integer | `T2I-Flux` | Image dimensions (default `1024` × `1024`) |
| `fast` | boolean | MiniMax workflows | Faster generation toggle |

The public API also accepts friendly aliases: `megapixels` → `mp` and `aspectRatio` →
`aspect_ratio` (see `normalizeGeneratorInputs` in `backend/src/services/generator.ts`).

---

## Architecture

```
┌──────────────────────────┐     ┌───────────────────────────┐
│  script-frame-client     │     │  scriptframe-studio       │
│  Angular 22 (ready)      │     │  Angular 21 (in progress) │
│  projects · generate     │     │  node-graph editor        │
│  runs · stitch · export  │     │  LLM / ComfyUI app config │
└────────────┬─────────────┘     └─────────────┬─────────────┘
             │        REST /api (JWT Bearer)   │
             └───────────────┬─────────────────┘
                             ▼
            ┌──────────────────────────────────┐
            │  backend — Express 5 + TypeScript│
            │  auth · projects · jobs          │
            │  generator (T2I / T2V / I2V)     │
            │  video-runs (VGWorker)           │
            │  artifacts · export (ffmpeg)     │
            │  SQLite + Drizzle ORM            │
            └───────┬───────────────┬──────────┘
                    │               │
          ┌─────────▼──────┐  ┌─────▼──────────────┐
          │  ComfyUI       │  │  LLM providers      │
          │  /prompt       │  │  OmniRoute / cloud  │
          │  /history ...  │  │  / local runtimes   │
          └────────────────┘  └────────────────────┘
```

| Layer | Technology |
| --- | --- |
| Backend | Node.js, Express 5, TypeScript (run with `tsx`), Zod validation, JWT auth (`jsonwebtoken`), `bcryptjs` |
| Database | SQLite via `better-sqlite3` + Drizzle ORM (`backend/src/db/`) |
| Media processing | `ffmpeg` / `ffprobe` subprocesses for frame extraction and clip stitching |
| `script-frame-client` | Angular 22, standalone components, signals, Vitest (`ng test`) |
| `scriptframe-studio` | Angular 21, `@comfyorg/litegraph` node canvas, Vitest (`ng test`) |

---

## Repository layout

```
video-generator/
├── backend/                     # Express 5 + TypeScript API (port 3000)
│   ├── API.md                   # Full HTTP API reference (source of truth)
│   ├── docs/                    # Deep-dive wiring docs (video generation)
│   ├── .env.example             # Environment template
│   ├── src/
│   │   ├── assets/              # ComfyUI workflow graphs + workflows-cfg.json
│   │   ├── config/              # Env-driven configuration
│   │   ├── controllers/         # Route handlers
│   │   ├── routes/              # Express routers (index.ts mounts everything)
│   │   ├── services/            # Business logic (generator, jobs, export, ...)
│   │   ├── workers/             # VGWorker + orchestrator (story → clips → stitch)
│   │   ├── db/                  # Drizzle schema + SQLite init/migrations
│   │   ├── middleware/          # auth, error handling, CORS, request logging
│   │   └── types/               # Shared TypeScript types and Zod contracts
│   └── test/                    # Node test-runner + tsx test suite
├── script-frame-client/         # Angular 22 end-user app (ready)
│   └── src/app/
│       ├── core/                # ApiClient, auth, guards, interceptors, models
│       └── features/            # auth · projects · generate · workflows · runs
├── scriptframe-studio/          # Angular 21 authoring studio (in progress)
│   └── src/app/components/      # workflow-editor · comfyui-app · llm-app · app-menu
├── PROJECT_UNDERSTANDING.md     # Architecture / design notes for the studio
├── VIDEO_GENERATION_PROCESS.md  # Process of record for the automated pipeline
├── VIDEO_GENERATION_DESIGN.md   # Pipeline design notes
```

---

## Prerequisites

- **Node.js 20+** and npm (developed against Node 24 / npm 11). Each package installs its own
  dependencies; there is no workspace root `package.json`.
- **A running ComfyUI instance** (default `http://localhost:8188`) with the checkpoints listed
  above installed, reachable from the backend.
- **`ffmpeg` and `ffprobe`** on `PATH` — required for frame extraction, clip stitching and
  export. Override the binaries with `FFMPEG_PATH` / `FFPROBE_PATH`.
- **Optionally**, an LLM runtime for the automated pipeline: an OmniRoute endpoint
  (`OMNIROUTE_BASE_URL`) or any supported provider configured through the studio
  (Anthropic, OpenAI, Gemini, LM Studio, Ollama, OpenCode).

---

## Getting started

### 1. Backend API

```bash
cd backend
cp .env.example .env        # then edit values (JWT_SECRET, COMFYUI_BASE_URL, ...)
npm install
npm run dev                 # tsx watch src/index.ts  → http://localhost:3000
```

Other scripts:

```bash
npm run build               # tsc → dist/
npm start                   # node dist/index.js (run from backend/, keeps ./data paths)
npm test                    # tsx --test "test/**/*.test.ts"
```

Quick checks:

```bash
curl http://localhost:3000/health              # {"status":"ok",...}
curl http://localhost:3000/api/health/connection   # public LLM + ComfyUI reachability probe
```

### 2. script-frame-client (ready-to-use app)

```bash
cd script-frame-client
npm install
npm start                   # ng serve → http://localhost:4200
```

The API base URL lives in `src/environments/environment.ts` and
`src/environments/environment.prod.ts` (`apiUrl`, currently pointing at a LAN address — change
it to your backend, e.g. `http://localhost:3000/api`).

Main screens: `/login`, `/register`, `/projects`, `/generate[/:projectId]`, `/workflows`,
`/runs/new`, `/runs/:id/review`, `/runs/:id/video`. All routes except login/register are
guarded by `authGuard`.

### 3. scriptframe-studio (under development)

```bash
cd scriptframe-studio
npm install
npm start -- --port 4300    # 4300 avoids clashing with script-frame-client's 4200
```

API base URL lives in `src/environments/environment.ts` (`apiBaseUrl`, default
`http://localhost:3000/api`). Screens: `/workflow`, `/workflow/:id`, `/workflow-inputs`,
`/comfyui-apps`, `/llm-app-config`.

> Both Angular apps default to port **4200**, so run them on separate ports if you need both
> at once.

---

## Configuration

All backend configuration is environment-driven (`backend/src/config/index.ts`, loaded from
`backend/.env` via `dotenv`). Start from `backend/.env.example`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | API listen port |
| `NODE_ENV` | `development` | `production` makes `JWT_SECRET` mandatory (fail-fast) |
| `DB_PATH` | `./data/video-generator.db` | SQLite database file |
| `CORS_ORIGIN` | `*` | Allowed browser origin (set to your client URL) |
| `COMFYUI_BASE_URL` | `http://localhost:8188` | ComfyUI HTTP API base |
| `COMFYUI_TIMEOUT` | `120000` | ComfyUI request timeout (ms) |
| `COMFYUI_USER_WORKFLOWS_PATH` | `/tools/ComfyUI/user/default/workflows` | Where saved user workflows are read from |
| `OMNIROUTE_BASE_URL` | `http://localhost:8000` | LLM routing endpoint for the automated pipeline |
| `OMNIROUTE_API_KEY` | — | OmniRoute API key |
| `OMNIROUTE_TIMEOUT` | `30000` | LLM request timeout (ms) |
| `JWT_SECRET` | dev fallback | Token signing secret — **required** when `NODE_ENV=production` |
| `JWT_EXPIRES_IN` | `24h` | Token lifetime (`30m`, `12h`, `7d`, or seconds) |
| `BCRYPT_ROUNDS` | `10` | Password hash cost factor |
| `ADMIN_EMAIL` / `ADMIN_USERNAME` / `ADMIN_PASSWORD` | — / `admin` / — | Optional bootstrap admin seeded on first boot when the users table is empty |
| `GENERATOR_ASSETS_PATH` | `./data/assets` | Where fetched generator (T2I/T2V/I2V) artifacts are stored |
| `VG_MEDIA_PATH` | `./data/media` | Media root for video-run clips and final stitched videos |
| `VG_POLL_INTERVAL_MS` | `20000` | ComfyUI job polling cadence (ms) |
| `VG_MAX_JOB_ATTEMPTS` | `3` | Attempts per clip before it is marked failed |
| `VG_DEFAULT_JOB_TIMEOUT` | `900` | Default per-job completion timeout (s) |
| `VG_LLM_CORRECTION_RETRIES` | `1` | Corrective retries when the LLM returns malformed JSON |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | Media binary locations |
| `LLM_COMPLETION_TIMEOUT` | `180000` | Wall-clock cap for a single LLM completion (ms) |

> The first user to register becomes `admin` when no bootstrap admin is configured; later users
> get the `user` role.

---

## API overview

Full request/response documentation lives in **[`backend/API.md`](backend/API.md)**. All routes
are mounted under `/api` and, unless marked public, require
`Authorization: Bearer <JWT>`.

| Area | Endpoints |
| --- | --- |
| Health / discovery | `GET /health`, `GET /api/`, `GET /api/health`, `GET /api/health/connection` |
| Authentication | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` |
| Users (admin for create/list/delete) | `POST\|GET /api/users`, `GET\|PATCH\|DELETE /api/users/:id` |
| Projects (owner-scoped) | `POST\|GET /api/projects`, `GET\|PATCH\|DELETE /api/projects/:id` |
| **Generator** | `GET /api/generator-config`, `POST /api/generate-i2v`, `POST /api/generate-t2v`, `POST /api/generate-t2i` |
| Jobs & export | `POST\|GET /api/jobs`, `GET /api/jobs/:id[/status]`, `PATCH\|DELETE /api/jobs/:id`, `POST /api/jobs/:id/{process,cancel}`, **`POST /api/export/video`** (stitch clips) |
| Artifacts (public media) | `GET /api/artifact/:name`, `GET /artifact/:name` |
| ComfyUI apps & stacks | `/api/comfyui-apps`, `/api/comfyui-stacks` |
| LLM providers & apps | `/api/llm-providers`, `/api/llm-providers/apps` |
| ScriptFrame workflows | `/api/scriptframe-workflows` (+ `test-connection`) |
| **ScriptFrame video runs** | `POST /api/video-runs`, `GET /api/video-runs/:id[/review\|/video]`, `PATCH /api/video-runs/:id/{approve,request-change,edit-story,restart}`, clip edit/retry/cancel/reorder |

### Generation flow (T2I / T2V / I2V)

1. `GET /api/generator-config` → available workflows and their input definitions.
2. `POST /api/generate-t2v` (or `-i2v` / `-t2i`) with `{ workflow, projectId, ...inputs }` →
   `201 { jobId, projectId, status, workflow }`.
3. Poll `GET /api/jobs/:id/status` until `completed` → returns the artifact
   `{ name, type, mimeType, url: "/artifact/<name>" }`.
4. Fetch the media from the returned public `url`.

### Final video (stitch / export)

1. Collect the completed video artifact names of a project.
2. `POST /api/export/video` with `{ videos: ["clip-a.mp4", "clip-b.mp4"], projectId }` →
   `201 { jobId, status: "not_started" }`.
3. Poll `GET /api/jobs/:id/status`; when `completed`, the stitched MP4 is at its artifact URL.

### Automated pipeline (in development)

`POST /api/video-runs` with `{ workflowId, theme, targetDurationSeconds? }` starts the
`VGWorker` lifecycle: story + character portraits → `WAITING_REVIEW` →
approve / request-change / edit-story → clip planning → clip generation → stitching. See
`backend/src/workers/vgWorker.ts` and
[`backend/docs/VIDEO_GENERATION_WIRING.md`](backend/docs/VIDEO_GENERATION_WIRING.md).

---

## Storage layout

| What | Where |
| --- | --- |
| SQLite database | `backend/data/video-generator.db` (+ `-wal` / `-shm` in WAL mode) |
| Generator artifacts (T2I/T2V/I2V output) | `backend/data/assets/` (`GENERATOR_ASSETS_PATH`) |
| Video-run clips & final videos | `backend/data/media/` (`VG_MEDIA_PATH`) |
| Artifact delivery | Public, immutable, range-capable URLs at `/artifact/<name>` and `/api/artifact/<name>` |

Artifacts are **write-once** and never deleted, so media URLs stay valid — this is why export
outputs are named after the export job id (`<jobId>.mp4`).

---

## Testing

Backend (Node's built-in test runner executed through `tsx`):

```bash
cd backend
npm test          # 58 tests across API, auth, generator, export, workflow and stack suites
```

Angular apps (Vitest via the Angular unit-test builder):

```bash
cd script-frame-client && npm test
cd scriptframe-studio  && npm test
```

Useful sanity commands:

```bash
cd backend && npm run build                       # TypeScript compile check
cd script-frame-client && npm run build           # production bundle
cd scriptframe-studio  && npm run build           # production bundle
```

---

## Roadmap (under development)

**Scriptframe-Studio — topic-to-video pipeline**

- Compose a **ScriptFrame workflow** from `LLM` nodes + `ComfyUI` stack nodes in a visual graph
  (`@comfyorg/litegraph`), persisted to the `scriptframe_workflows` table.
- Generate the video from a topic, optionally seeded by **multiple image and/or video
  references**.
- **Automated script writing** and **per-scene prompt creation** driven by the configured LLM.
- A **human approval gate**: generation only proceeds after the user approves the generated
  script/prompts (and can request changes or edit the story inline).
- Prepare per-character **reference images/portraits** for visual consistency across scenes.
- Drive clips to completion, then **stitch in order** into the final video.

**Related building blocks already in the backend**

- `scriptframe_workflows` (nodes/links, `nsfw`, `maxClipLength`, `maxTimeout`) with a
  connectivity test endpoint.
- `comfyui_apps` (parameterized ComfyUI entry points) and `comfyui_stacks` (ordered app groups).
- `llm_providers` + `llm_apps` (provider, model, temperature, tokens, system prompt, endpoint).
- `story_generation_jobs` + `video_generation_jobs` with the `VGWorker` state machine and
  `/api/video-runs/*` control endpoints.

See [`VIDEO_GENERATION_PROCESS.md`](VIDEO_GENERATION_PROCESS.md) for the process of record and
[`PROJECT_UNDERSTANDING.md`](PROJECT_UNDERSTANDING.md) for the studio architecture.

---

## Documentation index

| Document | Contents |
| --- | --- |
| [`backend/API.md`](backend/API.md) | Complete HTTP API reference (auth, projects, jobs, generator, export, video runs) |
| [`backend/docs/VIDEO_GENERATION_WIRING.md`](backend/docs/VIDEO_GENERATION_WIRING.md) | How a story-generation request flows through `VGWorker` to LLM/ComfyUI and a stitched MP4 |
| [`VIDEO_GENERATION_PROCESS.md`](VIDEO_GENERATION_PROCESS.md) | v1.1 process of record for the automated pipeline |
| [`VIDEO_GENERATION_DESIGN.md`](VIDEO_GENERATION_DESIGN.md) | Pipeline design notes |
| [`PROJECT_UNDERSTANDING.md`](PROJECT_UNDERSTANDING.md) | Studio architecture, data model and component relationships |
| [`script-frame-client/README.md`](script-frame-client/README.md) | Client dev/build/test + PWA install notes |

---

## Repository notes (legacy paths)

These paths are older iterations or scratch files and are **not** part of the current
application; keep new work inside `backend/`, `script-frame-client/` and `scriptframe-studio/`:

- `client/` — a previous Angular client (superseded by `script-frame-client/`).
- `backup/comfyui-app/` — archived studio components.
- `json`, `pathlib`, `test_*.py`, `check_*.py` — one-off Python/scratch artifacts.
- `data/video-generator.db` — a stale database copy; the live database is
  `backend/data/video-generator.db`.
- `backend/.tmp-nodelete.ts` — temporary backend scratch file.

---

## License

No license file is present in this repository yet. Add one before distributing or publishing
the project.



