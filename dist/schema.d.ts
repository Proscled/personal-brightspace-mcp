import { type JsonRecord } from './types.js';
export interface Schema extends JsonRecord {
    type: string;
    properties?: Record<string, Schema>;
    required?: string[];
    items?: Schema;
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    maxItems?: number;
    pattern?: string;
    additionalProperties?: boolean;
    description?: string;
}
export declare const object: (properties: Record<string, Schema>, required?: string[]) => Schema;
export declare const string: (description: string, minLength?: number, maxLength?: number) => Schema;
export declare const integer: (description: string, minimum: number, maximum: number) => Schema;
export declare const boolean: (description: string) => Schema;
export declare const courseIdSchema: Schema;
export declare const courseIdsSchema: Schema;
export declare function validate(schema: Schema, value: unknown, path?: string): void;
