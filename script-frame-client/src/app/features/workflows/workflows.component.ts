import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { WorkflowsService } from './workflows.service';
import { ScriptFrameWorkflow } from '../../core/models';

@Component({
  selector: 'app-workflows',
  imports: [],
  templateUrl: './workflows.component.html',
  styleUrl: './workflows.component.scss'
})
export class WorkflowsComponent implements OnInit {
  private readonly workflowsService = inject(WorkflowsService);
  private readonly router = inject(Router);

  // Signal-based state: zoneless change detection re-renders whenever a signal
  // read in the template changes (plain property writes would not).
  readonly workflows = signal<ScriptFrameWorkflow[]>([]);
  readonly loading = signal(true);
  readonly usingMock = signal(false);
  readonly skeletons = Array.from({ length: 6 });

  // Offline demo data — used when the backend is unreachable so the screen
  // still renders faithfully for local development.
  private static readonly MOCK: ScriptFrameWorkflow[] = [
    { id: 'cinematic-story', name: 'Cinematic Story', description: 'High-fidelity scene generation optimized for dramatic lighting, complex camera moves, and continuous narrative flow.', maxClipLength: 30, createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'short-form-social', name: 'Short Form Social', description: 'Fast-paced, high-engagement vertical video generation designed for TikTok, Reels, and Shorts with dynamic motion blur.', maxClipLength: 15, createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'animated-series', name: 'Animated Series', description: 'Consistent character models and stylized non-photorealistic rendering pipelines for episodic content creation.', maxClipLength: 60, createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'corporate-explainer', name: 'Corporate Explainer', description: 'Clean, professional motion graphics and isometric data visualization perfect for B2B communications and pitch decks.', maxClipLength: 45, createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'music-visualization', name: 'Music Visualization', description: 'Audio-reactive particle systems and abstract geometric generations synced perfectly to audio track beats and frequencies.', maxClipLength: 30, createdAt: Date.now(), updatedAt: Date.now() }
  ];

  // Cycled through by index so every card gets a distinct icon + colour.
  private static readonly ICONS: ReadonlyArray<{ d: string; fill: string }> = [
    {
      fill: 'var(--primary)',
      d: 'M18,4l2,4-2,4h-4l-2-4v-4zm-4,2V8h6zM4,20H20v-2H4zM6,8l2.5,3L8,14H6z'
    },
    {
      fill: 'var(--secondary)',
      d: 'M17,1H7c-1.1,0 -2,0.9 -2,2v18c0,1.1 0.9,2 2,2h10c1.1,0 2-0.9 2-2V3C19,1.9 18.1,1 17,1zM16,17.5v-9l-2,1.5v7.5h2zM14,4.5v13l2-1.5v-11.5z'
    },
    {
      fill: 'var(--tertiary)',
      d: 'M15,6l-6,3 6,3zM20,4H4c-1.1,0 -2,0.9 -2,2v12c0,1.1 0.9,2 2,2h16c1.1,0 2-0.9 2-2V6C22,4.9 21.1,4 20,4z'
    },
    {
      fill: 'var(--primary-fixed)',
      d: 'M10,4H4c-1.1,0 -2,0.9 -2,2v12c0,1.1 0.9,2 2,2h16c1.1,0 2-0.9 2-2V8c0-1.1 -0.9-2 -2-2h-8l-2,-2z'
    },
    {
      fill: 'var(--secondary-fixed)',
      d: 'M9,18V6l8.5,2c0.4,0 0.7,0.3 0.7,0.7L18,18H9zM18,18v-8.5c0-0.4 -0.3-0.7 -0.7-0.7L9,11v7'
    }
  ];

  iconFor(index: number): { d: string; fill: string } {
    const icons = WorkflowsComponent.ICONS;
    return icons[index % icons.length];
  }

  ngOnInit(): void {
    this.loadWorkflows();
  }

  retry(): void {
    this.loadWorkflows();
  }

  /**
   * Navigate to the run form. `runs/new` takes the workflow as a **query**
   * param (`?workflow=<id>`) — the route itself has no path param.
   */
  navigateToRun(workflowId?: string): void {
    this.router.navigate(
      ['/runs/new'],
      workflowId ? { queryParams: { workflow: workflowId } } : undefined
    );
  }

  private loadWorkflows(): void {
    this.loading.set(true);
    this.workflowsService.getWorkflows().subscribe({
      next: (workflows) => {
        this.workflows.set(workflows);
        this.usingMock.set(false);
        this.loading.set(false);
      },
      error: () => {
        this.workflows.set(WorkflowsComponent.MOCK);
        this.usingMock.set(true);
        this.loading.set(false);
      }
    });
  }
}
