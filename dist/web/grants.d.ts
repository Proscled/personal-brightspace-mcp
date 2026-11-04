import type { D2lOAuth, D2lTokens } from './brightspace-oauth.js';
export interface OAuthResponse {
    token_type: 'Bearer';
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope: 'brightspace.read';
}
/** Single-process grant families. An instance restart invalidates every app token and discards every D2L token. */
export declare class Grants {
    #private;
    private readonly upstream;
    constructor(upstream: Pick<D2lOAuth, 'refresh' | 'verifyAccount'>);
    prune(now?: number): void;
    clear(): void;
    createCode(account: string, tokens: D2lTokens, challenge: string): string;
    redeem(code: string, verifier: string): OAuthResponse | undefined;
    rotate(refresh: string): Promise<OAuthResponse | undefined>;
    authenticate(bearer: string): {
        account: string;
        tokens: D2lTokens;
    } | undefined;
    revoke(token: string): void;
}
