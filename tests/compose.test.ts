import { describe, expect, it } from 'vitest';
import { composeForward, composeNew, composeReply, GMAIL_BLOCKQUOTE_OPEN } from '../src/core/compose.js';
import { ME, REPLY_BODY, SIMPLE_SIG, TZ, vendorMessage } from './helpers.js';

const NN = ' ';

describe('composeReply (Gmail default: signature after quote)', () => {
  const original = vendorMessage();
  const r = composeReply(original, { body: REPLY_BODY }, { from: ME, signature: SIMPLE_SIG, timeZone: TZ });

  it('renders the exact HTML structure Gmail emits for a reply', () => {
    const expected =
      '<div dir="ltr">Hey Priya,<div><br></div><div>Thank you for the update.</div><div><br></div>' +
      '<div>1. Let&#39;s go ahead and open up Northstar so you are less limited. We need to progress on this faster, even if it isn&#39;t perfect.</div>' +
      '<div>2. For Helpdesk.example, its fine to go ahead and do the same and pitch to higher authority sites.</div>' +
      '<div><br></div><div>Thank you!</div></div><br>' +
      '<div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">' +
      `On Fri, Sep 18, 2026 at 7:00${NN}AM Priya Nair &lt;priya@example.com&gt; wrote:<br></div>` +
      GMAIL_BLOCKQUOTE_OPEN +
      original.html +
      '</blockquote></div>' +
      '<div><br clear="all"></div><div><br></div><span class="gmail_signature_prefix">-- </span><br>' +
      '<div dir="ltr" class="gmail_signature">Sam Rivera<br>CEO<br>Northwind Labs<br>+1 (555) 010-4477</div>\r\n';
    expect(r.html).toBe(expected);
  });

  it('renders the plain-text part wrapped at 72 with Gmail quoting and the -- signature', () => {
    const expected = [
      'Hey Priya,',
      '',
      'Thank you for the update.',
      '',
      "1. Let's go ahead and open up Northstar so you are less limited. We need",
      "to progress on this faster, even if it isn't perfect.",
      '2. For Helpdesk.example, its fine to go ahead and do the same and pitch',
      'to higher authority sites.',
      '',
      'Thank you!',
      '',
      `On Fri, Sep 18, 2026 at 7:00${NN}AM Priya Nair <priya@example.com> wrote:`,
      '',
      '> Hi Sam,',
      '>',
      '> Out of 41 pitches we landed 3 links.',
      '>',
      '> Thanks,',
      '> Priya',
      '',
      '--',
      'Sam Rivera',
      'CEO',
      'Northwind Labs',
      '+1 (555) 010-4477',
    ].join('\n');
    expect(r.text).toBe(expected);
  });

  it('sets subject, recipients and threading headers like Gmail Reply', () => {
    expect(r.subject).toBe('Re: How are things going?');
    expect(r.to).toEqual([{ name: 'Priya Nair', email: 'priya@example.com' }]);
    expect(r.cc).toEqual([]);
    expect(r.threadId).toBe(original.threadId);
    expect(r.inReplyTo).toBe('<CAMsg1@mail.example.com>');
    expect(r.references).toEqual(['<CAMsg0@mail.example.com>', '<CAMsg1@mail.example.com>']);
    expect(r.originalMessageId).toBe(original.id);
  });

  it('breaks the attribution before "wrote:" once the line passes 72 columns', () => {
    const longName = vendorMessage({ from: { name: 'Priyanka Ramaswamy-Nair', email: 'priyanka@example-agency.com' } });
    const rr = composeReply(longName, { body: 'Hey,\n\nOk.\n\nThank you!' }, { from: ME, timeZone: TZ });
    const attr = rr.text.split('\n\n')[3];
    expect(attr).toBe(`On Fri, Sep 18, 2026 at 7:00${NN}AM Priyanka Ramaswamy-Nair <priyanka@example-agency.com>\nwrote:`);
    // Only "wrote:" moves down. Gmail does not break inside "Name <email>", so
    // the first line is allowed to run past 72 columns and here it does.
    expect(attr.split('\n')[0].length).toBeGreaterThan(72);
    expect(attr.split('\n')[1]).toBe('wrote:');
  });

  it('keeps a short attribution on one line', () => {
    const short = vendorMessage({ from: { name: 'Bo', email: 'bo@x.io' } });
    const rr = composeReply(short, { body: 'Hey Bo,\n\nOk.\n\nThank you!' }, { from: ME, timeZone: TZ });
    expect(rr.text).toContain(`\n\nOn Fri, Sep 18, 2026 at 7:00${NN}AM Bo <bo@x.io> wrote:\n\n> Hi Sam,`);
  });

  it('reply-all puts the other recipients on Cc and drops me', () => {
    const rr = composeReply(original, { body: 'Hey all,\n\nSounds good.\n\nThank you!', replyAll: true }, { from: ME, timeZone: TZ });
    expect(rr.to.map((a) => a.email)).toEqual(['priya@example.com']);
    expect(rr.cc.map((a) => a.email)).toEqual(['support@example.com']);
  });

  it('honors the before-quote signature setting (no -- line, signature inside the body div)', () => {
    const rr = composeReply(original, { body: 'Hey Priya,\n\nOk.\n\nThank you!' }, { from: ME, signature: SIMPLE_SIG, timeZone: TZ, signaturePlacement: 'before-quote' });
    expect(rr.html.startsWith('<div dir="ltr">Hey Priya,<div><br></div><div>Ok.</div><div><br></div><div>Thank you!</div><div><br></div><div><div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature">Sam Rivera<br>')).toBe(true);
    expect(rr.html).not.toContain('gmail_signature_prefix');
    expect(rr.html.indexOf('gmail_signature')).toBeLessThan(rr.html.indexOf('gmail_quote_container'));
    expect(rr.text).toContain('Thank you!\n\nSam Rivera\nCEO\nNorthwind Labs\n+1 (555) 010-4477\n\nOn Fri');
    expect(rr.text).not.toContain('\n--\n');
  });

  it('without a signature there is no signature block at all', () => {
    const rr = composeReply(original, { body: 'Hey Priya,\n\nOk.\n\nThank you!' }, { from: ME, timeZone: TZ });
    expect(rr.html).not.toContain('gmail_signature');
    expect(rr.html.endsWith('</blockquote></div>\r\n')).toBe(true);
    expect(rr.text.endsWith('> Priya\n')).toBe(true);
  });

  it('a second reply nests the previous quote and stacks > markers', () => {
    const first = composeReply(original, { body: 'Hey Priya,\n\nOk.\n\nThank you!' }, { from: ME, timeZone: TZ });
    const sentByMe = vendorMessage({ id: 'm2', from: ME, to: [original.from], cc: [], subject: first.subject, html: first.html, text: first.text, messageId: '<CAMsg2@mail.example.com>', references: first.references, inReplyTo: first.inReplyTo, date: new Date('2026-09-18T13:05:01Z') });
    const theirs = vendorMessage({ id: 'm3', from: original.from, subject: 'Re: How are things going?', html: `<div dir="ltr">Great, thanks!</div><br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">On Fri, Sep 18, 2026 at 8:05${NN}AM Sam Rivera &lt;sam@example.com&gt; wrote:<br></div>${GMAIL_BLOCKQUOTE_OPEN}${first.html}</blockquote></div>\r\n`, text: `Great, thanks!\n\nOn Fri, Sep 18, 2026 at 8:05${NN}AM Sam Rivera <sam@example.com> wrote:\n\n> Hey Priya,\n>\n> Ok.\n>\n> Thank you!\n>\n> On Fri, Sep 18, 2026 at 7:00${NN}AM Priya Nair <priya@example.com>\n> wrote:\n>\n>> Hi Sam,\n>>\n>> Out of 41 pitches we landed 3 links.\n>\n`, messageId: '<CAMsg3@mail.example.com>', references: [...(sentByMe.references ?? []), '<CAMsg2@mail.example.com>'], date: new Date('2026-09-18T14:00:00Z') });
    const second = composeReply(theirs, { body: 'Hey Priya,\n\nPerfect.\n\nThank you!' }, { from: ME, timeZone: TZ });
    expect(second.text).toContain('> Great, thanks!\n>\n> On Fri, Sep 18, 2026 at 8:05');
    expect(second.text).toContain('>> Hey Priya,\n>>\n>> Ok.');
    expect(second.text).toContain('>>> Hi Sam,');
    expect(second.references).toEqual(['<CAMsg0@mail.example.com>', '<CAMsg1@mail.example.com>', '<CAMsg2@mail.example.com>', '<CAMsg3@mail.example.com>']);
    // the whole earlier HTML is nested verbatim inside the new blockquote
    expect(second.html).toContain(GMAIL_BLOCKQUOTE_OPEN + theirs.html + '</blockquote>');
  });
});

