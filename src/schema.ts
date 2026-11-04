import { AppError, record, type JsonRecord } from './types.js';
export interface Schema extends JsonRecord {
  type: string; properties?: Record<string, Schema>; required?: string[]; items?: Schema;
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number; maxItems?: number; pattern?: string;
  additionalProperties?: boolean; description?: string;
}
export const object = (properties: Record<string, Schema>, required: string[] = []): Schema =>
  ({ type: 'object', properties, required, additionalProperties: false });
export const string = (description: string, minLength = 1, maxLength = 300): Schema => ({ type: 'string', description, minLength, maxLength });
export const integer = (description: string, minimum: number, maximum: number): Schema => ({ type: 'integer', description, minimum, maximum });
export const boolean = (description: string): Schema => ({ type: 'boolean', description });
export const courseIdSchema: Schema = { ...string('Brightspace course/org unit ID', 1, 18), pattern: '^[1-9][0-9]{0,17}$' };
export const courseIdsSchema: Schema = { type: 'array', description: 'Optional subset of your accessible courses.', items: courseIdSchema, maxItems: 30 };
export function validate(schema: Schema, value: unknown, path = 'arguments'): void {
  const fail = (reason: string): never => { throw new AppError('INVALID_ARGUMENT', `${path}: ${reason}`); };
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('must be an object');
    const r = record(value);
    for (const key of schema.required ?? []) if (!(key in r)) fail(`missing ${key}`);
    for (const [key, item] of Object.entries(r)) {
      const child = Object.hasOwn(schema.properties ?? {}, key) ? schema.properties![key] : undefined;
      if (!child) { if (schema.additionalProperties === false) fail(`unsupported property ${key}`); }
      else validate(child, item, `${path}.${key}`);
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') fail('must be a string');
    const s = value as string;
    if (schema.minLength !== undefined && s.length < schema.minLength) fail('is too short');
    if (schema.maxLength !== undefined && s.length > schema.maxLength) fail('is too long');
    if (schema.pattern && !new RegExp(schema.pattern).test(s)) fail('has an invalid format');
  } else if (schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail('must be an integer');
    const n = value as number;
    if (schema.minimum !== undefined && n < schema.minimum) fail(`must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && n > schema.maximum) fail(`must be <= ${schema.maximum}`);
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') fail('must be a boolean');
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) fail('must be an array');
    const a = value as unknown[];
    if (schema.maxItems !== undefined && a.length > schema.maxItems) fail('contains too many items');
    if (schema.items) a.forEach((x, i) => validate(schema.items!, x, `${path}[${i}]`));
  } else fail('unsupported schema');
}
