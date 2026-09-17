import { Routes } from '@angular/router';
import { WorkflowEditorComponent } from './components/workflow-editor/workflow-editor';
import { ComfyUIAppListComponent } from './components/comfyui-app/comfyui-app-list.component';
import { WorkflowInputSelectorComponent } from './components/comfyui-app/workflow-input-selector.component';

export const routes: Routes = [
  { path: '', redirectTo: '/workflow', pathMatch: 'full' },
  { path: 'workflow', component: WorkflowEditorComponent },
  { path: 'workflow/:id', component: WorkflowEditorComponent },
  { path: 'comfyui-apps', component: ComfyUIAppListComponent },
  { path: 'workflow-inputs', component: WorkflowInputSelectorComponent },
];
