/**
 * RFC 822 / MIME serialization of a RenderedMessage, shaped like what Gmail
 * itself produces: multipart/alternative with quoted-printable text and HTML
 * parts, wrapped in multipart/mixed when attachments are present.
 *
 * Runtime-agnostic (Node, browser, Apps Script): no Node imports.
 */
import { formatAddress } from './address.js';
import { base64Decode, base64Encode, randomAlnum, randomHex, utf8Decode, utf8Encode } from './encoding.js';
import type { RenderedMessage } from './types.js';

export interface MimeOptions {
  date?: Date;
  /** Provide to pin the Message-ID; Gmail assigns one on send when absent. */
  messageId?: string;
  boundary?: string;
  timeZone?: string;
}

/** Gmail-style boundary: twelve zeros followed by twelve hex characters. */
export function gmailBoundary(): string {
  return '000000000000' + randomHex(12);
}

/**
 * Guards a value on its way into a message header.
 *
 * A carriage return or line feed here ends the header and lets whatever
 * follows start a new one, so a single crafted recipient string could add a
 * hidden Bcc to a draft. This throws rather than stripping: a malformed
 * address should surface loudly, not quietly become a different address.
 *
 * Note that Subject and display names are already safe by a different route.
 * They run through RFC 2047 encoding, whose guard tests for non-printable
 * characters, and CR and LF are non-printable. That is accidental rather than
 * designed, so do not narrow that test without reading `encodeHeaderText`.
 */
export function headerValue(value: string, field: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error(`Illegal line break in ${field}. Header values cannot contain a carriage return or line feed.`);
  }
  return value;
}

export function buildMime(msg: RenderedMessage, opts: MimeOptions = {}): string {
  const date = opts.date ?? new Date();
  const altBoundary = opts.boundary ?? gmailBoundary();
  const headers: string[] = [];
  headers.push('MIME-Version: 1.0');
  headers.push(`Date: ${formatRfc2822Date(date, opts.timeZone)}`);
  if (opts.messageId) headers.push(`Message-ID: ${headerValue(opts.messageId, 'Message-ID')}`);
  headers.push(`Subject: ${encodeHeaderText(msg.subject)}`);
  headers.push(`From: ${encodeAddressHeader([msg.from], 'From')}`);
  if (msg.to.length) headers.push(`To: ${encodeAddressHeader(msg.to, 'To')}`);
  if (msg.cc.length) headers.push(`Cc: ${encodeAddressHeader(msg.cc, 'Cc')}`);
  if (msg.bcc.length) headers.push(`Bcc: ${encodeAddressHeader(msg.bcc, 'Bcc')}`);
  if (msg.inReplyTo) headers.push(`In-Reply-To: ${headerValue(msg.inReplyTo, 'In-Reply-To')}`);
  if (msg.references?.length) headers.push(`References: ${msg.references.map((r) => headerValue(r, 'References')).join(' ')}`);

  const alternative = [
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    // The CRLF before each boundary line belongs to the delimiter (RFC 2046), so the
    // part content is exactly the encoded text, nothing appended.
    quotedPrintable(msg.text),
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    quotedPrintable(msg.html),
    `--${altBoundary}--`,
  ].join('\r\n');

  const attachments = (msg.attachments ?? []).filter((a) => a.data);
  if (!attachments.length) {
    headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    return headers.join('\r\n') + '\r\n\r\n' + alternative + '\r\n';
  }

  const mixedBoundary = gmailBoundary();
  headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
  const parts: string[] = [];
  parts.push(`--${mixedBoundary}\r\nContent-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n${alternative}`);
  for (const a of attachments) {
    parts.push(
      [
        `--${mixedBoundary}`,
        `Content-Type: ${headerValue(a.mimeType, 'attachment mimeType')}; name="${headerValue(a.filename, 'attachment filename')}"`,
        `Content-Disposition: attachment; filename="${headerValue(a.filename, 'attachment filename')}"`,
        'Content-Transfer-Encoding: base64',
        '',
        foldBase64(a.data as string),
      ].join('\r\n'),
    );
  }
  parts.push(`--${mixedBoundary}--`);
  return headers.join('\r\n') + '\r\n\r\n' + parts.join('\r\n') + '\r\n';
}

