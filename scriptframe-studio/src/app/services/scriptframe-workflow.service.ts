import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import {
  ScriptFrameWorkflow,
  ScriptFrameWorkflowCreateRequest,
  ScriptFrameWorkflowUpdateRequest,
  ScriptFrameWorkflowListResponse,
  ScriptFrameWorkflowDetailResponse,
  ScriptFrameTestConnectionRequest,
  ScriptFrameTestConnectionApiResponse,
  ScriptFrameTestAllConnectionsApiResponse,
} from '../models';

@Injectable({
  providedIn: 'root',
})
export class ScriptFrameWorkflowService {
  private endpoint = '/scriptframe-workflows';

  constructor(private api: ApiService) {}

  /** Create a new ScriptFrame workflow */
  createWorkflow(request: ScriptFrameWorkflowCreateRequest): Observable<ScriptFrameWorkflowDetailResponse> {
    return this.api.post<ScriptFrameWorkflowDetailResponse>(this.endpoint, request);
  }

  /** Get all ScriptFrame workflows */
  getWorkflows(params?: { limit?: number; offset?: number }): Observable<ScriptFrameWorkflowListResponse> {
    const queryParams: Record<string, string | number | boolean> = {};
    if (params?.limit !== undefined) queryParams['limit'] = params.limit;
    if (params?.offset !== undefined) queryParams['offset'] = params.offset;
    return this.api.get<ScriptFrameWorkflowListResponse>(this.endpoint, { params: queryParams });
  }

  /** Get a single ScriptFrame workflow by ID */
  getWorkflow(id: string): Observable<ScriptFrameWorkflowDetailResponse> {
    return this.api.get<ScriptFrameWorkflowDetailResponse>(`${this.endpoint}/${id}`);
  }

  /** Update a ScriptFrame workflow */
  updateWorkflow(id: string, request: ScriptFrameWorkflowUpdateRequest): Observable<ScriptFrameWorkflowDetailResponse> {
    return this.api.patch<ScriptFrameWorkflowDetailResponse>(`${this.endpoint}/${id}`, request);
  }

  /** Delete a ScriptFrame workflow */
  deleteWorkflow(id: string): Observable<{ success: boolean; message: string }> {
    return this.api.delete<{ success: boolean; message: string }>(`${this.endpoint}/${id}`);
  }

  /** Test connection for a single node */
  testConnection(request: ScriptFrameTestConnectionRequest): Observable<ScriptFrameTestConnectionApiResponse> {
    return this.api.post<ScriptFrameTestConnectionApiResponse>(`${this.endpoint}/test-connection`, request);
  }

  /** Test connections for multiple nodes */
  testAllConnections(targets: ScriptFrameTestConnectionRequest[]): Observable<ScriptFrameTestAllConnectionsApiResponse> {
    return this.api.post<ScriptFrameTestAllConnectionsApiResponse>(`${this.endpoint}/test-connections`, { targets });
  }
}
