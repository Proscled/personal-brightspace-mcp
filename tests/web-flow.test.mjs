import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { request } from 'node:http';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebServer } from '../dist/web/server.js';

const origin = 'https://study.example.org';
const resource = origin + '/mcp';
const clientId = 'fixture-chatgpt-client';
const clientSecret = 'fixture-chatgpt-secret';
const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
const basic = 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64');
const random = () => randomBytes(32).toString('base64url');
const challenge = verifier => createHash('sha256').update(verifier).digest('base64url');

async function fixture(t, { sharedCourse = false, schoolTokenRevoked = false } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'brightspace-broker-fixture-'));
  const redeemed = [], verified = [], calls = [];
  const news = { '101': 'Practice session 101', '202': 'Lab instructions 202' };
  const upstream = {
    authorizationUrl(state) {
      return 'https://auth.brightspace.com/oauth2/auth?' + new URLSearchParams({ state });
    },
    async exchangeCode(code) {
      assert.match(code, /^school-code-(101|202)$/);
      redeemed.push(code);
      const id = code.slice(-3);
      return { accessToken: 'school-access-' + id, refreshToken: 'school-refresh-' + id, expiresAt: Date.now() + 3600_000 };
    },
    async verifyAccount(token) {
      assert.match(token, /^school-access-(101|202)$/);
      verified.push(token);
      return token.slice(-3);
    },
    async refresh(token) {
      assert.match(token, /^school-refresh-(101|202)$/);
      const id = token.slice(-3);
      return { accessToken: 'school-access-' + id, refreshToken: 'replacement-' + id, expiresAt: Date.now() + 3600_000 };
    }
  };
  const schoolFetch = async (url, options) => {
    assert.equal(url.origin, 'https://brightspace.hhs.nl');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    const auth = options.headers.Authorization;
    assert.match(auth, /^Bearer school-access-(101|202)$/);
    calls.push({ auth, path: url.pathname });
    if (schoolTokenRevoked) return new Response(null, { status: 401 });
    if (url.pathname === '/d2l/api/versions/') {
      return Response.json([{ ProductCode: 'lp', LatestVersion: '1.50' }, { ProductCode: 'le', LatestVersion: '1.80' }]);
    }
    const id = auth.slice(-3);
    if (url.pathname === '/d2l/api/lp/1.50/users/whoami') return Response.json({ Identifier: id });
    if (url.pathname === '/d2l/api/lp/1.50/enrollments/myenrollments/') {
      const ids = sharedCourse ? [id, '700'] : [id];
      return Response.json({ Items: ids.map(course => ({
        OrgUnit: { Id: Number(course), Name: 'Course ' + course }, Access: { CanAccess: true }
      })), PagingInfo: { HasMoreItems: false } });
    }
    const [, course, route] = url.pathname.match(/^\/d2l\/api\/le\/1\.80\/(\d+)\/(.+)$/) ?? [];
    if (course !== id && !(sharedCourse && course === '700')) return new Response('restricted fixture data', { status: 403 });
    if (route === 'news/') return Response.json([{ Id: 15, Title: news[id], IsPublished: true }]);
    if (route === 'dropbox/folders/' || route === 'quizzes/') return Response.json([]);
    if (route === 'content/toc') return Response.json({ Modules: [] });
    assert.fail('Unexpected school route');
  };
  const server = createWebServer({ origin, clientId, clientSecret, redirectUri, dataDir }, upstream, schoolFetch);
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  function send(path, { method = 'GET', headers, body } = {}) {
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method, headers: { host: new URL(origin).host, ...headers } }, res => {
        const chunks = [];
        res.on('error', reject);
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', reject);
      req.end(body);
    });
  }
  const form = (path, fields, headers = {}) => send(path, { method: 'POST', headers: {
    'content-type': 'application/x-www-form-urlencoded', ...headers
  }, body: new URLSearchParams(fields).toString() });
  const token = (fields, authorization = basic) => form('/oauth/token', fields, { authorization });
  async function start(overrides = {}) {
    const verifier = random(), state = random();
    const response = await send('/oauth/authorize?' + new URLSearchParams({
      response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state, scope: 'brightspace.read',
      resource, code_challenge_method: 'S256', code_challenge: challenge(verifier), ...overrides
    }));
    return { response, verifier, state };
  }
  async function begin() {
    const { response, verifier, state } = await start();
    assert.ok([302, 303].includes(response.status), response.body);
    const target = new URL(response.headers.location);
    assert.equal(target.origin, 'https://auth.brightspace.com');
    const upstreamState = target.searchParams.get('state');
    assert.ok(upstreamState && upstreamState !== state);
    const setCookie = response.headers['set-cookie'].find(value => value.startsWith('__Host-brightspace_flow='));
    assert.match(setCookie, /;\s*Secure\b/i);
    assert.match(setCookie, /;\s*HttpOnly\b/i);
    return { verifier, state, upstreamState, cookie: setCookie.split(';')[0] };
  }
  function callback(flow, id, cookie = flow.cookie, state = flow.upstreamState) {
    return send('/oauth/brightspace/callback?' + new URLSearchParams({ state, code: 'school-code-' + id }), { headers: { cookie } });
  }
  async function consentPage(flow, id) {
    const response = await callback(flow, id);
    assert.equal(response.status, 200, response.body);
    assert.equal(response.headers['referrer-policy'], 'strict-origin', 'Chrome must send the consent POST Origin');
    const match = response.body.match(/name="proof"\s+value="([^"]+)"/);
    assert.ok(match, 'Consent page contains the anti-forgery proof');
    assert.doesNotMatch(response.body, /school-access|school-refresh|school-code/);
    return match[1];
  }
  const consent = (flow, proof, decision = 'allow', requestOrigin = origin) =>
    form('/oauth/consent', { proof, decision }, { cookie: flow.cookie, origin: requestOrigin });
  async function getGrant(id) {
    const flow = await begin();
    const proof = await consentPage(flow, id);
    const response = await consent(flow, proof);
    assert.ok([302, 303].includes(response.status), response.body);
    const url = new URL(response.headers.location);
    assert.equal(url.origin + url.pathname, redirectUri);
    assert.equal(url.searchParams.get('state'), flow.state);
    assert.doesNotMatch(url.href, /school-access|school-refresh|school-code/);
    const code = url.searchParams.get('code');
    assert.ok(code);
    return { grant_type: 'authorization_code', code, code_verifier: flow.verifier, redirect_uri: redirectUri, resource };
  }
  function rpc(accessToken, method, params) {
    return send('/mcp', { method: 'POST', headers: {
      accept: 'application/json, text/event-stream', 'content-type': 'application/json', 'mcp-protocol-version': '2025-11-25',
      ...(accessToken && { authorization: 'Bearer ' + accessToken })
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  }
  const tool = (accessToken, name, args = {}) => rpc(accessToken, 'tools/call', { name, arguments: args });
  const courses = accessToken => tool(accessToken, 'brightspace_list_courses');
  return { send, form, token, start, begin, callback, consentPage, consent, getGrant, rpc, tool, courses, calls, redeemed, verified, news, dataDir };
}

test('browser broker publishes discovery and challenges unsigned MCP requests', async t => {
  const f = await fixture(t);
  const denied = await f.courses();
  assert.equal(denied.status, 401);
  assert.match(denied.headers['www-authenticate'], /resource_metadata=/);
  const info = new URL(denied.headers['www-authenticate'].match(/resource_metadata="([^"]+)"/)[1]);
  assert.equal(info.origin, origin);
  const protectedMetadata = JSON.parse((await f.send(info.pathname)).body);
  assert.equal(protectedMetadata.resource, resource);
  assert.deepEqual(protectedMetadata.authorization_servers, [origin]);
  const issuer = JSON.parse((await f.send('/.well-known/oauth-authorization-server')).body);
  assert.equal(issuer.issuer, origin);
  assert.equal(issuer.token_endpoint, origin + '/oauth/token');
  assert.ok(issuer.code_challenge_methods_supported.includes('S256'));
  assert.equal(f.calls.length, 0);
});

test('two school accounts consent separately and see only their own courses', async t => {
  const f = await fixture(t);
  const sessions = await Promise.all(['101', '202'].map(async id => {
    const grant = await f.getGrant(id);
    const result = await f.token(grant);
    assert.equal(result.status, 200, result.body);
    assert.doesNotMatch(result.body, /school-access|school-refresh/);
    const broker = JSON.parse(result.body);
    assert.ok(broker.access_token && broker.refresh_token);
    return broker;
  }));
  assert.notEqual(sessions[0].access_token, sessions[1].access_token);
  const results = await Promise.all(sessions.map(s => f.courses(s.access_token)));
  const names = results.map(r => {
    assert.equal(r.status, 200, r.body);
    return JSON.parse(r.body).result.structuredContent.data.items.map(item => item.name);
  });
  assert.deepEqual(names, [['Course 101'], ['Course 202']]);
  assert.deepEqual([...new Set(f.verified)].sort(), ['school-access-101', 'school-access-202']);
  assert.equal((await f.courses('school-access-101')).status, 401);
});

test('browser binding, OAuth state and explicit consent are required', async t => {
  const f = await fixture(t);
  const flow = await f.begin();
  const other = await f.begin();
  assert.ok((await f.callback(flow, '101', other.cookie)).status >= 400);
  assert.ok((await f.callback(flow, '101', flow.cookie, random())).status >= 400);
  assert.equal(f.redeemed.length, 0);
  const active = await f.begin();
  const proof = await f.consentPage(active, '101');
  assert.ok((await f.callback(active, '101')).status >= 400);
  assert.ok((await f.consent(active, proof, 'allow', 'https://untrusted.example')).status >= 400);
  assert.ok((await f.consent(other, proof)).status >= 400);
  assert.ok((await f.consent(active, random())).status >= 400);
  const fresh = await f.begin();
  const denialProof = await f.consentPage(fresh, '202');
  const denied = await f.consent(fresh, denialProof, 'deny');
  const url = new URL(denied.headers.location);
  assert.equal(url.origin + url.pathname, redirectUri);
  assert.equal(url.searchParams.get('error'), 'access_denied');
  assert.equal(url.searchParams.get('state'), fresh.state);
  assert.equal(url.searchParams.has('code'), false);
  assert.ok((await f.consent(fresh, denialProof)).status >= 400);
});

test('broker rejects unregistered callbacks, wrong resources, PKCE failures and rogue clients', async t => {
  const f = await fixture(t);
  for (const change of [{ redirect_uri: 'https://bad.example/callback' }, { resource: 'https://bad.example/mcp' },
    { code_challenge_method: 'plain' }, { response_type: 'token' }]) {
    const { response } = await f.start(change);
    // Some OAuth errors may redirect to the registered callback, but none may go to D2L or an arbitrary destination.
    if (response.headers.location) {
      const redirect = new URL(response.headers.location);
      assert.equal(redirect.origin + redirect.pathname, redirectUri);
      assert.ok(redirect.searchParams.get('error'));
    } else assert.ok(response.status >= 400, response.body);
  }
  const grant = await f.getGrant('101');
  assert.ok((await f.token(grant, 'Basic invalid')).status >= 400);
  assert.ok((await f.token({ ...grant, code_verifier: random() })).status >= 400);
  const other = await f.getGrant('202');
  assert.ok((await f.token({ ...other, resource: 'https://wrong.example/mcp' })).status >= 400);
  const replay = await f.getGrant('101');
  const redeemed = await f.token(replay);
  assert.equal(redeemed.status, 200, redeemed.body);
  assert.equal((await f.token(replay)).status, 400);
  assert.equal((await f.courses(JSON.parse(redeemed.body).access_token)).status, 401);
  assert.equal(f.calls.length, 0);
});

test('broker refresh tokens rotate and revoked credentials cannot retrieve school data', async t => {
  const f = await fixture(t);
  const first = JSON.parse((await f.token(await f.getGrant('101'))).body);
  assert.ok(first.refresh_token);
  const fields = { grant_type: 'refresh_token', refresh_token: first.refresh_token, resource };
  const refreshed = await f.token(fields);
  assert.equal(refreshed.status, 200, refreshed.body);
  const next = JSON.parse(refreshed.body);
  assert.ok(next.access_token && next.refresh_token);
  assert.notEqual(next.refresh_token, first.refresh_token);
  const revoke = await f.form('/oauth/revoke', { token: next.refresh_token, token_type_hint: 'refresh_token' }, { authorization: basic });
  assert.equal(revoke.status, 200);
  assert.equal((await f.courses(next.access_token)).status, 401);
  assert.ok((await f.token(fields)).status >= 400);
  assert.ok((await f.token({ ...fields, refresh_token: next.refresh_token })).status >= 400);
  assert.equal(f.calls.length, 0);
});

test('web refuses desktop-only note tools and applies school 403 to the requesting account', async t => {
  const f = await fixture(t);
  const session = JSON.parse((await f.token(await f.getGrant('101'))).body).access_token;
  const listing = JSON.parse((await f.rpc(session, 'tools/list', {})).body).result.tools;
  for (const name of ['brightspace_list_notes', 'brightspace_search_notes', 'brightspace_read_note']) {
    assert.equal(listing.some(tool => tool.name === name), false);
    const result = JSON.parse((await f.tool(session, name)).body);
    assert.equal(result.error.code, -32602);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(listing.find(tool => tool.name === 'brightspace_check_updates').annotations.readOnlyHint, false);
  const response = await f.tool(session, 'brightspace_get_announcements', { courseId: '202' });
  assert.doesNotMatch(response.body, /restricted fixture data|Lab instructions/);
  const result = JSON.parse(response.body).result;
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, 'FORBIDDEN');
  assert.ok(f.calls.every(call => call.auth === 'Bearer school-access-101'));
});

test('shared course changes are compared only to the signed-in student’s private baseline', async t => {
  const f = await fixture(t, { sharedCourse: true });
  const ids = ['101', '202'];
  const sessions = await Promise.all(ids.map(async id => JSON.parse((await f.token(await f.getGrant(id))).body).access_token));
  async function checkBoth() {
    return Promise.all(sessions.map(async session => {
      const response = await f.tool(session, 'brightspace_check_updates', { courseIds: ['700'] });
      const result = JSON.parse(response.body).result;
      assert.equal(result.structuredContent.data.complete, true, response.body);
      return result.structuredContent.data.results;
    }));
  }
  for (const rows of await checkBoth()) {
    assert.equal(rows.length, 4);
    assert.ok(rows.every(row => row.status === 'baseline_created'));
  }
  f.news['101'] = 'New practice date for 101';
  const [updated, unchanged] = await checkBoth();
  assert.deepEqual(updated.find(row => row.kind === 'announcements').changes.map(change => change.title), [f.news['101']]);
  assert.ok(unchanged.every(row => row.status === 'compared' && row.totalChanges === 0));
  const dirs = await readdir(join(f.dataDir, 'accounts'));
  assert.equal(dirs.length, 2);
  const subjects = [];
  for (const dir of dirs) {
    const snapshots = join(f.dataDir, 'accounts', dir, 'snapshots');
    const files = await readdir(snapshots);
    const accounts = new Set();
    assert.equal(files.length, 4);
    for (const file of files) {
      const path = join(snapshots, file);
      const saved = await readFile(path, 'utf8');
      assert.doesNotMatch(saved, /school-access|school-refresh/);
      if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o077, 0);
      const baseline = JSON.parse(saved);
      accounts.add(baseline.accountId);
      assert.equal(baseline.courseId, '700');
      if (baseline.kind === 'announcements') assert.deepEqual(baseline.items.map(item => item.title), [f.news[baseline.accountId]]);
    }
    assert.equal(accounts.size, 1);
    subjects.push(...accounts);
  }
  assert.deepEqual(subjects.sort(), ids);
});

test('web tool metadata and school token rejection let ChatGPT offer account relinking', async t => {
  const f = await fixture(t, { schoolTokenRevoked: true });
  const session = JSON.parse((await f.token(await f.getGrant('101'))).body).access_token;
  const listing = JSON.parse((await f.rpc(session, 'tools/list', {})).body).result.tools;
  assert.equal(listing.length, 15);
  for (const tool of listing) {
    assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: ['brightspace.read'] }]);
    assert.deepEqual(tool._meta.securitySchemes, tool.securitySchemes);
  }
  const result = JSON.parse((await f.courses(session)).body).result;
  assert.equal(result.isError, true);
  assert.match(result._meta['mcp/www_authenticate'][0], /error="invalid_token"/);
  assert.match(result.structuredContent.error.message, /Reconnect your HHS account/);
});
