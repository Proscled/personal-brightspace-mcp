import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AppError } from './types.js';

export type OfficeKind = 'pptx' | 'docx' | 'xlsx';
export interface OfficeSection {
  index: number;
  locator: string;
  text: string;
  notes?: string;
  images?: { index: number; name: string; alt: string; mimeType: string | null }[];
}
export interface OfficeContent { sections: OfficeSection[]; warnings: string[]; complete: boolean }
export interface SlideImage { mimeType: 'image/png' | 'image/jpeg'; data: string }

const worker = fileURLToPath(new URL('../scripts/office_reader.py', import.meta.url));
function runWorker<T>(bytes: Uint8Array, args: string[]): Promise<T> {
  if (bytes.byteLength > 32 * 1024 * 1024) throw new AppError('TOO_LARGE', 'Office input exceeds 32 MiB.');
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-I', '-S', '-B', worker, ...args], {
      shell: false, stdio: ['pipe', 'pipe', 'ignore'],
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT },
    });
    const chunks: Buffer[] = [];
    let size = 0;
    const stop = (error: AppError): void => { child.kill('SIGKILL'); reject(error); };
    const timer = setTimeout(() => stop(new AppError('EXTRACTION_LIMIT', 'Office document exceeded the extraction time limit.')), 15000);
    child.on('error', () => reject(new AppError('DEPENDENCY', 'Office extraction requires Python 3 on the local server.')));
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) stop(new AppError('EXTRACTION_LIMIT', 'Office output exceeds the extraction limit.'));
      else chunks.push(chunk);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new AppError('EXTRACTION', 'The Office document is malformed, unsupported or exceeds safe extraction limits.'));
        return;
      }
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (value.error) reject(new AppError('EXTRACTION', 'The embedded image is unavailable or exceeds safe image limits.'));
        else resolve(value as T);
      } catch { reject(new AppError('EXTRACTION', 'The local Office reader returned an invalid result.')); }
    });
    child.stdin.on('error', () => { /* close/error reports the worker outcome, including an early rejection. */ });
    child.stdin.end(bytes);
  });
}
export function extractOffice(bytes: Uint8Array, kind: OfficeKind): Promise<OfficeContent> {
  return runWorker<OfficeContent>(bytes, [kind]);
}
export function readSlideImage(bytes: Uint8Array, slide: number, image: number): Promise<SlideImage> {
  if (![slide, image].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 10000))
    throw new AppError('INVALID_ARGUMENT', 'Select positive slide and image numbers from the presentation.');
  return runWorker<SlideImage>(bytes, ['pptx', String(slide), String(image)]);
}
