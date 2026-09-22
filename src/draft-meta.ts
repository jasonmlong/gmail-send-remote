import fs from 'node:fs';
import path from 'node:path';
import type { Message, RenderedMessage } from './core/types.js';

const addressKey = (list: readonly { email: string }[] | undefined): string =>
  (list ?? []).map((a) => a.email.trim().toLowerCase()).sort().join(',');

/** A cached render must still match the headers Gmail currently holds. */
export function renderMatchesMessage(rendered: RenderedMessage, message: Message, allowHeaderlessTestDouble = false): boolean {
  const messageCarriesHeaders =
    message.to.length > 0 || message.cc.length > 0 || message.bcc.length > 0 || (message.subject ?? '') !== '';
  if (!messageCarriesHeaders) return allowHeaderlessTestDouble;
  return (
    rendered.from.email.trim().toLowerCase() === message.from.email.trim().toLowerCase() &&
    addressKey(rendered.to) === addressKey(message.to) &&
    addressKey(rendered.cc) === addressKey(message.cc) &&
    addressKey(rendered.bcc) === addressKey(message.bcc) &&
    (rendered.subject ?? '') === (message.subject ?? '')
  );
}

export interface DraftMetaEntry {
  rendered: RenderedMessage;
  raw: string;
  updatedAt: string;
}

/**
 * Remembers what we rendered for each remote draft (Gmail and Apps Script
 * providers cannot store it) so update_draft can re-render from the typed body.
 */
export class DraftMetaCache {
  private meta: Record<string, DraftMetaEntry> = {};

  constructor(private readonly filePath?: string) {
    if (filePath && fs.existsSync(filePath)) {
      try {
        this.meta = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, DraftMetaEntry>;
      } catch {
        this.meta = {};
      }
    }
  }

  get(draftId: string): DraftMetaEntry | undefined {
    return this.meta[draftId];
  }

  set(draftId: string, rendered: RenderedMessage, raw: string): void {
    this.meta[draftId] = { rendered, raw, updatedAt: new Date().toISOString() };
    this.persist();
  }

  delete(draftId: string): void {
    delete this.meta[draftId];
    this.persist();
  }

  /**
   * This file holds the full rendered text and raw MIME of every draft the
   * agent has staged, which on a shared host is quoted private mail sitting
   * next to a .env that was carefully locked down. It is written owner-only,
   * and the mode is reasserted because writeFileSync only applies it when
   * creating the file. chmod is a no-op on Windows, hence the catch.
   */
  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.filePath, JSON.stringify(this.meta, null, 2), { mode: 0o600 });
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      /* not a POSIX filesystem */
    }
  }
}
