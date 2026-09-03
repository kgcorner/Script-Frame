import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ComfyUIAppService } from '../../services/comfyui-app.service';
import { WorkflowService } from '../../services/workflow.service';
import { ComfyUISavedWorkflow } from '../../services/workflow.service';
import { ComfyUIApp, ComfyUIAppCreateRequest, ComfyUIAppPrimaryField } from '../../models';

// Internal representation of a workflow input field extracted for the UI.
interface WorkflowInputField {
  key: string;
  nodeId: string;
  nodeTitle: string;
  nodeType: string; // class_type used to group fields by node type
  inputName: string;
  defaultValue: unknown;
  type: 'string' | 'number' | 'boolean' | 'select' | 'file' | 'folder';
  isPrimary: boolean;
  aliasName?: string;
  label?: string;
  options?: string[];
  tooltip?: string;
  required?: boolean;
  order?: number;
  min?: number;
  max?: number;
  step?: number;
}

// Tab types for the management interface.
type AppTab = 'create' | 'manage';

// A grouped list of fields belonging to one node.
interface FieldGroup {
  nodeId: string;
  title: string;
  nodeType: string;
  fields: WorkflowInputField[];
  hasPrimary: boolean;
  primaryCount: number;
}

@Component({
  selector: 'app-workflow-input-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './workflow-input-selector.component.html',
  styleUrl: './workflow-input-selector.component.scss'
})
export class WorkflowInputSelectorComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // ComfyUI saved workflows fetched from the comfyUI server.
  comfyUISavedWorkflows = signal<ComfyUISavedWorkflow[]>([]);

  selectedWorkflowId = signal<string>('');
  loading = signal(false);
  loadingInputs = signal(false);
  savingApp = signal(false);
  error = signal<string | null>(null);
  saveSuccess = signal<string | null>(null);

  // Fields matching the current search term.
  filteredFields = computed<WorkflowInputField[]>(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.inputFields();
    return this.inputFields().filter(f =>
      f.inputName.toLowerCase().includes(term) ||
      (f.nodeTitle || '').toLowerCase().includes(term) ||
      (f.nodeType || '').toLowerCase().includes(term) ||
      (f.aliasName || '').toLowerCase().includes(term) ||
      String(f.defaultValue ?? '').toLowerCase().includes(term)
    );
  });

  // Fields grouped by their originating node (keeps a node's inputs together).
  // Primary counts are precomputed here because arrow functions cannot be used
  // in Angular templates.
  groupedFields = computed<FieldGroup[]>(() => {
    const groups = new Map<string, FieldGroup>();
    for (const field of this.filteredFields()) {
      let group = groups.get(field.nodeId);
      if (!group) {
        group = { nodeId: field.nodeId, title: field.nodeTitle, nodeType: field.nodeType, fields: [], hasPrimary: false, primaryCount: 0 };
        groups.set(field.nodeId, group);
      }
      group.fields.push(field);
      if (field.isPrimary) {
        group.hasPrimary = true;
        group.primaryCount++;
      }
    }
    return Array.from(groups.values());
  });

  // Summary stats for the UI.
  totalFieldCount = computed(() => this.inputFields().length);
  visibleFieldCount = computed(() => this.filteredFields().length);
  nodeCount = computed(() => new Set(this.inputFields().map(f => f.nodeId)).size);
  primaryCount = computed(() => this.inputFields().filter(f => f.isPrimary).length);

  // True when the selected workflow id doesn't match any saved workflow on the
  // ComfyUI server (e.g. editing an app whose workflow was renamed or removed).
  workflowMissing = computed(() => {
    const id = this.selectedWorkflowId();
    if (!id) return false;
    return !this.comfyUISavedWorkflows().some(w => this.getWorkflowKey(w) === id);
  });

  // Expand/collapse every node group at once.
  allExpanded = signal(true);
  toggleAllExpanded(): void {
    this.allExpanded.update(v => !v);
  }

  constructor(
    private appService: ComfyUIAppService,
    private workflowService: WorkflowService
  ) {}

  ngOnInit(): void {
    this.loadWorkflows();
    if (this.activeTab() === 'manage') {
      this.loadApps();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadWorkflows(): void {
    this.loading.set(true);
    // ComfyUI saved workflows (from the comfyUI server).
    this.workflowService.getComfyUISavedWorkflows().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        if (res.success) {
          this.comfyUISavedWorkflows.set(res.data);
        } else {
          this.error.set('Failed to load saved workflows');
        }
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load workflows:', err);
        this.error.set('Failed to load workflows');
        this.loading.set(false);
      }
    });
  }


  // App management state.
  activeTab = signal<AppTab>('create');
  apps = signal<ComfyUIApp[]>([]);
  loadingApps = signal(false);
  editingApp = signal<ComfyUIApp | null>(null);

  // App name/description inputs for create/edit.
  appName = signal<string>('');
  appDescription = signal<string>('');

  // All extracted input fields from the selected workflow.
  inputFields = signal<WorkflowInputField[]>([]);
  // Free-text filter over the extracted fields.
  searchTerm = signal<string>('');

  loadApps(): void {
    this.loadingApps.set(true);
    this.appService.getApps({ isActive: true }).pipe(takeUntil(this.destroy$)).subscribe({
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

  // Convert a saved workflow definition into the API format (nodeId -> {class_type, inputs}).
  private normalizeWorkflow(definition: Record<string, any>): Record<string, any> {
    if (!definition) return {};
    if (definition['nodes'] && Array.isArray(definition['nodes'])) {
      const normalized: Record<string, any> = {};
      for (const node of definition['nodes']) {
        if (!node || typeof node !== 'object') continue;
        const nodeType = node.type || 'Unknown';
        const nodeId = String(node.id ?? nodeType);
        normalized[nodeId] = {
          class_type: nodeType,
          inputs: this.extractNodeWidgetValues(node),
          _meta: { title: node.title || nodeType || nodeId },
        };
      }
      return normalized;
    }
    return definition;
  }

  // Pull widget values out of a single editor-format node.
  // The editor JSON stores `inputs` as an array of link descriptors and the
  // actual values in `widgets_values`/`widgets_values_named` (positional pairs).
  // Every widget value is exposed as an editable field — no filtering — so the
  // app designer decides which ones become primary inputs.
  private extractNodeWidgetValues(node: Record<string, any>): Record<string, any> {
    const inputs: Record<string, any> = {};

    // Preferred: named values (saved by recent ComfyUI versions).
    const named = node['widgets_values_named'];
    if (named && typeof named === 'object' && !Array.isArray(named)) {
      for (const [name, value] of Object.entries(named)) {
        inputs[name] = value;
      }
      return inputs;
    }

    // Fallback: pair the positional `widgets_values` array with the inputs.
    let values = Array.isArray(node['widgets_values']) ? node['widgets_values'] : [];
    if (!Array.isArray(node['widgets_values']) && node['widgets_values'] && typeof node['widgets_values'] === 'object') {
      values = Object.values(node['widgets_values']);
    }
    const inputsArr = Array.isArray(node['inputs']) ? node['inputs'] : [];
    // Widget-capable inputs are those with a `widget` descriptor or a scalar
    // type and no link (they hold a value, not a connection).
    const widgetEntries = inputsArr.filter((e: any) => e && typeof e === 'object' &&
      (e.widget || (e.name && e.link === null && typeof e.type === 'string')));
    widgetEntries.forEach((e: any, idx: number) => {
      if (idx >= values.length || !e.name) return;
      inputs[e.name] = values[idx];
    });
    return inputs;
  }

  // Extract all input fields from a workflow definition. All fields are kept —
  // the only exclusions are structural keys and ComfyUI link references (which
  // are connections, not user-editable values).
  extractInputs(definition: Record<string, any>): WorkflowInputField[] {
    const apiFormat = this.normalizeWorkflow(definition);
    const nodeNames: Record<string, string> = {};
    for (const [nodeId, nodeData] of Object.entries(apiFormat)) {
      if (nodeData._meta?.title) {
        nodeNames[nodeId] = nodeData._meta.title;
      }
    }

    const fields: WorkflowInputField[] = [];

    for (const [nodeId, nodeData] of Object.entries(apiFormat)) {
      if (!nodeData.inputs || typeof nodeData.inputs !== 'object') continue;
      const title = nodeNames[nodeId] || nodeData.class_type || nodeId;
      for (const [inputName, defaultValue] of Object.entries(nodeData.inputs)) {
        // Skip ComfyUI structural keys.
        if (inputName === 'class_type' || inputName === '_meta') continue;
        // Skip ComfyUI link references like ["MODEL", "7"] (connected inputs,
        // not user-editable widget values).
        if (Array.isArray(defaultValue) && defaultValue.length === 2 &&
            typeof defaultValue[0] === 'string' && typeof defaultValue[1] === 'string') {
          continue;
        }

        const key = `${nodeId}:${inputName}`;
        const inferredType = this.inferType(defaultValue);
        fields.push({
          key,
          nodeId,
          nodeTitle: title,
          nodeType: nodeData.class_type || 'Unknown',
          inputName,
          defaultValue,
          type: inferredType,
          isPrimary: false,
          aliasName: inputName,
        });
      }
    }

    return fields;
  }



  // Infer a friendly input type from the default value.
  inferType(defaultValue: unknown): 'string' | 'number' | 'boolean' | 'select' | 'file' | 'folder' {
    if (defaultValue === true || defaultValue === false) return 'boolean';
    if (typeof defaultValue === 'number') return 'number';
    if (Array.isArray(defaultValue)) return 'string';
    const str = String(defaultValue).toLowerCase();
    if (str.startsWith('http')) return 'file';
    if (['folder', 'directory'].includes(str)) return 'folder';
    if (str.includes(':') && !isNaN(Number(str))) return 'number';
    return 'string';
  }

  // Human-readable preview of a default value.
  formatValue(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  // Build a stable key for tracking options in the template.
  getWorkflowKey(workflow: ComfyUISavedWorkflow): string {
    return workflow.name;
  }

  // Human-readable display name for a workflow option.
  getWorkflowDisplayName(workflow: ComfyUISavedWorkflow): string {
    return workflow.name;
  }

  onWorkflowSelect(): void {
    if (!this.selectedWorkflowId()) return;
    const workflow = this.getWorkflowById(this.selectedWorkflowId());
    if (!workflow) return;

    this.loadingInputs.set(true);
    this.error.set(null);
    this.searchTerm.set('');
    this.allExpanded.set(true);
    this.inputFields.set(this.extractInputs(workflow.workflow));
    this.loadingInputs.set(false);
  }

  private getWorkflowById(id: string): ComfyUISavedWorkflow | undefined {
    // Match the key used by the <select> options, or a plain workflow name
    // (used when restoring an app's workflowId on edit).
    return this.comfyUISavedWorkflows().find(w => this.getWorkflowKey(w) === id || w.name === id);
  }

  // Toggle whether a field is a primary field.
  togglePrimary(field: WorkflowInputField): void {
    const next = !field.isPrimary;
    this.inputFields.update(fields => fields.map(f => f.key === field.key ? { ...f, isPrimary: next } : f));
  }

  // Set the alias name for a primary field. `value` comes from the
  // (ngModelChange) event on the alias input.
  updateAlias(field: WorkflowInputField, value: string): void {
    this.inputFields.update(fields => fields.map(f => f.key === field.key ? { ...f, aliasName: value } : f));
  }

  clearSearch(): void {
    this.searchTerm.set('');
  }


  // Build the create/update payload from current UI state.
  buildAppPayload(): ComfyUIAppCreateRequest | null {
    const editing = this.editingApp();
    const workflow = this.getWorkflowById(this.selectedWorkflowId());

    const primaryFields: ComfyUIAppPrimaryField[] = [];
    for (const field of this.inputFields()) {
      if (!field.isPrimary) continue;
      primaryFields.push({
        nodeId: field.nodeId,
        inputName: field.inputName,
        label: field.label || field.inputName,
        aliasName: field.aliasName ?? undefined,
        type: field.type,
        defaultValue: field.defaultValue,
        options: field.options ?? undefined,
        tooltip: field.tooltip ?? undefined,
        min: field.min ?? undefined,
        max: field.max ?? undefined,
        step: field.step ?? undefined,
        required: field.required ?? false,
        order: field.order ?? 0,
      });
    }

    if (primaryFields.length === 0) return null;

    // Default values keyed by <nodeId>:<inputName> so the backend's execute
    // merge can restore them when the user doesn't override a primary field.
    const defaultValues: Record<string, unknown> = {};
    for (const field of this.inputFields()) {
      defaultValues[field.key] = field.defaultValue;
    }

    // When editing, fall back to the app's stored definition if the workflow is
    // no longer present in the loaded list.
    const workflowDefinition = workflow
      ? this.normalizeWorkflow(workflow.workflow)
      : (editing?.definition ?? undefined);

    const payload: ComfyUIAppCreateRequest = {
      name: this.appName(),
      description: this.appDescription() || undefined,
      workflowId: workflow?.name ?? editing?.workflowId ?? '',
      primaryFields,
      defaultValues,
    };

    // Embed the definition in the API format (nodeId -> {class_type, inputs})
    // so the backend's execute/merge logic can resolve it without a DB row.
    if (workflowDefinition && Object.keys(workflowDefinition).length > 0) {
      payload.workflowDefinition = workflowDefinition as Record<string, unknown>;
    }

    return payload;
  }

  canSaveApp(): boolean {
    const payload = this.buildAppPayload();
    if (!payload) return false;
    return payload.name.trim().length > 0 && payload.primaryFields.length > 0;
  }

  saveApp(): void {
    const payload = this.buildAppPayload();
    if (!payload || !this.canSaveApp()) {
      this.error.set('Please enter an app name and select at least one primary field.');
      return;
    }

    this.savingApp.set(true);
    this.saveSuccess.set(null);
    this.error.set(null);

    if (this.editingApp()) {
      const app = this.editingApp();
      if (!app) return;
      this.appService.updateApp(app.id, {
        name: payload.name,
        description: payload.description ?? undefined,
        primaryFields: payload.primaryFields,
        defaultValues: payload.defaultValues ?? {},
        isActive: true,
      }).pipe(takeUntil(this.destroy$)).subscribe({
        next: (response) => {
          this.savingApp.set(false);
          if (response.success) {
            this.closeModal();
            this.loadApps();
            this.saveSuccess.set(`Successfully updated ComfyUI App "${payload.name}"`);
          } else {
            this.error.set(response.data?.error || 'Failed to update app');
          }
        },
        error: (err) => {
          this.savingApp.set(false);
          this.error.set('Failed to update app: ' + (err.message || 'Unknown error'));
        }
      });
    } else {
      this.appService.createApp(payload).pipe(takeUntil(this.destroy$)).subscribe({
        next: (response) => {
          this.savingApp.set(false);
          if (response.success) {
            this.closeModal();
            this.loadApps();
            this.saveSuccess.set(`Successfully created ComfyUI App "${payload.name}"`);
          } else {
            this.error.set(response.data?.error || 'Failed to create app');
          }
        },
        error: (err) => {
          this.savingApp.set(false);
          this.error.set('Failed to create app: ' + (err.message || 'Unknown error'));
        }
      });
    }
  }

  deleteApp(appId: string): void {
    if (!confirm('Are you sure you want to delete this app?')) return;
    this.appService.deleteApp(appId).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.loadApps();
      },
      error: (err) => {
        console.error('Failed to delete app:', err);
        this.error.set('Failed to delete app: ' + (err.message || 'Unknown error'));
      }
    });
  }

  editApp(app: ComfyUIApp): void {
    this.editingApp.set(app);
    // Open the unified editor view pre-filled with the app's configuration.
    this.activeTab.set('create');
    this.error.set(null);
    this.saveSuccess.set(null);
    this.appName.set(app.name);
    this.appDescription.set(app.description ?? '');
    // Pre-select the workflow referenced by this app.
    const found = this.comfyUISavedWorkflows().find(w => w.name === app.workflowId);
    if (found) {
      this.selectedWorkflowId.set(this.getWorkflowKey(found));
      this.inputFields.set(this.extractInputs(found.workflow));
    } else {
      // The workflow may have been removed from ComfyUI since the app was
      // created. Use the definition stored on the app row so edits still work.
      this.selectedWorkflowId.set(app.workflowId);
      this.inputFields.set(app.definition ? this.extractInputs(app.definition) : []);
    }
    // Re-apply saved primary-field config so edits keep the existing settings.
    this.applySavedPrimaryFields(app);
  }

  // Mark the app's configured primary fields on the freshly-extracted inputs.
  private applySavedPrimaryFields(app: ComfyUIApp): void {
    const primaryByKey = new Map<string, ComfyUIAppPrimaryField>();
    for (const pf of app.primaryFields ?? []) {
      primaryByKey.set(`${pf.nodeId}:${pf.inputName}`, pf);
    }
    this.inputFields.update(fields => fields.map(f => {
      const saved = primaryByKey.get(f.key);
      if (!saved) return f;
      return {
        ...f,
        isPrimary: true,
        label: saved.label,
        aliasName: saved.aliasName,
        options: saved.options,
        tooltip: saved.tooltip,
        min: saved.min,
        max: saved.max,
        step: saved.step,
        required: saved.required,
        order: saved.order,
      };
    }));
  }

  closeModal(): void {
    const wasEditing = this.editingApp() !== null;
    this.editingApp.set(null);
    this.appName.set('');
    this.appDescription.set('');
    this.selectedWorkflowId.set('');
    this.inputFields.set([]);
    this.error.set(null);
    this.saveSuccess.set(null);
    // Cancelled/finished an edit: return to the manage list.
    if (wasEditing) this.activeTab.set('manage');
  }

  isEditing(): boolean {
    return this.editingApp() !== null;
  }

  // Switch between the Create and Manage tabs. Explicitly entering the create
  // tab always starts a fresh create (any in-progress edit is discarded).
  setActiveTab(tab: AppTab): void {
    this.activeTab.set(tab);
    if (tab === 'manage') {
      this.loadApps();
    } else {
      this.editingApp.set(null);
      this.appName.set('');
      this.appDescription.set('');
      this.selectedWorkflowId.set('');
      this.inputFields.set([]);
      this.error.set(null);
    }
  }

  // Template helper: number of configured primary fields for an app.
  primaryFields(app: ComfyUIApp): number {
    return app.primaryFields?.length ?? 0;
  }

  // Update the editing app's field from a two-way bound input. If no app is being edited,
  // fall back to updating the create-mode name/description signals.
  onEditFieldChange(field: 'name' | 'description', value: string): void {
    const app = this.editingApp();
    if (app) {
      if (field === 'name') app.name = value;
      else app.description = value;
    } else {
      if (field === 'name') this.appName.set(value);
      else this.appDescription.set(value);
    }
  }
}
