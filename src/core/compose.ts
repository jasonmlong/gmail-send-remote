/**
 * Renders new messages, replies and forwards into the observed Gmail compose
 * structure. Structured formatting uses standard email elements; its exact
 * serialization is not yet pinned to a fresh Gmail web sample.
 */
import { uniqueAddresses, withoutAddresses } from './address.js';
import { attributionHtml, attributionText, forwardHeaderHtml, forwardHeaderText } from './attribution.js';
import { escapeHtml, htmlToText, neutralizeUnbalancedTags, textToGmailHtml } from './html.js';
import { replyRecipients } from './recipients.js';
import { richBodyToHtml, richBodyToText } from './rich-body.js';
import { forwardSubject, replySubject } from './subject.js';
import type {
  ComposeOptions,
  ForwardInput,
  Message,
  NewMessageInput,
  RenderedMessage,
  ReplyInput,
  RichBodyBlock,
  Signature,
} from './types.js';
import { quoteText, wrapText } from './wrap.js';

export const GMAIL_BLOCKQUOTE_OPEN =
  '<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">';
export const GMAIL_SIGNATURE_PREFIX = '<span class="gmail_signature_prefix">-- </span><br>';

/** Plain-text form of a signature: explicit text if provided, else Gmail's HTML-to-text conversion. */
export function signatureText(sig: Signature): string {
  return wrapText(sig.text?.trim() || htmlToText(sig.html));
}

/** Signature block for a new message (Gmail marks these with data-smartmail). */
function signatureBlockNew(sig: Signature): string {
  return `${GMAIL_SIGNATURE_PREFIX}<div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature">${sig.html}</div>`;
}

/**
 * Signature block placed under the quote. Observed: replies carry no
 * data-smartmail attribute on this div, forwards do.
 */
function signatureBlockAfterQuote(sig: Signature, smartmail: boolean): string {
  const attr = smartmail ? ' data-smartmail="gmail_signature"' : '';
  return `<div><br clear="all"></div><div><br></div>${GMAIL_SIGNATURE_PREFIX}<div dir="ltr" class="gmail_signature"${attr}>${sig.html}</div>`;
}

/** Signature block inserted above the quote (Gmail setting "insert signature before quoted text"). */
function signatureBlockBeforeQuote(sig: Signature): string {
  return `<div><br></div><div><div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature">${sig.html}</div></div>`;
}

function quoteBlockHtml(attrInner: string, originalHtml: string): string {
  return `<div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">${attrInner}<br></div>${GMAIL_BLOCKQUOTE_OPEN}${originalHtml}</blockquote></div>`;
}

function originalHtmlFor(original: Message): string {
  // The original is untrusted: whoever sent it chose its markup. Unbalanced
  // closing tags are neutralised so it cannot climb out of the quote block and
  // plant text at top level in the reply. Well-formed mail is unchanged.
  if (original.html) return neutralizeUnbalancedTags(original.html);
  if (original.text) return escapeHtml(original.text).replace(/\r?\n/g, '<br>');
  return '';
}

function originalTextFor(original: Message, opts: ComposeOptions): string {
  if (opts.quoteTextSource === 'convert-html' && original.html) return wrapText(htmlToText(original.html));
  if (original.text) return original.text.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  if (original.html) return wrapText(htmlToText(original.html));
  return '';
}

/**
 * Gmail wraps a forwarded message in <div class="msg-<n>"> and prefixes every
 * element id inside it with m_-<n> so the forwarded markup cannot collide with
 * the composer's own DOM.
 */
export function wrapForwardedOriginal(html: string, seed?: string): string {
  const n = seed ?? String(Math.floor(Math.random() * 9e17) + 1e17);
  const prefixed = html.replace(/\bid="([^"]*)"/g, (_m, id: string) => `id="m_-${n}${id}"`);
  return `<div class="msg-${n}">${prefixed}</div>`;
}

function dateOpts(opts: ComposeOptions) {
  return { timeZone: opts.timeZone, amPmSeparator: opts.amPmSeparator };
}

function myEmails(opts: ComposeOptions): string[] {
  return opts.myEmails?.length ? opts.myEmails : [opts.from.email];
}

function threadRefs(original: Message): { inReplyTo?: string; references?: string[] } {
  if (!original.messageId) return {};
  const refs = uniqueStrings([...(original.references ?? []), original.messageId]);
  return { inReplyTo: original.messageId, references: refs };
}

function uniqueStrings(list: string[]): string[] {
  return Array.from(new Set(list.filter(Boolean)));
}

function typedBody(body: string | undefined, blocks: RichBodyBlock[] | undefined, mode: 'new' | 'reply') {
  if (body !== undefined && blocks !== undefined) throw new Error('Pass body or bodyBlocks, not both.');
  if (blocks !== undefined) return { html: richBodyToHtml(blocks), text: richBodyToText(blocks), bodyBlocks: blocks };
  const plain = body ?? '';
  return { html: textToGmailHtml(plain, mode), text: plain.trim(), bodyBlocks: undefined };
}

// ---------------------------------------------------------------------------

