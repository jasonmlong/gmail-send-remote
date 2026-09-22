# Deploying to a remote host

The general case. For the OpenClaw instance specifically, including creating its own Apps Script project and the Cloudflare Zero Trust notes, follow [OPENCLAW-SETUP.md](OPENCLAW-SETUP.md) instead; this document is the background it rests on.

How to run the gmail-send MCP server on a machine other than the one the mailbox owner sits at: a VPS, a container, an always-on agent host. The Apps Script side is already deployed in the owner's Google account and is not touched by any of this.

The remote host runs only the Node side. It holds no Google credentials. It authenticates to the already-deployed endpoint with a token, and what that token may do is fixed at mint time.

## Before you start

You need three things from the mailbox owner, out of band. Do not expect to find them in the repository.

| Value | Looks like | Notes |
|---|---|---|
| Endpoint URL | `https://script.google.com/macros/s/AKfyc.../exec` | The deployed web app |
| Token | 64 hex characters | Minted for **this host specifically** |
| Capabilities | usually `read` + `draft` | What that token is allowed to do |

A remote host should get its own token, never a copy of the owner's. Use `mintDraftOnlyToken()` in the Apps Script editor. That produces a credential that cannot send mail and cannot change Gmail settings, and those limits are properties of the token rather than switches, so nothing enabled later grants them.

Requirements on the host:

- Node 20 or newer
- Outbound HTTPS to `script.google.com` and `script.googleusercontent.com`. Apps Script answers with a redirect to the second domain, so an egress allowlist naming only the first will fail in a confusing way.
- Nothing inbound. The server speaks MCP over stdio and listens on no port.

## Install

```bash
git clone <repo url> gmail-send && cd gmail-send
npm ci --include=dev
npm run typecheck && npm test      # all offline, should be green before you wire anything up
```

Create `.env` in the repository root:

```
GMAIL_SEND_PROVIDER=appsscript
GMAIL_SEND_APPS_SCRIPT_URL=<the /exec URL>
GMAIL_SEND_APPS_SCRIPT_TOKEN=<this host's token>
GMAIL_SEND_ALLOW_SEND=0
GMAIL_SEND_TIMEZONE=
GMAIL_SEND_SIGNATURE_PLACEMENT=after-quote
```

`.env` is git-ignored. Keep it that way, keep it out of images and logs, and restrict it to the user the agent runs as.

Leave `GMAIL_SEND_TIMEZONE` empty. The endpoint reports the mailbox owner's calendar timezone, which is what the attribution line in a reply must use. Setting it here to the server's own timezone would put the wrong time in every quoted reply.

## Verify before wiring it up

```bash
npm run cli -- profile
```

Read the output rather than glancing at it:

- `provider` is `appsscript`
- `email` is the mailbox you expect
- `capabilities` lists exactly what this host was granted, for example `["read","draft"]`
- `canSend` is `false` for a draft-only token
- `timeZone` is the owner's, not the server's
- `tokenLabel` identifies this host

If `capabilities` includes `send`, stop. The wrong token was issued. Have it revoked and a draft-only one minted.

Then confirm the endpoint refuses what it should:

```bash
npm run cli -- threads --max 3        # should list conversations
npm run cli -- signatures list        # should show the account's Gmail signature, tagged [gmail]
```

## Register as an MCP server

Command and arguments, with absolute paths:

```json
{
  "command": "/usr/bin/node",
  "args": [
    "/srv/gmail-send/node_modules/tsx/dist/cli.mjs",
    "/srv/gmail-send/src/mcp/server.ts"
  ],
  "env": { "GMAIL_SEND_PROVIDER": "appsscript" }
}
```

Keep the URL and token in `.env` rather than repeating them here, so the credential lives in one place. The server locates its own `.env` relative to its own file, so the working directory does not matter.

A draft-only credential causes the server to advertise no send tool at all. Seeing 17 tools rather than 18 is the expected, correct result.

## The writing voice

`GMAIL_SEND_STYLE_GUIDE` points at a prose style guide. If it is unset or the file is missing, `get_style_guide` falls back to a short built-in summary, and drafts will be generically well written rather than sounding like the account owner.

For a remote host this is easy to miss, because the path that works on the owner's laptop will not exist here. Either copy the guide onto the host and point the variable at it, or accept the fallback knowingly. It is the difference between email that sounds like the person and email that sounds like an assistant.

## What this host can and cannot do

Can: read the mailbox within whatever search scope the deployment sets, and stage drafts in it.

Cannot: send anything, change the Gmail signature, or delete drafts a person wrote by hand.

Worth being clear-eyed about the remaining exposure. A draft-only token still reads mail, and an agent steered by a malicious inbound message can stage a convincing forward of a sensitive thread addressed to anyone. It cannot deliver it. The controls that matter here are the search scope, set with `setSearchScope()` in the editor, and a human reading the recipients before pressing Send.

## If it breaks

| Symptom | Cause |
|---|---|
| `Unauthorized` JSON response | The request reached `doPost`, but the token is wrong, revoked, or absent from this Apps Script project's registry. Run `listTokens()` in the project that owns the configured `/exec` URL, mint a fresh consumer-specific draft-only token, update `.env`, and retry. No deployment is needed for a token change. |
| `This token cannot X` | Correct behaviour: the token lacks that capability |
| `non-JSON (HTTP 302 ...)` or an HTML sign-in page | Egress blocked, or the deployment is not set to "Anyone" access |
| `GMAIL_SEND_APPS_SCRIPT_URL is required` | `.env` missing or not being found |
| Wrong times in quoted replies | `GMAIL_SEND_TIMEZONE` was set locally; clear it |
| Tools missing from the client | Server failed to start; run the CLI by hand to see the real error |

Revocation is immediate and does not need a redeploy: `revokeTokenByLabel()` in the editor kills this host's access on the next request and leaves every other token working.
