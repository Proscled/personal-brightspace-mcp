import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { AppError } from './types.js';
import type { OfficeKind } from './office.js';

export interface PageText {
  sections: { index: number; locator: string; text: string; ocr: boolean }[];
  complete: boolean;
  warnings: string[];
  pageCount: number;
}
type MaterialKind = OfficeKind | 'pdf';
const helper = fileURLToPath(new URL('../scripts/visual_launcher.py', import.meta.url));
const exec = promisify(execFile);
const MiB = 1024 * 1024;

async function libreOffice(): Promise<string> {
  const apps = ['/Applications/LibreOffice.app', join(homedir(), 'Applications/LibreOffice.app'),
    join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/libreoffice-headless/libreoffice/LibreOfficeDev.app')];
  for (const app of apps) {
    try { await access(join(app, 'Contents/MacOS/soffice'), constants.X_OK); return await realpath(app); }
    catch { /* Try the next known installation. */ }
  }
  throw new AppError('DEPENDENCY', 'Rendering Office pages requires a local LibreOffice installation in Applications or the Codex desktop runtime.');
}

async function processMaterial(bytes: Uint8Array, kind: MaterialKind, mode: 'render' | 'text', page?: number, forceOcr = false): Promise<PageText | Buffer> {
  if (page !== undefined && (!Number.isSafeInteger(page) || page < 1 || page > 100000))
    throw new AppError('INVALID_ARGUMENT', 'Page and slide numbers start at 1 and may not exceed 100000.');
  if (bytes.byteLength > 32 * MiB) throw new AppError('TOO_LARGE', 'The local renderer accepts up to 32 MiB per file.');
  if (process.platform !== 'darwin') throw new AppError('DEPENDENCY', 'This local visual reader uses macOS PDFKit and Vision.');
  const app = kind === 'pdf' ? '' : await libreOffice();
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'brightspace-render-')));
  const run = async (action: string): Promise<string> => {
    try {
      const { stdout } = await exec('/usr/bin/python3', ['-I', '-S', '-B', helper, action, kind, dir, app, String(page ?? 0), forceOcr ? 'force' : 'auto'], {
        cwd: dir, timeout: 60000, killSignal: 'SIGKILL', maxBuffer: 8 * MiB,
        env: { HOME: dir, TMPDIR: dir, PATH: '/usr/bin:/bin', SAL_USE_VCLPLUGIN: 'svp', LC_ALL: 'en_US.UTF-8' }
      });
      return stdout;
    } catch {
      throw new AppError('EXTRACTION', 'The sandboxed local reader failed. The material may be malformed, protected, or over a resource limit.');
    }
  };
  try {
    if (kind === 'pdf') {
      if (!Buffer.from(bytes.subarray(0, 1024)).includes('%PDF-')) throw new AppError('EXTRACTION', 'The downloaded file has no PDF header.');
      await writeFile(join(dir, 'material.pdf'), bytes, { mode: 0o600 });
    } else {
      await writeFile(join(dir, 'original.' + kind), bytes, { mode: 0o600 });
      await run('convert');
    }
    const output = await run(mode);
    let result;
    try { result = JSON.parse(output); }
    catch { throw new AppError('EXTRACTION', 'The local document reader returned invalid output.'); }
    if (result?.error === 'PAGE_RANGE') throw new AppError('INVALID_ARGUMENT', 'The requested page is beyond the end of this file.');
    if (result?.error === 'COPY_PERMISSION') throw new AppError('FORBIDDEN', 'This PDF restricts copying. Open it in the school viewer.');
    if (result?.error) throw new AppError('EXTRACTION', 'The page could not be opened or rendered within the local limits.');
    if (mode === 'text' && Array.isArray(result?.sections)) return result as PageText;
    if (mode !== 'render' || result?.ok !== true) throw new AppError('EXTRACTION', 'No page image was produced.');
    const file = await open(join(dir, 'page.png'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 3 * MiB) throw new AppError('TOO_LARGE', 'The rendered page exceeds the bounded PNG size.');
      return await file.readFile();
    } finally { await file.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function extractPdf(bytes: Uint8Array, page?: number, forceOcr = false): Promise<PageText> {
  return await processMaterial(bytes, 'pdf', 'text', page, forceOcr) as PageText;
}
export async function extractScannedOffice(bytes: Uint8Array, kind: OfficeKind, page?: number): Promise<PageText> {
  return await processMaterial(bytes, kind, 'text', page, true) as PageText;
}
export async function renderPage(bytes: Uint8Array, kind: MaterialKind, page: number): Promise<Buffer> {
  return await processMaterial(bytes, kind, 'render', page) as Buffer;
}
