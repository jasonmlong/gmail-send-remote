import type { SimulatedGmail } from './simulator.js';

/**
 * A synthetic mailbox modeled on real Gmail traffic shapes: a vendor status
 * thread with a reply already in it, a scheduling thread with several
 * participants (for reply-all), and a message with an attachment (for forward).
 * Names and content are invented.
 */
export function seedDemoMailbox(sim: SimulatedGmail, me = { email: 'sam@example.com', name: 'Sam Rivera' }): { vendorThreadId: string; groupThreadId: string; attachmentMessageId: string } {
  // the owner's Google Calendar reports America/Cancun (UTC-5 all year), which is the clock his reply sample used.
  sim.setProfile(me.email, me.name, [], 'America/Cancun');

  const d = (iso: string) => new Date(iso);

  // 1. Vendor status thread: I asked, they answered. The obvious next action is a reply.
  const ask = sim.receive({
    from: me,
    to: ['support@example-agency.com'],
    subject: 'How are things going?',
    text: "Hey Paul,\n\nI haven't heard much in a while from you guys and just wanted to see how things were going with the link generation.\n\nThank you!",
    date: d('2026-09-17T00:12:05Z'),
  });
  sim.receive({
    from: { name: 'Priya Nair', email: 'priya@example-agency.com' },
    to: [me],
    cc: ['support@example-agency.com'],
    subject: 'Re: How are things going?',
    text:
      'Hi Sam,\n\nHope you are well.\n\nOut of 41 pitches sent so far, we have landed 3 live links. Two are DR 56 and one is DR 58.\n\nGiven the strict niche requirements our pitching is limited so far to fewer queries. We would like to pitch to higher authority sites even if they are in a general business niche just to increase the velocity of links being landed.\n\nLet me know what you think.\n\nThanks,\nPriya N.',
    date: d('2026-09-18T12:00:26Z'),
    threadId: ask.threadId,
  });

  // 2. Scheduling thread with several people (reply-all territory).
  const invite = sim.receive({
    from: { name: 'Tomas Brandt', email: 'whitfield@example-fund.com' },
    to: [me],
    cc: [
      { name: 'Lena Ortiz', email: 'lena@example-fund.com' },
      { name: 'Owen Clarke', email: 'owen@example-fund.com' },
    ],
    subject: 'Website: 2nd call',
    text: 'Sam,\n\nFriday the 18th would be preferable for me, but I can make the 17th work too. CCing the rest of the group for their input.\n\nTomas',
    date: d('2026-09-09T17:02:04Z'),
  });
  sim.receive({
    from: { name: 'Lena Ortiz', email: 'lena@example-fund.com' },
    to: [{ name: 'Tomas Brandt', email: 'whitfield@example-fund.com' }, me],
    cc: [{ name: 'Owen Clarke', email: 'owen@example-fund.com' }],
    subject: 'Re: Website: 2nd call',
    text: 'Either of the two days suggested work for me!\n\nLena',
    date: d('2026-09-10T12:41:23Z'),
    threadId: invite.threadId,
  });

  // 3. A message carrying an attachment, handy for forward tests.
  const withAttachment = sim.receive({
    from: { name: 'Accounts Payable', email: 'ap@example-vendor.com' },
    to: [me],
    subject: 'Invoice 4471 for September',
    text: 'Hi Sam,\n\nPlease find attached invoice 4471 for September services. Payment terms are net 30.\n\nRegards,\nAccounts Payable',
    date: d('2026-09-16T15:30:00Z'),
  });
  withAttachment.attachments = [
    {
      id: 'att-4471',
      filename: 'invoice-4471.pdf',
      mimeType: 'application/pdf',
      size: 48213,
      data: Buffer.from('%PDF-1.4\n% synthetic placeholder\n').toString('base64'),
    },
  ];

  return { vendorThreadId: ask.threadId, groupThreadId: invite.threadId, attachmentMessageId: withAttachment.id };
}
