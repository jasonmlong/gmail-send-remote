import type { Draft, Message, RenderedMessage, Signature, Thread, ThreadSummary } from './core/types.js';

export interface DraftInput {
  rendered: RenderedMessage;
  /** Full RFC 822 source (what the Gmail API receives as `raw`). */
  raw: string;
}

export interface ListThreadsQuery {
  /** Gmail search syntax. The simulator supports from:, to:, subject:, in:inbox, in:sent, is:unread and bare words. */
  query?: string;
  max?: number;
}

export interface SendAsIdentity {
  email: string;
  name?: string;
  isDefault: boolean;
  replyTo?: string;
}

export type Capability = 'read' | 'draft' | 'send' | 'settings';

export interface Profile {
  email: string;
  name?: string;
  sendAs: SendAsIdentity[];
  /** The user's timezone as reported by their Google Calendar (best available proxy for the clock Gmail's attribution line uses). */
  timeZone?: string;
  /** Label of the credential in use, when the backend issues named ones. */
  tokenLabel?: string;
  /** What this credential is permitted to do. Absent means the backend does not scope capabilities. */
  capabilities?: Capability[];
  /**
   * Whether sending is actually possible for this caller right now, after both
   * the credential's own capabilities and the deployment's switches are applied.
   * A draft-only token reports false even when sending is enabled globally.
   */
  canSend?: boolean;
  canWriteSettings?: boolean;
}

export type ProviderKind = 'sim' | 'gmail' | 'appsscript';

/**
 * The one interface every backend implements: the offline simulator, the
 * direct Gmail API adapter, and the Apps Script web-app client. Everything
 * above this line (drafting service, MCP, CLI) is written against it, so a
 * workflow tested in the simulator runs unchanged against a real mailbox.
 */
export interface MailProvider {
  readonly kind: ProviderKind;
  getProfile(): Promise<Profile>;
  listThreads(q?: ListThreadsQuery): Promise<ThreadSummary[]>;
  getThread(threadId: string): Promise<Thread>;
  getMessage(messageId: string): Promise<Message>;
  listSignatures(): Promise<Signature[]>;
  saveSignature(sig: Signature): Promise<Signature>;
  listDrafts(threadId?: string): Promise<Draft[]>;
  getDraft(draftId: string): Promise<Draft>;
  createDraft(input: DraftInput): Promise<Draft>;
  updateDraft(draftId: string, input: DraftInput): Promise<Draft>;
  deleteDraft(draftId: string): Promise<void>;
  sendDraft(draftId: string): Promise<Message>;
}
