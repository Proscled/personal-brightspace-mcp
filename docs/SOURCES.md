# Implementation references

Consulted on 3 November 2026. The code is a new implementation; these links describe protocols and endpoint contracts, not evidence of HHS-specific compatibility.

## D2L primary documentation

- API versions and discovery: https://docs.valence.desire2learn.com/res/apiprop.html
- API calling conventions: https://docs.valence.desire2learn.com/basic/apicall.html
- Official OAuth registration and scopes: https://docs.valence.desire2learn.com/basic/oauth2.html
- User context and identity: https://docs.valence.desire2learn.com/res/user.html
- Own course enrollments: https://docs.valence.desire2learn.com/res/enroll.html
- Assignment folders and availability: https://docs.valence.desire2learn.com/res/dropbox.html
- Announcements: https://docs.valence.desire2learn.com/res/news.html
- Own grade values: https://docs.valence.desire2learn.com/res/grade.html
- Own calendar events: https://docs.valence.desire2learn.com/res/calendar.html
- Course outline, topics and files: https://docs.valence.desire2learn.com/res/content.html
- Quiz metadata: https://docs.valence.desire2learn.com/res/quiz.html
- Scope index: https://docs.valence.desire2learn.com/http-scopestable.html

## Protocol and host documentation

- MCP stdio transport: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- MCP initialization lifecycle: https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- MCP tool definitions: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- Codex MCP configuration: https://developers.openai.com/codex/mcp/
- Claude Desktop local MCP configuration (checked 4 November 2026): https://modelcontextprotocol.io/docs/develop/connect-local-servers
- Claude Code MCP configuration (checked 4 November 2026): https://code.claude.com/docs/en/mcp
- Playwright browser contexts/cookies: https://playwright.dev/docs/api/class-browsercontext

An existing community project was reviewed for context, not copied into this implementation:
https://github.com/RohanMuppa/brightspace-mcp-server

Its claims about school support are not a substitute for testing the user's account and school policy. The personal server here has a narrower feature set and does not copy its automated password/MFA workflow.

- Assignment rubric definitions and visibility: https://docs.valence.desire2learn.com/res/assessment.html
- Assignment attachment IDs and download: https://docs.valence.desire2learn.com/res/dropbox.html
- Announcement attachments: https://docs.valence.desire2learn.com/res/news.html
