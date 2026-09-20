import { describe, expect, it } from 'vitest';
import { formatAddress, parseAddress, parseAddressList } from '../src/core/address.js';
import { replyRecipients } from '../src/core/recipients.js';
import { bareSubject, forwardSubject, replySubject } from '../src/core/subject.js';
import { ME, vendorMessage } from './helpers.js';

describe('address parsing', () => {
  it('parses the common header shapes', () => {
    expect(parseAddress('Sam Rivera <sam@x.com>')).toEqual({ name: 'Sam Rivera', email: 'sam@x.com' });
    expect(parseAddress('"Long, Sam" <sam@x.com>')).toEqual({ name: 'Long, Sam', email: 'sam@x.com' });
    expect(parseAddress('<sam@x.com>')).toEqual({ email: 'sam@x.com' });
    expect(parseAddress('sam@x.com')).toEqual({ email: 'sam@x.com' });
    expect(parseAddressList('"Long, Sam" <j@x.com>, Bo <bo@y.io>, c@z.org')).toEqual([
      { name: 'Long, Sam', email: 'j@x.com' },
      { name: 'Bo', email: 'bo@y.io' },
      { email: 'c@z.org' },
    ]);
  });
  it('quotes display names that need it', () => {
    expect(formatAddress({ name: 'Long, Sam', email: 'j@x.com' })).toBe('"Long, Sam" <j@x.com>');
    expect(formatAddress({ name: "Sam O'Long", email: 'j@x.com' })).toBe("Sam O'Long <j@x.com>");
  });
});

describe('replyRecipients', () => {
  const me = [ME.email];
  it('Reply goes to the sender only', () => {
    expect(replyRecipients(vendorMessage(), me, false)).toEqual({ to: [{ name: 'Priya Nair', email: 'priya@example.com' }], cc: [] });
  });
  it('Reply honors Reply-To', () => {
    const m = vendorMessage({ replyTo: [{ email: 'list@example.com' }] });
    expect(replyRecipients(m, me, false).to).toEqual([{ email: 'list@example.com' }]);
  });
  it('Reply all: sender + other To on To, Cc kept, me removed', () => {
    const m = vendorMessage({ to: [ME, { email: 'other@example.com' }], cc: [{ email: 'cc1@example.com' }, ME] });
    const r = replyRecipients(m, me, true);
    expect(r.to.map((a) => a.email)).toEqual(['priya@example.com', 'other@example.com']);
    expect(r.cc.map((a) => a.email)).toEqual(['cc1@example.com']);
  });
  it('Replying to my own sent message targets the original To', () => {
    const m = vendorMessage({ from: ME, to: [{ email: 'priya@example.com' }], cc: [{ email: 'cc1@example.com' }] });
    expect(replyRecipients(m, me, false)).toEqual({ to: [{ email: 'priya@example.com' }], cc: [] });
    expect(replyRecipients(m, me, true)).toEqual({ to: [{ email: 'priya@example.com' }], cc: [{ email: 'cc1@example.com' }] });
  });
  it('treats sendAs aliases as me', () => {
    const m = vendorMessage({ to: [{ email: 'alias@example.com' }, { email: 'x@example.com' }] });
    expect(replyRecipients(m, [ME.email, 'alias@example.com'], true).to.map((a) => a.email)).toEqual(['priya@example.com', 'x@example.com']);
  });
});

describe('subjects', () => {
  it('prefixes like Gmail', () => {
    expect(replySubject('Hello')).toBe('Re: Hello');
    expect(replySubject('RE: Hello')).toBe('RE: Hello');
    expect(replySubject('')).toBe('Re:');
    expect(forwardSubject('Re: Hello')).toBe('Fwd: Re: Hello');
    expect(forwardSubject('FW: x')).toBe('FW: x');
    expect(forwardSubject('')).toBe('Fwd:');
    expect(bareSubject('Re: Fwd: RE: Topic')).toBe('Topic');
  });
});
