/**
 * SimulatedGmail: an offline stand-in for a Gmail mailbox that speaks the same
 * MailProvider interface as the real adapter. Threads, messages, drafts,
 * signatures and sendAs identities live in a JSON file so a whole agent
 * workflow (read thread, draft reply, preview, "send", receive the answer,
 * reply again) can be exercised without touching a real account.
 */
import { parseAddressList, sameEmail } from '../core/address.js';
import { escapeHtml, htmlToText, textToGmailHtml } from '../core/html.js';
import { gmailMessageId } from '../core/mime.js';
import type { Draft, EmailAddress, Message, Signature, Thread, ThreadSummary } from '../core/types.js';
import { wrapText } from '../core/wrap.js';
import type { DraftInput, ListThreadsQuery, MailProvider, Profile } from '../provider.js';
import { emptyState, loadState, saveState, type SimState } from './store.js';

export interface IncomingMessageInput {
  from: EmailAddress | string;
  to?: Array<EmailAddress | string>;
  cc?: Array<EmailAddress | string>;
  subject: string;
  /** Plain text body; HTML is generated in Gmail's shape unless html is provided. */
  text: string;
  html?: string;
  date?: Date;
  threadId?: string;
  /** When replying into an existing thread, threading headers are derived from this message. */
  inReplyToMessageId?: string;
  labelIds?: string[];
}

export class SimulatedGmail implements MailProvider {
  readonly kind = 'sim' as const;
  private state: SimState;

  constructor(
    private readonly filePath?: string,
    initial?: SimState,
  ) {
    this.state = initial ?? (filePath ? loadState(filePath) : null) ?? emptyState();
  }

  // ---- persistence -------------------------------------------------------

  private persist(): void {
    if (this.filePath) saveState(this.filePath, this.state);
  }

  snapshot(): SimState {
    return JSON.parse(JSON.stringify(this.state)) as SimState;
  }

  reset(profile?: { email: string; name?: string }): void {
    this.state = emptyState(profile?.email, profile?.name);
    this.persist();
  }

  setProfile(email: string, name?: string, aliases: Array<{ email: string; name?: string }> = [], timeZone?: string): void {
    this.state.profile = { email, name, timeZone: timeZone ?? this.state.profile.timeZone ?? 'America/New_York' };
    this.state.sendAs = [{ email, name, isDefault: true }, ...aliases.map((a) => ({ ...a, isDefault: false }))];
    this.persist();
  }

  private nextId(): string {
    // Gmail ids are 16 hex chars that increase over time.
    this.state.counter++;
    const base = BigInt(Date.now()) * 0x10000n + BigInt(this.state.counter);
    return base.toString(16).padStart(16, '0');
  }

  // ---- seeding -----------------------------------------------------------

  /** Deliver a message into the mailbox (as if it arrived from the network or was sent by me). */
  receive(input: IncomingMessageInput): Message {
    const norm = (a: EmailAddress | string): EmailAddress => (typeof a === 'string' ? parseAddressList(a)[0] : a);
    const from = norm(input.from);
    const to = (input.to ?? [{ email: this.state.profile.email, name: this.state.profile.name }]).map(norm);
    const cc = (input.cc ?? []).map(norm);
    const id = this.nextId();
    const threadId = input.threadId ?? id;
    const date = input.date ?? new Date();
    const parent = input.inReplyToMessageId ? this.findMessage(input.inReplyToMessageId) : this.lastMessage(threadId);
    const fromMe = this.isMe(from);
    const html = input.html ?? `<div dir="ltr">${textToGmailHtml(input.text, 'new')}</div>\r\n`;
    const msg: Message = {
      id,
      threadId,
      from,
      to,
      cc,
      bcc: [],
      subject: input.subject,
      date,
      messageId: gmailMessageId(),
      inReplyTo: parent?.messageId,
      references: parent ? [...(parent.references ?? []), parent.messageId].filter((s): s is string => !!s) : undefined,
      html,
      text: wrapText(input.text.trim()),
      snippet: snippetOf(input.text),
      labelIds: input.labelIds ?? (fromMe ? ['SENT'] : ['INBOX', 'UNREAD']),
    };
    const thread = (this.state.threads[threadId] ??= { id: threadId, messages: [] });
    thread.messages.push(msg);
    thread.snippet = msg.snippet;
    this.persist();
    return msg;
  }

