# Test report — 4 November 2026

Release: `personal-brightspace-mcp` 0.1.0.

## GitHub packaging and Claude configuration

Strict TypeScript checking, all **155 synthetic tests** and the compiled stdio smoke test passed on macOS. `dist/` was regenerated from `src/`. The subprocess smoke test discovered 18 tools, called local status and read the guide without school authentication or a live school request.

The new host-configuration tests start the exact generated Claude Desktop command from a different working directory, with an installation path containing spaces. They verify tool discovery and local-only status. Configuration generation works even with an unreadable-as-JSON synthetic saved configuration, does not return synthetic credential values, and leaves synthetic state unchanged. A fake Claude Code executable captures the generated command's arguments; spaces, single quotes and shell metacharacters remain literal. Every advertised stdio protocol revision completes initialization, discovery and local status.

These are synthetic protocol and configuration checks. A live Claude Desktop/Claude Code UI connection and live school access were not verified in this run. The earlier historical checks below are retained as separate evidence.

A clean ZIP-style installation in a temporary folder with spaces passed the prebuilt smoke test before dependency installation and then `bash setup.sh`. The installer completed `npm ci --ignore-scripts`, passed its smoke test, printed separate settings for Claude Desktop, Claude Code and Codex, and created no school state directory. The temporary installation was removed.

## ChatGPT browser plugin

Strict TypeScript checking and 143 automated tests passed on macOS, including the existing desktop suite. The compiled stdio smoke test still discovered 18 tools. The web tests used synthetic school accounts and loopback HTTP. They exercised the 15-tool catalog, discovery and consent, separate course results and comparison files for two students, denied access, single-use codes, token rotation and revocation, relinking metadata, and building the publisher ZIP. A separate installed-Chrome test ran against local HTTPS simulations of the plugin, school sign-in and ChatGPT callback. Connecting returned a code redeemable with PKCE. Cancelling returned access_denied without a code. The test caught a real browser form issue and confirmed the consent page's corrected referrer policy. Live HHS OAuth, the hosted service, a ChatGPT browser connection and public directory acceptance remain unverified.

## Document and rubric tools on macOS

The expanded build passed strict typechecking, all 113 synthetic tests and the compiled stdio smoke test with 18 tools. A fresh Codex app-server also called the tools using an authenticated student session. This section describes the document expansion. The sections below retain the earlier results.

| Check | Observed result |
| --- | --- |
| Live PowerPoint | Read slide text and embedded picture metadata, retrieved a JPEG, and returned a rendered slide as native MCP image content. Visually inspected the diagram and mathematical notation on the rendered slide. A deck above the previous 8 MiB limit also opened with the new file limit. |
| Live PDF | Retrieved page text and returned a rendered page image. |
| Live Word and Excel | Read paragraph text and returned worksheet row and cell references from an assessment matrix. |
| Live document search | Matched six slides in a course deck and returned numbered slide citations. |
| Live rubric and named link | Returned five groups, eight criteria and numeric levels from one published rubric. Returned a document link with its authored label and HTTPS destination from a separate assignment. |
| Live content hashing | Created and rechecked a per-file hash using a temporary, isolated baseline. No change was reported for the unchanged file. The temporary baseline was removed. |
| Synthetic coverage | Verified speaker notes, image-only OCR, page-specific rendering, PDF copying restrictions, parent-verified assignment/news attachment reads, changed bytes with identical metadata, and preservation of a denied file’s previous baseline. |

The seven active courses returned no native assignment or announcement attachments with a numeric FileId when checked. Their download routes were exercised with synthetic API responses. Some teacher-provided files were browser QuickLinks instead. Those links are returned for manual opening.

## macOS and Codex checks

The original 77 synthetic tests passed before changes. The revised TypeScript build, strict typecheck and all 91 synthetic tests passed with Node 22.19.0, TypeScript 5.8.3 and playwright-core 1.64.1. A clean install from the generated lockfile succeeded with lifecycle scripts disabled. The npm audit reported zero known vulnerabilities on 3 November 2026.

The compiled stdio server passed the subprocess smoke test. The locally installed Codex app-server separately discovered all 15 tools, read the guide and called the local status tool. These checks required no school account.

