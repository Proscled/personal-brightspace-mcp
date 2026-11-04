import test from 'node:test';
import assert from 'node:assert/strict';
import { BrightspaceClient, retryDelay } from '../dist/client.js';
import { config, mockClient, response } from './helpers.mjs';
const route = '/d2l/api/lp/1.49/enrollments/myenrollments/';

test('all school requests use GET and manual redirect handling', async () => {
  const { client, calls } = mockClient(await config(), () => response([]));
  await client.json(route);
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.redirect, 'manual');
});
test('bookmark pagination keeps filters and combines pages', async () => {
  const cfg = await config();
  const { client, calls } = mockClient(cfg, url => url.searchParams.has('bookmark')
    ? response({ Items: [{ Id: 2 }], PagingInfo: { HasMoreItems: false } })
    : response({ Items: [{ Id: 1 }], PagingInfo: { HasMoreItems: true, Bookmark: '1' } }));
  const result = await client.collection(route + '?orgUnitTypeId=3');
  assert.equal(result.items.length, 2); assert.equal(result.complete, true);
  assert.equal(new URL(calls[1].url).searchParams.get('orgUnitTypeId'), '3');
});
test('Objects/Next pagination is supported', async () => {
  const { client } = mockClient(await config(), url => url.searchParams.has('bookmark')
    ? response({ Objects: [{ Id: 2 }], Next: null })
    : response({ Objects: [{ Id: 1 }], Next: route + '?bookmark=2' }));
  const result = await client.collection(route);
  assert.deepEqual(result.items, [{ Id: 1 }, { Id: 2 }]);
});
test('pagination loops return explicit incomplete coverage', async () => {
  const { client } = mockClient(await config(), () => response({ Items: [1], PagingInfo: { HasMoreItems: true, Bookmark: 'same' } }));
  const result = await client.collection(route);
  assert.equal(result.complete, false); assert.match(result.warnings.join(' '), /repeated cursor/);
});
test('missing bookmarks do not imply complete results', async () => {
  const { client } = mockClient(await config(), () => response({ Items: [], PagingInfo: { HasMoreItems: true } }));
  assert.equal((await client.collection(route)).complete, false);
});
test('page cap is reported', async () => {
  const { client } = mockClient(await config({ maxPages: 1 }), () => response({ Objects: [1], Next: route + '?bookmark=2' }));
  assert.equal((await client.collection(route)).complete, false);
});
test('malicious pagination link is blocked before credentials can leave', async () => {
  const { client, calls } = mockClient(await config(), () => response({ Objects: [1], Next: 'https://evil.example.net' + route }));
  await assert.rejects(() => client.collection(route), /approved Brightspace/);
  assert.equal(calls.length, 1);
});
for (const code of [401, 403, 404]) test(`HTTP ${code} is not treated as empty`, async () => {
  const { client } = mockClient(await config(), () => response({ error: 'SECRET_COOKIE' }, code));
  await assert.rejects(() => client.collection(route), e => e.status === code && !e.message.includes('SECRET_COOKIE'));
});
test('HTML login pages become an authentication error', async () => {
  const { client } = mockClient(await config(), () => response('<html>Login</html>', 200, { 'content-type': 'text/html' }));
  await assert.rejects(() => client.json(route), e => e.code === 'AUTH_REQUIRED');
});
test('redirects are blocked, not followed', async () => {
  const { client, calls } = mockClient(await config(), () => new Response(null, { status: 302, headers: { location: 'https://idp.example.org/login' } }));
  await assert.rejects(() => client.json(route), e => e.code === 'REDIRECT_BLOCKED');
  assert.equal(calls.length, 1);
});
test('unexpected collection formats fail visibly', async () => {
  const { client } = mockClient(await config(), () => response({ UnknownItems: [] }));
  await assert.rejects(() => client.collection(route), e => e.code === 'API_SHAPE');
});
test('response byte limit applies without content-length', async () => {
  const { client } = mockClient(await config({ maxResponseBytes: 1024 }), () => response({ data: 'x'.repeat(2048) }));
  await assert.rejects(() => client.json(route), e => e.code === 'TOO_LARGE');
});
test('bounded retries honor Retry-After and never retry auth errors', async () => {
  const waits = []; let calls = 0;
  const cfg = await config({ retries: 2 });
  const client = new BrightspaceClient(cfg, { getHeaders: async () => ({}), sleepImpl: async ms => { waits.push(ms); },
    fetchImpl: async () => ++calls === 1 ? response({}, 429, { 'retry-after': '2' }) : response([]) });
  assert.deepEqual(await client.json(route), []); assert.equal(calls, 2); assert.ok(waits.includes(2000));
  assert.equal(retryDelay('Wed, 01 Jan 2025 00:00:02 GMT', 0, Date.parse('2025-01-01T00:00:00Z')), 2000);
});
test('version discovery compares components numerically', async () => {
  const cfg = await config({ lpVersion: undefined, leVersion: undefined });
  const { client } = mockClient(cfg, () => response([
    { ProductCode: 'LP', SupportedVersions: ['1.9', '1.49'] }, { ProductCode: 'LE', LatestVersion: '1.94' }
  ]));
  assert.deepEqual(await client.discoverVersions(), { lp: '1.49', le: '1.94' });
});
test('network errors are sanitized and not credential dumps', async () => {
  const { client } = mockClient(await config(), () => { throw new Error('Cookie: TOP_SECRET'); });
  await assert.rejects(() => client.json(route), e => e.code === 'NETWORK' && !e.message.includes('TOP_SECRET'));
});

test('file cap is separate and honors an existing explicit tighter response limit', async () => {
  const route = '/d2l/api/le/1.94/100/content/topics/52/file';
  const make = async limits => mockClient(await config(limits), () => response('x'.repeat(1500))).client;
  assert.equal((await (await make({maxResponseBytes:1024,maxFileBytes:2048})).raw(route)).bytes.length,1500);
  await assert.rejects(() => make({maxResponseBytes:1024}).then(c => c.raw(route)), e => e.code === 'TOO_LARGE');
  await assert.rejects(() => make({maxResponseBytes:1024,maxFileBytes:2048}).then(c => c.json(route)), e => e.code === 'TOO_LARGE');
});
