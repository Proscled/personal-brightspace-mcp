import { setTimeout as sleep } from 'node:timers/promises';
import { authHeaders, saveResponseCookies } from './auth.js';
import { safeApiUrl, safeNextPage } from './security.js';
import { AppError, array, record, text } from './types.js';
export function retryDelay(value, attempt, now = Date.now()) {
    if (value) {
        const seconds = Number(value);
        const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
        if (Number.isFinite(delay) && delay >= 0)
            return Math.min(60000, delay);
    }
    return Math.min(10000, 500 * 2 ** attempt);
}
export class BrightspaceClient {
    config;
    fetchImpl;
    getHeaders;
    wait;
    versions;
    persistCookies;
    queue = Promise.resolve();
    constructor(config, options = {}) {
        this.config = config;
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
        this.getHeaders = options.getHeaders ?? (url => authHeaders(config, url));
        this.persistCookies = !options.getHeaders;
        this.wait = options.sleepImpl ?? sleep;
    }
    async discoverVersions() {
        if (this.config.lpVersion && this.config.leVersion)
            return { lp: this.config.lpVersion, le: this.config.leVersion };
        if (!this.versions) {
            this.versions = (async () => {
                const data = await this.json('/d2l/api/versions/');
                if (!Array.isArray(data))
                    throw new AppError('API_SHAPE', 'API version discovery returned an unexpected format.');
                const get = (code) => {
                    const block = data.map(record).find(x => String(x.ProductCode).toLowerCase() === code);
                    const latest = text(block?.LatestVersion);
                    if (latest && /^\d+\.\d+$/.test(latest))
                        return latest;
                    const supported = array(block?.SupportedVersions).filter((x) => typeof x === 'string' && /^\d+\.\d+$/.test(x));
                    supported.sort((a, b) => {
                        const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
                        return (bb[0] - aa[0]) || (bb[1] - aa[1]);
                    });
                    if (supported[0])
                        return supported[0];
                    throw new AppError('API_VERSION', `Could not discover the ${code.toUpperCase()} API version. Set a supported ${code}Version in local config.`);
                };
                return { lp: this.config.lpVersion ?? get('lp'), le: this.config.leVersion ?? get('le') };
            })().catch(error => { this.versions = undefined; throw error; });
        }
        return this.versions;
    }
    async path(product, suffix) {
        return `/d2l/api/${product}/${(await this.discoverVersions())[product]}/${suffix}`;
    }
    async request(url, accept, maxBytes = this.config.maxResponseBytes) {
        let release;
        const previous = this.queue;
        this.queue = new Promise(resolve => { release = resolve; });
        await previous;
        try {
            for (let attempt = 0;; attempt++) {
                const credentials = await this.getHeaders(url);
                const signal = AbortSignal.timeout(this.config.requestTimeoutMs);
                let response;
                try {
                    response = await this.fetchImpl(url, { method: 'GET', redirect: 'manual', signal,
                        headers: { Accept: accept, 'User-Agent': 'PersonalBrightspaceMCP/0.1.0', ...credentials } });
                }
                catch {
                    throw new AppError('NETWORK', 'Could not reach Brightspace within the request timeout. Check your network and school hostname.');
                }
                if ((response.status === 429 || [502, 503, 504].includes(response.status)) && attempt < this.config.retries) {
                    const delay = retryDelay(response.headers.get('retry-after'), attempt);
                    await response.body?.cancel();
                    await this.wait(delay);
                    continue;
                }
                if (response.status >= 300 && response.status < 400) {
                    await response.body?.cancel();
                    throw new AppError('REDIRECT_BLOCKED', 'Brightspace redirected this request. Sign in again, or open the material in your browser. Authenticated redirects are never followed.', response.status);
                }
                if (!response.ok) {
                    await response.body?.cancel();
                    const status = response.status;
                    const message = status === 401 ? 'Brightspace rejected the session/token. Run login again or renew your official access token.'
                        : status === 403 ? 'Brightspace denied this read. Your role, API scope or school policy may not allow it. This is not an empty result.'
                            : status === 404 ? 'The requested Brightspace route or item is unavailable. It may be hidden, missing or unsupported on this tenant.'
                                : status === 429 ? 'Brightspace rate-limited the request after bounded retries. Try again later.'
                                    : `Brightspace returned HTTP ${status}. The response body was withheld to avoid exposing secrets.`;
                    throw new AppError(status === 401 ? 'AUTH_REQUIRED' : status === 403 ? 'FORBIDDEN' : 'API_HTTP', `${message} Route: ${url.pathname}`, status);
                }
                if (this.persistCookies)
                    await saveResponseCookies(this.config, url, response, credentials);
                const length = Number(response.headers.get('content-length') || 0);
                if (length > maxBytes) {
                    await response.body?.cancel();
                    throw new AppError('TOO_LARGE', 'The response is too large. Open or download this material manually.');
                }
                const reader = response.body?.getReader();
                if (!reader)
                    return { response, bytes: new Uint8Array() };
                let total = 0;
                const chunks = [];
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done)
                            break;
                        total += value.byteLength;
                        if (total > maxBytes) {
                            await reader.cancel();
                            throw new AppError('TOO_LARGE', 'Response exceeded the configured size limit.');
                        }
                        chunks.push(value);
                    }
                }
                catch (error) {
                    if (error instanceof AppError)
                        throw error;
                    throw new AppError('NETWORK', 'The Brightspace response stream was interrupted or timed out.');
                }
                finally {
                    reader.releaseLock();
                }
                return { response, bytes: Buffer.concat(chunks, total) };
            }
        }
        finally {
            await this.wait(this.config.requestSpacingMs);
            release();
        }
    }
    async raw(input) {
        const url = safeApiUrl(this.config.baseUrl, input);
        const { response, bytes } = await this.request(url, '*/*', this.config.maxFileBytes);
        return { bytes, contentType: response.headers.get('content-type') || 'application/octet-stream', sourceUrl: url.href, fetchedAt: new Date().toISOString() };
    }
    async json(input) {
        const url = safeApiUrl(this.config.baseUrl, input);
        const { response, bytes } = await this.request(url, 'application/json');
        const body = Buffer.from(bytes).toString('utf8');
        if (/text\/html/i.test(response.headers.get('content-type') || '') || /^\s*<!?html/i.test(body))
            throw new AppError('AUTH_REQUIRED', 'Brightspace returned an HTML page instead of API JSON. Your session may have expired or this API may be blocked.');
        try {
            return JSON.parse(body);
        }
        catch {
            throw new AppError('API_SHAPE', 'Brightspace returned a response that was not valid JSON.');
        }
    }
    async collection(input) {
        let url = safeApiUrl(this.config.baseUrl, input);
        const sourceUrl = url.href;
        const items = [], warnings = [], seen = new Set();
        let complete = true;
        for (let page = 0;; page++) {
            if (page >= this.config.maxPages || seen.has(url.href)) {
                complete = false;
                warnings.push('Pagination limit or repeated cursor reached; results are incomplete.');
                break;
            }
            seen.add(url.href);
            const data = await this.json(url.href);
            if (Array.isArray(data)) {
                items.push(...data);
                break;
            }
            const r = record(data);
            const list = Array.isArray(r.Items) ? r.Items : Array.isArray(r.Objects) ? r.Objects : null;
            if (!list)
                throw new AppError('API_SHAPE', 'Expected an array, Items page or Objects page; refusing to report an unknown response as empty.');
            items.push(...list);
            const paging = record(r.PagingInfo);
            if (paging.HasMoreItems === true) {
                const bookmark = text(paging.Bookmark);
                if (!bookmark) {
                    complete = false;
                    warnings.push('The API indicated more results but supplied no bookmark.');
                    break;
                }
                url = new URL(url);
                url.searchParams.set('bookmark', bookmark);
                continue;
            }
            const next = text(r.Next);
            if (next) {
                url = safeNextPage(this.config.baseUrl, url, next);
                continue;
            }
            break;
        }
        return { items, complete, warnings, sourceUrl, fetchedAt: new Date().toISOString() };
    }
}
//# sourceMappingURL=client.js.map