describe('composeNew', () => {
  it('renders the exact new-compose structure with every line in a div and the smartmail signature', () => {
    const r = composeNew(
      { to: [{ email: 'marco@example.com' }], subject: "Can't make the meeting tomorrow", body: 'Hey Marco,\n\nIf you want to chat earlier in the day, before 12:30pm PST, I can chat.\n' },
      { from: ME, signature: SIMPLE_SIG, timeZone: TZ },
    );
    expect(r.html).toBe(
      '<div dir="ltr"><div>Hey Marco,</div><div><br></div><div>If you want to chat earlier in the day, before 12:30pm PST, I can chat.</div><div><br></div>' +
        '<span class="gmail_signature_prefix">-- </span><br><div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature">Sam Rivera<br>CEO<br>Northwind Labs<br>+1 (555) 010-4477</div></div>\r\n',
    );
    expect(r.text).toBe('Hey Marco,\n\nIf you want to chat earlier in the day, before 12:30pm PST, I can chat.\n\n--\nSam Rivera\nCEO\nNorthwind Labs\n+1 (555) 010-4477');
    expect(r.subject).toBe("Can't make the meeting tomorrow");
    expect(r.threadId).toBeUndefined();
  });

  it('auto-links URLs and emails like Gmail does on send', () => {
    const r = composeNew({ to: [], subject: 's', body: 'See https://example.com/a?b=1&c=2 and mail bob@example.com.' }, { from: ME });
    expect(r.html).toContain('<a href="https://example.com/a?b=1&amp;c=2" target="_blank">https://example.com/a?b=1&amp;c=2</a> and mail <a href="mailto:bob@example.com" target="_blank">bob@example.com</a>.');
  });
});

