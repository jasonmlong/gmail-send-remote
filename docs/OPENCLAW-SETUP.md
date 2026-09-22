# Wiring gmail-send to OpenClaw

End to end setup for the remote instance: a **new** Apps Script project in
`jason@tangentsolutions.net`, a draft-only token minted for OpenClaw alone, and
this repository cloned onto the OpenClaw host as a stdio MCP server.

This is deliberately a second, independent deployment. The laptop's Claude
Desktop setup keeps its own script project, its own token registry and its own
switches. Rotating or revoking OpenClaw's access touches nothing there, and a
mistake on one side cannot widen the other.

```
OpenClaw host                          Google
-----------------------------          -------------------------------
openclaw  -- stdio -->  node            script.google.com/macros/s/NEW/exec
                        src/mcp/server    |  runs as jason@tangentsolutions.net
                          |               |  token: openclaw [read, draft]
                          +-- HTTPS ------+
```

No inbound port is opened on the host. Cloudflare Zero Trust guards OpenClaw
itself; the drafting path is outbound only.

---

## Part 1: the new Apps Script project

Do this in a browser signed in as `jason@tangentsolutions.net`. About ten
minutes.

### 1. Build the bundle

On this machine, in this repository:

```bash
npm ci --include=dev
npm run build:apps-script
npm test
```

`GmailSendCore.js` is generated from `src/core`. Paste the freshly built one,
not a stale copy.

### 2. Create the project

