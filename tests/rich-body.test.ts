import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AppsScriptProvider } from '../src/appsscript/client.js';
import { GmailProvider } from '../src/gmail/client.js';
import { composeNew, composeReply } from '../src/core/compose.js';
import { richBodyToHtml, richBodyToText } from '../src/core/rich-body.js';
import type { RichBodyBlock } from '../src/core/types.js';
import { DraftingService } from '../src/drafting.js';
import { buildServer } from '../src/mcp/server.js';
import type { AppConfig } from '../src/config.js';
import { SignatureStore } from '../src/signatures/store.js';
import { seedDemoMailbox } from '../src/simulator/seed.js';
import { SimulatedGmail } from '../src/simulator/simulator.js';
import { ME, vendorMessage } from './helpers.js';

const blocks: RichBodyBlock[] = [
  { type: 'paragraph', runs: [{ text: 'Octopuses are ', size: 'large' }, { text: 'remarkable', bold: true, size: 'large' }] },
  { type: 'paragraph', runs: [{ text: 'Three things to notice:' }] },
  { type: 'bulletedList', items: [
    [{ text: 'They solve ', italic: true }, { text: 'puzzles', bold: true }],
    [{ text: 'They change color' }],
  ] },
  { type: 'paragraph', runs: [{ text: 'Read more', underline: true, link: 'https://example.com/a?x=1&y=2' }] },
];

