import { Routes } from '@angular/router';
import { WorkflowEditorComponent } from './components/workflow-editor/workflow-editor';
import { WorkflowInputSelectorComponent } from './components/comfyui-app/workflow-input-selector.component';
import { LLMAppConfigComponent } from './components/llm-app/llm-app-config.component';

export const routes: Routes = [
  { path: '', redirectTo: '/workflow', pathMatch: 'full' },
  { path: 'workflow', component: WorkflowEditorComponent },
  { path: 'workflow/:id', component: WorkflowEditorComponent },
  { path: 'comfyui-apps', component: WorkflowInputSelectorComponent },
  { path: 'workflow-inputs', component: WorkflowInputSelectorComponent },
  { path: 'llm-app-config', component: LLMAppConfigComponent },
];
