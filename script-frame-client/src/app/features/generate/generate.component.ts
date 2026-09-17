import { Component, signal, computed, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ProjectService, Project } from '../../core/services/project.service';
import { GeneratorService, GeneratePayload, JobStatusResponse } from '../../core/services/generator.service';
import { environment } from '../../../environments/environment';

export interface WorkflowOption {
  id: string;
  label: string;
  subLabel: string;
  file: string;
  isImageToVideo: boolean;
}

export interface RatioOption {
  id: string;
  label: string;
  desktopLabel: string;
  fullName: string;
  icon: string;
}

@Component({
  selector: 'app-generate',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './generate.component.html',
  styleUrl: './generate.component.scss'
})
export class GenerateComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly projectService = inject(ProjectService);
  private readonly generatorService = inject(GeneratorService);

  readonly projectId = signal<string | null>(null);
  readonly currentProject = signal<Project | null>(null);
  readonly isLoadingProject = signal<boolean>(false);

  // Generation Backend State
  readonly uploadedImageBase64 = signal<string | null>(null);
  readonly currentJobId = signal<string | null>(null);
  readonly jobStatus = signal<string | null>(null);
  readonly generationError = signal<string | null>(null);
  readonly generatedArtifactUrl = signal<string | null>(null);
  readonly generatedArtifactType = signal<'video' | 'image' | null>(null);

  // Dynamic Project Generations List
  readonly projectJobs = signal<JobStatusResponse[]>([]);

  private pollTimer: any = null;

  readonly workflows: WorkflowOption[] = [
    { id: 'T2V-minimax', label: 'T2V MiniMax', subLabel: 'Text to Video MiniMax • v2.4', file: 'T2V-minimax.json', isImageToVideo: false },
    { id: 'I2V-LTX', label: 'I2V LTX', subLabel: 'Image to Video LTX • Realtime', file: 'I2V-LTX.json', isImageToVideo: true },
    { id: 'I2V-minimax', label: 'I2V MiniMax', subLabel: 'Image to Video MiniMax • Kinetic', file: 'I2V-minimax.json', isImageToVideo: true },
    { id: 'T2V-LTX', label: 'T2V LTX', subLabel: 'Text to Video LTX • Responsive', file: 'T2V-LTX.json', isImageToVideo: false },
    { id: 'T2I-Flux', label: 'Flux 1K', subLabel: 'Text to Image Flux • 1K Master', file: 'T2I-Flux.json', isImageToVideo: false }
  ];

  readonly ratios: RatioOption[] = [
    { id: '16:9', label: '16:9 Landscape', desktopLabel: '16:9', fullName: '16:9 • Widescreen Master', icon: 'aspect_ratio' },
    { id: '9:16', label: '9:16 Vertical', desktopLabel: '9:16', fullName: '9:16 • Vertical Reel', icon: 'crop_portrait' },
    { id: '21:9', label: '21:9 CinemaScope', desktopLabel: '21:9', fullName: '21:9 • CinemaScope', icon: 'panorama_wide_angle' },
    { id: '1:1', label: '1:1 Square', desktopLabel: '1:1', fullName: '1:1 • Square Frame', icon: 'crop_square' },
    { id: '4:5', label: '4:5 Portrait', desktopLabel: '4:5', fullName: '4:5 • Feed Portrait', icon: 'crop_portrait' }
  ];

  readonly durationOptions = [3.0, 5.0, 8.0, 10.0];

  readonly inspirationTags = [
    '+ 8k Panavision',
    '+ Film Grain 400T',
    '+ Neon Wet Bokeh',
    '+ Steadicam Drift'
  ];

  // Component Signals
  readonly selectedWorkflowId = signal<string>('T2V-minimax');
  readonly promptText = signal<string>(
    'Anamorphic 35mm capture, low angle kinetic tracking shot through a rain-drenched cybernetic boulevard. Holographic cyan and neon magenta reflections on sleek obsidian hovercar chassis, shallow depth of field, subtle chromatic aberration, cinematic particulate haze.'
  );
  readonly selectedRatioId = signal<string>('16:9');
  readonly megapixels = signal<number>(0.9);
  readonly selectedDuration = signal<number>(5.0);
  readonly turboMode = signal<boolean>(true);
  readonly isPlaying = signal<boolean>(false);
  readonly isGenerating = signal<boolean>(false);
  readonly isEnhancing = signal<boolean>(false);
  readonly parametersOpen = signal<boolean>(false);
  readonly isUpdatingStatus = signal<boolean>(false);
  readonly statusUpdateError = signal<string | null>(null);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('projectId');
    if (id) {
      this.projectId.set(id);
      this.fetchProjectDetails(id);
    }
  }

  private fetchProjectDetails(id: string): void {
    this.isLoadingProject.set(true);
    this.loadProjectJobs(id);

    this.projectService.getProjectById(id).subscribe({
      next: (project) => {
        this.isLoadingProject.set(false);
        if (project) {
          this.currentProject.set(project);

          if (project.description && project.description.trim()) {
            this.promptText.set(project.description.trim());
          }

          if (project.aspectRatio) {
            const ratioMatch = this.ratios.find(
              (r) => r.id === project.aspectRatio || r.label.toLowerCase().includes(project.aspectRatio.toLowerCase())
            );
            if (ratioMatch) {
              this.selectedRatioId.set(ratioMatch.id);
            }
          }

          if (project.modelPreset) {
            const presetLower = project.modelPreset.toLowerCase();
            const workflowMatch = this.workflows.find(
              (w) =>
                w.id.toLowerCase() === presetLower ||
                w.label.toLowerCase() === presetLower ||
                w.id.toLowerCase().replace('-', '') === presetLower.replace(/\s+/g, '')
            );
            if (workflowMatch) {
              this.selectedWorkflowId.set(workflowMatch.id);
            }
          }
        }
      },
      error: (err) => {
        this.isLoadingProject.set(false);
        console.warn(`Could not fetch details for project ${id}:`, err);
      }
    });
  }

  loadProjectJobs(id: string): void {
    this.generatorService.getProjectJobs(id).subscribe({
      next: (jobs) => {
        this.projectJobs.set(jobs || []);
        // Select latest completed job if available and no current artifact set
        if (!this.generatedArtifactUrl() && jobs && jobs.length > 0) {
          const completed = jobs.find((j) => j.status === 'completed' && j.artifact);
          if (completed) {
            this.selectJobArtifact(completed);
          }
        }
      },
      error: (err) => {
        console.warn('Failed to load project jobs from backend:', err);
      }
    });
  }

  resolveArtifactUrl(artifact?: { url?: string; name?: string } | string | null): string {
    if (!artifact) return '';
    let target = typeof artifact === 'string' ? artifact : (artifact.url || (artifact.name ? `/api/artifact/${artifact.name}` : ''));
    if (!target) return '';
    if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('data:')) {
      return target;
    }
    if (!target.startsWith('/')) {
      target = `/api/artifact/${target}`;
    }
    const backendHost = environment.apiUrl.replace(/\/api\/?$/, '');
    return `${backendHost}${target}`;
  }

  selectJobArtifact(job: JobStatusResponse | any): void {
    if (!job) return;

    let url = '';
    let type: 'video' | 'image' = 'video';

    if (job.artifact) {
      url = this.resolveArtifactUrl(job.artifact);
      type = job.artifact.type === 'image' ? 'image' : 'video';
    } else if (job.jobId || job.id) {
      const id = job.jobId || job.id;
      url = this.resolveArtifactUrl(`/api/artifact/${id}.mp4`);
      type = 'video';
    }

    if (url) {
      this.generatedArtifactUrl.set(url);
      this.generatedArtifactType.set(type);
      this.isPlaying.set(true);
    }

    if (job.prompt) {
      this.promptText.set(job.prompt);
    }

    // Smooth scroll to main viewport so the user immediately views/plays the output
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  readonly refreshingJobId = signal<string | null>(null);

  updateProjectJobInList(jobId: string, updatedJob: Partial<JobStatusResponse>): void {
    this.projectJobs.update((jobs) =>
      jobs.map((j) => {
        const idMatches = (j.jobId && j.jobId === jobId) || (j.id && j.id === jobId);
        if (idMatches) {
          return {
            ...j,
            ...updatedJob,
            status: updatedJob.status || j.status,
            artifact: updatedJob.artifact || j.artifact
          };
        }
        return j;
      })
    );
  }

  refreshJob(job: JobStatusResponse | any, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    const id = job.jobId || job.id;
    if (!id) return;

    this.refreshingJobId.set(id);

    this.generatorService.getJobStatus(id).subscribe({
      next: (res) => {
        this.refreshingJobId.set(null);
        this.updateProjectJobInList(id, res);

        if (res.status === 'pending' || res.status === 'processing') {
          this.isGenerating.set(true);
          this.startJobPolling(id);
        } else if (res.status === 'completed') {
          this.selectJobArtifact(res);
        }
      },
      error: (err) => {
        this.refreshingJobId.set(null);
        console.warn('Failed to refresh job status:', err);
      }
    });
  }

  refreshAllJobs(event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    if (this.projectId()) {
      this.loadProjectJobs(this.projectId()!);
    }
  }

  downloadCurrentArtifact(): void {
    const url = this.generatedArtifactUrl();
    if (!url) return;

    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    const filename = url.substring(url.lastIndexOf('/') + 1) || 'artifact';
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  readonly selectedArtifactNames = signal<string[]>([]);
  readonly isExporting = signal<boolean>(false);

  getArtifactName(job: JobStatusResponse | any): string | null {
    if (!job) return null;
    let name = job.artifact?.name;
    if (!name) {
      const id = job.jobId || job.id;
      if (id) {
        name = `${id}.mp4`;
      }
    }
    if (!name) return null;
    return name.replace(/^\/?(api\/)?artifact\//, '');
  }

  toggleSelectArtifact(job: JobStatusResponse | any, event: Event): void {
    event.stopPropagation();
    const name = this.getArtifactName(job);
    if (!name) return;

    this.selectedArtifactNames.update((list) => {
      if (list.includes(name)) {
        return list.filter((n) => n !== name);
      } else {
        return [...list, name];
      }
    });
  }

  getSelectionOrder(job: JobStatusResponse | any): number {
    const name = this.getArtifactName(job);
    if (!name) return 0;
    const index = this.selectedArtifactNames().indexOf(name);
    return index >= 0 ? index + 1 : 0;
  }

  isArtifactSelected(job: JobStatusResponse | any): boolean {
    const name = this.getArtifactName(job);
    return !!name && this.selectedArtifactNames().includes(name);
  }

  exportStitchedVideo(): void {
    const videos = this.selectedArtifactNames();
    if (videos.length === 0 || this.isExporting()) return;

    this.isExporting.set(true);
    this.isGenerating.set(true);
    this.generationError.set(null);

    this.generatorService.exportVideo(videos, this.projectId() || undefined).subscribe({
      next: (res) => {
        this.isExporting.set(false);
        const jobId = res?.jobId;
        if (jobId) {
          this.currentJobId.set(jobId);
          this.jobStatus.set(res.status || 'processing');
          this.startJobPolling(jobId);
          this.selectedArtifactNames.set([]);
        } else {
          this.isGenerating.set(false);
          this.generationError.set('No export job ID returned from server.');
        }
      },
      error: (err) => {
        this.isExporting.set(false);
        this.isGenerating.set(false);
        const msg = err?.error?.message || err?.error?.error || err?.message || 'Video export request failed.';
        this.generationError.set(msg);
      }
    });
  }

  // Computed state
  readonly selectedWorkflow = computed(
    () => this.workflows.find((w) => w.id === this.selectedWorkflowId()) || this.workflows[0]
  );

  readonly selectedRatio = computed(
    () => this.ratios.find((r) => r.id === this.selectedRatioId()) || this.ratios[0]
  );

  readonly tokenCount = computed(() => {
    return this.promptText().length;
  });

  readonly framesCount = computed(() => {
    return Math.round(this.selectedDuration() * 24);
  });

  readonly megapixelLabel = computed(() => {
    const val = this.megapixels();
    if (val <= 0.5) return `${val.toFixed(1)} MP (Draft)`;
    if (val >= 1.5) return `${val.toFixed(1)} MP (Pro UHD)`;
    return `${val.toFixed(1)} MP (HD Master)`;
  });

  selectWorkflow(id: string): void {
    this.selectedWorkflowId.set(id);
  }

  selectRatio(ratioId: string): void {
    this.selectedRatioId.set(ratioId);
  }

  selectDuration(dur: number): void {
    this.selectedDuration.set(dur);
  }

  setMegapixels(val: number): void {
    this.megapixels.set(val);
  }

  toggleTurbo(): void {
    this.turboMode.update((v) => !v);
  }

  togglePlay(): void {
    this.isPlaying.update((v) => !v);
  }

  updateProjectStatus(status: 'active' | 'draft' | 'completed'): void {
    const id = this.projectId();
    if (!id || this.isUpdatingStatus()) return;

    this.isUpdatingStatus.set(true);
    this.statusUpdateError.set(null);

    this.projectService.patchProject(id, { status }).subscribe({
      next: (updated) => {
        this.isUpdatingStatus.set(false);
        this.currentProject.update((p) => p ? { ...p, status: updated.status ?? status } : p);
      },
      error: (err) => {
        this.isUpdatingStatus.set(false);
        const msg = err?.error?.message || err?.message || 'Failed to update project status.';
        this.statusUpdateError.set(msg);
      }
    });
  }

  toggleParameters(): void {
    this.parametersOpen.update((v) => !v);
  }

  appendTag(tag: string): void {
    const cleanTag = tag.replace('+', '').trim();
    const current = this.promptText();
    if (current) {
      this.promptText.set(`${current}, ${cleanTag}`);
    } else {
      this.promptText.set(cleanTag);
    }
  }

  enhancePrompt(): void {
    if (this.isEnhancing()) return;
    this.isEnhancing.set(true);
    setTimeout(() => {
      this.promptText.set(
        'Cinematic anamorphic 35mm capture, extreme depth of field. Intricate neon violet reflections across rain-drenched cybernetic pavements, volumetric haze, particle embers swirling in the low exhaust breeze. Super-resolution photorealism, dynamic camera drift.'
      );
      this.isEnhancing.set(false);
    }, 700);
  }

  onImageFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        if (result) {
          this.uploadedImageBase64.set(result);
        }
      };
      reader.readAsDataURL(file);
    }
  }

  generateVideo(): void {
    if (this.isGenerating()) return;
    this.generationError.set(null);

    const wf = this.selectedWorkflow();
    const isI2V = wf.isImageToVideo;
    const isT2I = wf.id === 'T2I-Flux' || wf.label.toLowerCase().includes('text to image');

    if (isI2V && !this.uploadedImageBase64()) {
      this.generationError.set('Image to Video generation requires a keyframe image. Please upload an image first.');
      return;
    }

    this.isGenerating.set(true);
    this.jobStatus.set('submitting');

    const payload: GeneratePayload = {
      workflow: this.selectedWorkflowId(),
      projectId: this.projectId() || 'default-project',
      prompt: this.promptText(),
      aspectRatio: this.selectedRatioId(),
      duration: this.selectedDuration(),
      megapixels: this.megapixels(),
      image: isI2V ? (this.uploadedImageBase64() || undefined) : undefined
    };

    let obs;
    if (isI2V) {
      obs = this.generatorService.generateImageToVideo(payload);
    } else if (isT2I) {
      obs = this.generatorService.generateTextToImage(payload);
    } else {
      obs = this.generatorService.generateTextToVideo(payload);
    }

    obs.subscribe({
      next: (res) => {
        const jobId = res?.jobId;
        if (jobId) {
          this.currentJobId.set(jobId);
          this.jobStatus.set(res.status || 'processing');
          this.startJobPolling(jobId);
        } else {
          this.isGenerating.set(false);
          this.generationError.set('No job ID returned from backend generation endpoint.');
        }
      },
      error: (err) => {
        this.isGenerating.set(false);
        const msg = err?.error?.message || err?.error?.error || err?.message || 'Generation request failed.';
        this.generationError.set(msg);
      }
    });
  }

  private startJobPolling(jobId: string): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }

    const POLLING_INTERVAL_MS = 10000; // 10 seconds interval
    const MAX_DURATION_MS = 20 * 60 * 1000; // 20 minutes timeout
    const startTime = Date.now();

    const pollFn = () => {
      if (Date.now() - startTime > MAX_DURATION_MS) {
        if (this.pollTimer) {
          clearInterval(this.pollTimer);
        }
        this.isGenerating.set(false);
        this.generationError.set('Generation timed out waiting for server completion after 20 minutes.');
        return;
      }

      this.generatorService.getJobStatus(jobId).subscribe({
        next: (res) => {
          const status = res?.status;
          if (status) {
            this.jobStatus.set(status);
            this.updateProjectJobInList(jobId, res);
          }

          if (status === 'completed') {
            if (this.pollTimer) {
              clearInterval(this.pollTimer);
            }
            this.isGenerating.set(false);

            if (res.artifact) {
              const artifactUrl = this.resolveArtifactUrl(res.artifact);
              this.generatedArtifactUrl.set(artifactUrl);
              this.generatedArtifactType.set(res.artifact.type === 'image' ? 'image' : 'video');
            }
            if (this.projectId()) {
              this.loadProjectJobs(this.projectId()!);
            }
          } else if (status === 'failed' || status === 'cancelled') {
            if (this.pollTimer) {
              clearInterval(this.pollTimer);
            }
            this.isGenerating.set(false);
            this.generationError.set(res.error || `Generation ${status}.`);
          }
        },
        error: (err) => {
          console.warn('Error polling job status:', err);
        }
      });
    };

    pollFn();
    this.pollTimer = setInterval(pollFn, POLLING_INTERVAL_MS);
  }

  copyPrompt(): void {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(this.promptText());
    }
  }

  ngOnDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
  }
}
