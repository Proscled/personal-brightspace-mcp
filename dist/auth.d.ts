import { type Config, type Cookie, type Session } from './types.js';
export declare function tokenExpiry(token: string): number | undefined;
export declare function loadSession(config: Config): Promise<Session | null>;
export declare function sessionHeaders(session: Session, url: URL): Record<string, string>;
export declare function authHeaders(config: Config, url: URL, env?: NodeJS.ProcessEnv): Promise<Record<string, string>>;
export declare function authStatus(config: Config): Promise<Record<string, unknown>>;
/** Credential metadata only. Cookie names/values, tokens and identity are never returned. */
export declare function sessionHealth(session: Session, now?: number): Record<string, unknown>;
/** Apply only valid, school-scoped Set-Cookie headers from a successful allowlisted GET. */
export declare function renewedCookies(cookies: Cookie[], values: string[], url: URL, now?: number): Cookie[];
export declare function saveResponseCookies(config: Config, url: URL, response: Response, sent: Record<string, string>): Promise<void>;
/** Interactive CLI only. No credentials are entered in a terminal or sent to an AI model. */
export declare function browserLogin(config: Config, rememberBrowser?: boolean): Promise<void>;
export declare function logout(config: Config): Promise<void>;
