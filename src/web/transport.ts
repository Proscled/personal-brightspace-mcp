import type { IncomingMessage, ServerResponse } from 'node:http';
import { HTTP_PROTOCOL_VERSIONS, McpDispatcher } from '../mcp.js';
import type { ToolRegistry } from '../tools.js';
import { record } from '../types.js';

const MAX_BODY = 1024 * 1024;

function reject(res: ServerResponse, status: number, message: string, code = -32600): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code, message } }));
}

function accepts(accept: string | undefined, mime: string): boolean {
  return (accept ?? '').toLowerCase().split(',').some(range => {
    const [media, ...params] = range.trim().split(';');
    if (media?.trim() !== mime) return false;
    const weight = params.map(p => p.trim()).find(p => p.startsWith('q='));
    return weight === undefined || (/^q=(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(weight) && Number(weight.slice(2)) > 0);
  });
}

function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (origin === undefined) return true;
  try {
    const url = new URL(origin);
    return ['https:', 'http:'].includes(url.protocol) && origin === url.origin && allowed.includes(origin);
  } catch { return false; }
}

/** The caller must validate the route/Host and supply only the authenticated user's registry. */
export async function handleMcp(req: IncomingMessage, res: ServerResponse, registry: ToolRegistry,
                                allowedOrigins: readonly string[] = []): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!originAllowed(req.headers.origin, allowedOrigins)) return reject(res, 403, 'Origin is not allowed.');
  const version = req.headers['mcp-protocol-version'];
  if (version !== undefined && (typeof version !== 'string' || !HTTP_PROTOCOL_VERSIONS.includes(version))) {
    return reject(res, 400, 'Unsupported MCP protocol version.');
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return reject(res, 405, 'Use POST. This endpoint does not maintain sessions or an SSE stream.');
  }
  if (!accepts(req.headers.accept, 'application/json') || !accepts(req.headers.accept, 'text/event-stream')) {
    return reject(res, 406, 'Accept must include application/json and text/event-stream.');
  }
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(req.headers['content-type'] ?? '') ||
      (req.headers['content-encoding'] ?? 'identity').toLowerCase() !== 'identity') {
    return reject(res, 415, 'Use an uncompressed application/json body encoded in UTF-8.');
  }
  const tooLarge = (): void => {
    // Avoid holding the keep-alive connection open while an oversized body continues to arrive.
    res.shouldKeepAlive = false;
    req.resume();
    reject(res, 413, 'Message exceeds 1 MiB.');
  };
  if (Number(req.headers['content-length']) > MAX_BODY) return tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  let message: unknown;
  try {
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > MAX_BODY) return tooLarge();
      chunks.push(chunk);
    }
    message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
  } catch { return reject(res, 400, 'Invalid UTF-8 or JSON.', -32700); }

  const rpc = record(message);
  // No server-initiated requests are sent, so an incoming JSON-RPC response is always unsolicited.
  if (Object.hasOwn(rpc, 'result') || Object.hasOwn(rpc, 'error') ||
      (rpc.params !== undefined && (rpc.params === null || typeof rpc.params !== 'object' || Array.isArray(rpc.params)))) {
    return reject(res, 400, 'Invalid MCP message.');
  }
  const result = await new McpDispatcher(registry, 'statelessHttp').dispatch(message);
  if (!result) { res.writeHead(202); res.end(); return; }
  res.writeHead(record(result.error).code === -32600 ? 400 : 200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}
