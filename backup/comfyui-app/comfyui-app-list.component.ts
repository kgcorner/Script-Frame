import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ComfyUIAppService } from '../../scriptframe-studio/src/app/services/comfyui-app.service';
import { WorkflowService } from '../../scriptframe-studio/src/app/services/workflow.service';
import { ComfyUIApp, ComfyUIAppUpdateRequest, ComfyUIAppPrimaryField } from '../../scriptframe-studio/src/app/models';

@Component({
  selector: 'app-comfyui-app-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './comfyui-app-list.component.html',
  styleUrl: './comfyui-app-list.component.scss'
})
export class ComfyUIAppListComponent implements OnInit {
  apps = signal<ComfyUIApp[]>([]);
  workflows = signal<any[]>([]);
  loading = signal(false);
  editingApp = signal<ComfyUIApp | null>(null);
  executingApp = signal<ComfyUIApp | null>(null);
  executing = signal(false);
  formData: ComfyUIAppUpdateRequest & { workflowId?: string } = {
    name: '',
    description: '',
    workflowId: '',
    primaryFields: [],
  };
  availableInputs = signal<Record<string, { nodeId: string; inputName: string; defaultValue: unknown; isPrimary: boolean }>>({});
  executeValues = signal<Record<string, unknown>>({});
  selectedPrimaryFieldKey = signal<string | null>(null);

  // Helper to check if availableInputs has any entries
  hasAvailableInputs(): boolean {
    return Object.keys(this.availableInputs()).length > 0;
  }

  // Get the currently selected primary field for config
  getSelectedPrimaryField(): ComfyUIAppPrimaryField | undefined {
    const key = this.selectedPrimaryFieldKey();
    if (!key) return undefined;
    return this.getPrimaryField(key);
  }

  constructor(
    private appService: ComfyUIAppService,
    private workflowService: WorkflowService
  ) {}

  ngOnInit() {
    this.loadApps();
    this.loadWorkflows();
  }

  loadApps() {
    this.loading.set(true);
    this.appService.getApps({ isActive: true }).subscribe({
      next: (res) => {
        this.apps.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load apps:', err);
        this.loading.set(false);
      }
    });
  }

  loadWorkflows() {
    this.workflowService.getWorkflows({ isActive: true }).subscribe({
      next: (res) => this.workflows.set(res.data),
      error: (err) => console.error('Failed to load workflows:', err)
    });
  }

  onWorkflowChange() {
    // Editing keeps the app's own workflow; inputs were loaded from the app definition
    // in loadWorkflowInputs. Keep this for future workflow re-selection support.
  }

  loadWorkflowInputs(workflowId: string) {
    // Apps created from a ComfyUI workflow carry their definition on the app row and
    // may not have a `workflows` row (slug workflowId). Resolve inputs from the app's
    // own definition via the backend, falling back to the workflows table.
    this.loadLocalWorkflowInputs(workflowId).subscribe({
      next: (workflow) => {
        this.extractInputs((workflow.data.definition as Record<string, any>) || {});
      },
      error: () => {
        const app = this.editingApp();
        if (app?.definition) {
          this.extractInputs(app.definition);
        }
      }
    });
  }

  private loadLocalWorkflowInputs(workflowId: string) {
    return this.workflowService.getWorkflow(workflowId);
  }

  extractInputs(definition: Record<string, any>) {
    const inputs: Record<string, { nodeId: string; inputName: string; defaultValue: unknown; isPrimary: boolean }> = {};
    
    for (const [nodeId, node] of Object.entries(definition)) {
      if (node.inputs) {
        for (const [inputName, defaultValue] of Object.entries(node.inputs)) {
          const key = `${nodeId}:${inputName}`;
          const existingPrimary = this.formData.primaryFields?.find(pf => pf.nodeId === nodeId && pf.inputName === inputName);
          
          inputs[key] = {
            nodeId,
            inputName,
            defaultValue,
            isPrimary: !!existingPrimary
          };
        }
      }
    }
    
    this.availableInputs.set(inputs);
  }

  togglePrimaryField(key: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    const inputs = this.availableInputs();
    inputs[key] = { ...inputs[key], isPrimary: checked };
    this.availableInputs.set({ ...inputs });

    if (checked) {
      const input = inputs[key];
      const newField: ComfyUIAppPrimaryField = {
        nodeId: input.nodeId,
        inputName: input.inputName,
        label: `${input.nodeId}.${input.inputName}`,
        aliasName: undefined,
        type: this.inferType(input.defaultValue),
        defaultValue: input.defaultValue,
        required: false,
        order: (this.formData.primaryFields?.length || 0) + 1,
      };
      this.formData.primaryFields = [...(this.formData.primaryFields || []), newField];
    } else {
      this.formData.primaryFields = this.formData.primaryFields?.filter(
        pf => `${pf.nodeId}:${pf.inputName}` !== key
      ) || [];
    }
  }

