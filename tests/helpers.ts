import type { Message, Signature } from '../src/core/types.js';

export const ME = { name: 'Sam Rivera', email: 'sam@example.com' };
export const TZ = 'America/Chicago';

export const SIMPLE_SIG: Signature = {
  id: 'sam@example.com',
  name: 'Simple',
  html: 'Sam Rivera<br>CEO<br>Northwind Labs<br>+1 (555) 010-4477',
};

/** Modeled on the observed vendor reply (synthetic content). */
export function vendorMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: '1a0b463dcb2563c4',
    threadId: '1a0acb482212687b',
    from: { name: 'Priya Nair', email: 'priya@example.com' },
    to: [ME],
    cc: [{ email: 'support@example.com' }],
    bcc: [],
    subject: 'Re: How are things going?',
    date: new Date('2026-09-18T12:00:26Z'),
    messageId: '<CAMsg1@mail.example.com>',
    references: ['<CAMsg0@mail.example.com>'],
    inReplyTo: '<CAMsg0@mail.example.com>',
    html: '<div dir="ltr">Hi Sam,<div><br></div><div>Out of 41 pitches we landed 3 links.</div><div><br></div><div>Thanks,</div><div>Priya</div></div>\r\n',
    text: 'Hi Sam,\n\nOut of 41 pitches we landed 3 links.\n\nThanks,\nPriya\n',
    labelIds: ['INBOX'],
    ...overrides,
  };
}

export const REPLY_BODY =
  "Hey Priya,\n\nThank you for the update.\n\n1. Let's go ahead and open up Northstar so you are less limited. We need to progress on this faster, even if it isn't perfect.\n2. For Helpdesk.example, its fine to go ahead and do the same and pitch to higher authority sites.\n\nThank you!";