Additional regression cases cover encoded pagination cursors, filter changes, enrollment activity fields, course-outline date fields, exclusive midnight boundaries, visible and sequence-locked topics, personal/group receipt handling, verification status, non-mutating note reads and retrying an oversized change report.

## Authenticated HHS reads on macOS

On 3 November 2026, the account holder completed HHS sign-in in a separate, local Chrome session. The CLI verified the account and wrote a local session with POSIX mode 0600. The doctor command independently verified identity and enrollments. Live checks used LP 1.64 and LE 1.100.

A fresh Codex app-server called the installed MCP tools and retrieved the configured active courses, assignment folders, announcements, a course outline and the text of a visible HTML study topic. A 14-day deadline query completed the assignment, quiz metadata, calendar and content reads for every returned course. Dates in free text and external systems are outside this coverage.

Brightspace returned HTTP 403 for the one personal assignment receipt tested. The tool reported unknown completion and partial coverage for that check. Grades, real change baselines, session renewal and binary document extraction were outside this acceptance run. The current desktop chat was already open at registration time. Host verification used a fresh local Codex process.

## Original archive checks (Linux)

| Check | Result |
| --- | --- |
| Strict TypeScript type check | Passed |
| TypeScript build, including declarations and source maps | Passed |
| Automated Node test suite | **77 passed; 0 failed; 0 skipped** |
| Spawned compiled MCP server | Passed: initialization, version negotiation, tool discovery, requests and clean stdout |
| Independent `scripts/smoke.mjs` | Passed: 15 tools, local status and guide resource |
| Chromium launch and temporary browser context | Passed on installed Chromium, using an in-memory page |
| Synthetic school-cookie isolation | Passed: retains `/d2l`-scoped school cookies; excludes identity-provider cookies |
| Import of the actual supplied School Markdown snapshot | Passed: import, literal search and line-numbered read; temporary private copy removed |
| Extracted release archive, without node_modules | Passed: all 77 prebuilt tests and the independent smoke test |

The unit/integration suite covers GET-only routing, cross-origin and redirect refusal, cookie boundaries, private state permissions, token-expiry handling, pagination and response caps, API error reporting, date-only/timezone/DST behavior, unknown submission status, partial-source coverage, text/notebook extraction, note import/search/read, baseline changes, identity isolation, local locking, argument validation and MCP framing.

## Original archive environment

- Node.js: 22.16.0 (Linux container).
- TypeScript: 5.8.3; Node type definitions: 24.0.4.
- Browser smoke: the environment's installed Chromium and Playwright driver package (1.57.0-beta-1764944708000).
- The Chromium-only smoke required `--no-sandbox` for this container. The shipped interactive login does **not** set that flag.
- Build-time dependencies were available locally. The environment could not reach the npm registry; a fresh `npm install`, registry-version resolution and dependency vulnerability audit were **not** performed.
- The original archive did not include a lockfile. The macOS setup generated the lockfile now included in this directory.
- The 77 tests use Node's built-in test runner and the prebuilt release. They need no browser or network.

```bash
npm run typecheck
npm test
npm run smoke
# Or test the included compiled release without installing anything:
npm run test:built
node scripts/smoke.mjs
```

## Limits of the original Linux verification

- HHS account sign-in, SSO/MFA, student permissions or live course/API responses. No school password, MFA code, cookie or access token was available.
- A separate mocked HTTPS browser-navigation/header-capture attempt was blocked by this environment's browser policy (`ERR_BLOCKED_BY_ADMINISTRATOR`). It was not bypassed. The successful browser smoke is limited to launch, in-memory rendering and synthetic-cookie handling; it is **not** an authentication end-to-end test.
- Authentication-header capture during real school navigation and session renewal behavior.
- The actual Codex/ChatGPT application UI. Protocol checks used subprocess clients; host configuration is based on the official documentation.
- macOS/Windows end-to-end installation or the GitHub Actions workflow. CI is included but has not been run on GitHub.
- Remote HTTP transport, public deployment, official OAuth registration/token exchange/refresh, background reminders or Osiris/Remindo access. These were outside the original archive.
- The original archive did not extract PDF/Office/media files or check individual submission receipts.

Run local `login` and `doctor`, then verify each relevant course tool against the Brightspace student interface before relying on the results. Passing fixture tests is not proof of school compatibility, a formal security audit or a guarantee of complete deadlines.
