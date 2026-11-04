import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { handleMcp } from '../dist/web/transport.js';

const origin = 'https://chatgpt.example';
const headers = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' };
const ping = { jsonrpc: '2.0', id: 42, method: 'ping' };
let url, server;
const calls = [];

before(async () => {
  // The production router authenticates first. Synthetic principal labels exercise the transport boundary only.
  server = createServer((req, res) => {
    const label = req.headers['x-fixture-principal'] ?? 'student-a';
    const registry = {
      guide: 'Synthetic guide', list: () => [{ name: 'get_course' }], has: name => name === 'get_course',
      call: async () => { calls.push(label); return { content: [{ type: 'text', text: label }] }; }
    };
    void handleMcp(req, res, registry, [origin]);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  url = new URL('/mcp', 'http://127.0.0.1:' + server.address().port);
});
after(() => new Promise(resolve => server.close(resolve)));

function post(message, overrides = {}) {
  return fetch(url, { method: 'POST', headers: { ...headers, ...overrides }, body: JSON.stringify(message) });
}
function init(protocolVersion) {
  return { jsonrpc: '2.0', method: 'initialize', id: 1,
    params: { protocolVersion, clientInfo: { name: 'synthetic-client', version: '1' }, capabilities: {} } };
}

test('HTTP initialize negotiates the Streamable HTTP revisions and issues no session identifier', async () => {
  for (const [proposal, choice] of [
    ['2025-06-18', '2025-06-18'], ['2025-11-25', '2025-11-25'],
    ['2024-11-05', '2025-11-25'], ['2025-03-26', '2025-11-25'], ['2099-01-01', '2025-11-25']
  ]) {
    const response = await post(init(proposal));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('mcp-session-id'), null);
    const { result } = await response.json();
    assert.equal(result.protocolVersion, choice);
    assert.ok(result.capabilities.tools);
  }
});

test('HTTP dispatch uses only the registry of the current request', async () => {
  const message = { jsonrpc: '2.0', method: 'tools/call', id: 'one', params: { name: 'get_course' } };
  const labels = ['student-a', 'student-b', 'student-b', 'student-a'];
  await Promise.all(labels.map(async label => {
    const response = await post(message, { 'x-fixture-principal': label, 'mcp-protocol-version': '2025-11-25', origin });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.content[0].text, label);
  }));
  assert.equal(calls.length, labels.length);
  const badMethod = await post({ ...ping, method: 'submit_quiz' });
  assert.equal(badMethod.status, 200);
  assert.equal((await badMethod.json()).error.code, -32601);
});

test('HTTP notifications yield an empty 202 and cannot invoke tools', async () => {
  const before = calls.length;
  for (const message of [{ jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', method: 'tools/call', params: { name: 'get_course' } }]) {
    const response = await post(message);
    assert.equal(response.status, 202);
    assert.equal(await response.text(), '');
  }
  assert.equal(calls.length, before);
});

test('HTTP requires the two explicitly supported Accept types and JSON content', async () => {
  for (const accept of ['*/*', 'application/json', 'text/event-stream', 'application/json;q=0, text/event-stream']) {
    assert.equal((await post(ping, { accept })).status, 406);
  }
  assert.equal((await post(ping, { accept: 'TEXT/EVENT-STREAM;q=0.9, application/json; q=1.0',
    'content-type': 'application/json; charset="UTF-8"' })).status, 200);
  for (const overrides of [{ 'content-type': 'text/plain' }, { 'content-type': 'application/json; charset=utf-16' },
    { 'content-encoding': 'gzip' }]) {
    assert.equal((await post(ping, overrides)).status, 415);
  }
});

test('HTTP rejects unsafe Origins and unsupported version headers before dispatch', async () => {
  for (const invalid of ['null', 'https://chatgpt.example.attacker.test', origin + '/path', origin + ':444']) {
    const response = await post(ping, { origin: invalid });
    assert.equal(response.status, 403);
    assert.ok(!(await response.text()).includes(invalid === 'null' ? '"null"' : invalid));
    assert.equal((await fetch(url, { headers: { origin: invalid } })).status, 403);
  }
  for (const version of ['2024-11-05', 'future, 2025-11-25', '']) {
    assert.equal((await post(ping, { 'mcp-protocol-version': version })).status, 400);
  }
});

test('HTTP disallows standalone streams, deletion and unsupported verbs', async () => {
  for (const method of ['GET', 'DELETE', 'PUT']) {
    const response = await fetch(url, { method, headers: { accept: 'text/event-stream' } });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
  }
});

test('HTTP rejects batches, malformed envelopes and unsolicited responses', async () => {
  for (const message of [[ping], { ...ping, id: null }, { ...ping, params: [] }, { ...ping, result: {} },
    { jsonrpc: '2.0', id: 1, result: {} }, { jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'UNTRUSTED' } }]) {
    const response = await post(message);
    assert.equal(response.status, 400);
    const body = await response.text();
    assert.equal(JSON.parse(body).error.code, -32600);
    assert.ok(!body.includes('UNTRUSTED'));
  }
  for (const body of ['{BROKEN', Buffer.from([123, 34, 255, 34, 58, 49, 125])]) {
    const response = await fetch(url, { method: 'POST', headers, body });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, -32700);
  }
});

test('HTTP applies the 1 MiB limit to fixed-length and streaming request bodies', async () => {
  const tooLarge = Buffer.alloc(1024 * 1024 + 1, 32);
  assert.equal((await fetch(url, { method: 'POST', headers, body: tooLarge })).status, 413);
  await new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: { ...headers, 'transfer-encoding': 'chunked' } }, res => {
      res.resume();
      res.once('end', () => res.statusCode === 413 ? resolve() : reject(new Error('Expected HTTP 413')));
    });
    req.once('error', reject);
    req.write(tooLarge.subarray(0, 600000));
    req.end(tooLarge.subarray(600000));
  });
});
