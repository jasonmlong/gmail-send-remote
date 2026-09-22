# Structured formatting security review, 2026-09-22

Scope: the `bodyBlocks` input in the MCP tools, shared renderer, Apps Script high-level actions, MIME alternatives, and draft updates. This was reviewed from source by Codex and in a separate read-only Claude CLI pass. The existing `linkify` helper was checked as well: it recognizes http, https, bare `www.`, and email addresses. It does not turn `javascript:` or `data:` into links.

## Findings addressed

- A formatted link could show innocent text while its destination appeared only in HTML. The destination now appears in the plain-text part, draft summary, and style-linter input when it differs from the display text.
- An explicit link could previously carry a `mailto:` query or misleading URL credentials. Links now allow only http/https URLs without URL credentials or a bare mailto address. Attribute values are escaped, and explicit links use `rel="noopener noreferrer"`.
- Apps Script's direct JSON actions bypass MCP's Zod schema. The shared core now checks block types, allowed properties, run types, link schemes, control characters, and size limits. The checks run for both HTML rendering and text extraction.
- Apps Script stores the typed body in a user property with a [9 KB value limit](https://developers.google.com/apps-script/guides/services/quotas). High-level actions now check the serialized metadata size before creating or updating a Gmail draft, so an oversized body does not leave a partially managed draft.
- A cached render could outlive a recipient or subject change made directly in Gmail. Both the Apps Script and direct Gmail adapters now compare live headers to cached headers. A mismatch removes the cached render and `update_draft` refuses to overwrite the changed draft.
- This checkout already refused Bcc and updates to drafts the endpoint did not create. Those controls were preserved when formatting was added. A regression test checks that a formatted high-level draft still ignores a supplied Bcc field.
- `draft_forward` and `update_draft` now return style-linter findings when they receive a new body. A subject-only update preserves the existing formatted blocks.

The output encoding follows [OWASP's guidance for text, attributes, and URL values](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html): caller text is HTML-escaped, links are scheme-checked, and href attributes are encoded. The renderer generates fixed tags rather than accepting caller HTML.

## Limits

The agent can still stage a convincing draft with a harmful link if it has draft permission. Reviewing the visible destination and recipients before sending remains necessary. The stale-draft check covers headers; a body-only change made directly in Gmail may still be overwritten by `update_draft`. This review does not prove Gmail web compose serializes formatted content byte for byte the same way; that requires a fresh Gmail sample. Local checks do not change a deployed Apps Script project or a running remote MCP process.
