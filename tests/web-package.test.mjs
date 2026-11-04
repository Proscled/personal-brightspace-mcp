import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const builder = fileURLToPath(new URL('../packaging/web/build.py', import.meta.url));
const origin = 'https://mcp.study-fixture.org';
const clientId = 'study-test-client';

function runBuilder(output, originArg = origin, idArg = clientId) {
  return spawnSync('python3', ['-I', builder, '--origin', originArg, '--client-id', idArg, '--output', output],
    { encoding: 'utf8' });
}

function outputInTemp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'study-web-package-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'study.zip');
}

test('browser draft reproduces the same static ZIP and declares only a remote OAuth MCP', t => {
  const output = outputInTemp(t);
  const result = runBuilder(output, origin.toUpperCase() + ':443/');
  assert.equal(result.status, 0, result.stderr);
  const bytes = readFileSync(output);
  assert.equal(runBuilder(output).status, 0);
  assert.deepEqual(readFileSync(output), bytes);

  const inspect = spawnSync('python3', ['-I', '-c', [
    'import json, sys, zipfile',
    'with zipfile.ZipFile(sys.argv[1]) as z:',
    ' assert z.testzip() is None',
    ' print(json.dumps({i.filename: z.read(i).decode() for i in z.infolist()}))',
  ].join('\n'), output], { encoding: 'utf8' });
  assert.equal(inspect.status, 0, inspect.stderr);
  const entries = JSON.parse(inspect.stdout);
  assert.deepEqual(Object.keys(entries).sort(), ['assets/book.svg', 'mcp.json', 'plugin.json']);
  const plugin = JSON.parse(entries['plugin.json']);
  const display = plugin.extensions['com.openai'].interface;
  assert.equal(plugin.name, 'brightspace-study');
  assert.equal(display.logo, './assets/book.svg');
  assert.equal(display.composerIcon, display.logo);
  assert.equal(plugin.extensions['com.openai'].requires_local_executor, undefined);
  const cases = plugin.extensions['com.openai'].review.test_cases;
  assert.equal(cases.positive.length, 5);
  assert.equal(cases.negative.length, 3);
  for (const example of cases.positive) {
    assert.ok(example.prompt && example.description && example.expected_behavior && example.tools_triggered);
  }
  assert.deepEqual(JSON.parse(entries['mcp.json']).mcpServers, {
    brightspace: {
      type: 'streamable-http', url: origin + '/mcp',
      extensions: { 'com.openai': { auth: {
        type: 'oauth',
        client: { mode: 'provided', clientId, tokenEndpointAuthMethod: 'client_secret_basic' },
        authorizationUrl: origin + '/oauth/authorize', tokenUrl: origin + '/oauth/token',
        baseScopes: ['brightspace.read'],
      } } },
    },
  });
});

test('browser packaging rejects bad deployment coordinates and preserves an existing output', t => {
  const output = outputInTemp(t);
  writeFileSync(output, 'previous contents');
  for (const bad of [
    'http://mcp.study-fixture.org', 'https://localhost', 'https://127.0.0.1', 'https://192.168.0.2',
    'https://mcp.local', 'https://brightspace.hhs.nl', 'https://example.com', origin + '/mcp', origin + ':8443',
    'https://user:secret@mcp.study-fixture.org', origin + '?token=secret', origin + '#fragment',
  ]) {
    assert.equal(runBuilder(output, bad).status, 1);
  }
  assert.equal(runBuilder(output, origin, '   ').status, 1);
  assert.equal(runBuilder(output, origin, 'wrong:id').status, 1);
  assert.equal(runBuilder(output, origin, 'a'.repeat(161)).status, 1);
  assert.equal(readFileSync(output, 'utf8'), 'previous contents');
});
