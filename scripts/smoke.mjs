// Self-contained MCP transport smoke test; it does not contact a school or use credentials.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const state = await mkdtemp(join(tmpdir(), 'brightspace-smoke-'));
try {
  const env = { ...process.env, BRIGHTSPACE_MCP_HOME: state };
  delete env.BRIGHTSPACE_ACCESS_TOKEN;
  const child = spawn(process.execPath, ['dist/index.js', 'serve'], { stdio: ['pipe', 'pipe', 'pipe'], env });
  let out = '', err = '';
  child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { err += b; });
  child.stdin.end([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', clientInfo: { name: 'smoke', version: '1' }, capabilities: {} } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'brightspace_status', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'brightspace://guide' } }
  ].map(JSON.stringify).join('\n') + '\n');
  const [code] = await once(child, 'close');
  assert.equal(code, 0, err);
  const messages = out.trim().split('\n').map(JSON.parse);
  assert.equal(messages.length, 4);
  assert.equal(messages[0].result.protocolVersion, '2025-11-25');
  assert.equal(messages[1].result.tools.length, 18);
  assert.equal(messages[2].result.structuredContent.data.auth.configured, false);
  assert.ok(messages[3].result.contents[0].text.length > 0);
  console.log('PASS: subprocess MCP initialization, 18-tool discovery, status call and resource read.');
  console.log('No Brightspace login or live school API was used.');
} finally { await rm(state, { recursive: true, force: true }); }
