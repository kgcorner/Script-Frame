// VGWorker — drives one story-generation run end-to-end
// (VIDEO_GENERATION_PROCESS.md v1.1 is the process of record).
//
// Lifecycle implemented here:
//   PENDING/STORY_GENERATING → LLM story + portraits → WAITING_REVIEW (human gate)
//   CLIP_PLANNING            → LLM clip plan → video_generation_jobs rows (priority 0..n-1)
//   GENERATING_CLIPS         → submitter threads + 20s priority-ordered poller
//   STITCHING                → ffmpeg concat in priority order → COMPLETED (+ assets row)
import { mkdir, writeFile, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { config } from '../config/index.js';
import { sleep, generateId } from '../utils/index.js';
import { videoGenerationJobService as jobs } from '../services/videoGenerationJob.js';
import { scriptframeWorkflowService } from '../services/scriptframeWorkflow.js';
import { comfyuiAppService } from '../services/comfyuiApp.js';
import { llmProviderService } from '../services/llmProvider.js';
import { videoStitcher } from '../services/videoStitcher.js';
import { comfyuiService } from '../services/comfyui.js';
import { db, schema } from '../db/index.js';
import type { ComfyUIApp, ComfyUIAppPrimaryField } from '../types/index.js';
import type { ScriptFrameNode, ScriptFrameNodeData } from '../types/scriptframe.js';
import type {
  CharacterProfile,
  AppCatalogEntry,
  StoryResult,
  StoryStage,
  StoryJobStatus,
} from '../types/videoGeneration.js';
import { storyResultSchema, clipPlanSchema } from '../types/videoGeneration.js';

const PORTRAIT_POLL_MS = 5000;

interface WorkerContext {
  workflowId: string;
  llmAppId: string;
  stackAppIds: string[];
  maxClipLengthSeconds?: number;
  maxTimeoutSeconds: number;
  nsfw: boolean;
}

export class VGWorker {
  private ctx: WorkerContext | null = null;
  private stopped = false;
  private approvalGate: { promise: Promise<void>; resolve: () => void } | null = null;
  private revising = false;

  constructor(readonly storyJobId: string) {}

  stop(): void {
    this.stopped = true;
    this.approvalGate?.resolve();
  }

  /** Resolve the workflow preset into the bindings the worker needs. */
  private async context(): Promise<WorkerContext> {
    if (this.ctx) return this.ctx;
    const job = await jobs.getStoryJob(this.storyJobId);
    if (!job) throw new Error(`Story job not found: ${this.storyJobId}`);
    const workflow = await scriptframeWorkflowService.getWorkflow(job.workflowId);
    if (!workflow) throw new Error(`ScriptFrame workflow not found: ${job.workflowId}`);

    const workerNode = (workflow.nodes as ScriptFrameNode[]).find((n) => n.type === 'worker');
    const data = (workerNode?.data ?? {}) as ScriptFrameNodeData;
    if (!data.llmAppId) throw new Error('Workflow worker node has no LLM App bound (llmAppId)');
    if (!data.comfyuiStackId) throw new Error('Workflow worker node has no ComfyUI stack bound (comfyuiStackId)');

    const stack = await comfyuiAppService.getStack(data.comfyuiStackId);
    if (!stack) throw new Error(`ComfyUI stack not found: ${data.comfyuiStackId}`);
    if (stack.appIds.length === 0) throw new Error('ComfyUI stack has no apps attached');

    this.ctx = {
      workflowId: workflow.id,
      llmAppId: data.llmAppId,
      stackAppIds: stack.appIds,
      maxClipLengthSeconds: workflow.maxClipLength ?? undefined,
      maxTimeoutSeconds: workflow.maxTimeout ?? config.videoGeneration.defaultJobTimeoutSeconds,
      nsfw: workflow.nsfw ?? false,
    };
    return this.ctx;
  }

  /** Human approval gate for WAITING_REVIEW (resolved by orchestrator.approve). */
  private waitForApproval(): Promise<void> {
    if (!this.approvalGate) {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => { resolve = r; });
      this.approvalGate = { promise, resolve };
    }
    return this.approvalGate.promise;
  }

  /** Called by the orchestrator when the reviewer approves the story. */
  approve(): void {
    this.approvalGate?.resolve();
    this.approvalGate = null;
  }

  private stageForStatus(status?: StoryJobStatus): StoryStage {
    switch (status) {
      case 'CLIP_PLANNING': return 'CLIP_PLANNING';
      case 'GENERATING_CLIPS': return 'CLIPS';
      case 'STITCHING': return 'STITCHING';
      default: return 'STORY';
    }
  }


  // ---------------------------------------------------------------------
  // Main entry — dispatches on the persisted status so a run can resume
  // after restart or review (crash recovery, process doc §7.7).
  // ---------------------------------------------------------------------
  async run(): Promise<void> {
    const job = await jobs.getStoryJob(this.storyJobId);
    if (!job) throw new Error(`Story job not found: ${this.storyJobId}`);
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) return;

    try {
      await this.context(); // fail fast on missing bindings

      switch (job.status) {
        case 'PENDING':
        case 'STORY_GENERATING':
          await this.generateStoryAndPortraits();
          await jobs.setStoryStatus(this.storyJobId, 'WAITING_REVIEW');
          await this.reviewLoop();
          await this.planAndQueueClips();
          await this.generateClips();
          await this.stitchFinalVideo();
          break;

        case 'WAITING_REVIEW':
          // Resume waiting after a restart; the reviewer may already have approved.
          await this.reviewLoop();
          await jobs.setStoryStatus(this.storyJobId, 'CLIP_PLANNING');
          await this.planAndQueueClips();
          await this.generateClips();
          await this.stitchFinalVideo();
          break;

        case 'CLIP_PLANNING':
          await this.planAndQueueClips();
          await this.generateClips();
          await this.stitchFinalVideo();
          break;

        case 'GENERATING_CLIPS':
          await this.generateClips();
          await this.stitchFinalVideo();
          break;

        case 'STITCHING':
          await this.stitchFinalVideo();
          break;
      }
    } catch (err) {
      if (this.stopped) return; // cancelled / shutting down — not a failure
      await this.fail('STORY', err instanceof Error ? err.message : String(err));
    }
  }

  /** Review gate: resolves on approval; applies change requests while staying WAITING_REVIEW. */
  private async reviewLoop(): Promise<void> {
    // Wake immediately if approval arrived while we were between stages.
    while (!this.approved && !this.stopped) {
      if (this.pendingChange) {
        const request = this.pendingChange;
        this.pendingChange = null;
        await this.reviseStory(request);
        continue;
      }
      this.approvalGate = null;
      await Promise.race([this.waitForApproval(), sleep(1500)]);
    }
  }

  // ---------------------------------------------------------------------
  // Stage 1: LLM story + characters, then ComfyUI portraits (steps 3-6)
  // ---------------------------------------------------------------------
  private async generateStoryAndPortraits(): Promise<void> {
    await jobs.setStoryStatus(this.storyJobId, 'STORY_GENERATING');
    const job = (await jobs.getStoryJob(this.storyJobId))!;
    const ctx = (await this.context())!;

    const catalog = await this.buildAppCatalog();
    const durationLine = job.targetDurationSeconds
      ? `The total video length must be about ${job.targetDurationSeconds} seconds.`
      : 'No total length was specified — choose a suitable total duration yourself.';
    const clipLine = ctx.maxClipLengthSeconds
      ? `Each generated clip is at most ${ctx.maxClipLengthSeconds} seconds long.`
      : '';

    const prompt = [
      'You are planning a short video from a theme.',
      `Theme: "${job.theme}"`,
      durationLine,
      clipLine,
      ctx.nsfw ? 'Content policy: uncensored (NSFW) content is allowed for this production.' : 'Content policy: keep everything safe-for-work.',
      '',
      'Available ComfyUI apps for rendering (use the exact id in imageAppId):',
      JSON.stringify(catalog, null, 2),
      '',
      'Produce a JSON object with keys: title, logline, story, characters.',
      'Each character needs: name, role, description (appearance + personality for the reviewer),',
      'imagePrompt (a detailed text-to-image prompt for a clear portrait of the character),',
      'imageNegativePrompt, imageAppId (a text-to-image app from the catalog), and',
      'imagePrimaryValues (values for that app\'s required primary fields; omit optional ones).',
      'The story must be a complete narrative that can be cut into clips of the stated lengths.',
      'Respond with valid JSON only — no prose, no markdown fences.',
    ].filter(Boolean).join('\n');

    const result = await llmProviderService.completeJson<StoryResult>({
      appId: ctx.llmAppId,
      userPrompt: prompt,
      schema: storyResultSchema,
    });

    const characters: CharacterProfile[] = result.characters.map((c) => ({
      name: c.name,
      role: c.role,
      description: c.description,
      imageAppId: c.imageAppId,
      imagePrompt: c.imagePrompt,
      imageNegativePrompt: c.imageNegativePrompt,
      imagePrimaryValues: c.imagePrimaryValues,
      portraitStatus: 'PENDING',
    }));

    await jobs.updateStoryJob(this.storyJobId, {
      story: { title: result.title, logline: result.logline, story: result.story },
      characters,
    });

    await this.renderPortraits(characters);
    await jobs.updateStoryJob(this.storyJobId, { characters });
  }

  /** Submit one portrait render per character and poll until done (assumption A1). */
  private async renderPortraits(characters: CharacterProfile[]): Promise<void> {
    const ctx = (await this.context())!;
    const catalog = await this.buildAppCatalog();
    const fallbackImageApp = catalog.find((a) => a.kind === 'image') ?? catalog[0];
    const dir = join(config.videoGeneration.mediaPath, this.storyJobId);
    await mkdir(dir, { recursive: true });

    const submissions = characters.map(async (character, index) => {
      try {
        const appId = character.imageAppId || fallbackImageApp?.id;
        if (!appId) throw new Error('No ComfyUI app available for portrait rendering');
        const app = await comfyuiAppService.getApp(appId);
        if (!app?.definition) throw new Error(`ComfyUI app has no embedded definition: ${appId}`);

        const workflow = this.mergeValues(
          app.definition as Record<string, unknown>,
          app.primaryFields as unknown as Array<Record<string, unknown>>,
          { ...(character.imagePrimaryValues ?? {}), prompt: character.imagePrompt, negative_prompt: character.imageNegativePrompt || undefined }
        );
        const clientId = generateId();
        const response = await comfyuiService.queuePrompt(workflow as never, clientId);
        character.portraitStatus = 'SUBMITTED';
        character.portraitPromptId = response.prompt_id;

        const portraitPath = await this.pollAndFetchMedia(
          response.prompt_id,
          join(dir, `portrait_${index}.png`),
          'image',
          ctx.maxTimeoutSeconds
        );
        character.portraitStatus = 'COMPLETED';
        character.portraitPath = portraitPath;
      } catch (err) {
        character.portraitStatus = 'FAILED';
        character.portraitError = err instanceof Error ? err.message : String(err);
        // Non-fatal: the reviewer sees the failure and can regenerate (§7.2).
      }
    });

    await Promise.all(submissions);
  }

  // ---------------------------------------------------------------------
  // Stage 2: LLM clip plan -> video_generation_jobs rows (steps 8-9)
  // ---------------------------------------------------------------------
  private async planAndQueueClips(): Promise<void> {
    await jobs.setStoryStatus(this.storyJobId, 'CLIP_PLANNING');
    const job = (await jobs.getStoryJob(this.storyJobId))!;
    const ctx = (await this.context())!;
    if (!job.story) throw new Error('Cannot plan clips before the story exists');

    const catalog = await this.buildAppCatalog();
    const videoApps = catalog.filter((a) => a.kind !== 'image');
    const clipLine = ctx.maxClipLengthSeconds
      ? `Every clip must be at most ${ctx.maxClipLengthSeconds} seconds.`
      : '';

    const prompt = [
      'Break the approved story into an ordered list of video generation clips.',
      `Story title: ${JSON.stringify((job.story as { title?: string }).title ?? '')}`,
      `Story:\n${(job.story as { story: string }).story}`,
      job.targetDurationSeconds
        ? `Total video length must be about ${job.targetDurationSeconds} seconds.`
        : 'Choose a sensible total duration.',
      clipLine,
      ctx.nsfw ? 'Content policy: uncensored (NSFW) content is allowed.' : 'Content policy: safe-for-work.',
      '',
      'Available ComfyUI video apps (choose the best per clip via comfyuiAppId):',
      JSON.stringify(videoApps.length > 0 ? videoApps : catalog, null, 2),
      '',
      'Return JSON: {"clips":[{...}]} where each clip has:',
      '- comfyuiAppId: id of the app to render this clip,',
      '- primaryValues: values for that app\'s primary fields (must include the motion/camera prompt),',
      '- durationHintSeconds, summary (what happens in this clip),',
      '- continuesPrevious: true when this clip must visually continue from the last frame of the previous clip.',
      'Order clips chronologically; the first clip has continuesPrevious=false.',
      'Respond with valid JSON only — no prose, no markdown fences.',
    ].filter(Boolean).join('\n');

    const plan = await llmProviderService.completeJson<ClipPlan>({
      appId: ctx.llmAppId,
      userPrompt: prompt,
      schema: clipPlanSchema,
    });

    await this.validatePlanApps(plan.clips);
    await jobs.updateStoryJob(this.storyJobId, { clipPlan: plan });

    // One row per clip, priority = index (0..n-1) — stitch order == priority order.
    const rows: NewVideoGenerationJob[] = plan.clips.map((clip, index) => ({
      id: generateId(),
      storyJobId: this.storyJobId,
      priority: index,
      comfyuiAppId: clip.comfyuiAppId,
      primaryValues: clip.primaryValues,
      continuesPrevious: clip.continuesPrevious && index > 0,
      status: 'PENDING' as const,
    }));
    await jobs.createVideoJobs(rows);
  }

  /** Guard against hallucinated app ids: one corrective LLM retry, then fail (D3). */
  private async validatePlanApps(clips: ClipPlanItem[]): Promise<void> {
    const known = new Set((await this.buildAppCatalog()).map((a) => a.id));
    const unknown = clips.filter((c) => !known.has(c.comfyuiAppId));
    if (unknown.length === 0) return;
    throw new Error(`Clip plan references unknown ComfyUI apps: ${[...new Set(unknown.map((c) => c.comfyuiAppId))].join(', ')}`);
  }

  // ---------------------------------------------------------------------
  // Stage 3: submission threads + 20s priority-ordered poller (steps 10-12)
  // ---------------------------------------------------------------------
  private async generateClips(): Promise<void> {
    await jobs.setStoryStatus(this.storyJobId, 'GENERATING_CLIPS');
    const ctx = (await this.context())!;

    const submitter = this.submitterLoop();
    const poller = this.pollerLoop(ctx);
    await Promise.all([submitter, poller]);

    const active = await jobs.getVideoJobsByStatuses(this.storyJobId, ['PENDING', 'SUBMITTING', 'JOB_SUBMITTED']);
    if (active.length > 0) {
      throw new Error(`Clip generation ended with ${active.length} unfinished clip(s)`);
    }
  }

  /** Submits PENDING clips (priority order) while the head-of-line job is still open. */
  private async submitterLoop(): Promise<void> {
    while (!this.stopped) {
      const pending = await jobs.getVideoJobsByStatuses(this.storyJobId, ['PENDING']);
      if (pending.length === 0) {
        const unfinished = await jobs.getVideoJobsByStatuses(this.storyJobId, ['SUBMITTING', 'JOB_SUBMITTED']);
        if (unfinished.length === 0) return; // everything reached a terminal state
        await sleep(config.videoGeneration.pollIntervalMs);
        continue;
      }

      for (const clip of pending) {
        if (this.stopped) return;
        await this.submitClip(clip);
      }
      await sleep(config.videoGeneration.pollIntervalMs);
    }
  }

  private async submitClip(clip: VideoGenerationJob): Promise<void> {
    await jobs.updateVideoJob(clip.id, { status: 'SUBMITTING', error: null });
    try {
      const app = await comfyuiAppService.getApp(clip.comfyuiAppId);
      if (!app?.definition) throw new Error(`ComfyUI app not found or has no definition: ${clip.comfyuiAppId}`);

      let definition = this.mergeValues(
        app.definition as Record<string, unknown>,
        app.primaryFields as unknown as Array<Record<string, unknown>>,
        (clip.primaryValues as Record<string, unknown> | null) ?? {}
      );

      // Continuation: start from the last frame of the previous priority's clip.
      let startFramePath: string | null = null;
      if (clip.continuesPrevious && clip.priority > 0) {
        startFramePath = await this.prepareStartFrame(clip.priority);
        if (startFramePath) {
          definition = await this.injectStartFrame(definition, startFramePath);
        } else {
          // Fallback (process doc Q3): render text-to-video without a start frame.
          console.warn(`[VGWorker ${this.storyJobId}] clip ${clip.priority}: no start frame available, falling back to text-to-video`);
        }
      }

      const response = await comfyuiService.queuePrompt(definition as never, generateId());
      await jobs.updateVideoJob(clip.id, {
        status: 'JOB_SUBMITTED',
        comfyuiPromptId: response.prompt_id,
        attempts: clip.attempts + 1,
        submittedAt: new Date(),
        startFramePath: startFramePath ?? undefined,
      });
    } catch (err) {
      await this.handleClipFailure(clip, err instanceof Error ? err.message : String(err));
    }
  }

  /** Single 20s loop that walks completions strictly in priority order (step 11). */
  private async pollerLoop(ctx: WorkerContext): Promise<void> {
    while (!this.stopped) {
      const next = await jobs.getNextPendingVideoJob(this.storyJobId);
      if (!next) return; // every clip is COMPLETED / FAILED / CANCELLED
      if (next.status === 'PENDING' || next.status === 'SUBMITTING') {
        await sleep(config.videoGeneration.pollIntervalMs); // submitter owns this one
        continue;
      }

      const job = (await jobs.getVideoJob(next.id))!;
      if (!job.comfyuiPromptId) {
        await sleep(2000);
        continue;
      }

      // Per-job timeout measured from submission (§7.6); ComfyUI renders one video at a time.
      const submittedAt = job.submittedAt ? new Date(job.submittedAt).getTime() : Date.now();
      const deadlineMs = ctx.maxTimeoutSeconds * 1000;
      if (Date.now() - submittedAt > deadlineMs) {
        await this.handleClipFailure(job, `Timed out after ${ctx.maxTimeoutSeconds}s waiting for ComfyUI`);
        continue;
      }

      try {
        const history = await comfyuiService.getHistory(job.comfyuiPromptId);
        const entry = history[job.comfyuiPromptId];
        if (entry?.status?.status_str === 'error') {
          await this.handleClipFailure(job, 'ComfyUI reported execution error');
          continue;
        }
        if (entry && entry.status?.completed) {
          const dir = join(config.videoGeneration.mediaPath, this.storyJobId);
          const outPath = join(dir, `clip_${String(job.priority).padStart(3, '0')}.mp4`);
          const mediaPath = await this.fetchMedia(entry, outPath);
          await jobs.updateVideoJob(job.id, { status: 'COMPLETED', assetPath: mediaPath, completedAt: new Date() });
          console.log(`[VGWorker ${this.storyJobId}] clip ${job.priority} completed -> ${mediaPath}`);
          continue; // re-query immediately for the next priority
        }
      } catch (err) {
        // Transient ComfyUI connectivity hiccup — keep polling until the deadline.
        console.warn(`[VGWorker ${this.storyJobId}] poll error for clip ${job.priority}: ${err instanceof Error ? err.message : err}`);
      }
      await sleep(config.videoGeneration.pollIntervalMs);
    }
  }

  // ---------------------------------------------------------------------
  // Stage 4: stitch gate + ffmpeg concat (steps 13-15)
  // ---------------------------------------------------------------------
  private async stitchFinalVideo(): Promise<void> {
    await jobs.setStoryStatus(this.storyJobId, 'STITCHING');
    const clips = await jobs.getVideoJobsByStory(this.storyJobId);
    const active = clips.filter((c) => c.status !== 'CANCELLED');

    // Hard gate: stitching only when every non-cancelled clip completed (§7.5).
    const incomplete = active.filter((c) => c.status !== 'COMPLETED' || !c.assetPath);
    if (incomplete.length > 0) {
      throw new Error(`Stitching blocked: ${incomplete.length} clip(s) not completed (priorities ${incomplete.map((c) => c.priority).join(', ')})`);
    }

    const ordered = active.sort((a, b) => a.priority - b.priority).map((c) => c.assetPath!);
    const outputPath = join(config.videoGeneration.mediaPath, this.storyJobId, 'final.mp4');
    await videoStitcher.stitchClips(ordered, outputPath);

    const info = await stat(outputPath);
    await db.insert(schema.assets).values({
      id: generateId(),
      storyJobId: this.storyJobId,
      type: 'video',
      path: outputPath,
      mimeType: 'video/mp4',
      size: info.size,
    });
    await jobs.updateStoryJob(this.storyJobId, { status: 'COMPLETED', finalVideoPath: outputPath, error: null, failedStage: null });
    console.log(`[VGWorker ${this.storyJobId}] final video ready -> ${outputPath}`);
  }

  /** Review-loop change request: LLM revises the draft; stays WAITING_REVIEW (step 7). */
  private async reviseStory(request: string): Promise<void> {
    const job = (await jobs.getStoryJob(this.storyJobId))!;
    const ctx = (await this.context())!;
    if (!job.story) return;

    const prompt = [
      'Revise the existing story draft according to the reviewer request.',
      `Reviewer request: "${request}"`,
      '',
      'Current draft JSON:',
      JSON.stringify({ story: job.story, characters: job.characters ?? [] }, null, 2),
      '',
      'Return the full revised JSON object (same schema as before: title, logline, story,',
      'characters with name, role, description, imagePrompt, imageNegativePrompt, imageAppId,',
      'imagePrimaryValues). Keep unchanged parts as-is.',
      'Respond with valid JSON only — no prose, no markdown fences.',
    ].join('\n');

    const result = await llmProviderService.completeJson<StoryResult>({
      appId: ctx.llmAppId,
      userPrompt: prompt,
      schema: storyResultSchema,
    });

    const previous = (job.characters ?? []) as CharacterProfile[];
    const revised: CharacterProfile[] = result.characters.map((c) => {
      const old = previous.find((p) => p.name === c.name);
      const portraitStale = !old || old.imagePrompt !== c.imagePrompt || old.imageAppId !== c.imageAppId;
      return {
        name: c.name,
        role: c.role,
        description: c.description,
        imageAppId: c.imageAppId,
        imagePrompt: c.imagePrompt,
        imageNegativePrompt: c.imageNegativePrompt,
        imagePrimaryValues: c.imagePrimaryValues,
        // Re-render only characters whose visual definition changed.
        portraitStatus: portraitStale ? 'PENDING' : old?.portraitStatus,
        portraitPath: portraitStale ? undefined : old?.portraitPath,
        portraitPromptId: portraitStale ? undefined : old?.portraitPromptId,
        portraitError: portraitStale ? undefined : old?.portraitError,
      };
    });

    await jobs.updateStoryJob(this.storyJobId, {
      story: { title: result.title, logline: result.logline, story: result.story },
      characters: revised,
      revision: job.revision + 1,
    });
    await this.renderPortraits(revised);
    await jobs.updateStoryJob(this.storyJobId, { characters: revised });
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  /** Last frame of the clip at priority - 1, as an uploadable start frame (step 6). */
  private async prepareStartFrame(priority: number): Promise<string | null> {
    const all = await jobs.getVideoJobsByStory(this.storyJobId);
    const previous = all.find((c) => c.priority === priority - 1);
    if (!previous?.assetPath || previous.status !== 'COMPLETED') return null;
    try {
      const outPath = join(config.videoGeneration.mediaPath, this.storyJobId, `start_${String(priority).padStart(3, '0')}.png`);
      return await videoStitcher.extractLastFrame(previous.assetPath, outPath);
    } catch (err) {
      console.warn(`[VGWorker ${this.storyJobId}] last-frame extraction failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /** Download the produced media for a finished ComfyUI history entry. */
  private async fetchMedia(entry: ComfyUIHistoryEntry, outputPath: string): Promise<string> {
    for (const nodeOutput of Object.values(entry.outputs ?? {})) {
      const files = nodeOutput.videos ?? nodeOutput.images ?? nodeOutput.audios ?? [];
      if (files.length === 0) continue;
      const file = files[0];
      const buffer = await comfyuiService.getImage(file.filename, file.subfolder, (file.type as 'output' | 'temp' | 'input') || 'output');
      await mkdir(dirname2(outputPath), { recursive: true });
      await writeFile(outputPath, buffer);
      return outputPath;
    }
    throw new Error('ComfyUI history has no media outputs');
  }

  /**
   * Poll /history for a submitted prompt until it completes or the deadline
   * expires, then download its media to outputPath. Used for inline submissions
   * (character portraits); clip polling goes through pollerLoop instead.
   */
  private async pollAndFetchMedia(
    promptId: string,
    outputPath: string,
    kind: 'image' | 'video',
    timeoutSeconds: number
  ): Promise<string> {
    const deadline = Date.now() + timeoutSeconds * 1000;
    await mkdir(dirname2(outputPath), { recursive: true });
    while (Date.now() < deadline && !this.stopped) {
      try {
        const history = await comfyuiService.getHistory(promptId);
        const entry = history[promptId];
        if (entry?.status?.status_str === 'error') {
          throw new Error('ComfyUI reported execution error');
        }
        if (entry?.status?.completed) {
          return await this.fetchMedia(entry, outputPath);
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('execution error')) throw err;
        // Transient ComfyUI connectivity hiccup — keep polling until the deadline.
      }
      await sleep(config.videoGeneration.pollIntervalMs);
    }
    throw new Error(`Timed out after ${timeoutSeconds}s waiting for ComfyUI (${kind})`);
  }

  /**
   * Clone an app definition and set primary-field inputs. Values win over
   * defaults; fields are keyed "nodeId:inputName" and unmatched required
   * fields fall back to the app's saved default.
   */
  private mergeValues(
    definition: Record<string, unknown>,
    fields: ReadonlyArray<Record<string, unknown>>,
    values: Record<string, unknown>
  ): Record<string, unknown> {
    const clone = JSON.parse(JSON.stringify(definition)) as Record<string, Record<string, unknown>>;
    for (const field of fields) {
      const nodeId = String(field['nodeId'] ?? '');
      const inputName = String(field['inputName'] ?? '');
      if (!nodeId || !inputName || !clone[nodeId]) continue;
      const value = values[inputName] ?? values[`${nodeId}:${inputName}`] ?? field['defaultValue'];
      if (value === undefined) continue;
      clone[nodeId]['inputs'] = { ...(clone[nodeId]['inputs'] ?? {}), [inputName]: value };
    }
    return clone;
  }

  /** Upload a start frame and wire it into the definition's image input. */
  private async injectStartFrame(definition: Record<string, unknown>, imagePath: string): Promise<Record<string, unknown>> {
    const buffer = await readFile(imagePath);
    const filename = `sf_${generateId()}.png`;
    const uploaded = await comfyuiService.uploadImage(buffer, filename, 'vgworker');

    const clone = JSON.parse(JSON.stringify(definition)) as Record<string, Record<string, unknown>>;
    const imageInputPattern = /^(image|start_image|init_image|start_frame|first_frame)$/i;
    for (const [nodeId, node] of Object.entries(clone)) {
      const inputs = (node['inputs'] ?? {}) as Record<string, unknown>;
      for (const [inputName, value] of Object.entries(inputs)) {
        // Widget inputs are scalars/null; link connections are arrays or ints.
        const isWidget = value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
        if (isWidget && imageInputPattern.test(inputName)) {
          clone[nodeId]['inputs'] = { ...inputs, [inputName]: uploaded.name };
          return clone;
        }
      }
    }
    console.warn(`[VGWorker ${this.storyJobId}] no image input node found for start frame`);
    return clone;
  }

  /** §6.0: title + description + primary fields of every attached app for the LLM. */
  private async buildAppCatalog(): Promise<AppCatalogEntry[]> {
    const ctx = (await this.context())!;
    const entries: AppCatalogEntry[] = [];
    for (const appId of ctx.stackAppIds) {
      const app = await comfyuiAppService.getApp(appId);
      if (!app || !app.isActive) continue;
      const fields = (app.primaryFields ?? []) as unknown as Array<Record<string, unknown>>;
      const haystack = `${app.name} ${app.description ?? ''} ${fields.map((f) => String(f['label'] ?? '')).join(' ')}`.toLowerCase();
      const mentionsVideo = /video|i2v|image.?to.?video|wan|animate|motion/.test(haystack);
      const mentionsImage = /image|portrait|text.?to.?image|flux|sdxl|checkpoint/.test(haystack);
      entries.push({
        id: app.id,
        name: app.name,
        description: app.description ?? '',
        kind: mentionsVideo ? 'video' : mentionsImage ? 'image' : 'unknown',
        primaryFields: fields.map((f) => ({
          key: `${f['nodeId']}:${f['inputName']}`,
          inputName: String(f['inputName'] ?? ''),
          label: String(f['label'] ?? f['inputName'] ?? ''),
          aliasName: f['aliasName'] ? String(f['aliasName']) : undefined,
          type: String(f['type'] ?? 'string'),
          required: Boolean(f['required']),
          options: Array.isArray(f['options']) ? (f['options'] as string[]) : undefined,
          defaultValue: f['defaultValue'],
        })),
      });
    }
    return entries;
  }

  /** Auto-retry policy (§7.3): up to MAX_JOB_ATTEMPTS, then FAILED; other clips continue. */
  private async handleClipFailure(clip: VideoGenerationJob, message: string): Promise<void> {
    const attemptsUsed = clip.comfyuiPromptId ? clip.attempts : clip.attempts + 1; // a failed submit consumed an attempt
    if (attemptsUsed >= config.videoGeneration.maxJobAttempts) {
      console.error(`[VGWorker ${this.storyJobId}] clip ${clip.priority} FAILED permanently: ${message}`);
      await jobs.updateVideoJob(clip.id, { status: 'FAILED', error: message, attempts: attemptsUsed });
      return;
    }
    console.warn(`[VGWorker ${this.storyJobId}] clip ${clip.priority} attempt ${attemptsUsed}/${config.videoGeneration.maxJobAttempts} failed (${message}) — requeueing`);
    await jobs.updateVideoJob(clip.id, { status: 'PENDING', error: message, attempts: attemptsUsed, comfyuiPromptId: null, submittedAt: null });
  }

  private async fail(stage: StoryStage, message: string): Promise<void> {
    console.error(`[VGWorker ${this.storyJobId}] stage ${stage} failed: ${message}`);
    await jobs.setStoryStatus(this.storyJobId, 'FAILED', { failedStage: stage, error: message });
  }

  // Review-loop state.
  private approved = false;
  private pendingChange: string | null = null;

  /** Orchestrator: reviewer approved the story. */
  markApproved(): void {
    this.approved = true;
    this.approvalGate?.resolve();
    this.approvalGate = null;
  }

  /** Orchestrator: reviewer requested a change; the run stays WAITING_REVIEW. */
  requestChange(request: string): void {
    this.pendingChange = request;
    this.approvalGate?.resolve(); // wake the review loop
    this.approvalGate = null;
  }
}

import type { ComfyUIHistoryResponse } from '../types/index.js';
type ComfyUIHistoryEntry = ComfyUIHistoryResponse[string];
import { dirname as dirname2 } from 'path';
import type { NewVideoGenerationJob, VideoGenerationJob } from '../db/index.js';
import type { ClipPlan, ClipPlanItem } from '../types/videoGeneration.js';
