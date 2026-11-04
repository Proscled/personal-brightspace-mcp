import { AppError } from './types.js';
const folderRubricsPath = /^\/d2l\/api\/le\/\d+\.\d+\/[1-9]\d*\/rubrics\/$/;
const attachmentPath = /^\/d2l\/api\/le\/\d+\.\d+\/[1-9]\d*\/(?:dropbox\/folders|news)\/[1-9]\d*\/attachments\/[1-9]\d*$/;
const allowedApiPaths = [
    attachmentPath, folderRubricsPath,
    /^\/d2l\/api\/versions\/$/,
    /^\/d2l\/api\/lp\/\d+\.\d+\/users\/whoami\/?$/,
    /^\/d2l\/api\/lp\/\d+\.\d+\/enrollments\/myenrollments\/$/,
    /^\/d2l\/api\/le\/\d+\.\d+\/[1-9]\d*\/dropbox\/folders\/$/,
    /^\/d2l\/api\/le\/\d+\.\d+\/[1-9]\d*\/dropbox\/folders\/[1-9]\d*\/submissions\/mysubmissions\/$/,
    /^\/d2l\/api\/le\/\d+\.\d+\/[1-9]\d*\/news\/$/,
    /^\/d2l\/api\/le\/\d+\.\d+\/[1-9]\d*\/grades\/values\/myGradeValues\/$/,
    /^\/d2l\/api\/le\/\d+\.\d+\/[1-9]\d*\/calendar\/events\/myEvents\/$/,
    /^\/d2l\/api\/le\/\d+\.\d+\/[1-9]\d*\/content\/toc$/,
    /^\/d2l\/api\/le\/\d+\.\d+\/[1-9]\d*\/content\/topics\/[1-9]\d*(?:\/file)?$/,
    /^\/d2l\/api\/le\/\d+\.\d+\/[1-9]\d*\/quizzes\/$/,
];
const allowedQueryKeys = new Set(['orgUnitTypeId', 'isActive', 'canAccess', 'bookmark', 'pageSize', 'pageNumber', 'startDateTime', 'endDateTime']);
export function safeApiUrl(origin, input, base = origin) {
    // Check the raw path before URL normalization can resolve traversal. Opaque
    // bookmark values may legitimately contain encoded slashes and periods.
    const rawPath = input.split(/[?#]/, 1)[0];
    if (/[\r\n\t]/.test(input) || /\\|%(?:2f|5c|2e)|(?:^|\/)\.\.(?:\/|$)/i.test(rawPath))
        throw new AppError('UNSAFE_URL', 'Encoded paths, backslashes and path traversal are not allowed.');
    let url;
    try {
        url = new URL(input, base);
    }
    catch {
        throw new AppError('UNSAFE_URL', 'Invalid API URL.');
    }
    if (url.origin !== origin || url.username || url.password || url.hash || !allowedApiPaths.some(re => re.test(url.pathname)))
        throw new AppError('UNSAFE_URL', 'This server only reads approved Brightspace API routes on the configured school origin.');
    if (folderRubricsPath.test(url.pathname)) {
        if (url.searchParams.size !== 2 || url.searchParams.get('objectType') !== 'Dropbox' ||
            !/^[1-9]\d{0,17}$/.test(url.searchParams.get('objectId') ?? ''))
            throw new AppError('UNSAFE_URL', 'Rubrics can only be read for a specific assignment.');
        return url;
    }
    if (attachmentPath.test(url.pathname) && url.search)
        throw new AppError('UNSAFE_URL', 'Attachment downloads do not accept query parameters.');
    const seen = new Set();
    for (const key of url.searchParams.keys()) {
        if (!allowedQueryKeys.has(key) || seen.has(key))
            throw new AppError('UNSAFE_URL', 'An unsupported or repeated API query parameter was blocked.');
        seen.add(key);
    }
    return url;
}
export function safeNextPage(origin, current, next) {
    const url = safeApiUrl(origin, next, current.href);
    if (url.pathname !== current.pathname)
        throw new AppError('UNSAFE_URL', 'A pagination link tried to change API routes.');
    // A pagination URL must not change the original filters or time range.
    const keys = new Set([...current.searchParams.keys(), ...url.searchParams.keys()]);
    for (const key of keys) {
        if (!['bookmark', 'pageSize', 'pageNumber'].includes(key) && url.searchParams.get(key) !== current.searchParams.get(key))
            throw new AppError('UNSAFE_URL', 'A pagination link changed the original filters.');
    }
    return url;
}
export function cookiesForUrl(cookies, url, now = Date.now()) {
    return cookies.filter(c => {
        const domain = c.domain.toLowerCase().replace(/^\./, '');
        const domainMatches = c.domain.startsWith('.') ? (url.hostname === domain || url.hostname.endsWith(`.${domain}`)) : url.hostname === domain;
        const path = c.path || '/';
        const pathMatches = url.pathname === path || (url.pathname.startsWith(path) && (path.endsWith('/') || url.pathname[path.length] === '/'));
        return domainMatches && pathMatches && (!c.secure || url.protocol === 'https:') &&
            (c.expires === -1 || c.expires * 1000 > now) &&
            /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(c.name) && !/[;\r\n]/.test(c.value);
    }).sort((a, b) => b.path.length - a.path.length).map(c => `${c.name}=${c.value}`).join('; ');
}
export function tenantCookies(cookies, origin) {
    const host = new URL(origin).hostname;
    return cookies.filter(c => {
        const domain = c.domain.replace(/^\./, '').toLowerCase();
        return host === domain || (c.domain.startsWith('.') && host.endsWith(`.${domain}`));
    });
}
export function cleanHeader(value) {
    if (!value || value.length > 32768 || /[\r\n]/.test(value))
        throw new AppError('AUTH', 'Malformed authentication value.');
    return value;
}
export function htmlToText(input) {
    return input.replace(/<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<!--[^]*?-->/g, '')
        .replace(/<\/(?:p|div|li|h[1-6]|tr)>|<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => {
        const code = n.startsWith('x') || n.startsWith('X') ? parseInt(n.slice(1), 16) : Number(n);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
        .replace(/&(nbsp|amp|lt|gt|quot|apos);/g, (_, name) => ({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name] || ''))
        .replace(/[\t ]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
}
export function richText(value) {
    if (typeof value === 'string')
        return htmlToText(value);
    if (value && typeof value === 'object') {
        const r = value;
        if (typeof r.Text === 'string' && r.Text.trim())
            return r.Text;
        if (typeof r.Html === 'string')
            return htmlToText(r.Html);
    }
    return '';
}
//# sourceMappingURL=security.js.map