describe('structured Gmail formatting', () => {
  it('renders standard list and inline tags with a readable text/plain part', () => {
    const rendered = composeNew({ to: [{ email: 'test@example.com' }], subject: 'Octopuses', bodyBlocks: blocks }, { from: ME });
    expect(rendered.html).toContain('<font size="4">Octopuses are </font><font size="4"><b>remarkable</b></font>');
    expect(rendered.html).toContain('<ul><li><i>They solve </i><b>puzzles</b></li><li>They change color</li></ul>');
    expect(rendered.html).toContain('<a href="https://example.com/a?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">Read more</a>');
    expect(rendered.text).toContain('Three things to notice:\n\n• They solve puzzles\n• They change color');
    expect(rendered.text).toContain('Read more <https://example.com/a?x=1&y=2>');
    expect(rendered.text).not.toContain('<ul>');
  });

  it('keeps the signature, quote, threading and formatting in a reply', () => {
    const rendered = composeReply(vendorMessage(), { bodyBlocks: blocks }, { from: ME, timeZone: 'America/New_York' });
    expect(rendered.html).toContain('<ul><li>');
    expect(rendered.html).toContain('class="gmail_quote gmail_quote_container"');
    expect(rendered.inReplyTo).toBeTruthy();
    expect(rendered.text).toContain('• They solve puzzles');
  });

  it('preserves formatted blocks on a subject-only update and can replace them with plain text', async () => {
    const sim = new SimulatedGmail();
    seedDemoMailbox(sim);
    const drafting = new DraftingService(sim);
    const draft = await drafting.draftNew({ to: [{ email: 'test@example.com' }], subject: 'First', bodyBlocks: blocks });
    expect(draft.raw).toContain('=E2=80=A2');
    const revised = await drafting.updateDraft(draft.id, { subject: 'Second' });
    expect(revised.rendered?.html).toContain('<ul><li>');
    expect(revised.rendered?.bodyBlocks).toEqual(blocks);
    const plain = await drafting.updateDraft(draft.id, { body: 'Just text.' });
    expect(plain.rendered?.html).not.toContain('<ul>');
    expect(plain.rendered?.bodyBlocks).toBeUndefined();
    const formattedAgain = await drafting.updateDraft(draft.id, { bodyBlocks: blocks });
    expect(formattedAgain.rendered?.html).toContain('<ul><li>');
  });

  it('escapes user text and rejects unsafe links or ambiguous bodies', () => {
    expect(richBodyToHtml([{ type: 'paragraph', runs: [{ text: '<img src=x onerror=alert(1)>' }] }])).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(() => richBodyToHtml([{ type: 'paragraph', runs: [{ text: 'click', link: 'javascript:alert(1)' }] }])).toThrow(/links must use/);
    expect(() => richBodyToHtml([{ type: 'paragraph', runs: [{ text: 'click', link: 'mailto:reader@example.com?bcc=hidden%40example.com' }] }])).toThrow(/bare mailto/);
    expect(() => richBodyToHtml([{ type: 'paragraph', runs: [{ text: 'click', link: 'https://trusted.example@evil.example/' }] }])).toThrow(/safe https/);
    expect(() => richBodyToHtml([{ type: 'table', items: [] } ] as never)).toThrow(/Unknown formatted block type/);
    expect(() => richBodyToHtml([{ type: 'paragraph', runs: [{ text: 'x', onclick: 'alert(1)' }] }] as never)).toThrow(/Unknown formatted text property/);
    expect(() => richBodyToHtml([{ type: 'paragraph', runs: [{ text: 'x'.repeat(10_001) }] }])).toThrow(/formatted text run/);
    expect(() => richBodyToHtml([{ type: 'paragraph', runs: [{ text: 'safe\u202eevil' }] }])).toThrow(/formatted text run/);
    expect(() => composeNew({ to: [], subject: 'x', body: 'plain', bodyBlocks: blocks }, { from: ME })).toThrow(/body or bodyBlocks/);
    expect(richBodyToText(blocks)).not.toContain('<ul>');
  });

  it('advertises formatting to an MCP client and accepts it on draft creation and update', async () => {
    const sim = new SimulatedGmail();
    seedDemoMailbox(sim);
    const root = path.resolve('.');
    const server = await buildServer({
      cfg: { allowSend: false, styleConfigPath: path.join(root, 'config/style.json'), previewDir: path.join(root, 'preview') } as AppConfig,
      provider: sim,
      drafting: new DraftingService(sim),
      signatureStore: new SignatureStore(path.join(root, 'config/signatures.example.json')),
    });
    const client = new Client({ name: 'rich-body-test', version: '1.0.0' });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tools = await client.listTools();
      const draftNew = tools.tools.find((tool) => tool.name === 'draft_new');
      expect(JSON.stringify(draftNew?.inputSchema)).toContain('bodyBlocks');
      expect(JSON.stringify(tools.tools.find((tool) => tool.name === 'lint_body')?.inputSchema)).toContain('bodyBlocks');
      const lint = await client.callTool({ name: 'lint_body', arguments: { bodyBlocks: blocks } });
      expect(lint.isError).not.toBe(true);
      const result = await client.callTool({ name: 'draft_new', arguments: { to: 'test@example.com', subject: 'Octopuses', body: 'They solve puzzles.' } });
      expect(result.isError).not.toBe(true);
      const created = JSON.parse((result.content[0] as { text: string }).text) as { draftId: string };
      expect((await sim.getDraft(created.draftId)).rendered?.html).not.toContain('<ul><li>');
      const reformatted = await client.callTool({ name: 'update_draft', arguments: { draftId: created.draftId, bodyBlocks: blocks } });
      expect(reformatted.isError).not.toBe(true);
      expect((await sim.getDraft(created.draftId)).rendered?.html).toContain('<ul><li>');
      const updated = await client.callTool({ name: 'update_draft', arguments: { draftId: created.draftId, subject: 'New subject' } });
      expect(updated.isError).not.toBe(true);
      expect((await sim.getDraft(created.draftId)).rendered?.html).toContain('<ul><li>');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('refuses to reformat a remote draft whose recipient changed outside gmail-send', async () => {
    const rendered = composeNew({ to: [{ email: 'first@example.com' }], subject: 'Facts', bodyBlocks: blocks }, { from: ME });
    let liveTo = [{ email: 'first@example.com' }];
    let updates = 0;
    const fetchImpl = async (_url: string, init: { body: string }) => {
      const request = JSON.parse(init.body) as { action: string };
      if (request.action === 'updateDraft') updates++;
      const message = { ...vendorMessage(), id: 'message-1', threadId: 'thread-1', from: rendered.from, to: liveTo, cc: [], bcc: [], subject: 'Facts', html: rendered.html, text: rendered.text };
      return { status: 200, text: async () => JSON.stringify({ ok: true, result: { id: 'draft-1', threadId: 'thread-1', message, updatedAt: new Date().toISOString() } }) };
    };
    const provider = new AppsScriptProvider({ url: 'https://script.google.com/macros/s/test/exec', token: 'test', fetchImpl: fetchImpl as never });
    expect((await provider.createDraft({ rendered, raw: 'raw' })).rendered?.bodyBlocks).toEqual(blocks);
    liveTo = [{ email: 'corrected@example.com' }];
    expect((await provider.getDraft('draft-1')).rendered).toBeUndefined();
    await expect(new DraftingService(provider).updateDraft('draft-1', { bodyBlocks: blocks })).rejects.toThrow(/changed outside gmail-send/);
    expect(updates).toBe(0);
  });

  it('refuses a stale cached render in direct Gmail API mode', async () => {
    const rendered = composeNew({ to: [{ email: 'first@example.com' }], subject: 'Facts', bodyBlocks: blocks }, { from: ME });
    let liveTo = 'first@example.com';
    let liveFrom = 'sam@example.com';
    const provider = new GmailProvider({} as never);
    (provider as any).meta.set('draft-1', rendered, 'raw');
    (provider as any).gmail = { users: { drafts: { get: async () => ({ data: {
      id: 'draft-1',
      message: { id: 'message-1', threadId: 'thread-1', internalDate: '1789732800000', payload: { headers: [
        { name: 'From', value: `Sam Rivera <${liveFrom}>` },
        { name: 'To', value: liveTo },
        { name: 'Subject', value: 'Facts' },
      ] } },
    } }) } } };
    expect((await provider.getDraft('draft-1')).rendered?.bodyBlocks).toEqual(blocks);
    liveFrom = 'other@example.com';
    expect((await provider.getDraft('draft-1')).rendered).toBeUndefined();
    (provider as any).meta.set('draft-1', rendered, 'raw');
    liveFrom = 'sam@example.com';
    liveTo = 'corrected@example.com';
    expect((await provider.getDraft('draft-1')).rendered).toBeUndefined();
    await expect(new DraftingService(provider).updateDraft('draft-1', { bodyBlocks: blocks })).rejects.toThrow(/changed outside gmail-send/);
  });
});
