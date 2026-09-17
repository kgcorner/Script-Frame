import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '../config/index.js';
import type { ComfyUIWorkflow, ComfyUIPromptRequest, ComfyUIPromptResponse, ComfyUIHistoryResponse, ComfyUIQueueStatus, ComfyUISystemStats } from '../types/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ComfyUISavedWorkflow {
  name: string;
  workflow: ComfyUIWorkflow;
  timestamp: number;
}

export class ComfyUIService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.comfyui.baseUrl,
      timeout: config.comfyui.timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        console.error(`ComfyUI API Error: ${error.message}`);
        throw error;
      }
    );
  }

  async queuePrompt(workflow: ComfyUIWorkflow, clientId?: string): Promise<ComfyUIPromptResponse> {
    const request: ComfyUIPromptRequest = {
      prompt: workflow,
      client_id: clientId,
    };
    const response = await this.client.post<ComfyUIPromptResponse>('/prompt', request);
    return response.data;
  }

  async getHistory(promptId: string): Promise<ComfyUIHistoryResponse> {
    const response = await this.client.get<ComfyUIHistoryResponse>(`/history/${promptId}`);
    return response.data;
  }

  async getQueueStatus(): Promise<ComfyUIQueueStatus> {
    const response = await this.client.get<ComfyUIQueueStatus>('/queue');
    return response.data;
  }

  async getSystemStats(): Promise<ComfyUISystemStats> {
    const response = await this.client.get<ComfyUISystemStats>('/system_stats');
    return response.data;
  }

  async interrupt(): Promise<void> {
    await this.client.post('/interrupt');
  }

  async freeMemory(unloadModels?: boolean): Promise<void> {
    await this.client.post('/free', { unload_models: unloadModels ?? true });
  }

  async getEmbeddings(): Promise<string[]> {
    try {
      const response = await this.client.get<string[]>('/embeddings');
      return response.data;
    } catch {
      return [];
    }
  }

  async getModels(): Promise<Record<string, string[]>> {
    try {
      const response = await this.client.get<Record<string, string[]>>('/object_info');
      return response.data;
    } catch {
      return {};
    }
  }

  async getObjectInfo(): Promise<Record<string, any>> {
    try {
      const response = await this.client.get<Record<string, any>>('/object_info');
      return response.data;
    } catch {
      return {};
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get('/system_stats', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  // Reachability probe for GET /api/health/connection: distinguishes "server
  // unreachable" from "reachable but the probe failed", and surfaces the
  // ComfyUI version when /system_stats answers 2xx.
  async connectionCheck(): Promise<{ connected: boolean; healthy: boolean; error?: string; version?: string | null }> {
    try {
      const response = await this.client.get<ComfyUISystemStats>('/system_stats', { timeout: 5000 });
      return { connected: true, healthy: true, version: response.data?.system?.comfyui_version ?? null };
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        return {
          connected: true,
          healthy: false,
          error: `Probe /system_stats returned HTTP ${axiosError.response.status} (service reachable)`,
        };
      }
      const reason = axiosError.code ? `${axiosError.message} (${axiosError.code})` : axiosError.message;
      return { connected: false, healthy: false, error: reason || 'Unknown error' };
    }
  }

  async uploadImage(imageBuffer: Buffer, filename: string, subfolder?: string): Promise<{ name: string; subfolder: string; type: string }> {
    const formData = new FormData();
    const uint8Array = new Uint8Array(imageBuffer);
    const blob = new Blob([uint8Array]);
    formData.append('image', blob, filename);
    if (subfolder) {
      formData.append('subfolder', subfolder);
    }
    formData.append('overwrite', 'true');

    const response = await this.client.post<{ name: string; subfolder: string; type: string }>('/upload/image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  }

  async getImage(filename: string, subfolder?: string, type: 'input' | 'output' | 'temp' = 'output'): Promise<Buffer> {
    const params = new URLSearchParams({ filename });
    if (subfolder) params.append('subfolder', subfolder);
    params.append('type', type);

    const response = await this.client.get<Buffer>(`/view?${params.toString()}`, {
      responseType: 'arraybuffer',
    });
    return response.data;
  }

  /**
   * Get saved workflows from ComfyUI user directory
   * ComfyUI stores workflows as JSON files in user/default/workflows/
   */
  async getSavedWorkflows(): Promise<ComfyUISavedWorkflow[]> {
    try {
      // Try to get workflows from the user directory via the API
      // First try the user/workflows endpoint
      const response = await this.client.get<Record<string, any>>('/api/user/workflows');
      if (response.data && typeof response.data === 'object') {
        const workflows: ComfyUISavedWorkflow[] = [];
        for (const [name, workflow] of Object.entries(response.data)) {
          workflows.push({
            name: name.replace('.json', ''),
            workflow: workflow as ComfyUIWorkflow,
            timestamp: Date.now(),
          });
        }
        return workflows;
      }
    } catch (error) {
      console.log('Could not fetch workflows from /api/user/workflows, trying alternative...');
    }

    // Fallback: Try to read from the filesystem if running locally
    try {
      const workflowsDir = config.comfyui.userWorkflowsPath;
      const files = await fs.readdir(workflowsDir);
      const workflows: ComfyUISavedWorkflow[] = [];
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(workflowsDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          try {
            const workflow = JSON.parse(content) as ComfyUIWorkflow;
            workflows.push({
              name: file.replace('.json', ''),
              workflow,
              timestamp: Date.now(),
            });
          } catch {
            console.warn(`Failed to parse workflow file: ${file}`);
          }
        }
      }
      return workflows;
    } catch {
      // Directory doesn't exist or not accessible
      return [];
    }
  }

  /**
   * Get workflow history from ComfyUI - these are executed workflows
   */
  async getWorkflowHistory(): Promise<ComfyUISavedWorkflow[]> {
    try {
      const history = await this.client.get<Record<string, any>>('/history');
      const workflows: ComfyUISavedWorkflow[] = [];
      
      for (const [promptId, entry] of Object.entries(history.data)) {
        if (entry.prompt && entry.prompt[2]) {
          const workflow = entry.prompt[2] as ComfyUIWorkflow;
          workflows.push({
            name: `History ${promptId.slice(0, 8)}`,
            workflow,
            timestamp: entry.prompt[1] ? new Date(entry.prompt[1] * 1000).getTime() : Date.now(),
          });
        }
      }
      return workflows;
    } catch {
      return [];
    }
  }
  /**
   * Download every output artifact (videos + images) produced by a completed
   * ComfyUI prompt into `destDir`. Returns the local paths grouped by media type.
   * Used by the VGWorker to fetch clip media into local storage before stitching.
   */
  async fetchPromptOutputs(promptId: string, destDir: string): Promise<{ videos: string[]; images: string[] }> {
    const history = await this.getHistory(promptId);
    const entry = history[promptId];
    if (!entry) throw new Error(`No ComfyUI history entry for prompt ${promptId}`);

    await fs.mkdir(destDir, { recursive: true });
    const videos: string[] = [];
    const images: string[] = [];

    for (const nodeOutput of Object.values(entry.outputs)) {
      for (const v of nodeOutput.videos ?? []) {
        const buf = await this.getImage(v.filename, v.subfolder, v.type as 'input' | 'output' | 'temp');
        const localPath = path.join(destDir, v.filename);
        await fs.writeFile(localPath, buf);
        videos.push(localPath);
      }
      for (const img of nodeOutput.images ?? []) {
        const buf = await this.getImage(img.filename, img.subfolder, img.type as 'input' | 'output' | 'temp');
        const localPath = path.join(destDir, img.filename);
        await fs.writeFile(localPath, buf);
        images.push(localPath);
      }
    }
    return { videos, images };
  }

  /** Convenience: resolve all output filenames/paths for a prompt without downloading. */
  async getPromptOutputs(promptId: string): Promise<{ videos: string[]; images: string[] }> {
    const history = await this.getHistory(promptId);
    const entry = history[promptId];
    if (!entry) throw new Error(`No ComfyUI history entry for prompt ${promptId}`);
    const videos: string[] = [];
    const images: string[] = [];
    for (const nodeOutput of Object.values(entry.outputs)) {
      for (const v of nodeOutput.videos ?? []) videos.push(v.filename);
      for (const img of nodeOutput.images ?? []) images.push(img.filename);
    }
    return { videos, images };
  }
}

export const comfyuiService = new ComfyUIService();