# Authentication and troubleshooting

## Browser session (personal prototype)

1. Install the project's optional `playwright-core` dependency and have Chrome installed.
2. Run `node dist/index.js login` in a real interactive terminal.
3. Sign in to the configured school yourself. Complete MFA normally. Open a course so its own API calls can occur.
4. Return to the terminal and press Enter.
5. The CLI verifies `/d2l/api/lp/{version}/users/whoami`. It saves a session only if a recognizable identity is returned.
6. Run `node dist/index.js doctor`, then call `brightspace_list_courses`.

The login browser is temporary. It is not your normal browser profile. Passwords and MFA codes are never requested by the CLI or exposed through MCP arguments. The code does not collect form bodies, mint wildcard tokens, bypass MFA or automate a password prompt. Only cookies matching the configured tenant domain and auth headers already used on its same-origin API requests can be saved. Identity-provider cookies are excluded.

### Remember sign-in and retain cookie updates

`node dist/index.js login --remember-browser` explicitly opts into a dedicated persistent Chrome profile under the private state directory (`login-browser`, directory mode 0700 on POSIX). That profile stores browser-managed school and identity-provider state, unlike the default temporary browser. Only school credentials enter the MCP session JSON. It can reduce password/MFA prompts on subsequent login runs while SSO remains valid. It does not extend school session lifetimes, run automatically on a 403, or provide unattended OAuth refresh. `logout` removes both local session JSON and the profile; close the login browser before running logout.

The local client applies school-scoped `Set-Cookie` updates from successful allowlisted API GETs, including expiry and deletion. Failed responses and redirects do not replace credentials. A separate cross-process auth lock protects session updates; a response using superseded credentials cannot replace a newer login. Custom-header clients, including hosted OAuth clients, do not update the local session.

`brightspace_status` reports only safe expiry metadata: bearer presence/expiry hint, whether locally unexpired cookies match an API URL, and that unattended renewal is unavailable. A locally matching cookie is not proof of server acceptance. HTTP errors include the failed route path, without query values or response bodies. A 403 from version discovery happens before identity or course checks; it must not be described as a specific course permission failure. Comparing the same allowlisted public version route without cookies can help identify rejected saved cookies, but cannot establish their precise server-side expiry or revocation reason.

This is a compatibility path, not an institution-approved OAuth application. Some schools accept session cookies on API routes; others require a bearer token, block scripted browsers, impose device policies or limit student API scopes. For the tested HHS account, local Chrome sign-in, API identity verification and the course reads listed in `TEST_REPORT.md` succeeded on 3 November 2026. Get school approval where required. If your school's policy disallows this method, use its approved integration route.

## Official OAuth access-token mode

An institution-approved integration can provide a user-context access token. The server consumes that token via `BRIGHTSPACE_ACCESS_TOKEN` and sends it only to the configured school origin. It does **not** implement app registration, authorization-code exchange or automatic refresh. Obtain/renew tokens through the approved app workflow outside this server. Never request the token in a chat or pass it as an MCP tool argument.

D2L documents registration through **Manage Extensibility**. Access may require the school's administrator. Request only the read scopes used by this implementation, subject to the school's current API documentation:

```text
users:own_profile:read
enrollment:own_enrollment:read
dropbox:folders:read
rubrics:objects:read
news:newsitems:read
grades:own_grades:read
calendar:my_events:read
content:toc:read
content:topics:readonly
content:file:read
quizzing:quizzes:read
```

A targeted assignment receipt check uses the existing `dropbox:folders:read` scope and sends a GET to `/d2l/api/le/{version}/{courseId}/dropbox/folders/{folderId}/submissions/mysubmissions/`. D2L documents this route for the current user. The connector returns only whether a personal or group receipt was found. A missing receipt leaves completion unknown. Published feedback, submission comments, file metadata and submitter identities in the response are discarded. [D2L assignment submission reference](https://docs.valence.desire2learn.com/res/dropbox.html#get--d2l-api-le-(version)-(orgUnitId)-dropbox-folders-(folderId)-submissions-mysubmissions-)

A folder-specific rubric lookup sends a GET to the course rubric collection with `objectType=Dropbox` and the visible folder ID. D2L documents the `rubrics:objects:read` scope. The server uses permissions the account already has. A denied lookup preserves any rubric data supplied with the assignment and returns the error alongside links to associated materials. Rubrics marked hidden or conditional on feedback are withheld. Scores are displayed only when the definition explicitly permits them. [D2L assessment reference](https://docs.valence.desire2learn.com/res/assessment.html)

Assignment and announcement files use dedicated attachment GET routes under `dropbox:folders:read` and `news:newsitems:read`. Each download rechecks that the file ID belongs to the specified visible item. Instruction links are returned for the user to open. The connector does not follow them. [D2L assignments](https://docs.valence.desire2learn.com/res/dropbox.html) · [D2L announcements](https://docs.valence.desire2learn.com/res/news.html)

Check the exact scopes against your deployed API version. An endpoint's presence in public documentation does not grant student access. Avoid `*:*:*` and other blanket write-capable scopes. The application still enforces its GET allowlist even if the issued token has broader permissions.

Environment variables are not encrypted storage either. Use your trusted host's secret-handling mechanism and keep secrets out of shell history and configuration files that might be shared.

## Diagnosing failures

| Symptom | Meaning and next action |
| --- | --- |
| `AUTH_REQUIRED` before any request | Run local login or supply an official token through a secure environment. |
| Chrome cannot open | Install Google Chrome, or set `BRIGHTSPACE_BROWSER_PATH` to its executable. This is not a browser-profile path. |
| SSO blocks the temporary browser | Stop. Follow the school's supported access route; do not bypass device/MFA restrictions. |
| API returns 401 | The token/session is invalid or expired. Sign in again or renew the officially issued token. |
| API returns 403 | The current role, scope or school policy denied that operation. Do not interpret it as no assignments/grades. |
| API returns 404 | The route/item may be hidden, unavailable or unsupported. Check API version and the real student UI. |
| HTML instead of JSON | Usually an expired session/login page or an unavailable API route. |
| `REDIRECT_BLOCKED` | A login or file redirect was not followed. Reauthenticate or open the material manually. |
| API version discovery fails | Confirm access to `/d2l/api/versions/`; set only verified supported `lpVersion`/`leVersion` values. |
| Some deadline sources fail | Other dates are retained, with `complete: false` and a per-source error. Review the unavailable source manually. |
| `BUSY` after a crashed update | Stop all update checks before manually removing `snapshots/.update.lock`. Do not delete it while a check is active. |
| Output too large | Narrow the query/date range or request a smaller `limit`. |

A browser sign-in or `doctor` success verifies only the endpoint(s) it actually tested. Check assignments, announcements and grades independently before relying on them.
