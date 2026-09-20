import type { gmail_v1 } from 'googleapis';
import { parseAddressList } from '../core/address.js';
import { fromBase64Url } from '../core/mime.js';
import type { Attachment, Message } from '../core/types.js';

type Part = gmail_v1.Schema$MessagePart;

/** Convert a Gmail API message (format=full) into the provider-agnostic Message. */
export function apiMessageToMessage(m: gmail_v1.Schema$Message): Message {
  const headers = new Map<string, string>();
  for (const h of m.payload?.headers ?? []) {
    const k = (h.name ?? '').toLowerCase();
    if (k && !headers.has(k)) headers.set(k, h.value ?? '');
  }
  const get = (n: string) => headers.get(n);

  let html: string | undefined;
  let text: string | undefined;
  const attachments: Attachment[] = [];

  const walk = (p?: Part | null) => {
    if (!p) return;
    if (p.parts?.length) {
      for (const c of p.parts) walk(c);
      return;
    }
    const mime = (p.mimeType ?? '').toLowerCase();
    if (p.filename) {
      attachments.push({ id: p.body?.attachmentId ?? undefined, filename: p.filename, mimeType: mime || 'application/octet-stream', size: p.body?.size ?? undefined });
      return;
    }
    const data = p.body?.data ? fromBase64Url(p.body.data) : undefined;
    if (data === undefined) return;
    if (mime === 'text/html' && html === undefined) html = data;
    else if (mime === 'text/plain' && text === undefined) text = data;
  };
  walk(m.payload);

  const from = parseAddressList(get('from'))[0] ?? { email: '' };
  const date = m.internalDate ? new Date(Number(m.internalDate)) : get('date') ? new Date(get('date') as string) : new Date();
  const refs = (get('references') ?? '').split(/\s+/).filter(Boolean);

  return {
    id: m.id ?? '',
    threadId: m.threadId ?? '',
    from,
    to: parseAddressList(get('to')),
    cc: parseAddressList(get('cc')),
    bcc: parseAddressList(get('bcc')),
    replyTo: get('reply-to') ? parseAddressList(get('reply-to')) : undefined,
    subject: get('subject') ?? '',
    date,
    messageId: get('message-id') || undefined,
    inReplyTo: get('in-reply-to') || undefined,
    references: refs.length ? refs : undefined,
    html,
    text,
    snippet: m.snippet ?? undefined,
    labelIds: m.labelIds ?? undefined,
    attachments: attachments.length ? attachments : undefined,
  };
}
