import test from 'node:test';
import assert from 'node:assert/strict';
import { stat, readFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { validateOrigin, buildConfig } from '../dist/config.js';
import { safeApiUrl, safeNextPage, cookiesForUrl, tenantCookies, htmlToText } from '../dist/security.js';
import { writePrivateJson, readPrivateJson } from '../dist/storage.js';
import { loadSession, sessionHeaders, tokenExpiry } from '../dist/auth.js';
import { validate, object, string, courseIdSchema } from '../dist/schema.js';
import { config } from './helpers.mjs';

const origin = 'https://school.example.edu';
const allowed = '/d2l/api/le/1.94/100/dropbox/folders/';
test('HTTPS origin accepts HHS and strips trailing slash', () => {
  assert.equal(validateOrigin('https://brightspace.hhs.nl/'), 'https://brightspace.hhs.nl');
});
for (const url of ['http://school.example.edu', 'https://user:pass@school.example.edu', 'https://school.example.edu/foo',
  'https://127.0.0.1', 'https://localhost', 'https://school.example.edu:8443', 'https://school.example.edu?token=secret']) {
  test(`origin rejects unsafe form: ${url}`, () => assert.throws(() => validateOrigin(url)));
}
test('strict config catches invalid timezones and versions', () => {
  assert.throws(() => buildConfig({ timezone: 'not/a/timezone' }, {}));
  assert.throws(() => buildConfig({ leVersion: '../users' }, {}));
  assert.throws(() => buildConfig({ includeCourseIds: '100' }, {}));
});
test('only known read routes are allowed', () => {
  assert.equal(safeApiUrl(origin, allowed).pathname, allowed);
  for (const path of ['/d2l/api/le/1.94/100/quizzes/1/attempts/', '/d2l/api/le/1.94/100/classlist/', '/etc/passwd',
    'https://evil.example.org' + allowed, '//evil.example.org' + allowed, allowed + '?ignoreDateRestrictions=true',
    '/d2l/api/le/1.94/100/content/%2e%2e/topics/1', '/d2l/api/le/1.94/100/../101/content/toc', allowed + '#secret'])
    assert.throws(() => safeApiUrl(origin, path));
});
test('pagination cannot change origin, route or original filters', () => {
  const u = new URL(allowed + '?startDateTime=2026-11-01T00:00:00Z', origin);
  assert.equal(safeNextPage(origin, u, u.href + '&bookmark=10').searchParams.get('bookmark'), '10');
  assert.throws(() => safeNextPage(origin, u, 'https://evil.example.org' + u.pathname));
  assert.throws(() => safeNextPage(origin, u, '/d2l/api/le/1.94/101/dropbox/folders/'));
  assert.throws(() => safeNextPage(origin, u, allowed + '?bookmark=10'));
});
test('pagination accepts opaque bookmarks and rejects new filters, duplicate keys and raw traversal', () => {
  const u = new URL(allowed + '?isActive=true', origin);
  assert.equal(safeNextPage(origin, u, '?isActive=true&bookmark=a%2Fb%2Ec').searchParams.get('bookmark'), 'a/b.c');
  for (const next of ['?isActive=true&canAccess=false', '?isActive=true&isActive=false',
    u.pathname + 'extra/%2e%2e/?isActive=true']) {
    assert.throws(() => safeNextPage(origin, u, next), e => e.code === 'UNSAFE_URL');
  }
});
const cookie = { name: 'd2lSessionVal', value: 'SENSITIVE', domain: 'school.example.edu', path: '/d2l', expires: -1, secure: true };
test('cookies respect host, path boundary, expiry and Secure', () => {
  assert.equal(cookiesForUrl([cookie], new URL(origin + '/d2l/api/versions/')), 'd2lSessionVal=SENSITIVE');
  for (const url of ['https://evil.example.edu/d2l/api', 'https://school.example.edu/d2l-malicious', 'http://school.example.edu/d2l/api'])
    assert.equal(cookiesForUrl([cookie], new URL(url)), '');
  assert.equal(cookiesForUrl([{ ...cookie, expires: 1 }], new URL(origin + '/d2l/api')), '');
  assert.equal(cookiesForUrl([{ ...cookie, value: 'x\r\nInjected: yes' }], new URL(origin + '/d2l/api')), '');
});
test('identity-provider cookies are never stored with tenant cookies', () => {
  const filtered = tenantCookies([cookie, { ...cookie, domain: '.login.microsoftonline.com' }, { ...cookie, domain: '.evil.edu' }], origin);
  assert.deepEqual(filtered, [cookie]);
});
test('session headers reject another origin and never send expired bearer tokens', () => {
  const session = { format: 1, origin, createdAt: '2026-11-01', accountId: '42', cookies: [cookie], bearerToken: 'expired', bearerExpiresAt: 1 };
  const headers = sessionHeaders(session, new URL(origin + '/d2l/api/versions/'));
  assert.equal(headers.Cookie, 'd2lSessionVal=SENSITIVE'); assert.equal(headers.Authorization, undefined);
  assert.throws(() => sessionHeaders(session, new URL('https://evil.example.org')));
});
test('private files are atomic JSON with owner-only permissions', async () => {
  const cfg = await config(); const path = join(cfg.dataDir, 'private', 'state.json');
  await writePrivateJson(path, { hello: 'world' });
  assert.deepEqual(await readPrivateJson(path), { hello: 'world' });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(join(cfg.dataDir, 'private'))).mode & 0o777, 0o700);
});
test('unsafe session-file permissions fail closed', async () => {
  if (process.platform === 'win32') return;
  const cfg = await config(); const path = join(cfg.dataDir, 'session.json');
  await writePrivateJson(path, { hello: 1 }); await chmod(path, 0o644);
  await assert.rejects(() => readPrivateJson(path), /unsafe permissions/);
});
test('session origin mismatch is rejected', async () => {
  const cfg = await config();
  await writePrivateJson(join(cfg.dataDir, 'session.json'), { format: 1, origin: 'https://other.example.edu', accountId: '42', cookies: [] });
  await assert.rejects(() => loadSession(cfg), /another school/);
});
test('JWT expiry parser is only a hint and tolerates non-JWT tokens', () => {
  assert.equal(tokenExpiry('opaque'), undefined);
  assert.equal(tokenExpiry('x.' + Buffer.from('{"exp":123}').toString('base64url') + '.x'), 123000);
});
test('HTML extraction drops scripts and decodes entities', () => {
  const out = htmlToText('<h1>A &amp; B</h1><script>secret()</script><p>2 &lt; 3 &#x3c0;</p>');
  assert.match(out, /A & B/); assert.match(out, /2 < 3 π/); assert.doesNotMatch(out, /secret/);
});
test('schema validation rejects extra properties and path-like IDs', () => {
  const schema = object({ courseId: courseIdSchema, query: string('Query') }, ['courseId']);
  assert.doesNotThrow(() => validate(schema, { courseId: '100' }));
  assert.throws(() => validate(schema, { courseId: '../../100' }));
  assert.throws(() => validate(schema, { courseId: '100', token: 'secret' }));
  assert.throws(() => validate(schema, { courseId: 100 }));
  assert.throws(() => validate(schema, JSON.parse('{"courseId":"100","__proto__":{}}')));
});
