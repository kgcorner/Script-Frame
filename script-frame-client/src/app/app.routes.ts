import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'workflows',
    loadComponent: () => import('./features/workflows/workflows.component').then((m) => m.WorkflowsComponent),
    title: 'Workflows'
  },
  {
    path: 'runs/new',
    loadComponent: () => import('./features/runs/create-run.component').then((m) => m.CreateRunComponent),
    title: 'Create Run'
  },
  {
    path: 'runs/:id/review',
    loadComponent: () => import('./features/runs/review.component').then((m) => m.ReviewComponent),
    title: 'Review'
  },
  {
    path: 'runs/:id/video',
    loadComponent: () => import('./features/runs/video.component').then((m) => m.VideoComponent),
    title: 'Video'
  },
  { path: '', redirectTo: 'workflows', pathMatch: 'full' }
];

