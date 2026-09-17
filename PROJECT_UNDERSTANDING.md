# ScriptFrame — Project Understanding Document

## 1. Overview

**ScriptFrame** is a web application for authoring and managing **AI workflow pipelines**. It provides a visual node-graph editor connecting **LLM applications** (configured AI models via popular providers/runtimes) and **ComfyUI applications** (parameterized entry points extracted from ComfyUI workflows) into reusable, executable "ScriptFrame workflows".

### Three Core User Journeys

1. **LLM App Config (`/llm-app-config`)**
   - Select an LLM provider (Anthropic, OpenAI, Gemini, OpenCode, OmniRoute, LM Studio, Ollama).
   - Enter base endpoint and API key, and dynamically discover available models via `/api/llm-providers/fetch-models`.
   - Tune inference parameters (temperature, max tokens, system prompt) and save as an **LLM App** (`llm_apps`).

2. **Create ComfyUI App (`/workflow-inputs`)**
   - Browse saved ComfyUI workflows or workflow execution history.
   - Inspect graph inputs/widgets, configure label/type/validation constraints, and designate primary exposed fields.
   - Save directly as a self-contained **ComfyUI App** (`comfyui_apps`), embedding the workflow definition.
   - *Note*: This is the dedicated creation path; the app list page (`/comfyui-apps`) is strictly for listing, inspecting, executing, and deleting existing ComfyUI Apps.

3. **ComfyUI Stack Config (`/comfyui-stacks`)**
   - Group multiple ComfyUI Apps into a named **stack** (ordered sequence) that a Worker node can drive end-to-end.
   - Optionally bind a stack to a specific ComfyUI instance (`baseUrl` + `port`) or fall back to the global ComfyUI service.

4. **Workflow Editor (`/workflow`, `/workflow/:id`)**
   - Visual graph canvas powered by `@comfyorg/litegraph`.
   - Assemble **Worker** (LLM port + ComfyUI stack port, with per-port app bindings), **LLM Node** (standalone text processing), and **ComfyUI Stack Node** (standalone stack execution) nodes.
   - Wire input/output ports together, test live backend connectivity to underlying providers, and persist workflows to the SQLite database.
   - A **global NSFW flag** on the ScriptFrame workflow marks the entire pipeline as uncensored; per-Worker-node `nsfw` controls moderation for its ComfyUI stack port.

---

## 2. Architecture & Tech Stack

| Layer | Tech Stack | Port / Path | Purpose / Characteristics |
|---|---|---|---|
| **Scriptframe Studio** | Angular 21 (standalone components, Signals, zoneless change detection) | `4200` (dev) | Single Page Application with persistent `<app-app-menu />` navigation and dark theme. |
| **Graph Canvas** | `@comfyorg/litegraph` (^0.17.2) | — | Official ComfyUI LiteGraph fork; custom `RenderShape.BOX` styling, drag-to-connect ports, and ComfyUI-style double-click search palette. |
| **Backend API** | Node.js + Express 5 + TypeScript (`tsx`) | `3000` | REST API mounted at `/api` with CORS headers and centralized Zod request validation. |
| **Database** | SQLite via `better-sqlite3` + Drizzle ORM | `backend/data/video-generator.db` | WAL-mode SQLite database with schema migrations for embedded definitions and decoupled foreign keys. |
| **LLM Runtimes** | Axios client cache + custom header handling | Configurable base URLs | Integrates with cloud APIs (Anthropic, OpenAI, Gemini) and local inference runtimes (LM Studio, Ollama, OpenCode, OmniRoute). |
| **ComfyUI** | ComfyUI HTTP API integration | Default: `http://localhost:8188` | Interacts with `/prompt`, `/history`, `/queue`, `/system_stats`, `/object_info`, `/view`, and reads user workflows. |

---

## 3. Frontend Architecture (`client/src/`)

### Routing Configuration (`app.routes.ts`)

| Route | Nav / Menu Label | Component | Purpose |
|---|---|---|---|
| `/` | — | Redirects to `/workflow` | Default redirect to the editor canvas |
| `/workflow` | **Workflow Editor** | `WorkflowEditorComponent` | Visual graph editor (new workflow) |
| `/workflow/:id` | — | `WorkflowEditorComponent` | Load and edit existing ScriptFrame workflow by UUID |
| `/comfyui-apps` | **ComfyUI Apps** | `WorkflowInputSelectorComponent` | Manage, test execute, inspect primary fields, and delete apps (Create + Manage tabs) |
| `/workflow-inputs` | **Create ComfyUI App** | `WorkflowInputSelectorComponent` | Scan ComfyUI workflows, configure primary fields, and save app |
| `/llm-app-config` | **LLM Apps** | `LLMAppConfigComponent` | Configure LLM providers, fetch models, and create, edit, activate/deactivate, and delete LLM apps (Create + Manage tabs) |
| `/comfyui-stacks` | **ComfyUI Stacks** | `ComfyUIStackListComponent` | Create, list, and test ComfyUI stacks |

### Workflow Editor & Canvas (`workflow-editor.litgraph.ts` & `workflow-editor.ts`)

