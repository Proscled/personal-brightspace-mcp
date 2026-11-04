# Brightspace Study for the ChatGPT plugin directory

**Prototype for fictional data.** HHS prohibits using school personal data and confidential information in generative AI, even with individual consent. This also applies to the personal Codex workflow. Use fictitious students and self-authored materials for testing. [HHS ICT Regulations, article 13(5)(d)](https://www.dehaagsehogeschool.nl/media/reglement-ict#page=7)

**Public listing eligibility.** OpenAI excludes plugins that primarily serve as unofficial third-party connectors. The current independent connector appears to fall under that exclusion. The existing name is a working title. D2L prohibits using its trademarks in an app name. OAuth registration alone resolves neither issue. The publication steps below apply only if an eligible, authorized design is established. [OpenAI plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines#third-party-content-and-integrations) · [D2L trademark guidelines](https://www.d2l.com/legal/trademarks/)

## Prepare and publish a release

1. Deploy the web MCP service at a stable public HTTPS address and configure the school sign-in integration for individual accounts. Obtain a registered client ID and secret for ChatGPT to connect to the service.
2. Complete the private browser test below with an institution-approved reviewer account containing sample data. OpenAI asks that reviewer access work without waiting for a separate MFA approval or code. Arrange approved reviewer access with the institution if required. Keep your personal account out of the review.
3. Check the draft listing and eight proposed review prompts in `packaging/web/plugin.json`. Before the final release, add your verified publisher name to `extensions.com.openai.interface.developerName` and your public HTTPS pages to `websiteURL`, `supportURL`, `privacyPolicyURL`, and `termsOfServiceURL` in the same object. Include an accessible recording in `extensions.com.openai.review.demo_recording_url` or supply it in the dashboard. Update the release version and notes for later releases.
4. Build the publisher ZIP below. In the OpenAI Platform **Plugins** dashboard, choose **Upload new or existing plugin**. Select the verified developer identity and upload the ZIP. Configure the **With MCP** connection, provide the OAuth client secret privately when prompted, complete the domain challenge, and check the scanned tools. [Start a plugin submission](https://platform.openai.com/plugins)
5. Enter the reviewer account in **Review details**, check the imported materials, and submit for review. After approval, select **Publish plugin**. You can then share the directory listing with students. [OpenAI submission guide](https://developers.openai.com/plugins/deploy/submission)

The ZIP is an operator draft. Creating it does not host the service, submit a review request, or create a listing.

## Verify the hosted plugin in a private browser chat

This stage tests tool discovery, account linking and course retrieval before public submission.

1. In ChatGPT, open **Plugins**, select **+**, then **Add custom MCP server**. Availability depends on your ChatGPT account and workspace permissions. If the option is missing in a managed workspace, contact the workspace administrator. [Open ChatGPT Plugins](https://chatgpt.com/plugins)
2. Enter **Brightspace Study** for the name. For **Server URL**, enter the operator's full HTTPS address ending in `/mcp`.
3. Choose **OAuth** and enter the registered client ID and client secret in ChatGPT's connection settings. These are credentials for the service's ChatGPT integration. School passwords and MFA codes belong only on the school's sign-in page.
4. The operator must allow the exact OAuth redirect URI shown for this connection on the service. Review the connection details, select **Create as a plugin**, and check the tools that ChatGPT discovers. Complete the school sign-in and consent when prompted.
5. Install the private plugin. Start a fresh conversation, type `@`, select **Brightspace Study**, and ask “Which courses can you see?” Compare a course to your Brightspace home page. Then try “What assignments are due this week?” and “Read one course document and cite its page or slide.” Check that missing data and inaccessible materials are reported clearly.

If tools change, use **Refresh** in the plugin's connection details and start a fresh chat. Enterprise GitHub imports can carry a **Desktop only** label even when they declare a remote MCP server. Follow the custom MCP flow above to verify the browser experience. [OpenAI browser connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt) · [OAuth callback requirements](https://developers.openai.com/plugins/build/auth) · [Workspace import guide](https://learn.chatgpt.com/docs/enterprise/plugin-management)

The draft review prompts assume a sample course named **Study Skills Demo**, a **Practice Report** assignment with a template link, a due date of May 6, 2027 and an availability end of May 8, a published announcement, and a **Regression Basics** slide deck. Adapt the prompts and expected answers to the actual approved sample course, run all eight in ChatGPT, and record the results before submission. Their inclusion in the manifest records proposed checks. It does not certify they passed.

## Build a publisher ZIP

From the repository root, run the following with Python 3.8+. Use the same public origin and **public client identifier** configured on your web service. The origin uses HTTPS on port 443 and excludes the `/mcp` path. Packaging runs offline.

```sh
python3 packaging/web/build.py \
  --origin "$BRIGHTSPACE_WEB_ORIGIN" \
  --client-id "$BRIGHTSPACE_WEB_CLIENT_ID" \
  --output brightspace-study.zip
```

The ZIP contains the plugin listing, its icon, and a Streamable HTTP connection to `/mcp`. Its OAuth configuration uses a previously registered client, HTTP Basic client authentication at the token endpoint, the `brightspace.read` scope, and the service's `/oauth/authorize` and `/oauth/token` endpoints. Supply the client secret directly in the private connection or submission form. The generator accepts only public configuration. [OpenAI plugin packaging guide](https://developers.openai.com/plugins/build/plugins)

The generic Agent Plugins 1.0.0 JSON schema currently rejects additional properties on HTTP server entries, including the per-server `extensions` field. This package follows the OpenAI submission format, which reads its OAuth settings from that field. Check the imported OAuth settings in the OpenAI dashboard after uploading a draft. [Generic MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json) · [OpenAI submission authentication](https://developers.openai.com/plugins/deploy/submission#configure-authentication-for-submission)
