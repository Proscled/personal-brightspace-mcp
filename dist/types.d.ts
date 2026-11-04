export type JsonRecord = Record<string, unknown>;
export declare function record(value: unknown): JsonRecord;
export declare function array(value: unknown): unknown[];
export declare function text(value: unknown): string | null;
export declare function id(value: unknown): string | null;
export declare function requireId(value: unknown, name?: string): string;
export declare class AppError extends Error {
    code: string;
    status?: number | undefined;
    constructor(code: string, message: string, status?: number | undefined);
}
export declare function safeError(error: unknown): {
    code: string;
    message: string;
    status?: number;
};
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
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    secure: boolean;
    httpOnly?: boolean;
    sameSite?: string;
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
    id: string;
    name: string;
    code: string | null;
    active: boolean | null;
    startDate: unknown;
    endDate: unknown;
    sourceUrl: string;
}
