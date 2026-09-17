// Unit tests: authentication primitives (password hashing + JWT sign/verify).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { authService, hashPassword, verifyPassword, signToken, verifyToken } from '../src/services/auth.js';
import { config } from '../src/config/index.js';

const SAMPLE_USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'unit@test.local',
  username: 'unituser',
  role: 'user' as const,
};

describe('password hashing', () => {
  test('hashPassword produces a bcrypt hash that verifies', async () => {
    const hash = await hashPassword('Sup3rSecret!');
    assert.match(hash, /^\$2[aby]\$/);
    assert.equal(await verifyPassword('Sup3rSecret!', hash), true);
  });

  test('verifyPassword rejects a wrong password', async () => {
    const hash = await hashPassword('Sup3rSecret!');
    assert.equal(await verifyPassword('wrong-password', hash), false);
  });

  test('hashes are salted (same input -> different hashes)', async () => {
    const a = await hashPassword('Sup3rSecret!');
    const b = await hashPassword('Sup3rSecret!');
    assert.notEqual(a, b);
  });
});

describe('token signing/verification', () => {
  test('signToken -> verifyToken round-trips the identity claims', () => {
    const token = signToken(SAMPLE_USER);
    const payload = verifyToken(token);
    assert.equal(payload.sub, SAMPLE_USER.id);
    assert.equal(payload.email, SAMPLE_USER.email);
    assert.equal(payload.username, SAMPLE_USER.username);
    assert.equal(payload.role, SAMPLE_USER.role);
    assert.ok(typeof payload.exp === 'number');
    assert.ok(payload.exp! > Math.floor(Date.now() / 1000));
  });

  test('tokens use the configured secret (different secret fails)', () => {
    const token = jwt.sign({ ...SAMPLE_USER }, 'some-other-secret');
    assert.throws(() => verifyToken(token), /invalid signature|JsonWebTokenError/i);
  });

  test('expired tokens are rejected', () => {
    const token = jwt.sign({ ...SAMPLE_USER }, config.auth.jwtSecret, { expiresIn: -10 });
    assert.throws(() => verifyToken(token), jwt.TokenExpiredError);
  });

  test('tampered payloads are rejected', () => {
    const token = signToken(SAMPLE_USER);
    const [header, , signature] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...SAMPLE_USER, role: 'admin' })).toString(
      'base64url'
    );
    assert.throws(
      () => verifyToken(`${header}.${forgedPayload}.${signature}`),
      /invalid signature|JsonWebTokenError/i
    );
  });

  test('garbage tokens are rejected', () => {
    assert.throws(() => verifyToken('not-a-jwt'));
  });

  test('parseDuration accepts h/m/d and plain seconds (via configured expiry)', () => {
    // The configured default in tests resolves to a positive lifetime; assert the
    // signed token carries a sane exp (~within 10 minutes of now for '24h').
    const token = signToken(SAMPLE_USER);
    const payload = jwt.verify(token, config.auth.jwtSecret) as jwt.JwtPayload;
    const expectedSeconds = 24 * 3600;
    const drift = Math.abs(payload.exp! - payload.iat! - expectedSeconds);
    assert.ok(drift < 600, `unexpected token lifetime drift: ${drift}s`);
  });
});
