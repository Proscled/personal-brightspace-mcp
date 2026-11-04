import { AppError, record } from './types.js';
export const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const string = (description, minLength = 1, maxLength = 300) => ({ type: 'string', description, minLength, maxLength });
export const integer = (description, minimum, maximum) => ({ type: 'integer', description, minimum, maximum });
export const boolean = (description) => ({ type: 'boolean', description });
export const courseIdSchema = { ...string('Brightspace course/org unit ID', 1, 18), pattern: '^[1-9][0-9]{0,17}$' };
export const courseIdsSchema = { type: 'array', description: 'Optional subset of your accessible courses.', items: courseIdSchema, maxItems: 30 };
export function validate(schema, value, path = 'arguments') {
    const fail = (reason) => { throw new AppError('INVALID_ARGUMENT', `${path}: ${reason}`); };
    if (schema.type === 'object') {
        if (value === null || typeof value !== 'object' || Array.isArray(value))
            fail('must be an object');
        const r = record(value);
        for (const key of schema.required ?? [])
            if (!(key in r))
                fail(`missing ${key}`);
        for (const [key, item] of Object.entries(r)) {
            const child = Object.hasOwn(schema.properties ?? {}, key) ? schema.properties[key] : undefined;
            if (!child) {
                if (schema.additionalProperties === false)
                    fail(`unsupported property ${key}`);
            }
            else
                validate(child, item, `${path}.${key}`);
        }
    }
    else if (schema.type === 'string') {
        if (typeof value !== 'string')
            fail('must be a string');
        const s = value;
        if (schema.minLength !== undefined && s.length < schema.minLength)
            fail('is too short');
        if (schema.maxLength !== undefined && s.length > schema.maxLength)
            fail('is too long');
        if (schema.pattern && !new RegExp(schema.pattern).test(s))
            fail('has an invalid format');
    }
    else if (schema.type === 'integer') {
        if (typeof value !== 'number' || !Number.isSafeInteger(value))
            fail('must be an integer');
        const n = value;
        if (schema.minimum !== undefined && n < schema.minimum)
            fail(`must be >= ${schema.minimum}`);
        if (schema.maximum !== undefined && n > schema.maximum)
            fail(`must be <= ${schema.maximum}`);
    }
    else if (schema.type === 'boolean') {
        if (typeof value !== 'boolean')
            fail('must be a boolean');
    }
    else if (schema.type === 'array') {
        if (!Array.isArray(value))
            fail('must be an array');
        const a = value;
        if (schema.maxItems !== undefined && a.length > schema.maxItems)
            fail('contains too many items');
        if (schema.items)
            a.forEach((x, i) => validate(schema.items, x, `${path}[${i}]`));
    }
    else
        fail('unsupported schema');
}
//# sourceMappingURL=schema.js.map