import { describe, expect, it } from 'vitest';
import { AppsScriptProvider, type FetchLike } from '../src/appsscript/client.js';
import { DraftingService } from '../src/drafting.js';
import { seedDemoMailbox } from '../src/simulator/seed.js';
import { SimulatedGmail } from '../src/simulator/simulator.js';
import { SIMPLE_SIG } from './helpers.js';

/**
 * Stands in for the deployed web app: implements the wire protocol from
 * docs/APPS-SCRIPT-API.md on top of the simulator, including the token check
 * and the {ok, result|error} envelope, so the client mapping is exercised end to end.
 */
function fakeWebApp(sim: SimulatedGmail, token: string): FetchLike {
  return async (_url, init) => {
    const req = JSON.parse(init.body) as Record<string, any>;
    const reply = (obj: unknown) => ({ status: 200, text: async () => JSON.stringify(obj) });
    if (req.token !== token) return reply({ ok: false, error: 'Unauthorized' });
    try {
      let result: unknown;
      switch (req.action) {
        case 'profile':
          result = await sim.getProfile();
          break;
        case 'listThreads':
          result = await sim.listThreads({ query: req.query, max: req.max });
          break;
        case 'getThread':
          result = await sim.getThread(req.threadId);
          break;
        case 'getMessage':
          result = await sim.getMessage(req.messageId);
          break;
        case 'listSignatures':
          result = await sim.listSignatures();
          break;
        case 'saveSignature':
          result = await sim.saveSignature({ id: req.sendAsEmail, name: req.sendAsEmail, html: req.html, sendAsEmail: req.sendAsEmail, source: 'gmail' });
          break;
        case 'listDrafts':
          result = (await sim.listDrafts(req.threadId)).map(strip);
          break;
        case 'getDraft':
          result = strip(await sim.getDraft(req.draftId));
          break;
        case 'createDraft':
          result = strip(await sim.createDraft({ raw: req.raw, rendered: { mode: 'reply', subject: '', from: { email: 'x' }, to: [], cc: [], bcc: [], html: '', text: '', threadId: req.threadId } }));
          break;
        case 'updateDraft':
          result = strip(await sim.updateDraft(req.draftId, { raw: req.raw, rendered: { mode: 'reply', subject: '', from: { email: 'x' }, to: [], cc: [], bcc: [], html: '', text: '', threadId: req.threadId } }));
          break;
        case 'deleteDraft':
          await sim.deleteDraft(req.draftId);
          result = { deleted: req.draftId };
          break;
        case 'sendDraft':
          result = await sim.sendDraft(req.draftId);
          break;
        default:
          throw new Error('Unknown action: ' + req.action);
      }
      return reply({ ok: true, result });
    } catch (e) {
      return reply({ ok: false, error: (e as Error).message });
    }
  };
}

// The real web app has no render metadata; only the wire fields travel.
function strip(d: Awaited<ReturnType<SimulatedGmail['getDraft']>>) {
  return { id: d.id, threadId: d.threadId, message: d.message, updatedAt: d.updatedAt };
}

describe('AppsScriptProvider over the wire protocol', () => {
  const setup = async () => {
    const sim = new SimulatedGmail();
    const ids = seedDemoMailbox(sim);
    await sim.saveSignature({ ...SIMPLE_SIG, isDefault: true });
    const provider = new AppsScriptProvider({ url: 'https://script.google.com/macros/s/x/exec', token: 'secret', fetchImpl: fakeWebApp(sim, 'secret') });
    return { sim, ids, provider, drafting: new DraftingService(provider, { allowSend: true }) };
  };

  it('revives dates and drafts a reply through the endpoint', async () => {
    const { ids, provider, drafting } = await setup();
    const t = await provider.getThread(ids.vendorThreadId);
    expect(t.messages[0].date).toBeInstanceOf(Date);
    const profile = await provider.getProfile();
    expect(profile.timeZone).toBe('America/Cancun');

    const d = await drafting.draftReply({ threadId: ids.vendorThreadId, body: 'Hey Priya,\n\nGo ahead.\n\nThank you!' });
    expect(d.threadId).toBe(ids.vendorThreadId);
    expect(d.rendered?.subject).toBe('Re: How are things going?');
    // Calendar timezone drives the attribution line (Cancun = UTC-5: 12:00Z -> 7:00 AM)
    expect(d.rendered?.text).toContain('at 7:00 AM Priya Nair');
    expect(d.raw).toContain('Subject: Re: How are things going?');
    expect((await provider.listDrafts(ids.vendorThreadId)).map((x) => x.id)).toEqual([d.id]);

    const u = await drafting.updateDraft(d.id, { body: 'Hey Priya,\n\nSecond pass.\n\nThank you!' });
    expect(u.rendered?.text.startsWith('Hey Priya,\n\nSecond pass.')).toBe(true);

    const sent = await drafting.send(d.id);
    expect(sent.labelIds).toEqual(['SENT']);
  });

  it('surfaces endpoint errors', async () => {
    const sim = new SimulatedGmail();
    seedDemoMailbox(sim);
    const bad = new AppsScriptProvider({ url: 'https://x', token: 'wrong', fetchImpl: fakeWebApp(sim, 'secret') });
    await expect(bad.getProfile()).rejects.toThrow('Unauthorized');
    const good = new AppsScriptProvider({ url: 'https://x', token: 'secret', fetchImpl: fakeWebApp(sim, 'secret') });
    await expect(good.getThread('nope')).rejects.toThrow('Thread not found');
    const html = new AppsScriptProvider({ url: 'https://x', token: 'secret', fetchImpl: async () => ({ status: 200, text: async () => '<html>Sign in</html>' }) });
    await expect(html.getProfile()).rejects.toThrow(/non-JSON/);
  });

  it('requires url and token', () => {
    expect(() => new AppsScriptProvider({ url: '', token: 'x' })).toThrow(/URL/);
    expect(() => new AppsScriptProvider({ url: 'https://x', token: '' })).toThrow(/TOKEN/);
  });
});
