/**
 * Start-up cost of the MCP server.
 *
 * buildServer used to ask the backend for the credential's capabilities on
 * every start. Against the Apps Script endpoint that is a real HTTPS round trip
 * through a 302 redirect: measured at ~1.7s on an idle host (199ms to list
 * tools without it, 1868ms with). An MCP host that allows 1500ms to list tools
 * therefore killed the server before it advertised anything, so the agent saw
 * no gmail-send tools at all.
 *
 * The probe only ever refined `canSend`, which is the AND of the local switch
 * and the token's capability. With GMAIL_SEND_ALLOW_SEND=0 the answer is false
 * whatever the backend replies, so a draft-only deployment paid ~1.7s for a
 * question whose answer it already had - and lost every tool to the timeout.
 *
 * These tests pin both halves: the probe is skipped when it cannot change the
 * outcome, and still made when it can.
 */
import { describe, expect, it } from 'vitest';
import { DraftingService } from '../src/drafting.js';
import { buildServer } from '../src/mcp/server.js';
import type { Runtime } from '../src/runtime.js';
import { SignatureStore } from '../src/signatures/store.js';
import { SimulatedGmail } from '../src/simulator/simulator.js';
import { TZ } from './helpers.js';

function runtimeWith(allowSend: boolean) {
  const sim = new SimulatedGmail();
  let profileCalls = 0;
  const realGetProfile = sim.getProfile.bind(sim);
  sim.getProfile = async () => {
    profileCalls += 1;
    return realGetProfile();
  };

  const cfg = {
    allowSend,
    timeZone: TZ,
    signaturePlacement: 'after-quote',
    previewDir: '.gmail-sim/preview-test',
    styleGuidePath: undefined,
    styleConfigPath: undefined,
  } as unknown as Runtime['cfg'];

  const rt = {
    cfg,
    provider: sim,
    drafting: new DraftingService(sim, { timeZone: TZ, allowSend }),
    signatureStore: new SignatureStore('.gmail-sim/signatures-test.json'),
  } as unknown as Runtime;

  return { rt, calls: () => profileCalls };
}

describe('MCP server start-up', () => {
  it('does not call the backend when sending is disabled locally', async () => {
    const { rt, calls } = runtimeWith(false);

    await buildServer(rt);

    // The whole point: no network round trip on the path that has to answer
    // tools/list inside the host's budget.
    expect(calls()).toBe(0);
  });

  it('still asks the backend when sending is enabled locally', async () => {
    // Here the answer can change the outcome - a token minted without "send"
    // must not be shown a send tool even though the local switch is on - so the
    // round trip is worth paying for and must not be optimised away.
    const { rt, calls } = runtimeWith(true);

    await buildServer(rt);

    expect(calls()).toBe(1);
  });
});
