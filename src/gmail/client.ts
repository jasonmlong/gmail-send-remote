/**
 * GmailProvider: the direct Gmail REST API adapter. Drafts are created from
 * the raw MIME the renderer produced, with threadId set so Gmail files the
 * draft into the conversation exactly like a reply typed in the UI.
 * Signatures come from the account's sendAs settings; the timezone from the
 * primary Google Calendar.
 */
import { google, type gmail_v1 } from 'googleapis';
import { base64Url } from '../core/mime.js';
import type { Draft, Message, Signature, Thread, ThreadSummary } from '../core/types.js';
import { DraftMetaCache, renderMatchesMessage } from '../draft-meta.js';
import type { DraftInput, ListThreadsQuery, MailProvider, Profile } from '../provider.js';
import type { OAuth2Client } from './auth.js';
import { apiMessageToMessage } from './parse.js';

export interface GmailProviderOptions {
  /** Where render metadata for drafts is remembered so update_draft can re-render. */
  metaPath?: string;
}

export class GmailProvider implements MailProvider {
  readonly kind = 'gmail' as const;
  private readonly gmail: gmail_v1.Gmail;
  private readonly auth: OAuth2Client;
  private readonly meta: DraftMetaCache;
  private timeZoneCache?: string | null;

  constructor(auth: OAuth2Client, opts: GmailProviderOptions = {}) {
    this.auth = auth;
    this.gmail = google.gmail({ version: 'v1', auth });
    this.meta = new DraftMetaCache(opts.metaPath);
  }

  /** Timezone of the primary calendar (requires calendar.readonly). Cached per process; null when unavailable. */
  async getTimeZone(): Promise<string | undefined> {
    if (this.timeZoneCache !== undefined) return this.timeZoneCache ?? undefined;
    try {
      const cal = google.calendar({ version: 'v3', auth: this.auth });
      const res = await cal.calendars.get({ calendarId: 'primary' });
      this.timeZoneCache = res.data.timeZone ?? null;
    } catch {
      this.timeZoneCache = null;
    }
    return this.timeZoneCache ?? undefined;
  }

  async getProfile(): Promise<Profile> {
    const [prof, sendAs, timeZone] = await Promise.all([
      this.gmail.users.getProfile({ userId: 'me' }),
      this.gmail.users.settings.sendAs.list({ userId: 'me' }),
      this.getTimeZone(),
    ]);
    const identities = (sendAs.data.sendAs ?? []).map((s) => ({
      email: s.sendAsEmail ?? '',
      name: s.displayName ?? undefined,
      isDefault: !!s.isDefault,
      replyTo: s.replyToAddress ?? undefined,
    }));
    const def = identities.find((i) => i.isDefault);
    // Direct OAuth carries no per-credential scoping: the token's Google scopes
    // permit everything this adapter does, so the send gate is the local flag.
    return {
      email: prof.data.emailAddress ?? '',
      name: def?.name,
      sendAs: identities,
      timeZone,
      capabilities: ['read', 'draft', 'send', 'settings'],
      canSend: true,
      canWriteSettings: true,
    };
  }

  async listThreads(q: ListThreadsQuery = {}): Promise<ThreadSummary[]> {
    const max = Math.min(q.max ?? 15, 50);
    const list = await this.gmail.users.threads.list({ userId: 'me', q: q.query, maxResults: max });
    const ids = (list.data.threads ?? []).map((t) => t.id).filter((id): id is string => !!id);
    const out: ThreadSummary[] = [];
    for (const id of ids) {
      const t = await this.gmail.users.threads.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date'] });
      const msgs = (t.data.messages ?? []).map(apiMessageToMessage);
      const last = msgs[msgs.length - 1];
      const seen = new Map<string, Message['from']>();
      for (const m of msgs) for (const a of [m.from, ...m.to, ...m.cc]) if (a.email) seen.set(a.email.toLowerCase(), a);
      out.push({
        id,
        subject: msgs[0]?.subject ?? '',
        snippet: last?.snippet ?? t.data.snippet ?? '',
        lastDate: last?.date ?? new Date(0),
        messageCount: msgs.length,
        participants: [...seen.values()],
        labelIds: Array.from(new Set(msgs.flatMap((m) => m.labelIds ?? []))),
      });
    }
    return out;
  }

