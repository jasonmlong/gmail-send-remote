# Backlog (mirror for Jira)

Each `##` heading is a Jira epic. Each `- [ ]` / `- [x]` line is a ticket. When the Jira project exists, the atlassian-sync skill creates the epics and tickets from this file (search before create, label `claude-sync`) and marks the checked ones Done with a comment pointing at the commit. Update this file and Jira together.

Legend: `[x]` done and tested in this repo, `[ ]` open, `(blocked: ...)` needs something outside the repo.

## E1 Rendering engine (Gmail-identical HTML and text)

- [x] T1.1 Core types, address parsing/formatting, alias-aware comparisons (`src/core/types.ts`, `src/core/address.ts`)
- [x] T1.2 Typed text to Gmail compose HTML, new vs reply first-line rule, `&#39;` escaping, auto-links (`src/core/html.ts`)
- [x] T1.3 Gmail HTML-to-text conversion: blocks, tables, `[image: alt]`, `text <href>` links, mailto/tel stripping (`src/core/html.ts`)
- [x] T1.4 Attribution line and date format with U+202F, timezone option, `wrote:` line-break rule (`src/core/attribution.ts`)
- [x] T1.5 Reply composition: quote container, verbatim nested original, signature after or before quote (`src/core/compose.ts`)
- [x] T1.6 New message composition with smartmail signature block
- [x] T1.7 Forward composition: header block with mailto links, `msg-` wrapper and id prefixing, attachments, note above
- [x] T1.8 Reply / Reply all recipient rules and Re:/Fwd: subject rules (`src/core/recipients.ts`, `src/core/subject.ts`)
- [x] T1.9 MIME builder: quoted-printable, RFC 2047 headers, In-Reply-To/References, multipart/mixed attachments (`src/core/mime.ts`)
- [x] T1.10 Golden tests pinned to the observed Gmail samples (`tests/compose.test.ts`, `tests/html.test.ts`, `tests/mime.test.ts`)
- [ ] T1.11 Fidelity diff tool: render the same inputs as a real Gmail-sent message and diff HTML/text
- [ ] T1.12 Inline image (cid) support in bodies and signatures
- [x] T1.13 Structured Gmail formatting for MCP and Apps Script high-level drafts: emphasis, links, sizes, lists, plain-text alternative, update preservation, and offline MCP regression tests (`src/core/rich-body.ts`, `tests/rich-body.test.ts`)
- [ ] T1.14 Compare structured formatting with a fresh Gmail web compose sample and document serialization differences
- [x] T1.15 Adversarial security review of formatted links, direct HTTP validation, metadata limits, and stale draft updates (`docs/FORMATTING-SECURITY-REVIEW.md`)

## E2 Signatures

