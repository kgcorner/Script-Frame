// Service: Generator endpoints. Resolves workflow configuration from
// src/assets/workflows-cfg.json, renders the matching ComfyUI workflow template
// (src/assets/*.json), submits it and persists a job row.
import { existsSync, readFileSync } from 'fs';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname, extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { comfyuiService } from './comfyui.js';
import { jobService } from './job.js';
import { projectService } from './project.js';
import { AppError } from '../middleware/error.js';
import {
  artifactService,
  IMAGE_EXTENSIONS,
  kindForFile,
  mimeTypeForFile,
  type ArtifactMediaKind,
} from './artifact.js';
import type {
  ComfyUIHistoryResponse,
  ComfyUIWorkflow,
  GeneratorArtifact,
  GeneratorGenerationResult,
  GeneratorJobType,
  GeneratorWorkflowConfig,
  GeneratorWorkflowInput,
  Job,
} from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Assets live under `src/assets` when running via tsx. `tsc` does not copy JSON
// assets into `dist`, so the sibling source directory is probed as a fallback.
const ASSET_DIR_CANDIDATES = [
  resolve(__dirname, '../assets'),
  resolve(__dirname, '../../src/assets'),
];

// Raw asset entry: identical to the public config plus the workflow file name.
interface RawGeneratorWorkflowConfig extends GeneratorWorkflowConfig {
  file: string;
}

interface InputValidationError {
  field: string;
  message: string;
}

// The public generation payload uses friendly camelCase names, while the workflow
// templates/config use the original ComfyUI input names. Keep accepting native
// workflow keys too, but normalize the public aliases before validation/rendering.
const PUBLIC_INPUT_ALIASES: Record<string, string> = {
  aspect_ratio: 'aspectRatio',
  mp: 'megapixels',
};

const WORKFLOWS_CONFIG_FILE = 'workflows-cfg.json';

/**
 * Map public generator input names to the names used by a workflow config. Compact
 * aspect-ratio ids are also expanded to the full ComfyUI option label (for example,
 * `9:16` -> `9:16 (Portrait Widescreen)`).
 */
export function normalizeGeneratorInputs(
  config: GeneratorWorkflowConfig,
  provided: Record<string, unknown>
): Record<string, unknown> {
  const normalized = { ...provided };

  for (const [key, definition] of Object.entries(config.inputs)) {
    if (normalized[key] === undefined) {
      const publicKey = PUBLIC_INPUT_ALIASES[key];
      if (publicKey && provided[publicKey] !== undefined) {
        normalized[key] = provided[publicKey];
      }
    }

    if (key === 'aspect_ratio' && typeof normalized[key] === 'string' && definition.acceptedValues) {
      const requestedRatio = normalized[key].trim();
      const configuredRatio = definition.acceptedValues.find(
        (value) => value === requestedRatio || value.startsWith(`${requestedRatio} `)
      );
      if (configuredRatio) normalized[key] = configuredRatio;
    }
  }

  return normalized;
}

