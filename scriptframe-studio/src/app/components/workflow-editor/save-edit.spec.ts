import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { WorkflowEditorComponent } from './workflow-editor';
import { ScriptFrameWorkflowService } from '../../services/scriptframe-workflow.service';
import { WorkflowEditorLiteGraphService } from './workflow-editor.litgraph';
import { of } from 'rxjs';

describe('Save-edit behavior (opened via loadWorkflow)', () => {
  let component: WorkflowEditorComponent;
  let fixture: any;
  let updateId: string | null = null;

  const mockScriptFrameWorkflowService = {
    getWorkflows: () => of({ success: true, data: [{ id: 'wf-42', name: 'Old Name', createdAt: '', updatedAt: '' }] }),
    createWorkflow: (req: any) => of({ success: true, data: { ...req, id: 'wf-NEW', createdAt: '', updatedAt: '' } }),
    updateWorkflow: (id: string, req: any) => {
      updateId = id;
      return of({ success: true, data: { ...req, id, createdAt: '', updatedAt: new Date().toISOString() } });
    },
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
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [WorkflowEditorComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { params: {} } } },
        { provide: ScriptFrameWorkflowService, useValue: mockScriptFrameWorkflowService },
        { provide: WorkflowEditorLiteGraphService, useValue: mockLiteGraphService },
      ],
    });
  });

  it('updates a saved workflow in place when opened via loadWorkflow and saved', () => {
    updateId = null;
    const fixture1 = TestBed.createComponent(WorkflowEditorComponent);
    component = fixture1.componentInstance;

    // Seed the saved-workflow list directly (ngOnInit subscription is bypassed by createComponent).
    component.savedWorkflows.set([{ id: 'wf-42', name: 'Old Name', nodes: [], createdAt: '', updatedAt: '' } as any]);

    // Open the saved workflow from the list (no route param).
    component.loadWorkflow({ id: 'wf-42', name: 'Old Name', nodes: [], createdAt: '', updatedAt: '' } as any);

    // Set dialog data so confirmSaveWorkflow proceeds past the empty-name guard.
    component.saveDialogData = { name: 'Edited Name', description: '', maxClipLength: null, maxTimeout: null, nsfw: false };

    // Make a change, then save.
    component.workflow.update((wf) => ({ ...wf, name: 'Edited Name' }));
    component.confirmSaveWorkflow();

    // Save must update in place with the original id, not create new.
    expect(updateId).toBe('wf-42');
    expect(component.savedWorkflows().length).toBe(1);
    expect(component.savedWorkflows()[0].id).toBe('wf-42');
  });

  it('creates a new workflow when opened without an editing session flag', () => {
    updateId = null;

    // Simulate a fresh editor with no saved-workflow context.
    const fixture2 = TestBed.createComponent(WorkflowEditorComponent);
    component = fixture2.componentInstance;
    component.savedWorkflows.set([]);
    component.editingExistingId.set(null);
    const empty = { id: 'temp-1', name: '', nodes: [], createdAt: '', updatedAt: '' } as any;
    component.loadWorkflow(empty);

    component.workflow.update((wf) => ({ ...wf, name: 'Brand New' }));
    // Force the create branch by clearing the flag after load (mimics a route-less open).
    component.editingExistingId.set(null);
    component.saveDialogData = { name: 'Brand New', description: '', maxClipLength: null, maxTimeout: null, nsfw: false };
    component.confirmSaveWorkflow();

    expect(updateId).toBeNull();
  });
});
