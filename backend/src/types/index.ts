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

export * from './scriptframe.js';
