import { Injectable, inject } from '@angular/core';
import { Observable, timer } from 'rxjs';
import { map, switchMap, tap } from 'rxjs/operators';
import { ApiClient } from '../../core/api/client.service';
import { InitiateRunRequest, JobStatus, RunReviewPayload, StoryEditRequest, ScriptFrameWorkflow } from '../../core/models';

@Injectable({ providedIn: 'root' })
export class RunsService {
  private readonly api = inject(ApiClient);

  /** Step 1: list available workflows/applications to choose from. */
  getWorkflows(): Observable<ScriptFrameWorkflow[]> {
    return this.api
      .get<{ success: boolean; data: ScriptFrameWorkflow[] }>('/scriptframe-workflows')
      .pipe(map((res) => res.data ?? []));
  }

  /** Step 2: initiate a new video run (creates PENDING job + spawns worker). */
  initiateRun(request: InitiateRunRequest): Observable<{ id: string }> {
    return this.api.post<{ success: boolean; data: { id: string } }>('/video-runs', request).pipe(
      tap((res) => console.debug('[RunsService] initiated run:', res.data.id))
    ).pipe(map((res) => ({ id: res.data.id })));
  }

  /** Step 3/4: fetch the current review checkpoint (status + story + characters). */
  getReview(id: string): Observable<RunReviewPayload> {
    return this.api
      .get<{ success: boolean; data: RunReviewPayload }>(`/video-runs/${id}/review`)
      .pipe(map((res) => res.data));
  }

  /** Human-readable stage derived from job status. */
  static stageForStatus(status: JobStatus): string {
    switch (status) {
      case 'STORY_GENERATING':
        return 'STORY';
      case 'WAITING_REVIEW':
        return 'PORTRAITS';
      case 'CLIP_PLANNING':
        return 'CLIP_PLANNING';
      case 'GENERATING_CLIPS':
        return 'CLIPS';
      case 'STITCHING':
        return 'STITCHING';
      default:
        return status;
    }
  }

  /** Step 5: approve the story + characters to unblock final generation. */
  approve(id: string): Observable<RunReviewPayload> {
    return this.api.patch<RunReviewPayload>(`/video-runs/${id}/approve`, {});
  }

  /** Request a change (e.g. "make the villain younger") → backend re-renders affected assets. */
  requestChange(id: string, request: string): Observable<RunReviewPayload> {
    return this.api.patch<RunReviewPayload>(`/video-runs/${id}/request-change`, { request });
  }

  /** Edit story/title/logline inline → backend regenerates without a change request. */
  editStory(id: string, edits: StoryEditRequest): Observable<RunReviewPayload> {
    return this.api.patch<RunReviewPayload>(`/video-runs/${id}/edit-story`, edits);
  }

  /** Poll job status at an interval until it reaches a terminal state. */
  pollUntilTerminal(id: string, intervalMs = 20_000): Observable<{ payload: RunReviewPayload; done: boolean }> {
    return new Observable((subscriber) => {
      let guard = 0;
      const tick = () => {
        if (guard++ > 1000) {
          subscriber.next({ payload: {} as RunReviewPayload, done: true });
          subscriber.complete();
          return;
        }
        this.getReview(id).subscribe((payload) => {
          const terminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(payload.status);
          subscriber.next({ payload, done: terminal });
          if (!terminal) {
            timer(intervalMs).subscribe(tick);
          } else {
            subscriber.complete();
          }
        });
      };
      tick();
    });
  }

  /** Step 6: fetch the final stitched MP4 (range requests supported by backend). */
  getFinalVideo(id: string): Observable<Blob> {
    return this.api.get<Blob>(`/video-runs/${id}/video`, { responseType: 'blob' });
  }
}
