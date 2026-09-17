// Integration tests: GET /api/jobs query filtering with user/project scoping.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.PORT = '3181';
process.env.JWT_SECRET = 'jobs-integration-secret';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'vg-jobs-it-')), 'video-generator.db');

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
  rmSync(process.env.DB_PATH!, { force: true });
  rmSync(process.env.DB_PATH!.replace('/video-generator.db', ''), { recursive: true, force: true });
});

describe('GET /api/jobs project filtering', () => {
  test('filters jobs by projectId before pagination while preserving ownership', async () => {
    const session = await register('jobs-owner');
    const projectA = await json('/projects', {
      method: 'POST',
      headers: bearer(session.token),
      body: JSON.stringify({ name: 'Project A' }),
    });
    const projectB = await json('/projects', {
      method: 'POST',
      headers: bearer(session.token),
      body: JSON.stringify({ name: 'Project B' }),
    });
    assert.equal(projectA.status, 201);
    assert.equal(projectB.status, 201);

    const { db, schema } = await import('../src/db/index.js');
    const user = (await json('/auth/me', { headers: bearer(session.token) })).body.data;
    await db.insert(schema.jobs).values([
      {
        id: 'job-project-a-1',
        type: 'video',
        status: 'completed',
        input: { prompt: 'A' },
        userId: user.id,
        projectId: projectA.body.data.id,
      },
      {
        id: 'job-project-a-2',
        type: 'video',
        status: 'pending',
        input: { prompt: 'A2' },
        userId: user.id,
        projectId: projectA.body.data.id,
      },
      {
        id: 'job-project-b-1',
        type: 'video',
        status: 'completed',
        input: { prompt: 'B' },
        userId: user.id,
        projectId: projectB.body.data.id,
      },
    ]);

    const all = await json('/jobs', { headers: bearer(session.token) });
    assert.equal(all.status, 200);
    assert.equal(all.body.data.length, 3);

    const filtered = await json(`/jobs?projectId=${encodeURIComponent(projectA.body.data.id)}&limit=1`, {
      headers: bearer(session.token),
    });
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.data.length, 1);
    assert.equal(filtered.body.data[0].projectId, projectA.body.data.id);

    const filteredPage = await json(`/jobs?projectId=${encodeURIComponent(projectA.body.data.id)}&offset=1`, {
      headers: bearer(session.token),
    });
    assert.equal(filteredPage.body.data.length, 1);
    assert.ok(filteredPage.body.data.every((job: any) => job.projectId === projectA.body.data.id));
  });
});
