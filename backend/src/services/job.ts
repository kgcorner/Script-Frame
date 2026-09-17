import { db, schema } from '../db/index.js';
import { eq, desc, and, isNull, or } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import type { Job, NewJob, Asset, NewAsset, VideoGenerationJobInput, VideoGenerationJobOutput, JobProgressUpdate, ComfyUIWorkflow, GeneratorArtifact } from '../types/index.js';
import { omnirouteService } from './omniroute.js';
import { comfyuiService } from './comfyui.js';
import { config } from '../config/index.js';

export class JobService {
  async createJob(input: VideoGenerationJobInput, userId?: string): Promise<Job> {
    const jobId = uuidv4();
    const newJob: NewJob = {
      id: jobId,
      type: 'video',
      status: 'pending',
      input: input as unknown as Record<string, unknown>,
      priority: 0,
      userId: userId ?? null,
    };

    await db.insert(schema.jobs).values(newJob);
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    return job!;
  }

  // Generic job creation for the generator endpoints (T2I/T2V/I2V) and export jobs.
  // Unlike createJob this is not video-pipeline specific: the caller supplies the job
  // type, status and the ComfyUI prompt id returned by /prompt. `id` lets the caller
  // pre-generate the id so it can also be used as the ComfyUI client_id for
  // correlation. `userId`/`projectId` anchor the ownership model: every NEW job must
  // carry the creator's id (status queries authorize against it).
  async createGenerationJob(params: {
    type: Job['type'];
    input: Record<string, unknown>;
    id?: string;
    status?: Job['status'];
    comfyuiPromptId?: string | null;
    userId?: string | null;
    projectId?: string | null;
  }): Promise<Job> {
    const jobId = params.id ?? uuidv4();
    const status = params.status ?? 'pending';
    const newJob: NewJob = {
      id: jobId,
      type: params.type,
      status,
      input: params.input,
      priority: 0,
      comfyuiPromptId: params.comfyuiPromptId ?? null,
      userId: params.userId ?? null,
      projectId: params.projectId ?? null,
      ...(status === 'processing' ? { startedAt: new Date() } : {}),
    };

    await db.insert(schema.jobs).values(newJob);
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    return job!;
  }

  /**
   * Persist the artifact fetched for a generator job and mark it completed in a single
   * update. Written as one statement because updateJobStatus() replaces `output` with
   * `{ message }` whenever a message is supplied, which would wipe the artifact.
   */
  async setJobArtifact(jobId: string, artifact: GeneratorArtifact): Promise<Job | null> {
    await db
      .update(schema.jobs)
      .set({
        output: { artifact } as unknown as Record<string, unknown>,
        status: 'completed',
        progress: 100,
        error: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.jobs.id, jobId));
    return this.getJob(jobId);
  }

  async getJob(jobId: string): Promise<Job | null> {
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    return job ?? null;
  }

  async getJobs(filters?: {
    status?: Job['status'];
    limit?: number;
    offset?: number;
    // Owner scoping: when set, only jobs created by this user are returned.
    userId?: string;
    // Project scoping: when set, only jobs belonging to this project are returned.
    projectId?: string;
    // Admin list scope: also include legacy rows (user_id NULL, created before
    // user scoping) so old data is not orphaned.
    includeUnowned?: boolean;
  }): Promise<Job[]> {
    const conditions = [];
    if (filters?.status) {
      conditions.push(eq(schema.jobs.status, filters.status));
    }
    if (filters?.projectId) {
      conditions.push(eq(schema.jobs.projectId, filters.projectId));
    }
    if (filters?.userId) {
      conditions.push(
        filters.includeUnowned
          ? or(eq(schema.jobs.userId, filters.userId), isNull(schema.jobs.userId))
          : eq(schema.jobs.userId, filters.userId)
      );
    }

    const query = db.select().from(schema.jobs);
    if (conditions.length > 0) {
      query.where(and(...conditions));
    }
    query.orderBy(desc(schema.jobs.createdAt));
    if (filters?.limit) {
      query.limit(filters.limit);
    }
    if (filters?.offset) {
      query.offset(filters.offset);
    }

    return query;
  }

  async updateJobStatus(jobId: string, update: JobProgressUpdate): Promise<Job | null> {
    const updateData: Partial<Job> = {
      status: update.status,
      progress: update.progress,
      updatedAt: new Date(),
    };

    if (update.status === 'processing' && !updateData.startedAt) {
      updateData.startedAt = new Date();
    }
    if (update.status === 'completed' || update.status === 'failed') {
      updateData.completedAt = new Date();
    }
    if (update.error) {
      updateData.error = update.error;
    }
    if (update.message) {
      updateData.output = { message: update.message };
    }

    await db.update(schema.jobs).set(updateData).where(eq(schema.jobs.id, jobId));
    return this.getJob(jobId);
  }