  private isMe(a: EmailAddress): boolean {
    return this.state.sendAs.some((s) => sameEmail(s.email, a));
  }

  private lastMessage(threadId: string): Message | undefined {
    const t = this.state.threads[threadId];
    return t?.messages[t.messages.length - 1];
  }

  private findMessage(id: string): Message | undefined {
    for (const t of Object.values(this.state.threads)) {
      const m = t.messages.find((x) => x.id === id);
      if (m) return m;
    }
    return undefined;
  }

  // ---- MailProvider ------------------------------------------------------

  async getProfile(): Promise<Profile> {
    return {
      email: this.state.profile.email,
      name: this.state.profile.name,
      sendAs: this.state.sendAs,
      timeZone: this.state.profile.timeZone,
      // The simulator has no credential to scope, so it reports everything and
      // lets the drafting service's own send gate be the limit.
      capabilities: ['read', 'draft', 'send', 'settings'],
      canSend: true,
      canWriteSettings: true,
    };
  }

  async listThreads(q: ListThreadsQuery = {}): Promise<ThreadSummary[]> {
    const filter = compileQuery(q.query ?? '', this.state.profile.email);
    const summaries = Object.values(this.state.threads)
      .filter((t) => t.messages.some(filter))
      .map((t) => summarize(t))
      .sort((a, b) => b.lastDate.getTime() - a.lastDate.getTime());
    return summaries.slice(0, q.max ?? 20);
  }

  async getThread(threadId: string): Promise<Thread> {
    const t = this.state.threads[threadId];
    if (!t) throw new Error(`Thread not found: ${threadId}`);
    return t;
  }

  async getMessage(messageId: string): Promise<Message> {
    const m = this.findMessage(messageId);
    if (!m) throw new Error(`Message not found: ${messageId}`);
    return m;
  }

  async listSignatures(): Promise<Signature[]> {
    return this.state.signatures;
  }

  async saveSignature(sig: Signature): Promise<Signature> {
    if (sig.isDefault) for (const s of this.state.signatures) s.isDefault = false;
    const idx = this.state.signatures.findIndex((s) => s.id === sig.id);
    if (idx >= 0) this.state.signatures[idx] = { ...this.state.signatures[idx], ...sig };
    else this.state.signatures.push(sig);
    if (this.state.signatures.length === 1) this.state.signatures[0].isDefault = true;
    this.persist();
    return sig;
  }

