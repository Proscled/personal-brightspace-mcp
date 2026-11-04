import { isAbsolute, parse, resolve } from 'node:path';
import { D2lOAuth } from './brightspace-oauth.js';
import { createWebServer } from './server.js';

function setting(name: string): string {
  const value = process.env['BRIGHTSPACE_WEB_' + name];
  if (!value) throw new Error('Missing BRIGHTSPACE_WEB_' + name + '.');
  return value;
}
try {
  const origin = setting('ORIGIN');
  const dataDir = setting('DATA_DIR');
  const clientSecret = setting('CLIENT_SECRET');
  if (clientSecret.length < 32) throw new Error('Use a random ChatGPT client secret of at least 32 characters.');
  if (!isAbsolute(dataDir) || resolve(dataDir) === parse(dataDir).root) throw new Error('Choose a dedicated absolute state directory.');
  const port = Number(process.env.BRIGHTSPACE_WEB_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid loopback port.');
  const server = createWebServer({ origin, dataDir, clientId: setting('CLIENT_ID'), clientSecret,
    redirectUri: setting('CHATGPT_REDIRECT_URI') }, new D2lOAuth({ clientId: setting('D2L_CLIENT_ID'),
    clientSecret: setting('D2L_CLIENT_SECRET'), redirectUri: origin + '/oauth/brightspace/callback' }));
  server.on('error', () => { console.error('Could not serve the configured loopback port.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.error('Brightspace Study is listening behind the local HTTPS proxy on port ' + port + '.'));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Could not start Brightspace Study.');
  process.exitCode = 1;
}