  async setJobOutput(jobId: string, output: VideoGenerationJobOutput): Promise<Job | null> {
    await db.update(schema.jobs).set({ output: output as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(schema.jobs.id, jobId));
    return this.getJob(jobId);
  }

  async addAsset(asset: Omit<NewAsset, 'id' | 'createdAt'>): Promise<Asset> {
    const assetId = uuidv4();
    const newAsset: NewAsset = {
      ...asset,
      id: assetId,
    };
    await db.insert(schema.assets).values(newAsset);
    const [created] = await db.select().from(schema.assets).where(eq(schema.assets.id, assetId));
    return created!;
  }

  async getAssetsByJob(jobId: string): Promise<Asset[]> {
    return db.select().from(schema.assets).where(eq(schema.assets.jobId, jobId));
  }

  async processVideoGeneration(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    const input = job.input as VideoGenerationJobInput;

    try {
      await this.updateJobStatus(jobId, { jobId, progress: 10, status: 'processing', message: 'Starting video generation' });

      let workflow: Record<string, unknown>;
      if (input.workflowId) {
        const [wf] = await db.select().from(schema.workflows).where(eq(schema.workflows.id, input.workflowId));
        if (wf) {
          workflow = wf.definition as Record<string, unknown>;
        } else {
          throw new Error(`Workflow ${input.workflowId} not found`);
        }
      } else {
        workflow = this.buildDefaultWorkflow(input);
      }

      await this.updateJobStatus(jobId, { jobId, progress: 30, status: 'processing', message: 'Submitting to ComfyUI' });
      const promptResponse = await comfyuiService.queuePrompt(workflow as ComfyUIWorkflow, jobId);

      await this.updateJobStatus(jobId, { jobId, progress: 50, status: 'processing', message: 'Waiting for ComfyUI to complete' });

      let completed = false;
      let attempts = 0;
      const maxAttempts = 120;

      while (!completed && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        attempts++;

        const history = await comfyuiService.getHistory(promptResponse.prompt_id);
        const promptHistory = history[promptResponse.prompt_id];

        if (promptHistory) {
          if (promptHistory.status.completed) {
            completed = true;
            const outputs = promptHistory.outputs;
            
            const videoOutput = Object.values(outputs).find((o: unknown) => {
              const obj = o as { videos?: Array<{ filename: string; subfolder: string }> };
              return obj.videos && obj.videos.length > 0;
            });
            if (videoOutput) {
              const videoObj = videoOutput as { videos: Array<{ filename: string; subfolder: string }> };
              const video = videoObj.videos[0];
              const videoUrl = `${config.comfyui.baseUrl}/view?filename=${video.filename}&subfolder=${video.subfolder}&type=output`;
              
              const outputData: VideoGenerationJobOutput = {
                videoUrl,
                duration: input.duration,
                resolution: input.resolution,
                fps: input.fps,
                metadata: { promptId: promptResponse.prompt_id },
              };

              await this.setJobOutput(jobId, outputData);
              await this.addAsset({
                jobId,
                type: 'video',
                path: video.filename,
                url: videoUrl,
                mimeType: 'video/mp4',
                metadata: { promptId: promptResponse.prompt_id },
              });

              await this.updateJobStatus(jobId, { jobId, progress: 100, status: 'completed', message: 'Video generation completed' });
            } else {
              throw new Error('No video output found in ComfyUI response');
            }
          } else if (promptHistory.status.messages.some(([type]) => type === 'execution_error')) {
            throw new Error('ComfyUI execution failed');
          }
        }

        const progress = Math.min(50 + (attempts / maxAttempts) * 40, 90);
        await this.updateJobStatus(jobId, { jobId, progress, status: 'processing', message: `Processing... (${attempts * 5}s elapsed)` });
      }

      if (!completed) {
        throw new Error('Video generation timed out');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.updateJobStatus(jobId, { jobId, progress: 0, status: 'failed', error: errorMessage });
      throw error;
    }
  }

  private buildDefaultWorkflow(input: VideoGenerationJobInput): Record<string, unknown> {
    return {
      '1': {
        class_type: 'LoadVideoModel',
        inputs: {
          model_name: input.model || 'stable-video-diffusion',
        },
      },
      '2': {
        class_type: 'VideoGenerate',
        inputs: {
          prompt: input.prompt,
          duration: input.duration || 4,
          fps: input.fps || 8,
          resolution: input.resolution || '1024x576',
          model: { '1': 'model' },
        },
      },
      '3': {
        class_type: 'SaveVideo',
        inputs: {
          video: { '2': 'video' },
          filename_prefix: 'generated',
        },
      },
    };
  }

  async cancelJob(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    if (job.status === 'processing') {
      await comfyuiService.interrupt();
    }

    await this.updateJobStatus(jobId, { jobId, progress: 0, status: 'cancelled', message: 'Job cancelled by user' });
  }

  // Deletes only the job row. Artifacts on disk are intentionally kept forever and
  // stay served by GET /artifact/:name, so this never removes generated media.
  async deleteJob(jobId: string): Promise<void> {
    await db.delete(schema.jobs).where(eq(schema.jobs.id, jobId));
  }
}

export const jobService = new JobService();
