import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import {
  Workflow,
  CreateWorkflowRequest,
  UpdateWorkflowRequest,
  WorkflowListResponse,
} from '../models';

export interface ComfyUISavedWorkflow {
  name: string;
  workflow: any; // ComfyUI workflow structure
  timestamp: number;
}

export interface ComfyUIWorkflowsResponse {
  success: boolean;
  data: ComfyUISavedWorkflow[];
}

@Injectable({
  providedIn: 'root',
})
export class WorkflowService {
  private endpoint = '/workflows';

  constructor(private api: ApiService) {}

  /** Create a new workflow */
  createWorkflow(request: CreateWorkflowRequest): Observable<Workflow> {
    return this.api.post<Workflow>(this.endpoint, request);
  }

  /** Get a list of all workflows */
  getWorkflows(params?: { isActive?: boolean }): Observable<WorkflowListResponse> {
    const queryParams: Record<string, string | number | boolean> = {};
    if (params?.['isActive'] !== undefined) queryParams['isActive'] = params['isActive'] as boolean;
    return this.api.get<WorkflowListResponse>(this.endpoint, { params: queryParams });
  }

  /** Get a single workflow by ID */
  getWorkflow(id: string): Observable<{ success: boolean; data: Workflow }> {
    return this.api.get<{ success: boolean; data: Workflow }>(`${this.endpoint}/${id}`);
  }

  /** Update a workflow */
  updateWorkflow(id: string, request: UpdateWorkflowRequest): Observable<{ success: boolean; data: Workflow }> {
    return this.api.patch<{ success: boolean; data: Workflow }>(`${this.endpoint}/${id}`, request);
  }

  /** Activate a workflow (make it available for use) */
  activateWorkflow(id: string): Observable<{ success: boolean; message: string }> {
    return this.api.post<{ success: boolean; message: string }>(`${this.endpoint}/${id}/activate`, {});
  }

  /** Deactivate a workflow */
  deactivateWorkflow(id: string): Observable<{ success: boolean; message: string }> {
    return this.api.post<{ success: boolean; message: string }>(`${this.endpoint}/${id}/deactivate`, {});
  }

  /** Delete a workflow */
  deleteWorkflow(id: string): Observable<{ success: boolean; message: string }> {
    return this.api.delete<{ success: boolean; message: string }>(`${this.endpoint}/${id}`);
  }

  /** Get saved workflows from ComfyUI */
  getComfyUISavedWorkflows(): Observable<ComfyUIWorkflowsResponse> {
    return this.api.get<ComfyUIWorkflowsResponse>(`${this.endpoint}/comfyui/saved`);
  }

  /** Get workflow history from ComfyUI */
  getComfyUIWorkflowHistory(): Observable<ComfyUIWorkflowsResponse> {
    return this.api.get<ComfyUIWorkflowsResponse>(`${this.endpoint}/comfyui/history`);
  }
}