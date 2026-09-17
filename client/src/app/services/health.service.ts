import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import {
  ServiceHealthCheck,
  HealthCheckResponse,
  HealthHistoryResponse,
  LatestHealthResponse,
} from '../models';

@Injectable({
  providedIn: 'root',
})
export class HealthService {
  private endpoint = '/health';

  constructor(private api: ApiService) {}

  /** Check health of all services */
  checkAll(): Observable<HealthCheckResponse> {
    return this.api.get<HealthCheckResponse>(this.endpoint);
  }

  /** Check Omniroute service health */
  checkOmniroute(): Observable<{ success: boolean; data: ServiceHealthCheck }> {
    return this.api.get<{ success: boolean; data: ServiceHealthCheck }>(`${this.endpoint}/omniroute`);
  }

  /** Check ComfyUI service health */
  checkComfyUI(): Observable<{ success: boolean; data: ServiceHealthCheck }> {
    return this.api.get<{ success: boolean; data: ServiceHealthCheck }>(`${this.endpoint}/comfyui`);
  }

  /** Get health check history for a service */
  getHealthHistory(service: 'omniroute' | 'comfyui', limit = 100): Observable<HealthHistoryResponse> {
    return this.api.get<HealthHistoryResponse>(`${this.endpoint}/history`, {
      params: { service, limit },
    });
  }

  /** Get latest health status for all services */
  getLatestHealth(): Observable<LatestHealthResponse> {
    return this.api.get<LatestHealthResponse>(`${this.endpoint}/latest`);
  }
}