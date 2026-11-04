export declare const HHS_ORIGIN = "https://brightspace.hhs.nl";
export declare const D2L_SCOPES: string;
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
export declare class D2lOAuth {
    #private;
    private readonly fetchImpl;
    constructor(registration: ClientRegistration, fetchImpl?: typeof fetch);
    authorizationUrl(state: string): string;
    exchangeCode(code: string): Promise<D2lTokens>;
    refresh(refreshToken: string): Promise<D2lTokens>;
    private requestTokens;
    verifyAccount(accessToken: string): Promise<string>;
}
export {};
