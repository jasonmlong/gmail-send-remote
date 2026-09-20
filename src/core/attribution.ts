/**
 * The "On <date> <person> wrote:" line and the "---------- Forwarded message ---------"
 * header block, in both the HTML and plain-text forms Gmail emits.
 */
import { addressText, displayName } from './address.js';
import { escapeAttr, escapeHtml } from './html.js';
import type { EmailAddress, Message } from './types.js';
import { GMAIL_WRAP_WIDTH } from './wrap.js';

export const DEFAULT_TIMEZONE = 'America/New_York';
/** Chrome's Intl output puts U+202F between "7:00" and "AM"; Gmail passes it through. */
export const NNBSP = ' ';

export interface DateFormatOptions {
  timeZone?: string;
  amPmSeparator?: string;
}

export interface DateTimeParts {
  weekday: string;
  month: string;
  day: string;
  year: string;
  hour: string;
  minute: string;
  dayPeriod: string;
}

/**
 * Hook for runtimes whose Intl lacks timezone data (Apps Script uses
 * Utilities.formatDate through this). Returns the pieces of "Fri, Sep 18, 2026 at 7:00 AM".
 */
export let dateTimeFormatter: ((date: Date, timeZone: string) => DateTimeParts) | null = null;
export function setDateTimeFormatter(fn: ((date: Date, timeZone: string) => DateTimeParts) | null): void {
  dateTimeFormatter = fn;
}

/** "Fri, Sep 18, 2026 at 7:00 AM" (with the configured AM/PM separator). */
export function formatGmailDateTime(date: Date, opts: DateFormatOptions = {}): string {
  const timeZone = opts.timeZone ?? DEFAULT_TIMEZONE;
  const sep = opts.amPmSeparator ?? NNBSP;
  if (dateTimeFormatter) {
    const p = dateTimeFormatter(date, timeZone);
    return `${p.weekday}, ${p.month} ${p.day}, ${p.year} at ${p.hour}:${p.minute}${sep}${p.dayPeriod}`;
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')}, ${get('month')} ${get('day')}, ${get('year')} at ${get('hour')}:${get('minute')}${sep}${get('dayPeriod')}`;
}

/**
 * Wrap a header-ish line the way Gmail's HTML-to-text pass does when the
 * addresses are links: a break is allowed after "<" (the link boundary), and
 * the email itself never splits. Observed: "Tomas Brandt Whitfield <\nWhitfield@example-fund.com>".
 */
export function wrapLinkedAddressLine(line: string, width = GMAIL_WRAP_WIDTH): string {
  const tokens: Array<{ s: string; glue: boolean }> = [];
  for (const w of line.split(' ')) {
    if (w.length > 1 && w.startsWith('<')) {
      tokens.push({ s: '<', glue: true });
      tokens.push({ s: w.slice(1), glue: false });
    } else tokens.push({ s: w, glue: false });
  }
  const lines: string[] = [];
  let cur = '';
  let prevGlue = false;
  for (const t of tokens) {
    const sep = cur === '' || prevGlue ? '' : ' ';
    if (cur !== '' && cur.length + sep.length + t.s.length > width) {
      lines.push(cur);
      cur = t.s;
    } else cur += sep + t.s;
    prevGlue = t.glue;
  }
  if (cur !== '') lines.push(cur);
  return lines.join('\n');
}

export function attributionText(original: Message, opts: DateFormatOptions & { linkifyEmail?: boolean } = {}): string {
  const line = `On ${formatGmailDateTime(original.date, opts)} ${addressText(original.from)} wrote:`;
  if (line.length <= GMAIL_WRAP_WIDTH) return line;
  // With a linked address Gmail may break after "<"; without one it keeps "Name <email>" intact
  // and only pushes "wrote:" to the next line.
  if (opts.linkifyEmail) return wrapLinkedAddressLine(line);
  return line.replace(/ wrote:$/, '\nwrote:');
}

export function attributionHtml(original: Message, opts: DateFormatOptions & { linkifyEmail?: boolean } = {}): string {
  const from = original.from;
  const email = opts.linkifyEmail
    ? `&lt;<a href="mailto:${escapeAttr(from.email)}" target="_blank">${escapeHtml(from.email)}</a>&gt;`
    : `&lt;${escapeHtml(from.email)}&gt;`;
  const who = from.name ? `${escapeHtml(from.name)} ${email}` : email;
  return `On ${escapeHtml(formatGmailDateTime(original.date, opts))} ${who} wrote:`;
}

/**
 * Gmail always mailto-links addresses in the forwarded-message header (no
 * target attribute). The address comes from an inbound message, so the href
 * gets attribute-level escaping: a quoted local part is legal in an address
 * and would otherwise close the attribute and let the sender add their own.
 */
function linkedEmail(email: string): string {
  return `&lt;<a href="mailto:${escapeAttr(email)}">${escapeHtml(email)}</a>&gt;`;
}

function recipientListHtml(list: EmailAddress[]): string {
  return list.map((a) => (a.name ? `${escapeHtml(a.name)} ${linkedEmail(a.email)}` : linkedEmail(a.email))).join(', ');
}

/** Inner HTML of the gmail_attr div for a forward. */
export function forwardHeaderHtml(original: Message, opts: DateFormatOptions = {}): string {
  const from = original.from;
  const fromHtml = from.name
    ? `<strong class="gmail_sendername" dir="auto">${escapeHtml(from.name)}</strong> <span dir="auto">${linkedEmail(from.email)}</span>`
    : `<span dir="auto">${linkedEmail(from.email)}</span>`;
  let s = `---------- Forwarded message ---------<br>From: ${fromHtml}<br>Date: ${escapeHtml(formatGmailDateTime(original.date, opts))}<br>Subject: ${escapeHtml(original.subject)}<br>To: ${recipientListHtml(original.to)}<br>`;
  if (original.cc.length) s += `Cc: ${recipientListHtml(original.cc)}<br>`;
  return s;
}

export function forwardHeaderText(original: Message, opts: DateFormatOptions = {}): string {
  const lines = [
    '---------- Forwarded message ---------',
    `From: ${addressText(original.from)}`,
    `Date: ${formatGmailDateTime(original.date, opts)}`,
    `Subject: ${original.subject}`,
    `To: ${original.to.map(addressText).join(', ')}`,
  ];
  if (original.cc.length) lines.push(`Cc: ${original.cc.map(addressText).join(', ')}`);
  return lines.map((l) => wrapLinkedAddressLine(l)).join('\n');
}

export { displayName };
