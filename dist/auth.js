import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { AppError, array, id, record, text } from './types.js';
import { cleanHeader, cookiesForUrl, tenantCookies } from './security.js';
import { privateDir, readPrivateJson, withLock, writePrivateJson } from './storage.js';
export function tokenExpiry(token) {
    // This is only an expiry hint; JWT parsing is NOT signature verification.
    try {
        const payload = record(JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8')));
        return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp * 1000 : undefined;
    }
    catch {
        return undefined;
    }
}
export async function loadSession(config) {
    const raw = await readPrivateJson(join(config.dataDir, 'session.json'), 1024 * 1024);
    if (!raw)
        return null;
    const r = record(raw);
    if (r.format !== 1 || r.origin !== config.baseUrl || typeof r.accountId !== 'string' || !Array.isArray(r.cookies))
        throw new AppError('AUTH', 'Saved session belongs to another school or is invalid. Run login again.');
    const cookies = array(r.cookies).map(item => {
        const c = record(item);
        if (typeof c.name !== 'string' || typeof c.value !== 'string' || typeof c.domain !== 'string' ||
            typeof c.path !== 'string' || typeof c.expires !== 'number' || typeof c.secure !== 'boolean')
            throw new AppError('AUTH', 'Saved session contains an invalid cookie. Run login again.');
        return c;
    });
    return { format: 1, origin: config.baseUrl, accountId: r.accountId, createdAt: String(r.createdAt),
        cookies: tenantCookies(cookies, config.baseUrl), bearerToken: text(r.bearerToken) ?? undefined,
        bearerExpiresAt: typeof r.bearerExpiresAt === 'number' ? r.bearerExpiresAt : undefined,
        csrfToken: text(r.csrfToken) ?? undefined };
}
export function sessionHeaders(session, url) {
    if (url.origin !== session.origin)
        throw new AppError('AUTH', 'Refusing to send credentials to another origin.');
    const headers = {};
    const cookie = cookiesForUrl(session.cookies, url);
    if (cookie)
        headers.Cookie = cookie;
    if (session.bearerToken && (!session.bearerExpiresAt || session.bearerExpiresAt > Date.now() + 30000))
        headers.Authorization = `Bearer ${cleanHeader(session.bearerToken)}`;
    if (session.csrfToken)
        headers['X-Csrf-Token'] = cleanHeader(session.csrfToken);
    if (!headers.Cookie && !headers.Authorization)
        throw new AppError('AUTH_REQUIRED', 'Your session expired. Run: node dist/index.js login');
    return headers;
}
export async function authHeaders(config, url, env = process.env) {
    if (url.origin !== config.baseUrl)
        throw new AppError('AUTH', 'Credentials may only be sent to your configured school.');
    if (env.BRIGHTSPACE_ACCESS_TOKEN)
        return { Authorization: `Bearer ${cleanHeader(env.BRIGHTSPACE_ACCESS_TOKEN)}` };
    const session = await loadSession(config);
    if (!session)
        throw new AppError('AUTH_REQUIRED', 'Sign in locally with: node dist/index.js login. Alternatively provide an officially issued BRIGHTSPACE_ACCESS_TOKEN.');
    return sessionHeaders(session, url);
}
export async function authStatus(config) {
    if (process.env.BRIGHTSPACE_ACCESS_TOKEN) {
        const expires = tokenExpiry(process.env.BRIGHTSPACE_ACCESS_TOKEN);
        return { mode: 'oauth-access-token', configured: true, expiryHint: expires ? new Date(expires).toISOString() : null, verified: false };
    }
    const session = await loadSession(config);
    return { mode: 'browser-session', configured: Boolean(session), createdAt: session?.createdAt ?? null,
        ...(session ? sessionHealth(session) : {}), verified: false };
}
/** Credential metadata only. Cookie names/values, tokens and identity are never returned. */
export function sessionHealth(session, now = Date.now()) {
    const expiry = session.bearerExpiresAt ?? (session.bearerToken ? tokenExpiry(session.bearerToken) : undefined);
    return {
        bearer: !session.bearerToken ? 'absent' : expiry === undefined ? 'expiry_unknown' : expiry <= now + 30000 ? 'expired' : 'locally_valid',
        bearerExpiresAt: expiry !== undefined && Number.isFinite(expiry) && Math.abs(expiry) <= 8640000000000000 ? new Date(expiry).toISOString() : null,
        apiCookiesAvailable: Boolean(cookiesForUrl(session.cookies, new URL('/d2l/api/versions/', session.origin), now)),
        cookieRotation: true,
        automaticRenewal: false,
        note: 'Local expiry hints do not prove that the school still accepts a session.'
    };
}
/** Apply only valid, school-scoped Set-Cookie headers from a successful allowlisted GET. */
export function renewedCookies(cookies, values, url, now = Date.now()) {
    const result = [...cookies];
    for (const value of values.slice(0, 64)) {
        if (value.length > 4096 || /[\r\n]/.test(value))
            continue;
        const [pair, ...attributes] = value.split(';');
        const equals = pair.indexOf('=');
        if (equals <= 0)
            continue;
        const candidate = { name: pair.slice(0, equals).trim(), value: pair.slice(equals + 1).trim(),
            domain: url.hostname, path: url.pathname.slice(0, url.pathname.lastIndexOf('/')) || '/', expires: -1, secure: false };
        let maxAge;
        for (const attribute of attributes) {
            const index = attribute.indexOf('='), key = (index < 0 ? attribute : attribute.slice(0, index)).trim().toLowerCase();
            const data = index < 0 ? '' : attribute.slice(index + 1).trim();
            if (key === 'domain')
                candidate.domain = '.' + data.toLowerCase().replace(/^\./, '');
            if (key === 'path' && data.startsWith('/'))
                candidate.path = data;
            if (key === 'secure')
                candidate.secure = true;
            if (key === 'httponly')
                candidate.httpOnly = true;
            if (key === 'samesite' && /^(strict|lax|none)$/i.test(data))
                candidate.sameSite = data[0].toUpperCase() + data.slice(1).toLowerCase();
            if (key === 'expires' && Number.isFinite(Date.parse(data)))
                candidate.expires = Date.parse(data) / 1000;
            if (key === 'max-age' && /^-?\d+$/.test(data) && Number.isSafeInteger(Number(data)))
                maxAge = Number(data);
        }
        if (maxAge !== undefined)
            candidate.expires = maxAge <= 0 ? 0 : now / 1000 + maxAge;
        if (!tenantCookies([candidate], url.origin).length || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(candidate.name) || /[;\r\n]/.test(candidate.value))
            continue;
        const same = (c) => c.name === candidate.name && c.path === candidate.path &&
            c.domain.toLowerCase().replace(/^\./, '') === candidate.domain.replace(/^\./, '');
        // Respect cookie prefix rules; a malformed replacement must not delete an existing cookie.
        if (candidate.name.startsWith('__Secure-') && !candidate.secure)
            continue;
        if (candidate.name.startsWith('__Host-') && (!candidate.secure || candidate.path !== '/' || candidate.domain.startsWith('.')))
            continue;
        const index = result.findIndex(same);
        if (index >= 0)
            result.splice(index, 1);
        if (candidate.expires === -1 || candidate.expires * 1000 > now)
            result.push(candidate);
    }
    return result;
}
export async function saveResponseCookies(config, url, response, sent) {
    if (process.env.BRIGHTSPACE_ACCESS_TOKEN || !response.ok || url.origin !== config.baseUrl)
        return;
    const values = response.headers.getSetCookie();
    if (!values.length)
        return;
    await withLock(join(config.dataDir, 'auth-lock'), async () => {
        const session = await loadSession(config);
        if (!session)
            return; // A concurrent logout must not resurrect credentials.
        const current = sessionHeaders(session, url);
        if (current.Cookie !== sent.Cookie || current.Authorization !== sent.Authorization)
            return;
        const cookies = renewedCookies(session.cookies, values, url);
        if (JSON.stringify(cookies) !== JSON.stringify(session.cookies))
            await writePrivateJson(join(config.dataDir, 'session.json'), { ...session, cookies });
    });
}
/** Interactive CLI only. No credentials are entered in a terminal or sent to an AI model. */
export async function browserLogin(config, rememberBrowser = false) {
    if (!process.stdin.isTTY)
        throw new AppError('AUTH', 'Run login yourself in an interactive terminal, not through an MCP tool.');
    let chromium;
    try {
        ({ chromium } = await import('playwright-core'));
    }
    catch {
        throw new AppError('DEPENDENCY', 'Browser login needs the optional dependency. Run npm install, then retry.');
    }
    console.error('A separate Chrome window will open. Sign in to your school yourself, including MFA.');
    if (rememberBrowser)
        console.error('This dedicated private browser profile remembers school and SSO sign-in locally. School expiry and MFA policies still apply.');
    console.error('After API verification, sensitive session data will be saved locally, unencrypted, with owner-only file permissions.');
    console.error('Open a course in Brightspace, return here, then press Enter. Do not paste a password or token.');
    let browser;
    let context;
    try {
        const executablePath = process.env.BRIGHTSPACE_BROWSER_PATH;
        const options = { headless: false, ...(executablePath ? { executablePath } : { channel: 'chrome' }) };
        if (rememberBrowser) {
            const profile = join(config.dataDir, 'login-browser');
            await privateDir(profile);
            context = await chromium.launchPersistentContext(profile, options);
        }
        else {
            browser = await chromium.launch(options);
            context = await browser.newContext();
        }
    }
    catch {
        throw new AppError('BROWSER', 'Could not open Google Chrome. Install Chrome, or set BRIGHTSPACE_BROWSER_PATH to your Chrome/Chromium executable.');
    }
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
        let bearerToken;
        let csrfToken;
        // Only observe auth headers Brightspace itself sends to its own API.
        // Never inspect SSO form bodies, ID-provider tokens or another website's requests.
        const pendingHeaders = new Set();
        const captureHeaders = (request) => {
            let url;
            try {
                url = new URL(request.url());
            }
            catch {
                return;
            }
            if (url.origin !== config.baseUrl || !url.pathname.startsWith('/d2l/api/'))
                return;
            // headers() can omit security-sensitive headers. Read the full set, without
            // logging or returning it, and wait for in-flight captures before saving.
            const pending = request.allHeaders().then(headers => {
                const authorization = headers.authorization;
                if (authorization?.startsWith('Bearer '))
                    bearerToken = authorization.slice(7);
                if (headers['x-csrf-token'])
                    csrfToken = headers['x-csrf-token'];
            }).catch(() => { });
            pendingHeaders.add(pending);
            void pending.finally(() => pendingHeaders.delete(pending));
        };
        context.on('request', captureHeaders);
        const page = await context.newPage();
        await page.goto(`${config.baseUrl}/d2l/home`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await rl.question('After Brightspace has loaded and you have opened a course, press Enter: ');
        context.off('request', captureHeaders);
        await Promise.allSettled([...pendingHeaders]);
        const onSchool = context.pages().some(p => {
            try {
                return new URL(p.url()).origin === config.baseUrl;
            }
            catch {
                return false;
            }
        });
        if (!onSchool)
            throw new AppError('AUTH', 'No school page is open. Complete the sign-in, then run login again.');
        const cookies = tenantCookies(await context.cookies(), config.baseUrl);
        if (!cookies.length && !bearerToken)
            throw new AppError('AUTH', 'No school session was available. Complete the sign-in and retry.');
        const candidate = { format: 1, origin: config.baseUrl, createdAt: new Date().toISOString(),
            accountId: '', cookies, bearerToken, bearerExpiresAt: bearerToken ? tokenExpiry(bearerToken) : undefined, csrfToken };
        // Import lazily to avoid an auth/client import cycle at module initialization.
        const { BrightspaceClient } = await import('./client.js');
        const client = new BrightspaceClient(config, { getHeaders: async (url) => sessionHeaders(candidate, url) });
        const who = record(await client.json(await client.path('lp', 'users/whoami')));
        const accountId = id(who.Identifier);
        if (!accountId)
            throw new AppError('AUTH', 'Sign-in did not return a recognizable Brightspace identity; no session was saved.');
        candidate.accountId = accountId;
        await withLock(join(config.dataDir, 'auth-lock'), () => writePrivateJson(join(config.dataDir, 'session.json'), candidate));
        console.error('Verified your Brightspace API identity and saved a private local session.');
        console.error('Session data is sensitive and is stored unencrypted with owner-only file permissions. Do not share it.');
    }
    finally {
        rl.close();
        await context.close();
        await browser?.close();
    }
}
export async function logout(config) {
    await withLock(join(config.dataDir, 'auth-lock'), async () => {
        await rm(join(config.dataDir, 'session.json'), { force: true });
        await rm(join(config.dataDir, 'login-browser'), { recursive: true, force: true });
    });
    console.error('Removed the local session. This does not revoke the school session or any OAuth token; clear BRIGHTSPACE_ACCESS_TOKEN separately.');
}
//# sourceMappingURL=auth.js.map