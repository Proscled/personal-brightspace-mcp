import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { BrightspaceClient } from '../client.js';
import { buildConfig } from '../config.js';
import { SchoolService } from '../service.js';
import { ToolRegistry } from '../tools.js';
import { HHS_ORIGIN } from './brightspace-oauth.js';
export function schoolRegistry(dataDir, account, tokens, authChallenge, fetchImpl) {
    const namespace = createHash('sha256').update(HHS_ORIGIN + '|' + account).digest('hex');
    const config = buildConfig({ baseUrl: HHS_ORIGIN, dataDir: join(dataDir, 'accounts', namespace) }, {});
    const client = new BrightspaceClient(config, {
        fetchImpl,
        getHeaders: async (url) => {
            if (url.origin !== HHS_ORIGIN)
                throw new Error('Invalid school origin.');
            return { Authorization: 'Bearer ' + tokens.accessToken };
        }
    });
    return new ToolRegistry(new SchoolService(client), undefined, undefined, { authChallenge });
}
//# sourceMappingURL=registry.js.map