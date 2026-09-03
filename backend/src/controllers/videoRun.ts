// Controller: ScriptFrame video-run lifecycle (VIDEO_GENERATION_PROCESS.md).
import { Request, Response, NextFunction } from 'express';
import { createReadStream, existsSync, statSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { videoGenerationJobService as jobs } from '../services/videoGenerationJob.js';
import { getWorker } from '../workers/orchestrator.js';

function getIdParam(req: Request): string {
  return Array.isArray(req.params.id) ? req.params.id[0] : (req.params.id as string);
}
function getClipIdParam(req: Request): string {
  const id = req.params.clipId;
  return Array.isArray(id) ? id[0] : (id as string);
}
const initiateSchema = z.object({ workflowId: z.string().min(1), theme: z.string().min(1), targetDurationSeconds: z.number().int().positive().optional() });
const requestChangeSchema = z.object({ request: z.string().min(1) });
const clipUpdateSchema = z.object({ comfyuiAppId: z.string().optional(), primaryValues: z.record(z.string(), z.unknown()).optional(), continuesPrevious: z.boolean().optional() });
const reorderSchema = z.object({ orderedIds: z.array(z.string()).min(1) });
const editStorySchema = z.object({ story: z.string().optional(), title: z.string().optional(), logline: z.string().optional() });

export class VideoRunController {
  // steps 1-3: create PENDING story job + spawn VGWorker (fire-and-forget).
  async initiateVideoRun(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = initiateSchema.parse(req.body);
      const { scriptframeWorkflowService } = await import('../services/scriptframeWorkflow.js');
      const workflow = await scriptframeWorkflowService.getWorkflow(input.workflowId);
      if (!workflow) { res.status(400).json({ success: false, error: `ScriptFrame workflow not found: ${input.workflowId}` }); return; }
      const job = await jobs.createStoryJob({ id: uuidv4(), workflowId: input.workflowId, theme: input.theme, targetDurationSeconds: input.targetDurationSeconds ?? null, status: 'PENDING' });
      const { startWorker } = await import('../workers/orchestrator.js');
      startWorker(job.id).catch((err) => console.error(`[VGWorker ${job.id}] launch failed:`, err));
      res.status(201).json({ success: true, data: job, workerStarted: true });
    } catch (error) { next(error); }
  }

  // Full status + clips for a run view.
  async getVideoRun(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const job = await jobs.getStoryJob(id);
      if (!job) { res.status(404).json({ success: false, error: 'Video run not found' }); return; }
      const clips = await jobs.getVideoJobsByStory(id);
      res.json({ success: true, data: { ...job, clips } });
    } catch (error) { next(error); }
  }

  // Review checkpoint payload: story + characters + revision.
  async getReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const job = await jobs.getStoryJob(id);
      if (!job) { res.status(404).json({ success: false, error: 'Video run not found' }); return; }
      res.json({ success: true, data: { status: job.status, story: job.story, characters: job.characters, revision: job.revision } });
    } catch (error) { next(error); }
  }

  // step 6: approve the story -> unblocks WAITING_REVIEW.
  async approve(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const job = await jobs.getStoryJob(id);
      if (!job) { res.status(404).json({ success: false, error: 'Video run not found' }); return; }
      if (job.status !== 'WAITING_REVIEW') { res.status(409).json({ success: false, error: `Cannot approve a run in status ${job.status}` }); return; }
      const worker = getWorker(id);
      if (worker) worker.approve();
      res.json({ success: true, data: job });
    } catch (error) { next(error); }
  }

  // step 7: request a change; stays WAITING_REVIEW, wakes the review loop.
  async requestChange(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const body = requestChangeSchema.parse(req.body);
      const job = await jobs.getStoryJob(id);
      if (!job) { res.status(404).json({ success: false, error: 'Video run not found' }); return; }
      const worker = getWorker(id);
      if (worker) { worker.requestChange(body.request); }
      else {
        const notes = (job.reviewNotes ?? []) as Array<{ changeRequest?: string }>;
        notes.push({ changeRequest: body.request });
        await jobs.updateStoryJob(id, { reviewNotes: notes });
      }
      res.json({ success: true, data: job });
    } catch (error) { next(error); }
  }

  // Inline story text edit (plain PATCH, no worker needed).
  async editStory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const edit = editStorySchema.parse(req.body);
      const job = await jobs.getStoryJob(id);
      if (!job) { res.status(404).json({ success: false, error: 'Video run not found' }); return; }
      const story = (job.story ?? {}) as Record<string, unknown>;
      if (edit.story !== undefined) story.story = edit.story;
      if (edit.title !== undefined) story.title = edit.title;
      if (edit.logline !== undefined) story.logline = edit.logline;
            await jobs.updateStoryJob(id, { story });
      res.json({ success: true, data: { ...job, story } });
    } catch (error) { next(error); }
  }

  // --- Clip operations (only while clips are still PENDING; decision D4) ---
  async updateClip(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const clipId = getClipIdParam(req);
      const body = clipUpdateSchema.parse(req.body);
      const clip = await jobs.getVideoJob(clipId);
      if (!clip || clip.storyJobId !== id) { res.status(404).json({ success: false, error: 'Clip not found' }); return; }
      if (clip.status !== 'PENDING') { res.status(409).json({ success: false, error: `Cannot edit a clip in status ${clip.status}` }); return; }
      await jobs.updateVideoJob(clipId, {
        comfyuiAppId: body.comfyuiAppId ?? clip.comfyuiAppId,
        primaryValues: body.primaryValues ?? clip.primaryValues,
        continuesPrevious: body.continuesPrevious ?? clip.continuesPrevious,
      });
      res.json({ success: true, data: clip });
    } catch (error) { next(error); }
  }

  // Q5: reorder clips — re-normalizes priorities 0..n-1 so stitch order stays correct.
  async reorderClips(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const body = reorderSchema.parse(req.body);
      await jobs.renormalizePriorities(id, body.orderedIds);
      const clips = await jobs.getVideoJobsByStory(id);
      res.json({ success: true, data: clips });
    } catch (error) { next(error); }
  }

  // Manual restart of a failed clip (decision D4 retry): fresh attempt budget.
  async retryClip(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const clipId = getClipIdParam(req);
      const clip = await jobs.getVideoJob(clipId);
      if (!clip || clip.storyJobId !== id) { res.status(404).json({ success: false, error: 'Clip not found' }); return; }
      const updated = await jobs.restartVideoJob(clipId);
      res.json({ success: true, data: updated });
    } catch (error) { next(error); }
  }

  // Soft-delete: removed clips become CANCELLED for audit (decision D1); excluded from stitching.
  async cancelClip(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const clipId = getClipIdParam(req);
      const clip = await jobs.getVideoJob(clipId);
      if (!clip || clip.storyJobId !== id) { res.status(404).json({ success: false, error: 'Clip not found' }); return; }
      const updated = await jobs.cancelVideoJob(clipId);
      res.json({ success: true, data: updated });
    } catch (error) { next(error); }
  }

  // steps 13-15: stream the final stitched MP4 (with HTTP range support).
  async getFinalVideo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const job = await jobs.getStoryJob(id);
      if (!job) { res.status(404).json({ success: false, error: 'Video run not found' }); return; }
      const videoPath = job.finalVideoPath;
      if (!videoPath || !existsSync(videoPath)) { res.status(404).json({ success: false, error: 'Final video not ready', status: job.status }); return; }
      const stat = statSync(videoPath);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', 'video/mp4');
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunkSize = end - start + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        res.setHeader('Content-Length', String(chunkSize));
        createReadStream(videoPath, { start, end }).pipe(res);
      } else {
        res.status(200);
        res.setHeader('Content-Length', String(stat.size));
        createReadStream(videoPath).pipe(res);
      }
    } catch (error) { next(error); }
  }

  // Manual restart of an entire failed run: reset to PENDING and re-spawn worker (§7.4).
  async restart(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const job = await jobs.getStoryJob(id);
      if (!job) { res.status(404).json({ success: false, error: 'Video run not found' }); return; }
      await jobs.setStoryStatus(id, 'PENDING', { error: null, failedStage: null, finalVideoPath: null });
      const { startWorker } = await import('../workers/orchestrator.js');
      const worker = await startWorker(id);
      if (!worker) { res.status(409).json({ success: false, error: 'A worker is already running for this video run' }); return; }
      res.json({ success: true, data: job, restarted: true });
    } catch (error) { next(error); }
  }
}

export const videoRunController = new VideoRunController();
