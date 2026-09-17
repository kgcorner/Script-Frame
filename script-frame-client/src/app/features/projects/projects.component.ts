import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ProjectService, Project } from '../../core/services/project.service';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './projects.component.html',
  styleUrl: './projects.component.scss'
})
export class ProjectsComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly projectService = inject(ProjectService);

  // Search & Filter State
  readonly searchQuery = signal<string>('');
  readonly selectedFilter = signal<'all' | 'active' | 'draft' | 'completed'>('all');
  readonly isCreateModalOpen = signal<boolean>(false);
  readonly isLoading = signal<boolean>(false);
  readonly isCreating = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);

  // New Project Form State
  newProjectName = '';
  newProjectDescription = '';
  newProjectRatio = '16:9';
  newProjectModel = 'T2V MiniMax';

  readonly ratioOptions = [
    { id: '16:9', label: '16:9 Widescreen', icon: 'aspect_ratio' },
    { id: '9:16', label: '9:16 Vertical Reel', icon: 'crop_portrait' },
    { id: '1:1', label: '1:1 Square', icon: 'crop_square' },
    { id: '21:9', label: '21:9 CinemaScope', icon: 'panorama_wide_angle' }
  ];

  readonly modelOptions = [
    'T2V MiniMax',
    'I2V LTX',
    'I2V MiniMax',
    'T2V LTX',
    'Flux 1K'
  ];

  readonly projects = signal<Project[]>([]);

  ngOnInit(): void {
    this.loadProjects();
  }

  loadProjects(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.projectService.getProjects().subscribe({
      next: (data) => {
        this.isLoading.set(false);
        this.projects.set(data || []);
      },
      error: (err) => {
        this.isLoading.set(false);
        const message = err?.error?.message || err?.message || 'Failed to load projects from backend.';
        this.errorMessage.set(message);
        this.projects.set([]);
      }
    });
  }

  // Computed Filtered List
  readonly filteredProjects = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const filter = this.selectedFilter();

    return this.projects().filter((proj) => {
      const nameMatch = proj.name ? proj.name.toLowerCase().includes(query) : false;
      const descMatch = proj.description ? proj.description.toLowerCase().includes(query) : false;
      const modelMatch = proj.modelPreset ? proj.modelPreset.toLowerCase().includes(query) : false;

      const matchesSearch = !query || nameMatch || descMatch || modelMatch;
      const matchesFilter = filter === 'all' || proj.status === filter;

      return matchesSearch && matchesFilter;
    });
  });

  openCreateModal(): void {
    this.newProjectName = '';
    this.newProjectDescription = '';
    this.newProjectRatio = '16:9';
    this.newProjectModel = 'T2V MiniMax';
    this.errorMessage.set(null);
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  createProject(): void {
    if (!this.newProjectName.trim()) return;

    this.isCreating.set(true);
    this.errorMessage.set(null);

    const payload = {
      name: this.newProjectName.trim(),
      description: this.newProjectDescription.trim() || 'Custom video generation project',
      aspectRatio: this.newProjectRatio,
      modelPreset: this.newProjectModel,
      status: 'active'
    };

    this.projectService.createProject(payload).subscribe({
      next: (createdProject) => {
        this.isCreating.set(false);
        this.closeCreateModal();

        if (createdProject && createdProject.id) {
          this.projects.update((list) => [createdProject, ...list]);
          this.selectProject(createdProject.id);
        } else {
          this.loadProjects();
        }
      },
      error: (err) => {
        this.isCreating.set(false);
        const message = err?.error?.message || err?.message || 'Failed to create project on backend.';
        this.errorMessage.set(message);
      }
    });
  }

  deleteProject(projectId: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }

    if (!confirm('Are you sure you want to delete this project?')) {
      return;
    }

    this.projectService.deleteProject(projectId).subscribe({
      next: () => {
        this.projects.update((list) => list.filter((p) => p.id !== projectId));
      },
      error: (err) => {
        const message = err?.error?.message || err?.message || 'Failed to delete project.';
        alert(message);
      }
    });
  }

  selectProject(projectId: string): void {
    this.router.navigate(['/generate', projectId]);
  }

  formatDate(isoString?: string): string {
    if (!isoString) return 'Recently';
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return 'Recently';
    }
  }
}
