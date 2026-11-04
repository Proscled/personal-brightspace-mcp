import { AppError } from './types.js';
export function localDay(date, timezone) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    return ['year', 'month', 'day'].map(type => p.find(x => x.type === type).value).join('-');
}
function validDay(value) {
    const day = value.slice(0, 10);
    const d = new Date(`${day}T00:00:00Z`);
    return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === day;
}
export function describeDate(value, timezone) {
    if (typeof value !== 'string' || !value)
        return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) && validDay(value))
        return { raw: value, iso: null, local: `${value} (time not provided)`, dateOnly: true, timezone };
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !validDay(value) || !Number.isFinite(Date.parse(value)))
        return { raw: value, iso: null, local: value, dateOnly: false, timezone, invalid: true };
    const date = new Date(value);
    return { raw: value, iso: date.toISOString(), local: new Intl.DateTimeFormat('en-GB', {
            timeZone: timezone, dateStyle: 'full', timeStyle: 'short'
        }).format(date), dateOnly: false, timezone };
}
export function dateInRange(date, start, end) {
    if (date.invalid)
        return false;
    if (date.dateOnly)
        return date.raw >= localDay(start, date.timezone) && date.raw <= localDay(new Date(end.valueOf() - 1), date.timezone);
    return Date.parse(date.iso) >= start.valueOf() && Date.parse(date.iso) < end.valueOf();
}
export function parseWindow(start, end, daysAhead = 14, now = new Date()) {
    const parse = (value) => {
        const d = describeDate(value, 'UTC');
        if (!d?.iso || d.invalid)
            throw new AppError('INVALID_ARGUMENT', 'Window boundaries must be full ISO timestamps with a timezone, for example 2026-11-01T00:00:00+01:00.');
        return new Date(d.iso);
    };
    const a = start ? parse(start) : now;
    const b = end ? parse(end) : new Date(a.valueOf() + daysAhead * 86400000);
    if (a >= b || b.valueOf() - a.valueOf() > 366 * 86400000)
        throw new AppError('INVALID_ARGUMENT', 'Use a positive time window no longer than 366 days.');
    return { start: a, end: b };
}
//# sourceMappingURL=dates.js.map