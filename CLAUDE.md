# CLAUDE.md

Read `AGENTS.md` first; it holds the project description, goals, layout, data locations and working rules. This file adds what is specific to Claude Code in this repo.

This copy serves the remote OpenClaw instance, not Claude Desktop. It targets its own Apps Script project with a draft-only token; the runbook is `docs/OPENCLAW-SETUP.md`. The local `.env` points at the simulator and holds no live credential, so anything you run here is offline unless you deliberately point it at the deployment.

## Project in one paragraph

gmail-send renders AI-written email into the exact structure Gmail's web compose produces (replies with `gmail_quote` and `On <date> <person> wrote:` attribution, new messages and forwards with the real account signature from Gmail settings, correct To/Cc, subject prefixes and threading headers) and stores them as Gmail drafts. Delivery is a lightweight Apps Script web app deployed in the user's own account (`apps-script/`), which the Node side talks to over HTTPS; a direct Gmail API mode and an offline simulator with a Gmail-lookalike preview share the same renderer. An MCP server (registered in `.mcp.json`) exposes it as tools; a CLI mirrors them. Plan: `docs/PLAN.md`. Markup reference: `docs/GMAIL-MARKUP.md`. Apps Script protocol: `docs/APPS-SCRIPT-API.md`. Backlog: `docs/build-plan/BACKLOG.md`. After any change under `src/core`, run `npm run build:apps-script` so the bundle in `apps-script/` stays in sync.

## Tools available here

- The `gmail-send` MCP server from `.mcp.json` (simulator by default). Tools: get_profile, list_threads, get_thread, get_message, list_signatures, create_signature, detect_signature, draft_reply, draft_new, draft_forward, update_draft, list_drafts, preview_draft, render_thread_preview, delete_draft, send_draft (gated), get_style_guide, lint_body, sim_seed_demo, sim_receive.
- Optional skills in `.claude/skills` for mirroring the backlog to an issue tracker. They are not required to work on this repo.
- A Gmail connector, if you have one, can read threads for context. Create drafts through gmail-send rather than the connector, because the connector cannot set the HTML, the threading headers or the signature, which is the entire point of this project.

## Issue tracking

Optional. If you bind this repo to a tracker, keep `docs/build-plan/BACKLOG.md` as the source: epics are `##` headings, tickets are checkbox lines. Update the file in the same change that does the work, so the two never drift.

## Conventions

- TypeScript, ESM, strict mode, Node 20+. Tests with vitest (`npm test`), all offline.
- Files end with `.js` in import specifiers (NodeNext resolution).
- No em or en dashes in docs or code comments; a spaced hyphen is fine.
- Email bodies drafted for the account owner follow `./config/style-guide.md` and must pass the linter. Replies to the user in the terminal use the normal assistant voice.
- Secrets never enter git: `config/credentials.json`, `config/token.json`, `.env` are ignored.

## Before finishing a session

1. `npm test` and `npm run typecheck` green.
2. `docs/build-plan/BACKLOG.md` reflects what changed.
3. Any bundle in `apps-script/` rebuilt if `src/core` changed.