export function composeNew(input: NewMessageInput, opts: ComposeOptions): RenderedMessage {
  const sig = opts.signature ?? null;
  const typed = typedBody(input.body, input.bodyBlocks, 'new');
  const bodyHtml = typed.html;
  const html = `<div dir="ltr">${bodyHtml}${sig ? `<div><br></div>${signatureBlockNew(sig)}` : ''}</div>\r\n`;

  const bodyText = wrapText(typed.text);
  const text = sig ? `${bodyText}\n\n--\n${signatureText(sig)}` : bodyText;

  return {
    mode: 'new',
    subject: input.subject.trim(),
    from: opts.from,
    to: uniqueAddresses(input.to),
    cc: uniqueAddresses(input.cc ?? []),
    bcc: uniqueAddresses(input.bcc ?? []),
    html,
    text,
    bodyBlocks: typed.bodyBlocks,
    attachments: input.attachments,
  };
}

export function composeReply(original: Message, input: ReplyInput, opts: ComposeOptions): RenderedMessage {
  const sig = opts.signature ?? null;
  const placement = opts.signaturePlacement ?? 'after-quote';
  const d = dateOpts(opts);

  const attrInner = attributionHtml(original, { ...d, linkifyEmail: opts.linkifyAttributionEmail });
  const quote = quoteBlockHtml(attrInner, originalHtmlFor(original));
  const typed = typedBody(input.body, input.bodyBlocks, 'reply');
  const bodyHtml = typed.html;

  let html: string;
  if (sig && placement === 'before-quote') {
    html = `<div dir="ltr">${bodyHtml}${signatureBlockBeforeQuote(sig)}</div><br>${quote}\r\n`;
  } else {
    html = `<div dir="ltr">${bodyHtml}</div><br>${quote}${sig ? signatureBlockAfterQuote(sig, false) : ''}\r\n`;
  }

  const bodyText = wrapText(typed.text);
  const quotedText = quoteText(originalTextFor(original, opts));
  const attrText = attributionText(original, { ...d, linkifyEmail: opts.linkifyAttributionEmail });
  let text: string;
  if (sig && placement === 'before-quote') {
    text = `${bodyText}\n\n${signatureText(sig)}\n\n${attrText}\n\n${quotedText}\n`;
  } else {
    text = `${bodyText}\n\n${attrText}\n\n${quotedText}\n${sig ? `\n--\n${signatureText(sig)}` : ''}`;
  }

  const computed = replyRecipients(original, myEmails(opts), !!input.replyAll);
  const to = uniqueAddresses(input.to ?? computed.to);
  const cc = withoutAddresses(uniqueAddresses([...(input.cc ?? computed.cc), ...(input.addCc ?? [])]), to);
  const bcc = withoutAddresses(uniqueAddresses([...(input.bcc ?? []), ...(input.addBcc ?? [])]), [...to, ...cc]);

  return {
    mode: 'reply',
    subject: replySubject(original.subject),
    from: opts.from,
    to,
    cc,
    bcc,
    html,
    text,
    bodyBlocks: typed.bodyBlocks,
    threadId: original.threadId,
    ...threadRefs(original),
    attachments: input.attachments,
    originalMessageId: original.id,
  };
}

export function composeForward(original: Message, input: ForwardInput & { forwardSeed?: string }, opts: ComposeOptions): RenderedMessage {
  const sig = opts.signature ?? null;
  const placement = opts.signaturePlacement ?? 'after-quote';
  const d = dateOpts(opts);
  const typed = typedBody(input.body, input.bodyBlocks, 'reply');
  const body = typed.text;

  // The forward box behaves like the reply box: first typed line is a bare text node.
  const bodyHtml = input.bodyBlocks !== undefined || body ? typed.html : '';
  const header = forwardHeaderHtml(original, d);
  const forwarded = `<div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">${header}</div><br><br>${wrapForwardedOriginal(originalHtmlFor(original), input.forwardSeed)}</div>`;

  let html: string;
  if (sig && placement === 'before-quote') {
    html = `<div dir="ltr">${bodyHtml}${signatureBlockBeforeQuote(sig)}<br><br>${forwarded}</div>\r\n`;
  } else {
    html = `<div dir="ltr">${bodyHtml}<br><br>${forwarded}${sig ? signatureBlockAfterQuote(sig, true) : ''}</div>\r\n`;
  }

  const origText = originalTextFor(original, opts);
  const headerText = forwardHeaderText(original, d);
  let text: string;
  if (sig && placement === 'before-quote') {
    text = `${body ? wrapText(body) + '\n\n' : ''}${signatureText(sig)}\n\n\n${headerText}\n\n${origText}`;
  } else {
    text = `${body ? wrapText(body) + '\n\n\n' : ''}${headerText}\n\n${origText}${sig ? `\n\n--\n${signatureText(sig)}` : ''}`;
  }

  const includeAttachments = input.includeAttachments ?? true;
  return {
    mode: 'forward',
    subject: forwardSubject(original.subject),
    from: opts.from,
    to: uniqueAddresses(input.to),
    cc: uniqueAddresses(input.cc ?? []),
    bcc: uniqueAddresses(input.bcc ?? []),
    html,
    text,
    bodyBlocks: typed.bodyBlocks,
    threadId: original.threadId,
    attachments: includeAttachments ? original.attachments : undefined,
    originalMessageId: original.id,
  };
}
