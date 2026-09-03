import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import {
  ComfyUIStack,
  ComfyUIStackCreateRequest,
  ComfyUIStackUpdateRequest,
  ComfyUIStackListResponse,
  ComfyUIStackDetailResponse,
} from '../models';

@Injectable({
  providedIn: 'root',
})
export class ComfyUIStackService {
  private endpoint = '/comfyui-stacks';

  constructor(private api: ApiService) {}

  /** Get all ComfyUI stacks */
  getStacks(params?: { isActive?: boolean; limit?: number; offset?: number }): Observable<ComfyUIStackListResponse> {
    const queryParams: Record<string, string | number | boolean> = {};
    if (params?.isActive !== undefined) queryParams['isActive'] = params.isActive;
    if (params?.limit !== undefined) queryParams['limit'] = params.limit;
    if (params?.offset !== undefined) queryParams['offset'] = params.offset;
    return this.api.get<ComfyUIStackListResponse>(this.endpoint, { params: queryParams });
  }

  /** Get a single ComfyUI stack by ID */
  getStack(stackId: string): Observable<ComfyUIStackDetailResponse> {
    return this.api.get<ComfyUIStackDetailResponse>(`${this.endpoint}/${stackId}`);
  }

  /** Create a new ComfyUI stack */
  createStack(request: ComfyUIStackCreateRequest): Observable<ComfyUIStackDetailResponse> {
    return this.api.postNoRetry<ComfyUIStackDetailResponse>(this.endpoint, request);
  }

  /** Update a ComfyUI stack */
  updateStack(stackId: string, request: ComfyUIStackUpdateRequest): Observable<ComfyUIStackDetailResponse> {
    return this.api.patch<ComfyUIStackDetailResponse>(`${this.endpoint}/${stackId}`, request);
  }

  /** Delete a ComfyUI stack */
  deleteStack(stackId: string): Observable<{ success: boolean; message: string }> {
    return this.api.delete<{ success: boolean; message: string }>(`${this.endpoint}/${stackId}`);
  }

  /** Test connectivity for a stack */
  testStack(stackId: string): Observable<{ success: boolean; data: { healthy: boolean; message: string; latency: number } }> {
    return this.api.get<{ success: boolean; data: { healthy: boolean; message: string; latency: number } }>(`${this.endpoint}/${stackId}/test`);
  }
}