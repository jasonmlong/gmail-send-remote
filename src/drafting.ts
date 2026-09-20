/**
 * DraftingService: the API an agent (via MCP or CLI) actually calls. It turns
 * "reply to this thread with this body" into a Gmail-identical draft stored
 * through whichever MailProvider is configured.
 */
import { composeForward, composeNew, composeReply } from './core/compose.js';
import { buildMime } from './core/mime.js';
import type {
  ComposeOptions,
  Draft,
  EmailAddress,
  ForwardInput,
  Message,
  NewMessageInput,
  RenderedMessage,
  ReplyInput,
  Signature,
  SignaturePlacement,
  Thread,
} from './core/types.js';
import { sameEmail } from './core/address.js';
import type { MailProvider } from './provider.js';

export interface DraftingOptions {
  /** Force a timezone for the attribution line. Default: the provider's profile timezone (Google Calendar), then America/New_York. */
  timeZone?: string;
  amPmSeparator?: string;
  signaturePlacement?: SignaturePlacement;
  /** Override the From identity (defaults to the provider's default sendAs). */
  from?: EmailAddress;
  allowSend?: boolean;
  /**
   * Local signature library. Used only as a fallback when the provider has no
   * usable signature, or when one of them is selected explicitly by id. The
   * signature Gmail shows in Settings always wins by default.
   */
  extraSignatures?: Signature[];
  now?: () => Date;
}

export interface SignatureChoice {
  /** Signature id, name or sendAs email. "none" suppresses the signature. Undefined = the provider default. */
  signatureId?: string | null;
}

export type DraftNewRequest = NewMessageInput & SignatureChoice;
export type DraftReplyRequest = ReplyInput & SignatureChoice & { threadId?: string; messageId?: string };
export type DraftForwardRequest = ForwardInput & SignatureChoice & { messageId: string };
export interface DraftUpdateRequest extends SignatureChoice {
  body?: string;
  subject?: string;
  to?: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  replyAll?: boolean;
}

export interface Identity {
  from: EmailAddress;
  myEmails: string[];
  timeZone: string;
  timeZoneSource: 'config' | 'provider' | 'default';
}

const DEFAULT_TZ = 'America/New_York';

export class DraftingService {
  constructor(
    public readonly provider: MailProvider,
    private readonly opts: DraftingOptions = {},
  ) {}

  async identity(): Promise<Identity> {
    const profile = await this.provider.getProfile();
    const def = profile.sendAs.find((s) => s.isDefault) ?? profile.sendAs[0];
    const from = this.opts.from ?? { name: def?.name ?? profile.name, email: def?.email ?? profile.email };
    const myEmails = Array.from(new Set([profile.email, ...profile.sendAs.map((s) => s.email), from.email]));
    const tz: Pick<Identity, 'timeZone' | 'timeZoneSource'> = this.opts.timeZone
      ? { timeZone: this.opts.timeZone, timeZoneSource: 'config' }
      : profile.timeZone
        ? { timeZone: profile.timeZone, timeZoneSource: 'provider' }
        : { timeZone: DEFAULT_TZ, timeZoneSource: 'default' };
    return { from, myEmails, ...tz };
  }

  /** Provider signatures first (what Gmail shows), then the local library, de-duplicated by id. */
  async listSignatures(): Promise<Signature[]> {
    const fromProvider = await this.provider.listSignatures();
    const extra = (this.opts.extraSignatures ?? []).filter((e) => !fromProvider.some((p) => p.id === e.id));
    return [...fromProvider, ...extra];
  }

  async resolveSignature(choice?: string | null): Promise<Signature | null> {
    if (choice === 'none') return null;
    const fromProvider = await this.provider.listSignatures();
    const extras = this.opts.extraSignatures ?? [];
    const usable = (l: Signature[]) => l.filter((s) => s.html.trim());

    if (choice) {
      const match = (s: Signature) =>
        s.id === choice || s.name.toLowerCase() === choice.toLowerCase() || (!!s.sendAsEmail && sameEmail(s.sendAsEmail, choice));
      const hit = usable(fromProvider).find(match) ?? usable(extras).find(match);
      if (!hit) {
        const known = [...fromProvider, ...extras].map((s) => s.id).join(', ') || '(none)';
        throw new Error(`Signature not found: ${choice}. Known: ${known}`);
      }
      return hit;
    }

    const providerUsable = usable(fromProvider);
    const providerDefault = providerUsable.find((s) => s.isDefault) ?? providerUsable[0];
    if (providerDefault) return providerDefault;

    const localUsable = usable(extras);
    return localUsable.find((s) => s.isDefault) ?? localUsable[0] ?? null;
  }

