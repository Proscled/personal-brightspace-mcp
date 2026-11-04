import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ToolRegistry } from '../tools.js';
/** The caller must validate the route/Host and supply only the authenticated user's registry. */
export declare function handleMcp(req: IncomingMessage, res: ServerResponse, registry: ToolRegistry, allowedOrigins?: readonly string[]): Promise<void>;
