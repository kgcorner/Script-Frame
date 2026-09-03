// ScriptFrame Workflow Types
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
  // ComfyUI App node: reference to a specific ComfyUI app
  comfyuiAppId?: string;
  comfyuiAppName?: string;
  // Whether the worker is allowed to produce NSFW / uncensored content.
  nsfw?: boolean;
  primaryValues?: Record<string, unknown>;
  [key: string]: unknown;
}

export type ScriptFrameNodeType = 'worker' | 'llm' | 'comfyui-stack' | 'comfyui-app';

export interface ScriptFrameNode {
  id: string;
  type: ScriptFrameNodeType;
  title: string;
  position: { x: number; y: number };
  inputs: Array<{ name: string; type: string; link?: number | null; linkedNodeId?: string | null; linkedOutputName?: string | null }>;
  outputs: Array<{ name: string; type: string; links: number[] }>;
  data?: ScriptFrameNodeData;
}

export interface ScriptFrameLink {
  id: number;
  sourceNodeId: string;
  sourceOutputName: string;
  targetNodeId: string;
  targetInputName: string;
}

export interface ScriptFrameWorkflowDefinition {
  nodes: ScriptFrameNode[];
  links: ScriptFrameLink[];
  version: number;
}

export interface ScriptFrameWorkflow {
  id: string;
  name: string;
  description?: string | null;
  nodes: ScriptFrameNode[];
  links?: ScriptFrameLink[];
  nsfw?: boolean;
  // Maximum clip length for a single generated video (in seconds)
  maxClipLength?: number | null;
  // Maximum timeout for video generation regardless of ComfyUI app (in seconds)
  maxTimeout?: number | null;
  createdAt: Date | number;
  updatedAt: Date | number;
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
  maxClipLength?: number | null;
  // Maximum timeout for video generation regardless of ComfyUI app (in seconds)
  maxTimeout?: number | null;
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

// ComfyUI stack: a named collection of ComfyUI apps that a Worker node can drive.
// The stack can point at a specific ComfyUI instance (baseUrl + port) or fall back
// to the globally configured ComfyUI service.
export interface ComfyUIStack {
  id: string;
  name: string;
  description?: string | null;
  baseUrl?: string | null;
  port?: number | null;
  isActive: boolean;
  appIds: string[];
  createdAt: Date | number;
  updatedAt: Date | number;
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
