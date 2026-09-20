# AGENTS.md

Instructions for AI agents (Claude Code, Codex, Cursor, OpenClaw, or any MCP client) working in this repository or using it to draft email.

## Which copy this is

This is the OpenClaw deployment of gmail-send. It is a sibling of the laptop
copy that serves Claude Desktop, and it drives a **separate** Apps Script
project in the same mailbox (`jason@tangentsolutions.net`) with its own token
registry and its own switches. Do not copy credentials between the two: each
host holds a token minted for itself, and the OpenClaw one is draft-only.

Setup runbook: `docs/OPENCLAW-SETUP.md`. The `.env` in this working copy is
deliberately set to the simulator and holds no live credential; the real one
lives on the OpenClaw host.

## What this project is

gmail-send makes AI-drafted email indistinguishable from mail typed in Gmail. It renders new messages, replies and forwards in the exact HTML and plain-text structure Gmail's web compose produces (quoting, attribution line, signature block, threading headers, recipients) and stores them as drafts in a real Gmail account. The intended delivery is a lightweight Apps Script project (`apps-script/`) that any account deploys as a small web app; an agent connects to it over HTTPS with a token. The same renderer also runs in Node (direct Gmail API mode) and against an offline simulator for tests and previews. It replaces an earlier Gmail add-on that carried tiers, payments and its own AI calls; none of that is here. The agent supplies the writing, the script only reads mail and writes drafts.

## Goals, in priority order

1. Fidelity. Output must match the observed Gmail markup in `docs/GMAIL-MARKUP.md`. Golden tests in `tests/` pin it. Do not "clean up" markup that looks odd (the `\r\n` tail, the bare first line in replies, U+202F before AM); it is odd because Gmail is.
2. Safety. Drafts only. `send_draft` is gated by `GMAIL_SEND_ALLOW_SEND=1` and off by default. Never commit `config/credentials.json`, `config/token.json` or `.env`.
3. Voice. Email bodies written for the account owner follow the style guide at `./config/style-guide.md` (read it, do not work from memory) and must pass `lint_body` / `npm run cli -- lint`. Hard rules: no em or en dashes, no emojis, avoid honest/genuine/actually/proper/"straight answer", open on substance, one topic per email, close with "Thank you!", "Have a great day!", "Talk soon!" or the next touchpoint, never sign off with a name.
4. Portability. Everything above the provider interface (`src/provider.ts`) must work unchanged against the simulator and the real Gmail adapter.

## Layout

```
src/core/        pure renderer (types, html, wrap, attribution, subject, recipients, compose, mime)
src/drafting.ts  DraftingService: the API agents call
src/provider.ts  MailProvider interface
src/simulator/   offline Gmail (JSON store), demo seed, preview page
src/appsscript/  AppsScriptProvider: HTTPS client for the deployed web app
src/gmail/       direct Gmail API mode: OAuth, API parsing, drafts + sendAs signatures, Calendar timezone
src/signatures/  local library (fallback only), generator, detector
src/style/       style guide loader, linter
src/mcp/         MCP server (stdio)      -> registered in .mcp.json
src/cli/         CLI                     -> npm run cli -- <cmd>
apps-script/     the deployable Apps Script project (Api, GmailAdapter, Drafting, Setup, generated GmailSendCore)
tests/           vitest (npm test)
docs/            PLAN, GMAIL-MARKUP, APPS-SCRIPT-API, ARCHITECTURE, SETUP, build-plan/BACKLOG
config/          signatures.json (committed), style.json, credentials/token (ignored)
.claude/skills/  atlassian-sync, toado-triage
```

## Where the data is

- Signatures: the one Gmail shows in Settings (sendAs) is always the default when a real account is connected (`appsscript` or `gmail` provider). `config/signatures.json` is a fallback library (the owner's signature is in there, id `sam@northwind.example`) used only when the account has none or when chosen by id.
- Timezone: from the connected account's primary Google Calendar, override with `GMAIL_SEND_TIMEZONE`, falling back to America/New_York.
- Apps Script deployment: URL + token in `.env`; the token also lives in the script's Script Properties.
- Style rules: `config/style.json`; prose guide at `config/style-guide.md`, pointed at by `.env` (`GMAIL_SEND_STYLE_GUIDE`). It lives in the repo on purpose, so a clone on the OpenClaw host carries the voice instead of falling back to a generic summary.
- Simulator mailbox: `.gmail-sim/store.json` (reset with `npm run cli -- sim reset`, seed with `sim seed`).
- Previews: `preview/*.html`.
- Ground truth: `docs/GMAIL-MARKUP.md`. The raw samples were the author's own sent mail; they are not stored in the repo.
- Backlog: `docs/build-plan/BACKLOG.md`. It doubles as the source for issue tracking, if you wire one up.

## Commands

```
npm install
npm test                       # all offline, must stay green
npm run typecheck
npm run cli -- sim demo --open # seed + reply draft + preview page
npm run cli -- help
npm run mcp                    # start the MCP server on stdio (Claude Code does this via .mcp.json)
npm run build:apps-script      # regenerate apps-script/GmailSendCore.js after any src/core change
```

## Working rules for agents

- Before drafting for the account owner: call `get_style_guide`, read the thread with `get_thread`, write the body as plain text (greeting, paragraphs, closing, no signature, no name), run `lint_body`, then `draft_reply` / `draft_new` / `draft_forward`. Review the returned text. Use `preview_draft` when a human needs to eyeball it.
- Never hand-edit rendered HTML. Change the typed body and let `update_draft` re-render.
- When you change anything under `src/core`, run `npm test`. If Gmail's real output differs from a test, the test is updated only with a fresh sample from a real Gmail send, documented in `docs/GMAIL-MARKUP.md`.
- Keep the provider interface stable; add capabilities to both providers or make them optional.
- Work tracking: keep `docs/build-plan/BACKLOG.md` current in the same change that does the work. Optional skills for mirroring it to an issue tracker live in `.claude/skills`.
- Commit messages: conventional style (`feat(core): ...`, `fix(sim): ...`).

## Things not to do

- Do not send mail from tests or demos. The simulator's `send` is local only; the Gmail provider's send is gated.
- Do not add an LLM call to the core renderer. Rendering is deterministic.
- Do not store third-party email content in the repo. Fixtures are synthetic.
