# Brightspace Study on ChatGPT web

**Prototype for fictional data.** HHS prohibits using school personal data and confidential information in generative AI, even with individual consent. This also applies to the personal Codex workflow. Use fictitious students and self-authored materials for testing. [HHS ICT Regulations, article 13(5)(d)](https://www.dehaagsehogeschool.nl/media/reglement-ict#page=7)

**Public listing eligibility.** OpenAI excludes plugins that primarily serve as unofficial third-party connectors. The current independent connector appears to fall under that exclusion. The existing name is a working title. D2L prohibits using its trademarks in an app name. OAuth registration alone resolves neither issue. The publication steps below apply only if an eligible, authorized design is established. [OpenAI plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines#third-party-content-and-integrations) · [D2L trademark guidelines](https://www.d2l.com/legal/trademarks/)

## Ask HHS about a synthetic-data pilot

Start with the [Dutch question for HHS Facilities & IT and Privacy](HHS-Pilotverzoek.txt). A demonstration can use fictional students and self-authored course material without access to the live HHS tenant. The following configuration documents the implementation for technical evaluation.

The server requests these D2L scopes. Refresh tokens are optional and, if approved, must be enabled on the D2L registration. The server verifies the signed-in account at the HHS identity endpoint. Each API request still depends on the permissions HHS grants that student. [D2L OAuth registration](https://docs.valence.desire2learn.com/basic/oauth2.html) · [Endpoint and scope details](AUTHENTICATION.md)

```text
users:own_profile:read enrollment:own_enrollment:read dropbox:folders:read rubrics:objects:read news:newsitems:read grades:own_grades:read calendar:my_events:read content:toc:read content:topics:readonly content:file:read quizzing:quizzes:read
```

## Run the service

Use one service process under a dedicated unprivileged OS account behind a TLS reverse proxy on the same host. Use an HTTPS hostname you can verify in OpenAI's portal. The release includes compiled JavaScript. Node 22.16 or newer can run the hosted server without npm dependencies. The server also needs Python 3 for PPTX, DOCX and XLSX text and embedded slide images. Choose a macOS host with the system PDFKit and Vision frameworks, the system Python 3 interpreter, and LibreOffice installed for PDF text, page and slide rendering and OCR. On Linux those visual operations report a dependency error. See the [material reader requirements](../README.md).

Supply the following environment variables via the host's secret manager or a private service environment file.

| Variable | Value |
| --- | --- |
| `BRIGHTSPACE_WEB_ORIGIN` | Exact public HTTPS origin on port 443, with no path or trailing slash |
| `BRIGHTSPACE_WEB_D2L_CLIENT_ID`, `BRIGHTSPACE_WEB_D2L_CLIENT_SECRET` | HHS-issued OAuth credentials for the registered callback `<origin>/oauth/brightspace/callback` |
| `BRIGHTSPACE_WEB_CLIENT_ID` | Public identifier you assign to ChatGPT as a client of this plugin, such as `brightspace-study-chatgpt` |
| `BRIGHTSPACE_WEB_CLIENT_SECRET` | A separate random secret, at least 32 characters, shared only with the ChatGPT connection form |
| `BRIGHTSPACE_WEB_CHATGPT_REDIRECT_URI` | The exact callback displayed in the OpenAI connection setup. The service supports `https://chatgpt.com/connector_platform_oauth_redirect` and the specific `https://chatgpt.com/connector/oauth/<callback_id>` form. |
| `BRIGHTSPACE_WEB_DATA_DIR` | Absolute path to a dedicated private directory for comparison snapshots, owned by the service account |
| `BRIGHTSPACE_WEB_PORT` | Optional. Defaults to 8787 on 127.0.0.1 |

Run under a service manager to restart after failures:

```sh
node dist/web/start.js
```

Forward the public HTTPS origin to the loopback service, preserving the original Host header. Serve domain verification and the public website, support, privacy and terms pages on the web tier as appropriate. Configure access logs to exclude OAuth query strings, bodies, cookies, authorization headers and course results. Apply request-rate and bandwidth limits at that tier.

The public MCP URL is `<origin>/mcp`. A request without a token should return HTTP 401 and a `WWW-Authenticate` header pointing at `/.well-known/oauth-protected-resource/mcp`. The issuer metadata is at `/.well-known/oauth-authorization-server`. A GET to `/healthz` confirms the process can respond. It does not contact HHS. [OpenAI plugin authentication](https://developers.openai.com/plugins/build/auth)

## Account and data handling

- ChatGPT registers with this server using its own client ID and secret. The student signs in with HHS, then the plugin shows the verified school account and asks for consent. ChatGPT receives an application access token bound to this single service. D2L tokens remain in process memory.
- Each tool call uses only the connected student's school token. The browser catalog has 15 tools. The three imported local-note tools belong to the desktop server. Course data and document results are returned to the requesting ChatGPT conversation.
- Calling `brightspace_check_updates` persists course comparison data, including titles, previous item records and file hashes, under `BRIGHTSPACE_WEB_DATA_DIR/accounts/<hash>/snapshots`. The hash is the lowercase SHA-256 of `https://brightspace.hhs.nl|` followed by the verified decimal Brightspace account ID. Baselines persist across service restarts. Set and disclose the retention period, protect the volume and backups, and provide a deletion contact before inviting students. To remove one student's baselines, stop the process and remove only that student's verified account directory.
- A token pair is scoped to a single student. Access lasts up to one hour and never beyond the upstream expiry. Refresh requires school support and ends after at most seven days. Restarting this single-process pilot clears grants and students must connect again. The service exposes an authenticated revocation endpoint at `/oauth/revoke`. Removing a grant ends access and does not erase saved comparisons or a student's ChatGPT conversation.
- The same allowlist as the personal version enforces GET-only reads of school course data. The separate OAuth token exchange uses POST. Submissions, quiz attempts and school writes are unavailable.

## Publish in ChatGPT

Follow the [publisher steps and proposed review cases](../packaging/web/README.md). Use the live public origin and the **ChatGPT-facing** public client ID to generate the submission ZIP. Validate a private browser connection, each available material type, sign-in, disconnection and the review prompts on approved sample data. Then verify the domain, complete OpenAI’s review, publish the approved plugin and share its listing. [OpenAI submission guide](https://developers.openai.com/plugins/deploy/submission)
