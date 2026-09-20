import { describe, expect, it } from 'vitest';
import { DraftingService } from '../src/drafting.js';
import { seedDemoMailbox } from '../src/simulator/seed.js';
import { SimulatedGmail } from '../src/simulator/simulator.js';

const GMAIL_SIG = { id: 'sam@example.com', name: 'Sam Rivera <sam@example.com>', html: 'FROM GMAIL SETTINGS', isDefault: true, source: 'gmail' as const };
const LOCAL_SIG = { id: 'local-card', name: 'Local card', html: 'FROM LOCAL LIBRARY', isDefault: true, source: 'local' as const };

describe('signature precedence', () => {
  it('uses the signature Gmail shows, not the local library, by default', async () => {
    const sim = new SimulatedGmail();
    const ids = seedDemoMailbox(sim);
    await sim.saveSignature(GMAIL_SIG);
    const svc = new DraftingService(sim, { extraSignatures: [LOCAL_SIG] });
    const d = await svc.draftReply({ threadId: ids.vendorThreadId, body: 'Hey,\n\nOk.\n\nThank you!' });
    expect(d.rendered?.html).toContain('class="gmail_signature">FROM GMAIL SETTINGS</div>');
    expect(d.rendered?.html).not.toContain('FROM LOCAL LIBRARY');
  });

  it('falls back to the local library only when Gmail has no signature', async () => {
    const sim = new SimulatedGmail();
    const ids = seedDemoMailbox(sim);
    await sim.saveSignature({ ...GMAIL_SIG, html: '' });
    const svc = new DraftingService(sim, { extraSignatures: [LOCAL_SIG] });
    const d = await svc.draftReply({ threadId: ids.vendorThreadId, body: 'Hey,\n\nOk.\n\nThank you!' });
    expect(d.rendered?.html).toContain('FROM LOCAL LIBRARY');
  });

  it('can still pick a local signature explicitly by id', async () => {
    const sim = new SimulatedGmail();
    const ids = seedDemoMailbox(sim);
    await sim.saveSignature(GMAIL_SIG);
    const svc = new DraftingService(sim, { extraSignatures: [LOCAL_SIG] });
    const d = await svc.draftReply({ threadId: ids.vendorThreadId, body: 'Hey,\n\nOk.\n\nThank you!', signatureId: 'local-card' });
    expect(d.rendered?.html).toContain('FROM LOCAL LIBRARY');
    expect((await svc.listSignatures()).map((s) => s.id)).toEqual(['sam@example.com', 'local-card']);
  });
});

describe('timezone resolution', () => {
  it('prefers config, then the provider profile (Google Calendar), then America/New_York', async () => {
    const sim = new SimulatedGmail();
    seedDemoMailbox(sim); // profile timeZone America/Cancun
    expect((await new DraftingService(sim).identity())).toMatchObject({ timeZone: 'America/Cancun', timeZoneSource: 'provider' });
    expect((await new DraftingService(sim, { timeZone: 'Europe/Berlin' }).identity())).toMatchObject({ timeZone: 'Europe/Berlin', timeZoneSource: 'config' });
    sim.setProfile('me@example.com', 'Me', [], undefined);
    const bare = new SimulatedGmail();
    expect((await new DraftingService(bare).identity()).timeZone).toBe('America/New_York');
  });

  it('the resolved timezone drives the attribution line and the Date header', async () => {
    const sim = new SimulatedGmail();
    const ids = seedDemoMailbox(sim);
    const d = await new DraftingService(sim, { now: () => new Date('2026-09-18T18:05:01Z') }).draftReply({ threadId: ids.vendorThreadId, body: 'Hey,\n\nOk.\n\nThank you!' });
    expect(d.rendered?.text).toContain('On Fri, Sep 18, 2026 at 7:00 AM Priya Nair');
    expect(d.raw).toContain('Date: Fri, 18 Sep 2026 13:05:01 -0500');
  });
});
