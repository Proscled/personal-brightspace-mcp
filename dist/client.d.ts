import { type Collection, type Config } from './types.js';
type Fetch = typeof globalThis.fetch;
interface Options {
    fetchImpl?: Fetch;
    getHeaders?: (url: URL) => Promise<Record<string, string>>;
    sleepImpl?: (ms: number) => Promise<unknown>;
}
export declare function retryDelay(value: string | null, attempt: number, now?: number): number;
export declare class BrightspaceClient {
    readonly config: Config;
    private fetchImpl;
    private getHeaders;
    private wait;
    private versions?;
    private persistCookies;
    private queue;
    constructor(config: Config, options?: Options);
    discoverVersions(): Promise<{
        lp: string;
        le: string;
    }>;
    path(product: 'lp' | 'le', suffix: string): Promise<string>;
    private request;
    raw(input: string): Promise<{
        bytes: Uint8Array;
        contentType: string;
        sourceUrl: string;
        fetchedAt: string;
    }>;
    json(input: string): Promise<unknown>;
    collection(input: string): Promise<Collection<unknown>>;
}
export {};
