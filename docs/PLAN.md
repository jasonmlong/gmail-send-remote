# gmail-send: plan

Goal: let an AI agent draft new emails, replies and forwards inside Gmail that are indistinguishable from what a person produces in the Gmail web app: same HTML structure, same quoting and attribution, the account's real signature, correct recipients and threading. Provide an offline simulator so the whole workflow can be exercised and previewed without touching a real mailbox, and expose it to agents through MCP and a CLI.

Source of truth for the markup is real mail Sam sent from Gmail in September 2026 (a new message, a reply, a forward). The exact structures are documented in [GMAIL-MARKUP.md](GMAIL-MARKUP.md).

## 1. Review of EmailDrafter (the existing code)

The predecessor was a Google Apps Script Gmail add-on. It watched Gmail labels, found unread threads, called an LLM (OpenAI, Claude or Gemini) with the sender history and a learned writing style, and created a reply draft. It also carried tiers, promo codes, encrypted API key caching, onboarding cards and a signature/writing-style analysis step, none of which survive here.

What is solid and worth keeping:

- The product loop: label a thread, get a draft, keep the thread unread (`processing_emails.js`, `triggers.js`).
- Sender-history context for the prompt (`getPreviousEmails`).
- Writing style guide prompt (`writing_style_helpers.js`) and user preferences (closings, avoided phrases).
- The idea of detecting the signature from sent mail (`processing_signatures.js`, `signature_helpers.js`).

Where the drafts diverge from real Gmail sends (all in `createDraftResponse`, `processing_emails.js:1259`):

