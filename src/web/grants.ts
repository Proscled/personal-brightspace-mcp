import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { D2lOAuth, D2lTokens } from './brightspace-oauth.js';

const CODE_LIFETIME = 2 * 60_000;
const ACCESS_LIFETIME = 60 * 60_000;
const FAMILY_LIFETIME = 7 * 24 * ACCESS_LIFETIME;
const MAX_FAMILIES = 512;

export interface OAuthResponse {
  token_type: 'Bearer';
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: 'brightspace.read';
}

interface Family {
  readonly account: string;
  readonly challenge: string;
  readonly codeExpires: number;
  readonly expires: number;
  accessExpires: number;
  generation: number;
  rotating: boolean;
  tokens: D2lTokens;
}

type Kind = 'c' | 'a' | 'r';

function validTokens(tokens: D2lTokens, now: number): boolean {
  // The D2L adapter validates wire syntax. Do not keep a grant whose token already expired.
  return Boolean(tokens.accessToken) && Number.isSafeInteger(tokens.expiresAt) && tokens.expiresAt >= now + 1000;
}

function expired(family: Family, now: number): boolean {
  return now >= family.expires || (family.generation === 0 ? now >= family.codeExpires :
    !family.tokens.refreshToken && now >= family.accessExpires);
}

function matchesPkce(challenge: string, verifier: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const digest = createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return timingSafeEqual(Buffer.from(challenge), Buffer.from(digest));
}

/** Single-process grant families. An instance restart invalidates every app token and discards every D2L token. */
export class Grants {
  #key = randomBytes(32);
  #families = new Map<string, Family>();
  constructor(private readonly upstream: Pick<D2lOAuth, 'refresh' | 'verifyAccount'>) {}

  prune(now = Date.now()): void {
    for (const [id, family] of this.#families) if (expired(family, now)) this.#families.delete(id);
  }

  clear(): void { this.#families.clear(); }

  createCode(account: string, tokens: D2lTokens, challenge: string): string {
    const now = Date.now();
    this.prune(now);
    if (this.#families.size >= MAX_FAMILIES || !/^[1-9]\d{0,17}$/.test(account) ||
        !/^[A-Za-z0-9_-]{43}$/.test(challenge) || !validTokens(tokens, now)) throw new Error('Unable to create authorization grant.');
    const id = randomBytes(24).toString('base64url');
    this.#families.set(id, {
      account, challenge, tokens: { ...tokens }, codeExpires: Math.min(now + CODE_LIFETIME, tokens.expiresAt),
      expires: now + FAMILY_LIFETIME, accessExpires: 0, rotating: false, generation: 0
    });
    return this.#sign('c', id, 0);
  }

  redeem(code: string, verifier: string): OAuthResponse | undefined {
    const entry = this.#lookup(code, 'c');
    if (!entry) return;
    const { id, family } = entry;
    if (Date.now() >= family.codeExpires || !matchesPkce(family.challenge, verifier)) return;
    if (family.generation !== 0) { this.#families.delete(id); return; } // Reuse of a redeemed code with valid PKCE.
    return this.#issue(id, family);
  }

  async rotate(refresh: string): Promise<OAuthResponse | undefined> {
    const entry = this.#lookup(refresh, 'r');
    if (!entry) return;
    const { id, generation, family } = entry;
    // Every legitimately issued refresh remains recognizable by its MAC. Its reuse revokes the whole family.
    if (family.rotating || generation !== family.generation) { this.#families.delete(id); return; }
    const previous = family.tokens.refreshToken;
    if (!previous) return;
    family.rotating = true;
    try {
      const next = await this.upstream.refresh(previous);
      if (this.#families.get(id) !== family) return;
      if (!validTokens(next, Date.now()) || await this.upstream.verifyAccount(next.accessToken) !== family.account) {
        this.#families.delete(id); return;
      }
      // A replay, revoke or absolute expiry while awaiting Brightspace must never resurrect the family.
      if (this.#families.get(id) !== family) return;
      family.tokens = { ...next }; // Brightspace consumes the submitted refresh token.
      family.rotating = false;
      return this.#issue(id, family);
    } catch {
      this.#families.delete(id);
      return; // OAuth, network and parser errors may contain credentials.
    }
  }

  authenticate(bearer: string): { account: string; tokens: D2lTokens } | undefined {
    const entry = this.#lookup(bearer, 'a');
    if (!entry || entry.generation !== entry.family.generation || entry.family.rotating || Date.now() >= entry.family.accessExpires) return;
    const { account, tokens } = entry.family;
    return { account, tokens: { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt } };
  }

  revoke(token: string): void {
    const entry = this.#lookup(token, 'a') ?? this.#lookup(token, 'r');
    if (entry) this.#families.delete(entry.id);
  }

  #issue(id: string, family: Family): OAuthResponse | undefined {
    const now = Date.now();
    const lifetime = Math.floor((Math.min(now + ACCESS_LIFETIME, family.expires, family.tokens.expiresAt) - now) / 1000);
    if (lifetime <= 0) { this.#families.delete(id); return; }
    family.accessExpires = now + lifetime * 1000;
    family.generation += 1;
    return {
      token_type: 'Bearer', access_token: this.#sign('a', id, family.generation), expires_in: lifetime, scope: 'brightspace.read',
      ...(family.tokens.refreshToken ? { refresh_token: this.#sign('r', id, family.generation) } : {})
    };
  }

  // The random family ID carries no account information. Including the kind prevents token type substitution.
  #sign(kind: Kind, id: string, generation: number): string {
    const prefix = kind + '.' + id + '.' + generation;
    return prefix + '.' + createHmac('sha256', this.#key).update(prefix).digest('base64url');
  }

  #lookup(token: string, kind: Kind): { id: string; generation: number; family: Family } | undefined {
    if (typeof token !== 'string' || token.length > 100 || !/^[car]\.[\w-]{32}\.(0|[1-9]\d{0,9})\.[\w-]{43}$/.test(token)) return;
    const [type, id, index] = token.split('.');
    if (type !== kind || !id) return;
    const family = this.#families.get(id);
    if (!family) return;
    if (expired(family, Date.now())) { this.#families.delete(id); return; }
    const generation = Number(index);
    if (!timingSafeEqual(Buffer.from(this.#sign(kind, id, generation)), Buffer.from(token))) return;
    return { id, generation, family };
  }
}
