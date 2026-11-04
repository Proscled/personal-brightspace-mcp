# Architecture

```text
Codex / trusted MCP host
        |
        | newline-delimited JSON-RPC over local stdio
        v
MCP dispatcher + strict tool argument schemas
        |
        +--- SchoolService --- GET-only BrightspaceClient --- configured HTTPS tenant
        |                          |
        |                          +--- explicit official OAuth token OR private browser session
        |
        +--- NoteStore: explicitly imported text with line-level retrieval
        |
        +--- ChangeTracker: account-scoped, atomic private baselines
```

## Source layout

- `config.ts`: validated school origin, course filters, time zone and bounded limits.
- `security.ts`: API route/query allowlist, same-origin pagination, cookie matching and plain-text conversion.
- `auth.ts`: interactive browser sign-in, session loading and token headers; no school password automation.
- The local client retains valid replacement cookies from successful allowlisted GETs using a separate cross-process auth lock. Optional CLI `login --remember-browser` uses a private, dedicated Chrome profile; the default remains temporary. Neither mode adds unattended browser renewal or a scheduler.
- `client.ts`: serialized GET requests, response limits, safe errors, retries, API discovery and pagination.
- `service.ts`: course-specific normalization, reading, search and structured-date aggregation.
- `dates.ts`: explicit-zone instants, date-only values and Amsterdam rendering.
- `materials.ts`, `office.ts`, `visual.ts` and the bundled scripts implement section extraction, local image rendering, paged attachment search and optical character recognition.
- `assignmentSources.ts` normalizes instruction links and visible rubric definitions.
- `notes.ts`: CLI-only imports and ID-based read/search tools.
- `changes.ts`: stable comparison, per-account baselines and failure preservation.
- `schema.ts`: the exact JSON Schema subset used by the tool definitions, validated at runtime.
- `tools.ts`: 18 tools, two prompts and provenance/uncertainty guidance.
- `mcp.ts`: small stdio protocol implementation.
- `index.ts`: CLI and server entrypoint.

## MCP implementation scope

The transport implements the tools/resources/prompts subset shared by protocol revisions `2025-11-25`, `2025-06-18`, `2025-03-26` and `2024-11-05`. An unsupported version request is answered with the newest implemented revision so the client can decide whether to proceed. Initialization and the client's initialized notification are required before normal tool calls. stdout is exclusively protocol JSON; CLI diagnostics and failures go to stderr in server mode.

Implemented: initialize, ping, tools/list, tools/call, resources/list, resources/templates/list (empty), resources/read, prompts/list and prompts/get. Unsupported methods return JSON-RPC errors. Malformed JSON returns Parse error. Tool failures return `isError` with sanitized details.

The stdio server processes requests sequentially. It ignores unsupported notifications, including cancellation notifications; an already-running read is bounded by request timeouts but is not actively cancelled. It does not implement subscriptions, sampling, elicitation, tasks, dynamic capability changes or progress notifications. Hosts needing these capabilities should use a future official-SDK adapter rather than assume they exist. Nothing advertises support for these optional features.

The core uses Node's standard library. Interactive browser login dynamically imports `playwright-core`. The source directory includes compiled JS, declarations, source maps and an npm lockfile.

## Data semantics

Every successful collection includes the API source URL and retrieval timestamp. Text/material items additionally include a browser-view link. Pagination flags identify incomplete API results. Tool-output paging has a separate `outputTruncated` flag and `nextOffset`.

Dates remain attached to their source and type. The server does not parse arbitrary prose into authoritative deadlines, merge similarly named assignments, synthesize local times, calculate official final grades, or infer submission completion. Native calendar and assignment dates may duplicate one real-world obligation; this is stated instead of silently discarding evidence.

Metadata snapshots and optional per-file SHA-256 baselines have separate keys. File checks run on demand for one course in bounded batches. Only successful reads advance each file baseline. No file bytes are stored in those baselines.

## Next extensions

Possible extensions include approved OAuth authorization and refresh, and a standard SDK transport adapter.

## Hosted ChatGPT plugin

The separate web entry point uses stateless Streamable HTTP and per-student OAuth grants. See [web deployment and data handling](CHATGPT_WEB.md). The local stdio entry point continues to start without a listener.