function resolveAssetPath(fileName: string): string {
  for (const dir of ASSET_DIR_CANDIDATES) {
    const candidate = resolve(dir, fileName);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Generator asset not found: ${fileName} (searched: ${ASSET_DIR_CANDIDATES.join(', ')})`
  );
}

// A single media file produced by a completed ComfyUI prompt.
type OutputMedia = {
  filename: string;
  subfolder: string;
  type: 'input' | 'output' | 'temp';
  kind: ArtifactMediaKind;
  mimeType: string;
};

const DEFAULT_EXTENSION: Record<ArtifactMediaKind, string> = {
  image: '.png',
  video: '.mp4',
  audio: '.wav',
};

// `file` inputs (e.g. the I2V `image`) accept a base64 data URI; the MIME type
// decides the extension the upload gets in ComfyUI's input directory.
const DATA_URI_PATTERN = /^data:([^;,]+);base64,(.+)$/s;
const DATA_URI_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

// Order used when the job's own media kind is unavailable.
const KIND_PRIORITY: Array<ArtifactMediaKind> = ['video', 'image', 'audio'];
const TERMINAL_JOB_STATUSES: string[] = ['completed', 'failed', 'cancelled'];

function getJobArtifact(job: Pick<Job, 'output'>): GeneratorArtifact | null {
  const output = job.output as { artifact?: GeneratorArtifact } | null;
  return output?.artifact ?? null;
}

/**
 * Choose the artifact to keep for a completed prompt. SaveImage + PreviewImage expose
 * the same file twice, so candidates are deduped by location; the media kind matching
 * the job wins, then saved `output` files are preferred over `temp` previews.
 */
function pickOutputMedia(entry: ComfyUIHistoryResponse[string], jobType: string): OutputMedia | null {
  const candidates: OutputMedia[] = [];
  for (const nodeOutput of Object.values(entry.outputs ?? {})) {
    const groups: Array<[OutputMedia['kind'], Array<{ filename: string; subfolder: string; type: string }>]> = [
      ['video', nodeOutput.videos ?? []],
      ['image', nodeOutput.images ?? []],
      ['audio', nodeOutput.audios ?? []],
    ];
    for (const [kind, files] of groups) {
      for (const file of files) {
        const mediaKind = kindForFile(file.filename, kind);
        candidates.push({
          filename: file.filename,
          subfolder: file.subfolder ?? '',
          type: (file.type as OutputMedia['type']) || 'output',
          kind: mediaKind,
          mimeType: mimeTypeForFile(file.filename, mediaKind),
        });
      }
    }
  }
  if (candidates.length === 0) return null;

  const preferred: OutputMedia['kind'] =
    jobType === 'video' ? 'video' : jobType === 'audio' ? 'audio' : 'image';
  const rank = (media: OutputMedia): number =>
    (media.kind === preferred ? 0 : KIND_PRIORITY.indexOf(media.kind) + 1) * 2 +
    (media.type === 'output' ? 0 : 1);

  const seen = new Set<string>();
  for (const candidate of [...candidates].sort((a, b) => rank(a) - rank(b))) {
    const key = `${candidate.subfolder}/${candidate.filename}`;
    if (seen.has(key)) continue;
    seen.add(key);
    return candidate;
  }
  return null;
}

/** Message from a failed/interrupted ComfyUI execution, if any. */
function executionErrorMessage(entry: ComfyUIHistoryResponse[string]): string | null {
  const failed = (entry.status?.messages ?? []).find(
    ([type]) => type === 'execution_error' || type === 'execution_interrupted'
  );
  if (!failed) return null;
  const payload = failed[1] as { exception_message?: string; exception_type?: string } | undefined;
  return payload?.exception_message ?? payload?.exception_type ?? 'ComfyUI reported an execution error';
}

export class GeneratorService {
  private rawConfigs: RawGeneratorWorkflowConfig[] | null = null;
  private templates = new Map<string, string>();
  // In-flight reconciles keyed by job id, so concurrent status polls share one download.
  private reconciling = new Map<string, Promise<Job | null>>();

  // Workflow definitions (name/description/inputs) with the internal `file` stripped.
  getWorkflowsConfig(): GeneratorWorkflowConfig[] {
    return this.loadRawConfigs().map(({ file: _file, ...config }) => config);
  }

  // Selection lookup used by the generation endpoints; carries the internal file name.
  getRawWorkflowConfig(name: string): RawGeneratorWorkflowConfig | null {
    return this.loadRawConfigs().find((config) => config.name === name) ?? null;
  }

  /**
   * Submit a generation request: verify the caller owns the target project, resolve
   * the workflow inputs (filling defaults, uploading `file` inputs to ComfyUI),
   * render the ComfyUI workflow template, queue it and persist the job. The created
   * job is anchored to the caller (userId) and their project (projectId) — status
   * queries later authorize against that userId.
   */
  async submitGeneration(params: {
    workflow: string;
    provided: Record<string, unknown>;
    jobType: GeneratorJobType;
    userId: string;
    projectId: string;
  }): Promise<GeneratorGenerationResult> {
    // Ownership gate: only the project's creator can queue generation jobs under
    // it. Foreign/unknown projects answer 404 (never 403) so their existence,
    // like the /api/projects endpoints, is not revealed.
    const project = await projectService.getProjectForUser(params.projectId, params.userId);
    if (!project) {
      throw AppError.notFound('Project not found');
    }

    const config = this.getRawWorkflowConfig(params.workflow);
    if (!config) {
      throw AppError.badRequest(`Unknown workflow: ${params.workflow}`, {
        field: 'workflow',
        message: `Available workflows: ${this.getWorkflowsConfig().map((c) => c.name).join(', ')}`,
      });
    }

    // `file` inputs accept a base64 data URI or a stored artifact name; both are
    // uploaded to ComfyUI and replaced with the uploaded file name. Normalize the
    // public payload aliases before resolving either file or regular inputs so the
    // supplied values are not replaced by workflow defaults.
    const provided = normalizeGeneratorInputs(config, params.provided);
    const fileValues = await this.resolveFileInputs(config, provided);
    const values = this.resolveInputs(config, { ...provided, ...fileValues });
    const payload = this.buildWorkflowPayload(config, values);

    // Our job id doubles as the ComfyUI client_id so both sides can be correlated.
    const jobId = uuidv4();
    let promptId: string;
    try {
      const promptResponse = await comfyuiService.queuePrompt(payload, jobId);
      promptId = promptResponse.prompt_id;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const details = (error as { response?: { data?: unknown } }).response?.data;
      throw AppError.serviceUnavailable(`ComfyUI request failed: ${message}`, details);
    }

    const job = await jobService.createGenerationJob({
      id: jobId,
      type: params.jobType,
      status: 'processing',
      input: { workflow: config.name, inputs: values },
      comfyuiPromptId: promptId,
      userId: params.userId,
      projectId: params.projectId,
    });

    return {
      jobId: job.id,
      projectId: params.projectId,
      workflow: config.name,
      status: 'processing',
      comfyuiPromptId: promptId,
    };
  }

  /**
   * Resolve `file` inputs (e.g. the I2V `image`) into ComfyUI input file names.
   * Accepted values: a base64 data URI (`data:image/png;base64,...`) or the name
   * of a stored artifact (e.g. a previous T2I result). Either way the bytes are
   * uploaded to ComfyUI's input directory — the name LoadImage nodes expect —
   * under a unique file name so concurrent jobs never overwrite each other.
   * Missing values are left alone so resolveInputs reports them as required.
   */
  private async resolveFileInputs(
    config: GeneratorWorkflowConfig,
    provided: Record<string, unknown>
  ): Promise<Record<string, string>> {
    const errors: InputValidationError[] = [];
    const prepared: Array<{ key: string; buffer: Buffer; filename: string }> = [];

    for (const [key, definition] of Object.entries(config.inputs)) {
      if (definition.type !== 'file') continue;
      const raw = provided[key];
      if (raw === undefined || raw === null || raw === '') continue;

      if (typeof raw !== 'string') {
        errors.push({
          field: key,
          message: 'Expected a base64 data URI (data:image/png;base64,...) or an artifact name',
        });
        continue;
      }

      if (raw.startsWith('data:')) {
        const match = DATA_URI_PATTERN.exec(raw);
        const mime = match?.[1].toLowerCase();
        const extension = mime ? DATA_URI_EXTENSIONS[mime] : undefined;
        if (!match) {
          errors.push({
            field: key,
            message: 'Expected a base64 image data URI like data:image/png;base64,...',
          });
          continue;
        }
        if (!extension) {
          errors.push({ field: key, message: `Unsupported image type: ${mime}` });
          continue;
        }
        const buffer = Buffer.from(match[2], 'base64');
        if (buffer.length === 0) {
          errors.push({ field: key, message: 'Image payload is empty or not valid base64' });
          continue;
        }
        prepared.push({ key, buffer, filename: `${uuidv4()}${extension}` });
        continue;
      }

      // Otherwise: the name of a stored artifact, which must be an image.
      const artifact = artifactService.resolve(raw);
      if (!artifact || !IMAGE_EXTENSIONS.has(extname(artifact.name).toLowerCase())) {
        errors.push({ field: key, message: `Unknown image artifact: ${raw}` });
        continue;
      }
      try {
        const buffer = await readFile(artifact.path);
        prepared.push({
          key,
          buffer,
          filename: `${uuidv4()}${extname(artifact.name).toLowerCase()}`,
        });
      } catch {
        errors.push({ field: key, message: `Unknown image artifact: ${raw}` });
      }
    }

    if (errors.length > 0) {
      throw AppError.badRequest(`Invalid file inputs for workflow ${config.name}`, errors);
    }

    const resolved: Record<string, string> = {};
    for (const entry of prepared) {
      try {
        // Upload to the input directory ROOT (no subfolder): LoadImage resolves
        // values against the input root and many builds only list top-level
        // files there, so a namespaced path would fail prompt validation.
        const uploaded = await comfyuiService.uploadImage(entry.buffer, entry.filename);
        resolved[entry.key] = uploaded.subfolder
          ? `${uploaded.subfolder}/${uploaded.name}`
          : uploaded.name;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        const details = (error as { response?: { data?: unknown } }).response?.data;
        throw AppError.serviceUnavailable(`ComfyUI image upload failed: ${message}`, details);
      }
    }
    return resolved;
  }

  /**
   * Refresh a generator job from ComfyUI (used by GET /api/jobs/:id/status):
   * - no prompt id, terminal status, or artifact already fetched -> unchanged
   * - still queued/running -> unchanged (the client keeps polling)
   * - completed -> download the artifact, record its name on the job, mark completed
   * - errored -> mark the job failed
   * Concurrent polls for the same job share a single in-flight reconcile.
   */
  async syncJobStatus(jobId: string): Promise<Job | null> {
    const inFlight = this.reconciling.get(jobId);
    if (inFlight) return inFlight;

    const promise = this.reconcileJob(jobId).finally(() => this.reconciling.delete(jobId));
    this.reconciling.set(jobId, promise);
    return promise;
  }

  private async reconcileJob(jobId: string): Promise<Job | null> {
    const job = await jobService.getJob(jobId);
    if (!job) return null;

    if (
      !job.comfyuiPromptId ||
      TERMINAL_JOB_STATUSES.includes(job.status) ||
      getJobArtifact(job) !== null
    ) {
      return job;
    }

    let entry: ComfyUIHistoryResponse[string] | undefined;
    try {
      const history = await comfyuiService.getHistory(job.comfyuiPromptId);
      entry = history[job.comfyuiPromptId];
    } catch (error) {
      // Transient ComfyUI hiccup: keep the job as-is so the next poll can retry.
      console.warn(
        `[generator] history poll failed for job ${jobId}:`,
        error instanceof Error ? error.message : error
      );
      return job;
    }

    // Absent from history means the prompt has not finished yet.
    if (!entry) return job;

    const errorMessage = executionErrorMessage(entry);
    if (errorMessage) {
      return (
        (await jobService.updateJobStatus(jobId, {
          jobId,
          progress: job.progress,
          status: 'failed',
          error: errorMessage,
        })) ?? job
      );
    }

    if (!entry.status?.completed) return job;

    const media = pickOutputMedia(entry, job.type);
    if (!media) {
      return (
        (await jobService.updateJobStatus(jobId, {
          jobId,
          progress: job.progress,
          status: 'failed',
          error: 'ComfyUI completed without a media output',
        })) ?? job
      );
    }

    const artifact = await this.persistArtifact(job.id, job.comfyuiPromptId, media);
    return (await jobService.setJobArtifact(job.id, artifact)) ?? job;
  }

  /** Download a finished prompt's media to {assetsPath}/<jobId>.<ext>. */
  private async persistArtifact(
    jobId: string,
    comfyuiPromptId: string,
    media: OutputMedia
  ): Promise<GeneratorArtifact> {
    const buffer = await comfyuiService.getImage(media.filename, media.subfolder, media.type);
    const extension = extname(media.filename) || DEFAULT_EXTENSION[media.kind];
    const name = `${jobId}${extension}`;

    const assetsDir = artifactService.directory();
    await mkdir(assetsDir, { recursive: true });

    // Artifacts are write-once and never deleted: an existing file is left untouched.
    // The write lands on a temp sibling first and is renamed into place, so a crash
    // can never leave a truncated artifact behind.
    const filePath = join(assetsDir, name);
    if (!existsSync(filePath)) {
      const tempPath = join(assetsDir, `.${name}.part`);
      await writeFile(tempPath, buffer);
      await rename(tempPath, filePath);
    }

    return {
      name,
      type: media.kind,
      mimeType: media.mimeType,
      comfyFilename: media.filename,
      comfyuiPromptId,
    };
  }

  // --- internals ---

  private loadRawConfigs(): RawGeneratorWorkflowConfig[] {
    if (!this.rawConfigs) {
      const content = readFileSync(resolveAssetPath(WORKFLOWS_CONFIG_FILE), 'utf-8');
      this.rawConfigs = JSON.parse(content) as RawGeneratorWorkflowConfig[];
    }
    return this.rawConfigs;
  }

  private getWorkflowTemplate(fileName: string): string {
    let template = this.templates.get(fileName);
    if (template === undefined) {
      template = readFileSync(resolveAssetPath(fileName), 'utf-8');
      this.templates.set(fileName, template);
    }
    return template;
  }

  /**
   * Validate normalized caller values against the workflow `inputs` definition and fill
   * missing entries with their configured default. Throws a 400 listing every problem
   * when an input is missing (and has no default) or carries the wrong type/value.
   */
  private resolveInputs(
    config: GeneratorWorkflowConfig,
    provided: Record<string, unknown>
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    const errors: InputValidationError[] = [];

    for (const [key, definition] of Object.entries(config.inputs)) {
      const providedValue = provided[key];
      const value =
        providedValue === undefined || providedValue === null || providedValue === ''
          ? definition.default
          : providedValue;

      if (value === undefined || value === null) {
        errors.push({ field: key, message: 'Missing required input and no default is defined' });
        continue;
      }

      const coerced = this.coerceInputValue(key, definition, value, errors);
      if (coerced !== undefined) values[key] = coerced;
    }

    if (errors.length > 0) {
      throw AppError.badRequest(`Invalid inputs for workflow ${config.name}`, errors);
    }
    return values;
  }

  private coerceInputValue(
    key: string,
    definition: GeneratorWorkflowInput,
    value: unknown,
    errors: InputValidationError[]
  ): unknown {
    switch (definition.type) {
      case 'integer':
      case 'float': {
        const parsed =
          typeof value === 'number'
            ? value
            : typeof value === 'string' && value.trim() !== ''
              ? Number(value)
              : NaN;
        if (!Number.isFinite(parsed)) {
          errors.push({
            field: key,
            message: definition.type === 'integer' ? 'Expected an integer' : 'Expected a number',
          });
          return undefined;
        }
        if (definition.type === 'integer' && !Number.isInteger(parsed)) {
          errors.push({ field: key, message: 'Expected an integer' });
          return undefined;
        }
        return parsed;
      }
      case 'boolean': {
        if (typeof value === 'boolean') return value;
        if (value === 'true') return true;
        if (value === 'false') return false;
        errors.push({ field: key, message: 'Expected a boolean' });
        return undefined;
      }
      default: {
        if (typeof value !== 'string') {
          errors.push({ field: key, message: 'Expected a string' });
          return undefined;
        }
        if (definition.acceptedValues && !definition.acceptedValues.includes(value)) {
          errors.push({
            field: key,
            message: `Expected one of: ${definition.acceptedValues.join(', ')}`,
          });
          return undefined;
        }
        return value;
      }
    }
  }

  /**
   * The workflow files are templates rather than valid JSON: numeric inputs appear as
   * bare `{width}` tokens and string inputs inside quotes as `"{prompt}"`. Substituting
   * with JSON.stringify keeps quoting/escaping correct for both shapes.
   */
  private buildWorkflowPayload(
    config: RawGeneratorWorkflowConfig,
    values: Record<string, unknown>
  ): ComfyUIWorkflow {
    let rendered = this.getWorkflowTemplate(config.file);
    for (const [key, value] of Object.entries(values)) {
      const jsonValue = JSON.stringify(value);
      if (jsonValue === undefined) continue;
      // Quoted placeholder first: replace including the quotes so the value's own
      // JSON escaping is what ends up in the payload.
      rendered = rendered.split(`"{${key}}"`).join(jsonValue);
      rendered = rendered.split(`{${key}}`).join(jsonValue);
    }
    try {
      return JSON.parse(rendered) as ComfyUIWorkflow;
    } catch {
      throw AppError.internal(`Failed to parse generated workflow payload for ${config.name}`);
    }
  }
}

export const generatorService = new GeneratorService();