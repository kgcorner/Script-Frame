import { Component, OnInit, OnDestroy, ViewChild, ElementRef, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ComfyUIService } from '../../services/comfyui.service';
import { WorkflowService } from '../../services/workflow.service';
import { NodeComponent } from './node';
import {
  ComfyUIWorkflow,
  ComfyUINode,
  ComfyUINodeType,
  ComfyUILink,
  ComfyUINodeInput,
  ComfyUINodeOutput,
  CreateWorkflowRequest,
  Workflow,
} from '../../models';

interface CanvasState {
  offsetX: number;
  offsetY: number;
  scale: number;
}

interface SelectedNode {
  node: ComfyUINode | null;
  inputIndex: number | null;
  outputIndex: number | null;
}

@Component({
  selector: 'app-workflow-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, NodeComponent],
  templateUrl: './workflow-editor.html',
  styleUrls: ['./workflow-editor.scss'],
})
export class WorkflowEditorComponent implements OnInit, OnDestroy {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLDivElement>;
  @ViewChild('canvasWrapper', { static: true }) wrapperRef!: ElementRef<HTMLDivElement>;

  private destroy$ = new Subject<void>();

  workflow = signal<ComfyUIWorkflow>({ nodes: [], links: [], version: 1 });
  nodeTypes = signal<ComfyUINodeType[]>([]);
  savedWorkflows = signal<Workflow[]>([]);
  isLoading = signal(false);
  isSaving = signal(false);
  error = signal<string | null>(null);
  searchQuery = signal('');
  paletteCollapsed = signal(false);
  propertiesCollapsed = signal(false);
  showSavedWorkflows = signal(false);

  // Helper for template
  protected Math = Math;

  canvasState = signal<CanvasState>({ offsetX: 0, offsetY: 0, scale: 1 });
  isPanning = signal(false);
  panStart = { x: 0, y: 0 };

  selectedNode = signal<SelectedNode>({ node: null, inputIndex: null, outputIndex: null });
  connectingFrom = signal<{ nodeId: string; outputIndex: number } | null>(null);
  connectionPreview = signal<{ x: number; y: number } | null>(null);

  filteredNodeTypes = computed(() => {
    const query = this.searchQuery().toLowerCase();
    return this.nodeTypes().filter(nt =>
      nt.name.toLowerCase().includes(query) ||
      nt.displayName.toLowerCase().includes(query) ||
      nt.category.toLowerCase().includes(query)
    );
  });

  nodeCategories = computed(() => {
    const categories = new Map<string, ComfyUINodeType[]>();
    for (const nt of this.filteredNodeTypes()) {
      const cat = nt.category || 'general';
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat)!.push(nt);
    }
    return Array.from(categories.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  });

  constructor(
    private comfyuiService: ComfyUIService,
    private workflowService: WorkflowService,
  ) {}

  ngOnInit(): void {
    this.loadNodeTypes();
    this.loadSavedWorkflows();
    this.setupKeyboardListeners();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadNodeTypes(): void {
    this.isLoading.set(true);
    this.comfyuiService.getNodeTypes().pipe(takeUntil(this.destroy$)).subscribe({
      next: (types) => {
        this.nodeTypes.set(types);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.error.set(`Failed to load node types: ${err.message}`);
        this.isLoading.set(false);
      },
    });
  }

  private loadSavedWorkflows(): void {
    this.workflowService.getWorkflows().pipe(takeUntil(this.destroy$)).subscribe({
      next: (resp) => this.savedWorkflows.set(resp.data || []),
      error: (err) => console.error('Failed to load workflows:', err),
    });
  }

  private setupKeyboardListeners(): void {
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
    document.addEventListener('keyup', this.handleKeyUp.bind(this));
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      this.deleteSelectedNode();
    }
    if (event.key === 'Escape') {
      this.cancelConnection();
      this.clearSelection();
    }
  }

  private handleKeyUp(event: KeyboardEvent): void {
    if (event.key === ' ') {
      this.isPanning.set(false);
    }
  }

