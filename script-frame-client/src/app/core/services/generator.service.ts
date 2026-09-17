import { inject, Injectable } from '@angular/core';
import { ApiClient } from '../api/client.service';
import { Observable, map } from 'rxjs';

export interface GenerationResponse {
  jobId: string;
  projectId: string;
  status: string;
  workflow: string;
}

export interface JobArtifact {
  name: string;
  type: string;
  mimeType: string;
  url: string;
}

export interface JobStatusResponse {
  id?: string;
  jobId: string;
  userId?: string;
  projectId?: string;
  prompt?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  comfyuiPromptId?: string;
  error?: string | null;
  artifact?: JobArtifact | null;
  createdAt?: string;
}

export interface GeneratePayload {
  workflow: string;
  projectId: string;
  prompt: string;
  image?: string;
  aspectRatio?: string;
  duration?: number;
  megapixels?: number;
}

@Injectable({ providedIn: 'root' })
export class GeneratorService {
  private readonly api = inject(ApiClient);

  generateTextToVideo(payload: GeneratePayload): Observable<GenerationResponse> {
    return this.api.post<any>('/api/generate-t2v', payload).pipe(
      map((res) => (res?.data ? res.data : res))
    );
  }

  generateImageToVideo(payload: GeneratePayload): Observable<GenerationResponse> {
    return this.api.post<any>('/api/generate-i2v', payload).pipe(
      map((res) => (res?.data ? res.data : res))
    );
  }

  generateTextToImage(payload: GeneratePayload): Observable<GenerationResponse> {
    return this.api.post<any>('/api/generate-t2i', payload).pipe(
      map((res) => (res?.data ? res.data : res))
    );
  }

  getJobStatus(jobId: string): Observable<JobStatusResponse> {
    return this.api.get<any>(`/api/jobs/${jobId}/status`).pipe(
      map((res) => (res?.data ? res.data : res))
    );
  }

  getProjectJobs(projectId: string): Observable<JobStatusResponse[]> {
    const url = `/api/jobs?projectId=${encodeURIComponent(projectId)}`;
    return this.api.get<any>(url).pipe(
      map((res) => {
        const list: any[] = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
        return list;
      })
    );
  }

  exportVideo(videos: string[], projectId?: string): Observable<{ jobId: string; status: string; videos: string[]; projectId?: string }> {
    return this.api.post<any>('/api/export/video', { videos, ...(projectId ? { projectId } : {}) }).pipe(
      map((res) => (res?.data ? res.data : res))
    );
  }
}
