// Job Models
export interface Job {
  id: string;
  prompt: string;
  model?: string;
  duration?: number;
  fps?: number;
  resolution?: string;
  workflowId?: string;
  parameters?: Record<string, unknown>;
  status: JobStatus;
  progress: number;
  message?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  assets?: Asset[];
}

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface CreateJobRequest {
  prompt: string;
  model?: string;
  duration?: number;
  fps?: number;
  resolution?: string;
  workflowId?: string;
  parameters?: Record<string, unknown>;
}

export interface UpdateJobRequest {
  status?: JobStatus;
  progress?: number;
  message?: string;
  error?: string;
}

export interface JobListParams {
  status?: JobStatus;
  limit?: number;
  offset?: number;
}

export interface JobListResponse {
  success: boolean;
  data: Job[];
}

// Asset Models
export interface Asset {
  id: string;
  jobId: string;
  type: 'video' | 'image' | 'audio' | 'other';
  url: string;
  filename: string;
  size: number;
  mimeType: string;
  createdAt: string;
}

// Workflow Models (Database)
export interface Workflow {
  id: string;
  name: string;
  description?: string;
  definition: Record<string, unknown>;
  version: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkflowRequest {
  name: string;
  description?: string;
  definition: Record<string, unknown>;
}

export interface UpdateWorkflowRequest {
  name?: string;
  description?: string;
  definition?: Record<string, unknown>;
}

export interface WorkflowListResponse {
  success: boolean;
  data: Workflow[];
}

// ComfyUI Workflow Models (Node-based)
export interface ComfyUINode {
  id: string;
  type: string;
  title: string;
  position: { x: number; y: number };
  inputs: ComfyUINodeInput[];
  outputs: ComfyUINodeOutput[];
  properties: Record<string, unknown>;
  widgetValues?: Record<string, unknown>;
}

export interface ComfyUINodeInput {
  name: string;
  type: string;
  link?: number | null;
  linkedNodeId?: string | null;
  linkedOutputName?: string | null;
}

export interface ComfyUINodeOutput {
  name: string;
  type: string;
  links: number[];
}

export interface ComfyUILink {
  id: number;
  sourceNodeId: string;
  sourceOutputName: string;
  targetNodeId: string;
  targetInputName: string;
}

export interface ComfyUIWorkflow {
  nodes: ComfyUINode[];
  links: ComfyUILink[];
  groups?: ComfyUIGroup[];
  config?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  version: number;
}

export interface ComfyUIGroup {
  id: string;
  title: string;
  color?: string;
  fontSize?: number;
  boundingBox: [number, number, number, number];
}

export interface ComfyUINodeType {
  name: string;
  displayName: string;
  category: string;
  description?: string;
  inputs: ComfyUINodeSlot[];
  outputs: ComfyUINodeSlot[];
  properties?: ComfyUINodeProperty[];
  color?: string;
  bgcolor?: string;
}

export interface ComfyUINodeSlot {
  name: string;
  type: string;
  optional?: boolean;
}

export interface ComfyUINodeProperty {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'file' | 'folder';
  default?: unknown;
  options?: string[];
  tooltip?: string;
  min?: number;
  max?: number;
  step?: number;
}

// ComfyUI Object Info (from /object_info endpoint)
export interface ComfyUIObjectInfo {
  [nodeType: string]: {
    input: {
      required: Record<string, [string, unknown]>;
      optional: Record<string, [string, unknown]>;
    };
    output: [string, string][]; // Array of [name, type] tuples
    output_is_list: Record<string, boolean>;
    output_name: Record<string, string>;
    display_name?: string;
    category?: string;
    description?: string;
    python_module?: string;
    output_node?: boolean;
    has_intermediate_output?: boolean;
    output_tooltips?: string[];
    search_aliases?: string[];
    experimental?: boolean;
  };
}

// Health Models
export interface ServiceHealthCheck {
  service: 'omniroute' | 'comfyui';
  status: 'healthy' | 'unhealthy' | 'degraded';
  latency: number;
  error?: string;
  timestamp: number;
}

export interface HealthCheckResponse {
  success: boolean;
  data: ServiceHealthCheck[];
}

export interface HealthHistoryResponse {
  success: boolean;
  data: ServiceHealthCheck[];
}

export interface LatestHealthResponse {
  success: boolean;
  data: {
    omniroute: ServiceHealthCheck;
    comfyui: ServiceHealthCheck;
  };
}

// Service Models (Omniroute)
export interface OmnirouteGenerateRequest {
  prompt: string;
  model?: string;
  parameters?: Record<string, unknown>;
}

export interface OmnirouteGenerateResponse {
  success: boolean;
  data: {
    jobId: string;
    status: string;
  };
}

export interface OmnirouteStatusResponse {
  success: boolean;
  data: {
    jobId: string;
    status: string;
    progress?: number;
    result?: unknown;
    error?: string;
  };
}

export interface OmnirouteModelsResponse {
  success: boolean;
  data: string[];
}

// Service Models (ComfyUI)
export interface ComfyUIPromptRequest {
  prompt: Record<string, unknown>;
  clientId?: string;
}

export interface ComfyUIPromptResponse {
  success: boolean;
  data: {
    promptId: string;
    number: number;
  };
}

export interface ComfyUIHistoryResponse {
  success: boolean;
  data: Record<string, unknown>;
}

export interface ComfyUIQueueResponse {
  success: boolean;
  data: {
    queueRunning: unknown[];
    queuePending: unknown[];
  };
}

export interface ComfyUIStatsResponse {
  success: boolean;
  data: Record<string, unknown>;
}

export interface ComfyUIModelsResponse {
  success: boolean;
  data: {
    checkpoints: string[];
    loras: string[];
    embeddings: string[];
    controlnets: string[];
    upscaleModels: string[];
  };
}

export interface ComfyUIEmbeddingsResponse {
  success: boolean;
  data: string[];
}

// Generic API Response
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  details?: unknown;
}

