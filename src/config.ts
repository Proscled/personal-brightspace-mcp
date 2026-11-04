import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { AppError, record, requireId, type Config } from './types.js';

export function validateOrigin(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new AppError('CONFIG', 'Brightspace URL is not a valid URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      (url.pathname !== '/' && url.pathname !== '') || (url.port && url.port !== '443')) {
    throw new AppError('CONFIG', 'Use only an HTTPS Brightspace origin, such as https://brightspace.hhs.nl, without credentials, path, query or custom port.');
  }
  if (!url.hostname.includes('.') || /^[\d.:\[\]]+$/.test(url.hostname) ||
      /(^|\.)(localhost|local|internal|test)$/.test(url.hostname)) {
    throw new AppError('CONFIG', 'Use the public DNS hostname of your Brightspace tenant, not a local or IP address.');
  }
  return url.origin;
}
export function buildConfig(input: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = resolve(env.BRIGHTSPACE_MCP_HOME || String(input.dataDir || join(homedir(), '.local', 'share', 'personal-brightspace-mcp')));
  const baseUrl = validateOrigin(env.BRIGHTSPACE_URL || String(input.baseUrl || 'https://brightspace.hhs.nl'));
  const timezone = String(input.timezone || 'Europe/Amsterdam');
  try { new Intl.DateTimeFormat('en-GB', { timeZone: timezone }).format(); }
  catch { throw new AppError('CONFIG', 'Invalid IANA timezone in config.'); }
  const integer = (name: string, fallback: number, min: number, max: number): number => {
    const value = input[name] ?? fallback;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
      throw new AppError('CONFIG', `${name} must be an integer from ${min} to ${max}.`);
    return value;
  };
  const version = (value: unknown): string | undefined => {
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || !/^\d{1,3}\.\d{1,3}$/.test(value))
      throw new AppError('CONFIG', 'API versions must look like 1.82. Omit them for discovery.');
    return value;
  };
  if (input.activeOnly !== undefined && typeof input.activeOnly !== 'boolean')
    throw new AppError('CONFIG', 'activeOnly must be true or false.');
  if (input.includeCourseIds !== undefined && !Array.isArray(input.includeCourseIds))
    throw new AppError('CONFIG', 'includeCourseIds must be an array of course IDs.');
  const includeCourseIds = (input.includeCourseIds as unknown[] | undefined ?? []).map(x => requireId(x, 'Course ID'));
  const maxResponseBytes = integer('maxResponseBytes', 8 * 1024 * 1024, 1024, 32 * 1024 * 1024);
  return { baseUrl, dataDir, timezone, activeOnly: input.activeOnly !== false, includeCourseIds,
    lpVersion: version(env.BRIGHTSPACE_LP_VERSION || input.lpVersion),
    leVersion: version(env.BRIGHTSPACE_LE_VERSION || input.leVersion),
    requestTimeoutMs: integer('requestTimeoutMs', 20000, 1000, 120000),
    maxPages: integer('maxPages', 30, 1, 100), maxCourses: integer('maxCourses', 30, 1, 100),
    maxResponseBytes, maxFileBytes: integer('maxFileBytes', input.maxResponseBytes === undefined ? 32 * 1024 * 1024 : maxResponseBytes, 1024, 32 * 1024 * 1024),
    retries: integer('retries', 2, 0, 4), requestSpacingMs: integer('requestSpacingMs', 200, 0, 5000) };
}
export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<Config> {
  const defaultConfig = buildConfig({}, env);
  let raw: unknown = {};
  try { raw = JSON.parse(await readFile(join(defaultConfig.dataDir, 'config.json'), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new AppError('CONFIG', 'Could not read config.json. Check that it contains valid JSON.');
  }
  return buildConfig(record(raw), env);
}
