import { type Config } from './types.js';
export declare function validateOrigin(input: string): string;
export declare function buildConfig(input: Record<string, unknown>, env?: NodeJS.ProcessEnv): Config;
export declare function loadConfig(env?: NodeJS.ProcessEnv): Promise<Config>;
