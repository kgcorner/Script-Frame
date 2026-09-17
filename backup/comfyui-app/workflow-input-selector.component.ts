import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WorkflowService, ComfyUISavedWorkflow, ComfyUIWorkflowsResponse } from '../../scriptframe-studio/src/app/services/workflow.service';
import { ComfyUIAppService } from '../../scriptframe-studio/src/app/services/comfyui-app.service';
import { Workflow } from '../../scriptframe-studio/src/app/models';
import { ComfyUIAppCreateRequest, ComfyUIAppPrimaryField, ComfyUIApp, ComfyUIAppUpdateRequest } from '../../scriptframe-studio/src/app/models';

interface WorkflowInputField {
  key: string;
  nodeId: string;
  nodeTitle: string;
  inputName: string;
  defaultValue: unknown;
  type: string;
  isPrimary: boolean;
  aliasName?: string; // User-defined alias for LLM to reference this field
  nodeType: string; // Node class_type for user-friendly display
  // Primary field configuration (only used when isPrimary is true)
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  tooltip?: string;
  required?: boolean;
  order?: number;
}

type WorkflowSource = 'local' | 'comfyui-saved' | 'comfyui-history';

// Tab types for the management interface
type AppTab = 'create' | 'manage';

@Component({
  selector: 'app-workflow-input-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './workflow-input-selector.component.html',
  styleUrl: './workflow-input-selector.component.scss'
})
export class WorkflowInputSelectorComponent implements OnInit {
  
  // Helper to get Object.keys in template
  getGroupedKeys(): string[] {
    return Object.keys(this.groupedFields());
  }
  
  // Local workflows from database
  localWorkflows = signal<Workflow[]>([]);
  // ComfyUI saved workflows
  comfyUISavedWorkflows = signal<ComfyUISavedWorkflow[]>([]);
  // ComfyUI history workflows
  comfyUIHistoryWorkflows = signal<ComfyUISavedWorkflow[]>([]);
  
  selectedWorkflowSource = signal<WorkflowSource>('local');
  selectedWorkflowId = signal<string>('');
  loading = signal(false);
  loadingInputs = signal(false);
  savingApp = signal(false);
  error = signal<string | null>(null);
  saveSuccess = signal<string | null>(null);
  
  // App management state
  activeTab = signal<AppTab>('create');
  apps = signal<ComfyUIApp[]>([]);
  loadingApps = signal(false);
  editingApp = signal<ComfyUIApp | null>(null);
  executingApp = signal<ComfyUIApp | null>(null);
  executing = signal(false);
  executeValues = signal<Record<string, unknown>>({});
  
  // App name input for saving as ComfyUI App
  appName = signal<string>('');
  appDescription = signal<string>('');
  
  // All extracted input fields from the selected workflow
  inputFields = signal<WorkflowInputField[]>([]);
  
  // Filtered fields for display
  searchTerm = signal('');
  
  // Computed filtered fields
  filteredFields = computed(() => {
    const term = this.searchTerm().toLowerCase();
    return this.inputFields().filter(field => 
      field.nodeTitle.toLowerCase().includes(term) ||
      field.inputName.toLowerCase().includes(term) ||
      field.nodeId.toLowerCase().includes(term)
    );
  });
  
  // Group fields by node for better organization
  groupedFields = computed(() => {
    const groups: Record<string, WorkflowInputField[]> = {};
    for (const field of this.filteredFields()) {
      if (!groups[field.nodeId]) {
        groups[field.nodeId] = [];
      }
      groups[field.nodeId].push(field);
    }
    return groups;
  });
  
  // Get workflows based on selected source
  getCurrentWorkflows = computed(() => {
    switch (this.selectedWorkflowSource()) {
      case 'comfyui-saved':
        return this.comfyUISavedWorkflows();
      case 'comfyui-history':
        return this.comfyUIHistoryWorkflows();
      default:
        return this.localWorkflows();
    }
  });
  
