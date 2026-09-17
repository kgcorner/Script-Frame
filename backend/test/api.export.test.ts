// Integration tests: export jobs optionally persist their caller-owned project ID.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.PORT = '3182';
process.env.JWT_SECRET = 'export-integration-secret';
const testRoot = mkdtempSync(join(tmpdir(), 'vg-export-it-'));
process.env.DB_PATH = join(testRoot, 'video-generator.db');
process.env.GENERATOR_ASSETS_PATH = join(testRoot, 'assets');
mkdirSync(process.env.GENERATOR_ASSETS_PATH, { recursive: true });
writeFileSync(join(process.env.GENERATOR_ASSETS_PATH, 'clip.mp4'), 'test video');

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const API = `${BASE}/api`;

interface Session {
  token: string;
}

async function json(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function register(username: string): Promise<Session> {
  const { body } = await json('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: `${username}@example.com`, username, password: 'passw0rd123' }),
  });
  return { token: body.data.token };
}

before(async () => {
  await import('../src/index.js');
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error('server did not start in time');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
});

after(async () => {
  const { stopServer } = await import('../src/index.js');
  await stopServer();
  rmSync(testRoot, { recursive: true, force: true });
});

describe('POST /api/export/video project association', () => {
  test('persists an optional projectId on the export job', async () => {
    const session = await register('export-owner');
    const project = await json('/projects', {
      method: 'POST',
      headers: bearer(session.token),
      body: JSON.stringify({ name: 'Export Project' }),
    });
    assert.equal(project.status, 201);

    const created = await json('/export/video', {
      method: 'POST',
      headers: bearer(session.token),
      body: JSON.stringify({ videos: ['clip.mp4'], projectId: project.body.data.id }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.projectId, project.body.data.id);

    const job = await json(`/jobs/${created.body.data.jobId}`, { headers: bearer(session.token) });
    assert.equal(job.status, 200);
    assert.equal(job.body.data.type, 'export');
    assert.equal(job.body.data.projectId, project.body.data.id);
  });

  test('rejects a projectId that belongs to another user', async () => {
    const owner = await register('export-project-owner');
    const project = await json('/projects', {
      method: 'POST',
      headers: bearer(owner.token),
      body: JSON.stringify({ name: 'Private Export Project' }),
    });
    const otherUser = await register('export-project-other-user');

    const created = await json('/export/video', {
      method: 'POST',
      headers: bearer(otherUser.token),
      body: JSON.stringify({ videos: ['clip.mp4'], projectId: project.body.data.id }),
    });
    assert.equal(created.status, 404);
    assert.equal(created.body.error, 'Project not found');
  });

  test('keeps projectId nullable for exports that omit it', async () => {
    const session = await register('export-owner-no-project');
    const created = await json('/export/video', {
      method: 'POST',
      headers: bearer(session.token),
      body: JSON.stringify({ videos: ['clip.mp4'] }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.projectId, undefined);

    const job = await json(`/jobs/${created.body.data.jobId}`, { headers: bearer(session.token) });
    assert.equal(job.status, 200);
    assert.equal(job.body.data.projectId, null);
  });
});
