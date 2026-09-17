import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import {
  Job,
  CreateJobRequest,
  UpdateJobRequest,
  JobListParams,
  JobListResponse,
  Asset,
} from '../models';

@Injectable({
  providedIn: 'root',
})
export class JobService {
  private endpoint = '/jobs';

  constructor(private api: ApiService) {}

  /** Create a new video generation job */
  createJob(request: CreateJobRequest): Observable<Job> {
    return this.api.post<Job>(this.endpoint, request);
  }

  /** Get a list of jobs with optional filtering */
  getJobs(params?: JobListParams): Observable<JobListResponse> {
    return this.api.get<JobListResponse>(this.endpoint, { params: params as Record<string, string | number | boolean> });
  }

  /** Get a single job by ID with its assets */
  getJob(id: string): Observable<{ success: boolean; data: Job }> {
    return this.api.get<{ success: boolean; data: Job }>(`${this.endpoint}/${id}`);
  }

  /** Update job status/progress (typically called by backend workers) */
  updateJob(id: string, request: UpdateJobRequest): Observable<{ success: boolean; data: Job }> {
    return this.api.patch<{ success: boolean; data: Job }>(`${this.endpoint}/${id}`, request);
  }

  /** Start processing a job (trigger video generation) */
  processJob(id: string): Observable<{ success: boolean; message: string }> {
    return this.api.post<{ success: boolean; message: string }>(`${this.endpoint}/${id}/process`, {});
  }

  /** Cancel a running/pending job */
  cancelJob(id: string): Observable<{ success: boolean; message: string }> {
    return this.api.post<{ success: boolean; message: string }>(`${this.endpoint}/${id}/cancel`, {});
  }

  /** Delete a job and its associated assets */
  deleteJob(id: string): Observable<{ success: boolean; message: string }> {
    return this.api.delete<{ success: boolean; message: string }>(`${this.endpoint}/${id}`);
  }

  /** Get assets for a specific job */
  getJobAssets(jobId: string): Observable<{ success: boolean; data: Asset[] }> {
    return this.api.get<{ success: boolean; data: Asset[] }>(`${this.endpoint}/${jobId}/assets`);
  }
}