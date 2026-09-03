import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { comfyuiAppService } from '../src/services/comfyuiApp.js';
import { initDb } from '../src/db/index.js';
import { v4 as uuidv4 } from 'uuid';

describe('ComfyUIStackService', () => {
  before(async () => {
    await initDb();
  });

  it('should create, retrieve, update, and delete a stack', async () => {
    const name = `Stack-${uuidv4().slice(0, 8)}`;

    const created = await comfyuiAppService.createStack({
      name,
      description: 'Test comfyui stack',
      baseUrl: 'http://localhost:8188',
      port: 8188,
      appIds: [],
    });

    assert.ok(created.id, 'Stack should have an ID');
    assert.strictEqual(created.name, name);
    assert.deepStrictEqual(created.appIds, []);

    const fetched = await comfyuiAppService.getStack(created.id);
    assert.ok(fetched, 'Stack should be retrievable');
    assert.strictEqual(fetched.name, name);
    assert.strictEqual(fetched.port, 8188);

    const updated = await comfyuiAppService.updateStack(created.id, {
      name: `${name}-updated`,
      appIds: [],
    });
    assert.ok(updated);
    assert.strictEqual(updated.name, `${name}-updated`);

    await comfyuiAppService.deleteStack(created.id);
    const gone = await comfyuiAppService.getStack(created.id);
    assert.strictEqual(gone, null);
  });

  it('should list stacks', async () => {
    const name = `ListStack-${uuidv4().slice(0, 8)}`;
    await comfyuiAppService.createStack({ name, appIds: [] });
    const stacks = await comfyuiAppService.getStacks();
    assert.ok(stacks.some((s) => s.name === name));
  });

  it('should return unhealthy health check for a non-existent stack', async () => {
    const res = await comfyuiAppService.stackHealthCheck('nope-does-not-exist');
    assert.strictEqual(res.healthy, false);
    assert.ok(res.message);
  });
});