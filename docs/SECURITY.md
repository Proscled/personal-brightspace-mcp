# Security model

## Local Codex server

- Single-user local process, launched by a trusted MCP host over stdin/stdout.
- The local entry point communicates over stdio and leaves all network listeners closed.
- No arbitrary file-reading, arbitrary URLs, arbitrary API methods or shell tool.
- All school API paths are hardcoded allowlisted GET routes. Course IDs are positive decimal strings.
- Unknown query keys, traversal syntax, encoded separators, cross-origin URLs and route-changing pagination are blocked.
- Redirects on authenticated API/file requests are not followed. Credentials stay on the configured origin.
- Each HTTP request has a timeout, response-byte cap, bounded retry count and request spacing.
- Error bodies and raw library exceptions are withheld. No tokens/cookies are included in tool results.
- Course text is untrusted source data. The host must ignore embedded instructions to expose secrets, call tools or change behavior. Plain-text extraction does not eliminate prompt injection.

## Local document readers

Office XML processing accepts input bytes only, validates the package, bounds decompression and text size, and ignores external relationships. The native macOS renderer uses a private temporary directory, limits CPU, time and output size, strips external Office relationships and refuses macros. The sandbox restricts network and filesystem access. A PDF that disallows copying or needs a password is withheld. School credentials are excluded from worker environments. File fingerprints store a hash for each successfully read file and retain the previous hash when a read fails.

## Storage

`session.json` contains active secrets. It is unencrypted, with owner-only permissions on POSIX. Baselines and imported notes contain personal course data. They also use private permissions and atomic writes. No school state is shipped inside the source archive. `.gitignore` excludes common session, environment, note and snapshot paths. Do not rely on `.gitignore` as your only protection: review `git diff --cached` before publishing.

Baseline files are separated by school origin and authenticated identity. A failed or partial collection never overwrites a successful baseline. Locks coordinate concurrent processes; a crash may leave a lock for the owner to remove after stopping checks.

`login --remember-browser` opts into a dedicated private browser profile containing school and SSO browser state. Treat that entire profile as credentials; it is stored outside the source tree in the private data directory. The default login uses a temporary browser and excludes identity-provider state from saved MCP credentials. Successful API reads can update local session cookies. HTTP failures and redirects cannot replace them, and cookie persistence never sends credentials to another origin.

`logout` removes the server's saved session and optional remembered browser profile. It does not revoke a session at the school or erase imported course notes. The optional browser dependency and the MCP host are trusted parts of the local execution environment. Keeping the machine and dependencies updated matters.

## Not promised

This is not a penetration-tested or institution-approved security product. A hostile OS account, malicious MCP host, compromised package or unrestricted local process can read the same data. Endpoint read-only access does not mean the school performs no logging or access telemetry. There is no guarantee that every school exposes the same student API behavior.

The separate [hosted ChatGPT service](CHATGPT_WEB.md) uses per-student OAuth, a fixed public origin, bounded in-memory grants and private account-scoped comparison files. Production deployment and school OAuth access still require validation.

## Reporting

Never attach credentials, `session.json`, environment dumps, school documents, grade records or real API response bodies to a public issue. Use sanitized endpoint names, status codes and synthetic reproductions.
