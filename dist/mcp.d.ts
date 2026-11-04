import type { Readable, Writable } from 'node:stream';
import { type JsonRecord } from './types.js';
import { ToolRegistry } from './tools.js';
export declare const PROTOCOL_VERSIONS: readonly ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export declare const HTTP_PROTOCOL_VERSIONS: readonly string[];
export declare class RpcError extends Error {
    code: number;
    constructor(code: number, message: string);
}
export declare class McpDispatcher {
    private registry;
    private transport;
    private initialized;
    private ready;
    constructor(registry: ToolRegistry, transport?: 'stdio' | 'statelessHttp');
    dispatch(value: unknown): Promise<JsonRecord | null>;
}
/** Newline-delimited JSON-RPC over stdio. stdout contains protocol messages only. */
export declare function serveStdio(registry: ToolRegistry, input?: Readable, output?: Writable): Promise<void>;
