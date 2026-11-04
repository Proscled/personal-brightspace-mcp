export function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value : {};
}
export function array(value) { return Array.isArray(value) ? value : []; }
export function text(value) {
    return typeof value === 'string' ? value : null;
}
export function id(value) {
    const result = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : text(value);
    return result && /^[1-9]\d{0,17}$/.test(result) ? result : null;
}
export function requireId(value, name = 'ID') {
    const result = id(value);
    if (!result)
        throw new AppError('INVALID_ARGUMENT', `${name} must be a positive decimal ID.`);
    return result;
}
export class AppError extends Error {
    code;
    status;
    constructor(code, message, status) {
        super(message);
        this.code = code;
        this.status = status;
        this.name = 'AppError';
    }
}
export function safeError(error) {
    if (error instanceof AppError)
        return { code: error.code, message: error.message, status: error.status };
    // Never forward fetch/library error bodies: they can contain cookies, tokens or school data.
    return { code: 'INTERNAL_ERROR', message: 'The operation failed. Run the local doctor command; do not share credentials or raw session files.' };
}
//# sourceMappingURL=types.js.map