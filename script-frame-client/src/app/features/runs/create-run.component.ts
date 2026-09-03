import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ApiClient } from '../../core/api/client.service';
import { RunsService } from './runs.service';
import { InitiateRunRequest, JobStatus, ScriptFrameWorkflow } from '../../core/models';

@Component({
  selector: 'app-create-run',
  imports: [CommonModule, FormsModule],
  templateUrl: './create-run.component.html',
  styleUrl: './create-run.component.scss'
})
export class CreateRunComponent implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly runs = inject(RunsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  // Async-touched state uses signals so zoneless change detection re-renders.
  // Form fields (workflowId/theme/targetDurationSeconds) update on user events,
  // which trigger CD themselves, so they stay plain properties.
  readonly workflows = signal<ScriptFrameWorkflow[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly generating = signal(false);
  readonly progressPercent = signal(0);
  readonly activeJobId = signal('');
  readonly jobStatus = signal<JobStatus | null>(null);
  readonly reviewReady = signal(false);

  workflowId = '';
  theme = '';
  targetDurationSeconds = '';

  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  // Offline demo data — mirrors the design-system create-run form. Used when the
  // backend is unavailable so the screen still renders faithfully with a live job.
  private static readonly MOCK: ScriptFrameWorkflow[] = [
    { id: 'cinematic-story', name: 'Cinematic Story', description: 'High-fidelity scene generation optimized for dramatic lighting, complex camera moves, and continuous narrative flow.', maxClipLength: 30, createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'short-form-social', name: 'Short Form Social', description: 'Fast-paced, high-engagement vertical video generation designed for TikTok, Reels, and Shorts with dynamic motion blur.', maxClipLength: 15, createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'animated-series', name: 'Animated Series', description: 'Consistent character models and stylized non-photorealistic rendering pipelines for episodic content creation.', maxClipLength: 60, createdAt: Date.now(), updatedAt: Date.now() }
  ];

  ngOnInit(): void {
    const id = this.route.snapshot.queryParamMap.get('workflow');
    if (id) {
      this.workflowId = id;
    }
    this.runs.getWorkflows().subscribe({
      next: (workflows) => { this.workflows.set(workflows); },
      error: () => { this.workflows.set(CreateRunComponent.MOCK); }
    });
  }

  get selectedWorkflowName(): string {
    return this.workflows().find((w) => w.id === this.workflowId)?.name ?? '—';
  }

  async submit(): Promise<void> {
    this.error.set('');
    if (!this.workflowId || !this.theme) {
      this.error.set('Please select a workflow and enter a topic.');
      return;
    }
    const runData: InitiateRunRequest = {
      workflowId: this.workflowId,
      theme: this.theme.trim(),
      targetDurationSeconds: this.targetDurationSeconds ? Number(this.targetDurationSeconds) : undefined
    };
    this.loading.set(true);
    try {
      const run = await this.runs.initiateRun(runData).toPromise();
      if (!run?.id) {
        throw new Error('Backend did not return a run id.');
      }
      const id = run.id;
      // Live flow: keep the user on this screen and show the active generation
      // job, polling until it reaches WAITING_REVIEW (story ready for review).
      this.activeJobId.set(id);
      this.reviewReady.set(false);
      this.progressPercent.set(0);
      this.generating.set(true);
      this.pollStatus(id);
    } catch (e) {
      // Offline fallback — simulate a live generation job so the screen renders.
      if (!this.api.baseUrl || !this.api.baseUrl.includes('http')) {
        void this.simulateGeneration(runData);
        return;
      }
      this.error.set(e instanceof Error ? e.message : 'Failed to start the run.');
      this.generating.set(false);
    } finally {
      this.loading.set(false);
    }
  }

  /** Poll the run's review checkpoint until it is ready (or fails). */
  private pollStatus(runId: string): void {
    const tick = () => {
      this.runs.getReview(runId).subscribe({
        next: (payload) => {
          const status = payload.status;
          this.jobStatus.set(status);
          this.progressPercent.set(this.progressForStatus(status));
          if (status === 'WAITING_REVIEW') {
            // Story + characters + portraits are ready; user reviews next.
            this.reviewReady.set(true);
            this.generating.set(false);
            this.progressPercent.set(100);
            return;
          }
          if (status === 'COMPLETED') {
            this.router.navigate(['/runs', runId, 'video']);
            return;
          }
          if (['FAILED', 'CANCELLED'].includes(status)) {
            this.generating.set(false);
            this.error.set(
              status === 'FAILED'
                ? 'Story generation failed. The selected workflow may be missing an LLM app binding.'
                : 'The run was cancelled.'
            );
            return;
          }
          this.pollTimer = setTimeout(tick, 3000);
        },
        error: () => {
          this.generating.set(false);
          // Keep trying for a moment — the backend may be mid-flight.
          this.pollTimer = setTimeout(tick, 5000);
        }
      });
    };
    tick();
  }

  /** Map a story-job status to a rough progress percentage. */
  private progressForStatus(status: JobStatus): number {
    switch (status) {
      case 'PENDING': return 5;
      case 'STORY_GENERATING': return 45;
      case 'CLIP_PLANNING': return 60;
      case 'GENERATING_CLIPS': return 75;
      case 'STITCHING': return 90;
      case 'WAITING_REVIEW':
      case 'COMPLETED': return 100;
      default: return 10;
    }
  }

  /** Human-readable status shown next to the progress bar. */
  statusLabelFor(status: JobStatus | null): string {
    return status ? RunsService.stageForStatus(status) : 'Starting…';
  }

  /** Go review the generated story + characters. */
  openReview(): void {
    const id = this.activeJobId();
    if (id) {
      this.router.navigate(['/runs', id, 'review']);
    }
  }

  ngOnDestroy(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
    }
  }

  private simulateGeneration(request: InitiateRunRequest): Promise<void> {
    return new Promise((resolve) => {
      this.generating.set(true);
      let step = 0;
      const interval = setInterval(() => {
        step += Math.random() * 15 + 5;
        if (step >= 100) {
          step = 100;
          clearInterval(interval);
          this.progressPercent.set(100);
          setTimeout(() => resolve(), 400);
        } else {
          this.progressPercent.set(Math.round(step));
        }
      }, 300);
    });
  }
}