  // Canvas interactions
  onCanvasMouseDown(event: MouseEvent): void {
    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      this.isPanning.set(true);
      this.panStart = { x: event.clientX, y: event.clientY };
      event.preventDefault();
    }
  }

  onCanvasMouseMove(event: MouseEvent): void {
    if (this.isPanning()) {
      const state = this.canvasState();
      const dx = event.clientX - this.panStart.x;
      const dy = event.clientY - this.panStart.y;
      this.canvasState.set({
        ...state,
        offsetX: state.offsetX + dx,
        offsetY: state.offsetY + dy,
      });
      this.panStart = { x: event.clientX, y: event.clientY };
    } else if (this.connectingFrom()) {
      const rect = this.canvasRef.nativeElement.getBoundingClientRect();
      this.connectionPreview.set({
        x: event.clientX - rect.left - this.canvasState().offsetX,
        y: event.clientY - rect.top - this.canvasState().offsetY,
      });
    }
  }

  onCanvasMouseUp(event: MouseEvent): void {
    if (this.isPanning()) {
      this.isPanning.set(false);
    }
    if (this.connectingFrom()) {
      this.connectionPreview.set(null);
      this.connectingFrom.set(null);
    }
  }

  onCanvasWheel(event: WheelEvent): void {
    event.preventDefault();
    const state = this.canvasState();
    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(Math.max(state.scale * zoomFactor, 0.1), 3);

    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    this.canvasState.set({
      offsetX: mouseX - (mouseX - state.offsetX) * (newScale / state.scale),
      offsetY: mouseY - (mouseY - state.offsetY) * (newScale / state.scale),
      scale: newScale,
    });
  }

  onCanvasClick(event: MouseEvent): void {
    if (event.target === this.canvasRef.nativeElement || event.target === this.wrapperRef.nativeElement) {
      this.clearSelection();
    }
  }

  // Node palette
  onNodeDragStart(event: DragEvent, nodeType: ComfyUINodeType): void {
    event.dataTransfer?.setData('application/x-node-type', JSON.stringify(nodeType));
    event.dataTransfer!.effectAllowed = 'copy';
  }

  onCanvasDrop(event: DragEvent): void {
    event.preventDefault();
    const data = event.dataTransfer?.getData('application/x-node-type');
    if (!data) return;

    const nodeType: ComfyUINodeType = JSON.parse(data);
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const state = this.canvasState();

    const x = (event.clientX - rect.left - state.offsetX) / state.scale;
    const y = (event.clientY - rect.top - state.offsetY) / state.scale;

    this.addNode(nodeType, x, y);
  }

  onCanvasDragOver(event: DragEvent): void {
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'copy';
  }

  // Node management
  addNode(nodeType: ComfyUINodeType, x: number, y: number): void {
    const newNode: ComfyUINode = {
      id: crypto.randomUUID(),
      type: nodeType.name,
      title: nodeType.displayName,
      position: { x, y },
      inputs: nodeType.inputs.map(input => ({
        name: input.name,
        type: input.type,
        optional: input.optional,
        link: null,
        linkedNodeId: null,
        linkedOutputName: null,
      })),
      outputs: nodeType.outputs.map(output => ({
        name: output.name,
        type: output.type,
        links: [],
      })),
      properties: {},
      widgetValues: {},
    };

    this.workflow.update(w => ({
      ...w,
      nodes: [...w.nodes, newNode],
    }));
  }

  deleteNode(nodeId: string): void {
    const wf = this.workflow();
    const node = wf.nodes.find(n => n.id === nodeId);
    if (!node) return;

    const newLinks = wf.links.filter(
      link => link.sourceNodeId !== nodeId && link.targetNodeId !== nodeId
    );

    const newNodes = wf.nodes
      .filter(n => n.id !== nodeId)
      .map(n => ({
        ...n,
        inputs: n.inputs.map(input =>
          input.linkedNodeId === nodeId ? { ...input, link: null, linkedNodeId: null, linkedOutputName: null } : input
        ),
        outputs: n.outputs.map(output => ({
          ...output,
          links: output.links.filter(linkId =>
            !wf.links.some(l => l.id === linkId && (l.sourceNodeId === nodeId || l.targetNodeId === nodeId))
          ),
        })),
      }));

    this.workflow.set({ ...wf, nodes: newNodes, links: newLinks });
    this.clearSelection();
  }

  deleteSelectedNode(): void {
    if (this.selectedNode().node) {
      this.deleteNode(this.selectedNode().node!.id);
    }
  }

  // Connection management
  startConnection(node: ComfyUINode, outputIndex: number): void {
    this.connectingFrom.set({ nodeId: node.id, outputIndex });
  }

  endConnection(targetNode: ComfyUINode, inputIndex: number): void {
    const connecting = this.connectingFrom();
    if (!connecting) return;

    const sourceNode = this.workflow().nodes.find(n => n.id === connecting.nodeId);
    if (!sourceNode) {
      this.cancelConnection();
      return;
    }

    const { outputIndex } = connecting;

    const sourceOutput = sourceNode.outputs[outputIndex];
    const targetInput = targetNode.inputs[inputIndex];

    if (!this.areTypesCompatible(sourceOutput.type, targetInput.type)) {
      this.error.set(`Cannot connect ${sourceOutput.type} to ${targetInput.type}`);
      setTimeout(() => this.error.set(null), 3000);
      this.cancelConnection();
      return;
    }

    if (targetInput.link !== null) {
      this.removeLink(targetInput.link!);
    }

    const newLink: ComfyUILink = {
      id: Date.now(),
      sourceNodeId: sourceNode.id,
      sourceOutputName: sourceOutput.name,
      targetNodeId: targetNode.id,
      targetInputName: targetInput.name,
    };

    const newNodes = this.workflow().nodes.map(n => {
      if (n.id === sourceNode.id) {
        return {
          ...n,
          outputs: n.outputs.map((out, i) =>
            i === outputIndex ? { ...out, links: [...out.links, newLink.id] } : out
          ),
        };
      }
      if (n.id === targetNode.id) {
        return {
          ...n,
          inputs: n.inputs.map((inp, i) =>
            i === inputIndex ? { ...inp, link: newLink.id, linkedNodeId: sourceNode.id, linkedOutputName: sourceOutput.name } : inp
          ),
        };
      }
      return n;
    });

    this.workflow.set({
      ...this.workflow(),
      nodes: newNodes,
      links: [...this.workflow().links, newLink],
    });

    this.cancelConnection();
  }

  cancelConnection(): void {
    this.connectingFrom.set(null);
    this.connectionPreview.set(null);
  }

  removeLink(linkId: number): void {
    const link = this.workflow().links.find(l => l.id === linkId);
    if (!link) return;

    const newNodes = this.workflow().nodes.map(n => {
      if (n.id === link.sourceNodeId) {
        return {
          ...n,
          outputs: n.outputs.map(out => ({
            ...out,
            links: out.links.filter(id => id !== linkId),
          })),
        };
      }
      if (n.id === link.targetNodeId) {
        return {
          ...n,
          inputs: n.inputs.map(inp =>
            inp.link === linkId ? { ...inp, link: null, linkedNodeId: null, linkedOutputName: null } : inp
          ),
        };
      }
      return n;
    });

    this.workflow.set({
      ...this.workflow(),
      nodes: newNodes,
      links: this.workflow().links.filter(l => l.id !== linkId),
    });
  }

  private areTypesCompatible(sourceType: string, targetType: string): boolean {
    if (sourceType === '*' || targetType === '*') return true;
    return sourceType === targetType;
  }

  // Selection
  selectNode(node: ComfyUINode, inputIndex: number | null = null, outputIndex: number | null = null): void {
    this.selectedNode.set({ node, inputIndex, outputIndex });
  }

  clearSelection(): void {
    this.selectedNode.set({ node: null, inputIndex: null, outputIndex: null });
  }

  // Property updates
  updateNodeProperty(nodeId: string, key: string, value: unknown): void {
    this.workflow.update(wf => ({
      ...wf,
      nodes: wf.nodes.map(n =>
        n.id === nodeId ? { ...n, properties: { ...n.properties, [key]: value } } : n
      ),
    }));
  }

  updateWidgetValue(nodeId: string, widgetName: string, value: unknown): void {
    this.workflow.update(wf => ({
      ...wf,
      nodes: wf.nodes.map(n =>
        n.id === nodeId ? { ...n, widgetValues: { ...n.widgetValues, [widgetName]: value } } : n
      ),
    }));
  }

  // Node position
  onNodeDrag(node: ComfyUINode, event: MouseEvent): void {
    if (event.buttons !== 1) return;
    const state = this.canvasState();
    this.workflow.update(wf => ({
      ...wf,
      nodes: wf.nodes.map(n =>
        n.id === node.id
          ? { ...n, position: { x: n.position.x + event.movementX / state.scale, y: n.position.y + event.movementY / state.scale } }
          : n
      ),
    }));
  }

  // Workflow actions
  saveWorkflow(): void {
    const name = prompt('Enter workflow name:', 'My Workflow');
    if (!name) return;

    this.isSaving.set(true);
    const request: CreateWorkflowRequest = {
      name,
      description: `ComfyUI workflow with ${this.workflow().nodes.length} nodes`,
      definition: this.workflow() as unknown as Record<string, unknown>,
    };

    this.workflowService.createWorkflow(request).pipe(takeUntil(this.destroy$)).subscribe({
      next: (saved) => {
        this.savedWorkflows.update(ws => [saved, ...ws]);
        this.isSaving.set(false);
        this.error.set(null);
      },
      error: (err) => {
        this.error.set(`Failed to save: ${err.message}`);
        this.isSaving.set(false);
      },
    });
  }

  loadWorkflow(workflow: Workflow): void {
    if (confirm('Load this workflow? Unsaved changes will be lost.')) {
      this.workflow.set(workflow.definition as unknown as ComfyUIWorkflow);
      this.clearSelection();
    }
  }

  newWorkflow(): void {
    if (this.workflow().nodes.length > 0 && !confirm('Create new workflow? Unsaved changes will be lost.')) {
      return;
    }
    this.workflow.set({ nodes: [], links: [], version: 1 });
    this.clearSelection();
  }

  exportWorkflow(): void {
    const data = JSON.stringify(this.workflow(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflow-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  importWorkflow(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const workflow = JSON.parse(e.target?.result as string);
        if (workflow.nodes && workflow.links) {
          this.workflow.set(workflow);
          this.clearSelection();
        } else {
          this.error.set('Invalid workflow file format');
        }
      } catch {
        this.error.set('Failed to parse workflow file');
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  executeWorkflow(): void {
    if (this.workflow().nodes.length === 0) {
      this.error.set('Workflow is empty');
      return;
    }

    this.isLoading.set(true);
    this.comfyuiService.queuePrompt({ prompt: this.workflow() as unknown as Record<string, unknown> }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (resp) => {
        this.isLoading.set(false);
        this.error.set(null);
        alert(`Workflow queued! Prompt ID: ${resp.data.promptId}`);
      },
      error: (err) => {
        this.isLoading.set(false);
        this.error.set(`Execution failed: ${err.message}`);
      },
    });
  }

  // Canvas transform
  getCanvasTransform(): string {
    const { offsetX, offsetY, scale } = this.canvasState();
    return `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  }

  getConnectionPreviewPath(): string {
    const connecting = this.connectingFrom();
    const preview = this.connectionPreview();
    if (!connecting || !preview) return '';

    const sourceNode = this.workflow().nodes.find(n => n.id === connecting.nodeId);
    if (!sourceNode) return '';
    
    const sourceOutput = sourceNode.outputs[connecting.outputIndex];
    const nodeEl = this.canvasRef.nativeElement.querySelector(`[data-node-id="${sourceNode.id}"]`);
    if (!nodeEl) return '';

    const outputEl = nodeEl.querySelector(`[data-output-index="${connecting.outputIndex}"]`) as HTMLElement;
    if (!outputEl) return '';

    const rect = outputEl.getBoundingClientRect();
    const canvasRect = this.canvasRef.nativeElement.getBoundingClientRect();
    const state = this.canvasState();

    const startX = (rect.left - canvasRect.left - state.offsetX) / state.scale + outputEl.offsetWidth;
    const startY = (rect.top - canvasRect.top - state.offsetY) / state.scale + outputEl.offsetHeight / 2;

    return `M ${startX} ${startY} C ${(startX + preview.x) / 2} ${startY}, ${(startX + preview.x) / 2} ${preview.y}, ${preview.x} ${preview.y}`;
  }

  trackByNodeId(index: number, node: ComfyUINode): string {
    return node.id;
  }

  trackByLinkId(index: number, link: ComfyUILink): number {
    return link.id;
  }

  getInputSocketPosition(node: ComfyUINode, inputIndex: number): { x: number; y: number } {
    const nodeEl = this.canvasRef.nativeElement.querySelector(`[data-node-id="${node.id}"]`);
    if (!nodeEl) return { x: 0, y: 0 };
    const inputEl = nodeEl.querySelector(`[data-input-index="${inputIndex}"]`) as HTMLElement;
    if (!inputEl) return { x: 0, y: 0 };
    const rect = inputEl.getBoundingClientRect();
    const canvasRect = this.canvasRef.nativeElement.getBoundingClientRect();
    const state = this.canvasState();
    return {
      x: (rect.left - canvasRect.left - state.offsetX) / state.scale,
      y: (rect.top - canvasRect.top - state.offsetY) / state.scale + inputEl.offsetHeight / 2,
    };
  }

  getOutputSocketPosition(node: ComfyUINode, outputIndex: number): { x: number; y: number } {
    const nodeEl = this.canvasRef.nativeElement.querySelector(`[data-node-id="${node.id}"]`);
    if (!nodeEl) return { x: 0, y: 0 };
    const outputEl = nodeEl.querySelector(`[data-output-index="${outputIndex}"]`) as HTMLElement;
    if (!outputEl) return { x: 0, y: 0 };
    const rect = outputEl.getBoundingClientRect();
    const canvasRect = this.canvasRef.nativeElement.getBoundingClientRect();
    const state = this.canvasState();
    return {
      x: (rect.left - canvasRect.left - state.offsetX) / state.scale + outputEl.offsetWidth,
      y: (rect.top - canvasRect.top - state.offsetY) / state.scale + outputEl.offsetHeight / 2,
    };
  }

  // Link path generation
  getLinkPath(link: ComfyUILink): string {
    const sourceNode = this.workflow().nodes.find(n => n.id === link.sourceNodeId);
    const targetNode = this.workflow().nodes.find(n => n.id === link.targetNodeId);
    if (!sourceNode || !targetNode) return '';

    const sourceOutputIndex = sourceNode.outputs.findIndex(o => o.name === link.sourceOutputName);
    const targetInputIndex = targetNode.inputs.findIndex(i => i.name === link.targetInputName);
    if (sourceOutputIndex === -1 || targetInputIndex === -1) return '';

    const sourcePos = this.getOutputSocketPosition(sourceNode, sourceOutputIndex);
    const targetPos = this.getInputSocketPosition(targetNode, targetInputIndex);

    // Bezier curve
    const dx = targetPos.x - sourcePos.x;
    const ctrlOffset = Math.min(Math.abs(dx) * 0.5, 200);

    return `M ${sourcePos.x} ${sourcePos.y} C ${sourcePos.x + ctrlOffset} ${sourcePos.y}, ${targetPos.x - ctrlOffset} ${targetPos.y}, ${targetPos.x} ${targetPos.y}`;
  }

  // Link selection
  selectLink(event: MouseEvent, link: ComfyUILink): void {
    event.stopPropagation();
    // Could emit selection event or store selected link
    // For now, just prevent default
    event.preventDefault();
  }

  // Widget/Property entry iterators
  getWidgetEntries(node: ComfyUINode): { key: string; value: any }[] {
    if (!node.widgetValues) return [];
    return Object.keys(node.widgetValues).map(key => ({ key, value: node.widgetValues![key] }));
  }

  getPropertyEntries(node: ComfyUINode): { key: string; value: any }[] {
    if (!node.properties) return [];
    return Object.entries(node.properties).map(([key, value]) => ({ key, value }));
  }

  // Type color coding
  getTypeColor(type: string): string {
    const colors: Record<string, string> = {
      '*': '#8b5cf6',     // violet - wildcard
      string: '#22c55e',  // green
      number: '#3b82f6',  // blue
      boolean: '#f59e0b', // amber
      array: '#ec4899',   // pink
      object: '#06b6d4',  // cyan
      image: '#ef4444',   // red
      audio: '#8b5cf6',   // violet
      video: '#f97316',   // orange
      text: '#22c55e',    // green
      any: '#64748b'      // slate
    };
    return colors[type.toLowerCase()] || '#64748b';
  }

  // Viewport controls
  zoomIn(): void {
    this.canvasState.update(state => ({
      ...state,
      scale: Math.min(state.scale * 1.2, 3)
    }));
  }

  zoomOut(): void {
    this.canvasState.update(state => ({
      ...state,
      scale: Math.max(state.scale / 1.2, 0.1)
    }));
  }

  resetView(): void {
    this.canvasState.set({ offsetX: 0, offsetY: 0, scale: 1 });
  }

  protected getWorkflowNodeCount(workflow: Workflow): number {
    const def = workflow.definition as Record<string, unknown>;
    const nodes = def?.['nodes'] as unknown[];
    return nodes?.length || 0;
  }
}