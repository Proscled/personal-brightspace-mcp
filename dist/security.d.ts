import { type Cookie } from './types.js';
export declare function safeApiUrl(origin: string, input: string, base?: string): URL;
export declare function safeNextPage(origin: string, current: URL, next: string): URL;
export declare function cookiesForUrl(cookies: Cookie[], url: URL, now?: number): string;
export declare function tenantCookies(cookies: Cookie[], origin: string): Cookie[];
export declare function cleanHeader(value: string): string;
export declare function htmlToText(input: string): string;
export declare function richText(value: unknown): string;
