import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Grants } from '../dist/web/grants.js';

const verifier = 'synthetic-verifier-' + 'v'.repeat(40);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const tokens = (access = 'UPSTREAM_ACCESS', refresh = 'UPSTREAM_REFRESH', lifetime = 7_200_000) => ({
  accessToken: access, refreshToken: refresh, expiresAt: Date.now() + lifetime
});
const upstream = () => ({ refresh: async () => tokens('NEXT_ACCESS', 'NEXT_REFRESH'), verifyAccount: async () => '42' });
function grant(store, account = '42', creds = tokens()) {
  return store.redeem(store.createCode(account, creds, challenge), verifier);
}

test('PKCE verifier syntax, digest and single-use code gate credential issuance', () => {
  const store = new Grants(upstream());
  const code = store.createCode('42', tokens(), challenge);
  assert.equal(store.authenticate(code), undefined);
  for (const wrong of ['short', 'a'.repeat(43), '#'.repeat(43), 'v'.repeat(129)]) {
    assert.equal(store.redeem(code, wrong), undefined);
  }
  const pair = store.redeem(code, verifier);
  assert.equal(pair.scope, 'brightspace.read');
  assert.equal(pair.token_type, 'Bearer');
  assert.ok(pair.expires_in > 3598 && pair.expires_in <= 3600);
  assert.doesNotMatch(JSON.stringify(pair), /UPSTREAM/);
  assert.equal(store.authenticate(pair.access_token).account, '42');
  assert.equal(store.authenticate(pair.access_token).tokens.refreshToken, undefined);
  assert.equal(store.redeem(code, verifier), undefined);
  assert.equal(store.authenticate(pair.access_token), undefined);
});

test('downstream tokens have independent kinds, cryptographic integrity and instance-local keys', async () => {
  const store = new Grants(upstream());
  const pair = grant(store);
  for (const bad of [pair.refresh_token, pair.refresh_token.replace(/^r/, 'a'), 'UPSTREAM_ACCESS',
    pair.access_token.slice(0, -1), pair.access_token.replace(/\.1\./, '.2.')]) {
    assert.equal(store.authenticate(bad), undefined);
  }
  assert.equal(await store.rotate(pair.access_token), undefined);
  assert.equal(new Grants(upstream()).authenticate(pair.access_token), undefined);
  store.revoke(pair.refresh_token.replace(/\.1\./, '.2.'));
  assert.ok(store.authenticate(pair.access_token));
});

test('grant rotation exchanges upstream credentials, verifies identity and honors optional refresh replacement', async () => {
  const refreshes = [], verified = [];
  const store = new Grants({
    refresh: async input => {
      refreshes.push(input);
      return { accessToken: 'RENEWED_' + refreshes.length, expiresAt: Date.now() + 600000,
        ...(refreshes.length < 3 && { refreshToken: 'ROTATED_UPSTREAM_' + refreshes.length }) };
    },
    verifyAccount: async input => { verified.push(input); return '42'; }
  });
  const first = grant(store);
  const second = await store.rotate(first.refresh_token);
  const third = await store.rotate(second.refresh_token);
  const fourth = await store.rotate(third.refresh_token);
  assert.deepEqual(refreshes, ['UPSTREAM_REFRESH', 'ROTATED_UPSTREAM_1', 'ROTATED_UPSTREAM_2']);
  assert.deepEqual(verified, ['RENEWED_1', 'RENEWED_2', 'RENEWED_3']);
  assert.equal(store.authenticate(first.access_token), undefined);
  assert.equal(store.authenticate(fourth.access_token).tokens.accessToken, 'RENEWED_3');
  assert.equal(await store.rotate(first.refresh_token), undefined);
  assert.equal(store.authenticate(fourth.access_token), undefined);
  assert.equal(fourth.refresh_token, undefined);
});

test('concurrent refresh replay invalidates an in-flight exchange', async () => {
  let resume, invocations = 0, verifications = 0;
  const store = new Grants({
    refresh: () => { invocations++; return new Promise(resolve => { resume = resolve; }); },
    verifyAccount: async () => { verifications++; return '42'; }
  });
  const pair = grant(store);
  const first = store.rotate(pair.refresh_token);
  assert.equal(store.authenticate(pair.access_token), undefined);
  assert.equal(await store.rotate(pair.refresh_token), undefined);
  resume(tokens());
  assert.equal(await first, undefined);
  assert.equal(invocations, 1);
  assert.equal(verifications, 0);
});

test('revocation during identity verification cannot resurrect a family or affect another account', async () => {
  let start, finish;
  const began = new Promise(resolve => { start = resolve; });
  const store = new Grants({
    refresh: async () => tokens(), verifyAccount: () => { start(); return new Promise(resolve => { finish = resolve; }); }
  });
  const first = grant(store), other = grant(store, '84', tokens('OTHER'));
  const rotation = store.rotate(first.refresh_token);
  await began;
  store.revoke(first.access_token);
  finish('42');
  assert.equal(await rotation, undefined);
  assert.equal(store.authenticate(other.access_token).tokens.accessToken, 'OTHER');
  store.revoke(other.refresh_token);
  assert.equal(store.authenticate(other.access_token), undefined);
});

test('wrong identity or failed upstream refresh invalidates both tokens with no upstream details', async () => {
  for (const stub of [{ ...upstream(), verifyAccount: async () => '84' },
    { ...upstream(), refresh: async () => { throw new Error('SYNTHETIC_UPSTREAM_SECRET'); } },
    { ...upstream(), verifyAccount: async () => { throw new Error('SYNTHETIC_UPSTREAM_SECRET'); } }]) {
    const store = new Grants(stub), pair = grant(store);
    assert.equal(await store.rotate(pair.refresh_token), undefined);
    assert.equal(store.authenticate(pair.access_token), undefined);
    assert.equal(await store.rotate(pair.refresh_token), undefined);
  }
});

test('code, upstream access and absolute family expirations are enforced, including on refresh', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const store = new Grants(upstream());
  const pending = store.createCode('42', tokens(), challenge);
  now += 120000;
  assert.equal(store.redeem(pending, verifier), undefined);
  const noRefresh = grant(store, '42', { accessToken: 'SHORT', expiresAt: now + 12345 });
  assert.equal(noRefresh.expires_in, 12);
  assert.equal(noRefresh.refresh_token, undefined);
  now += 12000;
  assert.equal(store.authenticate(noRefresh.access_token), undefined);
  const first = grant(store);
  now += 6 * 86400000;
  assert.equal(store.authenticate(first.access_token), undefined);
  const renewed = await store.rotate(first.refresh_token);
  assert.ok(renewed);
  now += 86400000;
  assert.equal(await store.rotate(renewed.refresh_token), undefined);
});

test('pending grants are bounded and expired space is reclaimed', t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const store = new Grants(upstream());
  for (let n = 0; n < 512; n++) store.createCode('42', tokens(), challenge);
  assert.throws(() => store.createCode('42', tokens(), challenge), /Unable to create/);
  now += 120000;
  assert.ok(grant(store));
});
