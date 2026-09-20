import { sameEmail, uniqueAddresses, withoutAddresses } from './address.js';
import type { EmailAddress, Message } from './types.js';

export interface ReplyRecipients {
  to: EmailAddress[];
  cc: EmailAddress[];
}

/**
 * Reproduces Gmail's Reply / Reply all recipient selection.
 *
 * Reply:      To = Reply-To (if set) else From.  Cc = none.
 *             If the original was sent by me, To = the original To list.
 * Reply all:  To = Reply-To/From + original To, minus me.
 *             Cc = original Cc, minus me and minus anyone already in To.
 *             If the original was sent by me, To/Cc are the original To/Cc.
 */
export function replyRecipients(original: Message, myEmails: string[], replyAll: boolean): ReplyRecipients {
  const isMe = (a: EmailAddress) => myEmails.some((m) => sameEmail(a, m));
  const fromMe = isMe(original.from);

  if (fromMe) {
    const to = uniqueAddresses(original.to);
    const cc = replyAll ? withoutAddresses(uniqueAddresses(original.cc), to) : [];
    return { to, cc };
  }

  const primary = original.replyTo?.length ? original.replyTo : [original.from];
  if (!replyAll) return { to: uniqueAddresses(primary), cc: [] };

  const to = uniqueAddresses([...primary, ...original.to]).filter((a) => !isMe(a));
  const cc = uniqueAddresses(original.cc).filter((a) => !isMe(a) && !to.some((t) => sameEmail(t, a)));
  return { to, cc };
}
