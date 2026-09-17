import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema.js';
import { config } from '../config/index.js';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { hashPassword } from '../services/auth.js';

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
      type TEXT NOT NULL CHECK (type IN ('video', 'image', 'audio', 'export')),
      status TEXT NOT NULL CHECK (status IN ('not_started', 'pending', 'processing', 'completed', 'failed', 'cancelled')) DEFAULT 'pending',
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

  // jobs.comfyui_prompt_id links a generator job (T2I/T2V/I2V) to the ComfyUI prompt
  // fulfilling it. Added via ALTER so pre-existing databases pick the column up.
  const jobColumns = db.$client.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string }>;
  if (!jobColumns.some((c) => c.name === 'comfyui_prompt_id')) {
    await db.run(sql`ALTER TABLE jobs ADD COLUMN comfyui_prompt_id TEXT`);
  }

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

  // Users: authentication + authorization (role-based). Emails are stored lower-cased
  // and the UNIQUE constraints double as lookup indexes.
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // Projects: user-owned containers for generation jobs. Must be created AFTER
  // users (FK); deleting a user cascades to their projects.
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      aspect_ratio TEXT NOT NULL DEFAULT '16:9',
      model_preset TEXT NOT NULL DEFAULT 'default',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'completed')),
      thumbnail_url TEXT,
      scene_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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

  // Projects migration: backfill new columns on pre-existing databases. On a fresh
  // database the CREATE TABLE IF NOT EXISTS above already has the new shape, so this
  // block is a no-op there (PRAGMA table_info will report the new columns). On older
  // databases we rebuild the table and convert the old integer `created_at`/`updated_at`
  // (unixepoch) values to ISO-8601 text to match the current schema.
  const projectColumns = db.$client.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string; notnull: number; pk: number }>;
  const hasAspectRatio = projectColumns.some((c) => c.name === 'aspect_ratio');
  const needsProjectMigration = !hasAspectRatio;
  if (needsProjectMigration) {
    db.$client.exec(`
      BEGIN;
      CREATE TABLE projects_new (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        aspect_ratio TEXT NOT NULL DEFAULT '16:9',
        model_preset TEXT NOT NULL DEFAULT 'default',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'completed')),
        thumbnail_url TEXT,
        scene_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO projects_new (id, user_id, name, description, aspect_ratio, model_preset, status, thumbnail_url, scene_count, created_at, updated_at)
        SELECT id, user_id, name, description, '16:9', 'default', 'active', NULL, 0,
          datetime(created_at, 'unixepoch'),
          datetime(updated_at, 'unixepoch')
        FROM projects;
      DROP TABLE projects;
      ALTER TABLE projects_new RENAME TO projects;
      CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
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
    CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id)
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

  // 4) llm_apps.endpoint / api_key: per-app base URL override so a custom endpoint (or a post-create
    // provider edit) is honoured by fetchModels / testConnection instead of the provider row.
  const appColumns2 = db.$client.prepare('PRAGMA table_info(llm_apps)').all() as Array<{ name: string }>;
  if (!appColumns2.some((c) => c.name === 'endpoint')) {
    await db.run(sql`ALTER TABLE llm_apps ADD COLUMN endpoint TEXT`);
  }
  if (!appColumns2.some((c) => c.name === 'api_key')) {
    await db.run(sql`ALTER TABLE llm_apps ADD COLUMN api_key TEXT`);
  }

  // 5) jobs.type / jobs.status CHECK constraints: video export jobs (services/export.ts)
  //    store type 'export' and status 'not_started'. SQLite can't ALTER a CHECK, so the
  //    table is rebuilt when the existing constraints predate those values. foreign_keys
  //    must be off for the rebuild: dropping the parent `jobs` table would otherwise
  //    cascade-delete every referencing `assets` row.
  const jobsTableSql =
    ((db.$client.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'jobs'").get() ??
      {}) as { sql?: string }).sql ?? '';
  if (jobsTableSql && (!jobsTableSql.includes("'export'") || !jobsTableSql.includes("'not_started'"))) {
    db.$client.pragma('foreign_keys = OFF');
    try {
      db.$client.exec(`
        BEGIN;
        CREATE TABLE jobs_new (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK (type IN ('video', 'image', 'audio', 'export')),
          status TEXT NOT NULL CHECK (status IN ('not_started', 'pending', 'processing', 'completed', 'failed', 'cancelled')) DEFAULT 'pending',
          input TEXT NOT NULL,
          output TEXT,
          error TEXT,
          progress REAL NOT NULL DEFAULT 0,
          priority INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          started_at INTEGER,
          completed_at INTEGER,
          comfyui_prompt_id TEXT
        );
        INSERT INTO jobs_new (id, type, status, input, output, error, progress, priority, created_at, updated_at, started_at, completed_at, comfyui_prompt_id)
          SELECT id, type, status, input, output, error, progress, priority, created_at, updated_at, started_at, completed_at, comfyui_prompt_id FROM jobs;
        DROP TABLE jobs;
        ALTER TABLE jobs_new RENAME TO jobs;
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
        CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
        COMMIT;
      `);
    } finally {
      db.$client.pragma('foreign_keys = ON');
    }
  }

  // --- Migrations for user/project scoping of jobs ---
  // jobs.user_id / jobs.project_id: added after multi-user auth. Must run AFTER the
  // jobs table rebuild above (a rebuild would drop columns added before it). Legacy
  // rows keep user_id NULL -> visible to admins only. A user's jobs die with the
  // user; a job survives its project being deleted (project_id -> NULL).
  const jobScopingColumns = db.$client.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string }>;
  if (!jobScopingColumns.some((c) => c.name === 'user_id')) {
    await db.run(sql`ALTER TABLE jobs ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE`);
  }
  if (!jobScopingColumns.some((c) => c.name === 'project_id')) {
    await db.run(sql`ALTER TABLE jobs ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL`);
  }
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_jobs_project_id ON jobs(project_id)`);

  // --- Auth bootstrap ---
  // Seed the first admin from ADMIN_EMAIL/ADMIN_PASSWORD when the users table is
  // empty, so an instance can be administered without going through public
  // registration. Without these env vars the first public registrant becomes admin.
  const [{ userCount }] = await db
    .select({ userCount: sql<number>`count(*)` })
    .from(schema.users);
  if (userCount === 0 && config.auth.adminEmail && config.auth.adminPassword) {
    await db.insert(schema.users).values({
      id: uuidv4(),
      email: config.auth.adminEmail.trim().toLowerCase(),
      username: config.auth.adminUsername || 'admin',
      passwordHash: await hashPassword(config.auth.adminPassword),
      role: 'admin',
      isActive: true,
    });
    console.log(`Seeded bootstrap admin user: ${config.auth.adminEmail}`);
  }
}


export { schema };

export type { Job, NewJob, Asset, NewAsset, Workflow, NewWorkflow, ServiceHealth, NewServiceHealth, ComfyUIApp, NewComfyUIApp, LLMProvider, NewLLMProvider, LLMApp, NewLLMApp, ScriptFrameWorkflowRecord, NewScriptFrameWorkflowRecord, ComfyUIStack, NewComfyUIStack, ComfyUIStackApp, NewComfyUIStackApp, StoryGenerationJob, NewStoryGenerationJob, VideoGenerationJob, NewVideoGenerationJob, User, NewUser, Project, NewProject } from './schema.js';
