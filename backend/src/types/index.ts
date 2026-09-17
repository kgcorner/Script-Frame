export interface OmnirouteGenerateRequest {
  prompt: string;
  model?: string;
  parameters?: Record<string, unknown>;
  workflowId?: string;
}

export interface OmnirouteGenerateResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
}

export interface OmnirouteStatusResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  result?: unknown;
  error?: string;
}

export interface ComfyUIWorkflow {
  [nodeId: string]: {
    class_type: string;
    inputs: Record<string, unknown>;
    _meta?: {
      title?: string;
    };
  };
}

export interface ComfyUIPromptRequest {
  prompt: ComfyUIWorkflow;
  client_id?: string;
  extra_data?: Record<string, unknown>;
}

export interface ComfyUIPromptResponse {
  prompt_id: string;
  number: number;
  node_errors: Record<string, unknown>;
}

export interface ComfyUIHistoryResponse {
  [promptId: string]: {
    prompt: ComfyUIWorkflow;
    outputs: Record<string, {
      images?: Array<{
        filename: string;
        subfolder: string;
        type: string;
      }>;
      videos?: Array<{
        filename: string;
        subfolder: string;
        type: string;
      }>;
      audios?: Array<{
        filename: string;
        subfolder: string;
        type: string;
      }>;
    }>;
    status: {
      status_str: string;
      completed: boolean;
      messages: Array<[string, unknown]>;
    };
  };
}

export interface ComfyUIQueueStatus {
  queue_running: Array<[string, ComfyUIWorkflow]>;
  queue_pending: Array<[string, ComfyUIWorkflow]>;
}

export interface ComfyUISystemStats {
  system: {
    ram_total: number;
    ram_free: number;
    comfyui_version: string;
  };
  devices: Array<{
    name: string;
    type: string;
    vram_total: number;
    vram_free: number;
  }>;
}

// ComfyUI App types
export interface ComfyUIAppPrimaryField {
  nodeId: string;
  inputName: string;
  label: string;
  aliasName?: string; // User-defined alias for LLM to reference this field
  type: 'string' | 'number' | 'boolean' | 'select' | 'file' | 'folder';
  defaultValue?: unknown;
  options?: string[]; // for select type
  tooltip?: string;
  min?: number;
  max?: number;
  step?: number;
  required: boolean;
  order: number;
}

export interface ComfyUIAppCreateRequest {
  name: string;
  description?: string;
  workflowId: string;
  // Optional embedded workflow definition. When provided, the app is created even if
  // `workflowId` doesn't reference an existing `workflows` row (workflow-input route).
  workflowDefinition?: Record<string, unknown>;
  primaryFields: ComfyUIAppPrimaryField[];
  defaultValues?: Record<string, unknown>;
}

export interface ComfyUIAppUpdateRequest {
  name?: string;
  description?: string;
  primaryFields?: ComfyUIAppPrimaryField[];
  defaultValues?: Record<string, unknown>;
  isActive?: boolean;
}

export interface ComfyUIAppExecuteRequest {
  primaryValues: Record<string, unknown>; // key: "nodeId:inputName", value: user input
}

export interface VideoGenerationJobInput {
  prompt: string;
  model?: string;
  duration?: number;
  fps?: number;
  resolution?: string;
  workflowId?: string;
  parameters?: Record<string, unknown>;
}

export interface VideoGenerationJobOutput {
  videoUrl?: string;
  thumbnailUrl?: string;
  duration?: number;
  resolution?: string;
  fps?: number;
  metadata?: Record<string, unknown>;
}

export interface JobProgressUpdate {
  jobId: string;
  progress: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  message?: string;
  error?: string;
}

export interface ServiceHealthCheck {
  service: 'omniroute' | 'comfyui';
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency: number;
  error?: string;
  timestamp: number;
}

// Re-export database types
import type { LLMProvider, LLMApp } from '../db/schema.ts';
export type { Job, NewJob, Asset, NewAsset, Workflow, NewWorkflow, ServiceHealth, NewServiceHealth, ComfyUIApp, NewComfyUIApp, LLMProvider, NewLLMProvider, LLMApp, NewLLMApp, NewComfyUIStack, ComfyUIStackApp, NewComfyUIStackApp } from '../db/schema.ts';

// LLM Provider Types
export type LLMProviderName = 'anthropic' | 'openai' | 'gemini' | 'opencode' | 'omniroute' | 'lmstudio' | 'ollama';

export interface LLMProviderConfig {
  name: LLMProviderName;
  displayName: string;
  defaultBaseUrl: string;
  modelsEndpoint: string;
  authType: 'bearer' | 'api-key' | 'none';
  supportsStreaming: boolean;
  requiresApiKey: boolean;
}

export interface LLMModel {
  id: string;
  name: string;
  description?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsVision?: boolean;
  supportsFunctions?: boolean;
}

export interface FetchModelsRequest {
  provider: LLMProviderName;
  baseUrl: string;
  apiKey?: string;
}

export interface FetchModelsResponse {
  success: boolean;
  data?: LLMModel[];
  error?: string;
}

export interface LLMProviderCreateRequest {
  name: LLMProviderName;
  displayName: string;
  baseUrl: string;
  apiKey?: string;
  config?: Record<string, unknown>;
}

export interface LLMProviderUpdateRequest {
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
  config?: Record<string, unknown>;
  isActive?: boolean;
}

export interface LLMAppCreateRequest {
  name: string;
  description?: string;
  providerId: string;
  endpoint?: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  config?: Record<string, unknown>;
}

