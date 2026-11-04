export type JsonRecord = Record<string, unknown>;

export function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord : {};
}
export function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
export function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
export function id(value: unknown): string | null {
  const result = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : text(value);
  return result && /^[1-9]\d{0,17}$/.test(result) ? result : null;
}
export function requireId(value: unknown, name = 'ID'): string {
  const result = id(value);
  if (!result) throw new AppError('INVALID_ARGUMENT', `${name} must be a positive decimal ID.`);
  return result;
}
export class AppError extends Error {
  constructor(public code: string, message: string, public status?: number) {
    super(message); this.name = 'AppError';
  }
}
export function safeError(error: unknown): { code: string; message: string; status?: number } {
  if (error instanceof AppError) return { code: error.code, message: error.message, status: error.status };
  // Never forward fetch/library error bodies: they can contain cookies, tokens or school data.
  return { code: 'INTERNAL_ERROR', message: 'The operation failed. Run the local doctor command; do not share credentials or raw session files.' };
}
export interface Config {
  baseUrl: string;
  dataDir: string;
  timezone: string;
  activeOnly: boolean;
  includeCourseIds: string[];
  lpVersion?: string;
  leVersion?: string;
  requestTimeoutMs: number;
  maxPages: number;
  maxCourses: number;
  maxResponseBytes: number;
  maxFileBytes: number;
  retries: number;
  requestSpacingMs: number;
}
export interface Cookie {
  name: string; value: string; domain: string; path: string;
  expires: number; secure: boolean; httpOnly?: boolean; sameSite?: string;
}
export interface Session {
  format: 1;
  origin: string;
  createdAt: string;
  accountId: string;
  cookies: Cookie[];
  bearerToken?: string;
  bearerExpiresAt?: number;
  csrfToken?: string;
}
export interface Collection<T> {
  items: T[];
  complete: boolean;
  warnings: string[];
  sourceUrl: string;
  fetchedAt: string;
}
export interface Course {
  id: string; name: string; code: string | null; active: boolean | null;
  startDate: unknown; endDate: unknown; sourceUrl: string;
}
