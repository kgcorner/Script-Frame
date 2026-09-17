// Service: video export. Stitches a caller-provided, ordered list of stored video
// artifacts into one final MP4 in a background task (the same fire-and-forget async
// pattern as the VGWorker orchestrator; ffmpeg itself runs as a subprocess).
//
// Flow: POST /api/export/video -> create the export job with status 'not_started',
// kick off the stitcher and return immediately. Progress: not_started -> processing
// -> completed (the job carries the artifact, like generator jobs) or failed (with
// the error). Delivery flows through the shared GET /api/jobs/:id/status and
// GET /artifact/:name endpoints.
import { extname, join } from 'path';
import { existsSync } from 'fs';
import { jobService } from './job.js';
import { videoStitcher } from './videoStitcher.js';
import { artifactService, VIDEO_EXTENSIONS } from './artifact.js';
import { projectService } from './project.js';
import { AppError } from '../middleware/error.js';
import type { GeneratorArtifact, Job } from '../types/index.js';

// One resolved input video of an export job.
interface ExportSource {
  name: string;
  path: string;
}

export interface ExportJobCreateParams {
  names: string[];
  userId: string;
  projectId?: string;
}

export interface ExportJobCreateResult {
  jobId: string;
  status: Job['status'];
  videos: string[];
  projectId?: string;
}

export class ExportService {
  /**
   * Create the export job ('not_started') for the ordered video list and start the
   * background stitch. Validation happens synchronously, so callers get a 400 (with
   * per-entry details) for unknown or non-video artifact names before a job exists.
   * The job is anchored to `userId` so status queries can authorize the owner.
   */
  async createExportJob(params: ExportJobCreateParams): Promise<ExportJobCreateResult> {
    if (params.projectId) {
      const project = await projectService.getProjectForUser(params.projectId, params.userId);
      if (!project) {
        throw AppError.notFound('Project not found');
      }
    }

    const sources = this.resolveSources(params.names);
    const videos = sources.map((source) => source.name);

    const job = await jobService.createGenerationJob({
      type: 'export',
      status: 'not_started',
      input: { videos, ...(params.projectId ? { projectId: params.projectId } : {}) },
      userId: params.userId,
      projectId: params.projectId,
    });

    // Background task (Node's equivalent of a thread): the request returns while the
    // stitch continues. runExport handles its own errors, so nothing is left unhandled.
    void this.runExport(job.id, sources);

    return {
      jobId: job.id,
      status: job.status,
      videos,
      ...(job.projectId ? { projectId: job.projectId } : {}),
    };
  }

  // Every entry must be a stored video artifact; duplicates are allowed (a clip can
  // legitimately appear twice in a sequence) and the given order is preserved.
  private resolveSources(names: string[]): ExportSource[] {
    const errors: Array<{ index: number; name: string; message: string }> = [];
    const sources: ExportSource[] = [];

    names.forEach((name, index) => {
      const artifact = artifactService.resolve(name);
      if (!artifact || !VIDEO_EXTENSIONS.has(extname(artifact.name).toLowerCase())) {
        errors.push({ index, name, message: 'Unknown video artifact' });
        return;
      }
      sources.push({ name: artifact.name, path: artifact.path });
    });

    if (errors.length > 0) {
      throw AppError.badRequest('Invalid videos list', errors);
    }
    return sources;
  }

  /**
   * The background task: mark processing, stitch all videos (in the requested order)
   * into {assetsPath}/<jobId>.mp4 and record the artifact (which flips the job to
   * completed). Any failure marks the job failed with the ffmpeg error text.
   */
  private async runExport(jobId: string, sources: ExportSource[]): Promise<void> {
    try {
      await jobService.updateJobStatus(jobId, {
        jobId,
        progress: 10,
        status: 'processing',
        message: `Stitching ${sources.length} video(s)`,
      });

      // Artifacts are write-once and never deleted (see the artifact service contract):
      // <jobId>.mp4 is unique per job, so an existing file is left untouched.
      const outputName = `${jobId}.mp4`;
      const outputPath = join(artifactService.directory(), outputName);
      if (!existsSync(outputPath)) {
        await videoStitcher.stitchClips(
          sources.map((source) => source.path),
          outputPath
        );
      }

      const artifact: GeneratorArtifact = {
        name: outputName,
        type: 'video',
        mimeType: 'video/mp4',
      };
      await jobService.setJobArtifact(jobId, artifact);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[export] stitching failed for job ${jobId}:`, message);
      await jobService.updateJobStatus(jobId, {
        jobId,
        progress: 0,
        status: 'failed',
        error: `Video export failed: ${message}`,
      });
    }
  }
}

export const exportService = new ExportService();
