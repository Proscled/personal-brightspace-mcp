# Personal Brightspace MCP

A local, read-only **TypeScript MCP server** that gives a school tutor access to your Brightspace courses, structured deadlines, announcements, assignment instructions, course outline, quiz metadata and your own released grades. It can also search explicitly imported school notes and compare course metadata with a previous successful check.

Connect locally with **Claude Desktop, Claude Code or Codex**. [Install](#quick-start-on-your-mac) · [Claude setup](#connect-to-claude) · [Codex setup](#connect-to-codex).

Verified on macOS with an HHS student account on 3 November 2026. Codex retrieved courses, assignments, announcements, structured dates, a course outline and an HTML study topic. The sampled personal submission-receipt request returned HTTP 403. Run `doctor` after signing in to verify identity and enrollments, then check the course tools you plan to use. Each course and resource can have different permissions. See `docs/TEST_REPORT.md` for the checks performed.

## Brightspace Study for ChatGPT in the browser

**Prototype for fictional data.** HHS prohibits using school personal data and confidential information in generative AI, even with individual consent. This also applies to the personal Codex workflow. Use fictitious students and self-authored materials for testing. [HHS ICT Regulations, article 13(5)(d)](https://www.dehaagsehogeschool.nl/media/reglement-ict#page=7)

**Public listing eligibility.** OpenAI excludes plugins that primarily serve as unofficial third-party connectors. The current independent connector appears to fall under that exclusion. The existing name is a working title. D2L prohibits using its trademarks in an app name. OAuth registration alone resolves neither issue. The publication steps below apply only if an eligible, authorized design is established. [OpenAI plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines#third-party-content-and-integrations) · [D2L trademark guidelines](https://www.d2l.com/legal/trademarks/)

- [Set up the hosted service and request school authorization](docs/CHATGPT_WEB.md)
- [Prepare the ChatGPT plugin and submit it for review](packaging/web/README.md)

## Quick start on your Mac

You need **[Node.js 22.16+](https://nodejs.org/)** (an LTS version includes npm). **Google Chrome** is needed only for optional browser sign-in. No build step is required: `dist/` is included.

1. [Download the source ZIP](https://github.com/Proscled/personal-brightspace-mcp/archive/refs/heads/main.zip) and unzip it.
2. Open Terminal in the extracted folder and run:

```bash
bash setup.sh
```

The setup installs locked dependencies with lifecycle scripts disabled, runs an offline smoke check, and prints the exact connection settings for your computer. It does not sign in, read school data, start a background service or change your MCP host settings. If Node or npm is missing, it explains what to install.

Alternatively, with Git installed:

```bash
git clone https://github.com/Proscled/personal-brightspace-mcp.git
cd personal-brightspace-mcp
bash setup.sh
```

Next, follow **Connect to Claude** or **Connect to Codex** below, then reload the host. Keep the extracted folder in a permanent location: the host runs the server from that path. A working offline check does not verify access to your school. For development, run `npm run build` after editing `src/`.

On Windows, use PowerShell in the extracted folder: run `npm ci --ignore-scripts`, then `node scripts/smoke.mjs`, and follow the Claude Desktop instructions below. Document rendering/OCR support varies by operating system; see **Local readers**.

### Optional school sign-in

Only do this if your institution authorizes the account and material use described above. Use a normal local terminal, not an AI tool call:

```bash
node dist/index.js init --url https://brightspace.hhs.nl
node dist/index.js login
node dist/index.js doctor
```

`login` opens a **separate, temporary Chrome session**. Sign into HHS normally and complete MFA yourself. Open a course, return to the terminal and press Enter. The program collects only school-origin session cookies and any authentication headers the school page itself uses with its own API. It then checks the Brightspace identity endpoint before saving a session. It does not ask for your password, handle MFA codes, scrape your other browser tabs, or save Microsoft/SURF identity-provider cookies.

To remember browser sign-in between login runs, use `node dist/index.js login --remember-browser`. This opts into a dedicated local Chrome profile, including school and SSO browser state; it never uses your ordinary Chrome profile. The profile is sensitive, stays outside the repository in the private state directory, and is removed by `logout`. School expiry and MFA policies still apply. Successful API reads now save replacement school cookies, when supplied by the server. There is no background refresh or automatic browser launch.

Browser-session API access is tenant-dependent. A successful browser login does **not** prove the student API is allowed. If verification returns 401/403, check `docs/AUTHENTICATION.md`; do not bypass school policy. An officially issued OAuth access token is the supported alternative.

The archive includes prebuilt `dist/` files. You can run the protocol smoke test without installing dependencies:

```bash
node scripts/smoke.mjs
```

Browser login uses the optional `playwright-core` package installed by `npm ci` and your existing Google Chrome installation. Set `BRIGHTSPACE_BROWSER_PATH` to a Chrome/Chromium executable to use another installation.

## Connect to Claude

### Claude Desktop

1. From the installed project folder, print your exact JSON configuration:

   ```bash
   node dist/index.js config-client --client claude-desktop
   ```

2. In the **Claude Desktop app**, open **Settings → Developer → Edit Config**. Merge the printed `brightspace` entry into the existing `mcpServers` object. If the file is empty, use the complete printed JSON. Keep any other servers.
3. Save the file, fully quit Claude, and reopen it. Find `brightspace` in the local MCP server settings or the chat's connector menu.
4. First ask: “Call brightspace_status with verifyConnection false.” This checks local setup without contacting your school. Course tools require separately authorized sign-in.

This uses local stdio; there is no hosted URL to paste into Claude's web connector form. The generated configuration uses absolute paths, including the Node executable, so it also works when the desktop app has a different PATH. See [Claude setup and troubleshooting](docs/CLAUDE.md) for Windows, config file locations and connection errors.

### Claude Code

Print and run the generated command in Bash/zsh:

```bash
node dist/index.js config-client --client claude-code
```

It registers a stdio server in your user scope (available across your projects). Then run `claude mcp get brightspace` and use `/mcp` in Claude Code to inspect the connection. The generator only prints a command; it does not change Claude settings itself. [Official Claude Code MCP reference](https://code.claude.com/docs/en/mcp#option-3-add-a-local-stdio-server).

## Connect to Codex

From the project directory:

```bash
codex mcp add brightspace -- "$(command -v node)" "$PWD/dist/index.js" serve
```

Restart/reload the MCP host as needed. The server starts without a network call; authentication is checked when a live school tool is used. For larger multi-course requests, add `tool_timeout_sec = 300` to this server's entry in your Codex configuration.

To print exact configuration paths for your machine:

```bash
node dist/index.js config-client --client codex
```

The output is a Codex TOML entry. **Merge it into your existing configuration; do not replace the entire file.** Without `--client`, the command prints both generic JSON and Codex TOML; use only the format your host accepts. Examples are also in `examples/`.

This command connects Codex to your local stdio server. ChatGPT in the browser connects separately to the hosted service described above.

## Try it

In an MCP-connected host:

> What is due in the next 14 days? Separate submission due dates from closing dates, and tell me which sources could not be checked.
>
> Read the latest announcements for Wiskunde I and find the preparation for the next exam.
>
> Search my imported school snapshot for the assessment matrix, then give me one practice question at a time.
>
> Check what changed since the last successful update check.

Or call a tool from your terminal:

```bash
node dist/index.js call brightspace_list_courses '{}'
node dist/index.js call brightspace_get_deadlines '{"daysAhead":14}'
node dist/index.js call brightspace_get_announcements '{"courseId":"100"}'
```

Course IDs in examples are illustrative configuration values for the HHS use case. `list_courses` is the source of truth for your account. A response with `isError` or an incomplete `coverage` entry must not be interpreted as “nothing due.”

To check for a submission receipt, pass both a course ID and a folder ID from the assignment list to `brightspace_get_assignments`. The ordinary course-wide list makes no receipt requests. A receipt confirms a submission. An empty result leaves completion unknown, particularly for group and on-paper work.

## Search your existing School snapshot

Use the Markdown context file you already have; it is intentionally **not bundled** into this source repository.

```bash
node dist/index.js import-notes "/path/to/School_Context_2026-11-03.md" \
  --title "School Brightspace snapshot" --as-of 2026-11-03

node dist/index.js call brightspace_search_notes '{"query":"toetsmatrijs"}'
```

Search returns note IDs, line numbers, snippets and the snapshot date. `brightspace_read_note` expands an exact line range. Only files you explicitly import via the local CLI are searchable; the model cannot supply arbitrary filesystem paths. Notes remain snapshots, not live facts. Import a new version when you refresh your school export. Identical content is deduplicated; different versions remain separate and retain their dates.

## Available tools

| Tool | What it does |
| --- | --- |
| `brightspace_status` | Local setup status; optional live identity check. Never returns tokens or cookies. |
| `brightspace_list_courses` | Accessible course enrollments with configurable course filtering. |
| `brightspace_get_assignments` | Instructions, dates, attachments and rubric metadata. An optional `folderId` checks your receipt for one visible assignment. |
| `brightspace_get_announcements` | Course news text with published/modified dates and source links. |
| `brightspace_get_grades` | Only your own released Brightspace grade values. Missing grades stay null. |
| `brightspace_get_quizzes` | Quiz metadata and dates, never attempts or questions. |
| `brightspace_get_calendar` | Your course calendar events within a bounded time window. |
| `brightspace_get_content` | Nested modules/topics flattened into a searchable course outline. |
| `brightspace_read_topic` | Read a visible topic as text, including PDF, PPTX, DOCX, XLSX, HTML and notebook source. Select a section or page and page through long text. |
| `brightspace_read_attachment` | Read a native file attached to a visible assignment or announcement, using its parent ID and FileId. |
| `brightspace_view_page` | Return one PDF page or PowerPoint slide as an MCP image. Select a numbered picture to retrieve an embedded PNG or JPEG. |
| `brightspace_get_assignment_rubrics` | Look up the visible rubrics for a specific assignment and read their criteria, levels and available points. |
| `brightspace_get_deadlines` | Structured dates from assignments, quizzes, calendar and content, with per-source coverage. |
| `brightspace_search_course` | Search course metadata and a batch of native files. File matches identify the slide, page, paragraph or spreadsheet row. |
| `brightspace_check_updates` | Compare current metadata with private local baselines. For one course, optionally hash file bytes to catch edits without metadata changes. |
| `brightspace_list_notes` | List explicitly imported Markdown/text snapshots. |
| `brightspace_search_notes` | Search imported text with line-numbered snippets. |
| `brightspace_read_note` | Read bounded line ranges by note ID. |

Two optional prompts are exposed: `school_weekly_plan` and `school_exam_tutor`. A `brightspace://guide` resource documents source handling and limitations for the host. `docs/TUTOR_PROMPT.md` provides project instructions to adapt.

## Presentations, documents and rubrics

Ask “Laat dia 9 zien en leg de formule uit” or “Zoek de toetsmatrijs en noem het werkblad en de rij.” Codex can call `brightspace_view_page` for an actual slide image and `brightspace_read_topic` for text, speaker notes and embedded-picture numbers. For a scanned or partly scanned document, request `ocrPage` with the one-based printed page number. For ordinary text use `section` to select a slide, PDF page, Word section or worksheet row. Each response identifies its source. The CLI prints image metadata; MCP clients receive the image itself.

Native assignment and announcement files come with a numeric `FileId`. Pass it with `folderId` or `newsItemId` respectively. Assignment `instructionLinks` also preserve the instructor’s link label and destination. Browser QuickLinks and external URLs can be opened manually. The reader does not follow them with your credentials. The rubric lookup checks the selected folder and reports any endpoint error alongside usable embedded definitions and document links. A denied lookup or a document linked as a marking guide should be reviewed separately.

File search scans three files per call by default. Look in `fileSearch.matches` for citations. Use `nextMatchOffset` for additional hits in the current batch, then advance `nextFileOffset` and reset the match offset. Set `filename` to narrow to a topic title or attachment name. `includeFiles: false` selects faster metadata-only search. A skipped or unreadable file appears in coverage. Images and diagrams inside mixed documents may need a visual read or page-specific OCR.

To detect changed bytes, call `brightspace_check_updates` with `includeFiles: true` and one entry in `courseIds`. Follow `fileCoverage.nextFileOffset` with the same course and options. A successful first read establishes each file’s SHA-256 baseline. Later reads identify changed content even when titles and dates match. An unreadable file keeps its previous baseline.

### Local readers

Office XML extraction uses Python 3. On macOS, PDF reading and OCR use PDFKit and on-device Vision. Office page rendering uses a local LibreOffice installation in Applications or the bundled Codex desktop runtime. Conversion runs in a disposable local directory with restricted filesystem access, disabled macros and blocked network access. The reader accepts PDF and Office files up to 32 MiB by default. Set `maxFileBytes` to lower the limit. An existing explicit `maxResponseBytes` also applies to files unless overridden.

OCR can misread formulas and handwriting. Bulk PDF text extraction processes up to 100 pages and up to 12 OCR pages per request. Request a later page individually. LibreOffice layout depends on locally available fonts. The Excel text reader returns cell addresses, stored values and formula text. The visual reader returns one image per call.

## What “read-only” means

The school client has a hardcoded **GET-only API allowlist**. It exposes no generic URL fetch, arbitrary API request, shell command, submission, edit, deletion, quiz-start, timed-review, or progress-write tool. Authenticated redirects are blocked rather than followed with your credentials. Normal school sign-in in the browser may of course use POST requests as part of SSO; these are user-driven login actions, not course-editing tools.

`check_updates` changes private **local** baseline files, so its MCP `readOnlyHint` is correctly `false`. All other tools advertise read-only access. The first check establishes baselines; it does not pretend that existing items are newly posted. A failed or incomplete read preserves the previous successful baseline. A disappeared item is “no longer visible,” not “deleted” or “completed.” Baselines are namespaced by school, account, course and resource.

**No scheduler is running.** The server checks when a host calls it. Reminders, regular checks and notifications require separately configured host automation. A normal local stdio connection does not itself create background monitoring.

## Honest coverage limits

- Structured dates do not capture every instruction in announcement text, slide decks or external systems. Use announcements/materials alongside the deadline tool. “Complete” means the selected API sources answered, not that every school obligation is known.
- A due date is distinct from availability ending. A date-only value is not assigned a fictional time. Dates are rendered in `Europe/Amsterdam`, including daylight-saving changes.
- Course-wide results leave submission status **unknown**. The optional single-folder receipt check distinguishes personal and group receipts. A passed date or absent receipt does not establish missed work. Special access, extensions, exemptions and group-specific dates may need checking in the student UI.
- Legacy binary Office formats, audio and video are outside the document reader. Notebook cells are read as source. OCR, visual rendering and text search each report their own coverage.
- External links and interactive/LTI topics are returned as references, never followed automatically. Osiris and Remindo are not connected. Recurring calendar rules are not expanded into every occurrence.
- File search covers readable course topics and native attachments to visible assignments and announcements. Instruction links contribute their labels and URLs to metadata search. Their destinations are outside the file search.

## Configuration and local data

Default state location:

```text
~/.local/share/personal-brightspace-mcp/
├── config.json
├── session.json       # SENSITIVE: never share or commit
├── notes/             # Private imported school content
└── snapshots/         # Private metadata baselines
```

`config.json` supports:

```json
{
  "baseUrl": "https://brightspace.hhs.nl",
  "timezone": "Europe/Amsterdam",
  "activeOnly": true,
  "includeCourseIds": [],
  "maxCourses": 30,
  "maxPages": 30,
  "requestTimeoutMs": 20000,
  "requestSpacingMs": 200,
  "retries": 2
}
```

An empty course list means all accessible courses within the configured limits. Set `activeOnly` to `false` to include accessible inactive courses. Older materials offered inside an active course are not excluded based on their file name or year. API versions are discovered from the school; `lpVersion` and `leVersion` are optional overrides for supported versions.

Environment overrides: `BRIGHTSPACE_URL`, `BRIGHTSPACE_MCP_HOME`, `BRIGHTSPACE_LP_VERSION`, `BRIGHTSPACE_LE_VERSION`. `BRIGHTSPACE_ACCESS_TOKEN` selects official access-token authentication; it is not written by the program. `BRIGHTSPACE_BROWSER_PATH` affects only interactive browser login.

**Sessions are not encrypted at rest.** State directories use `0700` and files `0600` on macOS/Linux. Anyone controlling your OS account can read them; use device encryption and keep your account secure. On Windows, configure restrictive filesystem ACLs. Never upload state files to a model, GitHub, issue tracker or shared drive. The MCP host can receive the course data you ask it to retrieve, so review that host's data handling policy.

```bash
node dist/index.js logout
```

This deletes the locally saved session and optional remembered browser profile. It does not revoke the school's session or an environment token. Revoke official OAuth access through the school when applicable. Notes and snapshots are retained; remove their directories manually when you want to erase local course history.

## Development and tests

```bash
npm run typecheck
npm test
npm run smoke
```

The core uses Node's standard library and a small, explicitly implemented **stdio MCP protocol subset**, rather than a third-party MCP SDK. This keeps the prebuilt server runnable without npm runtime dependencies. `playwright-core` is optional and loaded only for interactive login. The supported protocol revisions and limitations are documented in `docs/ARCHITECTURE.md`. Migrating the transport to the official SDK is a reasonable future enhancement.

Tests use **synthetic fixtures**. The included `package-lock.json` pins the versions used by `npm ci`. The test report records offline checks separately from authenticated HHS reads.

## Sources and licensing

See `docs/SOURCES.md` for the D2L endpoint documentation, MCP specification, Playwright API and Codex configuration references. This is a new implementation, not a copied fork or an official D2L/HHS product. MIT licensed; see `LICENSE`. Third-party packages retain their own licenses.
