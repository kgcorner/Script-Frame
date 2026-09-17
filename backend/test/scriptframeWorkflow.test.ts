
describe('LLM App endpoint/apiKey persistence (Issue 1)', () => {
  it('should persist and return per-app endpoint / apiKey overrides', async () => {
    const provider = await llmProviderService.createProvider({
      name: 'anthropic',
      displayName: 'Anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'provider-key',
    });

    // Default create (no overrides) -> endpoint/apiKey are null.
    const appDefault = await llmProviderService.createApp({
      name: 'Default App',
      providerId: provider.id,
      model: 'claude-1',
    });
    assert.strictEqual(appDefault.endpoint, null);
    assert.strictEqual(appDefault.apiKey, null);

    // Create with per-app overrides -> persisted to the app row.
    const appOverride = await llmProviderService.createApp({
      name: 'Custom Endpoint App',
      providerId: provider.id,
      model: 'claude-1',
      endpoint: 'https://custom.example.com/v1',
      apiKey: 'app-key',
    });
    assert.strictEqual(appOverride.endpoint, 'https://custom.example.com/v1');
    assert.strictEqual(appOverride.apiKey, 'app-key');

    // Retrieval round-trips the overrides.
    const fetched = await llmProviderService.getApp(appOverride.id);
    assert.ok(fetched);
    assert.strictEqual(fetched?.endpoint, 'https://custom.example.com/v1');
    assert.strictEqual(fetched?.apiKey, 'app-key');

    // Update path also persists overrides.
    const updated = await llmProviderService.updateApp(appDefault.id, {
      endpoint: 'https://updated.example.com',
      apiKey: 'updated-key',
    });
    assert.strictEqual(updated?.endpoint, 'https://updated.example.com');
    assert.strictEqual(updated?.apiKey, 'updated-key');
  });
});
import test, { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { scriptframeWorkflowService } from '../src/services/scriptframeWorkflow.js';
import { llmProviderService } from '../src/services/llmProvider.js';
import { initDb } from '../src/db/index.js';
import type { ScriptFrameNode } from '../src/types/index.js';

describe('ScriptFrameWorkflowService', () => {
  before(async () => {
    await initDb();
  });

  it('should create and retrieve a scriptframe workflow', async () => {
    const nodes: ScriptFrameNode[] = [
      {
        id: 'worker-1',
        type: 'worker',
        title: 'Worker',
        position: { x: 100, y: 100 },
        inputs: [],
        outputs: [
          { name: 'llm', type: 'llm', links: [1] },
          { name: 'comfyui-stack', type: 'comfyui-stack', links: [2] }
        ],
        data: { llmAppId: 'dummy-llm', comfyuiStackId: 'dummy-stack' },
      },
      {
        id: 'llm-1',
        type: 'llm',
        title: 'LLM App Node',
        position: { x: 400, y: 100 },
        inputs: [{ name: 'worker', type: 'llm', link: 1, linkedNodeId: 'worker-1', linkedOutputName: 'llm' }],
        outputs: [],
        data: { appId: 'dummy-app', appName: 'My LLM App', systemPrompt: '' },
      },
      {
        id: 'comfyui-stack-1',
        type: 'comfyui-stack',
        title: 'ComfyUI Stack Node',
        position: { x: 400, y: 280 },
        inputs: [{ name: 'worker', type: 'comfyui-stack', link: 2, linkedNodeId: 'worker-1', linkedOutputName: 'comfyui-stack' }],
        outputs: [{ name: 'comfyui-apps', type: 'comfyui-app', links: [3] }],
        data: { comfyuiStackId: 'dummy-stack', comfyuiStackName: 'My Stack' },
      },
      {
        id: 'comfyui-app-1',
        type: 'comfyui-app',
        title: 'ComfyUI App Node',
        position: { x: 700, y: 280 },
        inputs: [{ name: 'stack', type: 'comfyui-app', link: 3, linkedNodeId: 'comfyui-stack-1', linkedOutputName: 'comfyui-apps' }],
        outputs: [],
        data: { comfyuiAppId: 'dummy-app', comfyuiAppName: 'My App' },
      },
    ];

    const links = [
      { id: 1, sourceNodeId: 'worker-1', sourceOutputName: 'llm', targetNodeId: 'llm-1', targetInputName: 'worker' },
      { id: 2, sourceNodeId: 'worker-1', sourceOutputName: 'comfyui-stack', targetNodeId: 'comfyui-stack-1', targetInputName: 'worker' },
      { id: 3, sourceNodeId: 'comfyui-stack-1', sourceOutputName: 'comfyui-apps', targetNodeId: 'comfyui-app-1', targetInputName: 'stack' },
    ];

    const created = await scriptframeWorkflowService.createWorkflow({
      name: 'Test ScriptFrame Workflow',
      description: 'Testing workflow persistence',
      nodes,
      links,
      nsfw: true,
    });

    assert.ok(created.id, 'Workflow should have an ID');
    assert.strictEqual(created.name, 'Test ScriptFrame Workflow');
    assert.strictEqual(created.nodes.length, 4);
    assert.strictEqual(created.links?.length, 3);
    assert.strictEqual(created.nsfw, true);

    const fetched = await scriptframeWorkflowService.getWorkflow(created.id);
    assert.ok(fetched, 'Workflow should be found by ID');
    assert.strictEqual(fetched.name, 'Test ScriptFrame Workflow');
    assert.strictEqual(fetched.nodes.length, 4);
    assert.strictEqual(fetched.links?.length, 3);
    assert.strictEqual(fetched.nodes[0].type, 'worker');
    assert.strictEqual(fetched.nodes[1].type, 'llm');
    assert.strictEqual(fetched.nodes[2].type, 'comfyui-stack');
    assert.strictEqual(fetched.nodes[3].type, 'comfyui-app');
    assert.strictEqual(fetched.nsfw, true);
  });

  it('should update a scriptframe workflow', async () => {
    const created = await scriptframeWorkflowService.createWorkflow({
      name: 'Initial Name',
      nodes: [
        {
          id: 'worker-1',
          type: 'worker',
          title: 'Worker',
          position: { x: 0, y: 0 },
          inputs: [],
          outputs: [],
        },
      ],
    });

    const updated = await scriptframeWorkflowService.updateWorkflow(created.id, {
      name: 'Updated Name',
      description: 'Updated Description',
      nsfw: true,
    });

    assert.ok(updated);
    assert.strictEqual(updated.name, 'Updated Name');
    assert.strictEqual(updated.description, 'Updated Description');
    assert.strictEqual(updated.nsfw, true);
  });

  it('should handle test connection for unconfigured LLM app', async () => {
    const res = await scriptframeWorkflowService.testConnection({
      nodeId: 'llm-node-1',
      type: 'llm',
      appId: undefined,
    });

    assert.strictEqual(res.nodeId, 'llm-node-1');
    assert.strictEqual(res.type, 'llm');
    assert.strictEqual(res.status, 'unhealthy');
    assert.strictEqual(res.message, 'No LLM App selected');
  });

  it('should handle test connection for comfyui-stack', async () => {
    const res = await scriptframeWorkflowService.testConnection({
      nodeId: 'comfyui-stack-1',
      type: 'comfyui-stack',
    });

    assert.strictEqual(res.nodeId, 'comfyui-stack-1');
    assert.strictEqual(res.type, 'comfyui-stack');
    assert.ok(res.status === 'healthy' || res.status === 'unhealthy');
    assert.ok(res.message);
  });

  it('should handle test connection for comfyui-app', async () => {
    const res = await scriptframeWorkflowService.testConnection({
      nodeId: 'comfyui-app-1',
      type: 'comfyui-app',
    });

    assert.strictEqual(res.nodeId, 'comfyui-app-1');
    assert.strictEqual(res.type, 'comfyui-app');
    assert.ok(res.status === 'healthy' || res.status === 'unhealthy');
    assert.ok(res.message);
  });

  it('should persist Start and Character-Scene-Creator nodes', async () => {
    const nodes: ScriptFrameNode[] = [
      {
        id: 'start-1',
        type: 'start',
        title: 'Start Node',
        position: { x: 0, y: 0 },
        // Start has no inputs and a single wildcard output that emits no data.
        inputs: [],
        outputs: [{ name: 'start', type: '*', links: [1] }],
      },
      {
        id: 'character-scene-creator-1',
        type: 'character-scene-creator',
        title: 'Character-Scene-Creator Node',
        position: { x: 300, y: 0 },
        inputs: [
          { name: 'script', type: 'script', link: 1, linkedNodeId: 'start-1', linkedOutputName: 'start' },
          { name: 'character-prompts', type: 'character-prompts', link: null },
          { name: 'location-prompts', type: 'location-prompts', link: null },
          { name: 'comfyui-stack', type: 'comfyui-stack', link: null },
        ],
        outputs: [
          { name: 'script', type: 'script', links: [] },
          { name: 'character-images', type: 'character-images', links: [] },
          { name: 'location-images', type: 'location-images', links: [] },
        ],
        data: { script: 'Once upon a time', characterPrompts: ['hero'], locationPrompts: ['forest'] },
      },
    ];

    const links = [
      { id: 1, sourceNodeId: 'start-1', sourceOutputName: 'start', targetNodeId: 'character-scene-creator-1', targetInputName: 'script' },
    ];

    const created = await scriptframeWorkflowService.createWorkflow({
      name: 'Start -> Character-Scene-Creator',
      nodes,
      links,
    });

    const fetched = await scriptframeWorkflowService.getWorkflow(created.id);
    assert.ok(fetched, 'Workflow should be found by ID');
    assert.strictEqual(fetched.nodes.length, 2);
    assert.strictEqual(fetched.nodes[0].type, 'start');
    assert.strictEqual(fetched.nodes[1].type, 'character-scene-creator');
    assert.deepStrictEqual(fetched.nodes[1].data?.characterPrompts, ['hero']);
    assert.deepStrictEqual(fetched.nodes[1].data?.locationPrompts, ['forest']);
    assert.strictEqual(fetched.links?.length, 1);
  });
});
