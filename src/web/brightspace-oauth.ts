import { BrightspaceClient } from '../client.js';
import { buildConfig } from '../config.js';
import { SchoolService } from '../service.js';
import { AppError, record, requireId } from '../types.js';

export const HHS_ORIGIN = 'https://brightspace.hhs.nl';
const authorizationEndpoint = 'https://auth.brightspace.com/oauth2/auth';
const tokenEndpoint = 'https://auth.brightspace.com/core/connect/token';
export const D2L_SCOPES = [
  'users:own_profile:read', 'enrollment:own_enrollment:read', 'dropbox:folders:read',
  'rubrics:objects:read', 'news:newsitems:read', 'grades:own_grades:read', 'calendar:my_events:read',
  'content:toc:read', 'content:topics:readonly', 'content:file:read', 'quizzing:quizzes:read'
].join(' ');

export interface D2lTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}
interface ClientRegistration {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function opaque(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/[^!-~]/.test(value);
}
function bearer(value: unknown): value is string {
  return opaque(value) && /^[a-zA-Z0-9._~+/-]+=*$/.test(value);
}
function failure(): AppError {
  return new AppError('D2L_OAUTH', 'Brightspace could not complete authorization. Reconnect or ask the operator to check the registered app.');
}
async function readTokenResponse(response: Response): Promise<D2lTokens> {
  const limit = 64 * 1024;
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw failure();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw failure(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = record(JSON.parse(Buffer.concat(chunks, total).toString('utf8')));
  if (!bearer(data.access_token) || typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer' ||
      typeof data.expires_in !== 'number' || !Number.isSafeInteger(data.expires_in) || data.expires_in <= 0 ||
      !Number.isSafeInteger(Date.now() + data.expires_in * 1000) ||
      (data.refresh_token !== undefined && !opaque(data.refresh_token))) throw failure();
  if (data.scope !== undefined && (typeof data.scope !== 'string' ||
      data.scope.split(' ').some(scope => !D2L_SCOPES.split(' ').includes(scope)))) throw failure();
  return {
    accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000,
    ...(data.refresh_token !== undefined && { refreshToken: data.refresh_token })
  };
}

// The registration belongs to HHS. This adapter holds no user session or tokens.
export class D2lOAuth {
  #registration: Readonly<ClientRegistration>;
  constructor(registration: ClientRegistration, private readonly fetchImpl: typeof fetch = globalThis.fetch) {
    let uri: URL;
    try { uri = new URL(registration.redirectUri); } catch { throw new AppError('CONFIG', 'Invalid D2L OAuth callback URL.'); }
    if (uri.protocol !== 'https:' || uri.username || uri.password || uri.hash || uri.search ||
        uri.href !== registration.redirectUri || !opaque(registration.clientId) || !opaque(registration.clientSecret))
      throw new AppError('CONFIG', 'Configure the approved D2L client registration and its exact HTTPS callback URL.');
    this.#registration = { ...registration };
  }

  authorizationUrl(state: string): string {
    if (!opaque(state)) throw failure();
    const url = new URL(authorizationEndpoint);
    url.search = new URLSearchParams({
      response_type: 'code', client_id: this.#registration.clientId,
      redirect_uri: this.#registration.redirectUri, scope: D2L_SCOPES, state
    }).toString();
    return url.href;
  }
  exchangeCode(code: string): Promise<D2lTokens> {
    return this.requestTokens({ grant_type: 'authorization_code', code, redirect_uri: this.#registration.redirectUri }, code);
  }
  refresh(refreshToken: string): Promise<D2lTokens> {
    return this.requestTokens({ grant_type: 'refresh_token', refresh_token: refreshToken }, refreshToken);
  }

  private async requestTokens(parameters: Record<string, string>, grant: string): Promise<D2lTokens> {
    if (!opaque(grant)) throw failure();
    // RFC 6749 §2.3.1 encodes each part of the Basic credential as a form component.
    const encode = (part: string) => new URLSearchParams({ v: part }).toString().slice(2);
    const basic = Buffer.from(encode(this.#registration.clientId) + ':' + encode(this.#registration.clientSecret)).toString('base64');
    try {
      const response = await this.fetchImpl(tokenEndpoint, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
        headers: { Authorization: 'Basic ' + basic, Accept: 'application/json' },
        body: new URLSearchParams(parameters)
      });
      return await readTokenResponse(response);
    } catch {
      // OAuth errors, network exceptions and JSON parser messages may contain credentials.
      throw failure();
    }
  }

  async verifyAccount(accessToken: string): Promise<string> {
    if (!bearer(accessToken)) throw failure();
    const config = buildConfig({ baseUrl: HHS_ORIGIN, retries: 0, requestSpacingMs: 0, maxResponseBytes: 65536 }, {});
    const client = new BrightspaceClient(config, {
      fetchImpl: this.fetchImpl, getHeaders: async () => ({ Authorization: 'Bearer ' + accessToken })
    });
    const who = await new SchoolService(client).whoami();
    return requireId(who.identifier);
  }
}