- **Lifecycle & Binding**: Canvas lifecycle is owned by `WorkflowEditorLiteGraphService`, which manages the `LGraph` and `LGraphCanvas` instances.
- **Visual Design**: Uses `RenderShape.BOX` nodes with solid title bars colored by node type:
  - `worker` (#f59e0b - amber)
  - `llm` (#8b5cf6 - purple)
  - `comfyui` (#06b6d4 - cyan)
- **Bidirectional Synchronization**:
  - Converts `ScriptFrameNode[]` and `ScriptFrameLink[]` models into LiteGraph node and link graphs.
  - Syncs node positions, link connections, and port mappings back to Angular signals on canvas change events.
  - Double-click triggers an inline searchable node palette allowing quick insertion at canvas coordinates.
- **Node Deletion**: No protected nodes (Start/End removed); all node types are deletable via the property panel Delete button.
- **Palette Entries** (double-click search box):
  - **Worker Node** – combines an LLM port (app + optional system prompt) and a ComfyUI stack port (stack selector + NSFW toggle).
  - **LLM Node** – standalone LLM App binding with prompt template.
  - **ComfyUI Stack Node** – standalone ComfyUI stack selector.
- **Property Panel** (right sidebar):
  - **Worker**: LLM App selector → system prompt textarea (appears when app selected); ComfyUI Stack selector; NSFW checkbox.
  - **LLM**: LLM App selector + prompt template textarea.
  - **ComfyUI Stack**: Stack selector.
  - Global NSFW toggle in toolbar.

---

## 4. Backend Architecture (`backend/src/`)

### Database Schema (`db/schema.ts`)

Key tables:

- **`llm_providers`**: Provider definitions (name, baseUrl, apiKey, config).
- **`llm_apps`**: Specific LLM instances referencing `providerId`, configured model name, temperature, max tokens, and system prompts.
- **`comfyui_apps`**: Self-contained ComfyUI workflow applications with embedded `definition`, primary field config, and defaults.
- **`comfyui_stacks`**: Named collections of ComfyUI apps (`baseUrl`, `port`, `isActive`).
- **`comfyui_stack_apps`**: Join table linking stacks to apps in execution order (`stackId`, `appId`, `position`).
- **`scriptframe_workflows`**: Graph workflow definitions storing serialized `nodes` and `links`, plus global `nsfw` boolean flag.
- **`users`**: Authentication + authorization accounts (lower-cased unique `email`, unique `username`, bcrypt `password_hash`, `role` (`admin`|`user`), `is_active`, `last_login_at`).
- **`projects`**: User-owned containers that will scope generation jobs (`user_id` FK → `users` with `ON DELETE CASCADE`, `name`, `description`). Ownership is enforced per-request against the JWT subject — a user only ever sees and modifies their own projects (foreign ids answer 404 so existence never leaks).

### Authentication & Authorization (`services/auth.ts`, `middleware/auth.ts`)

- **Mechanism**: JWT (HS256) bearer tokens. `POST /api/auth/register`, `POST /api/auth/login`, and immutable artifact media (`GET /api/artifact/:name`) are public; the remaining `/api/*` endpoints are behind the global `router.use(authenticate)` gate. The app-root `/artifact/:name` mirror is also public so returned media URLs work directly in browsers/media players; app-root `/health` stays public as a liveness probe.
- **Password storage**: bcrypt (cost from `BCRYPT_ROUNDS`, default 10). Policy: 8–128 chars with at least one letter and one digit. Hashes never leave the service layer (`SafeUser`).
- **Roles**: `admin` manages users (`POST|GET|DELETE /api/users`, assign `role`/`isActive`/`email`); `user` may only read/update their own profile (`GET|PATCH /api/users/:id`). Self-service password changes require `currentPassword`; admins reset passwords directly. Admins cannot demote/deactivate/delete their own account (self-lockout guards).
- **Bootstrap**: on an empty `users` table, the **first registrant becomes `admin`**; alternatively seed one at startup via `ADMIN_EMAIL`/`ADMIN_USERNAME`/`ADMIN_PASSWORD` (see `initDb()` in `db/index.ts`).
- **Config** (`config.auth`): `JWT_SECRET` (required in production — server fail-fasts without it; dev fallback otherwise), `JWT_EXPIRES_IN` (`30m`|`12h`|`7d`|seconds, default `24h`), `BCRYPT_ROUNDS`.
- **Stateless trade-off**: role changes/deactivations take effect when the token expires (up to `JWT_EXPIRES_IN`); `GET /api/auth/me` always reflects the fresh DB row.

### Routing Architecture (`backend/src/routes/`)

```
/api
├── /auth                           -> PUBLIC: JWT acquisition (mounted before the auth gate)
│   ├── POST /register              -> Create account (first account on empty table becomes admin)
│   ├── POST /login                 -> { identifier (email|username) | email | username, password } -> { user, token }
│   └── GET  /me                    -> Current principal (authenticated)
├── /users                          -> ALL routes require auth; create/list/delete are admin-only
│   ├── POST /                      -> Create user (admin)
│   ├── GET  /                      -> List users (admin; ?search&role&isActive&limit&offset)
│   ├── GET|PATCH /:id              -> Self-or-admin detail/update (email/role/isActive are admin-only)
│   └── DELETE /:id                 -> Delete user (admin; not self)
├── /projects                       -> Project CRUD, strictly owner-scoped (JWT subject)
│   ├── POST /                      -> Create project owned by the caller
│   ├── GET  /                      -> List OWN projects (?search&limit&offset) — generation jobs will live under these
│   └── GET|PATCH|DELETE /:id       -> Owner-only detail/update/delete (foreign ids -> 404)
├── /llm-providers                  -> EVERYTHING BELOW REQUIRES `Authorization: Bearer <token>`
│   ├── GET  /configs               -> Built-in provider templates & defaults
│   ├── POST /fetch-models          -> Model discovery from active provider endpoint
│   ├── GET|POST /apps              -> LLM App list & creation (registered before /:id)
│   ├── GET|PATCH|DELETE /apps/:id  -> LLM App detail/update/delete
│   ├── GET|POST /                  -> LLM Provider CRUD
│   └── GET|PATCH|DELETE /:id       -> LLM Provider detail
├── /comfyui-apps
│   ├── GET|POST /                  -> ComfyUI App list & creation
│   ├── GET|PATCH|DELETE /:id       -> ComfyUI App detail/update/delete
│   ├── GET  /:id/inputs            -> Exposed & internal workflow inputs
│   └── POST /:id/execute           -> Validate primary values & dispatch prompt to ComfyUI
├── /comfyui-stacks
│   ├── GET|POST /                  -> ComfyUI Stack list & creation
│   ├── GET|PATCH|DELETE /:id       -> ComfyUI Stack detail/update/delete
│   └── GET  /:id/test              -> Stack connectivity test (reuses global ComfyUI health)
├── /scriptframe-workflows
│   ├── POST /test-connection       -> Single node target connectivity test (registered before /:id)
│   ├── POST /test-connections      -> Batch node connectivity test
│   ├── GET|POST /                  -> ScriptFrame workflow list & creation
│   └── GET|PATCH|DELETE /:id       -> ScriptFrame workflow detail/update/delete
├── /workflows                      -> ComfyUI file system workflows & prompt history
├── /services                       -> Direct Omniroute and ComfyUI utility endpoints
├── /jobs                           -> Async generation job control
├── /health                         -> Service health checks (records history; 503 when unhealthy)
│   └── GET  /connection            -> Live LLM (Omniroute) + ComfyUI reachability probe (always 200, no DB writes)
└── (see /auth and /users at the top for token acquisition and user management)
```

Global middleware order (`routes/index.ts`): `/auth` (public) → `authenticate` (JWT gate for every subsequent mount) → feature routers.

---

## 5. Critical Technical Nuances & Provider Behaviors

1. **Express Route Precedence**:
   - In both `llmProviders.ts` and `scriptframeWorkflows.ts`, static subpaths (`/apps`, `/configs`, `/fetch-models`, `/test-connection`, `/test-connections`) are registered strictly **before** parameterized `/:id` routes to prevent route collisions.

2. **LLM Provider Resolution (`resolveProviderId`)**:
   - `createApp` in `llmProvider.ts` supports both direct saved provider UUIDs and built-in provider names (e.g., `"anthropic"`, `"ollama"`).
   - If a provider name is passed, the service looks up an existing provider row or auto-inserts a default provider row with the supplied endpoint and API key to maintain foreign key integrity.

3. **API Key Normalization & Bearer Handling**:
   - Incoming API keys are trimmed and stripped of leading `Bearer ` prefixes (`key.replace(/^Bearer\s+/i, '')`) to prevent duplicated `Bearer Bearer ...` authorization headers.
   - For all providers (including local runtimes like LM Studio/Ollama), `Authorization: Bearer <key>` is attached whenever an API key is present.
   - Google Gemini uses the `x-goog-api-key` header.

4. **Client Instance Caching & Security**:
   - Axios client instances in `LLMProviderService` are cached by key `${provider}:${baseUrl}:${normalizedKey}`. Changing a key creates a new instance rather than reusing stale credentials.
   - Full request and response logging masks secrets in headers and logs (e.g., `sk-ant...ab12`).

5. **Decoupled ComfyUI Apps**:
   - `comfyui_apps` includes an embedded `definition` column and dropped foreign key constraint against `workflows(id)`. This allows ComfyUI apps created directly from ComfyUI history or local disk workflows to execute independently without requiring an explicit row in the `workflows` table.

6. **ComfyUI Stacks**:
   - A **stack** is a named, ordered list of ComfyUI Apps. It can optionally target a specific ComfyUI instance (via `baseUrl` + `port`). The stack's health check delegates to the global `comfyuiService.healthCheck()` — per-instance targeting is a future enhancement.

7. **NSFW Flag**:
   - `scriptframe_workflows.nsfw` (global) and `ScriptFrameNodeData.nsfw` (per Worker node) allow end-users to mark content as uncensored. This metadata can be passed to ComfyUI workflows that support moderation toggles.

---

The system architecture, data models, routes, and component relationships are verified and ready for continued development.
