import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { WorkflowEditorComponent } from './workflow-editor';
import { LLMProviderService } from '../../services/llm-provider.service';
import { ComfyUIAppService } from '../../services/comfyui-app.service';
import { ComfyUIStackService } from '../../services/comfyui-stack.service';
import { ScriptFrameWorkflowService } from '../../services/scriptframe-workflow.service';
import { WorkflowEditorLiteGraphService } from './workflow-editor.litgraph';
import { of } from 'rxjs';

describe('WorkflowEditorComponent', () => {
  let component: WorkflowEditorComponent;
  let fixture: ComponentFixture<WorkflowEditorComponent>;

  const mockLLMProviderService = {
    getApps: () => of({ success: true, data: [{ id: 'llm-1', name: 'OpenAI GPT-4', model: 'gpt-4o' }] }),
  };

  const mockComfyUIAppService = {
    getApps: () => of({ success: true, data: [{ id: 'comfy-1', name: 'Text2Image FLUX' }] }),
  };

  const mockComfyUIStackService = {
    getStacks: () => of({ success: true, data: [{ id: 'stack-1', name: 'Portrait Stack', appIds: ['comfy-1'], isActive: true, createdAt: '', updatedAt: '' }] }),
  };

  const mockScriptFrameWorkflowService = {
    getWorkflows: () => of({ success: true, data: [] }),
    createWorkflow: (req: any) => of({ success: true, data: { ...req, id: 'wf-NEW', createdAt: '', updatedAt: '' } }),
    updateWorkflow: (id: string, req: any) => of({ success: true, data: { ...req, id, createdAt: '', updatedAt: new Date().toISOString() } }),
    testAllConnections: (targets: any) =>
      of({
        success: true,
        data: targets.map((t: any) => ({
          nodeId: t.nodeId,
          type: t.type,
          status: 'healthy',
          message: 'Connection successful',
          latency: 20,
        })),
      }),
  };

  const mockLiteGraphService = {
    setup: () => {},
    destroy: () => {},
    syncFromWorkflow: () => {},
    getSnapshot: () => ({ nodes: [], links: [] }),
    setZoomRange: () => {},
    setPalette: () => {},
    addNode: () => {},
    removeNode: () => {},
    removeLink: () => {},
    loadWorkflow: () => {},
    updateNode: () => {},
    clearSelection: () => {},
    getCanvasState: () => ({ scale: 1, offset: [0, 0] as [number, number] }),
    zoomBy: () => {},
    resetView: () => {},
    hasNode: () => false,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkflowEditorComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { params: {} } } },
        { provide: LLMProviderService, useValue: mockLLMProviderService },
        { provide: ComfyUIAppService, useValue: mockComfyUIAppService },
        { provide: ComfyUIStackService, useValue: mockComfyUIStackService },
        { provide: ScriptFrameWorkflowService, useValue: mockScriptFrameWorkflowService },
        { provide: WorkflowEditorLiteGraphService, useValue: mockLiteGraphService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkflowEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should initialize with default ScriptFrame workflow (Worker -> LLM -> ComfyUI)', () => {
    expect(component).toBeTruthy();
    const wf = component.workflow();
    expect(wf.nodes.length).toBe(4);
    expect(wf.nodes[0].type).toBe('worker');
    expect(wf.nodes[1].type).toBe('llm');
    expect(wf.nodes[2].type).toBe('comfyui-stack');
    expect(wf.nodes[3].type).toBe('comfyui-app');
  });

  it('should render Test button in toolbar instead of Execute button', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const testBtn = compiled.querySelector<HTMLButtonElement>('.btn-test');
    expect(testBtn).toBeTruthy();
    expect(testBtn?.textContent).toContain('Test');
  });

  it('should render NSFW toggle in toolbar', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const nsfw = compiled.querySelector<HTMLElement>('.nsfw-toggle');
    expect(nsfw).toBeTruthy();
    expect(nsfw?.textContent).toContain('NSFW');
  });

  it('should execute connection test when test button is triggered', () => {
    component.testWorkflow();
    expect(component.testResults().length).toBeGreaterThan(0);
    expect(component.testResults()[0].status).toBe('healthy');
  });

  it('should update node data correctly', () => {
    const workerNode = component.workflow().nodes.find((n) => n.type === 'worker');
    expect(workerNode).toBeTruthy();
    component.updateNodeData(workerNode!.id, 'llmAppId', 'llm-1');
    const updated = component.workflow().nodes.find((n) => n.id === workerNode!.id);
    expect(updated?.data?.llmAppId).toBe('llm-1');
  });

  it('should toggle workflow NSFW flag', () => {
    expect(component.workflow().nsfw).toBe(false);
    component.updateWorkflowNsfw(true);
    expect(component.workflow().nsfw).toBe(true);
  });

  it('should update a saved workflow in place when opened via loadWorkflow and saved', () => {
    // Seed the saved-workflow list so the in-place update can be reflected there.
    const saved = { id: 'wf-42', name: 'Old Name', nodes: [], createdAt: '', updatedAt: '' } as any;
    component.savedWorkflows.set([saved]);

    // Simulate opening an existing saved workflow from the list (no route param present).
    component.loadWorkflow(saved);

    // Track which persist method save triggers.
    let updateId: string | null = null;
    mockScriptFrameWorkflowService.updateWorkflow = (id: string) => {
      updateId = id;
      return of({ success: true, data: { ...saved, name: 'Edited Name', id } });
    };

    // Make a change, fill the save dialog and confirm (saveWorkflow() only opens the dialog).
    component.workflow.update((wf) => ({ ...wf, name: 'Edited Name' }));
    component.saveDialogData = { name: 'Edited Name', description: '', maxClipLength: null, maxTimeout: null, nsfw: false };
    component.confirmSaveWorkflow();

    // The original id must be preserved (update in place), not a new one.
    expect(updateId).toBe('wf-42');

    // The saved list should reflect the updated workflow, not a new entry.
    expect(component.savedWorkflows().length).toBe(1);
    expect(component.savedWorkflows()[0].id).toBe('wf-42');
  });

  it('should expose the Start and Character-Scene-Creator nodes in the palette', () => {
    const types = component.paletteNodeTypes.map((p) => p.type);
    expect(types).toContain('start');
    expect(types).toContain('character-scene-creator');
  });

  it('should create a Start node with no inputs and a single wildcard trigger output', () => {
    const entry = component.paletteNodeTypes.find((p) => p.type === 'start')!;
    (component as any).addNode(entry, 10, 20);

    const node = component.workflow().nodes.find((n) => n.type === 'start');
    expect(node).toBeTruthy();
    // Start emits no data and takes no input; it only lets the first node connect.
    expect(node!.inputs.length).toBe(0);
    expect(node!.outputs.length).toBe(1);
    expect(node!.outputs[0].type).toBe('*');
  });

  it('should create a Character-Scene-Creator node with 4 inputs and 3 outputs', () => {
    const entry = component.paletteNodeTypes.find((p) => p.type === 'character-scene-creator')!;
    (component as any).addNode(entry, 10, 20);

    const node = component.workflow().nodes.find((n) => n.type === 'character-scene-creator');
    expect(node).toBeTruthy();
    expect(node!.inputs.map((i) => i.name)).toEqual([
      'script',
      'character-prompts',
      'location-prompts',
      'comfyui-stack',
    ]);
    expect(node!.outputs.map((o) => o.name)).toEqual([
      'script',
      'character-images',
      'location-images',
    ]);
  });

  it('should convert between prompt text and prompt arrays for the Character-Scene-Creator node', () => {
    expect(component.promptsToText(['a', 'b'])).toBe('a\nb');
    expect(component.promptsToText(undefined)).toBe('');
    expect(component.textToPrompts(' a \n\n b \n')).toEqual(['a', 'b']);
  });

  it('should store character/location prompt arrays on the Character-Scene-Creator node', () => {
    const entry = component.paletteNodeTypes.find((p) => p.type === 'character-scene-creator')!;
    (component as any).addNode(entry, 10, 20);
    const node = component.workflow().nodes.find((n) => n.type === 'character-scene-creator')!;

    component.updateNodeData(node.id, 'characterPrompts', component.textToPrompts('hero\nvillain'));
    component.updateNodeData(node.id, 'locationPrompts', component.textToPrompts('forest'));

    const updated = component.workflow().nodes.find((n) => n.id === node.id)!;
    expect(updated.data?.['characterPrompts']).toEqual(['hero', 'villain']);
    expect(updated.data?.['locationPrompts']).toEqual(['forest']);
  });
});