  // Check if selected workflow is from ComfyUI
  isComfyUIWorkflow = computed(() => {
    return this.selectedWorkflowSource() !== 'local';
  });
  
  // Check if save button should be enabled
  canSaveApp = computed(() => {
    return this.appName().trim().length > 0 && 
           this.getPrimaryFields().length > 0 &&
           this.selectedWorkflowId().length > 0;
  });
  
  // Available inputs as a record for template keyvalue pipe
  availableInputs = computed(() => {
    const inputs: Record<string, { nodeId: string; inputName: string; defaultValue: unknown; isPrimary: boolean }> = {};
    for (const field of this.inputFields()) {
      inputs[field.key] = {
        nodeId: field.nodeId,
        inputName: field.inputName,
        defaultValue: field.defaultValue,
        isPrimary: field.isPrimary
      };
    }
    return inputs;
  });
  
  // Helper to check if availableInputs has any entries
  hasAvailableInputs(): boolean {
    return this.inputFields().length > 0;
  }
  
  // Get the currently selected primary field for config
  getPrimaryField(key: string): WorkflowInputField | undefined {
    return this.inputFields().find(f => f.key === key);
  }
  
  // Update a primary field property
  updatePrimaryField(key: string, property: string, event: Event) {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    let value: any = target.type === 'checkbox' ? target.checked : target.value;
    
    // Convert numeric values for number type
    if (property === 'min' || property === 'max' || property === 'step' || property === 'order') {
      value = parseFloat(value) || 0;
    }
    
    // Parse options as comma-separated array
    if (property === 'options' && typeof value === 'string') {
      value = value.split(',').map(o => o.trim()).filter(o => o.length > 0);
    }
    
    this.inputFields.update(fields => 
      fields.map(f => {
        if (f.key === key && f.isPrimary) {
          return { ...f, [property]: value };
        }
        return f;
      })
    );
  }
  
  // Toggle primary field by key (used by modal checkbox)
  togglePrimaryFieldByKey(key: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.inputFields.update(fields => 
      fields.map(f => f.key === key ? { ...f, isPrimary: checked } : f)
    );
  }
  
  constructor(
    private workflowService: WorkflowService,
    private comfyUIAppService: ComfyUIAppService
  ) {}
  
  ngOnInit() {
    this.loadWorkflows();
    if (this.activeTab() === 'manage') {
      this.loadApps();
    }
  }
  
  loadWorkflows() {
    this.loading.set(true);
    
    // Load local workflows from database
    this.workflowService.getWorkflows({ isActive: true }).subscribe({
      next: (res) => {
        console.log('Local workflows loaded:', res.data);
        this.localWorkflows.set(res.data);
      },
      error: (err) => {
        console.error('Failed to load local workflows:', err);
      }
    });
    
    // Load ComfyUI saved workflows
    this.workflowService.getComfyUISavedWorkflows().subscribe({
      next: (res) => {
        console.log('ComfyUI saved workflows loaded:', res.data);
        this.comfyUISavedWorkflows.set(res.data);
      },
      error: (err) => console.error('Failed to load ComfyUI saved workflows:', err)
    });
    
    // Load ComfyUI history workflows
    this.workflowService.getComfyUIWorkflowHistory().subscribe({
      next: (res) => {
        console.log('ComfyUI history workflows loaded:', res.data);
        this.comfyUIHistoryWorkflows.set(res.data);
      },
      error: (err) => console.error('Failed to load ComfyUI history workflows:', err)
    });
    
    this.loading.set(false);
  }
  
  onWorkflowSourceChange() {
    this.selectedWorkflowId.set('');
    this.inputFields.set([]);
    this.searchTerm.set('');
    this.error.set(null);
    this.saveSuccess.set(null);
  }
  
  getWorkflowKey(wf: Workflow | ComfyUISavedWorkflow): string {
    // For ComfyUI workflows, use timestamp if available, otherwise name
    return 'id' in wf ? wf.id : (wf as ComfyUISavedWorkflow).timestamp.toString();
  }
  
