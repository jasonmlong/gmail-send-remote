import { describe, expect, it } from 'vitest';
import { composeReply } from '../src/core/compose.js';
import { base64Url, buildMime, decodeQuotedPrintable, formatRfc2822Date, fromBase64Url, quotedPrintable } from '../src/core/mime.js';
import { ME, REPLY_BODY, SIMPLE_SIG, TZ, vendorMessage } from './helpers.js';

describe('buildMime', () => {
  const r = composeReply(vendorMessage(), { body: REPLY_BODY, addBcc: [{ email: 'me+archive@example.com' }] }, { from: ME, signature: SIMPLE_SIG, timeZone: TZ });
  const mime = buildMime(r, { date: new Date('2026-09-18T18:05:01Z'), boundary: '000000000000abcdef012345', timeZone: TZ });

  it('writes Gmail-shaped headers with threading and a multipart/alternative body', () => {
    const head = mime.split('\r\n\r\n')[0];
    expect(head).toContain('MIME-Version: 1.0');
    expect(head).toContain('Date: Fri, 18 Sep 2026 13:05:01 -0500');
    expect(head).toContain('Subject: Re: How are things going?');
    expect(head).toContain('From: Sam Rivera <sam@example.com>');
    expect(head).toContain('To: Priya Nair <priya@example.com>');
    expect(head).toContain('Bcc: me+archive@example.com');
    expect(head).toContain('In-Reply-To: <CAMsg1@mail.example.com>');
    expect(head).toContain('References: <CAMsg0@mail.example.com> <CAMsg1@mail.example.com>');
    expect(head).toContain('Content-Type: multipart/alternative; boundary="000000000000abcdef012345"');
    expect(mime).toContain('--000000000000abcdef012345\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n');
    expect(mime).toContain('--000000000000abcdef012345\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n');
    expect(mime.trimEnd().endsWith('--000000000000abcdef012345--')).toBe(true);
  });

  it('quoted-printable round-trips the html and text exactly', () => {
    const parts = mime.split('--000000000000abcdef012345');
    // Each part ends with the CRLF that precedes the next boundary line; strip only that.
    const textPart = parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
    const htmlPart = parts[2].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
    expect(decodeQuotedPrintable(textPart)).toBe(r.text.replace(/\n/g, '\r\n'));
    expect(decodeQuotedPrintable(htmlPart)).toBe(r.html.replace(/\r\n|\n/g, '\r\n'));
  });

  it('encodes non-ASCII subjects and names per RFC 2047', () => {
    const rr = { ...r, subject: 'Café ☕', to: [{ name: 'José', email: 'j@x.com' }] };
    const m = buildMime(rr, { date: new Date(), boundary: 'b' });
    expect(m).toContain('Subject: =?UTF-8?B?Q2Fmw6kg4piV?=');
    expect(m).toContain('To: =?UTF-8?B?Sm9zw6k=?= <j@x.com>');
  });

  it('adds a multipart/mixed wrapper when attachments carry data', () => {
    const m = buildMime({ ...r, attachments: [{ filename: 'a.txt', mimeType: 'text/plain', data: Buffer.from('hello').toString('base64') }] }, { date: new Date() });
    expect(m).toContain('Content-Type: multipart/mixed; boundary="');
    expect(m).toContain('Content-Disposition: attachment; filename="a.txt"');
    expect(m).toContain('aGVsbG8=');
  });
});

describe('portable encoding (Apps Script has no Buffer)', () => {
  it('manual utf8/base64 match the Buffer fast path', async () => {
    const enc = await import('../src/core/encoding.js');
    const samples = ['plain', 'naïve café ☕ 𝄞', 'On Fri, Sep 18, 2026 at 7:00 AM', ''];
    for (const s of samples) {
      const bytes = enc.utf8Encode(s);
      expect(Array.from(bytes)).toEqual(Array.from(Buffer.from(s, 'utf8')));
      expect(enc.utf8Decode(bytes)).toBe(s);
      expect(enc.base64Encode(bytes)).toBe(Buffer.from(s, 'utf8').toString('base64'));
      expect(Array.from(enc.base64Decode(enc.base64Encode(bytes)))).toEqual(Array.from(bytes));
    }
    expect(enc.randomHex(12)).toMatch(/^[0-9a-f]{12}$/);
    expect(enc.randomAlnum(16)).toMatch(/^[A-Za-z0-9]{16}$/);
  });
});

describe('encoders', () => {
  it('quoted-printable respects 76 columns and encodes trailing spaces and = signs', () => {
    const long = 'x'.repeat(100) + ' \nline2=ok';
    const qp = quotedPrintable(long);
    for (const l of qp.split('\r\n')) expect(l.length).toBeLessThanOrEqual(76);
    expect(qp).toContain('=20\r\n');
    expect(qp).toContain('line2=3Dok');
    expect(decodeQuotedPrintable(qp)).toBe('x'.repeat(100) + ' \r\nline2=ok');
    expect(decodeQuotedPrintable(quotedPrintable('naïve — ok'))).toBe('naïve — ok');
  });
  it('base64url round-trips', () => {
    expect(fromBase64Url(base64Url('hi there?>'))).toBe('hi there?>');
    expect(base64Url('hi there?>')).not.toMatch(/[+/=]/);
  });
  it('formats RFC 2822 dates with offset', () => {
    expect(formatRfc2822Date(new Date('2026-01-05T03:04:05Z'), 'America/New_York')).toBe('Sun, 04 Jan 2026 22:04:05 -0500');
    expect(formatRfc2822Date(new Date('2026-01-05T03:04:05Z'), 'UTC')).toBe('Mon, 05 Jan 2026 03:04:05 +0000');
  });
});