- [x] T2.1 Local signature library with default flag (`src/signatures/store.ts`, `config/signatures.json`, the owner's real signature stored)
- [x] T2.2 Gmail sendAs signatures read and write (`src/gmail/client.ts`)
- [x] T2.3 Signature generator, plain and card styles (`src/signatures/template.ts`)
- [x] T2.4 Deterministic detection from sent mail via the `gmail_signature` block (`src/signatures/detect.ts`)
- [x] T2.5 Signature text form derived with Gmail's conversion rules
- [x] T2.6 Placement setting (after-quote default, before-quote option)
- [ ] T2.7 Auto-select the signature matching the From alias (tracked as T9.4)
- [ ] T2.8 Live check: signatures listed from the owner's account match Gmail settings (via the Apps Script deployment, T7.9)

## E3 Simulator and preview

- [x] T3.1 SimulatedGmail provider: threads, messages, drafts, signatures, aliases, Gmail-like ids and Message-IDs, JSON persistence (`src/simulator/simulator.ts`)
- [x] T3.2 Gmail search subset (from:, to:, subject:, in:, is:, label:, bare words, negation)
- [x] T3.3 Send and receive loop to drive multi-turn conversations
- [x] T3.4 Demo mailbox seed (`src/simulator/seed.ts`)
- [x] T3.5 Gmail-lookalike conversation preview page with compose box (`src/simulator/preview.ts`)
- [ ] T3.6 Preview parity pass: compare the preview page against Gmail screenshots and tune CSS

## E4 Gmail adapter

- [x] T4.1 OAuth loopback flow, token storage, scopes (`src/gmail/auth.ts`)
- [x] T4.2 Gmail API message parsing to the shared model (`src/gmail/parse.ts`)
- [x] T4.3 Drafts create/update/list/get/delete/send from raw MIME with threadId (`src/gmail/client.ts`)
- [x] T4.4 Draft render metadata cache so update_draft can re-render Gmail drafts
- [ ] T4.5 Create the Google Cloud OAuth client (Desktop app), enable Gmail API, save `config/credentials.json` (blocked: the owner's Google Cloud project)
- [ ] T4.6 Live verification: reply draft in a real thread opens in Gmail identical to a typed reply (blocked: T4.5)
- [ ] T4.7 Live verification: sent MIME diffed against a Gmail-sent message to a test address (blocked: T4.5)
- [ ] T4.8 Attachments from local files on new drafts (CLI/MCP flag)

## E5 Agent surface (MCP, CLI, drafting service)

- [x] T5.1 DraftingService: identity, signature resolution, reply/new/forward/update, send gate (`src/drafting.ts`)
- [x] T5.2 MCP server with the full tool set (`src/mcp/server.ts`)
- [x] T5.3 CLI mirroring the tools (`src/cli/index.ts`)
- [x] T5.4 `.mcp.json` registration for Claude Code
- [x] T5.5 Runtime wiring and `.env` config (`src/runtime.ts`, `src/config.ts`, `.env.example`)
- [ ] T5.6 MCP smoke test in CI (initialize + tools/list over stdio)
- [ ] T5.7 Claude Desktop config snippet and docs

## E6 Voice and style

- [x] T6.1 Style linter with configurable rules (`src/style/lint.ts`, `config/style.json`)
- [x] T6.2 Style guide loader and MCP tool (`src/style/guide.ts`)
- [ ] T6.3 Learn-from-sent style profile (port EmailDrafter `writing_style_helpers.js`, deterministic stats + optional LLM summary)
- [ ] T6.4 Per-recipient tone hints (history with the sender, like EmailDrafter's `getPreviousEmails`)

## E7 Lightweight Apps Script API (replaces EmailDrafter)

Decision, 2026-09-19: EmailDrafter is retired; ship a free, lightweight Apps Script project any account can deploy, which an agent connects to.

- [x] T7.1 Renderer made runtime-agnostic (no Buffer/crypto/TextEncoder; date formatting hooks) and bundled (`src/core/encoding.ts`, `scripts/build-apps-script.mjs`)
- [x] T7.2 Web app endpoint with token auth and action table (`apps-script/Api.js`)
- [x] T7.3 Gmail adapter in-script: profile, threads, messages, sendAs signatures, timezone from Calendar, drafts from raw MIME via Advanced Gmail Service (`apps-script/GmailAdapter.js`)
- [x] T7.4 High-level actions that render in-script: draftReply, draftNew, draftForward, redraft (`apps-script/Drafting.js`)
- [x] T7.5 Setup and self-test functions: setup(), rotateToken(), setAllowSend(), selfTest(), testDraftLatestInbox() (`apps-script/Setup.js`)
- [x] T7.6 Node client `AppsScriptProvider` so the MCP server/CLI work against the deployed script (`src/appsscript/client.ts`, tested with a fake endpoint)
- [x] T7.7 Wire protocol documented (`docs/APPS-SCRIPT-API.md`), deployment README (`apps-script/README.md`)
- [x] T7.8 Bundle verified in a Node vm context with no Node globals (Apps Script-like)
- [ ] T7.9 Deploy in the owner's account, run setup() and testDraftLatestInbox(), compare the draft in Gmail with a hand-typed reply (blocked: needs deploying)
- [ ] T7.10 Point the MCP server at the deployment (`GMAIL_SEND_PROVIDER=appsscript`) and run the agent workflow end to end
- [ ] T7.11 clasp-based push script and a versioned deployment checklist
- [ ] T7.12 Optional add-on card (homepage showing status, token hint) for accounts that prefer a UI over the editor
- [ ] T7.13 Optional Marketplace listing (needs Google OAuth verification for Gmail scopes); decide after T7.9

## E10 Security hardening (adversarial review, 2026-09-19)

Four independent adversarial passes before the first public deployment. Findings and reasoning in [../SECURITY-REVIEW.md](../SECURITY-REVIEW.md).

- [x] T10.1 CRLF header injection closed at three layers: parser unfolds and collapses breaks, message builder throws on any header value containing one, MCP recipient schemas refuse them (`src/core/address.ts`, `src/core/mime.ts`, `src/mcp/server.ts`)
- [x] T10.2 Inbound HTML can no longer escape the quote block; unbalanced closing tags are neutralised and open tags closed (`src/core/html.ts`, `src/core/compose.ts`)
- [x] T10.3 Unauthenticated probe reduced to the product name only (`apps-script/Api.js`)
- [x] T10.4 Action dispatch checks own properties and callability, so inherited names are not actions (`apps-script/Api.js`)
- [x] T10.5 Token checked before any work, so an anonymous caller cannot burn the owner's execution quota
- [x] T10.6 Gmail signature write gated behind an editor-only switch, refuses an empty value, stashes the previous one, and `restoreSignature()` puts it back (`apps-script/GmailAdapter.js`, `apps-script/Setup.js`)
- [x] T10.7 MCP `create_signature` writes only to the local library; pushing to Gmail settings is a deliberate human CLI action
- [x] T10.8 Draft deletion restricted to drafts this tool created, in the endpoint, the MCP tool and the CLI
- [x] T10.9 Raw messages filtered to the headers the renderer produces, removing the arbitrary-header primitive
- [x] T10.10 Search scope enforced inside the Apps Script so it binds direct HTTP callers (`setSearchScope`)
- [x] T10.11 Bcc removed from agent-facing schemas; recipients removed from `update_draft` so an approved draft cannot be re-addressed
- [x] T10.12 Recipients whose domain is new to the thread are flagged back to the agent
- [x] T10.13 `send_draft` registered only when sending is enabled; the meaningless `confirm` parameter removed
- [x] T10.14 Attribute-level escaping for addresses in forwarded headers (`escapeAttr`)
- [x] T10.15 Out-of-range character reference no longer throws, so a crafted message cannot become unanswerable
- [x] T10.16 Unknown message id returns a clean error instead of a null dereference
- [x] T10.17 `config/signatures.json` git-ignored; `config/signatures.example.json` shipped
- [x] T10.18 Regression tests for every finding (`tests/security.test.ts`) and the first real endpoint tests, running the actual Apps Script files against stubbed Google services (`tests/appsscript-endpoint.test.ts`)
- [x] T10.19b Per-token capabilities (read / draft / send / settings), enforced in the dispatcher and combined with the global switches, so a credential issued to a remote agent cannot send regardless of any setting (`apps-script/Api.js`, `apps-script/Setup.js`)
- [x] T10.19c Tokens stored as SHA-256 hashes and shown once at mint time; mint, list, revoke and purge from the editor only
- [x] T10.19d MCP server probes the backend and advertises a send tool only when the credential in use can actually send (`src/mcp/server.ts`)
- [ ] T10.19 Decide whether the deployment can move off anonymous access, which needs the Node client to carry a Google identity
- [ ] T10.20 Set a search scope on the deployment once it is live
- [ ] T10.21 Bind human approval to a content hash if sending is ever enabled, so a draft cannot be re-rendered between review and send
- [ ] T10.22 Re-run the z.ai pass once that account has balance

## E9 Signature and timezone fidelity (from the review)

- [x] T9.1 Signature Gmail shows (sendAs) is the default everywhere; local library only as fallback or explicit choice (`src/drafting.ts`, tests/drafting.test.ts)
- [x] T9.2 Timezone from Google Calendar per user (Gmail provider via Calendar API, Apps Script via CalendarApp), config override, New York fallback
- [x] T9.3 Verified against sources: sendAs `signature` field and Advanced Gmail Service docs; the owner's calendar timezone (America/Cancun) matches his reply sample
- [ ] T9.4 Auto-select the signature matching the From alias (moved from T2.7)

## E8 Docs, ops and tracking

- [x] T8.1 PLAN, GMAIL-MARKUP, ARCHITECTURE, SETUP docs
- [x] T8.2 AGENTS.md and CLAUDE.md
- [x] T8.3 `.atlassian-sync.json` binding prepared (keys to fill), skills installed in `.claude/skills`
- [ ] T8.4 Create Jira project + Confluence space, fill keys, run atlassian-sync init and log this backlog (blocked: needs the project created)
- [ ] T8.5 Initial git commit and remote
- [ ] T8.6 GitHub Actions: typecheck + tests on push
- [x] T8.7 Expand the root README and OpenClaw runbook with separate OpenClaw and Claude Desktop topology, first-time and update instructions for Apps Script, host setup, formatting examples, and verification steps
- [x] T8.8 Add Apache-2.0 license files and package metadata
- [x] T8.9 Refresh Node 20 compatible Google API and test dependencies; full audit reports zero vulnerabilities
- [x] T8.10 Make `tsx` a production dependency, document production-safe installs, and regress the MCP launcher's package classification

## E11 OpenClaw deployment (remote host behind Cloudflare Zero Trust)

This repository copy serves the OpenClaw instance rather than Claude Desktop, through a second Apps Script project in the same mailbox.

- [x] T11.1 Full runbook: new Apps Script project, draft-only `openclaw` token, host install, OpenClaw registration, Cloudflare notes (`docs/OPENCLAW-SETUP.md`)
- [x] T11.2 Live credential inherited from the laptop copy removed from `.env`; this working copy defaults to the simulator and holds no secret
- [x] T11.3 `.env.openclaw.example` for the host, with the reasoning for each value rather than bare keys
- [x] T11.4 Style guide moved into the repo at `config/style-guide.md`, so a clone on the host writes in the account owner's voice instead of the built-in fallback
- [x] T11.5 README, AGENTS.md and CLAUDE.md state which copy this is and where its credential lives
- [ ] T11.6 Create the Apps Script project, deploy it, mint the `openclaw` token (blocked: browser work in the mailbox owner's account)
- [ ] T11.7 Apply the search scope to the new deployment and record what it is (the E10 T10.20 equivalent for this deployment)
- [ ] T11.8 Clone on the host, verify `profile` shows `["read","draft"]` and `canSend: false`, register with `openclaw mcp add`, confirm 17 tools
- [ ] T11.9 Confirm outbound HTTPS to `script.google.com` and `script.googleusercontent.com` survives the Gateway egress policy, and that TLS inspection (if on) trusts cleanly
- [ ] T11.10 First real draft from OpenClaw compared against a hand-typed Gmail reply

## E12 Adversarial review before the OpenClaw deployment (2026-09-20)

Two passes (Codex, local). Findings and reasoning in `docs/SECURITY-REVIEW.md`; regressions in `tests/appsscript-endpoint.test.ts` (R1-R8) and `tests/review-2026-09-20.test.ts`.

- [x] T12.1 updateDraft requires existing ownership metadata, closing the update-then-delete chain that let a draft-only token destroy hand-written drafts (`apps-script/GmailAdapter.js`)
- [x] T12.2 Bcc removed from every high-level action and from the raw-header allowlist (`apps-script/Drafting.js`, `apps-script/GmailAdapter.js`)
- [x] T12.3 setup() no longer resurrects a revoked primary token, and no longer stores it in plaintext; shown once, rotateToken() replaces it (`apps-script/Setup.js`)
- [x] T12.4 Search scope enforced on reads by thread and message id, not only searches, with its real reach documented (`apps-script/GmailAdapter.js`)
- [x] T12.5 listDrafts and getDraft restricted to drafts this API created (`apps-script/GmailAdapter.js`)
- [x] T12.6 Render cache compared against the live message; stale cache dropped so summaries cannot report approved recipients for a changed draft, and update_draft fails closed instead of reinstating them (`src/appsscript/client.ts`, `src/drafting.ts`)
- [x] T12.7 Unfamiliar-recipient warning excludes draft messages, so a staged recipient cannot make its own domain familiar (`src/mcp/server.ts`)
- [x] T12.8 Endpoint URL pinned to https on script.google.com; response bodies no longer echoed into errors (`src/appsscript/client.ts`)
- [x] T12.9 Preview HTML sanitised and served under a CSP with a per-page nonce (`src/simulator/preview.ts`)
- [x] T12.10 Token shape checked before any properties read; request body capped; capability errors no longer enumerate the token's reach (`apps-script/Api.js`)
- [x] T12.11 Draft cache and previews written 0600 into 0700 directories (`src/draft-meta.ts`, `src/private-file.ts`)
- [x] T12.12 Docs corrected where they overstated a guarantee (`apps-script/README.md`, `docs/APPS-SCRIPT-API.md`, `docs/SETUP.md`, `docs/OPENCLAW-SETUP.md`)
- [x] T12.15 Narrowed OAuth grant (gmail.readonly + gmail.compose, replacing gmail.modify) verified on the live deployment: selfTest() and testDraftLatestInbox() both pass, covering search, signature read, Drafts.create and the Drafts.get plus getMessageById readback
- [x] T12.16 Remove the cross-file capabilities global, report the deployed Apps Script version through `profile`, and regress the editor-call fallback (`apps-script/Api.js`, `apps-script/GmailAdapter.js`, `apps-script/Setup.js`, `tests/appsscript-endpoint.test.ts`)
- [ ] T12.13 Confirm on the live deployment that Gmail's compose view shows a Bcc set on an API-created draft (the assumption behind S20.2's severity)
- [ ] T12.14 Re-run the z.ai pass once that account has balance (same blocker as T10.22)
