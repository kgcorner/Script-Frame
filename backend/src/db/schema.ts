import { integer, sqliteTable, text, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  type: text('type', { enum: ['video', 'image', 'audio', 'export'] }).notNull(),
  // 'not_started' is used by export jobs between creation and the start of the
  // background stitch (see services/export.ts).
  status: text('status', { enum: ['not_started', 'pending', 'processing', 'completed', 'failed', 'cancelled'] }).notNull().default('pending'),
  input: text('input', { mode: 'json' }).notNull(),
  output: text('output', { mode: 'json' }),
  error: text('error'),
  // ComfyUI prompt id returned by /prompt for generator jobs (T2I/T2V/I2V).
  comfyuiPromptId: text('comfyui_prompt_id'),
  // Ownership + project scoping (multi-user). Set on every job created after auth
  // was introduced; NULL on legacy rows — those are visible to admins only. The
  // FKs (user -> CASCADE, project -> SET NULL) are declared in the raw DDL of
  // initDb() (db/index.ts), which owns all schema changes.
  userId: text('user_id'),
  projectId: text('project_id'),
  progress: real('progress').notNull().default(0),
  priority: integer('priority').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  // Nullable: an asset can belong to either a generic job or a story generation job
  // (e.g. the final stitched video of a ScriptFrame video run).
  jobId: text('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
  storyJobId: text('story_job_id'),
  type: text('type', { enum: ['video', 'image', 'audio', 'model', 'workflow'] }).notNull(),
  path: text('path').notNull(),
  url: text('url'),
  size: integer('size'),
  mimeType: text('mime_type'),
  metadata: text('metadata', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const workflows = sqliteTable('workflows', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  definition: text('definition', { mode: 'json' }).notNull(),
  version: integer('version').notNull().default(1),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const serviceHealth = sqliteTable('service_health', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  service: text('service', { enum: ['omniroute', 'comfyui'] }).notNull(),
  status: text('status', { enum: ['healthy', 'degraded', 'unhealthy'] }).notNull(),
  latency: integer('latency'),
  error: text('error'),
  checkedAt: integer('checked_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// ComfyUI App - simplified workflow interface with primary fields
export const comfyuiApps = sqliteTable('comfyui_apps', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  workflowId: text('workflow_id').notNull(),
  // Optional embedded workflow definition (Task 3: workflow-input creation path).
  // When no `workflows` row exists, the definition is stored here so the app is
  // fully self-contained and executable without a backing `workflows` row.
  definition: text('definition', { mode: 'json' }),
  // JSON configuration for primary fields: which workflow inputs are exposed as primary
  primaryFields: text('primary_fields', { mode: 'json' }).notNull().default('[]'),
  // Default values for non-primary fields (merged with workflow definition)
  defaultValues: text('default_values', { mode: 'json' }).notNull().default('{}'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// LLM Provider configuration
export const llmProviders = sqliteTable('llm_providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(), // Anthropic, OpenAI, Gemini, OpenCode, OmniRoute, LM Studio, Ollama
  displayName: text('display_name').notNull(),
  baseUrl: text('base_url').notNull(),
  apiKey: text('api_key'), // Encrypted in production
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  config: text('config', { mode: 'json' }).notNull().default('{}'), // Additional provider-specific config
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// LLM App - user-configured LLM application
export const llmApps = sqliteTable('llm_apps', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  providerId: text('provider_id').notNull().references(() => llmProviders.id, { onDelete: 'cascade' }),
  model: text('model').notNull(), // Selected model from provider
  temperature: real('temperature').default(0.7),
  maxTokens: integer('max_tokens').default(4096),
  systemPrompt: text('system_prompt'),
  // Per-app endpoint / API-key overrides for the base URL used when fetching models; take precedence over provider.baseUrl (see llmProviderService.fetchModels / testConnection).
  endpoint: text('endpoint'),
  apiKey: text('api_key'),
  config: text('config', { mode: 'json' }).notNull().default('{}'), // Additional model-specific config
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// ScriptFrame Workflows
export const scriptframeWorkflows = sqliteTable('scriptframe_workflows', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  nodes: text('nodes', { mode: 'json' }).notNull(),
  links: text('links', { mode: 'json' }),
  // NSFW flag for the ScriptFrame workflow. When enabled, the worker node may
  // generate uncensored / NSFW content via its ComfyUI stack.
  nsfw: integer('nsfw', { mode: 'boolean' }).notNull().default(false),
  // Maximum clip length for a single generated video (in seconds)
  maxClipLength: integer('max_clip_length'),
  // Maximum timeout for video generation regardless of ComfyUI app (in seconds)
  maxTimeout: integer('max_timeout'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// ComfyUI Stack: a named collection of ComfyUI apps that a Worker node drives.
export const comfyuiStacks = sqliteTable('comfyui_stacks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  // Optional target ComfyUI instance for the stack. When omitted the stack uses
  // the globally configured ComfyUI service (see comfyuiService).
  baseUrl: text('base_url'),
  port: integer('port'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Join table: which ComfyUI apps belong to a stack, in execution order.
export const comfyuiStackApps = sqliteTable('comfyui_stack_apps', {
  stackId: text('stack_id').notNull().references(() => comfyuiStacks.id, { onDelete: 'cascade' }),
  appId: text('app_id').notNull().references(() => comfyuiApps.id, { onDelete: 'cascade' }),
  order: integer('position').notNull().default(0),
});

// Story Generation Job: one user-requested video run driven by a VGWorker.
// Lifecycle: PENDING -> STORY_GENERATING -> WAITING_REVIEW -> CLIP_PLANNING
//   -> GENERATING_CLIPS -> STITCHING -> COMPLETED (or FAILED / CANCELLED).
export const storyGenerationJobs = sqliteTable('story_generation_jobs', {
  id: text('id').primaryKey(),
  // The ScriptFrame workflow preset that binds the LLM app + ComfyUI stack + limits.
  workflowId: text('workflow_id').notNull().references(() => scriptframeWorkflows.id, { onDelete: 'cascade' }),
  theme: text('theme').notNull(),
  status: text('status', {
    enum: ['PENDING', 'STORY_GENERATING', 'WAITING_REVIEW', 'CLIP_PLANNING', 'GENERATING_CLIPS', 'STITCHING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  }).notNull().default('PENDING'),
  // Latest story document produced by the LLM (VIDEO_GENERATION_PROCESS.md §6.1).
  story: text('story', { mode: 'json' }),
  // Character profiles incl. per-character portrait asset paths.
  characters: text('characters', { mode: 'json' }),
  // The approved LLM clip plan (§6.2), kept for auditability.
  clipPlan: text('clip_plan', { mode: 'json' }),
  // Change requests collected during the review loop.
  reviewNotes: text('review_notes', { mode: 'json' }),
  // Revision counter — incremented on every LLM story revision.
  revision: integer('revision').notNull().default(0),
  // Optional user-specified total duration (seconds). When omitted the LLM decides.
  targetDurationSeconds: integer('target_duration_seconds'),
  // Where the stage failed, if it did.
  failedStage: text('failed_stage'),
  error: text('error'),
  finalVideoPath: text('final_video_path'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Video Generation Job: one clip of a story run, executed on a ComfyUI App.
// Lifecycle: PENDING -> SUBMITTING -> JOB_SUBMITTED -> COMPLETED
//   (or FAILED after MAX_JOB_ATTEMPTS / CANCELLED when the clip is removed from the plan).
export const videoGenerationJobs = sqliteTable('video_generation_jobs', {
  id: text('id').primaryKey(),
  storyJobId: text('story_job_id').notNull().references(() => storyGenerationJobs.id, { onDelete: 'cascade' }),
  // 0 = first clip. Contiguous per story job; defines generation order AND stitch order.
  priority: integer('priority').notNull().default(0),
  comfyuiAppId: text('comfyui_app_id').notNull(),
  // Primary values chosen by the LLM for this clip (merged over app defaultValues).
  prompt: text('prompt', { mode: 'json' }),
  primaryValues: text('primary_values', { mode: 'json' }),
  // True when this clip must start from the last frame of the clip at priority - 1.
  continuesPrevious: integer('continues_previous', { mode: 'boolean' }).notNull().default(false),
  // Local path of the extracted start frame used for continuation (informational).
  startFramePath: text('start_frame_path'),
  status: text('status', {
    enum: ['PENDING', 'SUBMITTING', 'JOB_SUBMITTED', 'COMPLETED', 'FAILED', 'CANCELLED'],
  }).notNull().default('PENDING'),
  // ComfyUI prompt id returned by /prompt; used for /history polling.
  comfyuiPromptId: text('comfyui_prompt_id'),
  // Local path of the fetched clip media.
  assetPath: text('asset_path'),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  submittedAt: integer('submitted_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Users: authentication (email/username + bcrypt password hash) and authorization
// (role-based access control; 'admin' manages users, 'user' is the default role).
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  // Emails are stored lower-cased (normalised by the user service before insert).
  email: text('email').notNull().unique(),
  username: text('username').notNull().unique(),
  // bcrypt hash (services/auth.ts hashPassword) — never returned by any endpoint.
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Projects: user-owned containers that scope generation jobs (jobs will reference
// projectId in a later step). Only the owning user may access a project — enforced
// in services/project.ts against the JWT subject (req.user.sub).
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  // Owner. Cascades: deleting a user removes their projects.
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  aspectRatio: text('aspect_ratio').notNull().default('16:9'),
  modelPreset: text('model_preset').notNull().default('default'),
  status: text('status', { enum: ['active', 'draft', 'completed'] }).notNull().default('active'),
  thumbnailUrl: text('thumbnail_url'),
  sceneCount: integer('scene_count', { mode: 'number' }).notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type StoryGenerationJob = typeof storyGenerationJobs.$inferSelect;
export type NewStoryGenerationJob = typeof storyGenerationJobs.$inferInsert;
export type VideoGenerationJob = typeof videoGenerationJobs.$inferSelect;
export type NewVideoGenerationJob = typeof videoGenerationJobs.$inferInsert;

// Terminal status sets used by the video-generation services (stitch gate,
// priority walk). Kept next to the tables so the enums stay in sync.
export const STORY_TERMINAL: Array<'COMPLETED' | 'FAILED' | 'CANCELLED'> = ['COMPLETED', 'FAILED', 'CANCELLED'];
export const VIDEO_TERMINAL: Array<'COMPLETED' | 'FAILED' | 'CANCELLED'> = ['COMPLETED', 'FAILED', 'CANCELLED'];

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
export type Workflow = typeof workflows.$inferSelect;
export type NewWorkflow = typeof workflows.$inferInsert;
export type ServiceHealth = typeof serviceHealth.$inferSelect;
export type NewServiceHealth = typeof serviceHealth.$inferInsert;
export type ComfyUIApp = typeof comfyuiApps.$inferSelect;
export type NewComfyUIApp = typeof comfyuiApps.$inferInsert;
export type LLMProvider = typeof llmProviders.$inferSelect;
export type NewLLMProvider = typeof llmProviders.$inferInsert;
export type LLMApp = typeof llmApps.$inferSelect;
export type NewLLMApp = typeof llmApps.$inferInsert;
export type ScriptFrameWorkflowRecord = typeof scriptframeWorkflows.$inferSelect;
export type NewScriptFrameWorkflowRecord = typeof scriptframeWorkflows.$inferInsert;
export type ComfyUIStack = typeof comfyuiStacks.$inferSelect;
export type NewComfyUIStack = typeof comfyuiStacks.$inferInsert;
export type ComfyUIStackApp = typeof comfyuiStackApps.$inferSelect;
export type NewComfyUIStackApp = typeof comfyuiStackApps.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
