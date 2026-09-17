import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WorkflowService, ComfyUISavedWorkflow, ComfyUIWorkflowsResponse } from '../../services/workflow.service';
import { Workflow } from '../../models';

interface WorkflowInputField {
  key: string;
  nodeId: string;
  nodeTitle: string;
  inputName: string;
  defaultValue: unknown;
  type: string;
  isPrimary: boolean;
}

type WorkflowSource = 'local' | 'comfyui-saved' | 'comfyui-history';

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
  error = signal<string | null>(null);
  
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

  constructor(private workflowService: WorkflowService) {}

  ngOnInit() {
    this.loadWorkflows();
    this.loadComfyUIWorkflows();
  }

  loadWorkflows() {
    this.loading.set(true);
    this.error.set(null);
    this.workflowService.getWorkflows({ isActive: true }).subscribe({
      next: (res) => {
        this.localWorkflows.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set('Failed to load workflows: ' + (err.message || 'Unknown error'));
        this.loading.set(false);
      }
    });
  }

  loadComfyUIWorkflows() {
    // Load saved workflows
    this.workflowService.getComfyUISavedWorkflows().subscribe({
      next: (res) => {
        if (res.success) {
          this.comfyUISavedWorkflows.set(res.data);
        }
      },
      error: (err) => {
        console.warn('Failed to load ComfyUI saved workflows:', err);
      }
    });

    // Load history workflows
    this.workflowService.getComfyUIWorkflowHistory().subscribe({
      next: (res) => {
        if (res.success) {
          this.comfyUIHistoryWorkflows.set(res.data);
        }
      },
      error: (err) => {
        console.warn('Failed to load ComfyUI history workflows:', err);
      }
    });
  }

  onWorkflowSourceChange() {
    this.selectedWorkflowId.set('');
    this.inputFields.set([]);
  }

  onWorkflowSelect() {
    const workflowId = this.selectedWorkflowId();
    if (!workflowId) {
      this.inputFields.set([]);
      return;
    }
    this.loadWorkflowInputs(workflowId);
  }

  loadWorkflowInputs(workflowId: string) {
    this.loadingInputs.set(true);
    this.error.set(null);
    
    if (this.isComfyUIWorkflow()) {
      // For ComfyUI workflows, we already have the full workflow definition
      const workflows = this.getCurrentWorkflows();
      const workflow = workflows.find(w => this.getWorkflowKey(w) === workflowId);
      if (workflow && 'workflow' in workflow) {
        this.extractInputs(workflow.workflow);
        this.loadingInputs.set(false);
      } else {
        this.error.set('Workflow not found');
        this.loadingInputs.set(false);
      }
    } else {
      // For local workflows, fetch from database
      this.workflowService.getWorkflow(workflowId).subscribe({
        next: (workflow) => {
          const definition = (workflow.data.definition as Record<string, any>) || {};
          this.extractInputs(definition);
          this.loadingInputs.set(false);
        },
        error: (err) => {
          this.error.set('Failed to load workflow inputs: ' + (err.message || 'Unknown error'));
          this.loadingInputs.set(false);
        }
      });
    }
  }

  getWorkflowKey(workflow: ComfyUISavedWorkflow | Workflow): string {
    if ('id' in workflow) {
      return workflow.id;
    }
    return workflow.name;
  }

  getWorkflowDisplayName(workflow: ComfyUISavedWorkflow | Workflow): string {
    if ('id' in workflow) {
      return workflow.name;
    }
    return workflow.name;
  }

  extractInputs(definition: Record<string, any>) {
    const fields: WorkflowInputField[] = [];
    
    for (const [nodeId, node] of Object.entries(definition)) {
      if (node.inputs) {
        const nodeTitle = node._meta?.title || node.class_type || nodeId;
        for (const [inputName, defaultValue] of Object.entries(node.inputs)) {
          const key = `${nodeId}:${inputName}`;
          // Infer type from default value
          let type = 'string';
          if (typeof defaultValue === 'number') type = 'number';
          else if (typeof defaultValue === 'boolean') type = 'boolean';
          else if (typeof defaultValue === 'string') {
            if (defaultValue.endsWith('.png') || defaultValue.endsWith('.jpg') || defaultValue.endsWith('.jpeg') || 
                defaultValue.endsWith('.mp4') || defaultValue.endsWith('.webm')) type = 'file';
          }
          
          fields.push({
            key,
            nodeId,
            nodeTitle,
            inputName,
            defaultValue,
            type,
            isPrimary: false
          });
        }
      }
    }
    
    // Sort by nodeId then inputName for consistent display
    fields.sort((a, b) => {
      const nodeCompare = a.nodeId.localeCompare(b.nodeId);
      if (nodeCompare !== 0) return nodeCompare;
      return a.inputName.localeCompare(b.inputName);
    });
    
    this.inputFields.set(fields);
  }

  togglePrimary(field: WorkflowInputField) {
    field.isPrimary = !field.isPrimary;
    // Update the signal to trigger change detection
    this.inputFields.update(fields => [...fields]);
  }

  getPrimaryFields(): WorkflowInputField[] {
    return this.inputFields().filter(f => f.isPrimary);
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

  getNodeDisplayName(field: WorkflowInputField): string {
    return `${field.inputName} (${field.nodeTitle})`;
  }
}