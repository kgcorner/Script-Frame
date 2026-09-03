import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import {
  LLMProvider,
  LLMProviderCreateRequest,
  LLMProviderUpdateRequest,
  LLMProviderConfig,
  LLMProviderName,
  FetchModelsRequest,
  FetchModelsResponse,
  LLMProviderListResponse,
  LLMProviderDetailResponse,
  LLMProviderConfigsResponse,
  LLMApp,
  LLMAppCreateRequest,
  LLMAppUpdateRequest,
  LLMAppListResponse,
  LLMAppDetailResponse,
} from '../models';

@Injectable({
  providedIn: 'root',
})
export class LLMProviderService {
  private endpoint = '/llm-providers';

  constructor(private api: ApiService) {}

  /** Get all provider configurations (for dropdown) */
  getProviderConfigs(): Observable<LLMProviderConfigsResponse> {
    return this.api.get<LLMProviderConfigsResponse>(`${this.endpoint}/configs`);
  }

  /** Fetch models from a provider */
  fetchModels(request: FetchModelsRequest): Observable<FetchModelsResponse> {
    return this.api.post<FetchModelsResponse>(`${this.endpoint}/fetch-models`, request);
  }

  // Provider CRUD
  /** Get all LLM Providers */
  getProviders(params?: { isActive?: boolean; name?: LLMProviderName; limit?: number; offset?: number }): Observable<LLMProviderListResponse> {
    const queryParams: Record<string, string | number | boolean> = {};
    if (params?.['isActive'] !== undefined) queryParams['isActive'] = params['isActive'] as boolean;
    if (params?.['name']) queryParams['name'] = params['name'] as string;
    if (params?.['limit']) queryParams['limit'] = params['limit'] as number;
    if (params?.['offset']) queryParams['offset'] = params['offset'] as number;

    return this.api.get<LLMProviderListResponse>(this.endpoint, { params: queryParams });
  }

  /** Get a single LLM Provider by ID */
  getProvider(providerId: string): Observable<LLMProviderDetailResponse> {
    return this.api.get<LLMProviderDetailResponse>(`${this.endpoint}/${providerId}`);
  }

  /** Create a new LLM Provider */
  createProvider(request: LLMProviderCreateRequest): Observable<LLMProviderDetailResponse> {
    return this.api.post<LLMProviderDetailResponse>(this.endpoint, request);
  }

  /** Update an LLM Provider */
  updateProvider(providerId: string, request: LLMProviderUpdateRequest): Observable<LLMProviderDetailResponse> {
    return this.api.patch<LLMProviderDetailResponse>(`${this.endpoint}/${providerId}`, request);
  }

  /** Delete an LLM Provider */
  deleteProvider(providerId: string): Observable<{ success: boolean; message: string }> {
    return this.api.delete<{ success: boolean; message: string }>(`${this.endpoint}/${providerId}`);
  }

  // LLM App CRUD
  /** Get all LLM Apps */
  getApps(params?: { isActive?: boolean; providerId?: string; limit?: number; offset?: number }): Observable<LLMAppListResponse> {
    const queryParams: Record<string, string | number | boolean> = {};
    if (params?.['isActive'] !== undefined) queryParams['isActive'] = params['isActive'] as boolean;
    if (params?.['providerId']) queryParams['providerId'] = params['providerId'] as string;
    if (params?.['limit']) queryParams['limit'] = params['limit'] as number;
    if (params?.['offset']) queryParams['offset'] = params['offset'] as number;

    return this.api.get<LLMAppListResponse>(`${this.endpoint}/apps`, { params: queryParams });
  }

  /** Get a single LLM App by ID */
  getApp(appId: string): Observable<LLMAppDetailResponse> {
    return this.api.get<LLMAppDetailResponse>(`${this.endpoint}/apps/${appId}`);
  }

  /** Create a new LLM App */
  createApp(request: LLMAppCreateRequest): Observable<LLMAppDetailResponse> {
    return this.api.post<LLMAppDetailResponse>(`${this.endpoint}/apps`, request);
  }

  /** Update an LLM App */
  updateApp(appId: string, request: LLMAppUpdateRequest): Observable<LLMAppDetailResponse> {
    return this.api.patch<LLMAppDetailResponse>(`${this.endpoint}/apps/${appId}`, request);
  }

  /** Delete an LLM App */
  deleteApp(appId: string): Observable<{ success: boolean; message: string }> {
    return this.api.delete<{ success: boolean; message: string }>(`${this.endpoint}/apps/${appId}`);
  }
}