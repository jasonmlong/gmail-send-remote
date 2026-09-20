# Architecture

```
agent (Claude Code / Claude Desktop / script)
        |  MCP (stdio)            |  CLI
        v                         v
   src/mcp/server.ts         src/cli/index.ts
        \                       /
         v                     v
        src/runtime.ts  (config -> provider -> DraftingService)
                 |
        src/drafting.ts  DraftingService
          - identity (From + aliases)
          - signature resolution (provider + local library)
          - composeNew / composeReply / composeForward   <- src/core (pure, tested)
          - buildMime                                     <- src/core/mime.ts
          - provider.createDraft / updateDraft / sendDraft
                 |
        src/provider.ts  MailProvider interface
          /               |                        \
 src/simulator/     src/appsscript/            src/gmail/
 SimulatedGmail     AppsScriptProvider         GmailProvider
 JSON store, seed,  HTTPS -> web app token     googleapis, OAuth loopback,
 preview page       (no Google creds here)     Calendar for timezone
                          |
                   apps-script/  (deployed inside the user's Google account)
                     Api.js        doPost, token check, action table
                     GmailAdapter  GmailApp + Advanced Gmail Service (sendAs signatures, raw drafts), CalendarApp timezone
                     Drafting.js   draftReply/draftNew/draftForward/redraft rendered in-script
                     GmailSendCore.js  = bundle of src/core (same renderer)
```

The same `src/core` renderer runs in Node and inside Apps Script (bundled). Apps Script's V8 has no timezone data in `Intl`, so `attribution.ts` and `mime.ts` expose `setDateTimeFormatter` / `setRfc2822Formatter` hooks that the script backs with `Utilities.formatDate`. `encoding.ts` supplies UTF-8 and base64 without Buffer.

## Modules

| Path | Responsibility |
|---|---|
| `src/core/types.ts` | Shared model: EmailAddress, Message, Thread, Signature, RenderedMessage, Draft, compose options |
| `src/core/address.ts` | Parse/format RFC 5322 addresses, alias-aware equality, de-dup |
| `src/core/html.ts` | Gmail escaping, auto-linking, typed text to compose HTML, Gmail HTML-to-text |
| `src/core/wrap.ts` | 72 column wrap, `>` quoting, tidy |
| `src/core/attribution.ts` | `On <date> <who> wrote:` and forwarded-message headers, date formatting with U+202F, timezone |
| `src/core/subject.ts` | `Re:` / `Fwd:` rules |
| `src/core/recipients.ts` | Reply / Reply all recipient selection |
| `src/core/compose.ts` | The three renderers; signature placement; forward `msg-` wrapper |
| `src/core/mime.ts` | RFC 822 output, quoted-printable, RFC 2047, base64url, Gmail-style boundaries and Message-IDs (runtime-agnostic) |
| `src/core/encoding.ts` | UTF-8 / base64 / random without Node globals |
| `src/core/browser.ts` | Bundle entry for Apps Script |
| `src/provider.ts` | `MailProvider` interface all three backends implement |
| `src/appsscript/client.ts` | `AppsScriptProvider`: HTTPS client for the deployed web app |
| `src/draft-meta.ts` | Local cache of what was rendered per remote draft (for update_draft) |
| `apps-script/*` | The deployable Apps Script project (see apps-script/README.md) |
| `src/drafting.ts` | `DraftingService`, the API agents use |
| `src/config.ts` | `.env` loading and `AppConfig` |
| `src/runtime.ts` | Builds provider + service from config |
| `src/signatures/*` | Local library, generator, deterministic detector |
| `src/simulator/*` | Offline mailbox, demo seed, Gmail-lookalike preview page |
| `src/gmail/*` | OAuth, API message parsing, drafts and sendAs settings |
| `src/style/*` | Style guide loader and body linter |
| `src/mcp/server.ts` | MCP tools |
| `src/cli/index.ts` | CLI |
| `tests/*` | Vitest suites, golden fixtures live inline in `tests/helpers.ts` |

## Data locations

| What | Where | Committed |
|---|---|---|
| Signature library, fallback only (the Gmail account's own signature wins) | `config/signatures.json` | no (git-ignored; `config/signatures.example.json` is committed) |
| Style rules for the linter | `config/style.json` | yes |
| Prose style guide | path in `GMAIL_SEND_STYLE_GUIDE` (default `./config/style-guide.md`) | external |
| Apps Script web app URL + token | `.env` (`GMAIL_SEND_APPS_SCRIPT_URL`, `GMAIL_SEND_APPS_SCRIPT_TOKEN`); token also in the script's Script Properties | no |
| OAuth client (direct Gmail mode only) | `config/credentials.json` | no (git-ignored) |
| OAuth token (direct Gmail mode only) | `config/token.json` | no |
| Simulator state | `.gmail-sim/store.json` | no |
| Remote draft render metadata (for update_draft) | `.gmail-sim/gmail-draft-meta.json`, `.gmail-sim/appsscript-draft-meta.json` | no |
| Per-draft metadata inside the script (for redraft) | User Properties of the Apps Script project | n/a |
| Preview pages | `preview/*.html` | no |
| Ground-truth notes | `docs/GMAIL-MARKUP.md` | yes |
| Backlog mirrored to Jira | `docs/build-plan/BACKLOG.md` | yes |
| Atlassian binding | `.atlassian-sync.json`, `.atlassian-sync/manifest.json` | yes |

## Key flows

Draft a reply (MCP `draft_reply` or CLI `draft reply`):

1. `DraftingService.targetMessage` fetches the thread and picks the latest message (or the given `messageId`).
2. `identity()` resolves From and the list of "my" addresses from the provider profile.
3. `resolveSignature()` picks the requested, default or first non-empty signature from the provider plus `config/signatures.json`.
4. `composeReply()` produces HTML, text, subject, recipients, `threadId`, `inReplyTo`, `references`.
5. `buildMime()` serializes it; the provider stores the draft (Gmail: `drafts.create` with `raw` + `threadId`).
6. The response carries the draft summary, the rendered text and lint findings.

Update a draft: the service re-renders from the new typed body using the stored `rendered` metadata (mode + original message id), so the Gmail structure is rebuilt rather than patched.

Send: refused unless `GMAIL_SEND_ALLOW_SEND=1`.

## Adding a provider

Implement `MailProvider` (12 methods). The drafting service, MCP server, CLI and tests do not change. The simulator is the reference implementation.
