# Setup

## Requirements

Node 20 or newer (built on Node 24), npm.

```
npm ci --include=dev
npm test          # all offline
npm run typecheck
```

The MCP and CLI run TypeScript through `tsx`, which is a production dependency because clients invoke it directly. `--include=dev` is still required here when `NODE_ENV=production` because validation also needs TypeScript and Vitest. Keep npm lifecycle scripts enabled: `tsx` needs `esbuild`'s install script to prepare the executable for the current platform.

## 1. Try it offline (simulator)

```
npm run cli -- sim demo --open
```

Seeds a demo mailbox, drafts a reply into the vendor thread with the stored signature, prints the draft's text part, writes a Gmail-lookalike preview page under `preview/` and opens it.

Other useful simulator commands:

```
npm run cli -- threads
npm run cli -- thread <threadId>
npm run cli -- draft reply --thread <threadId> --body-file reply.txt
npm run cli -- drafts list
npm run cli -- drafts show <draftId> --html
npm run cli -- preview --draft <draftId> --open
npm run cli -- sim receive --from "Priya Nair <priya@example-agency.com>" --subject "Re: How are things going?" --thread <threadId> --body "Great, thanks!"
npm run cli -- lint --body-file reply.txt
npm run cli -- style
```

## 2. Connect a real account the lightweight way (Apps Script, recommended)

This is the "add it to any account" path. The account owner deploys a small script; the agent gets a URL and a token. No Google Cloud project, no OAuth client.

1. `npm run build:apps-script` (produces `apps-script/GmailSendCore.js`).
2. Signed in as the account, open script.google.com, New project, paste in `Api.js`, `GmailAdapter.js`, `Drafting.js`, `Setup.js`, `GmailSendCore.js`, and (with "Show appsscript.json" enabled in Project Settings) `appsscript.json`.
3. Run `setup()` from the editor and approve the consent screen. The execution log prints the token and the `.env` lines. It also prints the signature(s) Gmail holds and the calendar timezone it found.
4. Deploy > New deployment > Web app; Execute as: Me; Who has access: Anyone. Copy the `/exec` URL.
5. Copy `.env.example` to `.env` and set:

```
GMAIL_SEND_PROVIDER=appsscript
GMAIL_SEND_APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
GMAIL_SEND_APPS_SCRIPT_TOKEN=<token from the log>
```

6. Verify from the repo:

```
npm run cli -- profile            # email, aliases, timeZone from Calendar
npm run cli -- signatures list    # the signature Gmail shows, marked * as default
npm run cli -- threads --query "in:inbox newer_than:7d"
npm run cli -- draft reply --thread <id> --body-file reply.txt
```

Open Gmail: the draft sits inside the conversation with the real signature. Or run `testDraftLatestInbox()` in the editor for the same check without Node.

### If `profile` returns `Unauthorized`

An `Unauthorized` JSON response comes from `doPost` after the request reaches the Apps Script code. It means the submitted token is missing, revoked, or absent from that project's token registry. An HTML sign-in page or HTTP access error points to the web app boundary.

1. Open the Apps Script project that owns the exact `/exec` URL in this checkout's `.env`.
2. Run `listTokens()` and inspect only the labels, capabilities, and state. Do not paste a token into chat or source control.
3. For OpenClaw, set `LABEL` in `mintDraftOnlyToken()` to a fresh label such as `openclaw-2`, run it, and immediately copy the one-time token into `GMAIL_SEND_APPS_SCRIPT_TOKEN` in this checkout's `.env`.
4. Run `npm run cli -- profile`, then restart the MCP process after the CLI succeeds.

If this project was upgraded directly from version 0.3.x and you intentionally want to keep its old primary token, run `setup()` once. It preserves and registers an existing `GMAIL_SEND_TOKEN`; it does not rotate it. A newly minted draft-only token is safer for an agent because it cannot send or change Gmail settings.

Token registration and revocation use Script Properties and take effect immediately. They do not require another Apps Script deployment.

7. Recommended once it works: narrow what the deployment can read, by running this in the editor.

```
setSearchScope('-in:spam -in:trash newer_than:180d')
```

The scope is combined into every search inside the script, and is also checked when a thread or message is read by id, so it binds anyone calling the endpoint rather than just this client. The operators enforced on an id read are `-in:spam`, `-in:trash` and `newer_than:`.

Three capabilities are off by default and can only be armed from the editor: sending (`setAllowSend`), writing the Gmail signature (`setAllowSettingsWrite`), and updating or deleting drafts the tool did not create, which is always refused. Leave sending off unless you have a specific reason. If `signatures push` fails saying settings writes are disabled, that is why.