export interface LLMAppUpdateRequest {
  name?: string;
  description?: string;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  config?: Record<string, unknown>;
  isActive?: boolean;
}

export interface LLMProviderListResponse {
  success: boolean;
  data: LLMProvider[];
}

export interface LLMProviderDetailResponse {
  success: boolean;
  data: LLMProvider;
}

export interface LLMAppListResponse {
  success: boolean;
  data: LLMApp[];
}

export interface LLMAppDetailResponse {
  success: boolean;
  data: LLMApp;
}

// Generator types (workflows-cfg.json driven I2V/T2V/T2I endpoints)
export type GeneratorWorkflowInputType = 'string' | 'integer' | 'float' | 'boolean' | 'file' | 'folder';

export interface GeneratorWorkflowInput {
  name: string;
  type: GeneratorWorkflowInputType;
  default?: unknown;
  acceptedValues?: string[];
}

// Client-facing workflow configuration: the raw asset also carries a `file` name,
// which is a server-side wiring detail and is never exposed.
export interface GeneratorWorkflowConfig {
  name: string;
  description: string;
  inputs: Record<string, GeneratorWorkflowInput>;
}

// Payload accepted by the generator endpoints: `workflow` selects the config entry,
// `projectId` scopes the created job to one of the CALLER's projects (404 otherwise),
// every other key is an input defined by that workflow's `inputs`.
export interface GeneratorGenerationRequest {
  projectId: string;
  workflow: string;
  [input: string]: unknown;
}

export type GeneratorJobType = 'video' | 'image';

export interface GeneratorGenerationResult {
  jobId: string;
  projectId: string;
  workflow: string;
  status: 'processing';
  comfyuiPromptId: string;
}

// Artifact produced by a ComfyUI prompt, persisted on the job's `output` JSON.
export interface GeneratorArtifact {
  name: string; // <jobId>.<ext>
  type: 'image' | 'video' | 'audio';
  mimeType: string;
  // ComfyUI provenance (absent for export artifacts, which are stitched locally).
  comfyFilename?: string;
  comfyuiPromptId?: string;
}

export interface GeneratorJobStatusResult {
  jobId: string;
  // Owner + project scope. `userId` is the authorization anchor: only the owning
  // user can query this status (404 for anyone else). Both are null on legacy jobs.
  userId: string | null;
  projectId: string | null;
  status: 'not_started' | 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  comfyuiPromptId: string | null;
  error: string | null;
  // `url` is the client-facing link (/artifact/<name>) served by a later endpoint.
  artifact: (GeneratorArtifact & { url: string }) | null;
}

// Authentication & authorization (services/auth.ts, middleware/auth.ts).
export type UserRole = 'admin' | 'user';

// User as exposed by every endpoint: the password hash never leaves the service layer.
export interface SafeUser {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// JWT claims (HS256). `sub` is the user id.
export interface AuthTokenPayload {
  sub: string;
  email: string;
  username: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface AuthResponse {
  user: SafeUser;
  token: string;
}

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
}

// Login accepts a single `identifier` (email or username) or explicit fields.
export interface LoginRequest {
  identifier?: string;
  email?: string;
  username?: string;
  password: string;
}

export interface CreateUserRequest {
  email: string;
  username: string;
  password: string;
  role?: UserRole;
  isActive?: boolean;
}

// PATCH /api/users/:id — admin-only fields are rejected for non-admin callers.
export interface UpdateUserRequest {
  email?: string;
  username?: string;
  password?: string;
  currentPassword?: string;
  role?: UserRole;
  isActive?: boolean;
}

export interface UserListFilters {
  search?: string;
  role?: UserRole;
  isActive?: boolean;
  limit: number;
  offset: number;
}

// Result of one service reachability probe (GET /api/health/connection).
export interface ServiceConnectionCheck {
  service: 'omniroute' | 'comfyui';
  // Human-facing role of the dependency: the LLM runtime and the render backend.
  label: 'LLM' | 'ComfyUI';
  // Base URL the probe was sent to (resolved from config).
  endpoint: string;
  // True when the server answered HTTP at all (any status code) — i.e. the
  // service is reachable. A reachable-but-unhealthy service (e.g. an LLM router
  // without a /health route, probe answered 404) is still `connected: true`
  // with `status: 'unhealthy'` and `error` explaining the probe result.
  connected: boolean;
  status: 'healthy' | 'unhealthy';
  latency: number;
  error: string | null;
  // ComfyUI only: the reported comfyui_version when reachable, else null.
  version?: string | null;
}

// Aggregate response of GET /api/health/connection.
export interface ServiceConnectionStatus {
  llm: ServiceConnectionCheck;
  comfyui: ServiceConnectionCheck;
  allConnected: boolean;
  checkedAt: string;
}

// Project as exposed by every endpoint (DB row with ISO date strings).
export interface SafeProject {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  aspectRatio: string;
  modelPreset: string;
  status: 'active' | 'draft' | 'completed';
  thumbnailUrl: string | null;
  sceneCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectRequest {
  name: string;
  description?: string | null;
  aspectRatio?: string;
  modelPreset?: string;
  status?: 'active' | 'draft' | 'completed';
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string | null;
  aspectRatio?: string;
  modelPreset?: string;
  status?: 'active' | 'draft' | 'completed';
  thumbnailUrl?: string;
  sceneCount?: number;
}

export interface ProjectListFilters {
  search?: string;
  limit: number;
  offset: number;
}

export * from './scriptframe.js';
