# Apps Script API (wire protocol)

The lightweight Apps Script deployment (`apps-script/`) exposes one endpoint. Both the Node `AppsScriptProvider` and any plain HTTP client use it.

```
POST <web app /exec URL>
Content-Type: text/plain;charset=utf-8
{"token": "<shared token>", "action": "<name>", ...params}
```

Response body is always JSON: `{"ok": true, "result": ...}` or `{"ok": false, "error": "..."}`. Follow the 302 redirect Apps Script issues.

`GET` on the same URL needs no token and deliberately returns only `{"ok":true,"result":{"name":"gmail-send"}}`. It used to report the mailbox address and whether sending was armed, which handed anyone who found the URL both a target and a reason to attack it.

## Tokens and capabilities

Every token is minted with a fixed set of capabilities. A request must satisfy **both** the token's own capabilities and the deployment's global switches, so a token issued for drafting cannot send even if sending is later enabled for everyone.

| Capability | Actions it permits |
|---|---|
| `read` | profile, listThreads, getThread, getMessage, listSignatures, listDrafts, getDraft |
| `draft` | createDraft, updateDraft, deleteDraft, draftReply, draftNew, draftForward, redraft |
| `send` | sendDraft (also needs the global send switch) |
| `settings` | saveSignature (also needs the global settings switch) |

Mint and revoke from the Apps Script editor; there is no action that changes them over the wire.

| Function | What it does |
|---|---|
| `mintDraftOnlyToken()` | `read` + `draft`. The one to give a remote or unattended agent. |
| `mintReadOnlyToken()` | `read` only. |
| `listTokens()` | Labels, capabilities, creation dates, live or revoked. |
| `revokeTokenByLabel()` | Revokes one label; takes effect on the next request, no redeploy. |
| `rotateToken()` | New primary token. Other tokens are unaffected. |
| `purgeRevokedTokens()` | Forget revoked entries once the audit trail is no longer wanted. |

Tokens are stored as SHA-256 hashes, so the script properties contain nothing usable. A minted token is shown once, at mint time. The primary token is the exception: it is also kept in plaintext so `setup()` can reprint it.

A refused capability returns a specific error, since the caller already authenticated and hiding the reason would only waste its time:

```
This token cannot sendDraft. It holds [read, draft] and that action needs "send".
```

`profile` reports the calling token's own view: `tokenLabel`, `capabilities`, `canSend` and `canWriteSettings`, the last two already combining the capability with the global switch. The MCP server uses `canSend` to decide whether to advertise a send tool at all.

## Capability switches

Three things a stolen token should not be able to do are off by default and can only be turned on from the Apps Script editor, never over the wire. There is no action that changes them.

| Switch | Editor function | Default | Controls |
|---|---|---|---|
| `GMAIL_SEND_ALLOW_SEND` | `setAllowSend(true)` | off | the `sendDraft` action |
| `GMAIL_SEND_ALLOW_SETTINGS_WRITE` | `setAllowSettingsWrite(true)` | off | the `saveSignature` action, which changes every message the owner types by hand |
| `GMAIL_SEND_QUERY_SCOPE` | `setSearchScope('-in:spam -in:trash newer_than:180d')` | empty | Gmail search terms combined into every search, so the scope binds direct callers too |

Two further limits apply regardless of any switch. `deleteDraft` refuses any draft this API did not create, because Gmail's deletion bypasses Trash and cannot be undone. And `createDraft` / `updateDraft` refuse a raw message containing any header outside the set the renderer produces, so holding the token does not confer arbitrary control over a draft's headers. `restoreSignature()` in the editor puts back the signature that the last `saveSignature` replaced.

Dates travel as ISO 8601 strings. Addresses are `{name?, email}`. A `Message` is `{id, threadId, from, to[], cc[], bcc[], replyTo?, subject, date, messageId?, inReplyTo?, references?, html?, text?, snippet?, labelIds?, attachments?}`.

## High-level actions (render inside the script)

| action | params | result |
|---|---|---|
| `draftReply` | `threadId` or `messageId`, `body`, `replyAll?`, `to?`, `cc?`, `addCc?`, `bcc?`, `addBcc?`, `signatureId?` | `{draftId, threadId, mode, subject, from, to, cc, bcc, inReplyTo, text, htmlLength}` |
| `draftNew` | `to`, `subject`, `body`, `cc?`, `bcc?`, `signatureId?` | same |
| `draftForward` | `messageId`, `to`, `body?`, `cc?`, `bcc?`, `includeAttachments?`, `signatureId?` | same |
| `redraft` | `draftId`, `body?`, `subject?`, `to?`, `cc?`, `bcc?`, `replyAll?`, `signatureId?` | same (re-renders a draft this API created) |

`body` is the typed plain text (greeting, paragraphs separated by blank lines, closing; no signature, no name). `signatureId` is a sendAs email, display name, or `"none"`; omitted means the default Gmail signature. Recipient params accept a string (`"Name <a@b.com>, c@d.com"`) or an array of strings.

## Low-level actions (mirror the Node `MailProvider`)

| action | params | result |
|---|---|---|
| `profile` | | `{email, name?, sendAs:[{email,name?,isDefault,replyTo?}], timeZone}` |
| `listThreads` | `query?` (Gmail search), `max?` | `[{id, subject, snippet, lastDate, messageCount, participants[], labelIds}]` |
| `getThread` | `threadId` | `{id, messages: Message[]}` |
| `getMessage` | `messageId` | `Message` |
| `listSignatures` | | `[{id, name, html, sendAsEmail, displayName?, isDefault, source:"gmail"}]` |
| `saveSignature` | `sendAsEmail?`, `html` | the saved signature. Gated; refuses an empty value; stashes the previous one |
| `listDrafts` | `threadId?` | `[{id, threadId?, message, updatedAt, meta?}]` |
| `getDraft` | `draftId` | one draft |
| `createDraft` | `raw` (RFC 822 source), `threadId?` | the created draft. Headers outside the renderer's own set are refused |
| `updateDraft` | `draftId`, `raw`, `threadId?` | the updated draft, same header restriction |
| `deleteDraft` | `draftId` | `{deleted}`. Only drafts this API created |
| `sendDraft` | `draftId` | the sent `Message`. Gated |

## Errors

- `Unauthorized`: token missing, wrong, or not a string.
- `Unknown action`: the name is not one of the actions above. Inherited property names such as `constructor` land here too.
- `Bad request`: the body was not a JSON object.
- `Sending is disabled on this deployment...`: run `setAllowSend(true)` in the editor.
- `Writing Gmail settings is disabled on this deployment...`: run `setAllowSettingsWrite(true)` in the editor.
- `Refusing to delete draft X: gmail-send did not create it...`
- `Header not permitted in a raw draft: x-whatever`
- Any Gmail error text from Apps Script is passed through in `error` and also written to the script's logs.