Full deployment notes and security caveats: [../apps-script/README.md](../apps-script/README.md). Wire protocol: [APPS-SCRIPT-API.md](APPS-SCRIPT-API.md). Review findings: [SECURITY-REVIEW.md](SECURITY-REVIEW.md).

## 3. Use it from Claude Code (MCP)

`.mcp.json` registers the server as `gmail-send`, pinned to the simulator. Environment variables set there win over `.env`, so Claude Code stays in the sandbox until you change that file deliberately.

Alongside it, `.claude/skills/gmail-drafting/SKILL.md` teaches the drafting workflow: read the style guide, read the thread, write plain text, lint, then draft. Claude Code loads it automatically.

## 4. Use it from Claude Desktop

Add the server to `claude_desktop_config.json`. On Windows that file is at `%APPDATA%\Claude\claude_desktop_config.json`; on macOS, `~/Library/Application Support/Claude/claude_desktop_config.json`. Merge this into the existing `mcpServers` object rather than replacing the file, which also holds your app preferences.

```json
{
  "mcpServers": {
    "gmail-send": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": [
        "C:\\path\\to\\gmail-send\\node_modules\\tsx\\dist\\cli.mjs",
        "C:\\path\\to\\gmail-send\\src\\mcp\\server.ts"
      ],
      "env": { "GMAIL_SEND_PROVIDER": "appsscript" }
    }
  }
}
```

Four things that are easy to get wrong here.

- **Use an absolute path for `command`.** Desktop does not inherit your shell PATH, so a bare `node` fails.
- **There is no working-directory setting**, and the process does not start in this repo. That is fine: the server locates its own `.env` and config relative to its own file, not the working directory.
- **Leave the URL and token out of this file.** They stay in `.env`, so the credential exists in one place. Only the provider is named here, so the config states which mailbox it talks to.
- **Fully quit and reopen Desktop** to reload the config. Closing the window is not enough; the config is read only at startup.

If the tools do not appear, the logs are at `%APPDATA%\Claude\logs\` (Settings, Developer, Open Logs Folder).

### Desktop does not read SKILL.md

Local skill files are a Claude Code feature. Claude Desktop loads skills only from your claude.ai account settings, so the file in `.claude/skills/` has no effect there. Two things carry the same guidance to Desktop instead, and both work today:

- the server's `instructions`, sent during the MCP handshake
- the tool descriptions themselves, which every client passes to the model

So the drafting rules reach Desktop whether or not it ever gains local skill support. If you want the fuller skill there as well, add it as a skill on claude.ai and it will appear in Desktop.

## 4. Direct Gmail API mode (optional)

Only needed if you would rather hold Google credentials on the Node side.

1. In Google Cloud Console enable the Gmail API and the Calendar API, create an OAuth client of type Desktop app, add the account as a test user.
2. Save the downloaded JSON as `config/credentials.json` (git-ignored).
3. `.env`: `GMAIL_SEND_PROVIDER=gmail`.
4. `npm run cli -- auth login` (browser consent for Gmail modify, Gmail settings, Calendar read-only).

## Signatures

- The default is the signature Gmail's sendAs settings return for the default identity: the one shown in Gmail Settings. `signatures list` marks it with `*`.
- `config/signatures.json` is a local library used only when the account has no signature, or when a signature is chosen by id (`--signature <id>` / `signatureId`). `none` suppresses the signature.
- `signatures create --name ... --title ... --company ... --phone ... --website ... --push` generates one for an account that has none and writes it into Gmail settings.
- `signatures detect` scans sent mail for the `gmail_signature` block (useful for accounts whose settings signature is empty but whose sent mail carries one).

## Timezone

The attribution line ("On Fri, Sep 18, 2026 at 7:00 AM ... wrote:") uses, in order: `GMAIL_SEND_TIMEZONE` if set, the account's primary Google Calendar timezone (read by the script or the Calendar API), then America/New_York.

## Environment variables

See `.env.example`. The ones that matter most:

| Variable | Default | Meaning |
|---|---|---|
| `GMAIL_SEND_PROVIDER` | `sim` | `sim`, `appsscript` or `gmail` |
| `GMAIL_SEND_APPS_SCRIPT_URL` / `_TOKEN` | unset | Apps Script deployment |
| `GMAIL_SEND_ALLOW_SEND` | `0` | `1` enables sending (the script also has its own switch, `setAllowSend(true)`) |
| `GMAIL_SEND_TIMEZONE` | unset | Override the Calendar timezone |
| `GMAIL_SEND_SIGNATURE_PLACEMENT` | `after-quote` | or `before-quote` |
| `GMAIL_SEND_STYLE_GUIDE` | unset (built-in summary) | Path to the prose style guide |
| `GMAIL_SEND_FROM` | provider default | `Name <email>` override |
