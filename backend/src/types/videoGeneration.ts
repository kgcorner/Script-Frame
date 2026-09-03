// Video Generation (ScriptFrame video runs) — runtime types + LLM JSON contracts.
// Process of record: VIDEO_GENERATION_PROCESS.md (v1.1).
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Status enums (mirror backend/src/db/schema.ts)
// ---------------------------------------------------------------------------
export type StoryJobStatus =
  | 'PENDING'
  | 'STORY_GENERATING'
  | 'WAITING_REVIEW'
  | 'CLIP_PLANNING'
  | 'GENERATING_CLIPS'
  | 'STITCHING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type VideoJobStatus = 'PENDING' | 'SUBMITTING' | 'JOB_SUBMITTED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type StoryStage = 'STORY' | 'PORTRAITS' | 'CLIP_PLANNING' | 'CLIPS' | 'STITCHING';

// ---------------------------------------------------------------------------
// Character profile — persisted JSON on story_generation_jobs.characters
// ---------------------------------------------------------------------------
export interface CharacterProfile {
  name: string;
  role?: string;
  description: string;
  // Portrait render request chosen by the LLM (app catalog §6.0 of the process doc).
  imageAppId?: string;
  imagePrompt?: string;
  imageNegativePrompt?: string;
  imagePrimaryValues?: Record<string, unknown>;
  // Runtime render state (VGWorker-managed).
  portraitStatus?: 'PENDING' | 'SUBMITTED' | 'COMPLETED' | 'FAILED';
  portraitPromptId?: string;
  portraitPath?: string;
  portraitError?: string;
}

// ---------------------------------------------------------------------------
// LLM contract §6.1 — story + characters (+ per-character portrait render plan)
// ---------------------------------------------------------------------------
export const characterPlanSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  description: z.string().min(1),
  imageAppId: z.string().min(1).optional(),
  imagePrompt: z.string().min(1),
  imageNegativePrompt: z.string().optional(),
  imagePrimaryValues: z.record(z.string(), z.unknown()).optional(),
});

export const storyResultSchema = z.object({
  title: z.string().min(1),
  logline: z.string().min(1),
  story: z.string().min(1),
  characters: z.array(characterPlanSchema).default([]),
});

export type StoryResult = z.infer<typeof storyResultSchema>;

// ---------------------------------------------------------------------------
// LLM contract §6.2 — clip plan ("job format" from the process doc)
// ---------------------------------------------------------------------------
export const clipPlanItemSchema = z.object({
  comfyuiAppId: z.string().min(1),
  primaryValues: z.record(z.string(), z.unknown()).default({}),
  durationHintSeconds: z.number().positive().optional(),
  continuesPrevious: z.boolean().default(false),
  summary: z.string().default(''),
});

export const clipPlanSchema = z.object({
  clips: z.array(clipPlanItemSchema).min(1),
});

export type ClipPlanItem = z.infer<typeof clipPlanItemSchema>;
export type ClipPlan = z.infer<typeof clipPlanSchema>;

// ---------------------------------------------------------------------------
// App catalog §6.0 — what VGWorker tells the LLM about each attached ComfyUI App
// ---------------------------------------------------------------------------
export interface AppCatalogEntry {
  id: string;
  name: string;
  description: string;
  kind: 'image' | 'video' | 'unknown';
  primaryFields: Array<{
    key: string; // "nodeId:inputName" — the exact key the LLM must use in primaryValues
    inputName: string;
    label: string;
    aliasName?: string;
    type: string;
    required: boolean;
    options?: string[];
    defaultValue?: unknown;
  }>;
}

// ---------------------------------------------------------------------------
// API payloads
// ---------------------------------------------------------------------------
export interface StoryReviewEdit {
  story?: string;
  title?: string;
  logline?: string;
  characters?: Array<Partial<CharacterProfile> & { name: string }>;
}

export interface ClipUpdate {
  comfyuiAppId?: string;
  primaryValues?: Record<string, unknown>;
  prompt?: Record<string, unknown>;
  continuesPrevious?: boolean;
}