  getWorkflowDisplayName(wf: Workflow | ComfyUISavedWorkflow): string {
    if ('name' in wf && wf.name) {
      return wf.name;
    }
    const key = this.getWorkflowKey(wf);
    if ('name' in wf) {
      return key;
    }
    return `ComfyUI Workflow ${key}`;
  }
  
  getSelectedWorkflowDefinition(): Record<string, any> | null {
    const workflows = this.getCurrentWorkflows();
    const key = this.selectedWorkflowId();
    const wf = workflows.find(w => this.getWorkflowKey(w) === key);
    console.log('getSelectedWorkflowDefinition:', { key, foundWf: wf, workflows: workflows.map(w => ({ name: 'name' in w ? w.name : 'no-name', hasWorkflow: 'workflow' in w, hasDefinition: 'definition' in w })) });
    // For ComfyUI workflows, the definition is stored in 'workflow' property
    if (wf && 'workflow' in wf) {
      const workflowData = (wf as ComfyUISavedWorkflow).workflow;
      console.log('ComfyUI workflow data:', workflowData);
      return workflowData;
    }
    // For local workflows, it's in 'definition'
    if (wf && 'definition' in wf) {
      return wf.definition;
    }
    return null;
  }
  
  onWorkflowSelect() {
    this.error.set(null);
    this.saveSuccess.set(null);
    this.inputFields.set([]);
    
    if (!this.selectedWorkflowId()) {
      return;
    }
    
    this.loadingInputs.set(true);
    console.log('onWorkflowSelect:', { source: this.selectedWorkflowSource(), id: this.selectedWorkflowId() });
    
    // For local workflows, load from database
    if (this.selectedWorkflowSource() === 'local') {
      this.workflowService.getWorkflow(this.selectedWorkflowId()).subscribe({
        next: (res) => {
          console.log('Local workflow loaded:', res);
          const definition = res.data.definition as Record<string, any> || {};
          this.extractInputs(definition);
        },
        error: (err) => {
          console.error('Failed to load workflow:', err);
          this.error.set('Failed to load workflow inputs');
          this.loadingInputs.set(false);
        }
      });
    } else {
      // For ComfyUI saved/history workflows, get from stored definition
      const workflows = this.getCurrentWorkflows();
      const key = this.selectedWorkflowId();
      console.log('Available workflows for source:', this.selectedWorkflowSource(), workflows.map(w => ({ 
        key: this.getWorkflowKey(w), 
        name: 'name' in w ? w.name : 'no-name',
        hasWorkflow: 'workflow' in w,
        hasDefinition: 'definition' in w
      })));
      
      const definition = this.getSelectedWorkflowDefinition();
      console.log('Selected ComfyUI workflow definition:', definition);
      if (definition) {
        this.extractInputs(definition);
      } else {
        this.error.set('Could not load workflow definition');
        this.loadingInputs.set(false);
      }
    }
  }
  
  // Switch between Create and Manage tabs
  setActiveTab(tab: AppTab) {
    this.activeTab.set(tab);
    if (tab === 'manage') {
      this.loadApps();
    } else {
      // Clear editing state when switching back to create
      this.editingApp.set(null);
      this.executingApp.set(null);
    }
  }
  
  loadApps() {
    this.loadingApps.set(true);
    this.comfyUIAppService.getApps({ isActive: true }).subscribe({
      next: (res) => {
        this.apps.set(res.data);
        this.loadingApps.set(false);
      },
      error: (err) => {
        console.error('Failed to load apps:', err);
        this.error.set('Failed to load ComfyUI apps');
        this.loadingApps.set(false);
      }
    });
  }
  
