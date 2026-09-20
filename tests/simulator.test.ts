import { describe, expect, it } from 'vitest';
import { DraftingService } from '../src/drafting.js';
import { renderConversationPreview } from '../src/simulator/preview.js';
import { seedDemoMailbox } from '../src/simulator/seed.js';
import { SimulatedGmail } from '../src/simulator/simulator.js';
import { SIMPLE_SIG, TZ } from './helpers.js';

async function setup() {
  const sim = new SimulatedGmail();
  const ids = seedDemoMailbox(sim);
  await sim.saveSignature({ ...SIMPLE_SIG, isDefault: true });
  const drafting = new DraftingService(sim, { timeZone: TZ, allowSend: true });
  return { sim, ids, drafting };
}

describe('simulator end to end', () => {
  it('reads seeded threads with Gmail-like ids and search', async () => {
    const { sim } = await setup();
    const all = await sim.listThreads();
    expect(all).toHaveLength(3);
    expect(all[0].id).toMatch(/^[0-9a-f]{16}$/);
    const vendor = await sim.listThreads({ query: 'from:priya subject:"how are things"' });
    expect(vendor).toHaveLength(1);
    expect(vendor[0].messageCount).toBe(2);
    expect((await sim.listThreads({ query: 'in:inbox is:unread' })).length).toBe(3);
    expect((await sim.listThreads({ query: 'in:sent' })).length).toBe(1);
  });

  it('drafts a reply into the thread, then sends it and receives the next answer', async () => {
    const { sim, ids, drafting } = await setup();
    const draft = await drafting.draftReply({ threadId: ids.vendorThreadId, body: 'Hey Priya,\n\nGo ahead.\n\nThank you!' });
    expect(draft.threadId).toBe(ids.vendorThreadId);
    expect(draft.rendered?.subject).toBe('Re: How are things going?');
    expect(draft.rendered?.to.map((a) => a.email)).toEqual(['priya@example-agency.com']);
    expect(draft.rendered?.html).toContain('<div dir="ltr" class="gmail_signature">Sam Rivera<br>');
    expect(draft.raw).toContain('In-Reply-To: <CA+');
    expect((await sim.listDrafts(ids.vendorThreadId)).map((d) => d.id)).toEqual([draft.id]);

    const sent = await drafting.send(draft.id);
    expect(sent.labelIds).toEqual(['SENT']);
    expect((await sim.getThread(ids.vendorThreadId)).messages).toHaveLength(3);
    expect(await sim.listDrafts()).toHaveLength(0);

    sim.receive({ from: 'Priya Nair <priya@example-agency.com>', subject: 'Re: How are things going?', text: 'Great, thanks!', threadId: ids.vendorThreadId, inReplyToMessageId: sent.id });
    const again = await drafting.draftReply({ threadId: ids.vendorThreadId, body: 'Hey Priya,\n\nPerfect.\n\nThank you!' });
    expect(again.rendered?.text).toContain('> Great, thanks!');
    expect(again.rendered?.references?.length).toBe(4);
  });

  it('reply-all on the group thread keeps everyone but me', async () => {
    const { ids, drafting } = await setup();
    const d = await drafting.draftReply({ threadId: ids.groupThreadId, body: 'Hey all,\n\nFriday works.\n\nSee you Friday!', replyAll: true });
    expect(d.rendered?.to.map((a) => a.email)).toEqual(['lena@example-fund.com', 'whitfield@example-fund.com']);
    expect(d.rendered?.cc.map((a) => a.email)).toEqual(['owen@example-fund.com']);
  });

  it('forwards with attachments and a Fwd: subject', async () => {
    const { ids, drafting } = await setup();
    const d = await drafting.draftForward({ messageId: ids.attachmentMessageId, to: [{ email: 'bookkeeper@example.com' }], body: 'FYI, please pay this.' });
    expect(d.rendered?.subject).toBe('Fwd: Invoice 4471 for September');
    expect(d.rendered?.attachments?.[0].filename).toBe('invoice-4471.pdf');
    expect(d.raw).toContain('Content-Disposition: attachment; filename="invoice-4471.pdf"');
    expect(d.rendered?.html).toContain('---------- Forwarded message ---------');
  });

  it('updates a draft by re-rendering the body', async () => {
    const { ids, drafting } = await setup();
    const d = await drafting.draftReply({ threadId: ids.vendorThreadId, body: 'Hey Priya,\n\nFirst try.\n\nThank you!' });
    const u = await drafting.updateDraft(d.id, { body: 'Hey Priya,\n\nSecond try.\n\nThank you!', addCc: undefined } as never);
    expect(u.id).toBe(d.id);
    expect(u.rendered?.text.startsWith('Hey Priya,\n\nSecond try.')).toBe(true);
    expect(u.rendered?.html).toContain('gmail_quote_container');
  });

  it('signature selection: by id, none, default', async () => {
    const { sim, ids, drafting } = await setup();
    await sim.saveSignature({ id: 'alt', name: 'Alt', html: 'Alt Sig' });
    const byId = await drafting.draftReply({ threadId: ids.vendorThreadId, body: 'Hey,\n\nx\n\nThank you!', signatureId: 'alt' });
    expect(byId.rendered?.html).toContain('class="gmail_signature">Alt Sig</div>');
    const none = await drafting.draftReply({ threadId: ids.vendorThreadId, body: 'Hey,\n\nx\n\nThank you!', signatureId: 'none' });
    expect(none.rendered?.html).not.toContain('gmail_signature');
    await expect(drafting.draftReply({ threadId: ids.vendorThreadId, body: 'x', signatureId: 'missing' })).rejects.toThrow(/Signature not found/);
  });

  it('sending is blocked unless enabled', async () => {
    const sim = new SimulatedGmail();
    const ids = seedDemoMailbox(sim);
    const drafting = new DraftingService(sim, { timeZone: TZ });
    const d = await drafting.draftReply({ threadId: ids.vendorThreadId, body: 'Hey,\n\nx\n\nThank you!' });
    await expect(drafting.send(d.id)).rejects.toThrow(/disabled/);
  });

  it('renders a conversation preview page with the draft compose box', async () => {
    const { sim, ids, drafting } = await setup();
    const d = await drafting.draftReply({ threadId: ids.vendorThreadId, body: 'Hey Priya,\n\nGo ahead.\n\nThank you!' });
    const html = renderConversationPreview(await sim.getThread(ids.vendorThreadId), [d], { timeZone: TZ, me: 'sam@example.com' });
    expect(html).toContain('<title>How are things going?</title>');
    expect(html).toContain('class="draft-label">Draft<');
    expect(html).toContain('Reply');
    expect(html).toContain('gmail_quote_container');
  });

  it('persists to disk and reloads', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-send-')), 'store.json');
    const sim = new SimulatedGmail(file);
    const ids = seedDemoMailbox(sim);
    const reloaded = new SimulatedGmail(file);
    const t = await reloaded.getThread(ids.vendorThreadId);
    expect(t.messages[0].date).toBeInstanceOf(Date);
    expect(t.messages).toHaveLength(2);
  });
});
