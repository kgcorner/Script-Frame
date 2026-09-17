// Integration tests: project CRUD with strict per-user ownership.
// Boots the real app in-process against a scratch SQLite DB (env is set before import).
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --- Test environment (must precede the app import; dotenv never overrides these) ---
process.env.NODE_ENV = 'test';
process.env.PORT = '3180';
process.env.JWT_SECRET = 'projects-integration-secret';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'vg-projects-it-')), 'video-generator.db');

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const API = `${BASE}/api`;

interface Session {
  token: string;
  id: string;
  username: string;
}

const owner: Partial<Session> = {};
const other: Partial<Session> = {};

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

function bearer(token: string | undefined): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function register(username: string): Promise<Session> {
  const { body } = await json('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: `${username}@example.com`, username, password: 'passw0rd123' }),
  });
  return { token: body.data.token, id: body.data.user.id, username: body.data.user.username };
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
    await new Promise((r) => setTimeout(r, 200));
  }
  owner.token = (await register('owner')).token;
  other.token = (await register('other')).token;
  owner.id = (await json('/auth/me', { headers: bearer(owner.token) })).body.data.id;
  other.id = (await json('/auth/me', { headers: bearer(other.token) })).body.data.id;
});

after(async () => {
  const { stopServer } = await import('../src/index.js');
  await stopServer();
  rmSync(process.env.DB_PATH!, { force: true });
  rmSync(process.env.DB_PATH!.replace('/video-generator.db', ''), { recursive: true, force: true });
});

describe('project CRUD + ownership', () => {
  test('rejects unauthenticated access', async () => {
    const { status, body } = await json('/projects');
    assert.equal(status, 401);
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  test('POST /api/projects creates a project owned by the caller', async () => {
    const created = await json('/projects', {
      method: 'POST',
      headers: bearer(owner.token),
      body: JSON.stringify({ name: 'My First Project', description: 'promo videos' }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.success, true);
    assert.equal(created.body.data.name, 'My First Project');
    assert.equal(created.body.data.userId, owner.id, 'project must be attached to the creator');
    assert.ok(created.body.data.id);

    // Validation: empty name -> 400.
    const invalid = await json('/projects', {
      method: 'POST',
      headers: bearer(owner.token),
      body: JSON.stringify({ name: '   ' }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, 'VALIDATION_ERROR');
  });

  test('GET /api/projects lists ONLY the caller\u2019s own projects', async () => {
    const ownerList = await json('/projects', { headers: bearer(owner.token) });
    assert.equal(ownerList.status, 200);
    assert.equal(ownerList.body.pagination.total, 1);
    assert.equal(ownerList.body.data[0].userId, owner.id);

    const otherList = await json('/projects', { headers: bearer(other.token) });
    assert.equal(otherList.status, 200);
    assert.equal(otherList.body.pagination.total, 0);
    assert.deepEqual(otherList.body.data, []);
  });

  test('GET /api/projects/:id — owner ok, foreign project hidden as 404', async () => {
    const mine = (await json('/projects', { headers: bearer(owner.token) })).body.data[0];

    const own = await json(`/projects/${mine.id}`, { headers: bearer(owner.token) });
    assert.equal(own.status, 200);
    assert.equal(own.body.data.id, mine.id);

    const foreign = await json(`/projects/${mine.id}`, { headers: bearer(other.token) });
    assert.equal(foreign.status, 404, 'a foreign project must be indistinguishable from a missing one');
    assert.equal(foreign.body.error, 'Project not found');
  });

  test('PATCH /api/projects/:id — owner can update, foreign update is a no-op 404', async () => {
    const mine = (await json('/projects', { headers: bearer(owner.token) })).body.data[0];

    const foreign = await json(`/projects/${mine.id}`, {
      method: 'PATCH',
      headers: bearer(other.token),
      body: JSON.stringify({ name: 'hijacked' }),
    });
    assert.equal(foreign.status, 404);

    const updated = await json(`/projects/${mine.id}`, {
      method: 'PATCH',
      headers: bearer(owner.token),
      body: JSON.stringify({ name: 'Renamed Project', description: null }),
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.name, 'Renamed Project');
    assert.equal(updated.body.data.description, null, 'description can be cleared with null');

    const emptyPatch = await json(`/projects/${mine.id}`, {
      method: 'PATCH',
      headers: bearer(owner.token),
      body: JSON.stringify({}),
    });
    assert.equal(emptyPatch.status, 400);
  });

  test('DELETE /api/projects/:id — owner deletes, foreign delete is a no-op 404', async () => {
    const created = await json('/projects', {
      method: 'POST',
      headers: bearer(owner.token),
      body: JSON.stringify({ name: 'Doomed Project' }),
    });
    assert.equal(created.status, 201);
    const id = created.body.data.id;

    const foreign = await json(`/projects/${id}`, {
      method: 'DELETE',
      headers: bearer(other.token),
    });
    assert.equal(foreign.status, 404);
    // Still there for the owner.
    assert.equal((await json(`/projects/${id}`, { headers: bearer(owner.token) })).status, 200);

    const ok = await json(`/projects/${id}`, { method: 'DELETE', headers: bearer(owner.token) });
    assert.equal(ok.status, 200);
    assert.equal((await json(`/projects/${id}`, { headers: bearer(owner.token) })).status, 404);
  });

  test('listing supports search and pagination (owner-scoped)', async () => {
    for (const name of ['alpha promo', 'beta teaser', 'alpha sequel']) {
      const created = await json('/projects', {
        method: 'POST',
        headers: bearer(other.token),
        body: JSON.stringify({ name }),
      });
      assert.equal(created.status, 201);
    }

    const all = await json('/projects', { headers: bearer(other.token) });
    assert.equal(all.body.pagination.total, 3);

    const searched = await json('/projects?search=alpha', { headers: bearer(other.token) });
    assert.equal(searched.body.pagination.total, 2);
    assert.ok(searched.body.data.every((p: any) => p.name.toLowerCase().includes('alpha')));

    const paged = await json('/projects?limit=1&offset=1', { headers: bearer(other.token) });
    assert.equal(paged.body.data.length, 1);
    assert.equal(paged.body.pagination.total, 3);

    // Search is owner-scoped: the owner still sees none of other's projects.
    const ownerView = await json('/projects?search=alpha', { headers: bearer(owner.token) });
    assert.equal(ownerView.body.pagination.total, 0);
  });
});

