import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AsyncPipe } from '@angular/common';
import { RunsService } from './runs.service';
import { ApiClient } from '../../core/api/client.service';

@Component({
  selector: 'app-video',
  imports: [CommonModule, AsyncPipe],
  templateUrl: './video.component.html',
  styleUrl: './video.component.scss'
})
export class VideoComponent implements OnInit {
  private readonly runs = inject(RunsService);
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiClient);

  id = '';
  // Async-touched state is signal-based so zoneless change detection re-renders.
  readonly loading = signal(true);
  readonly error = signal('');
  video$ = this.runs.getFinalVideo('');

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.video$ = this.runs.getFinalVideo(this.id);
  }

  /** Offline demo mode — mirrors the design-system final-generation checkpoint.
   *  When no live backend is reachable, render a placeholder so the screen still
   *  displays faithfully without requiring an actual MP4 asset. */
  get offline(): boolean {
    return !this.api.baseUrl || !this.api.baseUrl.includes('http');
  }

  /** Whether to show the mock video placeholder instead of attempting a live fetch. */
  get mock(): boolean {
    return this.offline;
  }
}