  extractInputs(definition: Record<string, any>) {
    console.log('extractInputs called with definition:', definition);
    
    // Handle both ComfyUI API format (nodeId -> {class_type, inputs}) and Editor format ({nodes: [...], links: [...]})
    let apiFormatDefinition: Record<string, any> = definition;
    
    // Check if it's editor format (has nodes array)
    if (definition['nodes'] && Array.isArray(definition['nodes'])) {
      console.log('Detected editor format, converting to API format...');
      apiFormatDefinition = this.convertEditorFormatToApiFormat(definition);
      console.log('Converted to API format:', apiFormatDefinition);
    } else {
      console.log('Using definition as API format (object with nodeId keys)');
    }
    
    const fields: WorkflowInputField[] = [];
    const nodeNames: Record<string, string> = {};
    
    // Only filter out truly internal ComfyUI fields, not user-relevant ones like prompt, width, height, etc.
    const internalValues = new Set([
      'class_type',  // Internal ComfyUI field
      '_meta',       // Internal ComfyUI metadata
      'pos', 'neg'   // Internal positive/negative conditioning references
    ]);
    
    // Extract node names from _meta if available
    for (const [nodeId, nodeData] of Object.entries(apiFormatDefinition)) {
      if (nodeData._meta?.title) {
        nodeNames[nodeId] = nodeData._meta.title;
      }
    }
    
    // If no _meta titles, try to get from node data or use nodeId
    for (const [nodeId, nodeData] of Object.entries(apiFormatDefinition)) {
      const inputs = nodeData.inputs;
      console.log(`Processing node ${nodeId}:`, { class_type: nodeData.class_type, inputs: inputs, _meta: nodeData._meta });
      if (inputs && typeof inputs === 'object') {
        const title = nodeNames[nodeId] || nodeData.class_type || nodeId;
        for (const [inputName, defaultValue] of Object.entries(inputs)) {
          // Skip internal ComfyUI fields
          if (inputName.startsWith('_') || inputName === 'class_type') continue;
          
          // Skip known internal/system values (only truly internal ones)
          if (internalValues.has(inputName)) {
            console.log(`Skipping internal field: ${nodeId}:${inputName} =`, defaultValue);
            continue;
          }
          
          const key = `${nodeId}:${inputName}`;
          const inferredType = this.inferType(defaultValue);
          
          // Keep complex objects as-is for default values (they'll be passed through)
          if (defaultValue && typeof defaultValue === 'object' && !Array.isArray(defaultValue)) {
            console.log(`Complex object field kept: ${nodeId}:${inputName} =`, defaultValue);
          }
          
          fields.push({
            key,
            nodeId,
            nodeTitle: title,
            nodeType: nodeData.class_type || 'Unknown',
            inputName,
            defaultValue,
            type: inferredType,
            isPrimary: false,
            aliasName: inputName // Default alias to inputName
          });
        }
    }
    
    console.log('Extracted fields:', fields);
    this.inputFields.set(fields);
    this.loadingInputs.set(false);
      fields.map(f => f.key === field.key ? { ...f, isPrimary: !f.isPrimary } : f)
    );
  }
  
  getPrimaryFields(): WorkflowInputField[] {
    return this.inputFields().filter(f => f.isPrimary);
  }
  