  inferType(value: unknown): 'string' | 'number' | 'boolean' | 'select' | 'file' | 'folder' {
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'string') {
      if (value.endsWith('.png') || value.endsWith('.jpg') || value.endsWith('.mp4')) return 'file';
      return 'string';
    }
    return 'string';
  }

  getPrimaryField(key: string): ComfyUIAppPrimaryField | undefined {
    return this.formData.primaryFields?.find(pf => `${pf.nodeId}:${pf.inputName}` === key);
  }

  updateSelectOptions(key: string, value: string) {
    const field = this.getPrimaryField(key);
    if (field) {
      field.options = value.split(',').map(s => s.trim()).filter(s => s);
    }
  }

  updatePrimaryField(key: string, property: string, event: Event) {
    const field = this.getPrimaryField(key);
    if (!field) return;
    
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    let value: any = target.type === 'checkbox' ? (target as HTMLInputElement).checked : target.value;
    
    // Convert numeric values
    if (property === 'order' || property === 'min' || property === 'max') {
      value = parseFloat(value) || 0;
    } else if (property === 'options') {
      value = value.split(',').map((s: string) => s.trim()).filter((s: string) => s);
    }
    
    (field as any)[property] = value;
  }

saveApp() {
    const app = this.editingApp();
    if (!app) return;

    this.loading.set(true);
    const request: ComfyUIAppUpdateRequest = {
      name: this.formData.name,
      description: this.formData.description,
      primaryFields: this.formData.primaryFields || [],
      defaultValues: {},
    };

    this.appService.updateApp(app.id, request).subscribe({
      next: () => {
        this.closeModal();
        this.loadApps();
      },
      error: (err) => {
        console.error('Failed to save app:', err);
        this.loading.set(false);
      }
    });
  }

  editApp(app: ComfyUIApp) {
    this.editingApp.set(app);
    this.formData = {
      name: app.name,
      description: app.description,
      workflowId: app.workflowId,
      primaryFields: [...app.primaryFields],
    };
    this.loadWorkflowInputs(app.workflowId);
  }

  deleteApp(appId: string) {
    if (confirm('Are you sure you want to delete this app?')) {
      this.appService.deleteApp(appId).subscribe({
        next: () => this.loadApps(),
        error: (err) => console.error('Failed to delete app:', err)
      });
    }
  }

  openExecuteModal(app: ComfyUIApp) {
    this.executingApp.set(app);
    this.executeValues.set({});
    for (const pf of app.primaryFields) {
      const key = `${pf.nodeId}:${pf.inputName}`;
      this.executeValues.update(v => ({ ...v, [key]: pf.defaultValue }));
    }
  }

  closeExecuteModal() {
    this.executingApp.set(null);
    this.executeValues.set({});
  }

  executingAppPrimaryFields(): ComfyUIAppPrimaryField[] {
    return this.executingApp()?.primaryFields || [];
  }

  getPrimaryValue(pf: ComfyUIAppPrimaryField): unknown {
    const key = `${pf.nodeId}:${pf.inputName}`;
    return this.executeValues()[key] ?? pf.defaultValue;
  }

  setPrimaryValue(pf: ComfyUIAppPrimaryField, event: Event) {
    const key = `${pf.nodeId}:${pf.inputName}`;
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    let value: any = target.type === 'checkbox' ? target.checked : target.value;
    
    // Convert numeric values for number type
    if (pf.type === 'number') {
      value = parseFloat(value) || 0;
    }
    
    this.executeValues.update(v => ({ ...v, [key]: value }));
  }

  executeApp() {
    const app = this.executingApp();
    if (!app) return;

    this.executing.set(true);
    const primaryValues: Record<string, unknown> = {};
    for (const pf of app.primaryFields) {
      const key = `${pf.nodeId}:${pf.inputName}`;
      primaryValues[key] = this.executeValues()[key] ?? pf.defaultValue;
    }

    this.appService.executeApp(app.id, { primaryValues }).subscribe({
      next: (res) => {
        this.executing.set(false);
        this.closeExecuteModal();
        alert(`Execution started! Prompt ID: ${res.data.promptId}`);
      },
      error: (err) => {
        console.error('Failed to execute app:', err);
        this.executing.set(false);
        alert(`Execution failed: ${err.message || 'Unknown error'}`);
      }
    });
  }

  closeModal() {
    this.editingApp.set(null);
    this.formData = {
      name: '',
      description: '',
      workflowId: '',
      primaryFields: [],
    };
    this.availableInputs.set({});
  }

  getWorkflowName(workflowId: string): string {
    return this.workflows().find(w => w.id === workflowId)?.name || workflowId;
  }
}