Go to [script.google.com](https://script.google.com) > **New project**. Rename
it something you will recognise next to the existing one, for example
**gmail-send (openclaw)**.

In **Project Settings**, tick **Show "appsscript.json" manifest file in
editor**.

### 3. Paste the files

The editor names files without an extension and saves them as `.gs`. Create one
file per row and paste the contents of the local file into it:

| Create a file named | Paste from |
|---|---|
| `Api` | `apps-script/Api.js` |
| `GmailAdapter` | `apps-script/GmailAdapter.js` |
| `Drafting` | `apps-script/Drafting.js` |
| `Setup` | `apps-script/Setup.js` |
| `GmailSendCore` | `apps-script/GmailSendCore.js` |

Delete the default `Code.gs`. Then open `appsscript.json` and replace its whole
contents with `apps-script/appsscript.json`, which declares the Advanced Gmail
Service, the OAuth scopes and the web app settings.

### 4. Run setup()

Select `setup` in the function dropdown and **Run**. Google will warn that the
app is unverified: **Advanced** > **Go to gmail-send (openclaw)**. That warning
is expected for a script you own and are running as yourself.

The consent screen will say the script can **send** email and can **change your
email settings and filters**. Both are worth understanding before you click
through, because neither wording is a mistake.

| What Google says | Scope | Why |
|---|---|---|
| View your email messages and settings | `gmail.readonly` | Reading the threads being replied to |
| Manage drafts and send emails | `gmail.compose` | Writing drafts. **There is no Gmail scope that permits drafting without also permitting sending** |
| See, edit, create or change your email settings and filters | `gmail.settings.basic` | Reading your real signature out of Gmail settings. No read-only variant of this scope exists |
| See your calendars | `calendar.readonly` | Your timezone, for the "On \<date\> ... wrote:" line |
| See your primary email address | `userinfo.email` | Identifies the account |

The send wording describes what the *script* could do, not what the OpenClaw
agent can. Sending is blocked three times over: the `openclaw` token is minted
without the `send` capability and that is fixed in the credential, the
`setAllowSend` switch is off, and the MCP server does not register a send tool
for a token that cannot use it.

The settings scope is the sharpest thing in the grant, since the same
permission that reads a signature could create a filter. The script never
writes one, and signature writes need both the `settings` capability and a
switch that is off. If you would rather not grant it at all, capture your
signature into `config/signatures.json` once and remove the scope from
`appsscript.json`; drafts then use the local copy instead of what Gmail shows.

The execution log prints the account email, the calendar timezone, the
signatures it can see, and a primary token.

**Leave the primary token where it is.** It carries `read, draft, send,
settings`. It never goes near the host.

That token is printed once, at creation, and only its hash is kept. Re-running
`setup()` will not reprint it, and will not revive it if you ever revoke it;
`rotateToken()` is how you replace it. You do not need it for anything below.

### 5. Deploy the web app

**Deploy** > **New deployment** > gear icon > **Web app**.

- Description: `openclaw`
- Execute as: **Me (jason@tangentsolutions.net)**
- Who has access: **Anyone**

Copy the `/exec` URL. "Anyone" means anyone who knows the URL can reach the
endpoint anonymously; the token is what actually guards it, and an
unauthenticated GET deliberately returns nothing but the product name.

### 6. Mint the OpenClaw token

In `Setup.gs`, `mintDraftOnlyToken()` already carries `LABEL = 'openclaw'`.
Select it and **Run**.

The log prints the token once. Only its SHA-256 hash is stored, so there is no
way to read it back later. If you lose it, revoke and mint again. Copy it
straight into the host's `.env` rather than parking it in a note.

That token can read the mailbox and stage drafts. It cannot send and cannot
write the Gmail signature, and those limits are fixed in the credential itself,
not in a switch someone could flip later.

### 7. Narrow what it can read

```
applyRecommendedSearchScope()
```

That sets `-in:spam -in:trash newer_than:180d`, enforced inside the script, so
it binds any caller and not just the Node client. It applies to reads by thread
or message id as well as to searches, which is what makes it a boundary rather
than a filter.

Be precise about its reach: `-in:spam`, `-in:trash` and `newer_than:` are the
operators enforced on a read by id. Anything else you put in the scope string
narrows searching but will not stop a read of a known id. Adjust with
`setSearchScope()` if OpenClaw needs to reach further back.

### 8. Confirm before you leave the editor

Run `showSettings()`. You want to see:

- `allowSend: disabled`
- `allowSettingsWrite: disabled`
- `searchScope:` the string you set
- two tokens listed: `primary` and `openclaw [read, draft]`, both live

Optionally run `testDraftLatestInbox()` to put one real draft in the newest
inbox thread, open Gmail, compare it with a reply you typed by hand, then
delete it.

### Update this Apps Script project later

After pulling a release that changes `src/core/` or `apps-script/`:

1. Run `npm ci --include=dev`, `npm run build:apps-script`, `npm test`, and `npm run typecheck` in `gmail-send-remote`.
2. Replace `Api`, `GmailAdapter`, `Drafting`, `Setup`, and `GmailSendCore` in this OpenClaw script project with the matching repository files. Copy all five together so they come from the same revision. Update `appsscript.json` if it changed.
3. If the manifest changed, run `selfTest()` and approve any new scopes. It reads and renders without saving or sending mail.
4. Choose **Deploy > Manage deployments**, edit the existing deployment, select **New version**, and deploy it.
5. Keep the existing URL and token. A normal code update does not require `setup()` or a new token.
6. Run `showSettings()`, then run `npm run cli -- profile` on the configured host to verify the live `/exec` endpoint and its draft-only capabilities. Confirm `deploymentVersion` matches `GMAIL_SEND_VERSION` in `apps-script/Api.js`. This identifies the `Api` revision and the successful call exercises `GmailAdapter`; it does not replace copying all five files together.

Always update this project from `gmail-send-remote`, not from the laptop's `gmail-send` checkout.

If an Apps Script action reports that a name `is not defined`, such as `CAPABILITIES is not defined`, copy all five code files again and deploy a **New version**. That error usually identifies a mixed or stale Apps Script deployment. Restarting OpenClaw cannot change the code behind the `/exec` URL.

---

## Part 2: the OpenClaw host

### Requirements

- Node 20 or newer
- Outbound HTTPS to **both** `script.google.com` **and**
  `script.googleusercontent.com`. Apps Script answers with a 302 to the second
  domain. An egress allowlist naming only the first fails as a confusing
  non-JSON error rather than a clean denial.
- Nothing inbound. The MCP server speaks stdio and listens on no port.

### Install

This repository may be private. Configure an authorized GitHub credential or deploy key first, and stop if authentication fails.

```bash
git clone https://github.com/jasonmlong/gmail-send-remote.git /srv/gmail-send
cd /srv/gmail-send
npm ci --include=dev
npm run typecheck && npm test      # offline, should be green before wiring up
```

### Configure

```bash
cp .env.openclaw.example .env
chmod 600 .env
nano .env      # paste the /exec URL and the openclaw token
```

The server finds its own `.env` relative to its own file, so the working
directory does not matter.

`tsx` is a production dependency because OpenClaw invokes it directly to run
the MCP server. The install command includes development dependencies because
this setup also runs TypeScript and Vitest, even when the host exports
`NODE_ENV=production`. Keep npm lifecycle scripts enabled so `esbuild` can
prepare its executable for the host platform.

`GMAIL_SEND_STYLE_GUIDE` points at `./config/style-guide.md`, which is in the
repository, so the clone carries the writing voice with it. This is the thing
most likely to be silently wrong on a remote host: if the guide is missing, the
tools fall back to a short built-in summary and drafts come out generically
well written instead of sounding like the account owner.

`config/signatures.json` is not needed here. When a real account is connected,
the signature Gmail itself shows in Settings is always the default; the local
library is only a fallback.

Two working files hold mail in the clear on this host, and both are written
owner-only by the code: `.gmail-sim/appsscript-draft-meta.json`, the render
cache for every draft staged from here, and `preview/*.html` if you ever
generate a preview. They survive both deleting the draft in Gmail and revoking
the token, so treat the directory the way you treat `.env`:

```bash
chmod 700 .gmail-sim preview 2>/dev/null || true
```

### Verify before wiring it up

```bash
npm run cli -- profile
```

Read the output rather than glancing at it:

- `provider` is `appsscript`
- `email` is `jason@tangentsolutions.net`
- `capabilities` is exactly `["read","draft"]`
- `canSend` is `false`
- `timeZone` is the account's, not the server's
- `tokenLabel` is `openclaw`

If `capabilities` includes `send`, stop and revoke: the wrong token was pasted.

Then:

```bash
npm run cli -- threads --max 3     # lists conversations
npm run cli -- signatures list     # shows the Gmail signature, tagged [gmail]
```

---

## Part 3: register with OpenClaw

Resolve the absolute Node executable first. A service may not inherit the interactive shell's `PATH`.

```bash
NODE_BIN=$(command -v node)
test -n "$NODE_BIN"
openclaw mcp add gmail-send \
  --command "$NODE_BIN" \
  --arg /srv/gmail-send/node_modules/tsx/dist/cli.mjs \
  --arg /srv/gmail-send/src/mcp/server.ts \
  --cwd /srv/gmail-send \
  --env GMAIL_SEND_PROVIDER=appsscript
```

Equivalently, in the OpenClaw config under `mcp.servers`:

```json5
{
  mcp: {
    servers: {
      "gmail-send": {
        command: "/usr/bin/node",
        args: [
          "/srv/gmail-send/node_modules/tsx/dist/cli.mjs",
          "/srv/gmail-send/src/mcp/server.ts",
        ],
        cwd: "/srv/gmail-send",
        transport: "stdio",
        env: { GMAIL_SEND_PROVIDER: "appsscript" },
        enabled: true,
      },
    },
  },
}
```

Replace `/usr/bin/node` with the exact output of `command -v node` on the host.

Keep the URL and token in `.env` rather than repeating them in the OpenClaw
config, so the credential lives in exactly one file.

Use the absolute Node executable to avoid service `PATH` differences. Node
invokes `tsx` directly rather than through `npx`: on Windows the npx shim
truncates a multiline argument at its first newline, which silently cut email
bodies down to the greeting. The direct form is correct everywhere.

Check it:

```bash
openclaw mcp doctor gmail-send --probe
```

You should see **17 tools, not 18**. A draft-only credential causes the server
to advertise no `send_draft` tool at all. Seeing 17 is the correct result, not
a truncated list.

`.mcp.json` in this repository is for Claude Code and pins the simulator. It
has no effect on OpenClaw and is left alone on purpose.

---

## Part 4: Cloudflare Zero Trust

Two separate things, worth not conflating:

**Inbound.** Access or a tunnel in front of the OpenClaw UI is unaffected by
any of this. gmail-send opens no port and needs no hostname, so there is no new
application to publish and no policy to write.

**Outbound.** If the host runs WARP or its traffic goes through a Gateway
egress policy, add both Google domains to the allowlist. Symptoms of getting
this wrong are in the table below and do not look like a firewall problem.

If Gateway TLS inspection is on, the Node client must trust the Cloudflare root
certificate. Install it into the system store on the host. Do not reach for
`NODE_TLS_REJECT_UNAUTHORIZED=0`; that disables certificate checking for every
outbound request the process makes, including the one carrying the token.

The endpoint cannot be restricted by source IP from the Google side, so a
dedicated egress IP does not buy protection here. The token and the search
scope are the controls that matter.

---

## Part 5: draft something

From OpenClaw, ask for a reply to a real thread. The expected sequence is
`get_style_guide`, `get_thread`, `lint_body`, `draft_reply`, then reading back
who the draft is addressed to. Open Gmail and check the draft looks like mail
you typed: right signature, right quoting, right attribution line.

Nothing in this path can send. A person presses Send.

---

## If it breaks

| Symptom | Cause |
|---|---|
| `Unauthorized` | Token wrong, revoked, or pasted from the other deployment |
| `This token cannot X` | Correct behaviour: the openclaw token lacks that capability |
| `non-JSON (HTTP 302 ...)` or an HTML sign-in page | Egress blocked to `script.googleusercontent.com`, or access is not set to "Anyone" |
| TLS or self-signed certificate errors | Gateway inspection without the Cloudflare root in the host trust store |
| `GMAIL_SEND_APPS_SCRIPT_URL is required` | `.env` missing on the host |
| Wrong times in quoted replies | `GMAIL_SEND_TIMEZONE` was set; clear it |
| Drafts do not sound like Jason | `config/style-guide.md` missing or the env var points elsewhere; `npm run cli -- style` shows what loaded |
| No tools in OpenClaw | Server failed to start. Run `npm run mcp` by hand on the host to see the real error |
| 18 tools including send | Wrong token. Revoke and mint a draft-only one |
| `must point at script.google.com` | The URL in `.env` is wrong. The client refuses to post the token anywhere else |
| `changed outside gmail-send` on an update | Correct behaviour: the draft no longer matches what was rendered here. Read it and draft afresh rather than re-rendering |
| `Refusing to update draft ... did not create it` | Correct behaviour: that draft was written by hand |

## Revoking

`revokeTokenByLabel()` in the editor, with `LABEL = 'openclaw'`, kills the
host's access from the next request. No redeploy, and every other token keeps
working. Do this first if the host is ever lost, imaged or shared.

## What this host can and cannot do

Can: read the mailbox within the search scope, and stage drafts in it.

Cannot: send anything, change the Gmail signature, set a Bcc, read or enumerate
drafts a person wrote by hand, or update or delete them.

Each of those is enforced in the script rather than in the Node client, which
matters because anything with shell access on this host can read the token out
of `.env` and call the endpoint directly. Treat the Node layer as convenience
and the endpoint as the boundary.

Worth being clear about the exposure that remains. A draft-only token still
reads mail, and an agent steered by a malicious inbound message can stage a
convincing forward of a sensitive thread addressed to anyone. It cannot deliver
it. The controls are the search scope and a human reading the recipients before
pressing Send. The drafting tools flag any recipient whose domain is new to the
thread; that flag is there to be read.
