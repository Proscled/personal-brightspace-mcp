export declare function privateDir(path: string): Promise<void>;
export declare function writePrivateJson(path: string, value: unknown): Promise<void>;
export declare function readPrivateJson(path: string, maxBytes?: number): Promise<unknown | null>;
/** A cross-process lock prevents two MCP hosts from overwriting the same baseline. */
export declare function withLock<T>(dir: string, action: () => Promise<T>): Promise<T>;
