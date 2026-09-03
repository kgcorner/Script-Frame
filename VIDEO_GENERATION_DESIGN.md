# ScriptFrame: Topic-to-Video Generation Architecture & Plan

This document details the architecture, data models, state machine, and phased implementation plan for the automated Topic-to-Video generation pipeline and the separate user-facing client application.

---

## 1. System Architecture Overview

The system is split into two frontend applications connected to a single unified backend:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                ARCHITECTURE OVERVIEW                                   │
├─────────────────────────────────────┬──────────────────────────────────────────────────┤
│        ScriptFrame Studio           │               ScriptFrame Client                 │
│         (Workflow Creator)          │                  (End-User App)                  │
│  - LiteGraph Node Canvas            │  - Topic & Duration Form                         │
│  - ComfyUI App Configuration        │  - Story & Character Approval Checkpoint         │
│  - LLM App Configuration            │  - Real-time Scene Progress Tracker              │
│  - ScriptFrame Workflow Presets     │  - Final Video Player & Download                 │
└──────────────────┬──────────────────┴────────────────────────┬─────────────────────────┘
                   │                                           │
                   ▼                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              ScriptFrame Backend API                                   │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                    Generation Orchestrator (Stateful Job Engine)                 │  │
│  │                                                                                  │  │
│  │  1. Topic + Length ──► LLM (Story & Character JSON)                              │  │
│  │  2. Character JSON ──► ComfyUI (I2I Face Consistency Workflow)                   │  │
│  │  3. ──► [WAIT FOR USER APPROVAL CHECKPOINT] ◄──                                  │  │
│  │  4. Approved Story ──► LLM (Scene Breakdown with Duration Constraints)           │  │
│  │  5. Scene Prompts  ──► ComfyUI (Sequential Video + Audio Generation)             │  │
│  │  6. Rendered Clips ──► FFmpeg Concat Demuxer ──► Final Video File                │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- **ScriptFrame Studio (`scriptframe-studio/`)**: For power users and creators to design workflows, configure LLM apps (prompts/temperatures), and define ComfyUI apps (exposing primary inputs, defaults).
- **ScriptFrame Client (`scriptframe-client/`)**: A clean, form-based consumer app for everyday users to generate videos from topics without touching workflow graphs.
- **Backend API (`backend/`)**: Express 5 + SQLite/Drizzle orchestrator coordinating LLM completions, ComfyUI image-to-image (I2I) and text-to-video jobs, and FFmpeg video/audio assembly.

---

## 2. End-to-End Pipeline Execution Flow

```
[User Input via UI] (Topic, Target Length: e.g. 30s, Max Clip: e.g. 6s, Workflow Preset)
      │
      ▼
[Phase 1: Pre-Production & Character Drafting] (Status: `drafting`)
  ├─► 1. LLM Step 1: Generates structured JSON:
  │     • Story / Script (synopsis, logline, narrative arc)
  │     • Character profiles (name, visual prompt, facial features, personality)
  └─► 2. ComfyUI Step 1: Dispatches character visual prompts to ComfyUI I2I App:
        • Generates face-consistent reference portraits for each character
        • Stores generated portraits as asset records linked to the project
      │
      ▼
[Phase 2: Human-in-the-Loop Checkpoint] (Status: `awaiting_approval`)
  ├─► User inspects Story synopsis and Character cards with portrait images
  ├─► User can optionally edit story text or request character portrait regeneration
  └─► User clicks "Approve & Generate Full Video"
      │
      ▼
[Phase 3: Scene Planning & Production] (Status: `generating_scenes`)
  ├─► 1. LLM Step 2: Breaks approved story into N scenes:
  │     • Target scene count = ceil(Target Duration / Max Clip Duration)
  │     • Each scene has: `sceneNumber`, `prompt` (visual cues, audio cues, character references), `durationSeconds` (<= Max Clip Duration)
  │     • Backend validates: sum(scene durations) ≈ Target Duration
  └─► 2. ComfyUI Step 2: Sequential Queue Execution:
        • For each scene 1..N:
            - Submit prompt with visual & audio conditioning to ComfyUI Video App
            - Poll ComfyUI queue until clip MP4 (with audio) is completed
            - Update project progress (e.g. 20%, 40%, 60%...) and emit asset updates
      │
      ▼
[Phase 4: Post-Production & Stitching] (Status: `stitching`)
  ├─► Backend gathers all N generated scene clips in sequence
  ├─► Runs FFmpeg concat demuxer to merge video and embedded audio streams
  └─► Stores final stitched MP4 asset in DB and marks project `completed`
```


---

## 3. Core Backend Components

### A. LLM Completion Engine (`backend/src/services/llmProvider.ts`)
Add structured chat completion methods to the existing provider service:
- Support OpenAI-compatible endpoints (`/v1/chat/completions`) for OpenAI, LM Studio, OmniRoute, OpenCode, and Ollama.
- Support Anthropic (`/v1/messages`) and Gemini (`/v1beta/models/...:generateContent`).
- Add `completeJson<T>(appId: string, systemPrompt: string, userPrompt: string, jsonSchema?: object): Promise<T>` with JSON markdown extraction and retry on invalid schema.

