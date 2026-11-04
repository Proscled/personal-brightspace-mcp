import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { validateOrigin } from '../config.js';
import { requireId } from '../types.js';
import type { D2lOAuth, D2lTokens } from './brightspace-oauth.js';
import { Grants } from './grants.js';
import { schoolRegistry } from './registry.js';
import { handleMcp } from './transport.js';

export interface WebConfig {
  origin: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  dataDir: string;
}
type Upstream = Pick<D2lOAuth, 'authorizationUrl' | 'exchangeCode' | 'refresh' | 'verifyAccount'>;
interface Login {
  browser: string;
  state: string;
  challenge: string;
  expires: number;
}
interface Consent extends Login {
  account: string;
  tokens: D2lTokens;
}
const scope = 'brightspace.read';
const cookieName = '__Host-brightspace_flow';
const nonce = () => randomBytes(32).toString('base64url');
function equal(a: string, b: string): boolean {
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(a), hash(b));
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
function redirect(res: ServerResponse, url: string): void {
  res.writeHead(303, { Location: url });
  res.end();
}
function unique(params: URLSearchParams): boolean {
  return new Set(params.keys()).size === params.size;
}
async function form(req: IncomingMessage): Promise<URLSearchParams | undefined> {
  if (!/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) return;
  if ((req.headers['content-encoding'] ?? 'identity') !== 'identity') return;
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    if ((size += chunk.length) > 16384) { req.resume(); return; }
    chunks.push(chunk);
  }
  const params = new URLSearchParams(Buffer.concat(chunks, size).toString('utf8'));
  if (unique(params)) return params;
}
function browserMatches(req: IncomingMessage, login: Login): boolean {
  const cookies = (req.headers.cookie ?? '').split(';').map(s => s.trim()).filter(s => s.startsWith(cookieName + '='));
  return cookies.length === 1 && equal(cookies[0]!.slice(cookieName.length + 1), login.browser);
}
function consentPage(res: ServerResponse, proof: string, account: string): void {
  // Account is a validated decimal school ID. Proof is base64url. No other dynamic HTML.
  // Native form POSTs need their Origin for CSRF checks. Keep callback paths and queries out of Referer.
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'strict-origin' });
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Brightspace Study to ChatGPT</title><main><h1>Connect Brightspace Study to ChatGPT?</h1>
<p>You signed in to HHS with Brightspace account ${account}. ChatGPT will be able to request your courses, deadlines, assignments, announcements, released grades and course materials.</p>
<p>Course data returned by your requests goes to your ChatGPT conversation. Checking for changes also saves a comparison copy on the plugin host for this school account.</p>
<p>This plugin can read school data. It cannot submit work, start quizzes or change grades.</p>
<form method="post" action="/oauth/consent"><input type="hidden" name="proof" value="${proof}">
<button name="decision" value="allow">Connect this account</button> <button name="decision" value="deny">Cancel</button></form></main></html>`);
}

export function createWebServer(config: WebConfig, upstream: Upstream, fetchImpl?: typeof fetch) {
  const { origin, redirectUri, dataDir } = config;
  if (validateOrigin(origin) !== origin || !isAbsolute(dataDir) ||
      !/^https:\/\/chatgpt\.com\/(?:connector_platform_oauth_redirect|connector\/oauth\/[A-Za-z0-9._~-]+)$/.test(redirectUri) ||
      !/^[A-Za-z0-9._~-]{1,160}$/.test(config.clientId) || !/^[!-~]{1,512}$/.test(config.clientSecret)) {
    throw new Error('Invalid web service configuration. See docs/CHATGPT_WEB.md.');
  }
  const resource = origin + '/mcp';
  const metadata = origin + '/.well-known/oauth-protected-resource/mcp';
  const authChallenge = `Bearer resource_metadata="${metadata}", scope="${scope}", error="invalid_token", error_description="Connect your school account"`;
  const host = new URL(origin).host;
  const encode = (s: string) => new URLSearchParams({ v: s }).toString().slice(2);
  const basic = 'Basic ' + Buffer.from(encode(config.clientId) + ':' + encode(config.clientSecret)).toString('base64');
  const grants = new Grants(upstream);
  const logins = new Map<string, Login>();
  const consents = new Map<string, Consent>();
  function prune() {
    const now = Date.now();
    grants.prune(now);
    for (const [key, row] of logins) if (row.expires <= now) logins.delete(key);
    for (const [key, row] of consents) if (row.expires <= now) consents.delete(key);
  }
  function callback(res: ServerResponse, state: string, result: Record<string,string>) {
    const url = new URL(redirectUri);
    url.search = new URLSearchParams({ ...result, state, iss: origin }).toString();
    res.setHeader('Set-Cookie', cookieName + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    redirect(res, url.href);
  }
  let mcpRequests = 0;
  let exchanges = 0;
  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', `default-src 'none'; form-action 'self' ${redirectUri}; frame-ancestors 'none'; base-uri 'none'`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    const invalid = () => json(res, 400, { error: 'invalid_request' });
    if (req.headers.host !== host || !req.url?.startsWith('/') || req.url.startsWith('//')) return invalid();
    const url = new URL(req.url, origin);
    if (url.origin !== origin) return invalid();
    const p = url.searchParams;
    if (!unique(p)) return invalid();
    const method = req.method;
    if (method === 'GET') {
      if (url.pathname === '/healthz') return json(res, 200, { ok: true });
      if (['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource'].includes(url.pathname))
        return json(res, 200, { resource, resource_name: 'Brightspace Study', authorization_servers: [origin],
          scopes_supported: [scope], bearer_methods_supported: ['header'] });
      if (url.pathname === '/.well-known/oauth-authorization-server')
        return json(res, 200, { issuer: origin, authorization_response_iss_parameter_supported: true,
          authorization_endpoint: origin + '/oauth/authorize', token_endpoint: origin + '/oauth/token',
          revocation_endpoint: origin + '/oauth/revoke', revocation_endpoint_auth_methods_supported: ['client_secret_basic'],
          scopes_supported: [scope], response_types_supported: ['code'], grant_types_supported: ['authorization_code','refresh_token'],
          code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['client_secret_basic'] });
      if (url.pathname === '/oauth/authorize') {
        if (p.get('response_type') !== 'code' || p.get('client_id') !== config.clientId || p.get('redirect_uri') !== redirectUri ||
            p.get('resource') !== resource || p.get('scope') !== scope || p.get('code_challenge_method') !== 'S256' ||
            !/^[\x21-\x7e]{1,1024}$/.test(p.get('state') ?? '') || !/^[\w-]{43}$/.test(p.get('code_challenge') ?? '')) return invalid();
        prune();
        if (logins.size + consents.size >= 1024) return json(res, 503, { error: 'temporarily_unavailable' });
        const state = nonce(), browser = nonce();
        logins.set(state, { browser, expires: Date.now() + 600000, state: p.get('state')!, challenge: p.get('code_challenge')! });
        res.setHeader('Set-Cookie', cookieName + '=' + browser + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600');
        return redirect(res, upstream.authorizationUrl(state));
      }
      if (url.pathname === '/oauth/brightspace/callback') {
        prune();
        const state = p.get('state') ?? '';
        const login = logins.get(state);
        if (!login || !browserMatches(req, login)) return invalid();
        logins.delete(state);
        if (p.has('error')) return callback(res, login.state, { error: 'access_denied' });
        const code = p.get('code');
        if (!code || code.length > 8192) return invalid();
        if (exchanges >= 16) return callback(res, login.state, { error: 'temporarily_unavailable' });
        exchanges++;
        try {
          const tokens = await upstream.exchangeCode(code);
          const account = requireId(await upstream.verifyAccount(tokens.accessToken));
          if (login.expires <= Date.now()) return invalid();
          const proof = nonce();
          consents.set(proof, { ...login, tokens, account });
          return consentPage(res, proof, account);
        } catch { return callback(res, login.state, { error: 'access_denied' }); }
        finally { exchanges--; }
      }
    }
    if (url.pathname === '/mcp') {
      if (url.search) return invalid();
      if (req.headers.origin !== undefined && ![origin, 'https://chatgpt.com'].includes(req.headers.origin))
        return json(res, 403, { error: 'access_denied' });
      const bearer = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(req.headers.authorization ?? '')?.[1];
      const grant = bearer && grants.authenticate(bearer);
      if (!grant) {
        res.setHeader('WWW-Authenticate', authChallenge);
        return json(res, 401, { error: 'invalid_token' });
      }
      if (mcpRequests >= 16) return json(res, 429, { error: 'temporarily_unavailable' });
      mcpRequests++;
      try {
        await handleMcp(req, res, schoolRegistry(dataDir, grant.account, grant.tokens, authChallenge, fetchImpl), [origin, 'https://chatgpt.com']);
      } finally { mcpRequests--; }
      return;
    }
    if (method !== 'POST' || !['/oauth/consent','/oauth/token','/oauth/revoke'].includes(url.pathname))
      return json(res, 404, { error: 'not_found' });
    if (url.search) return invalid();
    if (url.pathname === '/oauth/consent') {
      if (req.headers.origin !== origin) return json(res, 403, { error: 'access_denied' });
      const body = await form(req);
      const proof = body?.get('proof') ?? '';
      const consent = consents.get(proof);
      if (!consent || consent.expires <= Date.now() || !browserMatches(req, consent)) return invalid();
      const decision = body?.get('decision');
      if (decision !== 'allow' && decision !== 'deny') return invalid();
      consents.delete(proof);
      if (decision === 'deny') return callback(res, consent.state, { error: 'access_denied' });
      return callback(res, consent.state, { code: grants.createCode(consent.account, consent.tokens, consent.challenge) });
    }
    if (!equal(req.headers.authorization ?? '', basic)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Brightspace Study"');
      return json(res, 401, { error: 'invalid_client' });
    }
    const body = await form(req);
    if (!body || body.has('client_secret') || (body.has('client_id') && body.get('client_id') !== config.clientId)) return invalid();
    if (url.pathname === '/oauth/revoke') {
      if (!body.get('token')) return invalid();
      grants.revoke(body.get('token')!);
      return json(res, 200, {});
    }
    if (body.has('resource') && body.get('resource') !== resource) return json(res, 400, { error: 'invalid_target' });
    if (body.has('scope') && body.get('scope') !== scope) return json(res, 400, { error: 'invalid_scope' });
    const grantType = body.get('grant_type');
    let result;
    if (grantType === 'authorization_code') {
      if (body.get('redirect_uri') !== redirectUri) return invalid();
      result = await grants.redeem(body.get('code') ?? '', body.get('code_verifier') ?? '');
    } else if (grantType === 'refresh_token') {
      if (exchanges >= 16) return json(res, 503, { error: 'temporarily_unavailable' });
      exchanges++;
      try { result = await grants.rotate(body.get('refresh_token') ?? ''); }
      finally { exchanges--; }
    } else return json(res, 400, { error: 'unsupported_grant_type' });
    if (!result) return json(res, 400, { error: 'invalid_grant' });
    json(res, 200, result);
  }
  const server = createServer({ maxHeaderSize: 16384, headersTimeout: 10000, requestTimeout: 30000 }, (req, res) => {
    void route(req, res).catch(() => {
      if (res.headersSent) return res.destroy();
      json(res, 500, { error: 'server_error' });
    });
  });
  const cleanup = setInterval(prune, 60000).unref();
  server.on('close', () => { clearInterval(cleanup); logins.clear(); consents.clear(); grants.clear(); });
  return server;
}
