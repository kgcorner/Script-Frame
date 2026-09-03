// Client-side models mirror the backend TypeScript contracts (backend/src/types/*).
// They are intentionally kept in sync with VIDEO_GENERATION_PROCESS.md §6.

export type JobStatus =
  | 'PENDING'
  | 'STORY_GENERATING'
  | 'WAITING_REVIEW'
  | 'CLIP_PLANNING'
  | 'GENERATING_CLIPS'
  | 'STITCHING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type StoryStage = 'STORY' | 'PORTRAITS' | 'CLIP_PLANNING' | 'CLIPS' | 'STITCHING';

export interface CharacterProfile {
  name: string;
  role?: string;
  description: string;
  imageAppId?: string;
  imagePrompt?: string;
  imageNegativePrompt?: string;
  imagePrimaryValues?: Record<string, unknown>;
  portraitStatus?: 'PENDING' | 'SUBMITTED' | 'COMPLETED' | 'FAILED';
  portraitPromptId?: string;
  portraitPath?: string;
  portraitError?: string;
}

export interface StoryResult {
  title: string;
  logline: string;
  story: string;
  characters: CharacterProfile[];
}

export interface ScriptFrameWorkflow {
  id: string;
  name: string;
  description?: string | null;
  nsfw?: boolean;
  maxClipLength?: number | null;
  maxTimeout?: number | null;
  createdAt: Date | number;
  updatedAt: Date | number;
}

export interface InitiateRunRequest {
  workflowId: string;
  theme: string;
  targetDurationSeconds?: number;
}

// Review checkpoint payload (GET /api/video-runs/:id/review)
export interface RunReviewPayload {
  status: JobStatus;
  story: string;
  characters: CharacterProfile[];
  revision: number;
}

// Story object stored on the job (edit-story PATCH stores an object).
export interface StoryObject {
  title?: string;
  logline?: string;
  story?: string;
}

// Edit request for the review loop (PATCH /api/video-runs/:id/edit-story)
export interface StoryEditRequest {
  story?: string;
  title?: string;
  logline?: string;
}

export interface RequestChangeRequest {
  request: string;
}
