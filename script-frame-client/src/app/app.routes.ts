import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent),
    title: 'Sign In — Scriptframe'
  },
  {
    path: 'register',
    loadComponent: () => import('./features/auth/register.component').then((m) => m.RegisterComponent),
    title: 'Create Account — Scriptframe'
  },
  {
    path: 'projects',
    loadComponent: () => import('./features/projects/projects.component').then((m) => m.ProjectsComponent),
    canActivate: [authGuard],
    title: 'Projects — Scriptframe'
  },
  {
    path: 'generate',
    loadComponent: () => import('./features/generate/generate.component').then((m) => m.GenerateComponent),
    canActivate: [authGuard],
    title: 'Studio Generate'
  },
  {
    path: 'generate/:projectId',
    loadComponent: () => import('./features/generate/generate.component').then((m) => m.GenerateComponent),
    canActivate: [authGuard],
    title: 'Studio Generate'
  },
  {
    path: 'workflows',
    loadComponent: () => import('./features/workflows/workflows.component').then((m) => m.WorkflowsComponent),
    canActivate: [authGuard],
    title: 'Workflows'
  },
  {
    path: 'runs/new',
    loadComponent: () => import('./features/runs/create-run.component').then((m) => m.CreateRunComponent),
    canActivate: [authGuard],
    title: 'Create Run'
  },
  {
    path: 'runs/:id/review',
    loadComponent: () => import('./features/runs/review.component').then((m) => m.ReviewComponent),
    canActivate: [authGuard],
    title: 'Review'
  },
  {
    path: 'runs/:id/video',
    loadComponent: () => import('./features/runs/video.component').then((m) => m.VideoComponent),
    canActivate: [authGuard],
    title: 'Video'
  },
  { path: '', redirectTo: 'projects', pathMatch: 'full' }
];
