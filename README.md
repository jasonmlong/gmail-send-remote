# gmail-send (OpenClaw deployment)

This copy of gmail-send targets the remote OpenClaw instance rather than Claude
Desktop on the laptop. It drives its own Apps Script project in
`jason@tangentsolutions.net`, with a draft-only token minted for that host
alone, so revoking or rotating one deployment leaves the other untouched. Start
at [docs/OPENCLAW-SETUP.md](docs/OPENCLAW-SETUP.md).

Gmail-identical drafting for AI agents. Renders new messages, replies and forwards in the exact HTML and plain-text structure Gmail's web compose produces (quoting, attribution, the account's real signature, threading, recipients) and stores them as drafts in a real Gmail account. Deploy the lightweight Apps Script project in any account, hand the agent the URL and token, and it writes native drafts; the same renderer runs in Node against the Gmail API or an offline simulator. Exposed to agents as an MCP server and a CLI.

The MCP draft tools now accept `bodyBlocks` for structured formatting. Paragraph runs support bold, italic, underline, safe links, and text sizes; list blocks produce real bullet or numbered lists. Pass `bodyBlocks` instead of the plain `body` field. `lint_body` accepts the same blocks, and `update_draft` can reformat an existing draft without changing its recipients. The text/plain part includes link destinations for review. Formatting uses standard email HTML elements, though its exact serialization has not yet been compared with a fresh Gmail web sample.

```json
[
  { "type": "paragraph", "runs": [{ "text": "Why octopuses are remarkable", "bold": true, "size": "large" }] },
  { "type": "bulletedList", "items": [[{ "text": "They solve puzzles" }], [{ "text": "They change color" }]] }
]
```

The OpenClaw host must be updated and its MCP process restarted before its agent sees the new tool schemas. The local code generates the MIME sent through the existing raw-draft action, so that path does not require an Apps Script redeployment. Direct callers of the script's high-level draft actions need the updated bundle deployed.

- Plan and feature list: [docs/PLAN.md](docs/PLAN.md)
- Apps Script deployment: [apps-script/README.md](apps-script/README.md) and the wire protocol [docs/APPS-SCRIPT-API.md](docs/APPS-SCRIPT-API.md)
- Structured formatting security review: [docs/FORMATTING-SECURITY-REVIEW.md](docs/FORMATTING-SECURITY-REVIEW.md)
- Gmail markup reference (the ground truth): [docs/GMAIL-MARKUP.md](docs/GMAIL-MARKUP.md)
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Setup, OAuth, MCP registration: [docs/SETUP.md](docs/SETUP.md)
- Wiring it to OpenClaw, start to finish: [docs/OPENCLAW-SETUP.md](docs/OPENCLAW-SETUP.md)
- Brief to hand the agent that administers the OpenClaw host: [docs/OPENCLAW-AGENT-BRIEF.md](docs/OPENCLAW-AGENT-BRIEF.md)
- Running it on a remote host in general: [docs/REMOTE-DEPLOY.md](docs/REMOTE-DEPLOY.md)
- Backlog mirrored to Jira: [docs/build-plan/BACKLOG.md](docs/build-plan/BACKLOG.md)
- Agent instructions: [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md)

Quick start:

```
npm install
npm test
npm run cli -- sim demo --open
```