// ComfyUI App Models
export interface ComfyUIAppPrimaryField {
  nodeId: string;
  inputName: string;
  label: string;
  aliasName?: string; // User-defined alias for LLM to reference this field
  type: 'string' | 'number' | 'boolean' | 'select' | 'file' | 'folder';
  defaultValue?: unknown;
  options?: string[];
  tooltip?: string;
  min?: number;
  max?: number;
  step?: number;
  required: boolean;
  order: number;
  isPrimary?: boolean; // Whether this field is marked as a primary input in the UI.
}

export interface ComfyUIApp {
  id: string;
  name: string;
  description?: string;
  workflowId: string;
  definition?: Record<string, unknown>;
  primaryFields: ComfyUIAppPrimaryField[];
  defaultValues: Record<string, unknown>;
  isActive: boolean;
  error?: string;
  createdAt: string;
  updatedAt: string;
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
  primaryValues: Record<string, unknown>;
}

export interface ComfyUIAppExecuteResponse {
  workflow: ComfyUIWorkflow;
  promptId: string;
}

export interface ComfyUIAppWorkflowInputs {
  primaryFields: ComfyUIAppPrimaryField[];
  allInputs: Record<string, { nodeId: string; inputName: string; defaultValue: unknown; isPrimary: boolean }>;
}

export interface ComfyUIAppListResponse {
  success: boolean;
  data: ComfyUIApp[];
}

export interface ComfyUIAppDetailResponse {
  success: boolean;
  data: ComfyUIApp;
}

export interface ComfyUIAppWorkflowInputsResponse {
  success: boolean;
  data: ComfyUIAppWorkflowInputs;
}

export interface ComfyUIAppExecuteResponseApi {
  success: boolean;
  data: ComfyUIAppExecuteResponse;
}

// LLM Provider Models
export type LLMProviderName = 'anthropic' | 'openai' | 'gemini' | 'opencode' | 'omniroute' | 'lmstudio' | 'ollama';

export interface LLMProviderConfig {
  name: LLMProviderName;
  displayName: string;
  defaultBaseUrl: string;
  modelsEndpoint: string;
  authType: 'bearer' | 'api-key' | 'none';
  supportsStreaming: boolean;
  requiresApiKey: boolean;
  apiKey?: string; // Present for saved providers that stored a key
}

