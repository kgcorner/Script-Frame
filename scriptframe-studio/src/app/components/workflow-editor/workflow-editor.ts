import { Component, OnInit, OnDestroy, ViewChild, ElementRef, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { LLMProviderService } from '../../services/llm-provider.service';
import { ComfyUIAppService } from '../../services/comfyui-app.service';
import { ComfyUIStackService } from '../../services/comfyui-stack.service';
import { ScriptFrameWorkflowService } from '../../services/scriptframe-workflow.service';
import {
  ScriptFrameWorkflow,
  ScriptFrameNode,
  ScriptFrameLink,
  ScriptFrameNodeType,
  ScriptFrameWorkflowCreateRequest,
  ScriptFrameWorkflowUpdateRequest,
  ScriptFrameTestConnectionResponse,
  LLMApp,
  ComfyUIApp,
  ComfyUIStack,
} from '../../models';
import { WorkflowEditorLiteGraphService, LiteNodeSelection } from './workflow-editor.litgraph';

interface CanvasState {
  offsetX: number;
  offsetY: number;
  scale: number;
}

interface SelectedNode {
  node: ScriptFrameNode | null;
  inputIndex: number | null;
  outputIndex: number | null;
}

export interface PaletteNodeType {
  type: ScriptFrameNodeType;
  displayName: string;
  description: string;
  color: string;
}

@Component({
  selector: 'app-workflow-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './workflow-editor.html',
  styleUrls: ['./workflow-editor.scss'],
})
export class WorkflowEditorComponent implements OnInit, OnDestroy {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLDivElement>;
  @ViewChild('canvasWrapper', { static: true }) wrapperRef!: ElementRef<HTMLDivElement>;

  private destroy$ = new Subject<void>();

  workflow = signal<ScriptFrameWorkflow>({
    id: '',
    name: 'Untitled ScriptFrame Workflow',
    description: '',
    nodes: [],
    links: [],
    createdAt: '',
    updatedAt: '',
  });

  savedWorkflows = signal<ScriptFrameWorkflow[]>([]);
  llmApps = signal<LLMApp[]>([]);
  comfyuiApps = signal<ComfyUIApp[]>([]);
  comfyuiStacks = signal<ComfyUIStack[]>([]);

  isLoading = signal(false);
  isSaving = signal(false);
  isTesting = signal(false);
  error = signal<string | null>(null);
  searchQuery = signal('');
  paletteCollapsed = signal(false);
  propertiesCollapsed = signal(false);
  showSavedWorkflows = signal(false);
  showSaveDialog = signal(false);
  testResults = signal<ScriptFrameTestConnectionResponse[]>([]);

  saveDialogData = {
    name: '',
    description: '',
    maxClipLength: null as number | null,
    maxTimeout: null as number | null,
    nsfw: false,
  };

  protected Math = Math;

  canvasState = signal<CanvasState>({ offsetX: 0, offsetY: 0, scale: 1 });
  isPanning = signal(false);
  panStart = { x: 0, y: 0 };

  selectedNode = signal<SelectedNode>({ node: null, inputIndex: null, outputIndex: null });
  connectingFrom = signal<{ nodeId: string; outputIndex: number } | null>(null);
  connectionPreview = signal<{ x: number; y: number } | null>(null);

  readonly paletteNodeTypes: PaletteNodeType[] = [
    {
      type: 'worker',
      displayName: 'Worker Node',
      description: 'Central coordinator: connects to LLM App and ComfyUI Stack for topic-to-video generation',
      color: '#fcd34a',
    },
    {
      type: 'llm',
      displayName: 'LLM App Node',
      description: 'Represents an LLM Provider with system prompt for story/character generation',
      color: '#c4b5fd',
    },
    {
      type: 'comfyui-stack',
      displayName: 'ComfyUI Stack Node',
      description: 'Collection of ComfyUI Apps that the Worker can use for video generation',
      color: '#67e8f9',
    },
    {
      type: 'comfyui-app',
      displayName: 'ComfyUI App Node',
      description: 'Represents a connection to ComfyUI service with a specific workflow',
      color: '#5eead4',
    },
  ];

  filteredPaletteNodeTypes = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.paletteNodeTypes;
    return this.paletteNodeTypes.filter(
      (n) =>
        n.displayName.toLowerCase().includes(q) ||
        n.description.toLowerCase().includes(q) ||
        n.type.toLowerCase().includes(q)
    );
  });

  constructor(
    private llmProviderService: LLMProviderService,
    private comfyuiAppService: ComfyUIAppService,
    private comfyuiStackService: ComfyUIStackService,
    private scriptframeService: ScriptFrameWorkflowService,
    private litegraphService: WorkflowEditorLiteGraphService
  ) {}

  ngOnInit(): void {
    this.loadData();
    this.initDefaultWorkflow();
    this.setupLiteGraph();
    this.setupKeyboardListeners();
  }

  ngOnDestroy(): void {
    this.litegraphService.destroy();
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Creates the embedded ComfyUI-style LiteGraph canvas. */
  private setupLiteGraph(): void {
    const container = this.canvasRef.nativeElement;
    this.litegraphService.setup(container, {
      onNodeMoved: (node) => {
        this.workflow.update((wf) => ({
          ...wf,
          nodes: wf.nodes.map((n) =>
            n.id === node.id ? { ...n, position: { ...node.position } } : n
          ),
        }));
      },
      onNodeSelected: (node) => {
        if (node) {
          this.selectedNode.set({ node, inputIndex: null, outputIndex: null });
        } else {
          this.clearSelection();
        }
      },
      onGraphChanged: () => {
        this.applyGraphSnapshot();
      },
      onCreateNode: (type, x, y) => {
        // Map a palette type to a ScriptFrame node and add it (handles start/end uniqueness).
        const entry = this.paletteNodeTypes.find((p) => p.type === type) as PaletteNodeType | undefined;
        if (entry) {
          this.addNode(entry, x, y);
        }
      },
    });

    this.litegraphService.setZoomRange(0.2, 2.5);
    this.litegraphService.setPalette(
      this.paletteNodeTypes.map((p) => ({ type: p.type, title: p.displayName, description: p.description }))
    );

    // Parse the default workflow into the graph
    this.litegraphService.syncFromWorkflow(this.workflow());
  }

  /** Pull nodes/links/positions from the LiteGraph canvas into the reactive model. */
  private applyGraphSnapshot(): void {
    const snapshot = this.litegraphService.getSnapshot(this.workflow());
    this.workflow.update((wf) => ({
      ...wf,
      nodes: snapshot.nodes,
      links: snapshot.links,
    }));
  }

  /** Called after node data changes from the property panel to refresh the canvas node. */
  private refreshGraphNodes(): void {
    for (const node of this.workflow().nodes) {
      this.litegraphService.updateNode(node);
    }
  }
  private loadData(): void {
    this.isLoading.set(true);

    // Load each list independently so a single failing endpoint (e.g. a stale
    // backend 404 on one route) doesn't blank out the LLM / ComfyUI app dropdowns.
    const llmApps$ = this.llmProviderService.getApps().pipe(
      catchError((err) => {
        console.error('Failed to load LLM apps', err);
        return of({ success: false, data: [] as never[] });
      })
    );
    const comfyuiApps$ = this.comfyuiAppService.getApps().pipe(
      catchError((err) => {
        console.error('Failed to load ComfyUI apps', err);
        return of({ success: false, data: [] as never[] });
      })
    );
    const comfyuiStacks$ = this.comfyuiStackService.getStacks().pipe(
      catchError((err) => {
        console.error('Failed to load ComfyUI stacks', err);
        return of({ success: false, data: [] as never[] });
      })
    );
    const savedWorkflows$ = this.scriptframeService.getWorkflows().pipe(
      catchError((err) => {
        console.error('Failed to load saved workflows', err);
        return of({ success: false, data: [] as never[] });
      })
    );

    forkJoin({
      llmApps: llmApps$,
      comfyuiApps: comfyuiApps$,
      comfyuiStacks: comfyuiStacks$,
      savedWorkflows: savedWorkflows$,
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ llmApps, comfyuiApps, comfyuiStacks, savedWorkflows }) => {
          this.llmApps.set((llmApps as any)?.data || []);
          this.comfyuiApps.set((comfyuiApps as any)?.data || []);
          this.comfyuiStacks.set((comfyuiStacks as any)?.data || []);
          this.savedWorkflows.set((savedWorkflows as any)?.data || []);
          this.isLoading.set(false);
        },
        error: (err) => {
          console.error('Error loading apps/workflows', err);
          this.error.set(`Failed to load app definitions: ${err.message}`);
          this.isLoading.set(false);
        },
      });
  }

  private initDefaultWorkflow(): void {
    const workerNode: ScriptFrameNode = {
      id: 'worker-node',
      type: 'worker',
      title: 'Worker Node',
      position: { x: 100, y: 180 },
      inputs: [],
      outputs: [
        { name: 'llm', type: 'llm', links: [] },
        { name: 'comfyui-stack', type: 'comfyui-stack', links: [] }
      ],
      data: {
        llmAppId: '',
        llmAppName: '',
        comfyuiStackId: '',
        comfyuiStackName: '',
        systemPrompt: '',
        nsfw: false,
      },
    };

    const llmNode: ScriptFrameNode = {
      id: 'llm-node',
      type: 'llm',
      title: 'LLM App Node',
      position: { x: 400, y: 100 },
      inputs: [{ name: 'worker', type: 'llm', link: 1, linkedNodeId: 'worker-node', linkedOutputName: 'llm' }],
      outputs: [],
      data: { appId: '', appName: '', systemPrompt: '' },
    };

    const comfyuiStackNode: ScriptFrameNode = {
      id: 'comfyui-stack-node',
      type: 'comfyui-stack',
      title: 'ComfyUI Stack Node',
      position: { x: 400, y: 280 },
      inputs: [{ name: 'worker', type: 'comfyui-stack', link: 2, linkedNodeId: 'worker-node', linkedOutputName: 'comfyui-stack' }],
      outputs: [{ name: 'comfyui-apps', type: 'comfyui-app', links: [] }],
      data: { comfyuiStackId: '', comfyuiStackName: '' },
    };

    const comfyuiAppNode: ScriptFrameNode = {
      id: 'comfyui-app-node',
      type: 'comfyui-app',
      title: 'ComfyUI App Node',
      position: { x: 700, y: 280 },
      inputs: [{ name: 'stack', type: 'comfyui-app', link: 3, linkedNodeId: 'comfyui-stack-node', linkedOutputName: 'comfyui-apps' }],
      outputs: [],
      data: { comfyuiAppId: '', comfyuiAppName: '' },
    };

    const links: ScriptFrameLink[] = [
      { id: 1, sourceNodeId: 'worker-node', sourceOutputName: 'llm', targetNodeId: 'llm-node', targetInputName: 'worker' },
      { id: 2, sourceNodeId: 'worker-node', sourceOutputName: 'comfyui-stack', targetNodeId: 'comfyui-stack-node', targetInputName: 'worker' },
      { id: 3, sourceNodeId: 'comfyui-stack-node', sourceOutputName: 'comfyui-apps', targetNodeId: 'comfyui-app-node', targetInputName: 'stack' },
    ];

    this.workflow.set({
      id: '',
      name: 'Default ScriptFrame Workflow',
      description: 'Worker -> LLM App + ComfyUI Stack -> ComfyUI App workflow',
      nodes: [workerNode, llmNode, comfyuiStackNode, comfyuiAppNode],
      links,
      nsfw: false,
      createdAt: '',
      updatedAt: '',
    });
  }

  private setupKeyboardListeners(): void {
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
    document.addEventListener('keyup', this.handleKeyUp.bind(this));
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
        return;
      }
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

  // Canvas interactions (delegated to the LiteGraph canvas; these only handle panning helpers for legacy UI)
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
    }
  }

  onCanvasMouseUp(event: MouseEvent): void {
    if (this.isPanning()) {
      this.isPanning.set(false);
    }
  }

  onCanvasWheel(event: WheelEvent): void {
    // LiteGraph handles wheel zoom itself.
    event.preventDefault();
  }

  onCanvasClick(event: MouseEvent): void {
    if (event.target === this.wrapperRef.nativeElement) {
      this.clearSelection();
    }
  }

  /** Converts a client point to LiteGraph canvas (graph) coordinates. */
  private toGraphCoords(event: MouseEvent | DragEvent): { x: number; y: number } {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const ds = (this.litegraphService as any).getCanvasState?.() ?? { scale: 1, offset: [0, 0] } as { scale: number; offset: [number, number] };
    const scale = ds.scale;
    const offset = ds.offset;
    const x = (event.clientX - rect.left) / scale - offset[0];
    const y = (event.clientY - rect.top) / scale - offset[1];
    return { x, y };
  }

  // Node Palette drag and drop
  onNodeDragStart(event: DragEvent, nodeType: PaletteNodeType): void {
    event.dataTransfer?.setData('application/json', JSON.stringify(nodeType));
    event.dataTransfer!.effectAllowed = 'copy';
  }

  onCanvasDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  onCanvasDrop(event: DragEvent): void {
    event.preventDefault();
    const data = event.dataTransfer?.getData('application/json');
    if (!data) return;

    try {
      const nodeType: PaletteNodeType = JSON.parse(data);
      const { x, y } = this.toGraphCoords(event);
      this.addNode(nodeType, x, y);
    } catch (e) {
      console.error('Drop parse error', e);
    }
  }

  private addNode(paletteType: PaletteNodeType, x: number, y: number): void {
    const wf = this.workflow();

    const newNodeId = `${paletteType.type}-${Date.now()}`;
    let nodeData: ScriptFrameNode['data'];
    let inputs: ScriptFrameNode['inputs'] = [];
    let outputs: ScriptFrameNode['outputs'] = [];

    switch (paletteType.type) {
      case 'worker':
        nodeData = {
          llmAppId: '',
          llmAppName: '',
          comfyuiStackId: '',
          comfyuiStackName: '',
          systemPrompt: '',
          nsfw: false,
        };
        // Worker: two output ports - "llm" to LLM App Node, "comfyui-stack" to ComfyUIStackNode
        outputs = [
          { name: 'llm', type: 'llm', links: [] },
          { name: 'comfyui-stack', type: 'comfyui-stack', links: [] }
        ];
        break;
      case 'llm':
        nodeData = { appId: '', appName: '', systemPrompt: '' };
        // LLM App Node: input port "worker" from Worker Node
        inputs = [{ name: 'worker', type: 'llm', link: null }];
        break;
      case 'comfyui-stack':
        nodeData = { comfyuiStackId: '', comfyuiStackName: '' };
        // ComfyUI Stack Node: input port "worker" from Worker, output port "comfyui-apps" to ComfyUI App nodes
        inputs = [{ name: 'worker', type: 'comfyui-stack', link: null }];
        outputs = [{ name: 'comfyui-apps', type: 'comfyui-app', links: [] }];
        break;
      case 'comfyui-app':
        nodeData = { comfyuiAppId: '', comfyuiAppName: '' };
        // ComfyUI App Node: input port "stack" from ComfyUIStackNode
        inputs = [{ name: 'stack', type: 'comfyui-app', link: null }];
        break;
      default:
        nodeData = {};
    }

    const newNode: ScriptFrameNode = {
      id: newNodeId,
      type: paletteType.type,
      title: paletteType.displayName,
      position: { x, y },
      inputs,
      outputs,
      data: nodeData,
    };

    this.workflow.update((w) => ({
      ...w,
      nodes: [...w.nodes, newNode],
    }));
    this.litegraphService.addNode(newNode);
  }

  deleteNode(nodeId: string): void {
    const wf = this.workflow();
    const node = wf.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const newLinks = (wf.links || []).filter(
      (link) => link.sourceNodeId !== nodeId && link.targetNodeId !== nodeId
    );

    const newNodes = wf.nodes
      .filter((n) => n.id !== nodeId)
      .map((n) => ({
        ...n,
        inputs: n.inputs.map((inp) =>
          inp.linkedNodeId === nodeId ? { ...inp, link: null, linkedNodeId: null, linkedOutputName: null } : inp
        ),
        outputs: n.outputs.map((out) => ({
          ...out,
          links: out.links.filter(
            (linkId) => !(wf.links || []).some((l) => l.id === linkId && (l.sourceNodeId === nodeId || l.targetNodeId === nodeId))
          ),
        })),
      }));

    this.workflow.set({ ...wf, nodes: newNodes, links: newLinks });
    this.litegraphService.removeNode(nodeId);
    this.clearSelection();
  }

  deleteSelectedNode(): void {
    if (this.selectedNode().node) {
      this.deleteNode(this.selectedNode().node!.id);
    }
  }

  // Connection management
  startConnection(node: ScriptFrameNode, outputIndex: number): void {
    this.connectingFrom.set({ nodeId: node.id, outputIndex });
  }

  endConnection(targetNode: ScriptFrameNode, inputIndex: number): void {
    const connecting = this.connectingFrom();
    if (!connecting) return;

    const sourceNode = this.workflow().nodes.find((n) => n.id === connecting.nodeId);
    if (!sourceNode) {
      this.cancelConnection();
      return;
    }

    if (sourceNode.id === targetNode.id) {
      this.cancelConnection();
      return;
    }

    const { outputIndex } = connecting;
    const sourceOutput = sourceNode.outputs[outputIndex];
    const targetInput = targetNode.inputs[inputIndex];

    if (targetInput.link !== null && targetInput.link !== undefined) {
      this.removeLink(targetInput.link);
    }

    const newLinkId = Date.now();
    const newLink: ScriptFrameLink = {
      id: newLinkId,
      sourceNodeId: sourceNode.id,
      sourceOutputName: sourceOutput.name,
      targetNodeId: targetNode.id,
      targetInputName: targetInput.name,
    };

    const newNodes = this.workflow().nodes.map((n) => {
      if (n.id === sourceNode.id) {
        return {
          ...n,
          outputs: n.outputs.map((out, i) =>
            i === outputIndex ? { ...out, links: [...out.links, newLinkId] } : out
          ),
        };
      }
      if (n.id === targetNode.id) {
        return {
          ...n,
          inputs: n.inputs.map((inp, i) =>
            i === inputIndex
              ? { ...inp, link: newLinkId, linkedNodeId: sourceNode.id, linkedOutputName: sourceOutput.name }
              : inp
          ),
        };
      }
      return n;
    });

    this.workflow.set({
      ...this.workflow(),
      nodes: newNodes,
      links: [...(this.workflow().links || []), newLink],
    });

    this.cancelConnection();
  }

  cancelConnection(): void {
    this.connectingFrom.set(null);
    this.connectionPreview.set(null);
  }

  removeLink(linkId: number): void {
    const wf = this.workflow();
    const link = (wf.links || []).find((l) => l.id === linkId);
    if (!link) return;

    const newNodes = wf.nodes.map((n) => {
      if (n.id === link.sourceNodeId) {
        return {
          ...n,
          outputs: n.outputs.map((out) => ({
            ...out,
            links: out.links.filter((id) => id !== linkId),
          })),
        };
      }
      if (n.id === link.targetNodeId) {
        return {
          ...n,
          inputs: n.inputs.map((inp) =>
            inp.link === linkId ? { ...inp, link: null, linkedNodeId: null, linkedOutputName: null } : inp
          ),
        };
      }
      return n;
    });

    this.workflow.set({
      ...wf,
      nodes: newNodes,
      links: (wf.links || []).filter((l) => l.id !== linkId),
    });
  }
  selectNode(node: ScriptFrameNode, inputIndex: number | null = null, outputIndex: number | null = null): void {
    this.selectedNode.set({ node, inputIndex, outputIndex });
  }

  clearSelection(): void {
    this.selectedNode.set({ node: null, inputIndex: null, outputIndex: null });
    this.litegraphService.clearSelection();
  }

  updateNodeData(nodeId: string, key: string, value: unknown): void {
    this.workflow.update((wf) => ({
      ...wf,
      nodes: wf.nodes.map((n) => {
        if (n.id === nodeId) {
          return {
            ...n,
            data: {
              ...(n.data || {}),
              [key]: value,
            },
          };
        }
        return n;
      }),
    }));

    if (this.selectedNode().node?.id === nodeId) {
      const updated = this.workflow().nodes.find((n) => n.id === nodeId) || null;
      this.selectedNode.update((s) => ({ ...s, node: updated }));
    }
    const updatedNode = this.workflow().nodes.find((n) => n.id === nodeId);
    if (updatedNode) {
      this.litegraphService.updateNode(updatedNode);
    }
  }

  onNodeDrag(node: ScriptFrameNode, event: MouseEvent): void {
    if (event.buttons !== 1) return;
    const state = this.canvasState();
    this.workflow.update((wf) => ({
      ...wf,
      nodes: wf.nodes.map((n) =>
        n.id === node.id
          ? {
              ...n,
              position: {
                x: n.position.x + event.movementX / state.scale,
                y: n.position.y + event.movementY / state.scale,
              },
            }
          : n
      ),
    }));
  }

  /** Update a workflow-level flag (e.g. the ScriptFrame NSFW toggle). */
  updateWorkflowNsfw(nsfw: boolean): void {
    this.workflow.update((wf) => ({ ...wf, nsfw }));
  }

  // Save Dialog actions
  openSaveDialog(): void {
    const wf = this.workflow();
    this.saveDialogData = {
      name: wf.name || 'My ScriptFrame Workflow',
      description: wf.description || '',
      maxClipLength: wf.maxClipLength ?? null,
      maxTimeout: wf.maxTimeout ?? null,
      nsfw: wf.nsfw === true,
    };
    this.showSaveDialog.set(true);
  }

  closeSaveDialog(): void {
    this.showSaveDialog.set(false);
  }

  confirmSaveWorkflow(): void {
    const data = this.saveDialogData;
    if (!data.name?.trim()) return;

    this.isSaving.set(true);
    const wf = this.workflow();

    if (wf.id) {
      const updateReq: ScriptFrameWorkflowUpdateRequest = {
        name: data.name,
        description: data.description || undefined,
        nodes: wf.nodes,
        links: wf.links,
        maxClipLength: data.maxClipLength ?? undefined,
        maxTimeout: data.maxTimeout ?? undefined,
        nsfw: data.nsfw,
      };

      this.scriptframeService
        .updateWorkflow(wf.id, updateReq)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (resp) => {
            this.workflow.set(resp.data);
            this.savedWorkflows.update((ws) => ws.map((w) => (w.id === resp.data.id ? resp.data : w)));
            this.isSaving.set(false);
            this.error.set(null);
            this.closeSaveDialog();
          },
          error: (err) => {
            this.error.set(`Failed to save: ${err.message}`);
            this.isSaving.set(false);
          },
        });
    } else {
      const createReq: ScriptFrameWorkflowCreateRequest = {
        name: data.name,
        description: data.description || `ScriptFrame workflow with ${wf.nodes.length} nodes`,
        nodes: wf.nodes,
        links: wf.links,
        maxClipLength: data.maxClipLength ?? undefined,
        maxTimeout: data.maxTimeout ?? undefined,
        nsfw: data.nsfw,
      };

      this.scriptframeService
        .createWorkflow(createReq)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (resp) => {
            this.workflow.set(resp.data);
            this.savedWorkflows.update((ws) => [resp.data, ...ws]);
            this.isSaving.set(false);
            this.error.set(null);
            this.closeSaveDialog();
          },
          error: (err) => {
            this.error.set(`Failed to save: ${err.message}`);
            this.isSaving.set(false);
          },
        });
    }
  }

  // Workflow actions
  saveWorkflow(): void {
    this.openSaveDialog();
  }

  loadWorkflow(workflow: ScriptFrameWorkflow): void {
    this.workflow.set(workflow);
    this.litegraphService.loadWorkflow(workflow);
    this.clearSelection();
  }

  newWorkflow(): void {
    if (this.workflow().nodes.length > 0 && !confirm('Create new workflow? Unsaved changes will be lost.')) {
      return;
    }
    this.initDefaultWorkflow();
    this.litegraphService.loadWorkflow(this.workflow());
    this.clearSelection();
  }

  exportWorkflow(): void {
    const data = JSON.stringify(this.workflow(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scriptframe-${this.workflow().name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.json`;
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
        const parsed = JSON.parse(e.target?.result as string);
        if (parsed.nodes && Array.isArray(parsed.nodes)) {
          const wf: ScriptFrameWorkflow = {
            id: parsed.id || '',
            name: parsed.name || 'Imported ScriptFrame Workflow',
            description: parsed.description || '',
            nodes: parsed.nodes,
            links: parsed.links || [],
            createdAt: parsed.createdAt || '',
            updatedAt: parsed.updatedAt || '',
          };
          this.workflow.set(wf);
          this.litegraphService.loadWorkflow(wf);
          this.clearSelection();
        } else {
          this.error.set('Invalid ScriptFrame workflow format');
        }
      } catch {
        this.error.set('Failed to parse workflow JSON');
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  testWorkflow(): void {
    const wf = this.workflow();

    const list: Array<{ nodeId: string; type: 'llm' | 'comfyui-stack' | 'comfyui-app'; appId?: string }> = [];
    for (const n of wf.nodes) {
      if (n.type === 'llm') {
        list.push({ nodeId: n.id, type: 'llm', appId: n.data?.appId });
      } else if (n.type === 'comfyui-stack') {
        list.push({ nodeId: n.id, type: 'comfyui-stack', appId: n.data?.comfyuiStackId });
      } else if (n.type === 'comfyui-app') {
        list.push({ nodeId: n.id, type: 'comfyui-app', appId: n.data?.comfyuiAppId });
      } else if (n.type === 'worker') {
        // Worker: LLM port + ComfyUI stack port.
        list.push({ nodeId: n.id, type: 'llm', appId: n.data?.llmAppId });
        list.push({ nodeId: n.id, type: 'comfyui-stack', appId: n.data?.comfyuiStackId });
      }
    }

    if (list.length === 0) {
      this.testResults.set([
        {
          nodeId: 'none',
          type: 'llm',
          status: 'healthy',
          message: 'Workflow topology is valid (No LLM or ComfyUI app nodes to test)',
        },
      ]);
      return;
    }

    this.isTesting.set(true);
    this.scriptframeService
      .testAllConnections(list)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (resp) => {
          this.testResults.set(resp.data || []);
          this.isTesting.set(false);
        },
        error: (err) => {
          this.error.set(`Test failed: ${err.message}`);
          this.isTesting.set(false);
        },
      });
  }

  // Canvas Viewport & Coordinate Helpers
  getCanvasTransform(): string {
    const { offsetX, offsetY, scale } = this.canvasState();
    return `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  }

  getConnectionPreviewPath(): string {
    const connecting = this.connectingFrom();
    const preview = this.connectionPreview();
    if (!connecting || !preview) return '';

    const sourceNode = this.workflow().nodes.find((n) => n.id === connecting.nodeId);
    if (!sourceNode) return '';

    const startX = sourceNode.position.x + 220;
    const startY = sourceNode.position.y + 60 + connecting.outputIndex * 28;

    return `M ${startX} ${startY} C ${(startX + preview.x) / 2} ${startY}, ${(startX + preview.x) / 2} ${preview.y}, ${preview.x} ${preview.y}`;
  }

  getLinkPath(link: ScriptFrameLink): string {
    const sourceNode = this.workflow().nodes.find((n) => n.id === link.sourceNodeId);
    const targetNode = this.workflow().nodes.find((n) => n.id === link.targetNodeId);
    if (!sourceNode || !targetNode) return '';

    const sourceOutputIndex = sourceNode.outputs.findIndex((o) => o.name === link.sourceOutputName);
    const targetInputIndex = targetNode.inputs.findIndex((i) => i.name === link.targetInputName);

    const startX = sourceNode.position.x + 220;
    const startY = sourceNode.position.y + 60 + (sourceOutputIndex >= 0 ? sourceOutputIndex : 0) * 28;

    const endX = targetNode.position.x;
    const endY = targetNode.position.y + 60 + (targetInputIndex >= 0 ? targetInputIndex : 0) * 28;

    const dx = endX - startX;
    const ctrlOffset = Math.max(Math.abs(dx) * 0.5, 40);

    return `M ${startX} ${startY} C ${startX + ctrlOffset} ${startY}, ${endX - ctrlOffset} ${endY}, ${endX} ${endY}`;
  }

  selectLink(event: MouseEvent, link: ScriptFrameLink): void {
    event.stopPropagation();
    event.preventDefault();
  }

  getTypeColor(type: string): string {
    const colors: Record<string, string> = {
      '*': '#8b5cf6',
      worker: '#f59e0b',
      llm: '#8b5cf6',
      'comfyui-stack': '#06b6d4',
      'comfyui-app': '#14b8a6',
      string: '#22c55e',
      number: '#3b82f6',
      boolean: '#f59e0b',
      image: '#ef4444',
      audio: '#8b5cf6',
      video: '#f97316',
      text: '#22c55e',
      any: '#64748b',
    };
    return colors[type?.toLowerCase()] || '#64748b';
  }

  /** Resolve an LLM App name from its id (used by the worker node's LLM port selector). */
  getLlmAppName(appId: string): string | undefined {
    return this.llmApps().find((a) => a.id === appId)?.name;
  }

  /** Resolve a ComfyUI stack name from its id (used by the worker node's stack selector). */
  getComfyuiStackName(stackId: string): string | undefined {
    return this.comfyuiStacks().find((s) => s.id === stackId)?.name;
  }

  /** Resolve a ComfyUI app name from its id (used by the comfyui-app node's app selector). */
  getComfyuiAppName(appId: string): string | undefined {
    return this.comfyuiApps().find((a) => a.id === appId)?.name;
  }

  zoomIn(): void {
    (this.litegraphService as any).zoomBy?.(1.2);
  }

  zoomOut(): void {
    (this.litegraphService as any).zoomBy?.(1 / 1.2);
  }

  resetView(): void {
    (this.litegraphService as any).resetView?.();
  }


}