### B. Database Schema (`backend/src/db/schema.ts`)
Add a dedicated `video_projects` table for stateful project tracking:

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `text` (UUID) | Primary Key |
| `name` / `topic` | `text` | User provided topic prompt |
| `targetDuration` | `integer` | Expected total video length in seconds |
| `maxClipDuration` | `integer` | User-configured maximum length per scene clip in seconds |
| `status` | `text` | `drafting`, `awaiting_approval`, `generating_scenes`, `stitching`, `completed`, `failed`, `cancelled` |
| `currentStage` | `text` | Current status label (e.g., "Drafting Characters", "Rendering Scene 2/5") |
| `progress` | `integer` | Overall percentage (0-100) |
| `scriptframeWorkflowId` | `text` | FK to `scriptframe_workflows` preset |
| `story` | `text` (JSON) | Story object `{ title, synopsis, logline, script }` |
| `characters` | `text` (JSON) | Array of `{ id, name, description, visualPrompt, imageUrl, status }` |
| `scenes` | `text` (JSON) | Array of `{ sceneNumber, prompt, duration, clipUrl, status }` |
| `outputVideoUrl` | `text` | Final stitched video URL |
| `error` | `text` | Error details if failed |
| `createdAt` / `updatedAt` / `completedAt` | `integer` | Timestamps |

### C. Video Generation Orchestrator (`backend/src/services/videoOrchestrator.ts`)
- **`startProject(input)`**:
  1. Call LLM with topic + target length to produce Story and Character specs.
  2. For each character, trigger ComfyUI I2I workflow to create face-consistent portraits.
  3. Set status to `awaiting_approval`.
- **`approveProject(projectId, overrides?)`**:
  1. Persist any user text/character modifications.
  2. Call LLM to break story into scenes satisfying `duration <= maxClipDuration`.
  3. Set status to `generating_scenes`.
  4. Sequentially dispatch and poll ComfyUI Video App for each scene.
  5. On all scenes ready, invoke `VideoStitcherService`.
  6. Set status to `completed`.
- **`regenerateCharacter(projectId, characterId, promptOverride?)`**: Re-run ComfyUI I2I for a specific character portrait.

### D. FFmpeg Video Stitcher (`backend/src/services/videoStitcher.ts`)
- Resolve local file paths or download temporary clips.
- Generate an FFmpeg `concat` file listing clips in scene order.
- Execute FFmpeg concat:
  ```bash
  ffmpeg -f concat -safe 0 -i clips.txt -c:v copy -c:a copy output_final.mp4
  ```
- With automatic fallback to re-encode normalization (`-vf scale=... -r ...`) if clip codecs/dimensions vary.

### E. REST API Endpoints (`backend/src/routes/videoProjects.ts`)
- `POST /api/video-projects` — Create project & start Phase 1 (Drafting).
- `GET  /api/video-projects` — List user video projects (with status/pagination).
- `GET  /api/video-projects/:id` — Get complete project state, story, characters, and scenes.
- `POST /api/video-projects/:id/approve` — Approve checkpoint and start Phase 3 video generation.
- `POST /api/video-projects/:id/regenerate-character/:charId` — Re-render a single character portrait.
- `POST /api/video-projects/:id/cancel` — Interrupt ComfyUI and mark project cancelled.

---

## 4. Frontend Architecture: ScriptFrame Client (`scriptframe-client/`)

A dedicated Angular application optimized for non-technical users:

1. **New Video Creation View**:
   - Topic input (prompt textarea).
   - Target Total Duration slider (e.g. 15s – 180s).
   - Max Clip Length slider (e.g. 3s – 10s).
   - Workflow Preset dropdown (fetched from configured Studio workflows).
2. **Review & Approval Checkpoint View**:
   - Story synopsis and character overview.
   - Character Carousel / Cards with I2I rendered portraits.
   - Inline text editing for story/character descriptions.
   - "Regenerate Image" button per character.
   - "Approve & Generate Full Video" primary action.
3. **Live Rendering Dashboard**:
   - Stepper: `Story & Characters` ➔ `Approval` ➔ `Generating Scenes (X/N)` ➔ `Stitching`.
   - Visual grid of scenes with progress indicators and thumbnail preview once rendered.
4. **Final Presentation & Export**:
   - Video player with embedded audio support.
   - One-click MP4 download.
   - Breakdown of individual scene assets.

---

## 5. Phased Implementation Roadmap

| Phase | Milestone | Key Deliverables |
| :--- | :--- | :--- |
| **Phase 1** | **LLM Engine & Database Schema** | • `LLMProviderService.completeJson()` implementation<br>• `video_projects` table & Drizzle migrations<br>• Zod schemas for Story, Character, and Scene JSON outputs |
| **Phase 2** | **ComfyUI I2I & Video Integration** | • ComfyUI I2I face-consistency execution integration<br>• Sequential video+audio generation loop with polling<br>• FFmpeg concat stitcher service |
| **Phase 3** | **Orchestrator & Backend Routes** | • `VideoOrchestratorService` state machine<br>• `/api/video-projects` REST endpoints (create, approve, regenerate, cancel)<br>• Error handling & job recovery |
| **Phase 4** | **ScriptFrame Client Frontend** | • Scaffold `scriptframe-client` Angular application<br>• Project Creation Form + Preset Selector<br>• Approval Checkpoint UI (Story + Character cards)<br>• Live scene progress dashboard + Video player |
| **Phase 5** | **E2E Testing & Polish** | • Full pipeline test: Topic ➔ Story ➔ I2I Faces ➔ Approval ➔ Video Clips ➔ Stitched MP4<br>• Resiliency against ComfyUI timeout / LLM JSON malformations |

