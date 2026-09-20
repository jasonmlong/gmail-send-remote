/**
 * AppsScriptProvider: talks to the lightweight Apps Script web app in
 * apps-script/ (deployed inside the user's own Google account). The script
 * owns the Gmail access; this client only needs its URL and shared token.
 * No Google Cloud OAuth client is needed on this side.
 *
 * Protocol: POST JSON {token, action, ...params} -> {ok, result | error}.
 * See docs/APPS-SCRIPT-API.md.
 */
import type { Draft, Message, Signature, Thread, ThreadSummary } from '../core/types.js';
import { DraftMetaCache } from '../draft-meta.js';
import type { DraftInput, ListThreadsQuery, MailProvider, Profile } from '../provider.js';

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; redirect: 'follow' }) => Promise<{ status: number; text(): Promise<string> }>;

export interface AppsScriptProviderOptions {
  url: string;
  token: string;
  metaPath?: string;
  fetchImpl?: FetchLike;
}

interface WireMessage extends Omit<Message, 'date'> {
  date: string;
}
interface WireDraft {
  id: string;
  threadId?: string;
  message: WireMessage;
  updatedAt: string;
}

export class AppsScriptProvider implements MailProvider {
  readonly kind = 'appsscript' as const;
  private readonly meta: DraftMetaCache;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: AppsScriptProviderOptions) {
    if (!opts.url) throw new Error('GMAIL_SEND_APPS_SCRIPT_URL is required for the appsscript provider');
    if (!opts.token) throw new Error('GMAIL_SEND_APPS_SCRIPT_TOKEN is required for the appsscript provider');
    this.meta = new DraftMetaCache(opts.metaPath);
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
  }

  async call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const res = await this.fetchImpl(this.opts.url, {
      method: 'POST',
      // text/plain avoids a CORS preflight in browsers and is what Apps Script's doPost expects to parse from postData.contents.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: this.opts.token, action, ...params }),
      redirect: 'follow',
    });
    const text = await res.text();
    let data: { ok: boolean; result?: T; error?: string };
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Apps Script returned non-JSON (HTTP ${res.status}). Is the web app deployed with access "Anyone"? First 200 chars: ${text.slice(0, 200)}`);
    }
    if (!data.ok) throw new Error(data.error ?? `Apps Script error on ${action}`);
    return data.result as T;
  }

  private reviveMessage(m: WireMessage): Message {
    return { ...m, date: new Date(m.date) };
  }

  private reviveDraft(d: WireDraft): Draft {
    const meta = this.meta.get(d.id);
    return { id: d.id, threadId: d.threadId ?? meta?.rendered.threadId, message: this.reviveMessage(d.message), rendered: meta?.rendered, raw: meta?.raw, updatedAt: new Date(d.updatedAt) };
  }

  async getProfile(): Promise<Profile> {
    // Carries tokenLabel, capabilities, canSend and canWriteSettings, which
    // describe what THIS token may do rather than what the mailbox allows.
    return this.call<Profile>('profile');
  }

  async listThreads(q: ListThreadsQuery = {}): Promise<ThreadSummary[]> {
    const list = await this.call<Array<Omit<ThreadSummary, 'lastDate'> & { lastDate: string }>>('listThreads', { query: q.query, max: q.max });
    return list.map((t) => ({ ...t, lastDate: new Date(t.lastDate) }));
  }

  async getThread(threadId: string): Promise<Thread> {
    const t = await this.call<{ id: string; messages: WireMessage[]; snippet?: string }>('getThread', { threadId });
    return { id: t.id, messages: t.messages.map((m) => this.reviveMessage(m)), snippet: t.snippet };
  }

  async getMessage(messageId: string): Promise<Message> {
    return this.reviveMessage(await this.call<WireMessage>('getMessage', { messageId }));
  }

  async listSignatures(): Promise<Signature[]> {
    return this.call<Signature[]>('listSignatures');
  }

  async saveSignature(sig: Signature): Promise<Signature> {
    return this.call<Signature>('saveSignature', { sendAsEmail: sig.sendAsEmail ?? sig.id, html: sig.html });
  }

  async listDrafts(threadId?: string): Promise<Draft[]> {
    return (await this.call<WireDraft[]>('listDrafts', { threadId })).map((d) => this.reviveDraft(d));
  }

  async getDraft(draftId: string): Promise<Draft> {
    return this.reviveDraft(await this.call<WireDraft>('getDraft', { draftId }));
  }

  async createDraft(input: DraftInput): Promise<Draft> {
    const d = await this.call<WireDraft>('createDraft', { raw: input.raw, threadId: input.rendered.threadId });
    this.meta.set(d.id, input.rendered, input.raw);
    return this.reviveDraft(d);
  }

  async updateDraft(draftId: string, input: DraftInput): Promise<Draft> {
    const d = await this.call<WireDraft>('updateDraft', { draftId, raw: input.raw, threadId: input.rendered.threadId });
    this.meta.set(d.id, input.rendered, input.raw);
    return this.reviveDraft(d);
  }

  async deleteDraft(draftId: string): Promise<void> {
    await this.call('deleteDraft', { draftId });
    this.meta.delete(draftId);
  }

  async sendDraft(draftId: string): Promise<Message> {
    const m = await this.call<WireMessage>('sendDraft', { draftId });
    this.meta.delete(draftId);
    return this.reviveMessage(m);
  }
}
