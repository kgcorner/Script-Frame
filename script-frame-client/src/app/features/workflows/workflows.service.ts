import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiClient } from '../../core/api/client.service';
import { ScriptFrameWorkflow } from '../../core/models';

/** Backend wraps every JSON payload in a `{ success, data }` envelope. */
interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class WorkflowsService {
  constructor(private readonly api: ApiClient) {}

  /** Step 1: list available workflows/applications to choose from. */
  getWorkflows(): Observable<ScriptFrameWorkflow[]> {
    return this.api
      .get<ApiEnvelope<ScriptFrameWorkflow[]>>('/scriptframe-workflows')
      .pipe(map((res) => res.data ?? []));
  }

  getWorkflow(id: string): Observable<ScriptFrameWorkflow> {
    return this.api
      .get<ApiEnvelope<ScriptFrameWorkflow>>(`/scriptframe-workflows/${id}`)
      .pipe(map((res) => res.data));
  }
}
