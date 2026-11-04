import test from 'node:test';
import assert from 'node:assert/strict';
import { D2lOAuth, D2L_SCOPES, HHS_ORIGIN } from '../dist/web/brightspace-oauth.js';

const registration = {
  clientId: 'fixture-client', clientSecret: 'fixture-secret',
  redirectUri: 'https://study.example.org/oauth/callback'
};
const tokens = { token_type: 'Bearer', access_token: 'sample.access.token', refresh_token: 'sample-refresh', expires_in: 3600 };
const tokenUrl = 'https://auth.brightspace.com/core/connect/token';
const failNetwork = () => assert.fail('Unexpected network fetch');

test('D2L consent uses the registered HTTPS app, state, and exact read scopes', () => {
  const oauth = new D2lOAuth(registration, failNetwork);
  const url = new URL(oauth.authorizationUrl('fixture-state'));
  assert.equal(url.origin + url.pathname, 'https://auth.brightspace.com/oauth2/auth');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    response_type: 'code', client_id: registration.clientId, redirect_uri: registration.redirectUri,
    scope: D2L_SCOPES, state: 'fixture-state'
  });
  assert.ok(D2L_SCOPES.split(' ').every(scope => /^[a-z_]+:[a-z_]+:(read|readonly)$/.test(scope)));
  assert.throws(() => oauth.authorizationUrl(''), { code: 'D2L_OAUTH' });
  for (const redirectUri of ['http://study.example.org/oauth/callback', 'https://user@host.example.org/auth', registration.redirectUri + '?next=other']) {
    assert.throws(() => new D2lOAuth({ ...registration, redirectUri }, failNetwork), { code: 'CONFIG' });
  }
});

test('D2L token exchange and single-use refresh POST only to its fixed token endpoint', async () => {
  const calls = [];
  const oauth = new D2lOAuth(registration, async (url, options) => {
    calls.push({ url, options });
    return Response.json(calls.length === 1 ? tokens : { ...tokens, refresh_token: 'replacement' });
  });
  const before = Date.now();
  const result = await oauth.exchangeCode('fixture-code');
  assert.equal(result.accessToken, tokens.access_token);
  assert.ok(result.expiresAt >= before + 3600000 && result.expiresAt <= Date.now() + 3600000);
  assert.equal((await oauth.refresh(result.refreshToken)).refreshToken, 'replacement');
  assert.equal(calls.length, 2);
  for (const { url, options } of calls) {
    assert.equal(url, tokenUrl);
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, 'Basic ' + Buffer.from('fixture-client:fixture-secret').toString('base64'));
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.deepEqual(Object.fromEntries(calls[0].options.body), {
    grant_type: 'authorization_code', redirect_uri: registration.redirectUri, code: 'fixture-code'
  });
  assert.deepEqual(Object.fromEntries(calls[1].options.body), { grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
});

test('D2L grant errors, redirected responses, and malformed tokens are withheld and never retried', async () => {
  for (const makeResponse of [
    () => new Response('private-response-detail', { status: 401 }),
    () => Response.redirect('https://elsewhere.example/private-response-detail'),
    () => new Response('private-response-detail'),
    () => new Response('x'.repeat(65537)),
    () => Response.json({ ...tokens, access_token: 'bad\r\nprivate-response-detail' }),
    () => Response.json({ ...tokens, refresh_token: 72 }),
    () => Response.json({ ...tokens, token_type: 'mac' }),
    () => Response.json({ ...tokens, expires_in: -1 }),
    () => Response.json({ ...tokens, scope: 'core:*:*' }),
    () => { throw new Error('private-response-detail'); }
  ]) {
    let calls = 0;
    const oauth = new D2lOAuth(registration, async () => { calls++; return makeResponse(); });
    await assert.rejects(oauth.refresh('private-grant'), error => {
      assert.equal(error.code, 'D2L_OAUTH');
      assert.doesNotMatch(String(error), /private|fixture-secret/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('HHS whoami uses each caller’s bearer on the fixed GET allowlist and returns only their ID', async () => {
  const seen = [];
  const oauth = new D2lOAuth(registration, async (url, options) => {
    assert.equal(url.origin, HHS_ORIGIN);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    const credential = options.headers.Authorization;
    seen.push([credential, url.pathname]);
    if (url.pathname === '/d2l/api/versions/') return Response.json([
      { ProductCode: 'lp', LatestVersion: '1.50' }, { ProductCode: 'le', LatestVersion: '1.80' }
    ]);
    assert.equal(url.pathname, '/d2l/api/lp/1.50/users/whoami');
    if (credential === 'Bearer missing') return Response.json({ FirstName: 'Private' });
    return Response.json({ Identifier: credential === 'Bearer student-one' ? 100 : 200, FirstName: 'Private' });
  });
  assert.deepEqual(await Promise.all(['student-one', 'student-two'].map(token => oauth.verifyAccount(token))), ['100', '200']);
  assert.equal(seen.length, 4);
  for (const user of ['student-one', 'student-two']) {
    assert.deepEqual(seen.filter(([credential]) => credential === 'Bearer ' + user).map(([, path]) => path),
      ['/d2l/api/versions/', '/d2l/api/lp/1.50/users/whoami']);
  }
  await assert.rejects(oauth.verifyAccount('missing'), { code: 'API_SHAPE' });
  await assert.rejects(oauth.verifyAccount('bad\nheader'), { code: 'D2L_OAUTH' });
  assert.equal(seen.length, 6);
});
