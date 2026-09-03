import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RunsService } from './runs.service';
import { ApiClient } from '../../core/api/client.service';
import { CharacterProfile, JobStatus, RunReviewPayload, StoryObject } from '../../core/models';

@Component({
  selector: 'app-review',
  imports: [CommonModule, FormsModule],
  templateUrl: './review.component.html',
  styleUrl: './review.component.scss'
})
export class ReviewComponent implements OnInit {
  private readonly runs = inject(RunsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiClient);

  id = '';
  payload$ = this.runs.getReview('');

  // Async-touched state is signal-based so zoneless change detection re-renders.
  readonly loading = signal(true);
  readonly error = signal('');
  /** Resolved review data used by the template. Falls back to mock data when offline. */
  readonly resolved = signal<RunReviewPayload | null>(null);

  readonly status = signal<JobStatus | null>(null);
  readonly storyObject = signal<StoryObject>({});
  readonly characters = signal<CharacterProfile[]>([]);
  readonly editingCharacter = signal(-1);

  get storyData(): StoryObject {
    const payload = this.getPayload();
    if (payload.story) {
      try { return JSON.parse(payload.story) as StoryObject; } catch { return {}; }
    }
    return this.storyObject();
  }

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.payload$ = this.runs.getReview(this.id);
    this.payload$.subscribe((payload) => {
      this.resolved.set(payload);
      this.status.set(payload.status ?? null);
      this.characters.set(payload.characters ?? []);
      if (payload.story) {
        try { this.storyObject.set(JSON.parse(payload.story) as StoryObject); } catch { /* keep existing */ }
      }
      this.loading.set(false);
    }, (err) => {
      this.error.set(err instanceof Error ? err.message : 'Failed to load the review.');
      this.loading.set(false);
    });
  }

  get statusLabel(): string {
    return RunsService.stageForStatus(this.status() ?? 'PENDING');
  }

  approve(): void {
    void this.runs.approve(this.id).subscribe(() => this.router.navigate(['/runs/new']));
  }

  requestChange(request: string): void {
    void this.runs.requestChange(this.id, request).subscribe();
  }

  saveCharacter(index: number): void {
    const edited = this.characters()[index];
    if (!edited) return;
    // Backend stores character text under story.story for regeneration.
    void this.runs.editStory(this.id, { story: edited.description }).subscribe((p) => {
      if (p.story) {
        try { this.storyObject.set(JSON.parse(p.story) as StoryObject); } catch { /* keep existing */ }
      }
    });
  }

  toggleCharacter(index: number): void {
    this.editingCharacter.set(this.editingCharacter() === index ? -1 : index);
  }

  // Offline demo data — mirrors the design-system review checkpoint. Used when the
  // backend is unavailable so the screen still renders faithfully with a live job.
  private static readonly MOCK: RunReviewPayload = {
    status: 'COMPLETED',
    revision: 2,
    story: JSON.stringify({
      title: 'The Last Lighthouse Keeper',
      logline: 'An aging keeper must choose between her duty and the sea that has always called to her.',
      story: 'For forty years, Mara tended the lighthouse at the edge of the world. The sea gave her everything — salt in her lungs, storms in her blood, a rhythm as steady as the clockwork lamp she kept burning through every night.\n\nBut when the new automation arrived, it did not understand the light the way she did. It blinked on schedule; it never warned of the fog that came without warning. And one November night, with the tide rising and the lamp dark, Mara realized the machine could not see what her eyes had learned in four decades.\n\nShe climbed down into the storm to relight the flame by hand — not because she feared the sea, but because some lights are kept for those who cannot keep them themselves.'
    }),
    characters: [
      { name: 'Mara Voss', role: 'Protagonist', description: 'A weathered lighthouse keeper in her late sixties. Stoic, precise, haunted by the sea.', imageAppId: '', portraitStatus: 'COMPLETED' },
      { name: 'The Tide', role: 'Antagonist', description: 'Personified as an ancient, patient force — salt-white and relentless.', imageAppId: '', portraitStatus: 'COMPLETED' }
    ]
  };

  get offline(): boolean {
    return !this.api.baseUrl || !this.api.baseUrl.includes('http');
  }

  /** Returns the review payload, falling back to static mock data when offline. */
  getPayload(): RunReviewPayload {
    return this.resolved() ?? ReviewComponent.MOCK;
  }
}