  private async composeOptions(signatureId?: string | null): Promise<ComposeOptions & { timeZone: string }> {
    const id = await this.identity();
    const signature = await this.resolveSignature(signatureId);
    return {
      from: id.from,
      myEmails: id.myEmails,
      signature,
      signaturePlacement: this.opts.signaturePlacement ?? 'after-quote',
      timeZone: id.timeZone,
      amPmSeparator: this.opts.amPmSeparator,
      now: this.opts.now?.(),
    };
  }

  private toDraftInput(rendered: RenderedMessage, timeZone: string) {
    const raw = buildMime(rendered, { date: this.opts.now?.() ?? new Date(), timeZone });
    return { rendered, raw };
  }

  /** Gmail replies to the most recent message in the conversation. */
  async targetMessage(req: { threadId?: string; messageId?: string }): Promise<Message> {
    if (req.messageId) return this.provider.getMessage(req.messageId);
    if (!req.threadId) throw new Error('threadId or messageId is required');
    const thread: Thread = await this.provider.getThread(req.threadId);
    if (!thread.messages.length) throw new Error(`Thread ${req.threadId} has no messages`);
    return thread.messages[thread.messages.length - 1];
  }

  async draftNew(req: DraftNewRequest): Promise<Draft> {
    const opts = await this.composeOptions(req.signatureId);
    return this.provider.createDraft(this.toDraftInput(composeNew(req, opts), opts.timeZone));
  }

  async draftReply(req: DraftReplyRequest): Promise<Draft> {
    const original = await this.targetMessage(req);
    const opts = await this.composeOptions(req.signatureId);
    return this.provider.createDraft(this.toDraftInput(composeReply(original, req, opts), opts.timeZone));
  }

  async draftForward(req: DraftForwardRequest): Promise<Draft> {
    const original = await this.provider.getMessage(req.messageId);
    const opts = await this.composeOptions(req.signatureId);
    return this.provider.createDraft(this.toDraftInput(composeForward(original, req, opts), opts.timeZone));
  }

  /** Re-render an existing draft with changes. Body text is re-rendered from scratch so the Gmail structure stays exact. */
  async updateDraft(draftId: string, patch: DraftUpdateRequest): Promise<Draft> {
    const existing = await this.provider.getDraft(draftId);
    const prev = existing.rendered;
    if (!prev) throw new Error(`Draft ${draftId} has no render metadata; delete it and create a new draft instead.`);
    const opts = await this.composeOptions(patch.signatureId);
    const bodyOf = (r: RenderedMessage) => r.text.split(/\n\n(?:--\n|On .+? wrote:|---------- Forwarded message)/s)[0];
    const body = patch.body ?? bodyOf(prev);
    let rendered: RenderedMessage;
    if (prev.mode === 'new') {
      rendered = composeNew(
        { to: patch.to ?? prev.to, cc: patch.cc ?? prev.cc, bcc: patch.bcc ?? prev.bcc, subject: patch.subject ?? prev.subject, body, attachments: prev.attachments },
        opts,
      );
    } else if (prev.mode === 'reply') {
      const original = await this.provider.getMessage(prev.originalMessageId as string);
      rendered = composeReply(original, { body, replyAll: patch.replyAll, to: patch.to ?? prev.to, cc: patch.cc ?? prev.cc, bcc: patch.bcc ?? prev.bcc }, opts);
    } else {
      const original = await this.provider.getMessage(prev.originalMessageId as string);
      rendered = composeForward(original, { body, to: patch.to ?? prev.to, cc: patch.cc ?? prev.cc, bcc: patch.bcc ?? prev.bcc }, opts);
    }
    if (patch.subject && prev.mode !== 'new') rendered.subject = patch.subject;
    return this.provider.updateDraft(draftId, this.toDraftInput(rendered, opts.timeZone));
  }

  async send(draftId: string): Promise<Message> {
    if (!this.opts.allowSend) {
      throw new Error('Sending is disabled. Set GMAIL_SEND_ALLOW_SEND=1 to enable send_draft. Drafts stay in Gmail for a human to send.');
    }
    return this.provider.sendDraft(draftId);
  }
}
