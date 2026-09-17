// Integration tests: authentication gate on existing endpoints + register/login/user-CRUD/RBAC.
// Boots the real app in-process against a scratch SQLite DB (env is set before import).
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --- Test environment (must precede the app import; dotenv never overrides these) ---
process.env.NODE_ENV = 'test';
process.env.PORT = '3179';
process.env.JWT_SECRET = 'integration-test-secret';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'vg-auth-it-')), 'video-generator.db');
// No ADMIN_* vars on purpose: the first public registrant must become admin.

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const API = `${BASE}/api`;

interface Auth {
  token: string;
  id: string;
  email: string;
  username: string;
  role: string;
}

const admin: Partial<Auth> = {};
const user1: Partial<Auth> = {};
const user2: Partial<Auth> = {};

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

before(async () => {
  await import('../src/index.js');
  // Wait for the liveness probe (root /health is public by design).
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
});

after(async () => {
  const { stopServer } = await import('../src/index.js');
  await stopServer();
  rmSync(process.env.DB_PATH!, { force: true });
  rmSync(process.env.DB_PATH!.replace('/video-generator.db', ''), { recursive: true, force: true });
});

describe('global authentication gate', () => {
  test('root /health stays public (liveness probe)', async () => {
    const res = await fetch(`${BASE}/health`);
    assert.equal(res.status, 200);
  });

  test('existing endpoints reject requests without a token (401 + UNAUTHORIZED)', async () => {
    const { status, body } = await json('/jobs');
    assert.equal(status, 401);
    assert.equal(body.success, false);
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  test('garbage and tampered tokens are rejected (401)', async () => {
    const garbage = await json('/jobs', { headers: bearer('not-a-real-token') });
    assert.equal(garbage.status, 401);
    assert.equal(garbage.body.code, 'UNAUTHORIZED');

    // Signed-with-foreign-secret token -> signature check must fail.
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign({ sub: 'x', role: 'admin' }, 'wrong-secret');
    const tampered = await json('/jobs', { headers: bearer(forged) });
    assert.equal(tampered.status, 401);
  });

  test('artifact mounts are public while other API routes remain protected', async () => {
    const rootArtifact = await fetch(`${BASE}/artifact/whatever.png`);
    assert.equal(rootArtifact.status, 404);

    const apiArtifact = await fetch(`${API}/artifact/whatever.png`);
    assert.equal(apiArtifact.status, 404);

    const protectedRoute = await json('/jobs');
    assert.equal(protectedRoute.status, 401);
    assert.equal(protectedRoute.body.code, 'UNAUTHORIZED');
  });

  test('health endpoints other than /connection stay token-protected', async () => {
    const latest = await json('/health/latest');
    assert.equal(latest.status, 401);
    assert.equal(latest.body.code, 'UNAUTHORIZED');

    const history = await json('/health/history?service=omniroute');
    assert.equal(history.status, 401);
    assert.equal(history.body.code, 'UNAUTHORIZED');
  });
});

describe('registration & login', () => {
  test('POST /api/auth/register: first account on a fresh instance becomes admin', async () => {
    const { status, body } = await json('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'admin@example.com',
        username: 'admin',
        password: 'adminPass123',
      }),
    });
    assert.equal(status, 201);
    assert.equal(body.success, true);
    assert.equal(body.data.user.role, 'admin');
    assert.ok(body.data.token.length > 20);
    assert.equal(body.data.user.passwordHash, undefined, 'password hash must never leak');
    Object.assign(admin, {
      token: body.data.token,
      id: body.data.user.id,
      email: 'admin@example.com',
      username: 'admin',
      role: 'admin',
    });
  });

  test('POST /api/auth/register: second account gets the user role', async () => {
    const { status, body } = await json('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'user1@example.com',
        username: 'user1',
        password: 'user1Pass123',
      }),
    });
    assert.equal(status, 201);
    assert.equal(body.data.user.role, 'user');
    Object.assign(user1, {
      token: body.data.token,
      id: body.data.user.id,
      email: 'user1@example.com',
      username: 'user1',
      role: 'user',
    });
  });

  test('duplicate email / username are rejected with 409', async () => {
    const dupEmail = await json('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'ADMIN@example.com', username: 'other', password: 'whatever123' }),
    });
    assert.equal(dupEmail.status, 409); // emails are case-insensitive

    const dupUsername = await json('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'other@example.com', username: 'user1', password: 'whatever123' }),
    });
    assert.equal(dupUsername.status, 409);
  });

  test('weak passwords fail validation (400)', async () => {
    const short = await json('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'x@example.com', username: 'xx1', password: 'short' }),
    });
    assert.equal(short.status, 400);
    assert.equal(short.body.code, 'VALIDATION_ERROR');

    const noDigit = await json('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'x@example.com', username: 'xx1', password: 'nodigitsonly' }),
    });
    assert.equal(noDigit.status, 400);
  });

  test('login works with email, username and identifier', async () => {
    const byEmail = await json('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@example.com', password: 'adminPass123' }),
    });
    assert.equal(byEmail.status, 200);
    assert.equal(byEmail.body.data.user.email, 'admin@example.com');
    assert.ok(byEmail.body.data.token);

    const byUsername = await json('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'user1', password: 'user1Pass123' }),
    });
    assert.equal(byUsername.status, 200);
    assert.equal(byUsername.body.data.user.username, 'user1');

    const byIdentifier = await json('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: 'user1@example.com', password: 'user1Pass123' }),
    });
    assert.equal(byIdentifier.status, 200);
  });

  test('wrong password / unknown user -> generic 401 Invalid credentials', async () => {
    const wrongPw = await json('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: 'admin@example.com', password: 'wrongPass123' }),
    });
    assert.equal(wrongPw.status, 401);
    assert.equal(wrongPw.body.error, 'Invalid credentials');

    const unknown = await json('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: 'ghost@example.com', password: 'whatever123' }),
    });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error, 'Invalid credentials');
  });

  test('GET /api/auth/me returns the token principal; 401 without a token', async () => {
    const mine = await json('/auth/me', { headers: bearer(admin.token) });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.data.email, admin.email);

    const anon = await json('/auth/me');
    assert.equal(anon.status, 401);
  });
});