  getNodeDisplayName(field: WorkflowInputField): string {
    return `${field.inputName} (${field.nodeTitle})`;
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
  
  formatValue(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
  
  copyPrimaryFieldsConfig() {
    const primaryFields = this.getPrimaryFields().map(f => ({
      nodeId: f.nodeId,
      inputName: f.inputName,
      label: f.inputName,
      aliasName: f.aliasName,
      type: f.type as 'string' | 'number' | 'boolean' | 'select' | 'file' | 'folder',
      defaultValue: f.defaultValue,
      required: false,
      order: 0
    }));
    
    const config = JSON.stringify(primaryFields, null, 2);
    navigator.clipboard.writeText(config).then(() => {
      alert('Primary fields configuration copied to clipboard!');
    });
  }
  
  saveAsApp() {
    if (!this.canSaveApp()) return;
    
    this.savingApp.set(true);
    this.error.set(null);
    this.saveSuccess.set(null);
    
    const primaryFields = this.getPrimaryFields().map((f, index) => ({
      nodeId: f.nodeId,
      inputName: f.inputName,
      label: f.inputName,
      aliasName: f.aliasName,
      type: f.type as 'string' | 'number' | 'boolean' | 'select' | 'file' | 'folder',
      defaultValue: f.defaultValue,
      required: false,
      order: index
    }));
    
    const defaultValues: Record<string, unknown> = {};
    for (const field of primaryFields) {
      defaultValues[`${field.nodeId}:${field.inputName}`] = field.defaultValue;
    }
    
    // For ComfyUI workflows, we need to get the internal workflow ID
    const workflowId = this.getWorkflowIdForSave();
    
    // The backend needs the ComfyUI API-format definition ({ nodeId: { class_type, inputs, _meta } })
    // to store on the app row. ComfyUI saved/history workflows store the editor format
    // ({ nodes: [...] }), so convert it here.
    let workflowDefinition: Record<string, any> | null = this.getSelectedWorkflowDefinition();
    if (workflowDefinition && Array.isArray(workflowDefinition['nodes'])) {
      workflowDefinition = this.convertToComfyUIWorkflowFormat(workflowDefinition) as Record<string, any>;
    }
    
    if (!workflowDefinition || Object.keys(workflowDefinition).length === 0) {
      this.error.set('Failed to save app: could not resolve the workflow definition for the selected workflow.');
      this.savingApp.set(false);
      return;
    }
    
    const request: ComfyUIAppCreateRequest = {
      name: this.appName().trim(),
      description: this.appDescription().trim() || undefined,
      workflowId: workflowId,
      workflowDefinition,
      primaryFields,
      defaultValues
    };
    
    this.comfyUIAppService.createApp(request).subscribe({
      next: (response) => {
        if (response.success) {
          this.saveSuccess.set(`Successfully created ComfyUI App "${response.data.name}" (ID: ${response.data.id})`);
          // Reset form
          this.appName.set('');
          this.appDescription.set('');
          // Uncheck all primary fields
          this.inputFields.update(fields => fields.map(f => ({ ...f, isPrimary: false })));
        } else {
          this.error.set('Failed to create app: ' + ((response as any).error || 'Unknown error'));
        }
        this.savingApp.set(false);
      },
      error: (err) => {
        this.error.set('Failed to save app: ' + (err.message || 'Unknown error'));
        this.savingApp.set(false);
      }
    });
  }
  
  // Get workflow ID for saving - for ComfyUI workflows we use the prompt_id or generate one
  getWorkflowIdForSave(): string {
    if (this.selectedWorkflowSource() === 'local') {
      return this.selectedWorkflowId();
    }
    // For ComfyUI workflows, use the timestamp as the workflowId reference
    const workflows = this.getCurrentWorkflows();
    const key = this.selectedWorkflowId();
    const wf = workflows.find(w => this.getWorkflowKey(w) === key);
    if (wf && 'timestamp' in wf) {
      return (wf as ComfyUISavedWorkflow).timestamp.toString();
    }
    return key;
  }
  
  convertToComfyUIWorkflowFormat(editorFormat: Record<string, any>): Record<string, any> {
    // Convert from editor format { nodes: [...] } to ComfyUI API format { nodeId: { class_type, inputs, _meta } }
    const result: Record<string, any> = {};
    const nodes = editorFormat['nodes'];
    if (nodes && Array.isArray(nodes)) {
      for (const node of nodes) {
        result[node.id] = {
          class_type: node.type,
          inputs: node.inputs || {},
          _meta: node._meta || { title: node.title || node.type }
        };
      }
    }
    return result;
  }
  
  // ============ APP MANAGEMENT METHODS ============
  
  getWorkflowName(workflowId: string): string {
    // Try to find in local workflows
    const local = this.localWorkflows().find(w => w.id === workflowId);
    if (local) return local.name;
    // Try ComfyUI saved
    const saved = this.comfyUISavedWorkflows().find(w => w.timestamp.toString() === workflowId || w.name === workflowId);
    if (saved) return saved.name || `ComfyUI Workflow ${saved.timestamp.toString().substring(0, 8)}`;
    return workflowId;
  }
  
  editApp(app: ComfyUIApp) {
    // Switch to create tab and load the app's data
    this.activeTab.set('create');
    this.editingApp.set(app);
    this.error.set(null);
    this.saveSuccess.set(null);
    
    // Pre-fill form with app data
    this.appName.set(app.name);
    this.appDescription.set(app.description || '');
    this.selectedWorkflowSource.set('local'); // We'll load the workflow inputs based on app's workflowId
    this.selectedWorkflowId.set(app.workflowId);
    
    // Load the workflow inputs from the app's definition
    this.loadWorkflowInputs(app.workflowId);
    
    // Pre-check primary fields
    this.inputFields.update(fields => 
      fields.map(f => {
        const primaryField = app.primaryFields.find(pf => `${pf.nodeId}:${pf.inputName}` === f.key);
        if (primaryField) {
          return { 
            ...f, 
            isPrimary: true,
            aliasName: primaryField.aliasName
          };
        }
        return f;
      })
    );
  }
  
  loadWorkflowInputs(workflowId: string) {
    this.loadingInputs.set(true);
    
    // Try to load from local workflows first
    this.workflowService.getWorkflow(workflowId).subscribe({
      next: (res) => {
        const definition = res.data.definition as Record<string, any> || {};
        this.extractInputs(definition);
      },
      error: () => {
        // If workflow not found locally, try using the app's own definition
        const app = this.editingApp();
        if (app?.definition) {
          this.extractInputs(app.definition);
        } else {
          this.loadingInputs.set(false);
        }
      }
    });
  }
  
  saveApp() {
    const app = this.editingApp();
    if (!app) return;
    
    if (!this.canSaveApp()) return;
    
    this.savingApp.set(true);
    this.error.set(null);
    this.saveSuccess.set(null);
    
    const primaryFields = this.getPrimaryFields().map((f, index) => ({
      nodeId: f.nodeId,
      inputName: f.inputName,
      label: f.inputName,
      aliasName: f.aliasName,
      type: f.type as 'string' | 'number' | 'boolean' | 'select' | 'file' | 'folder',
      defaultValue: f.defaultValue,
      required: false,
      order: index
    }));
    
    const defaultValues: Record<string, unknown> = {};
    for (const field of primaryFields) {
      defaultValues[`${field.nodeId}:${field.inputName}`] = field.defaultValue;
    }
    
    const request: ComfyUIAppUpdateRequest = {
      name: this.appName().trim(),
      description: this.appDescription().trim() || undefined,
      primaryFields,
      defaultValues
    };
    
    this.comfyUIAppService.updateApp(app.id, request).subscribe({
      next: (response) => {
        if (response.success) {
          this.saveSuccess.set(`Successfully updated ComfyUI App "${response.data.name}"`);
          this.closeModal();
          // Reload apps if on manage tab
          if (this.activeTab() === 'manage') {
            this.loadApps();
          }
        } else {
          this.error.set('Failed to update app: ' + ((response as any).error || 'Unknown error'));
        }
        this.savingApp.set(false);
      },
      error: (err) => {
        this.error.set('Failed to update app: ' + (err.message || 'Unknown error'));
        this.savingApp.set(false);
      }
    });
  }
  
  deleteApp(appId: string, event: Event) {
    event.stopPropagation();
    if (confirm('Are you sure you want to delete this app?')) {
      this.comfyUIAppService.deleteApp(appId).subscribe({
        next: () => {
          this.loadApps();
        },
        error: (err) => {
          console.error('Failed to delete app:', err);
          this.error.set('Failed to delete app: ' + (err.message || 'Unknown error'));
        }
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
    
    this.comfyUIAppService.executeApp(app.id, { primaryValues }).subscribe({
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
    this.appName.set('');
    this.appDescription.set('');
    this.selectedWorkflowId.set('');
    this.inputFields.set([]);
    this.searchTerm.set('');
    this.error.set(null);
    this.saveSuccess.set(null);
  }
  
  // Check if we're in edit mode
  isEditing(): boolean {
    return this.editingApp() !== null;
  }
}
