import fs from 'node:fs';
import path from 'node:path';
import type { RenderedMessage } from './core/types.js';

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

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.meta, null, 2));
  }
}