export interface LLMProvider {
  id: string;
  name: LLMProviderName;
  displayName: string;
  baseUrl: string;
  apiKey?: string;
  config?: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
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

export interface LLMProviderListResponse {
  success: boolean;
  data: LLMProvider[];
}

export interface LLMProviderDetailResponse {
  success: boolean;
  data: LLMProvider;
}

export interface LLMProviderConfigsResponse {
  success: boolean;
  data: LLMProviderConfig[];
}

// LLM Model
export interface LLMModel {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsStreaming?: boolean;
  supportsFunctions?: boolean;
  supportsVision?: boolean;
}

// Fetch Models Request/Response
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

// LLM App Models
export interface LLMApp {
  id: string;
  name: string;
  description?: string;
  providerId: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt?: string;
  config?: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  provider?: LLMProvider; // Populated when joined
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

export interface LLMAppListResponse {
  success: boolean;
  data: LLMApp[];
}

export interface LLMAppDetailResponse {
  success: boolean;
  data: LLMApp;
}

// ScriptFrame Workflow Models
export type ScriptFrameNodeType = 'worker' | 'llm' | 'comfyui-stack' | 'comfyui-app';

export interface ScriptFrameNodeData {
  appId?: string;
  appName?: string;
  model?: string;
  prompt?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  // Worker node: LLM / ComfyUI-stack bindings (port-level configuration).
  llmAppId?: string;
  llmAppName?: string;
  comfyuiStackId?: string;
  comfyuiStackName?: string;
  // Whether the worker is allowed to produce NSFW / uncensored content.
  nsfw?: boolean;
  primaryValues?: Record<string, unknown>;
  // ComfyUI App node: reference to a specific ComfyUI app
  comfyuiAppId?: string;
  comfyuiAppName?: string;
  [key: string]: unknown;
}

export interface ScriptFrameNode {
  id: string;
  type: ScriptFrameNodeType;
  title: string;
  position: { x: number; y: number };
  inputs: ComfyUINodeInput[];
  outputs: ComfyUINodeOutput[];
  data?: ScriptFrameNodeData;
}

export interface ScriptFrameLink {
  id: number;
  sourceNodeId: string;
  sourceOutputName: string;
  targetNodeId: string;
  targetInputName: string;
}

export interface ScriptFrameWorkflow {
  id: string;
  name: string;
  description?: string;
  nodes: ScriptFrameNode[];
  links?: ScriptFrameLink[];
  nsfw?: boolean;
  // Maximum clip length for a single generated video (in seconds)
  maxClipLength?: number;
  // Maximum timeout for video generation regardless of ComfyUI app (in seconds)
  maxTimeout?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScriptFrameWorkflowCreateRequest {
  name: string;
  description?: string;
  nodes: ScriptFrameNode[];
  links?: ScriptFrameLink[];
  nsfw?: boolean;
  // Maximum clip length for a single generated video (in seconds)
  maxClipLength?: number;
  // Maximum timeout for video generation regardless of ComfyUI app (in seconds)
  maxTimeout?: number;
}

export interface ScriptFrameWorkflowUpdateRequest {
  name?: string;
  description?: string;
  nodes?: ScriptFrameNode[];
  links?: ScriptFrameLink[];
  nsfw?: boolean;
  // Maximum clip length for a single generated video (in seconds)
  maxClipLength?: number;
  // Maximum timeout for video generation regardless of ComfyUI app (in seconds)
  maxTimeout?: number;
}

export interface ScriptFrameWorkflowListResponse {
  success: boolean;
  data: ScriptFrameWorkflow[];
}

export interface ScriptFrameWorkflowDetailResponse {
  success: boolean;
  data: ScriptFrameWorkflow;
}

export interface ScriptFrameTestConnectionRequest {
  nodeId: string;
  type: 'llm' | 'comfyui-stack' | 'comfyui-app';
  appId?: string;
}

export interface ScriptFrameTestConnectionResponse {
  nodeId: string;
  type: 'llm' | 'comfyui-stack' | 'comfyui-app';
  status: 'healthy' | 'unhealthy';
  message: string;
  latency?: number;
}

export interface ScriptFrameTestConnectionApiResponse {
  success: boolean;
  data: ScriptFrameTestConnectionResponse;
}

export interface ScriptFrameTestAllConnectionsApiResponse {
  success: boolean;
  data: ScriptFrameTestConnectionResponse[];
}

// ComfyUI Stack: a named collection of ComfyUI apps a Worker node drives.
export interface ComfyUIStack {
  id: string;
  name: string;
  description?: string;
  baseUrl?: string;
  port?: number;
  isActive: boolean;
  appIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ComfyUIStackCreateRequest {
  name: string;
  description?: string;
  baseUrl?: string;
  port?: number;
  appIds?: string[];
}

export interface ComfyUIStackUpdateRequest {
  name?: string;
  description?: string;
  baseUrl?: string;
  port?: number;
  appIds?: string[];
  isActive?: boolean;
}

export interface ComfyUIStackListResponse {
  success: boolean;
  data: ComfyUIStack[];
}

export interface ComfyUIStackDetailResponse {
  success: boolean;
  data: ComfyUIStack;
}
