#!/usr/bin/env node
import { join, resolve } from 'node:path';
import { buildConfig, loadConfig, validateOrigin } from './config.js';
import { authStatus, browserLogin, logout } from './auth.js';
import { BrightspaceClient } from './client.js';
import { SchoolService } from './service.js';
import { NoteStore } from './notes.js';
import { ToolRegistry } from './tools.js';
import { serveStdio } from './mcp.js';
import { AppError, record, safeError } from './types.js';
import { readPrivateJson, writePrivateJson } from './storage.js';

const help = `Personal Brightspace MCP 0.1.0 — Node.js 22.16+

  node dist/index.js init [--url https://brightspace.hhs.nl]
  node dist/index.js login [--remember-browser]
  node dist/index.js doctor
  node dist/index.js serve
  node dist/index.js config-client [--client claude-desktop|claude-code|codex]
  node dist/index.js call <tool_name> '<JSON arguments>'
  node dist/index.js import-notes <file.md> [--title 'Title'] [--as-of YYYY-MM-DD]
  node dist/index.js logout

State: ~/.local/share/personal-brightspace-mcp (or BRIGHTSPACE_MCP_HOME)
Authentication: browser sign-in, or official BRIGHTSPACE_ACCESS_TOKEN in your environment.
No password arguments, submissions, external exam access, HTTP listener or background scheduling.
`;
async function main(): Promise<void> {
  process.umask(0o077);
  const args = process.argv.slice(2), command = args[0] || 'serve';
  if (['help', '--help', '-h'].includes(command)) { console.log(help); return; }
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(name);
    if (index === -1) return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new AppError('CLI', `Missing value for ${name}.`);
    return value;
  };
  if (command === 'config-client') {
    // Host setup needs paths only: never inspect saved school configuration or credentials.
    const config = buildConfig({});
    const client = flag('--client') || 'all';
    if (!['all', 'claude-desktop', 'claude-code', 'codex'].includes(client))
      throw new AppError('CLI', 'Use --client claude-desktop, claude-code or codex.');
    const script = resolve(process.argv[1]!);
    const json = JSON.stringify({ mcpServers: { brightspace: { command: process.execPath, args: [script, 'serve'],
      env: { BRIGHTSPACE_MCP_HOME: config.dataDir } } } }, null, 2);
    const toml = `[mcp_servers.brightspace]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(script)}, "serve"]\nstartup_timeout_sec = 15\ntool_timeout_sec = 300\n\n[mcp_servers.brightspace.env]\nBRIGHTSPACE_MCP_HOME = ${JSON.stringify(config.dataDir)}`;
    if (client === 'claude-desktop') console.log(json);
    else if (client === 'codex') console.log(toml);
    else if (client === 'claude-code') {
      const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;
      console.log(`claude mcp add --scope user --env ${quote(`BRIGHTSPACE_MCP_HOME=${config.dataDir}`)} --transport stdio brightspace -- ${quote(process.execPath)} ${quote(script)} serve`);
    } else {
      console.log(json);
      console.log('\n# Codex config.toml equivalent (merge this entry; do not replace your whole config):');
      console.log(toml);
    }
    return;
  }
  const config = await loadConfig();
  const service = new SchoolService(new BrightspaceClient(config));
  const registry = new ToolRegistry(service);
  if (command === 'serve') { await serveStdio(registry); return; }
  if (command === 'init') {
    const path = join(config.dataDir, 'config.json');
    const previous = record(await readPrivateJson(path));
    const baseUrl = validateOrigin(flag('--url') || config.baseUrl);
    await writePrivateJson(path, { baseUrl, timezone: config.timezone, activeOnly: config.activeOnly,
      includeCourseIds: config.includeCourseIds, ...previous, ...(flag('--url') ? { baseUrl } : {}) });
    console.log(`Configuration saved: ${path}\nSchool: ${baseUrl}\nNext: node dist/index.js login`); return;
  }
  if (command === 'login') { await browserLogin(config, args.includes('--remember-browser')); return; }
  if (command === 'logout') { await logout(config); return; }
  if (command === 'doctor') {
    const local = { node: process.version, school: config.baseUrl, timezone: config.timezone, auth: await authStatus(config) };
    try {
      const who = await service.whoami();
      const courses = await service.courses();
      console.log(JSON.stringify({ ...local, auth: { ...local.auth, verified: true }, connection: 'verified', who, versions: await service.client.discoverVersions(),
        courseCount: courses.items.length, complete: courses.complete, warnings: courses.warnings }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({ ...local, connection: 'not_verified', error: safeError(error) }, null, 2)); process.exitCode = 1;
    }
    return;
  }
  if (command === 'import-notes') {
    if (!args[1] || args[1].startsWith('--')) throw new AppError('CLI', 'Supply a Markdown or text file to import.');
    console.log(JSON.stringify(await new NoteStore(config).importFile(resolve(args[1]), flag('--title'), flag('--as-of')), null, 2)); return;
  }
  if (command === 'call') {
    if (!args[1]) throw new AppError('CLI', 'Supply the MCP tool name.');
    let input: unknown;
    try { input = JSON.parse(args[2] || '{}'); } catch { throw new AppError('CLI', 'Tool arguments must be valid JSON.'); }
    const result = await registry.call(args[1], input);
    console.log(JSON.stringify(result.structuredContent, null, 2));
    if (result.isError) process.exitCode = 1;
    return;
  }
  throw new AppError('CLI', 'Unknown command. Run node dist/index.js --help.');
}
main().catch(error => { console.error(JSON.stringify({ error: safeError(error) })); process.exitCode = 1; });
