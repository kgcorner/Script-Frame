import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import {
  ComfyUIApp,
  ComfyUIAppCreateRequest,
  ComfyUIAppUpdateRequest,
  ComfyUIAppExecuteRequest,
  ComfyUIAppExecuteResponse,
  ComfyUIAppWorkflowInputs,
  ComfyUIAppListResponse,
  ComfyUIAppDetailResponse,
  ComfyUIAppWorkflowInputsResponse,
  ComfyUIAppExecuteResponseApi,
} from '../models';

@Injectable({
  providedIn: 'root',
})
export class ComfyUIAppService {
  private endpoint = '/comfyui-apps';

  constructor(private api: ApiService) {}

  /** Get all ComfyUI Apps */
  getApps(params?: { isActive?: boolean; workflowId?: string; limit?: number; offset?: number }): Observable<ComfyUIAppListResponse> {
    const queryParams: Record<string, string | number | boolean> = {};
    if (params?.['isActive'] !== undefined) queryParams['isActive'] = params['isActive'] as boolean;
    if (params?.['workflowId']) queryParams['workflowId'] = params['workflowId'] as string;
    if (params?.['limit']) queryParams['limit'] = params['limit'] as number;
    if (params?.['offset']) queryParams['offset'] = params['offset'] as number;

    return this.api.get<ComfyUIAppListResponse>(this.endpoint, { params: queryParams });
  }

  /** Get a single ComfyUI App by ID */
  getApp(appId: string): Observable<ComfyUIAppDetailResponse> {
    return this.api.get<ComfyUIAppDetailResponse>(`${this.endpoint}/${appId}`);
  }

  /** Create a new ComfyUI App */
  createApp(request: ComfyUIAppCreateRequest): Observable<ComfyUIAppDetailResponse> {
    return this.api.postNoRetry<ComfyUIAppDetailResponse>(this.endpoint, request);
  }

  /** Update a ComfyUI App */
  updateApp(appId: string, request: ComfyUIAppUpdateRequest): Observable<ComfyUIAppDetailResponse> {
    return this.api.patch<ComfyUIAppDetailResponse>(`${this.endpoint}/${appId}`, request);
  }

  /** Delete a ComfyUI App */
  deleteApp(appId: string): Observable<{ success: boolean; message: string }> {
    return this.api.delete<{ success: boolean; message: string }>(`${this.endpoint}/${appId}`);
  }

  /** Get workflow inputs for an app (for UI preview) */
  getAppWorkflowInputs(appId: string): Observable<ComfyUIAppWorkflowInputsResponse> {
    return this.api.get<ComfyUIAppWorkflowInputsResponse>(`${this.endpoint}/${appId}/inputs`);
  }

  /** Execute a ComfyUI App with primary values */
  executeApp(appId: string, request: ComfyUIAppExecuteRequest): Observable<ComfyUIAppExecuteResponseApi> {
    return this.api.post<ComfyUIAppExecuteResponseApi>(`${this.endpoint}/${appId}/execute`, request);
  }
}