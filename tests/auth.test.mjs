import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import { renewedCookies, sessionHealth, sessionHeaders, saveResponseCookies, loadSession, logout } from '../dist/auth.js';
import { writePrivateJson } from '../dist/storage.js';
import { BrightspaceClient } from '../dist/client.js';
import { config, response } from './helpers.mjs';
const origin = 'https://school.example.edu';
const url = new URL('/d2l/api/versions/', origin);
const cookie = { name: 'session', value: 'SYNTHETIC_OLD', domain: url.hostname, path: '/', expires: -1, secure: true };
const session = { format: 1, origin, createdAt: '2026-01-01', accountId: '42', cookies: [cookie] };

test('health exposes expiry hints without credentials or account identity', () => {
  const health = sessionHealth({ ...session, bearerToken: 'SYNTHETIC_SECRET', bearerExpiresAt: 1000, csrfToken: 'SYNTHETIC_CSRF' }, 2000);
  assert.equal(health.bearer, 'expired');
  assert.equal(health.apiCookiesAvailable, true);
  assert.doesNotMatch(JSON.stringify(health), /SYNTHETIC|accountId|cookies|csrfToken/);
  assert.equal(sessionHealth(session).bearer, 'absent');
});
test('school cookie rotation handles deletion, domain matching and Max-Age precedence', () => {
  const updated = renewedCookies([cookie], ['session=NEW; Path=/; Secure; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT'], url, 100000);
  assert.equal(updated.length, 1);
  assert.equal(updated[0].value, 'NEW');
  assert.equal(updated[0].expires, 160);
  assert.deepEqual(renewedCookies(updated, ['session=; Path=/; Max-Age=0'], url, 100000), []);
  assert.deepEqual(renewedCookies([cookie], ['session=EVIL; Domain=evil.example; Path=/', 'bad=x\r\nInjected: secret'], url), [cookie]);
});
test('prefix constraints and default paths are respected', () => {
  assert.deepEqual(renewedCookies([], ['__Host-test=x; Domain=school.example.edu; Secure; Path=/', '__Secure-test=x; Path=/'], url), []);
  const [valid] = renewedCookies([], ['__Host-test=x; Secure; Path=/; HttpOnly; SameSite=Lax'], url);
  assert.equal(valid.httpOnly, true); assert.equal(valid.sameSite, 'Lax');
  assert.equal(renewedCookies([], ['test=x'], url)[0].path, '/d2l/api/versions');
});
test('successful GETs persist rotated cookies and the next request uses them', async () => {
  const cfg = await config();
  await writePrivateJson(join(cfg.dataDir, 'session.json'), session);
  let calls = 0;
  const client = new BrightspaceClient(cfg, { fetchImpl: async (_url, options) => {
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Cookie, ++calls === 1 ? 'session=SYNTHETIC_OLD' : 'session=SYNTHETIC_NEW');
    return response([], 200, { 'set-cookie': 'session=SYNTHETIC_NEW; Secure; Path=/; Max-Age=3600' });
  }});
  await client.json(url.href); await client.json(url.href);
  assert.equal((await loadSession(cfg)).cookies[0].value, 'SYNTHETIC_NEW');
  assert.equal((await stat(join(cfg.dataDir, 'session.json'))).mode & 0o777, 0o600);
});
test('403s do not replace successful saved credentials', async () => {
  const cfg = await config(); await writePrivateJson(join(cfg.dataDir, 'session.json'), session);
  const client = new BrightspaceClient(cfg, { fetchImpl: async () => response({}, 403, { 'set-cookie': 'session=BAD; Path=/' }) });
  await assert.rejects(() => client.json(url.href), e => e.code === 'FORBIDDEN' && e.message.includes(url.pathname));
  assert.deepEqual(await loadSession(cfg), { ...session, bearerToken: undefined, bearerExpiresAt: undefined, csrfToken: undefined });
});
test('cookie saves cannot resurrect logout or overwrite a newer sign-in', async () => {
  const cfg = await config();
  const rotated = response({}, 200, { 'set-cookie': 'session=NEW; Path=/' });
  await saveResponseCookies(cfg, url, rotated, sessionHeaders(session, url));
  assert.equal(await loadSession(cfg), null);
  const newer = { ...session, cookies: [{ ...cookie, value: 'NEWER_LOGIN' }] };
  await writePrivateJson(join(cfg.dataDir, 'session.json'), newer);
  await saveResponseCookies(cfg, url, rotated, sessionHeaders(session, url));
  assert.equal((await loadSession(cfg)).cookies[0].value, 'NEWER_LOGIN');
});
test('cross-origin and custom credential clients cannot change local sessions', async () => {
  const cfg = await config(); await writePrivateJson(join(cfg.dataDir, 'session.json'), session);
  const rotated = response({}, 200, { 'set-cookie': 'session=NEW; Path=/' });
  await saveResponseCookies(cfg, new URL('https://other.example.edu'), rotated, {});
  const client = new BrightspaceClient(cfg, {getHeaders: async () => ({}), fetchImpl: async () => rotated});
  await client.json(url.href);
  assert.equal((await loadSession(cfg)).cookies[0].value, cookie.value);
});
test('logout also removes the optional remembered browser profile', async () => {
  const cfg = await config(); await writePrivateJson(join(cfg.dataDir, 'session.json'), session);
  const profile = join(cfg.dataDir, 'login-browser'); await mkdir(profile);
  await writePrivateJson(join(profile, 'synthetic-state.json'), { synthetic: true });
  await logout(cfg);
  assert.equal(await loadSession(cfg), null);
  await assert.rejects(() => stat(profile), { code: 'ENOENT' });
});
