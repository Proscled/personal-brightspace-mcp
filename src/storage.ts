import { mkdir, open, readFile, rename, rm, chmod, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { AppError } from './types.js';

export async function privateDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if ((await lstat(path)).isSymbolicLink()) throw new AppError('STORAGE', 'Refusing a symbolic-link state directory.');
  if (process.platform !== 'win32') await chmod(path, 0o700);
}
export async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await privateDir(dirname(path));
  const tmp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    const handle = await open(tmp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(tmp, path);
    if (process.platform !== 'win32') await chmod(path, 0o600);
  } finally { await rm(tmp, { force: true }); }
}
export async function readPrivateJson(path: string, maxBytes = 32 * 1024 * 1024): Promise<unknown | null> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes)
      throw new AppError('STORAGE', 'State file is not a regular file or exceeds the size limit.');
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
      throw new AppError('STORAGE', 'Private state has unsafe permissions. Run chmod 600 on the affected state JSON file.');
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof AppError) throw error;
    throw new AppError('STORAGE', 'A private state file could not be parsed. Back it up locally before resetting it.');
  }
}
/** A cross-process lock prevents two MCP hosts from overwriting the same baseline. */
export async function withLock<T>(dir: string, action: () => Promise<T>): Promise<T> {
  await privateDir(dir);
  const path = join(dir, '.update.lock');
  let handle;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { handle = await open(path, 'wx', 0o600); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await sleep(100);
    }
  }
  if (!handle) throw new AppError('BUSY', 'Another update check is running. After a crashed check, remove the local .update.lock file only when no server is updating.');
  try { await handle.writeFile(String(process.pid)); return await action(); }
  finally { await handle.close(); await rm(path, { force: true }); }
}
