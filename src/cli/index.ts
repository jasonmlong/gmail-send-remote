#!/usr/bin/env node
/**
 * gmail-send CLI. Same capabilities as the MCP server, for humans and scripts.
 *
 *   npm run cli -- <command> [args] [--flag value]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseAddressList } from '../core/address.js';
import { htmlToText } from '../core/html.js';
import type { Draft, EmailAddress } from '../core/types.js';
import { createRuntime, type Runtime } from '../runtime.js';
import { detectSignature } from '../signatures/detect.js';
import { generateSignature } from '../signatures/template.js';
import { renderConversationPreview } from '../simulator/preview.js';
import { seedDemoMailbox } from '../simulator/seed.js';
import { SimulatedGmail } from '../simulator/simulator.js';
import { loadStyleGuide } from '../style/guide.js';
import { lintDraft, loadRules } from '../style/lint.js';

interface Args {
  cmd: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const cmd: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else cmd.push(a);
  }
  return { cmd, flags };
}

const str = (v: string | boolean | undefined): string | undefined => (typeof v === 'string' ? v : undefined);
const addrs = (v: string | boolean | undefined): EmailAddress[] | undefined => (typeof v === 'string' ? parseAddressList(v) : undefined);

async function readBody(flags: Args['flags']): Promise<string> {
  // --body also accepts \n for a line break. Some shells, and the npx shim on
  // Windows in particular, cut a multiline argument at its first newline, which
  // silently reduced an email to its greeting. --body-file and stdin are exact.
  if (typeof flags.body === 'string') return flags.body.replace(/\\r\\n|\\n/g, '\n').replace(/\\t/g, '\t');
  if (typeof flags['body-file'] === 'string') return fs.readFileSync(flags['body-file'], 'utf8');
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new Error('Provide --body "text" (use \\n for line breaks), --body-file path, or pipe the body on stdin.');
}

function printDraft(d: Draft, flags: Args['flags']): void {
  const r = d.rendered;
  console.log(`Draft ${d.id}${d.threadId ? ` (thread ${d.threadId})` : ''}`);
  console.log(`Subject: ${r?.subject ?? d.message.subject}`);
  console.log(`From: ${fmt([r?.from ?? d.message.from])}`);
  console.log(`To: ${fmt(r?.to ?? d.message.to)}`);
  if ((r?.cc ?? d.message.cc).length) console.log(`Cc: ${fmt(r?.cc ?? d.message.cc)}`);
  if ((r?.bcc ?? d.message.bcc).length) console.log(`Bcc: ${fmt(r?.bcc ?? d.message.bcc)}`);
  if (r?.inReplyTo) console.log(`In-Reply-To: ${r.inReplyTo}`);
  console.log('');
  if (flags.html) console.log(r?.html ?? d.message.html ?? '');
  else if (flags.raw) console.log(d.raw ?? '(raw not available for this draft)');
  else console.log(r?.text ?? d.message.text ?? '');
}

function fmt(list: EmailAddress[]): string {
  return list.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(', ');
}

async function writePreview(rt: Runtime, threadId: string | undefined, drafts: Draft[], name: string, out?: string): Promise<string> {
  const thread = threadId ? await rt.provider.getThread(threadId) : null;
  const me = (await rt.provider.getProfile()).email;
  const html = renderConversationPreview(thread, drafts, { timeZone: rt.cfg.timeZone, me });
  const file = out ?? path.join(rt.cfg.previewDir, `${name}.html`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html, 'utf8');
  return file;
}

function openFile(file: string): void {
  const abs = path.resolve(file);
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', abs], { detached: true, stdio: 'ignore' }).unref();
  else if (process.platform === 'darwin') spawn('open', [abs], { detached: true, stdio: 'ignore' }).unref();
  else spawn('xdg-open', [abs], { detached: true, stdio: 'ignore' }).unref();
}

const HELP = `gmail-send - Gmail-identical drafting for AI agents

  auth login | auth status
  profile
  threads [--query "in:inbox"] [--max 10]
  thread <threadId> [--html]
  signatures list | show <id> | detect [--max 15] | push <id>
  signatures create --name "Sam Rivera" [--title CEO] [--company "Northwind Labs"] [--phone ..] [--email ..] [--website ..] [--style plain|card] [--default]
  signatures import <file.html> --id <id> [--name ..] [--default]
  draft new --to a@b.com[,c@d.com] --subject ".." (--body ".." | --body-file f | stdin) [--cc] [--bcc] [--signature id|none]
       bodies: --body takes \\n for line breaks; --body-file and stdin are passed through exactly
  draft reply (--thread id | --message id) (--body ..) [--all] [--add-cc ..] [--signature ..]
  draft forward --message id --to .. [--body ..] [--signature ..]
  drafts list [--thread id] | drafts show <id> [--html|--raw] | drafts delete <id> | drafts send <id>
  preview (--draft id | --thread id) [--out file] [--open]
  lint (--body .. | --body-file f | stdin)
  style
  sim seed | sim reset | sim demo [--open] | sim receive --from ".." --subject ".." --body ".." [--thread id]

Environment: see .env.example (GMAIL_SEND_PROVIDER=sim|gmail, GMAIL_SEND_ALLOW_SEND, GMAIL_SEND_TIMEZONE, ...)`;

export async function run(argv: string[]): Promise<void> {
  const { cmd, flags } = parseArgs(argv);
  const [c0, c1, c2] = cmd;
  if (!c0 || c0 === 'help' || flags.help) {
    console.log(HELP);
    return;
  }

  if (c0 === 'auth') {
    const { loadConfig } = await import('../config.js');
    const cfg = loadConfig();
    const auth = await import('../gmail/auth.js');
    if (c1 === 'login') {
      await auth.loginInteractive(cfg);
      return;
    }
    console.log(auth.hasToken(cfg) ? `Signed in (token at ${cfg.tokenPath})` : 'Not signed in. Run: auth login');
    return;
  }

  const rt = await createRuntime();
  const { provider, drafting, cfg } = rt;

  switch (c0) {
    case 'profile': {
      const p = await provider.getProfile();
      const id = await drafting.identity();
      // The resolved timezone, not the configured one: an empty setting means
      // "use the account's calendar", so printing the raw config hid the answer.
      console.log(JSON.stringify({ provider: provider.kind, ...p, draftingAs: id.from, allowSend: cfg.allowSend, timeZone: id.timeZone, timeZoneSource: id.timeZoneSource, signaturePlacement: cfg.signaturePlacement }, null, 2));
      return;
    }
    case 'threads': {
      const list = await provider.listThreads({ query: str(flags.query), max: flags.max ? Number(flags.max) : undefined });
      for (const t of list) console.log(`${t.id}  ${t.lastDate.toISOString().slice(0, 16)}  [${t.messageCount}]  ${t.subject}  -  ${t.participants.map((p) => p.name ?? p.email).join(', ')}`);
      if (!list.length) console.log('(no threads)');
      return;
    }
    case 'thread': {
      if (!c1) throw new Error('thread <threadId>');
      const t = await provider.getThread(c1);
      for (const m of t.messages) {
        console.log(`=== ${m.id}  ${m.date.toISOString()}  ${fmt([m.from])} -> ${fmt(m.to)}${m.cc.length ? ` cc ${fmt(m.cc)}` : ''}`);
        console.log(`Subject: ${m.subject}`);
        console.log(flags.html ? m.html ?? '' : (m.text ?? htmlToText(m.html ?? '')));
        console.log('');
      }
      return;
    }
    case 'signatures': {
      if (c1 === 'list' || !c1) {
        for (const s of await drafting.listSignatures()) console.log(`${s.isDefault ? '*' : ' '} ${s.id}  [${s.source ?? 'local'}]  ${s.name}  ${s.html.trim() ? '' : '(empty)'}`);
        return;
      }
      if (c1 === 'show') {
        const s = await drafting.resolveSignature(c2);
        if (!s) throw new Error('No signature');
        console.log(flags.html ? s.html : htmlToText(s.html));
        return;
      }
      if (c1 === 'create') {
        const name = str(flags.name);
        if (!name) throw new Error('--name is required');
        const profile = await provider.getProfile();
        const sig = { ...generateSignature({ name, title: str(flags.title), company: str(flags.company), phone: str(flags.phone), mobile: str(flags.mobile), email: str(flags.email) ?? profile.email, website: str(flags.website), disclaimer: str(flags.disclaimer) }, flags.style === 'card' ? 'card' : 'plain'), id: str(flags.id) ?? profile.email, sendAsEmail: str(flags.email) ?? profile.email, isDefault: !!flags.default };
        rt.signatureStore.upsert(sig);
        if (flags.push || provider.kind === 'sim') await provider.saveSignature(sig);
        console.log(`Saved signature ${sig.id}${flags.push ? ' (pushed to provider)' : ''}\n\n${htmlToText(sig.html)}`);
        return;
      }
      if (c1 === 'import') {
        if (!c2) throw new Error('signatures import <file.html> --id <id>');
        const profile = await provider.getProfile();
        const id = str(flags.id) ?? profile.email;
        const sig = { id, name: str(flags.name) ?? id, html: fs.readFileSync(c2, 'utf8').trim(), sendAsEmail: id, isDefault: !!flags.default, source: 'local' as const };
        rt.signatureStore.upsert(sig);
        if (provider.kind === 'sim') await provider.saveSignature(sig);
        console.log(`Imported ${id}`);
        return;
      }
      if (c1 === 'push') {
        const s = await drafting.resolveSignature(c2);
        if (!s) throw new Error('No signature to push');
        const saved = await provider.saveSignature(s);
        console.log(`Pushed ${saved.id} to ${provider.kind}`);
        return;
      }
      if (c1 === 'detect') {
        const profile = await provider.getProfile();
        const threads = await provider.listThreads({ query: 'in:sent', max: flags.max ? Number(flags.max) : 15 });
        const sent = [];
        for (const t of threads) sent.push(...(await provider.getThread(t.id)).messages.filter((m) => m.from.email.toLowerCase() === profile.email.toLowerCase()));
        const found = detectSignature(sent, profile.email);
        if (!found) {
          console.log(`No gmail_signature block found in ${sent.length} sent messages.`);
          return;
        }
        rt.signatureStore.upsert({ id: found.id, name: found.name, html: found.html, sendAsEmail: found.sendAsEmail, source: 'detected' });
        console.log(`Detected (seen ${found.occurrences}/${found.sampleCount}) and saved as ${found.id}:\n\n${htmlToText(found.html)}`);
        return;
      }
      throw new Error(`Unknown signatures command: ${c1}`);
    }
    case 'draft': {
      const signatureId = str(flags.signature);
      let d: Draft;
      if (c1 === 'new') {
        d = await drafting.draftNew({ to: addrs(flags.to) ?? [], cc: addrs(flags.cc), bcc: addrs(flags.bcc), subject: str(flags.subject) ?? '', body: await readBody(flags), signatureId });
      } else if (c1 === 'reply') {
        d = await drafting.draftReply({ threadId: str(flags.thread), messageId: str(flags.message), body: await readBody(flags), replyAll: !!flags.all, to: addrs(flags.to), cc: addrs(flags.cc), addCc: addrs(flags['add-cc']), bcc: addrs(flags.bcc), signatureId });
      } else if (c1 === 'forward') {
        const messageId = str(flags.message);
        if (!messageId) throw new Error('--message is required');
        d = await drafting.draftForward({ messageId, to: addrs(flags.to) ?? [], cc: addrs(flags.cc), bcc: addrs(flags.bcc), body: typeof flags.body === 'string' ? flags.body : typeof flags['body-file'] === 'string' ? fs.readFileSync(flags['body-file'], 'utf8') : undefined, signatureId });
      } else throw new Error('draft new|reply|forward');
      printDraft(d, flags);
      if (c1 !== 'forward') {
        const lint = lintDraft(typeof flags.body === 'string' ? flags.body : d.rendered?.text ?? '', loadRules(cfg.styleConfigPath));
        if (lint.findings.length) console.log(`\nStyle: ${lint.errors} error(s), ${lint.warnings} warning(s)\n` + lint.findings.map((f) => `  [${f.severity}] ${f.rule}${f.line ? ` (line ${f.line})` : ''}: ${f.message}`).join('\n'));
      }
      return;
    }
    case 'drafts': {
      if (c1 === 'list' || !c1) {
        for (const d of await provider.listDrafts(str(flags.thread))) console.log(`${d.id}  ${d.updatedAt.toISOString().slice(0, 16)}  ${d.rendered?.mode ?? '?'}  ${d.rendered?.subject ?? d.message.subject}  -> ${fmt(d.rendered?.to ?? d.message.to)}`);
        return;
      }
      if (!c2) throw new Error(`drafts ${c1} <draftId>`);
      if (c1 === 'show') printDraft(await provider.getDraft(c2), flags);
      else if (c1 === 'delete') {
        // Gmail deletion bypasses Trash and cannot be undone, so a draft this
        // tool did not write is refused unless --force is passed deliberately.
        const existing = await provider.getDraft(c2);
        if (!existing.rendered && !flags.force) {
          throw new Error(`Draft ${c2} was not created by gmail-send and deletion cannot be undone. Re-run with --force if you are sure.`);
        }
        await provider.deleteDraft(c2);
        console.log(`Deleted ${c2}`);
      } else if (c1 === 'send') {
        const m = await drafting.send(c2);
        console.log(`Sent as message ${m.id} in thread ${m.threadId}`);
      } else throw new Error('drafts list|show|delete|send');
      return;
    }
    case 'preview': {
      let file: string;
      if (typeof flags.draft === 'string') {
        const d = await provider.getDraft(flags.draft);
        file = await writePreview(rt, d.threadId, [d], `draft-${d.id}`, str(flags.out));
      } else if (typeof flags.thread === 'string') {
        file = await writePreview(rt, flags.thread, await provider.listDrafts(flags.thread), `thread-${flags.thread}`, str(flags.out));
      } else throw new Error('preview --draft id | --thread id');
      console.log(file);
      if (flags.open) openFile(file);
      return;
    }
    case 'lint': {
      const r = lintDraft(await readBody(flags), loadRules(cfg.styleConfigPath));
      console.log(JSON.stringify(r, null, 2));
      if (!r.ok) process.exitCode = 1;
      return;
    }
    case 'style': {
      const g = loadStyleGuide(cfg.styleGuidePath);
      console.log(`# source: ${g.source}${g.path ? ` (${g.path})` : ''}\n\n${g.text}`);
      return;
    }
    case 'sim': {
      if (!(provider instanceof SimulatedGmail)) throw new Error('sim commands need GMAIL_SEND_PROVIDER=sim');
      const sim = provider;
      if (c1 === 'reset') {
        sim.reset();
        console.log('Simulator reset.');
        return;
      }
      if (c1 === 'seed' || c1 === 'demo') {
        sim.reset();
        const ids = seedDemoMailbox(sim, { email: str(flags.email) ?? 'sam@example.com', name: str(flags.name) ?? 'Sam Rivera' });
        for (const s of rt.signatureStore.load()) await sim.saveSignature({ ...s, isDefault: true });
        console.log(`Seeded. vendor thread ${ids.vendorThreadId}, group thread ${ids.groupThreadId}, attachment message ${ids.attachmentMessageId}`);
        if (c1 === 'demo') {
          const d = await drafting.draftReply({ threadId: ids.vendorThreadId, body: "Hey Priya,\n\nThank you for the update.\n\n1. Let's go ahead and open things up so you are less limited. We need to progress on this faster, even if it isn't perfect.\n2. It is fine to pitch to higher authority sites as well.\n\nThank you!" });
          printDraft(d, flags);
          const file = await writePreview(rt, d.threadId, [d], `demo-${d.id}`, str(flags.out));
          console.log(`\nPreview: ${file}`);
          if (flags.open) openFile(file);
        }
        return;
      }
      if (c1 === 'receive') {
        const m = sim.receive({ from: str(flags.from) ?? 'someone@example.com', subject: str(flags.subject) ?? '(no subject)', text: await readBody(flags), threadId: str(flags.thread), to: addrs(flags.to), cc: addrs(flags.cc) });
        console.log(`Received message ${m.id} in thread ${m.threadId}`);
        return;
      }
      throw new Error('sim seed|reset|demo|receive');
    }
    default:
      throw new Error(`Unknown command: ${c0}\n\n${HELP}`);
  }
}

if (process.argv[1] && /cli[\\/]index\.(ts|js)$/.test(process.argv[1])) {
  run(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
