import { type IncomingMessage, type ServerResponse } from 'node:http';
import type { D2lOAuth } from './brightspace-oauth.js';
export interface WebConfig {
    origin: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
    dataDir: string;
}
type Upstream = Pick<D2lOAuth, 'authorizationUrl' | 'exchangeCode' | 'refresh' | 'verifyAccount'>;
export declare function createWebServer(config: WebConfig, upstream: Upstream, fetchImpl?: typeof fetch): import("http").Server<typeof IncomingMessage, typeof ServerResponse>;
export {};
