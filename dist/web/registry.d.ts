import { ToolRegistry } from '../tools.js';
import { type D2lTokens } from './brightspace-oauth.js';
export declare function schoolRegistry(dataDir: string, account: string, tokens: D2lTokens, authChallenge: string, fetchImpl?: typeof fetch): ToolRegistry;
