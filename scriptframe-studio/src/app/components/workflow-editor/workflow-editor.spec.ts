import { TestBed, ComponentFixture } from '@angular/core/testing';
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
    createWorkflow: (req: any) => of({ success: true, data: { ...req, id: 'wf-123', createdAt: '', updatedAt: '' } }),
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
});
