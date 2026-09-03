import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import {
  OmnirouteGenerateRequest,
  OmnirouteGenerateResponse,
  OmnirouteStatusResponse,
  OmnirouteModelsResponse,
} from '../models';

@Injectable({
  providedIn: 'root',
})
export class OmnirouteService {
  private endpoint = '/services/omniroute';

  constructor(private api: ApiService) {}

  /** Generate video using Omniroute */
  generate(request: OmnirouteGenerateRequest): Observable<OmnirouteGenerateResponse> {
    return this.api.post<OmnirouteGenerateResponse>(`${this.endpoint}/generate`, request);
  }

  /** Check status of an Omniroute generation job */
  getStatus(jobId: string): Observable<OmnirouteStatusResponse> {
    return this.api.get<OmnirouteStatusResponse>(`${this.endpoint}/status/${jobId}`);
  }

  /** Cancel an Omniroute generation job */
  cancel(jobId: string): Observable<{ success: boolean; message: string }> {
    return this.api.post<{ success: boolean; message: string }>(`${this.endpoint}/cancel/${jobId}`, {});
  }

  /** Get available models from Omniroute */
  getModels(): Observable<OmnirouteModelsResponse> {
    return this.api.get<OmnirouteModelsResponse>(`${this.endpoint}/models`);
  }
}