  async getThread(threadId: string): Promise<Thread> {
    const t = await this.gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
    return { id: t.data.id ?? threadId, messages: (t.data.messages ?? []).map(apiMessageToMessage), snippet: t.data.snippet ?? undefined };
  }

  async getMessage(messageId: string): Promise<Message> {
    const m = await this.gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
    return apiMessageToMessage(m.data);
  }

  /** The signatures Gmail itself inserts, one per sendAs identity. */
  async listSignatures(): Promise<Signature[]> {
    const res = await this.gmail.users.settings.sendAs.list({ userId: 'me' });
    return (res.data.sendAs ?? []).map((s) => ({
      id: s.sendAsEmail ?? '',
      name: s.displayName ? `${s.displayName} <${s.sendAsEmail}>` : (s.sendAsEmail ?? ''),
      html: s.signature ?? '',
      sendAsEmail: s.sendAsEmail ?? undefined,
      displayName: s.displayName ?? undefined,
      isDefault: !!s.isDefault,
      source: 'gmail' as const,
    }));
  }

  /** Writes the signature into Gmail settings for the given sendAs identity. */
  async saveSignature(sig: Signature): Promise<Signature> {
    const sendAsEmail = sig.sendAsEmail ?? sig.id;
    const res = await this.gmail.users.settings.sendAs.patch({ userId: 'me', sendAsEmail, requestBody: { signature: sig.html } });
    return { ...sig, id: sendAsEmail, sendAsEmail, html: res.data.signature ?? sig.html, source: 'gmail' };
  }

  private async toDraft(d: gmail_v1.Schema$Draft): Promise<Draft> {
    const id = d.id ?? '';
    const full = d.message?.payload ? d : (await this.gmail.users.drafts.get({ userId: 'me', id, format: 'full' })).data;
    const message = apiMessageToMessage(full.message ?? {});
    const meta = this.meta.get(id);
    const fresh = meta ? renderMatchesMessage(meta.rendered, message) : false;
    return { id, threadId: message.threadId || meta?.rendered.threadId, message, rendered: fresh ? meta?.rendered : undefined, raw: fresh ? meta?.raw : undefined, updatedAt: meta ? new Date(meta.updatedAt) : message.date };
  }

  async listDrafts(threadId?: string): Promise<Draft[]> {
    const res = await this.gmail.users.drafts.list({ userId: 'me', maxResults: 50 });
    const out: Draft[] = [];
    for (const d of res.data.drafts ?? []) {
      if (threadId && d.message?.threadId && d.message.threadId !== threadId) continue;
      const draft = await this.toDraft(d);
      if (!threadId || draft.threadId === threadId) out.push(draft);
    }
    return out;
  }

  async getDraft(draftId: string): Promise<Draft> {
    const res = await this.gmail.users.drafts.get({ userId: 'me', id: draftId, format: 'full' });
    return this.toDraft(res.data);
  }

  async createDraft(input: DraftInput): Promise<Draft> {
    const res = await this.gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw: base64Url(input.raw), threadId: input.rendered.threadId } },
    });
    const id = res.data.id ?? '';
    this.meta.set(id, input.rendered, input.raw);
    return this.getDraft(id);
  }

  async updateDraft(draftId: string, input: DraftInput): Promise<Draft> {
    await this.gmail.users.drafts.update({
      userId: 'me',
      id: draftId,
      requestBody: { message: { raw: base64Url(input.raw), threadId: input.rendered.threadId } },
    });
    this.meta.set(draftId, input.rendered, input.raw);
    return this.getDraft(draftId);
  }

  async deleteDraft(draftId: string): Promise<void> {
    await this.gmail.users.drafts.delete({ userId: 'me', id: draftId });
    this.meta.delete(draftId);
  }

  async sendDraft(draftId: string): Promise<Message> {
    const res = await this.gmail.users.drafts.send({ userId: 'me', requestBody: { id: draftId } });
    this.meta.delete(draftId);
    const id = res.data.id ?? '';
    return this.getMessage(id);
  }
}