describe('authenticated access to existing endpoints', () => {
  test('GET /api/jobs works with a valid token', async () => {
    const { status, body } = await json('/jobs', { headers: bearer(admin.token) });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));
  });

  test('GET /api/artifact/:name with a token passes the gate (404, not 401)', async () => {
    const { status } = await json('/artifact/does-not-exist.png', { headers: bearer(admin.token) });
    assert.equal(status, 404);
  });
});

describe('user management (CRUD) + RBAC', () => {
  test('non-admin cannot list users (403); admin can (with pagination)', async () => {
    const forbidden = await json('/users', { headers: bearer(user1.token) });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.code, 'FORBIDDEN');

    const ok = await json('/users', { headers: bearer(admin.token) });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.pagination.total, 2);
    assert.ok(Array.isArray(ok.body.data));
    assert.equal(ok.body.data[0].passwordHash, undefined);
  });

  test('admin creates a user via POST /api/users; non-admin gets 403', async () => {
    const forbidden = await json('/users', {
      method: 'POST',
      headers: bearer(user1.token),
      body: JSON.stringify({ email: 'user2@example.com', username: 'user2', password: 'user2Pass123' }),
    });
    assert.equal(forbidden.status, 403);

    const created = await json('/users', {
      method: 'POST',
      headers: bearer(admin.token),
      body: JSON.stringify({ email: 'user2@example.com', username: 'user2', password: 'user2Pass123' }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.role, 'user'); // explicit default, not the bootstrap rule
    Object.assign(user2, {
      id: created.body.data.id,
      email: 'user2@example.com',
      username: 'user2',
      role: 'user',
    });

    const duplicate = await json('/users', {
      method: 'POST',
      headers: bearer(admin.token),
      body: JSON.stringify({ email: 'user2@example.com', username: 'user2b', password: 'user2Pass123' }),
    });
    assert.equal(duplicate.status, 409);
  });

  test('GET /api/users/:id: self allowed, other users 403, admin allowed', async () => {
    const self = await json(`/users/${user1.id}`, { headers: bearer(user1.token) });
    assert.equal(self.status, 200);
    assert.equal(self.body.data.email, user1.email);

    const other = await json(`/users/${admin.id}`, { headers: bearer(user1.token) });
    assert.equal(other.status, 403);

    const asAdmin = await json(`/users/${user1.id}`, { headers: bearer(admin.token) });
    assert.equal(asAdmin.status, 200);

    const missing = await json('/users/00000000-0000-4000-8000-000000000000', {
      headers: bearer(admin.token),
    });
    assert.equal(missing.status, 404);
  });

  test('self-service PATCH: username ok; admin-only fields 403; other user 403', async () => {
    const rename = await json(`/users/${user1.id}`, {
      method: 'PATCH',
      headers: bearer(user1.token),
      body: JSON.stringify({ username: 'user1-renamed' }),
    });
    assert.equal(rename.status, 200);
    assert.equal(rename.body.data.username, 'user1-renamed');

    const roleChange = await json(`/users/${user1.id}`, {
      method: 'PATCH',
      headers: bearer(user1.token),
      body: JSON.stringify({ role: 'admin' }),
    });
    assert.equal(roleChange.status, 403);

    const emailChange = await json(`/users/${user1.id}`, {
      method: 'PATCH',
      headers: bearer(user1.token),
      body: JSON.stringify({ email: 'hacker@example.com' }),
    });
    assert.equal(emailChange.status, 403);

    const otherUser = await json(`/users/${user2.id}`, {
      method: 'PATCH',
      headers: bearer(user1.token),
      body: JSON.stringify({ username: 'hijacked' }),
    });
    assert.equal(otherUser.status, 403);
  });

  test('self-service password change requires the correct currentPassword', async () => {
    const missing = await json(`/users/${user1.id}`, {
      method: 'PATCH',
      headers: bearer(user1.token),
      body: JSON.stringify({ password: 'newPass1234' }),
    });
    assert.equal(missing.status, 400);

    const wrong = await json(`/users/${user1.id}`, {
      method: 'PATCH',
      headers: bearer(user1.token),
      body: JSON.stringify({ password: 'newPass1234', currentPassword: 'nope' }),
    });
    assert.equal(wrong.status, 401);

    const ok = await json(`/users/${user1.id}`, {
      method: 'PATCH',
      headers: bearer(user1.token),
      body: JSON.stringify({ password: 'newPass1234', currentPassword: 'user1Pass123' }),
    });
    assert.equal(ok.status, 200);

    // Old password no longer works, new one does.
    const oldLogin = await json('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: 'user1-renamed', password: 'user1Pass123' }),
    });
    assert.equal(oldLogin.status, 401);

    const newLogin = await json('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: 'user1-renamed', password: 'newPass1234' }),
    });
    assert.equal(newLogin.status, 200);
    user1.token = newLogin.body.data.token; // refresh for the remaining tests
  });

  test('admin PATCH: role promotion works and self-lockout is prevented', async () => {
    const promote = await json(`/users/${user2.id}`, {
      method: 'PATCH',
      headers: bearer(admin.token),
      body: JSON.stringify({ role: 'admin', isActive: true }),
    });
    assert.equal(promote.status, 200);
    assert.equal(promote.body.data.role, 'admin');

    const demoteSelf = await json(`/users/${admin.id}`, {
      method: 'PATCH',
      headers: bearer(admin.token),
      body: JSON.stringify({ role: 'user' }),
    });
    assert.equal(demoteSelf.status, 400);

    const deactivateSelf = await json(`/users/${admin.id}`, {
      method: 'PATCH',
      headers: bearer(admin.token),
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(deactivateSelf.status, 400);
  });

  test('DELETE /api/users/:id: admin only, not self, target really gone', async () => {
    const asUser = await json(`/users/${user2.id}`, {
      method: 'DELETE',
      headers: bearer(user1.token),
    });
    assert.equal(asUser.status, 403);

    const selfDelete = await json(`/users/${admin.id}`, {
      method: 'DELETE',
      headers: bearer(admin.token),
    });
    assert.equal(selfDelete.status, 400);

    const ok = await json(`/users/${user2.id}`, {
      method: 'DELETE',
      headers: bearer(admin.token),
    });
    assert.equal(ok.status, 200);

    const gone = await json(`/users/${user2.id}`, { headers: bearer(admin.token) });
    assert.equal(gone.status, 404);
  });

  test('deactivated accounts cannot log in', async () => {
    const created = await json('/users', {
      method: 'POST',
      headers: bearer(admin.token),
      body: JSON.stringify({ email: 'inactive@example.com', username: 'inactive', password: 'inactive123' }),
    });
    assert.equal(created.status, 201);

    const deactivated = await json(`/users/${created.body.data.id}`, {
      method: 'PATCH',
      headers: bearer(admin.token),
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(deactivated.status, 200);
    assert.equal(deactivated.body.data.isActive, false);

    const login = await json('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: 'inactive@example.com', password: 'inactive123' }),
    });
    assert.equal(login.status, 401);
  });

  test('user listing filters work (search/role)', async () => {
    const byRole = await json('/users?role=admin', { headers: bearer(admin.token) });
    assert.equal(byRole.status, 200);
    assert.equal(byRole.body.pagination.total, 1); // only the bootstrap admin remains

    const bySearch = await json('/users?search=user1', { headers: bearer(admin.token) });
    assert.equal(bySearch.status, 200);
    assert.equal(bySearch.body.pagination.total, 1);
    assert.equal(bySearch.body.data[0].username, 'user1-renamed');
  });
});

describe('service connection check (LLM + ComfyUI)', () => {
  test('GET /api/health/connection is public (no token required)', async () => {
    const { status, body } = await json('/health/connection');
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(typeof body.data.allConnected, 'boolean');
    assert.equal(typeof body.data.llm, 'object');
    assert.equal(typeof body.data.comfyui, 'object');
  });

  test('GET /api/health/connection probes both services and reports state (200 even when a service is down)', async () => {
    const { status, body } = await json('/health/connection', { headers: bearer(admin.token) });
    assert.equal(status, 200);
    assert.equal(body.success, true);

    const { llm, comfyui, allConnected, checkedAt } = body.data;

    // LLM (Omniroute) section.
    assert.equal(llm.service, 'omniroute');
    assert.equal(llm.label, 'LLM');
    assert.equal(typeof llm.endpoint, 'string');
    assert.ok(llm.endpoint.length > 0);
    assert.equal(typeof llm.connected, 'boolean');
    assert.equal(typeof llm.latency, 'number');
    assert.ok(llm.latency >= 0);
    assert.ok(['healthy', 'unhealthy'].includes(llm.status));
    if (!llm.connected) {
      // Unreachable server always carries the failure reason (e.g. ECONNREFUSED).
      assert.equal(typeof llm.error, 'string');
      assert.equal(llm.status, 'unhealthy');
    }

    // ComfyUI section.
    assert.equal(comfyui.service, 'comfyui');
    assert.equal(comfyui.label, 'ComfyUI');
    assert.equal(typeof comfyui.endpoint, 'string');
    assert.ok(comfyui.endpoint.length > 0);
    assert.equal(typeof comfyui.connected, 'boolean');
    assert.equal(typeof comfyui.latency, 'number');
    assert.ok(['healthy', 'unhealthy'].includes(comfyui.status));
    if (!comfyui.connected) {
      assert.equal(typeof comfyui.error, 'string');
      assert.equal(comfyui.status, 'unhealthy');
    }

    // Aggregate flag is consistent with the per-service results.
    assert.equal(allConnected, llm.connected && comfyui.connected);
    assert.equal(typeof checkedAt, 'string');
  });
});





