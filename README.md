# gmail-send (OpenClaw deployment)

This copy of gmail-send targets the remote OpenClaw instance rather than Claude
Desktop on the laptop. It drives its own Apps Script project in
`jason@tangentsolutions.net`, with a draft-only token minted for that host
alone, so revoking or rotating one deployment leaves the other untouched. Start
at [docs/OPENCLAW-SETUP.md](docs/OPENCLAW-SETUP.md).

Gmail-identical drafting for AI agents. Renders new messages, replies and forwards in the exact HTML and plain-text structure Gmail's web compose produces (quoting, attribution, the account's real signature, threading, recipients) and stores them as drafts in a real Gmail account. Deploy the lightweight Apps Script project in any account, hand the agent the URL and token, and it writes native drafts; the same renderer runs in Node against the Gmail API or an offline simulator. Exposed to agents as an MCP server and a CLI.

- Plan and feature list: [docs/PLAN.md](docs/PLAN.md)
- Apps Script deployment: [apps-script/README.md](apps-script/README.md) and the wire protocol [docs/APPS-SCRIPT-API.md](docs/APPS-SCRIPT-API.md)
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
