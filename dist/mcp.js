import { record, safeError } from './types.js';
import { PROMPTS, prompt } from './tools.js';
// These protocol revisions share the tools/resources/prompts subset implemented below.
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
// The HTTP adapter implements single-message Streamable HTTP, without legacy SSE or batching.
export const HTTP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18'];
export class RpcError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
export class McpDispatcher {
    registry;
    transport;
    initialized = false;
    ready = false;
    constructor(registry, transport = 'stdio') {
        this.registry = registry;
        this.transport = transport;
    }
    async dispatch(value) {
        const r = record(value);
        const hasId = Object.hasOwn(r, 'id');
        const validId = typeof r.id === 'string' || (typeof r.id === 'number' && Number.isFinite(r.id));
        const id = validId ? r.id : null;
        if (Array.isArray(value) || r.jsonrpc !== '2.0' || typeof r.method !== 'string' || (hasId && !validId))
            return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid JSON-RPC request; batching is not supported.' } };
        // JSON-RPC notifications MUST NOT receive a response.
        if (!hasId) {
            if (r.method === 'notifications/initialized' && this.initialized)
                this.ready = true;
            return null;
        }
        try {
            const p = record(r.params);
            let result;
            if (r.method === 'initialize') {
                if (this.initialized)
                    throw new RpcError(-32600, 'Already initialized.');
                if (typeof p.protocolVersion !== 'string' || !p.clientInfo || typeof p.capabilities !== 'object')
                    throw new RpcError(-32602, 'initialize requires protocolVersion, clientInfo and capabilities.');
                this.initialized = true;
                const versions = this.transport === 'stdio' ? PROTOCOL_VERSIONS : HTTP_PROTOCOL_VERSIONS;
                const version = versions.includes(p.protocolVersion) ? p.protocolVersion : versions[0];
                result = { protocolVersion: version, serverInfo: { name: 'personal-brightspace-mcp', version: '0.1.0' },
                    capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false } }, instructions: this.registry.guide };
            }
            else if (r.method === 'ping')
                result = {};
            else {
                // The HTTP router authenticates a fresh registry for each request. There is no cross-request session.
                if (this.transport === 'stdio' && (!this.initialized || !this.ready))
                    throw new RpcError(-32002, 'Complete the MCP initialization handshake first.');
                switch (r.method) {
                    case 'tools/list':
                        result = { tools: this.registry.list() };
                        break;
                    case 'tools/call':
                        if (typeof p.name !== 'string' || !this.registry.has(p.name))
                            throw new RpcError(-32602, 'Unknown or missing tool name.');
                        result = await this.registry.call(p.name, p.arguments ?? {});
                        break;
                    case 'resources/list':
                        result = { resources: [{ uri: 'brightspace://guide', name: 'Brightspace tutor guide', description: 'Source handling, privacy and limitations.', mimeType: 'text/plain' }] };
                        break;
                    case 'resources/templates/list':
                        result = { resourceTemplates: [] };
                        break;
                    case 'resources/read':
                        if (p.uri !== 'brightspace://guide')
                            throw new RpcError(-32602, 'Unknown resource URI.');
                        result = { contents: [{ uri: 'brightspace://guide', mimeType: 'text/plain', text: this.registry.guide }] };
                        break;
                    case 'prompts/list':
                        result = { prompts: PROMPTS };
                        break;
                    case 'prompts/get':
                        if (typeof p.name !== 'string')
                            throw new RpcError(-32602, 'Missing prompt name.');
                        try {
                            result = prompt(p.name, record(p.arguments));
                        }
                        catch {
                            throw new RpcError(-32602, 'Unknown prompt or invalid prompt arguments.');
                        }
                        break;
                    default: throw new RpcError(-32601, 'Method not found.');
                }
            }
            return { jsonrpc: '2.0', id, result };
        }
        catch (error) {
            return { jsonrpc: '2.0', id, error: error instanceof RpcError ? { code: error.code, message: error.message }
                    : { code: -32603, message: safeError(error).message } };
        }
    }
}
/** Newline-delimited JSON-RPC over stdio. stdout contains protocol messages only. */
export async function serveStdio(registry, input = process.stdin, output = process.stdout) {
    const dispatcher = new McpDispatcher(registry);
    let buffer = '';
    const send = async (data) => {
        await new Promise((resolve, reject) => output.write(JSON.stringify(data) + '\n', error => error ? reject(error) : resolve()));
    };
    const consume = async (line) => {
        if (!line.trim())
            return;
        let value;
        try {
            value = JSON.parse(line);
        }
        catch {
            await send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } });
            return;
        }
        const response = await dispatcher.dispatch(value);
        if (response)
            await send(response);
    };
    input.setEncoding('utf8');
    for await (const chunk of input) {
        buffer += String(chunk);
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            if (Buffer.byteLength(line, 'utf8') > 1024 * 1024) {
                await send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Message exceeds 1 MiB.' } });
                return;
            }
            await consume(line);
        }
        if (Buffer.byteLength(buffer, 'utf8') > 1024 * 1024) {
            await send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Message exceeds 1 MiB.' } });
            return;
        }
    }
    if (buffer.trim())
        await consume(buffer);
}
//# sourceMappingURL=mcp.js.map