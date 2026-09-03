import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema.js';
import { config } from '../config/index.js';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { sql } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbDir = dirname(config.db.path);
mkdirSync(dbDir, { recursive: true });

const sqlite = new Database(config.db.path);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

export async function initDb() {
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('video', 'image', 'audio')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')) DEFAULT 'pending',
      input TEXT NOT NULL,
      output TEXT,
      error TEXT,
      progress REAL NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      started_at INTEGER,
      completed_at INTEGER
    )
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
      story_job_id TEXT REFERENCES story_generation_jobs(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('video', 'image', 'audio', 'model', 'workflow')),
      path TEXT NOT NULL,
      url TEXT,
      size INTEGER,
      mime_type TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      definition TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS service_health (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service TEXT NOT NULL CHECK (service IN ('omniroute', 'comfyui')),
      status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'unhealthy')),
      latency INTEGER,
      error TEXT,
      checked_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS comfyui_apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      primary_fields TEXT NOT NULL DEFAULT '[]',
      default_values TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS llm_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      config TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS llm_apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      provider_id TEXT NOT NULL REFERENCES llm_providers(id) ON DELETE CASCADE,
      model TEXT NOT NULL,
      temperature REAL DEFAULT 0.7,
      max_tokens INTEGER DEFAULT 4096,
      system_prompt TEXT,
      config TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS story_generation_jobs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES scriptframe_workflows(id) ON DELETE CASCADE,
      theme TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
        'PENDING', 'STORY_GENERATING', 'WAITING_REVIEW', 'CLIP_PLANNING',
        'GENERATING_CLIPS', 'STITCHING', 'COMPLETED', 'FAILED', 'CANCELLED'
      )),
      story TEXT,
      characters TEXT,
      clip_plan TEXT,
      review_notes TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      target_duration_seconds INTEGER,
      failed_stage TEXT,
      error TEXT,
      final_video_path TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS video_generation_jobs (
      id TEXT PRIMARY KEY,
      story_job_id TEXT NOT NULL REFERENCES story_generation_jobs(id) ON DELETE CASCADE,
      priority INTEGER NOT NULL DEFAULT 0,
      comfyui_app_id TEXT NOT NULL,
      prompt TEXT,
      primary_values TEXT,
      continues_previous INTEGER NOT NULL DEFAULT 0,
      start_frame_path TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
        'PENDING', 'SUBMITTING', 'JOB_SUBMITTED', 'COMPLETED', 'FAILED', 'CANCELLED'
      )),
      comfyui_prompt_id TEXT,
      asset_path TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      submitted_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS scriptframe_workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      nodes TEXT NOT NULL,
      links TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // ComfyUI stacks: a named collection of ComfyUI apps a Worker node drives.
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS comfyui_stacks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      base_url TEXT,
      port INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS comfyui_stack_apps (
      stack_id TEXT NOT NULL REFERENCES comfyui_stacks(id) ON DELETE CASCADE,
      app_id TEXT NOT NULL REFERENCES comfyui_apps(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (stack_id, app_id)
    )
  `);
  // --- Migrations for the video-generation pipeline ---
  // assets.jobId is now nullable (final stitched videos belong to a story job, not a
  // generic job) and assets.storyJobId links the final video to its story run.
  // SQLite can't ALTER a NOT NULL constraint, so rebuild the table when needed.
  // NOTE: this must run BEFORE the CREATE INDEX block below — those indexes reference
  // columns this migration adds (e.g. assets.story_job_id), and on pre-existing
  // databases CREATE TABLE IF NOT EXISTS above leaves the old table shape untouched.
  const assetColumns = db.$client.prepare('PRAGMA table_info(assets)').all() as Array<{ name: string; notnull: number }>;
  const jobIdCol = assetColumns.find((c) => c.name === 'job_id');
  const needsAssetRebuild = !assetColumns.some((c) => c.name === 'story_job_id') || (jobIdCol && jobIdCol.notnull === 1);
  if (needsAssetRebuild) {
    db.$client.exec(`
      BEGIN;
      CREATE TABLE assets_new (
        id TEXT PRIMARY KEY,
        job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
        story_job_id TEXT REFERENCES story_generation_jobs(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('video', 'image', 'audio', 'model', 'workflow')),
        path TEXT NOT NULL,
        url TEXT,
        size INTEGER,
        mime_type TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO assets_new (id, job_id, story_job_id, type, path, url, size, mime_type, metadata, created_at)
        SELECT id, job_id, NULL, type, path, url, size, mime_type, metadata, created_at FROM assets;
      DROP TABLE assets;
      ALTER TABLE assets_new RENAME TO assets;
      CREATE INDEX IF NOT EXISTS idx_assets_job_id ON assets(job_id);
      CREATE INDEX IF NOT EXISTS idx_assets_story_job_id ON assets(story_job_id);
      COMMIT;
    `);
  }

  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_comfyui_stack_apps_stack_id ON comfyui_stack_apps(stack_id)
  `);
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_comfyui_stack_apps_app_id ON comfyui_stack_apps(app_id)
  `);

  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)
  `);
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at)
  `);
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_assets_job_id ON assets(job_id)
  `);
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_service_health_service ON service_health(service)
  `);
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_comfyui_apps_workflow_id ON comfyui_apps(workflow_id)
  `);
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_llm_providers_name ON llm_providers(name)
  `);
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_llm_apps_provider_id ON llm_apps(provider_id)
  `);
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_story_generation_jobs_status ON story_generation_jobs(status)
  `);
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_video_generation_jobs_story ON video_generation_jobs(story_job_id)
  `);
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_video_generation_jobs_priority ON video_generation_jobs(story_job_id, priority)
  `);
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_assets_story_job_id ON assets(story_job_id)
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS story_generation_jobs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES scriptframe_workflows(id) ON DELETE CASCADE,
      theme TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'STORY_GENERATING', 'WAITING_REVIEW', 'CLIP_PLANNING', 'GENERATING_CLIPS', 'STITCHING', 'COMPLETED', 'FAILED', 'CANCELLED')) DEFAULT 'PENDING',
      story TEXT,
      characters TEXT,
      clip_plan TEXT,
      review_notes TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      target_duration_seconds INTEGER,
      failed_stage TEXT,
      error TEXT,
      final_video_path TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS video_generation_jobs (
      id TEXT PRIMARY KEY,
      story_job_id TEXT NOT NULL REFERENCES story_generation_jobs(id) ON DELETE CASCADE,
      priority INTEGER NOT NULL DEFAULT 0,
      comfyui_app_id TEXT NOT NULL,
      prompt TEXT,
      primary_values TEXT,
      continues_previous INTEGER NOT NULL DEFAULT 0,
      start_frame_path TEXT,
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'SUBMITTING', 'JOB_SUBMITTED', 'COMPLETED', 'FAILED', 'CANCELLED')) DEFAULT 'PENDING',
      comfyui_prompt_id TEXT,
      asset_path TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      submitted_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_video_generation_jobs_story_job_id ON video_generation_jobs(story_job_id)
  `);
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_video_generation_jobs_status ON video_generation_jobs(status)
  `);
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_story_generation_jobs_status ON story_generation_jobs(status)
  `);

  // --- Migrations for the workflow-input creation path ---
  // 1) scriptframe_workflows columns: NSFW flag, max clip length and max generation
  //    timeout used by the ScriptFrame video pipeline (see schema.ts).
  const workflowColumns = db.$client.prepare('PRAGMA table_info(scriptframe_workflows)').all() as Array<{ name: string }>;
  if (!workflowColumns.some((c) => c.name === 'nsfw')) {
    await db.run(sql`ALTER TABLE scriptframe_workflows ADD COLUMN nsfw INTEGER NOT NULL DEFAULT 0`);
  }
  if (!workflowColumns.some((c) => c.name === 'max_clip_length')) {
    await db.run(sql`ALTER TABLE scriptframe_workflows ADD COLUMN max_clip_length INTEGER`);
  }
  if (!workflowColumns.some((c) => c.name === 'max_timeout')) {
    await db.run(sql`ALTER TABLE scriptframe_workflows ADD COLUMN max_timeout INTEGER`);
  }

  // 2) comfyui_apps.definition: embedded workflow persisted with the app so apps can be
  //    created from the workflow-input route even when no `workflows` row exists.
  const appColumns = db.$client.prepare('PRAGMA table_info(comfyui_apps)').all() as Array<{ name: string }>;
  if (!appColumns.some((c) => c.name === 'definition')) {
    await db.run(sql`ALTER TABLE comfyui_apps ADD COLUMN definition TEXT`);
  }

  // 3) Drop the `workflow_id` FK reference. Existing databases were created with
  //    `REFERENCES workflows(id) ON DELETE CASCADE`, which rejects workflow-input
  //    creates that pass a ComfyUI workflow name/id that doesn't exist in `workflows`.
  //    SQLite can't DROP/ALTER a constraint, so rebuild the table without the FK.
  const fk = db.$client.prepare('PRAGMA foreign_key_list(comfyui_apps)').all() as Array<{ table: string }>;
  const hasWorkflowFk = fk.some((f) => f.table === 'workflows');
  if (hasWorkflowFk) {
    db.$client.exec(`
      BEGIN;
      CREATE TABLE comfyui_apps_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        workflow_id TEXT NOT NULL,
        definition TEXT,
        primary_fields TEXT NOT NULL DEFAULT '[]',
        default_values TEXT NOT NULL DEFAULT '{}',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO comfyui_apps_new (id, name, description, workflow_id, definition, primary_fields, default_values, is_active, created_at, updated_at)
        SELECT id, name, description, workflow_id, definition, primary_fields, default_values, is_active, created_at, updated_at FROM comfyui_apps;
      DROP TABLE comfyui_apps;
      ALTER TABLE comfyui_apps_new RENAME TO comfyui_apps;
      CREATE INDEX IF NOT EXISTS idx_comfyui_apps_workflow_id ON comfyui_apps(workflow_id);
      COMMIT;
    `);
  }

}


export { schema };

export type { Job, NewJob, Asset, NewAsset, Workflow, NewWorkflow, ServiceHealth, NewServiceHealth, ComfyUIApp, NewComfyUIApp, LLMProvider, NewLLMProvider, LLMApp, NewLLMApp, ScriptFrameWorkflowRecord, NewScriptFrameWorkflowRecord, ComfyUIStack, NewComfyUIStack, ComfyUIStackApp, NewComfyUIStackApp, StoryGenerationJob, NewStoryGenerationJob, VideoGenerationJob, NewVideoGenerationJob } from './schema.js';