describe('composeForward', () => {
  const original = vendorMessage({
    to: [{ name: 'Lena Ortiz', email: 'lena@example-fund.com' }, { name: 'Tomas Brandt Whitfield', email: 'Whitfield@example-fund.com' }, ME],
    cc: [{ name: 'Owen Clarke Fairweather', email: 'owen@example-fund.com' }],
    subject: 'Re: Meridian Website: 2nd Call',
    date: new Date('2026-09-10T13:28:04Z'),
    html: '<div dir="ltr"><div id="Signature">Either day works for me.</div></div>\r\n',
    text: 'Either day works for me.',
    attachments: [{ filename: 'a.pdf', mimeType: 'application/pdf', size: 10 }],
  });
  const r = composeForward(original, { to: [{ email: 'sofia@example.com' }], forwardSeed: '488889583641520949' }, { from: ME, signature: SIMPLE_SIG, timeZone: 'America/New_York' });

  it('renders the forwarded-message header block, msg wrapper and after-quote signature', () => {
    expect(r.html).toBe(
      '<div dir="ltr"><br><br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>' +
        'From: <strong class="gmail_sendername" dir="auto">Priya Nair</strong> <span dir="auto">&lt;<a href="mailto:priya@example.com">priya@example.com</a>&gt;</span><br>' +
        `Date: Thu, Sep 10, 2026 at 9:28${NN}AM<br>Subject: Re: Meridian Website: 2nd Call<br>` +
        'To: Lena Ortiz &lt;<a href="mailto:lena@example-fund.com">lena@example-fund.com</a>&gt;, Tomas Brandt Whitfield &lt;<a href="mailto:Whitfield@example-fund.com">Whitfield@example-fund.com</a>&gt;, Sam Rivera &lt;<a href="mailto:sam@example.com">sam@example.com</a>&gt;<br>' +
        'Cc: Owen Clarke Fairweather &lt;<a href="mailto:owen@example-fund.com">owen@example-fund.com</a>&gt;<br></div><br><br>' +
        '<div class="msg-488889583641520949"><div dir="ltr"><div id="m_-488889583641520949Signature">Either day works for me.</div></div>\r\n</div></div>' +
        '<div><br clear="all"></div><div><br></div><span class="gmail_signature_prefix">-- </span><br><div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature">Sam Rivera<br>CEO<br>Northwind Labs<br>+1 (555) 010-4477</div></div>\r\n',
    );
  });

  it('renders the text header and breaks long address lines after "<" like Gmail', () => {
    expect(r.text).toBe(
      [
        '---------- Forwarded message ---------',
        'From: Priya Nair <priya@example.com>',
        `Date: Thu, Sep 10, 2026 at 9:28${NN}AM`,
        'Subject: Re: Meridian Website: 2nd Call',
        'To: Lena Ortiz <lena@example-fund.com>, Tomas Brandt Whitfield <',
        'Whitfield@example-fund.com>, Sam Rivera <sam@example.com>',
        'Cc: Owen Clarke Fairweather <owen@example-fund.com>',
        '',
        'Either day works for me.',
        '',
        '--',
        'Sam Rivera',
        'CEO',
        'Northwind Labs',
        '+1 (555) 010-4477',
      ].join('\n'),
    );
  });

  it('uses the Fwd: subject, carries attachments and keeps the thread', () => {
    expect(r.subject).toBe('Fwd: Re: Meridian Website: 2nd Call');
    expect(r.attachments?.[0].filename).toBe('a.pdf');
    expect(r.threadId).toBe(original.threadId);
    expect(r.to).toEqual([{ email: 'sofia@example.com' }]);
  });

  it('puts a typed note above the forwarded block', () => {
    const rr = composeForward(original, { to: [{ email: 'c@example.com' }], body: 'FYI', forwardSeed: '1' }, { from: ME, timeZone: 'America/New_York' });
    expect(rr.html.startsWith('<div dir="ltr">FYI<br><br><div class="gmail_quote gmail_quote_container">')).toBe(true);
    expect(rr.text.startsWith('FYI\n\n\n---------- Forwarded message ---------')).toBe(true);
    expect(rr.html).not.toContain('gmail_signature');
  });
});
