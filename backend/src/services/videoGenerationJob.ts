// Video Generation job store — CRUD for story_generation_jobs and
// video_generation_jobs (VIDEO_GENERATION_PROCESS.md §5).
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type {
  NewStoryGenerationJob,
  NewVideoGenerationJob,
  StoryGenerationJob,
  VideoGenerationJob,
} from '../db/index.js';
import type { StoryJobStatus, VideoJobStatus } from '../types/videoGeneration.js';

const STORY_TERMINAL: StoryJobStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];
const VIDEO_TERMINAL: VideoJobStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

export class VideoGenerationJobService {
  // ---------------- Story jobs ----------------

  async createStoryJob(input: NewStoryGenerationJob): Promise<StoryGenerationJob> {
    const [row] = await db.insert(schema.storyGenerationJobs).values(input).returning();
    return row;
  }

  async getStoryJob(id: string): Promise<StoryGenerationJob | null> {
    const [row] = await db.select().from(schema.storyGenerationJobs).where(eq(schema.storyGenerationJobs.id, id));
    return row ?? null;
  }

  async listStoryJobs(filters?: { status?: StoryJobStatus; workflowId?: string; limit?: number; offset?: number }): Promise<StoryGenerationJob[]> {
    const conditions = [];
    if (filters?.status) conditions.push(eq(schema.storyGenerationJobs.status, filters.status));
    if (filters?.workflowId) conditions.push(eq(schema.storyGenerationJobs.workflowId, filters.workflowId));
    const query = db.select().from(schema.storyGenerationJobs);
    const rows = conditions.length
      ? await query.where(and(...conditions)).orderBy(asc(schema.storyGenerationJobs.createdAt)).limit(filters?.limit ?? 50).offset(filters?.offset ?? 0)
      : await query.orderBy(asc(schema.storyGenerationJobs.createdAt)).limit(filters?.limit ?? 50).offset(filters?.offset ?? 0);
    return rows;
  }

  async updateStoryJob(id: string, updates: Partial<NewStoryGenerationJob>): Promise<StoryGenerationJob | null> {
    const updateData: Partial<NewStoryGenerationJob> = { ...updates, updatedAt: new Date() };
    await db.update(schema.storyGenerationJobs).set(updateData).where(eq(schema.storyGenerationJobs.id, id));
    return this.getStoryJob(id);
  }

  async setStoryStatus(id: string, status: StoryJobStatus, extra?: Partial<NewStoryGenerationJob>): Promise<StoryGenerationJob | null> {
    return this.updateStoryJob(id, { status, ...extra });
  }

  /** Non-terminal story jobs — used by crash recovery on backend start. */
  async getActiveStoryJobs(): Promise<StoryGenerationJob[]> {
    return db
      .select()
      .from(schema.storyGenerationJobs)
      .where(notInArray(schema.storyGenerationJobs.status, STORY_TERMINAL))
      .orderBy(asc(schema.storyGenerationJobs.createdAt));
  }

  // ---------------- Video jobs ----------------

  async createVideoJobs(inputs: NewVideoGenerationJob[]): Promise<VideoGenerationJob[]> {
    if (inputs.length === 0) return [];
    return db.insert(schema.videoGenerationJobs).values(inputs).returning();
  }

  async getVideoJob(id: string): Promise<VideoGenerationJob | null> {
    const [row] = await db.select().from(schema.videoGenerationJobs).where(eq(schema.videoGenerationJobs.id, id));
    return row ?? null;
  }

  async getVideoJobsByStory(storyJobId: string): Promise<VideoGenerationJob[]> {
    return db
      .select()
      .from(schema.videoGenerationJobs)
      .where(eq(schema.videoGenerationJobs.storyJobId, storyJobId))
      .orderBy(asc(schema.videoGenerationJobs.priority));
  }

  async updateVideoJob(id: string, updates: Partial<NewVideoGenerationJob>): Promise<VideoGenerationJob | null> {
    const updateData: Partial<NewVideoGenerationJob> = { ...updates, updatedAt: new Date() };
    await db.update(schema.videoGenerationJobs).set(updateData).where(eq(schema.videoGenerationJobs.id, id));
    return this.getVideoJob(id);
  }

  async getVideoJobsByStatuses(storyJobId: string, statuses: VideoJobStatus[]): Promise<VideoGenerationJob[]> {
    if (statuses.length === 0) return [];
    return db
      .select()
      .from(schema.videoGenerationJobs)
      .where(and(eq(schema.videoGenerationJobs.storyJobId, storyJobId), inArray(schema.videoGenerationJobs.status, statuses)))
      .orderBy(asc(schema.videoGenerationJobs.priority));
  }

  /**
   * The job the poller must look at next: the lowest-priority job that is not
   * in a terminal state. Enforces the strictly priority-ordered completion walk
   * from the process doc (step 11).
   */
  async getNextPendingVideoJob(storyJobId: string): Promise<VideoGenerationJob | null> {
    const [row] = await db
      .select()
      .from(schema.videoGenerationJobs)
      .where(and(eq(schema.videoGenerationJobs.storyJobId, storyJobId), notInArray(schema.videoGenerationJobs.status, VIDEO_TERMINAL)))
      .orderBy(asc(schema.videoGenerationJobs.priority))
      .limit(1);
    return row ?? null;
  }

  /** Re-number priorities 0..n-1 in the given order of job ids (process doc Q5). */
  async renormalizePriorities(storyJobId: string, orderedIds: string[]): Promise<void> {
    const existing = await this.getVideoJobsByStory(storyJobId);
    const existingIds = new Set(existing.map((j) => j.id));
    if (orderedIds.length !== existing.length || !orderedIds.every((id) => existingIds.has(id))) {
      throw new Error('orderedIds must be a permutation of all clip ids of the story job');
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await this.updateVideoJob(orderedIds[i], { priority: i });
    }
  }

  /** Soft-delete: removed clips become CANCELLED for audit (decision D1). */
  async cancelVideoJob(id: string): Promise<VideoGenerationJob | null> {
    return this.updateVideoJob(id, { status: 'CANCELLED', error: 'Removed from plan by reviewer' });
  }

  /** Manual restart of a failed clip: fresh attempt budget (process doc §7.4). */
  async restartVideoJob(id: string): Promise<VideoGenerationJob | null> {
    return this.updateVideoJob(id, { status: 'PENDING', attempts: 0, error: null, comfyuiPromptId: null, submittedAt: null });
  }
}

export const videoGenerationJobService = new VideoGenerationJobService();

