import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const entry = join(root, 'dist', 'index.js');

test('Claude Desktop config starts the included server from an unrelated working directory with spaces', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'brightspace-host-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const install = join(temp, 'installed MCP with spaces');
  await mkdir(install);
  await cp(join(root, 'dist'), join(install, 'dist'), { recursive: true });
  await writeFile(join(install, 'package.json'), '{"type":"module"}');
  const state = join(temp, 'synthetic state');
  const env = { ...process.env, BRIGHTSPACE_MCP_HOME: state };
  delete env.BRIGHTSPACE_ACCESS_TOKEN;
  const { stdout, stderr } = await exec(process.execPath,
    [join(install, 'dist', 'index.js'), 'config-client', '--client', 'claude-desktop'], { cwd: temp, env });
  assert.equal(stderr, '');
  const { brightspace } = JSON.parse(stdout).mcpServers;
  assert.equal(brightspace.command, process.execPath);
  assert.deepEqual(brightspace.args, [join(install, 'dist', 'index.js'), 'serve']);
  assert.deepEqual(brightspace.env, { BRIGHTSPACE_MCP_HOME: state });

  // Exercise the exact generated command without a shell, as a desktop MCP host does.
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const child = spawn(brightspace.command, brightspace.args, {
    cwd: temp, env: { ...env, ...brightspace.env }, stdio: ['pipe', 'pipe', 'pipe']
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let out = '', err = '';
  child.stdout.on('data', value => { out += value; });
  child.stderr.on('data', value => { err += value; });
  child.stdin.end([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'synthetic-desktop-host', version: '1' }
    } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'brightspace_status', arguments: { verifyConnection: false } } }
  ].map(JSON.stringify).join('\n') + '\n');
  const [code] = await once(child, 'close');
  assert.equal(code, 0, err);
  const messages = out.trim().split('\n').map(JSON.parse);
  assert.equal(messages.length, 3);
  assert.equal(messages[0].result.protocolVersion, '2025-03-26');
  assert.equal(messages[1].result.tools.length, 18);
  assert.equal(messages[2].result.structuredContent.data.auth.configured, false);
});

test('host configuration generation never reads state or includes synthetic credentials', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'brightspace-host-config-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  // A malformed saved config would fail if the path-only generator tried to load it.
  await writeFile(join(temp, 'config.json'), 'not valid JSON');
  await writeFile(join(temp, 'session.json'), 'SYNTHETIC_SESSION_DO_NOT_EXPOSE');
  const env = { ...process.env, BRIGHTSPACE_MCP_HOME: temp, BRIGHTSPACE_ACCESS_TOKEN: 'SYNTHETIC_TOKEN_DO_NOT_EXPOSE' };
  for (const client of ['claude-desktop', 'claude-code', 'codex']) {
    const { stdout, stderr } = await exec(process.execPath, [entry, 'config-client', '--client', client], { cwd: temp, env });
    assert.equal(stderr, '');
    assert.doesNotMatch(stdout, /SYNTHETIC_|Authorization|access_token|cookies/);
    if (client === 'claude-desktop') assert.ok(JSON.parse(stdout).mcpServers.brightspace);
    if (client === 'codex') assert.match(stdout, /^\[mcp_servers\.brightspace\]/);
  }
  await assert.rejects(exec(process.execPath, [entry, 'config-client', '--client', 'unknown'], { env }),
    error => error.code === 1 && /Use --client/.test(error.stderr) && !error.stdout);
  assert.equal(await readFile(join(temp, 'config.json'), 'utf8'), 'not valid JSON');
  assert.deepEqual((await readdir(temp)).sort(), ['config.json', 'session.json']);
});

test('generated Claude Code command preserves spaces, quotes and shell metacharacters as literal arguments',
  { skip: process.platform === 'win32' }, async t => {
    const temp = await mkdtemp(join(tmpdir(), 'brightspace-host-shell-'));
    t.after(() => rm(temp, { recursive: true, force: true }));
    const state = join(temp, "state with ' quotes $(touch unexpected-file)");
    const bin = join(temp, 'bin');
    await mkdir(bin);
    const captured = join(temp, 'captured-args.json');
    await writeFile(join(temp, 'capture.cjs'), 'require("node:fs").writeFileSync(process.env.CAPTURED_ARGS, JSON.stringify(process.argv.slice(2)));');
    await writeFile(join(bin, 'claude'), '#!/bin/sh\nexec "$TEST_NODE" "$CAPTURE_SCRIPT" "$@"\n', { mode: 0o700 });
    const env = { ...process.env, BRIGHTSPACE_MCP_HOME: state, PATH: bin + ':' + process.env.PATH,
      TEST_NODE: process.execPath, CAPTURE_SCRIPT: join(temp, 'capture.cjs'), CAPTURED_ARGS: captured };
    delete env.BRIGHTSPACE_ACCESS_TOKEN;
    const { stdout } = await exec(process.execPath, [entry, 'config-client', '--client', 'claude-code'], { cwd: temp, env });
    await exec('/bin/sh', ['-c', stdout], { cwd: temp, env });
    assert.deepEqual(JSON.parse(await readFile(captured, 'utf8')), ['mcp', 'add', '--scope', 'user',
      '--env', `BRIGHTSPACE_MCP_HOME=${state}`, '--transport', 'stdio', 'brightspace', '--', process.execPath, entry, 'serve']);
    assert.deepEqual((await readdir(temp)).sort(), ['bin', 'capture.cjs', 'captured-args.json']);
  });
