import { inject, Injectable } from '@angular/core';
import { ApiClient } from '../api/client.service';
import { map, Observable } from 'rxjs';

export interface Project {
  id: string;
  name: string;
  description: string;
  aspectRatio: string;
  modelPreset: string;
  updatedAt?: string;
  createdAt?: string;
  status?: 'active' | 'draft' | 'completed' | string;
  thumbnailUrl?: string;
  sceneCount?: number;
}

export interface CreateProjectPayload {
  name: string;
  description?: string;
  aspectRatio?: string;
  modelPreset?: string;
  status?: string;
}

@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly api = inject(ApiClient);

  /**
   * Fetch list of all projects (GET /api/projects)
   */
  getProjects(): Observable<Project[]> {
    return this.api.get<any>('/api/projects').pipe(
      map((res) => {
        if (Array.isArray(res)) return res;
        if (Array.isArray(res?.data)) return res.data;
        if (Array.isArray(res?.projects)) return res.projects;
        return [];
      })
    );
  }

  /**
   * Fetch specific project by ID (GET /api/projects/:id)
   */
  getProjectById(id: string): Observable<Project> {
    return this.api.get<any>(`/api/projects/${id}`).pipe(
      map((res) => (res?.data ? res.data : res))
    );
  }

  /**
   * Create new project (POST /api/projects)
   */
  createProject(payload: CreateProjectPayload): Observable<Project> {
    return this.api.post<any>('/api/projects', payload).pipe(
      map((res) => (res?.data ? res.data : res))
    );
  }

  /**
   * Patch project fields by ID (PATCH /api/projects/:id)
   */
  patchProject(id: string, payload: Partial<CreateProjectPayload>): Observable<Project> {
    return this.api.patch<any>(`/api/projects/${id}`, payload).pipe(
      map((res) => (res?.data ? res.data : res))
    );
  }

  /**
   * Delete project by ID (DELETE /api/projects/:id)
   */
  deleteProject(id: string): Observable<any> {
    return this.api.delete<any>(`/api/projects/${id}`).pipe(
      map((res) => (res?.data ? res.data : res))
    );
  }
}
