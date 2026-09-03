import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import {
  ComfyUIPromptRequest,
  ComfyUIPromptResponse,
  ComfyUIHistoryResponse,
  ComfyUIQueueResponse,
  ComfyUIStatsResponse,
  ComfyUIModelsResponse,
  ComfyUIEmbeddingsResponse,
  ComfyUIObjectInfo,
  ComfyUINodeType,
} from '../models';

@Injectable({
  providedIn: 'root',
})
export class ComfyUIService {
  private endpoint = '/services/comfyui';

  constructor(private api: ApiService) {}

  /** Queue a prompt for execution in ComfyUI */
  queuePrompt(request: ComfyUIPromptRequest): Observable<ComfyUIPromptResponse> {
    return this.api.post<ComfyUIPromptResponse>(`${this.endpoint}/prompt`, request);
  }

  /** Get execution history for a prompt */
  getHistory(promptId: string): Observable<ComfyUIHistoryResponse> {
    return this.api.get<ComfyUIHistoryResponse>(`${this.endpoint}/history/${promptId}`);
  }

  /** Get current queue status */
  getQueue(): Observable<ComfyUIQueueResponse> {
    return this.api.get<ComfyUIQueueResponse>(`${this.endpoint}/queue`);
  }

  /** Get system stats */
  getStats(): Observable<ComfyUIStatsResponse> {
    return this.api.get<ComfyUIStatsResponse>(`${this.endpoint}/stats`);
  }

  /** Interrupt currently running execution */
  interrupt(): Observable<{ success: boolean; message: string }> {
    return this.api.post<{ success: boolean; message: string }>(`${this.endpoint}/interrupt`, {});
  }

  /** Free memory (unload models) */
  freeMemory(): Observable<{ success: boolean; message: string }> {
    return this.api.post<{ success: boolean; message: string }>(`${this.endpoint}/free`, {});
  }

  /** Get available models */
  getModels(): Observable<ComfyUIModelsResponse> {
    return this.api.get<ComfyUIModelsResponse>(`${this.endpoint}/models`);
  }

  /** Get available embeddings */
  getEmbeddings(): Observable<ComfyUIEmbeddingsResponse> {
    return this.api.get<ComfyUIEmbeddingsResponse>(`${this.endpoint}/embeddings`);
  }

  /** Get object info (node types with inputs/outputs) */
  getObjectInfo(): Observable<ComfyUIObjectInfo> {
    return this.api.get<ComfyUIObjectInfo>(`${this.endpoint}/object_info`);
  }

  /** Get node types formatted for the UI */
  getNodeTypes(): Observable<ComfyUINodeType[]> {
    return new Observable(observer => {
      this.getObjectInfo().subscribe({
        next: (objectInfo) => {
          const nodeTypes: ComfyUINodeType[] = Object.entries(objectInfo).map(([name, info]) => {
            const input = info.input || { required: {}, optional: {} };
            const output = info.output || [];
            
            return {
              name,
              displayName: info.display_name || name,
              category: info.category || 'general',
              inputs: Object.entries(input.required || {}).map(([slotName, [type]]) => ({
                name: slotName,
                type,
                optional: false,
              })).concat(
                Object.entries(input.optional || {}).map(([slotName, [type]]) => ({
                  name: slotName,
                  type,
                  optional: true,
                }))
              ),
              outputs: Array.isArray(output) 
                ? output.map(([slotName, type]) => ({ name: slotName, type }))
                : [],
              color: this.getCategoryColor(info.category || 'general'),
              bgcolor: this.getCategoryBgColor(info.category || 'general'),
            };
          });
          observer.next(nodeTypes);
          observer.complete();
        },
        error: (err) => observer.error(err),
      });
    });
  }

  private getCategoryColor(category: string): string {
    const colors: Record<string, string> = {
      'general': '#888',
      'conditioning': '#f96',
      'sampling': '#9c6',
      'latent': '#6cf',
      'image': '#c6f',
      'video': '#fc6',
      'audio': '#6fc',
      'text': '#f6c',
      'controlnet': '#f66',
      'upscale': '#6f6',
    };
    return colors[category.toLowerCase()] || '#888';
  }

  private getCategoryBgColor(category: string): string {
    const colors: Record<string, string> = {
      'general': '#2a2a2a',
      'conditioning': '#3a2a1a',
      'sampling': '#2a3a1a',
      'latent': '#1a2a3a',
      'image': '#2a1a3a',
      'video': '#3a2a1a',
      'audio': '#1a3a2a',
      'text': '#3a1a2a',
      'controlnet': '#3a1a1a',
      'upscale': '#1a3a1a',
    };
    return colors[category.toLowerCase()] || '#2a2a2a';
  }
}
