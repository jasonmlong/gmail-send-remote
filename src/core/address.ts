import type { EmailAddress } from './types.js';

/**
 * Collapse a raw header value to a single line.
 *
 * RFC 5322 lets a long value be folded across lines, where a line break
 * followed by whitespace continues the same value. A line break NOT followed
 * by whitespace is not legal inside a value, and letting one through would
 * allow a crafted string to forge a second header further down the pipeline.
 * Both cases become a space here, so nothing downstream ever sees a break.
 */
export function unfoldHeaderValue(raw: string): string {
  return raw.replace(/\r?\n[ \t]+/g, ' ').replace(/[\r\n]+/g, ' ');
}

/** Parse "Name <email>", "<email>", "email", or '"Last, First" <email>'. */
export function parseAddress(raw: string): EmailAddress {
  const s = unfoldHeaderValue(raw).trim();
  const m = s.match(/^(?:"([^"]*)"|([^<]*?))\s*<([^>]+)>$/);
  if (m) {
    const name = (m[1] ?? m[2] ?? '').trim();
    return name ? { name, email: m[3].trim() } : { email: m[3].trim() };
  }
  return { email: s.replace(/^<|>$/g, '').trim() };
}

/** Split a header value on commas that are outside quotes and angle brackets. */
export function parseAddressList(rawInput?: string | null): EmailAddress[] {
  if (!rawInput) return [];
  const raw = unfoldHeaderValue(rawInput);
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  let depth = 0;
  for (const ch of raw) {
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && ch === '<') depth++;
    else if (!inQuote && ch === '>') depth = Math.max(0, depth - 1);
    if (ch === ',' && !inQuote && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseAddress);
}

/** RFC 5322 header form. Quotes the display name when it needs it. */
export function formatAddress(a: EmailAddress): string {
  if (!a.name) return a.email;
  const needsQuote = /[^\w\s.'\-]/.test(a.name);
  const name = needsQuote ? `"${a.name.replace(/"/g, '\\"')}"` : a.name;
  return `${name} <${a.email}>`;
}

export function formatAddressList(list: EmailAddress[]): string {
  return list.map(formatAddress).join(', ');
}

/** Human form used inside attribution lines: Name <email> without quoting. */
export function addressText(a: EmailAddress): string {
  return a.name ? `${a.name} <${a.email}>` : `<${a.email}>`;
}

export function sameEmail(a: EmailAddress | string, b: EmailAddress | string): boolean {
  const ea = (typeof a === 'string' ? a : a.email).trim().toLowerCase();
  const eb = (typeof b === 'string' ? b : b.email).trim().toLowerCase();
  return ea === eb;
}

export function uniqueAddresses(list: EmailAddress[]): EmailAddress[] {
  const seen = new Set<string>();
  const out: EmailAddress[] = [];
  for (const a of list) {
    const key = a.email.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

export function withoutAddresses(list: EmailAddress[], exclude: Array<EmailAddress | string>): EmailAddress[] {
  return list.filter((a) => !exclude.some((e) => sameEmail(a, e)));
}

/** Gmail shows a display name when it has one; otherwise it shows the bare address. */
export function displayName(a: EmailAddress): string {
  return a.name?.trim() || a.email;
}