| Gap | EmailDrafter today | Gmail |
|---|---|---|
| Body markup | `text.replace(/\n/g, "<br>")` | `<div dir="ltr">` with one `<div>` per line, `<div><br></div>` blank lines, apostrophes as `&#39;`, URLs auto-linked |
| Quote container | `<div class="gmail_quote">On {date}, {from} wrote:<br>` | `<div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">On Fri, Sep 18, 2026 at 7:00 AM Name &lt;email&gt; wrote:<br></div>` |
| Blockquote style | `margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex` | `margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex` |
| Date format | `toLocaleString` with weekday/year/month/day/hour/minute, comma after date | `On Fri, Sep 18, 2026 at 7:00 AM` with a narrow no-break space before AM |
| Signature wrapper | Raw signature HTML dropped between `<br><br>` | `<span class="gmail_signature_prefix">-- </span><br><div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature">` |
| Signature placement | Always above the quote | Below the quote by default (the owner's setting), above only with the Gmail "before quoted text" option |
| Plain-text part | Body + signature, quote missing | Wrapped at 72 columns, `> ` quoting that stacks to `>>`, `--` signature separator |
| Recipients | To = sender, Cc copied blindly | Reply vs Reply all rules, Reply-To honored, self removed, aliases treated as me |
| Forwards | Not supported | Not supported |
| New messages | `GmailApp.createDraft("", subject, text)` with no signature and no HTML | Full structure with signature |
| Threading | Relies on `createDraftReply`; the fallback passes `inReplyTo`/`threadId` options that `GmailApp.createDraft` does not support | In-Reply-To and References headers, threadId on the draft |
| Duplicate check | `hasDraftResponse` searches drafts by subject string | Should key on thread id |
| Signature source | LLM extraction over sent mail with regex fallbacks (fragile, expensive) | Gmail marks its own signature with `class="gmail_signature"`; deterministic extraction works, and the sendAs settings API returns the stored signature directly |
| Claude model | `claude-3-sonnet-20240229` (retired) | Current model ids (`claude-sonnet-5` or `claude-opus-5`) |

The add-on runtime itself (30 second execution cap, no push notifications, per-user PropertiesService storage) limits how much an agent can do inside it. The plan keeps EmailDrafter as one consumer of a shared rendering engine rather than the place the engine lives.

## 2. Recommended features

Grouped by area. Status reflects this session's build: "built" means implemented with tests here; "next" means planned.

Fidelity (the point of the project)

1. Gmail-identical reply rendering: attribution line, quote container, verbatim nested original HTML, `\r\n` tail, signature block. Built.
2. Gmail-identical new message rendering. Built.
3. Gmail-identical forward rendering: forwarded-message header with mailto links, `msg-` wrapper with prefixed ids, attachments carried over. Built.
4. Plain-text part generation matching Gmail: 72 column wrap, `>` quoting, `--` separator, Gmail's HTML-to-text rules for links, images and tables. Built.
5. Reply / Reply all recipient logic with Reply-To, alias awareness and de-duplication. Built.
6. Subject prefixing (`Re:`, `Fwd:`) exactly as Gmail applies it. Built.
7. RFC 822 / MIME output shaped like Gmail's own (quoted-printable, `000000000000` boundaries, In-Reply-To and References). Built.
8. Timezone and AM/PM separator configuration for the attribution date (observed both Central and Eastern in the owner's sends, and U+202F before AM/PM). Built.
9. Golden tests pinned to the observed samples so any drift in the renderer fails CI. Built.

Signatures

10. Read the account's real signatures from Gmail sendAs settings (one per alias, default flag). Built (live verification pending OAuth).
11. Local signature library (`config/signatures.json`) usable by the simulator and as extras for Gmail. the owner's real signature is stored there. Built.
12. Create a signature when the account has none: "plain" (the shape Gmail's own editor produces) or "card" (compact table), from name/title/company/phone/email/website/disclaimer, and push it to Gmail settings. Built.
13. Deterministic signature detection from sent mail (finds the `gmail_signature` block, picks the most common). Built.
14. Signature placement setting (after quote, Gmail default, or before quote). Built.
15. Auto-select the signature that matches the From alias. Next.
16. Inline images (cid attachments) inside signatures. Next.

Threads and replies

17. Reply to the latest message of a thread or a specific message; reply chains nest correctly (`>>`, `>>>`). Built.
18. Update an existing draft by re-rendering from a new body so the structure is never hand-edited. Built.
19. Forward with or without a note, keeping attachments. Built.
20. Attachments on new drafts from local files. Next (MIME support is built; the CLI/MCP flag is not).

Agent surface

21. MCP server (`src/mcp/server.ts`) with tools: get_profile, list_threads, get_thread, get_message, list_signatures, create_signature, detect_signature, draft_reply, draft_new, draft_forward, update_draft, list_drafts, preview_draft, render_thread_preview, delete_draft, send_draft (gated), get_style_guide, lint_body, sim_seed_demo, sim_receive. Built.
22. `.mcp.json` so Claude Code loads the server automatically in this repo. Built.
23. CLI with the same capabilities for humans and scripts. Built.
24. Voice enforcement: the style guide is served to the agent and a linter checks bodies for the hard rules (no dashes, no emojis, banned words, approved closings, no name sign-off, open on substance). Built.
25. Learn-from-sent style profile (port of EmailDrafter's analysis, deterministic where possible). Next.

Simulation and preview

26. Offline Gmail simulator implementing the same provider interface: threads, messages, drafts, signatures, aliases, Gmail-style ids and Message-IDs, a Gmail query subset, send and receive to drive multi-turn conversations, JSON persistence. Built.
27. Gmail-lookalike conversation preview page (message cards, collapsed quotes, red Draft label, compose box) written to `preview/`. Built.
28. Demo seed mailbox (vendor status thread, group scheduling thread, invoice with attachment). Built.
29. Side-by-side diff of a real Gmail-sent message against the renderer's output for the same inputs (fidelity regression tool). Next.

Safety

30. Sending is disabled by default; `send_draft` refuses unless `GMAIL_SEND_ALLOW_SEND=1`. Drafts stay in Gmail for a person to send. Built.
31. OAuth token and client secret are git-ignored; scopes limited to gmail.modify and gmail.settings.basic. Built.
32. Every draft response includes lint findings so the agent can fix voice problems before a human sees the draft. Built.

EmailDrafter integration

33. Bundle the renderer into a single Apps Script file (`npm run build:apps-script`) and a bridge function that replaces `createDraftResponse`. Built (bundle script and bridge; wiring into the add-on is next).
34. Replace EmailDrafter's LLM signature extraction with the deterministic detector. Next.
35. Update the retired Claude model id and the prompt to use the style guide + linter. Next.

Operations

36. Jira epics and tickets mirroring the backlog, Confluence pages mirroring `docs/`, session log for cross-machine handoff via the atlassian-sync skill. Prepared; logging happens once the Jira project and Confluence space exist.
37. GitHub Actions running typecheck and tests on push. Next.

## 3. Build plan

Epics map one to one onto Jira epics. Tickets are listed with their current status in [build-plan/BACKLOG.md](build-plan/BACKLOG.md).

Phase 0, done this session: capture ground truth from real Gmail sends, decide the architecture, scaffold the TypeScript project.

Phase 1, done this session: rendering engine (E1) with golden tests. This is the piece everything else depends on and the one that must not drift.

Phase 2, done this session: signatures (E2), simulator and preview (E3), Gmail adapter (E4), drafting service, MCP server and CLI (E5), style linter (E6), EmailDrafter bundle (E7), docs (E8).

Phase 3, next: live verification against the owner's mailbox. Create the OAuth client, run `auth login`, list signatures, create a reply draft in a real thread, open it in Gmail and confirm it is pixel-identical to a hand-typed reply, then send one to a test address and diff the received MIME against a Gmail-sent one. Fix any deviation and pin it as a golden test.

Phase 4, next: agent workflow hardening. Auto-pick signature by alias, attachments from disk, learn-from-sent style profile, fidelity diff tool, CI.

Phase 5, next: EmailDrafter adoption. Wire the bridge into the add-on, switch signature detection to the deterministic path, update model ids, retest onboarding.

## 3b. Delivery modes (added after the review)

The renderer is one code base (`src/core`) that runs in two places. Everything else is a thin adapter around it.

| Mode | Where it runs | Who holds Gmail access | Setup per account | When to use |
|---|---|---|---|---|
| **Apps Script API** (`apps-script/`, recommended) | Inside the user's Google account as a web app | The script, as the account owner | Paste 6 files, run `setup()`, deploy, copy URL + token into `.env` | The original intent: lightweight, free, add to any account, agent connects over HTTPS |
| **Direct Gmail API** (`src/gmail/`) | The Node process | An OAuth token from a Google Cloud client | Create a Cloud OAuth client, `auth login` | When you already run a backend with Google credentials |
| **Simulator** (`src/simulator/`) | The Node process, offline | Nobody | None | Tests, demos, previews |

The MCP server and CLI pick the mode with `GMAIL_SEND_PROVIDER`. The Apps Script API is also usable without Node at all: any HTTP client can POST `{token, action: "draftReply", threadId, body}` and get a native draft (see [APPS-SCRIPT-API.md](APPS-SCRIPT-API.md)).

Verified for the Apps Script path: the Gmail API's sendAs resource returns the stored signature ("An optional HTML signature that is included in messages composed with this alias in the Gmail web UI"), and Apps Script's Advanced Gmail Service exposes the same resource, so the script reads the signature Gmail shows in Settings with no extra setup. The timezone is read from the user's primary Google Calendar (the owner's reports America/Cancun, which is the clock his reply sample used). Apps Script's V8 has no timezone data in `Intl`, so the renderer routes date formatting through hooks the script backs with `Utilities.formatDate`.

What EmailDrafter had that the lightweight version drops on purpose: tiers, promo codes, encrypted key caching, onboarding cards, AI calls inside the script. The AI lives with the agent; the script only reads mail and writes drafts.

## 4. Decisions made (and why)

- TypeScript library with a provider interface, not an Apps Script extension. The agent needs a long-running, testable runtime with real HTTP access; Apps Script cannot host an MCP server or run a test suite. EmailDrafter consumes the same core through the bundled file.
- Real Gmail API drafts from raw MIME with `threadId`, rather than the Gmail MCP connector's `create_draft`. The connector cannot set HTML, threading headers or the signature, which is exactly what was missing.
- Signature after the quote by default. That is what the owner's Gmail does today; the before-quote variant is one setting away.
- Narrow no-break space before AM/PM. Observed in every Gmail-generated date in the samples.
- Timezone comes from the connected account's Google Calendar, with `GMAIL_SEND_TIMEZONE` as an override and America/New_York as the last resort. Gmail's own attribution uses the sending browser's clock, which is why two samples from the same person showed different zones; Calendar is the best proxy the API exposes.
- The signature is whatever Gmail's sendAs settings hold for the default identity. The local library (`config/signatures.json`) is only a fallback for accounts with no signature, or an explicit choice by id.
- Sending stays off. The value is the draft in Gmail's Drafts folder; a person presses Send.
- Lightweight Apps Script web app instead of a Marketplace add-on: per-account copy plus token avoids Google's OAuth verification for sensitive Gmail scopes and keeps it free.

## 5. Open questions for the owner

1. Jira project key and Confluence space key for logging the backlog.
2. Should the agent ever send, or is drafts-only the permanent rule?