  async listDrafts(threadId?: string): Promise<Draft[]> {
    return Object.values(this.state.drafts)
      .filter((d) => !threadId || d.threadId === threadId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async getDraft(draftId: string): Promise<Draft> {
    const d = this.state.drafts[draftId];
    if (!d) throw new Error(`Draft not found: ${draftId}`);
    return d;
  }

  async createDraft(input: DraftInput): Promise<Draft> {
    const id = 'r' + this.nextId();
    const draft = this.materialize(id, input, new Date());
    this.state.drafts[id] = draft;
    this.persist();
    return draft;
  }

  async updateDraft(draftId: string, input: DraftInput): Promise<Draft> {
    const existing = await this.getDraft(draftId);
    const draft = this.materialize(draftId, input, new Date(), existing.message.id);
    this.state.drafts[draftId] = draft;
    this.persist();
    return draft;
  }

  async deleteDraft(draftId: string): Promise<void> {
    delete this.state.drafts[draftId];
    this.persist();
  }

  async sendDraft(draftId: string): Promise<Message> {
    const draft = await this.getDraft(draftId);
    const r = draft.rendered;
    if (!r) throw new Error('Draft has no rendered content');
    const id = this.nextId();
    const threadId = r.threadId ?? id;
    const msg: Message = {
      ...draft.message,
      id,
      threadId,
      date: new Date(),
      messageId: gmailMessageId(),
      labelIds: ['SENT'],
    };
    const thread = (this.state.threads[threadId] ??= { id: threadId, messages: [] });
    thread.messages.push(msg);
    thread.snippet = msg.snippet;
    delete this.state.drafts[draftId];
    this.persist();
    return msg;
  }

  private materialize(id: string, input: DraftInput, when: Date, messageId?: string): Draft {
    const r = input.rendered;
    const message: Message = {
      id: messageId ?? this.nextId(),
      threadId: r.threadId ?? '',
      from: r.from,
      to: r.to,
      cc: r.cc,
      bcc: r.bcc,
      subject: r.subject,
      date: when,
      inReplyTo: r.inReplyTo,
      references: r.references,
      html: r.html,
      text: r.text,
      snippet: snippetOf(r.text),
      labelIds: ['DRAFT'],
      attachments: r.attachments,
    };
    return { id, threadId: r.threadId, message, rendered: r, raw: input.raw, updatedAt: when };
  }
}

// ---- helpers ---------------------------------------------------------------

function snippetOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return escapeHtml(flat.slice(0, 180));
}

function summarize(t: Thread): ThreadSummary {
  const last = t.messages[t.messages.length - 1];
  const seen = new Map<string, EmailAddress>();
  for (const m of t.messages) for (const a of [m.from, ...m.to, ...m.cc]) seen.set(a.email.toLowerCase(), a);
  return {
    id: t.id,
    subject: t.messages[0]?.subject ?? '',
    snippet: last?.snippet ?? '',
    lastDate: last?.date ?? new Date(0),
    messageCount: t.messages.length,
    participants: [...seen.values()],
    labelIds: Array.from(new Set(t.messages.flatMap((m) => m.labelIds ?? []))),
  };
}

/** Tiny Gmail-query subset for the simulator. */
function compileQuery(query: string, me: string): (m: Message) => boolean {
  const terms = query.match(/(?:\w+:)?(?:"[^"]*"|\S+)/g) ?? [];
  const preds = terms.map((term) => {
    const neg = term.startsWith('-');
    const t = neg ? term.slice(1) : term;
    const [op, ...rest] = t.includes(':') ? t.split(':') : ['', t];
    const val = rest.join(':').replace(/^"|"$/g, '').toLowerCase();
    let p: (m: Message) => boolean;
    switch (op) {
      case 'from':
        p = (m) => (val === 'me' ? sameEmail(m.from, me) : m.from.email.toLowerCase().includes(val) || (m.from.name ?? '').toLowerCase().includes(val));
        break;
      case 'to':
        p = (m) => m.to.some((a) => (val === 'me' ? sameEmail(a, me) : a.email.toLowerCase().includes(val)));
        break;
      case 'subject':
        p = (m) => m.subject.toLowerCase().includes(val);
        break;
      case 'in':
      case 'label':
        p = (m) => (m.labelIds ?? []).map((l) => l.toLowerCase()).includes(val);
        break;
      case 'is':
        p = (m) => (val === 'unread' ? (m.labelIds ?? []).includes('UNREAD') : val === 'read' ? !(m.labelIds ?? []).includes('UNREAD') : true);
        break;
      default:
        p = (m) => `${m.subject} ${m.text ?? htmlToText(m.html ?? '')} ${m.from.email} ${m.from.name ?? ''}`.toLowerCase().includes(val);
    }
    return neg ? (m: Message) => !p(m) : p;
  });
  return (m) => preds.every((p) => p(m));
}
