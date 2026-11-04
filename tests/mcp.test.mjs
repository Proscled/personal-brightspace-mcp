import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { McpDispatcher, PROTOCOL_VERSIONS } from '../dist/mcp.js';
import { ToolRegistry } from '../dist/tools.js';
import { config, schoolFixture } from './helpers.mjs';

const init = (version = '2025-11-25') => ({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: version, clientInfo: { name: 'test-client', version: '1' }, capabilities: {} } });
const initialized = { jsonrpc: '2.0', method: 'notifications/initialized' };
async function dispatcher() {
  const cfg = await config();
  return new McpDispatcher(new ToolRegistry(schoolFixture(cfg).service));
}
async function ready() {
  const d = await dispatcher(); await d.dispatch(init()); await d.dispatch(initialized); return d;
}
test('MCP initialize negotiates a supported protocol and advertises capabilities', async () => {
  const d = await dispatcher(), r = await d.dispatch(init('future-version'));
  assert.equal(r.result.protocolVersion, PROTOCOL_VERSIONS[0]);
  assert.ok(r.result.capabilities.tools); assert.match(r.result.instructions, /untrusted DATA/);
});
test('every advertised stdio protocol revision can discover tools and make a local status call', async () => {
  for (const version of PROTOCOL_VERSIONS) {
    const d = await dispatcher();
    assert.equal((await d.dispatch(init(version))).result.protocolVersion, version);
    await d.dispatch(initialized);
    assert.equal((await d.dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools.length, 18);
    const status = await d.dispatch({ jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'brightspace_status', arguments: { verifyConnection: false } } });
    assert.equal(status.result.structuredContent.data.auth.verified, false);
  }
});
test('MCP tool calls are unavailable before handshake', async () => {
  const d = await dispatcher();
  assert.equal((await d.dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).error.code, -32002);
});
test('MCP notifications never receive responses', async () => {
  const d = await ready(); assert.equal(await d.dispatch(initialized), null);
  assert.equal(await d.dispatch({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 9 } }), null);
});
test('MCP rejects arrays, null request IDs and malformed envelopes', async () => {
  const d = await dispatcher();
  for (const value of [[], null, {}, { jsonrpc: '1.0', method: 'ping', id: 1 }, { jsonrpc: '2.0', method: 'ping', id: null }])
    assert.equal((await d.dispatch(value)).error.code, -32600);
});
test('MCP tool catalogue contains only intended capabilities with local-write annotation', async () => {
  const d = await ready(), result = await d.dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const tools = result.result.tools;
  assert.equal(tools.length, 18);
  assert.ok(tools.every(x => !/submit|delete|send|start_attempt/.test(x.name)));
  assert.equal(tools.find(x => x.name === 'brightspace_check_updates').annotations.readOnlyHint, false);
  assert.ok(tools.filter(x => x.name !== 'brightspace_check_updates').every(x => x.annotations.readOnlyHint));
});
test('MCP tools can read a real fixture through the entire school/API stack', async () => {
  const d = await ready();
  const r = await d.dispatch({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'brightspace_get_assignments', arguments: { courseId: '100' } } });
  assert.equal(r.result.structuredContent.data.items[0].title, 'Demo portfolio');
  assert.equal(r.result.structuredContent.data.items[0].submissionStatus, 'unknown');
});
test('MCP invalid arguments are structured tool errors', async () => {
  const d = await ready();
  const r = await d.dispatch({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'brightspace_get_assignments', arguments: { courseId: '../../100' } } });
  assert.equal(r.result.isError, true); assert.equal(r.result.structuredContent.error.code, 'INVALID_ARGUMENT');
});
test('status distinguishes a local inspection from a successful identity check', async () => {
  const { service, calls } = schoolFixture(await config());
  const registry = new ToolRegistry(service);
  const local = await registry.call('brightspace_status');
  assert.equal(local.structuredContent.data.auth.verified, false);
  assert.equal(calls.length, 0);
  const live = await registry.call('brightspace_status', { verifyConnection: true });
  assert.equal(live.structuredContent.data.auth.verified, true);
  assert.equal(live.structuredContent.data.connection.identifier, '42');
});
test('MCP unknown methods and tools are protocol errors', async () => {
  const d = await ready();
  assert.equal((await d.dispatch({ jsonrpc: '2.0', id: 2, method: 'execute_shell' })).error.code, -32601);
  assert.equal((await d.dispatch({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'submit_exam' } })).error.code, -32602);
});
test('MCP resources and prompts are discoverable and readable', async () => {
  const d = await ready();
  assert.equal((await d.dispatch({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'brightspace://guide' } })).result.contents[0].mimeType, 'text/plain');
  assert.equal((await d.dispatch({ jsonrpc: '2.0', id: 3, method: 'prompts/list' })).result.prompts.length, 2);
  assert.match((await d.dispatch({ jsonrpc: '2.0', id: 4, method: 'prompts/get', params: { name: 'school_exam_tutor', arguments: { courseId: '100' } } })).result.messages[0].content.text, /one small step/);
});
test('built executable speaks newline-delimited MCP with no stdout log pollution', async () => {
  const cfg = await config();
  const env = { ...process.env, BRIGHTSPACE_MCP_HOME: cfg.dataDir };
  delete env.BRIGHTSPACE_ACCESS_TOKEN;
  const child = spawn(process.execPath, ['dist/index.js', 'serve'], { cwd: new URL('..', import.meta.url), env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', x => { stdout += x; }); child.stderr.on('data', x => { stderr += x; });
  child.stdin.end([init(), initialized, { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'brightspace_status', arguments: {} } }].map(JSON.stringify).join('\n') + '\n');
  const [code] = await once(child, 'close');
  assert.equal(code, 0, stderr);
  const messages = stdout.trim().split('\n').map(x => JSON.parse(x));
  assert.equal(messages.length, 3); assert.equal(messages[1].result.tools.length, 18);
  assert.equal(messages[2].result.structuredContent.data.auth.configured, false);
});
test('bad JSON returns Parse error and the next request still works', async () => {
  const cfg = await config();
  const child = spawn(process.execPath, ['dist/index.js', 'serve'], { cwd: new URL('..', import.meta.url), env: { ...process.env, BRIGHTSPACE_MCP_HOME: cfg.dataDir } });
  let stdout = ''; child.stdout.on('data', x => { stdout += x; });
  child.stdin.end('not-json\n' + JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' }) + '\n');
  await once(child, 'close');
  const lines = stdout.trim().split('\n').map(JSON.parse);
  assert.equal(lines[0].error.code, -32700); assert.deepEqual(lines[1].result, {});
});