function foldBase64(b64: string): string {
  return b64.replace(/\s+/g, '').match(/.{1,76}/g)?.join('\r\n') ?? '';
}

/**
 * Hook for runtimes whose Intl lacks timezone data (Apps Script): supply a
 * function that formats "Fri, 18 Sep 2026 13:05:01 -0500" for a zone.
 */
export let rfc2822Formatter: ((date: Date, timeZone: string) => string) | null = null;
export function setRfc2822Formatter(fn: ((date: Date, timeZone: string) => string) | null): void {
  rfc2822Formatter = fn;
}

/** "Fri, 18 Sep 2026 13:05:01 -0500" */
export function formatRfc2822Date(date: Date, timeZone?: string): string {
  const tz = timeZone ?? 'UTC';
  if (rfc2822Formatter) return rfc2822Formatter(date, tz);
  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: tz,
    timeZoneName: 'longOffset',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const off = get('timeZoneName'); // "GMT-05:00" or "GMT"
  const m = off.match(/([+-])(\d{2}):(\d{2})/);
  const offset = m ? `${m[1]}${m[2]}${m[3]}` : '+0000';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('weekday')}, ${get('day')} ${get('month')} ${get('year')} ${hour}:${get('minute')}:${get('second')} ${offset}`;
}

/** RFC 2047 B-encoding for header text with non-ASCII characters. */
export function encodeHeaderText(s: string): string {
  if (!/[^\x20-\x7e]/.test(s)) return s;
  return `=?UTF-8?B?${base64Encode(utf8Encode(s))}?=`;
}

function encodeAddressHeader(list: RenderedMessage['to'], field: string): string {
  return list
    .map((a) => {
      // The address itself is never encoded, so it is the one part that can carry a line
      // break into the header. The display name is safe either way: a name containing a
      // line break is non-printable and therefore takes the base64 branch below.
      const email = headerValue(a.email, `${field} address`);
      if (a.name && /[^\x20-\x7e]/.test(a.name)) return `${encodeHeaderText(a.name)} <${email}>`;
      return formatAddress({ ...a, email });
    })
    .join(', ');
}

/** Quoted-printable per RFC 2045 with 76-column soft breaks and CRLF line endings. */
export function quotedPrintable(input: string): string {
  const normalized = input.replace(/\r\n?|\n/g, '\r\n');
  const bytes = utf8Encode(normalized);
  let out = '';
  let lineLen = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 13 && bytes[i + 1] === 10) {
      out += '\r\n';
      lineLen = 0;
      i++;
      continue;
    }
    const atLineEnd = i + 1 >= bytes.length || (bytes[i + 1] === 13 && bytes[i + 2] === 10);
    let token: string;
    if ((b >= 33 && b <= 126 && b !== 61) || ((b === 32 || b === 9) && !atLineEnd)) {
      token = String.fromCharCode(b);
    } else {
      token = '=' + b.toString(16).toUpperCase().padStart(2, '0');
    }
    if (lineLen + token.length > 75) {
      out += '=\r\n';
      lineLen = 0;
    }
    out += token;
    lineLen += token.length;
  }
  return out;
}

export function decodeQuotedPrintable(input: string): string {
  const joined = input.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    const ch = joined[i];
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(ch.charCodeAt(0) & 0xff);
  }
  return utf8Decode(Uint8Array.from(bytes));
}

export function base64Url(s: string): string {
  return base64Encode(utf8Encode(s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): string {
  return utf8Decode(base64Decode(s));
}

/** Gmail-shaped Message-ID for the simulator. */
export function gmailMessageId(): string {
  return `<CA+${randomAlnum(16)}=${randomAlnum(32)}@mail.gmail.com>`;
}
