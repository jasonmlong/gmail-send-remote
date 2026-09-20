/**
 * Core data model shared by the renderer, the simulator, the Gmail adapter,
 * the CLI and the MCP server. Everything here is provider-agnostic.
 */

export interface EmailAddress {
  name?: string;
  email: string;
}

export interface Attachment {
  id?: string;
  filename: string;
  mimeType: string;
  size?: number;
  /** base64 (standard alphabet) payload when available */
  data?: string;
}

export interface Message {
  id: string;
  threadId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  replyTo?: EmailAddress[];
  subject: string;
  /** The message's own timestamp (Gmail internalDate). */
  date: Date;
  /** RFC 5322 Message-ID header, including angle brackets. */
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  html?: string;
  text?: string;
  snippet?: string;
  labelIds?: string[];
  attachments?: Attachment[];
}

export interface Thread {
  id: string;
  messages: Message[];
  snippet?: string;
}

export interface ThreadSummary {
  id: string;
  subject: string;
  snippet: string;
  lastDate: Date;
  messageCount: number;
  participants: EmailAddress[];
  labelIds?: string[];
}

export interface Signature {
  /** Stable id. For Gmail-backed signatures this is the sendAs email. */
  id: string;
  name: string;
  /** Inner HTML exactly as Gmail stores it (no gmail_signature wrapper). */
  html: string;
  /** Optional explicit plain-text form. Derived from html when absent. */
  text?: string;
  sendAsEmail?: string;
  displayName?: string;
  isDefault?: boolean;
  source?: 'gmail' | 'local' | 'detected' | 'generated';
}

/**
 * Gmail default is `after-quote`: the signature (with the "-- " prefix) goes
 * underneath the quoted conversation. `before-quote` mirrors the Gmail setting
 * "Insert this signature before quoted text in replies and remove the -- line".
 */
export type SignaturePlacement = 'after-quote' | 'before-quote';

export type ComposeMode = 'new' | 'reply' | 'forward';

export interface ComposeOptions {
  /** The account the draft is written from. */
  from: EmailAddress;
  /** All addresses that count as "me" (sendAs aliases). Defaults to [from]. */
  myEmails?: string[];
  signature?: Signature | null;
  signaturePlacement?: SignaturePlacement;
  /** IANA timezone used for the "On <date> ... wrote:" line. */
  timeZone?: string;
  /**
   * Character between the minutes and AM/PM in generated dates. Gmail in a
   * current Chrome emits U+202F (narrow no-break space); older clients emit a
   * plain space. Defaults to U+202F.
   */
  amPmSeparator?: string;
  /** Wrap the address in the attribution line in a mailto link. Gmail usually does not on send. */
  linkifyAttributionEmail?: boolean;
  /** Where the quoted plain text comes from. Gmail regenerates from HTML; the original text part is normally identical. */
  quoteTextSource?: 'original-text' | 'convert-html';
  /** Clock override for tests. */
  now?: Date;
}

export interface NewMessageInput {
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  /** Plain text body. Paragraphs separated by blank lines, exactly as a person would type into Gmail. */
  body: string;
  attachments?: Attachment[];
}

export interface ReplyInput {
  body: string;
  replyAll?: boolean;
  /** Overrides for the computed recipients. */
  to?: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  /** Extra recipients added on top of the computed ones. */
  addCc?: EmailAddress[];
  addBcc?: EmailAddress[];
  attachments?: Attachment[];
}

export interface ForwardInput {
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  body?: string;
  /** Forward the original attachments (default true). */
  includeAttachments?: boolean;
}

export interface RenderedMessage {
  mode: ComposeMode;
  subject: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  html: string;
  text: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: Attachment[];
  /** The message this one answers or forwards, when applicable. */
  originalMessageId?: string;
}

export interface Draft {
  id: string;
  threadId?: string;
  message: Message;
  rendered?: RenderedMessage;
  /** Full RFC 822 source. */
  raw?: string;
  updatedAt: Date;
}
